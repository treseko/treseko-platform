"""Fail-closed detection of a local Treseko runtime and update state."""

from __future__ import annotations

from dataclasses import dataclass
import json
import errno
from pathlib import Path
import re
import shutil
import subprocess
import urllib.error
import urllib.request


VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$")
TERMINAL_UPDATE_PHASES = {"committed", "rolled_back", "abandoned_before_mutation", "candidate_rejected"}


@dataclass(frozen=True)
class RuntimeDetection:
    state: str
    version: str | None = None
    backend_version: str | None = None
    detail: str = ""


def compare_versions(left: str, right: str) -> int:
    """Compare supported numeric Treseko versions; prereleases sort before final."""
    left_match, right_match = VERSION_RE.fullmatch(left), VERSION_RE.fullmatch(right)
    if not left_match or not right_match:
        raise ValueError("Versión Treseko inválida")
    left_core = tuple(int(left_match.group(i)) for i in range(1, 4))
    right_core = tuple(int(right_match.group(i)) for i in range(1, 4))
    if left_core != right_core:
        return (left_core > right_core) - (left_core < right_core)
    left_pre, right_pre = left_match.group(4), right_match.group(4)
    if left_pre == right_pre:
        return 0
    if left_pre is None:
        return 1
    if right_pre is None:
        return -1
    left_parts, right_parts = left_pre.split("."), right_pre.split(".")
    for left_part, right_part in zip(left_parts, right_parts):
        left_numeric, right_numeric = left_part.isdigit(), right_part.isdigit()
        if left_numeric and right_numeric:
            left_value, right_value = int(left_part), int(right_part)
            if left_value != right_value:
                return (left_value > right_value) - (left_value < right_value)
        elif left_numeric != right_numeric:
            return -1 if left_numeric else 1
        elif left_part != right_part:
            return (left_part > right_part) - (left_part < right_part)
    return (len(left_parts) > len(right_parts)) - (len(left_parts) < len(right_parts))


def detect_runtime(port: int, timeout: float = 2.0) -> RuntimeDetection:
    """Identify Treseko only when frontend identity and backend health agree."""
    base = f"http://127.0.0.1:{port}"
    try:
        with urllib.request.urlopen(base + "/version.json", timeout=timeout) as response:
            frontend = json.load(response)
    except urllib.error.URLError as exc:
        reason = getattr(exc, "reason", None)
        if isinstance(reason, ConnectionRefusedError) or getattr(reason, "errno", None) == errno.ECONNREFUSED:
            return RuntimeDetection("not_running", detail="No hay un servicio respondiendo en ese puerto.")
        return RuntimeDetection("unknown", detail="No se pudo consultar el servicio local.")
    except (OSError, ValueError, json.JSONDecodeError):
        return RuntimeDetection("occupied", detail="El puerto responde, pero no se pudo identificar Treseko.")

    if not isinstance(frontend, dict) or frontend.get("product") != "treseko-platform":
        return RuntimeDetection("occupied", detail="El puerto está ocupado por una aplicación que no se identificó como Treseko.")
    frontend_version = str(frontend.get("version", "")).strip()
    if not VERSION_RE.fullmatch(frontend_version):
        return RuntimeDetection("unverified_treseko", detail="La interfaz parece ser Treseko, pero no reporta una versión válida.")

    for path in ("/api/health", "/health"):
        try:
            with urllib.request.urlopen(base + path, timeout=timeout) as response:
                health = json.load(response)
            backend_version = str(health.get("version", "")).strip() if isinstance(health, dict) else ""
            if isinstance(health, dict) and health.get("status") in {"ok", "healthy", "online"} and VERSION_RE.fullmatch(backend_version):
                state = "running" if backend_version == frontend_version else "version_mismatch"
                detail = "Frontend y Backend coinciden." if state == "running" else "Frontend y Backend reportan versiones distintas."
                return RuntimeDetection(state, frontend_version, backend_version, detail)
        except (OSError, ValueError, urllib.error.URLError, json.JSONDecodeError):
            continue
    return RuntimeDetection(
        "unverified_treseko", frontend_version, detail="Treseko responde, pero no se pudo verificar la salud y versión del Backend.",
    )


def installed_version(root: Path) -> str | None:
    """Read the last committed release version, falling back to the installed tree marker."""
    active_release = root / ".treseko-local" / "active-release.json"
    try:
        payload = json.loads(active_release.read_text(encoding="utf-8"))
        value = str(payload.get("version", "")).strip()
        if VERSION_RE.fullmatch(value):
            return value
    except (OSError, ValueError, json.JSONDecodeError):
        pass
    try:
        value = (root / "VERSION").read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return value if VERSION_RE.fullmatch(value) else None


def runtime_matches_installation(port: int, root: Path, timeout: float = 10.0) -> bool | None:
    """Tie the published port's container back to the selected Compose root.

    ``None`` means Docker could not prove the mapping; callers must treat that
    as ambiguous rather than assuming the active instance belongs to ``root``.
    """
    docker = shutil.which("docker")
    if not docker:
        return None
    try:
        listed = subprocess.run(
            [docker, "ps", "--filter", f"publish={port}", "--format", "{{.ID}}"],
            capture_output=True, text=True, timeout=timeout, check=False,
        )
        if listed.returncode != 0:
            return None
        container_ids = [line.strip() for line in listed.stdout.splitlines() if line.strip()]
        if len(container_ids) != 1:
            return None
        inspected = subprocess.run(
            [docker, "inspect", "--format={{json .Config.Labels}}", container_ids[0]],
            capture_output=True, text=True, timeout=timeout, check=False,
        )
        if inspected.returncode != 0:
            return None
        labels = json.loads(inspected.stdout)
        if not isinstance(labels, dict) or labels.get("com.docker.compose.service") != "frontend":
            return False
        expected_roots = {root.resolve()}
        active_path = root / ".treseko-local" / "active-release.json"
        try:
            active = json.loads(active_path.read_text(encoding="utf-8"))
            relative = Path(str(active.get("release", "")))
            if relative.is_absolute() or ".." in relative.parts:
                return False
            expected_roots.add((root / ".treseko-local" / "releases" / relative).resolve())
        except (OSError, ValueError, json.JSONDecodeError):
            pass
        working_dir = labels.get("com.docker.compose.project.working_dir")
        config_files = str(labels.get("com.docker.compose.project.config_files", ""))
        observed_roots: set[Path] = set()
        if working_dir:
            observed_roots.add(Path(working_dir).resolve())
        for value in config_files.split(","):
            candidate = value.strip()
            if candidate:
                observed_roots.add(Path(candidate).resolve().parent)
        return bool(expected_roots & observed_roots)
    except (OSError, subprocess.TimeoutExpired, ValueError, json.JSONDecodeError):
        return None


def has_unfinished_update(root: Path) -> bool:
    """Unreadable or non-terminal journals block a second update."""
    journal_root = root / ".treseko-local" / "update-transactions"
    if not journal_root.exists():
        return False
    if journal_root.is_symlink() or not journal_root.is_dir():
        return True
    try:
        journals = list(journal_root.glob("*.json"))
        for path in journals:
            if path.is_symlink() or not path.is_file():
                return True
            payload = json.loads(path.read_text(encoding="utf-8"))
            phase = payload.get("phase") if isinstance(payload, dict) else None
            if phase not in TERMINAL_UPDATE_PHASES:
                return True
    except (OSError, ValueError, json.JSONDecodeError):
        return True
    return False
