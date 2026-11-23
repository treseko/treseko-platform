"""Version comparison for Automation Worker update admission."""
from __future__ import annotations

import re
import hashlib
import json
import os
import stat
import tarfile
import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping

from ..version import PRODUCT_VERSION


_VERSION = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$")


def _version_key(value: str) -> tuple[int, int, int] | None:
    match = _VERSION.fullmatch(value.strip())
    if not match:
        return None
    return tuple(int(part) for part in match.groups())


def observed_worker_version(capabilities: Mapping[str, Any] | None) -> str | None:
    values = capabilities if isinstance(capabilities, Mapping) else {}
    versions = values.get("versions") if isinstance(values.get("versions"), Mapping) else {}
    raw = values.get("component_version") or values.get("worker_version") or versions.get("automation_worker")
    value = str(raw or "").strip()
    return value or None


def observed_worker_build_id(capabilities: Mapping[str, Any] | None) -> str | None:
    values = capabilities if isinstance(capabilities, Mapping) else {}
    value = str(values.get("worker_build_id") or "").strip().lower()
    return value if re.fullmatch(r"[a-f0-9]{64}", value) else None


_EXCLUDED_DIRECTORIES = {
    ".git", "node_modules", ".cache", ".state", ".pytest_cache", "coverage",
    "logs", "reports", "pending-deliveries", "test-results", ".worker-releases",
}
_EXCLUDED_FILES = {
    ".treseko-content-digest", ".maintenance", ".treseko-update-fence",
    ".treseko-update-draining", ".treseko-update-restart",
    ".treseko-runtime-manifest.json", "maintenance.html", ".runner-token",
    ".runner-token.pairing", ".worker-instance-id",
    ".treseko-active-worker-release.json", "VERSION", "package.json",
    "package-lock.json", "worker-launcher.mjs", "entrypoint.sh",
}


@lru_cache(maxsize=8)
def _worker_source_build_id_cached(source: str) -> str:
    root = Path(source)
    if root == Path("/") or not root.is_dir() or root.is_symlink():
        raise ValueError("worker_source_directory_invalid")
    records: list[tuple[str, Path]] = []
    for current, dirs, files in os.walk(root, followlinks=False):
        current_path = Path(current)
        dirs[:] = [
            name for name in dirs
            if name not in _EXCLUDED_DIRECTORIES
            and not (current_path / name).is_symlink()
        ]
        for name in files:
            item = current_path / name
            relative = item.relative_to(root).as_posix()
            if (name in _EXCLUDED_FILES or name == ".env" or name.startswith(".env.")
                    or item.is_symlink() or not item.is_file()):
                continue
            if "\\" in relative or "\n" in relative or "\r" in relative:
                raise ValueError("worker_source_filename_invalid")
            records.append((relative, item))

    manifest = hashlib.sha256()
    for relative, item in sorted(records):
        file_digest = hashlib.sha256()
        with item.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                file_digest.update(chunk)
        manifest.update(f"{file_digest.hexdigest()}  ./{relative}\n".encode("utf-8"))
    return manifest.hexdigest()


def worker_source_build_id(source: Path | None = None) -> str:
    """Fingerprint Worker source using the same manifest contract as its image."""
    selected = Path(source) if source is not None else worker_source_directory()
    try:
        resolved = selected.resolve(strict=True)
    except OSError as exc:
        raise ValueError("worker_source_directory_unavailable") from exc
    try:
        package = json.loads((resolved / "package.json").read_text(encoding="utf-8"))
        version = (resolved / "VERSION").read_text(encoding="utf-8").strip()
    except (OSError, ValueError) as exc:
        raise ValueError("worker_source_metadata_invalid") from exc
    if not isinstance(package, dict) or package.get("version") != PRODUCT_VERSION or version != PRODUCT_VERSION:
        raise ValueError("worker_source_version_mismatch")
    return _worker_source_build_id_cached(str(resolved))


def current_worker_build_id() -> str:
    try:
        return worker_source_build_id()
    except ValueError:
        return ""


def worker_update_status(
    capabilities: Mapping[str, Any] | None,
    *,
    desired_version: str = PRODUCT_VERSION,
    desired_build_id: str = "",
) -> dict[str, Any]:
    """Return a conservative, deterministic version state for one runner.

    Treseko component releases currently require matching app and Worker
    versions. A missing or malformed Worker version cannot be declared current.
    A newer Worker is reported separately so the service does not silently
    downgrade it to the app's version.
    """
    values = capabilities if isinstance(capabilities, Mapping) else {}
    desired = str(desired_version or "").strip()
    observed = observed_worker_version(values)
    observed_build_id = observed_worker_build_id(values)
    desired_key = _version_key(desired)
    observed_key = _version_key(observed or "")
    target_build_id = str(desired_build_id or "").strip().lower()
    if not desired_key:
        status = "target_version_unavailable"
    elif not re.fullmatch(r"[a-f0-9]{64}", target_build_id):
        status = "target_build_unavailable"
    elif not observed or not observed_key:
        status = "version_unknown"
    elif observed_key > desired_key:
        status = "ahead"
    elif observed == desired and observed_build_id == target_build_id:
        status = "current"
    else:
        status = "update_required"
    return {
        "status": status,
        "update_required": status != "current",
        "desired_version": desired or None,
        "observed_version": observed,
        "desired_build_id": target_build_id if re.fullmatch(r"[a-f0-9]{64}", target_build_id) else None,
        "observed_build_id": observed_build_id,
        "worker_instance_id": str(values.get("worker_instance_id") or "") or None,
    }


def worker_execution_blocker(
    capabilities: Mapping[str, Any] | None,
    *,
    desired_version: str = PRODUCT_VERSION,
    desired_build_id: str | None = None,
) -> dict[str, Any] | None:
    """Prevent jobs from reaching a Worker until its reported code converges."""
    build_id = current_worker_build_id() if desired_build_id is None else desired_build_id
    status = worker_update_status(
        capabilities, desired_version=desired_version, desired_build_id=build_id,
    )
    if status["status"] == "current":
        return None
    return {
        "code": "worker_update_required" if status["status"] == "update_required" else "worker_version_unverified",
        **status,
    }


def worker_source_directory() -> Path:
    """Resolve the operator-configured active Worker source/runtime directory."""
    raw = str(os.getenv("TRESEKO_WORKER_UPDATE_SOURCE_DIR") or os.getenv("TRESEKO_WORKER_DIR") or "/worker").strip()
    candidate = Path(raw)
    if not candidate.is_absolute() or candidate == Path("/") or ".." in candidate.parts:
        raise ValueError("worker_source_directory_invalid")
    try:
        info = candidate.lstat()
    except OSError as exc:
        raise ValueError("worker_source_directory_unavailable") from exc
    if not candidate.is_dir() or candidate.is_symlink():
        raise ValueError("worker_source_directory_invalid")
    runtime = candidate.resolve(strict=True)
    pointer = runtime / ".treseko-active-worker-release.json"
    try:
        pointer_info = pointer.lstat()
    except FileNotFoundError:
        return runtime
    except OSError as exc:
        raise ValueError("worker_active_release_invalid") from exc
    if not stat.S_ISREG(pointer_info.st_mode):
        raise ValueError("worker_active_release_invalid")
    try:
        active = json.loads(pointer.read_text(encoding="utf-8"))
        release = str(active.get("release") or "") if isinstance(active, dict) else ""
    except (OSError, ValueError) as exc:
        raise ValueError("worker_active_release_invalid") from exc
    if not isinstance(active, dict) or active.get("schema") != 1 or not re.fullmatch(
        r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-[a-f0-9]{12}", release,
    ):
        raise ValueError("worker_active_release_invalid")
    releases = runtime / ".worker-releases"
    active_path = releases / release
    try:
        releases.lstat()
        active_path.lstat()
        resolved = active_path.resolve(strict=True)
    except OSError as exc:
        raise ValueError("worker_active_release_unavailable") from exc
    if (not releases.is_dir() or releases.is_symlink() or not active_path.is_dir()
        or active_path.is_symlink() or not resolved.is_relative_to(releases.resolve(strict=True))):
        raise ValueError("worker_active_release_invalid")
    return resolved


def create_worker_update_archive(source: Path, *, desired_version: str = PRODUCT_VERSION) -> tuple[Path, str]:
    """Create a bounded, secret-free archive of the active Worker source.

    The archive is delivered only to the authenticated stale runner over the
    platform API. Runtime credentials, node_modules and mutable evidence never
    cross this boundary.
    """
    source = Path(source)
    if not source.is_absolute() or source == Path("/") or source.is_symlink() or not source.is_dir():
        raise ValueError("worker_source_directory_invalid")
    try:
        package = json.loads((source / "package.json").read_text(encoding="utf-8"))
        version = (source / "VERSION").read_text(encoding="utf-8").strip()
    except (OSError, ValueError) as exc:
        raise ValueError("worker_source_metadata_invalid") from exc
    if not isinstance(package, dict) or str(package.get("version") or "").strip() != desired_version or version != desired_version:
        raise ValueError("worker_source_version_mismatch")

    excluded_names = {
        "node_modules", ".state", ".cache", "logs", ".runner-token",
        ".runner-token.pairing", ".worker-instance-id", ".treseko-content-digest",
        ".treseko-update-control", ".treseko-update-restart",
        ".treseko-runtime-manifest.json", ".treseko-active-worker-release.json",
        ".worker-releases",
    }
    excluded_prefixes = (".treseko-update-",)
    file_list: list[Path] = []
    total_bytes = 0
    max_files = 20_000
    max_total_bytes = 256 * 1024 * 1024
    for root, dirs, files in os.walk(source, followlinks=False):
        root_path = Path(root)
        dirs[:] = [name for name in dirs if name not in excluded_names and not name.startswith(excluded_prefixes)]
        for name in files:
            item = root_path / name
            relative = item.relative_to(source)
            if any(part in excluded_names or part.startswith(excluded_prefixes) for part in relative.parts):
                continue
            if name == ".env" or name.startswith(".env."):
                continue
            info = item.lstat()
            if not item.is_file() or item.is_symlink():
                raise ValueError("worker_source_contains_non_regular_file")
            total_bytes += info.st_size
            if len(file_list) >= max_files or total_bytes > max_total_bytes:
                raise ValueError("worker_source_archive_limit_exceeded")
            file_list.append(item)

    if not any(item.relative_to(source).as_posix() == "src/worker.mjs" for item in file_list):
        raise ValueError("worker_source_entrypoint_missing")
    fd, temp_name = tempfile.mkstemp(prefix="treseko-worker-update-", suffix=".tar.gz")
    os.close(fd)
    archive_path = Path(temp_name)
    digest = hashlib.sha256()
    try:
        with tarfile.open(archive_path, mode="w:gz", format=tarfile.PAX_FORMAT) as archive:
            for item in sorted(file_list):
                info = item.lstat()
                if not item.is_file() or item.is_symlink():
                    raise ValueError("worker_source_changed_during_archive")
                archive.add(item, arcname=item.relative_to(source).as_posix(), recursive=False)
        with archive_path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        return archive_path, digest.hexdigest()
    except Exception:
        archive_path.unlink(missing_ok=True)
        raise
