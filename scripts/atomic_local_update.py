#!/usr/bin/env python3
"""Update a local Compose installation as one recoverable release transaction.

The installer deliberately accepts downtime during an update.  It stops the
entire Compose project, snapshots every named volume, applies migrations and
starts the complete candidate project while the public entrypoint is down.
Any failure restores the old volumes and immutable image IDs before starting
the previous Compose model.  Backups are retained for operator recovery.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import shlex
import stat
import subprocess
import sys
import time
from typing import Any


class UpdateError(RuntimeError):
    pass


_IDENTIFIER = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")
_TRANSACTION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
_SERVICE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]*$")
_INFRASTRUCTURE_SERVICES = {"db", "redis", "migrator"}
_VERSION_PROBES = {"backend", "frontend", "engine", "automation-worker", "plugin-runner"}
_CANDIDATE_HEALTHCHECK_SERVICES = {"db", "redis", "backend", "engine", "frontend", "plugin-runner"}
_PLUGIN_RUNNER_HEALTHCHECK_MARKER = "Treseko managed Plugin Runner healthcheck"
_RELEASE_VERSION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$")
_RELEASE_CACHE_DIRS = {".venv", "venv", "node_modules", "dist", "__pycache__",
                       ".pytest_cache", ".mypy_cache", ".ruff_cache", "coverage",
                       "test-results", "playwright-report"}
_RELEASE_LOCAL_DIRS = {".git", ".treseko", ".treseko-local"}
_RELEASE_ENV_EXAMPLES = {
    ".env.production.example",
    "automation-worker/.env.example",
    "automation-worker/.env.production.example",
    "backend/.env.production.example",
    "engine/.env.production.example",
    "frontend/.env.example",
}
_SAFE_FAILURE_LINES = (
    re.compile(r"\b(?:error|failed|failure|unhealthy|unable|cannot|no such|not found|denied|"
               r"exit code|timed out|failed to solve)\b", re.IGNORECASE),
)


def _safe_failure_summary(output: str) -> str:
    """Keep only short Docker/build failure headers, never arbitrary logs/env."""
    safe = []
    for raw_line in output.splitlines():
        line = raw_line.strip()
        if any(pattern.search(line) for pattern in _SAFE_FAILURE_LINES):
            # Drop URL credentials and common inline secret assignments even
            # from daemon/build errors. Avoid persisting container log output.
            line = re.sub(r"(https?://)[^/@\s:]+:[^/@\s]+@", r"\1[redacted]@", line)
            line = re.sub(r"(?i)(password|passwd|token|secret|api[_-]?key)=([^\s,;]+)",
                          r"\1=[redacted]", line)
            line = re.sub(r"(?i)(postgres(?:ql)?\+?[^:\s]*://[^:/\s]+:)[^@/\s]+@", r"\1[redacted]@", line)
            safe.append(line[-500:])
    return " | ".join(safe[-3:])[:1200]


def _redact_known_text(output: str, secrets: list[str]) -> str:
    for secret in sorted(set(secrets), key=len, reverse=True):
        output = output.replace(secret, "[redacted]")
    output = re.sub(r"(?i)(https?://)[^/@\s:]+:[^/@\s]+@", r"\1[redacted]@", output)
    output = re.sub(r"(?i)(password|passwd|token|secret|api[_-]?key)=([^\s,;]+)",
                    r"\1=[redacted]", output)
    output = re.sub(r"(?i)(postgres(?:ql)?\+?[^:\s]*://[^:/\s]+:)[^@/\s]+@", r"\1[redacted]@", output)
    return output.strip()[-1600:]


class AtomicComposeUpdate:
    def __init__(self, *, docker: str, project: str, candidate_root: Path,
                 install_root: Path, env_file: Path, expected_version: str,
                 transaction_id: str | None = None,
                 expected_project_root: Path | None = None):
        self.docker = str(Path(docker).resolve())
        self.project = project
        self.candidate_root = candidate_root.resolve()
        self.install_root = install_root.resolve()
        self.env_file = env_file.resolve()
        self.expected_project_root = (expected_project_root.resolve()
                                      if expected_project_root is not None else None)
        self.expected_version = expected_version
        if not _RELEASE_VERSION.fullmatch(expected_version):
            raise UpdateError("Invalid release version for immutable project deployment")
        self.command_environment = os.environ.copy()
        self.command_environment["TRESEKO_RELEASE_VERSION"] = expected_version
        if (not Path(self.docker).is_absolute() or not _IDENTIFIER.fullmatch(project)
                or not expected_version or not self.env_file.is_file()
                or not (self.candidate_root / "docker-compose.prod.yml").is_file()
                or not (self.candidate_root / "VERSION").is_file()):
            raise UpdateError("Invalid local update target")
        if (self.candidate_root / "VERSION").read_text(encoding="utf-8").strip() != expected_version:
            raise UpdateError("Candidate release version does not match its VERSION file")
        self.journal_root = self.install_root / ".treseko-local" / "update-transactions"
        self.journal_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.release_root = self.install_root / ".treseko-local" / "releases"
        self.active_release_path = self.install_root / ".treseko-local" / "active-release.json"
        if transaction_id is not None and not _TRANSACTION.fullmatch(transaction_id):
            raise UpdateError("Invalid update transaction identifier")
        self.transaction = (transaction_id or
                            time.strftime("%Y%m%d%H%M%S", time.gmtime()) + "-" + os.urandom(4).hex())
        self.journal_path = self.journal_root / f"{self.transaction}.json"
        self.candidate_override = self.journal_root / f"{self.transaction}-atomic-candidate.compose.yml"
        self.preserved_compose_overrides: list[str] = []
        self.candidate_override.write_text(
            "services:\n"
            "  backend:\n    command: [\"atomic-serve\"]\n"
            "  frontend:\n    environment:\n      TRESEKO_ATOMIC_RUNTIME_SYNC: \"1\"\n"
            "  engine:\n    environment:\n      TRESEKO_ATOMIC_RUNTIME_SYNC: \"1\"\n"
            "  automation-worker:\n    environment:\n      TRESEKO_ATOMIC_RUNTIME_SYNC: \"1\"\n",
            encoding="utf-8",
        )
        try:
            self.candidate_override.chmod(0o600)
        except OSError:
            pass
        self.state: dict[str, Any] = {}

    @staticmethod
    def _healthcheck_enabled(service_config: Any) -> bool:
        healthcheck = service_config.get("healthcheck") if isinstance(service_config, dict) else None
        test = healthcheck.get("test") if isinstance(healthcheck, dict) else None
        return not (not isinstance(healthcheck, dict) or healthcheck.get("disable") is True
                    or not test or (isinstance(test, list) and str(test[0]).upper() == "NONE")
                    or (isinstance(test, str) and test.upper() == "NONE"))

    def _ensure_plugin_runner_healthcheck(self, candidate_model: dict[str, Any],
                                          target_services: list[str]) -> dict[str, Any]:
        """Supply a known HTTP healthcheck for older candidate Compose releases."""
        if "plugin-runner" not in target_services:
            return candidate_model
        services = candidate_model.get("services") or {}
        if self._healthcheck_enabled(services.get("plugin-runner")):
            return candidate_model
        try:
            override = self.candidate_override.read_text(encoding="utf-8")
            if _PLUGIN_RUNNER_HEALTHCHECK_MARKER not in override:
                addition = (
                    f"\n  # {_PLUGIN_RUNNER_HEALTHCHECK_MARKER}\n"
                    "  plugin-runner:\n"
                    "    healthcheck:\n"
                    "      disable: false\n"
                    "      test: [\"CMD\", \"node\", \"-e\", \"fetch('http://127.0.0.1:3020/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))\"]\n"
                    "      interval: 10s\n"
                    "      timeout: 3s\n"
                    "      retries: 6\n"
                )
                self.candidate_override.write_text(override.rstrip() + addition, encoding="utf-8")
                self.candidate_override.chmod(0o600)
        except OSError as exc:
            raise UpdateError("Could not prepare the Plugin Runner healthcheck override") from exc
        return self._compose_model(
            self.candidate_root,
            self._candidate_compose_files(),
            self.state.get("profiles", []), self.candidate_root)

    def _candidate_compose_files(self) -> list[str]:
        """Replace the release Compose file while retaining host-owned overrides."""
        return [str(self.candidate_root / "docker-compose.prod.yml"),
                *self.preserved_compose_overrides, str(self.candidate_override)]

    @staticmethod
    def _host_compose_overrides(old_workdir: Path, old_files: list[str]) -> list[str]:
        """Keep installation-specific Compose files after moving to an immutable release tree."""
        if not old_files:
            raise UpdateError("Existing installation has no Compose configuration files")
        old_base = Path(old_files[0]).resolve()
        if old_base.parent != old_workdir.resolve():
            raise UpdateError("Existing Compose base file is outside its project root")
        overrides: list[str] = []
        for raw_path in old_files[1:]:
            path = Path(raw_path)
            path_parts = path.parts
            is_transaction_artifact = any(
                path_parts[index:index + 2] == (".treseko-local", "update-transactions")
                for index in range(max(0, len(path_parts) - 1))
            ) and path.name.endswith(("-rollback.compose.yml", "-atomic-candidate.compose.yml"))
            if is_transaction_artifact:
                # These files are transaction artifacts, not host configuration.
                # Carrying them into a later update can pin services to old rollback
                # image tags and break the next candidate deployment.
                continue
            try:
                resolved = path.resolve(strict=True)
            except OSError as exc:
                raise UpdateError("A host-owned Compose override is missing") from exc
            if not resolved.is_file():
                raise UpdateError("A host-owned Compose override is not a regular file")
            overrides.append(str(resolved))
        return overrides

    def _release_ignored(self, directory: str, names: list[str]) -> set[str]:
        """Match the source-package exclusions for direct local installations."""
        current = Path(directory).resolve()
        candidate = self.candidate_root.resolve()
        ignored: set[str] = set()
        for name in names:
            path = current / name
            try:
                relative = path.relative_to(candidate).as_posix()
            except ValueError:
                relative = ""
            if (name in _RELEASE_LOCAL_DIRS or name in _RELEASE_CACHE_DIRS
                    or name in {".treseko-release.json", ".gitignore", ".runner-token",
                                ".worker-instance-id", ".runner-token.pairing",
                                ".maintenance", ".DS_Store"}
                    or name.startswith(("._", ".treseko-update-"))
                    or (name.startswith(".env") and relative not in _RELEASE_ENV_EXAMPLES)
                    or (not path.is_dir() and Path(name).suffix in {".pyc", ".pyo", ".log", ".jsonl"})):
                ignored.add(name)
        if current == candidate and "public-release" in names:
            ignored.add("public-release")
        if current == candidate and "compose.production.env" in names:
            ignored.add("compose.production.env")
        if current == candidate / "backend" / "app" and "static" in names:
            ignored.add("static")
        return ignored

    @staticmethod
    def _release_files(root: Path) -> list[Path]:
        files: list[Path] = []
        for current, dirs, names in os.walk(root, topdown=True, followlinks=False):
            current_path = Path(current)
            ignored_dirs = {name for name in dirs if name in _RELEASE_LOCAL_DIRS
                            or name in _RELEASE_CACHE_DIRS or name.startswith(".env")
                            or (current_path == root and name == "public-release")
                            or (current_path == root / "backend" / "app" and name == "static")}
            dirs[:] = [name for name in dirs if name not in ignored_dirs]
            if any((current_path / name).is_symlink() for name in dirs):
                raise UpdateError("Candidate project contains a symbolic link; refusing a non-portable release snapshot")
            dirs[:] = sorted(dirs)
            for name in sorted(names):
                try:
                    relative = (current_path / name).relative_to(root).as_posix()
                except ValueError:
                    relative = ""
                if (name in _RELEASE_LOCAL_DIRS or name in {
                        ".treseko-release.json", ".gitignore", ".runner-token",
                        ".worker-instance-id", ".runner-token.pairing", ".maintenance", ".DS_Store",
                    } or (current_path == root and name == "compose.production.env")
                        or name.startswith(("._", ".treseko-update-"))
                        or (name.startswith(".env") and relative not in _RELEASE_ENV_EXAMPLES)
                        or Path(name).suffix in {".pyc", ".pyo", ".log", ".jsonl"}):
                    continue
                path = current_path / name
                if path.is_symlink():
                    raise UpdateError("Candidate project contains a symbolic link; refusing a non-portable release snapshot")
                files.append(path)
        return sorted(files, key=lambda path: path.relative_to(root).as_posix())

    @staticmethod
    def _release_manifest(root: Path, version: str) -> dict[str, Any]:
        rows = []
        digest = hashlib.sha256()
        for path in AtomicComposeUpdate._release_files(root):
            relative = path.relative_to(root).as_posix()
            content_hash = hashlib.sha256()
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    content_hash.update(chunk)
            file_hash = content_hash.hexdigest()
            file_mode = stat.S_IMODE(path.stat().st_mode)
            rows.append({"path": relative, "sha256": file_hash, "mode": file_mode})
            digest.update(relative.encode("utf-8"))
            digest.update(b"\0")
            digest.update(bytes.fromhex(file_hash))
            digest.update(f"{file_mode:o}".encode("ascii"))
            digest.update(b"\0")
        return {"schema": 1, "version": version, "tree_sha256": digest.hexdigest(), "files": rows}

    @staticmethod
    def _release_version_key(value: str) -> tuple[Any, ...]:
        match = re.fullmatch(
            r"(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?", value
        )
        if not match:
            raise UpdateError("Active or candidate release version is not safely comparable")
        core = tuple(int(part) for part in match.group(1).split("."))
        core += (0,) * max(0, 4 - len(core))
        prerelease = match.group(2)
        identifiers: tuple[tuple[int, Any], ...] = ()
        if prerelease:
            identifiers = tuple(
                (0, int(item)) if item.isdigit() else (1, item.lower())
                for item in prerelease.split(".")
            )
        return core, 0 if prerelease else 1, identifiers

    def _active_release_version(self) -> str | None:
        """Read and verify the immutable release selected for this installation."""
        pointer_path = self.active_release_path
        if pointer_path.is_symlink():
            raise UpdateError("Active-release pointer cannot be a symbolic link")
        if not pointer_path.exists():
            return None
        try:
            pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
        except (OSError, ValueError, UnicodeError) as exc:
            raise UpdateError("Active-release pointer is unreadable") from exc
        if (not isinstance(pointer, dict) or set(pointer) != {
                "schema", "version", "release", "tree_sha256"}
                or pointer.get("schema") != 1
                or not isinstance(pointer.get("version"), str)
                or not isinstance(pointer.get("release"), str)
                or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.+_-]{0,100}", pointer["release"])
                or not re.fullmatch(r"[0-9a-f]{64}", str(pointer.get("tree_sha256") or ""))):
            raise UpdateError("Active-release pointer has an invalid contract")
        release_root = self.release_root
        if release_root.is_symlink():
            raise UpdateError("Immutable release directory cannot be a symbolic link")
        active_root = release_root / pointer["release"]
        if active_root.is_symlink() or not active_root.is_dir():
            raise UpdateError("Active immutable release directory is unavailable or unsafe")
        try:
            active_root.resolve(strict=True).relative_to(release_root.resolve(strict=True))
            stored = json.loads((active_root / ".treseko-release.json").read_text(encoding="utf-8"))
        except (OSError, ValueError, UnicodeError) as exc:
            raise UpdateError("Active immutable release manifest is unreadable") from exc
        version = pointer["version"]
        if ((active_root / "VERSION").read_text(encoding="utf-8").strip() != version
                or not isinstance(stored, dict)
                or stored.get("version") != version
                or stored.get("tree_sha256") != pointer["tree_sha256"]
                or not self._stored_release_manifest_matches(active_root, stored, version)):
            raise UpdateError("Active immutable release failed its file-integrity check")
        return version

    @classmethod
    def _stored_release_manifest_matches(
        cls, root: Path, stored: dict[str, Any], version: str
    ) -> bool:
        """Verify the exact recorded snapshot across release-filter revisions.

        Older complete-source releases included root `.gitignore` and a nested
        `public-release/` snapshot. New releases omit those paths. Their stored
        per-file hashes remain authoritative, so a newer updater verifies those
        recorded files while allowing only paths excluded by the current
        release filter to be absent from its current inventory.
        """
        rows = stored.get("files")
        if stored.get("schema") != 1 or not isinstance(rows, list):
            return False
        recorded: dict[str, dict[str, Any]] = {}
        digest = hashlib.sha256()
        previous_path = ""
        root = root.resolve(strict=True)
        for row in rows:
            if not isinstance(row, dict) or set(row) != {"path", "sha256", "mode"}:
                return False
            relative = row.get("path")
            checksum = row.get("sha256")
            mode = row.get("mode")
            if (not isinstance(relative, str) or not relative or relative <= previous_path
                    or not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{64}", checksum)
                    or not isinstance(mode, int) or mode < 0 or mode > 0o7777):
                return False
            previous_path = relative
            relative_path = Path(relative)
            if relative_path.is_absolute() or ".." in relative_path.parts:
                return False
            path = root
            for part in relative_path.parts:
                path = path / part
                if path.is_symlink():
                    return False
            try:
                path.resolve(strict=True).relative_to(root)
                if not path.is_file() or stat.S_IMODE(path.stat().st_mode) != mode:
                    return False
                content_hash = hashlib.sha256()
                with path.open("rb") as handle:
                    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                        content_hash.update(chunk)
            except (OSError, ValueError):
                return False
            if content_hash.hexdigest() != checksum:
                return False
            digest.update(relative.encode("utf-8"))
            digest.update(b"\0")
            digest.update(bytes.fromhex(checksum))
            digest.update(f"{mode:o}".encode("ascii"))
            digest.update(b"\0")
            recorded[relative] = row

        if digest.hexdigest() != stored.get("tree_sha256"):
            return False
        current_paths = {
            path.relative_to(root).as_posix() for path in cls._release_files(root)
        }
        recorded_paths = set(recorded)
        if current_paths - recorded_paths:
            return False
        newly_excluded = recorded_paths - current_paths
        legacy_local_state = {
            "automation-worker/.runner-token",
            "automation-worker/.runner-token.pairing",
            "automation-worker/.worker-instance-id",
            "automation-worker/.maintenance",
        }
        return all(
            path == ".gitignore"
            or path.startswith("public-release/")
            or path in legacy_local_state
            for path in newly_excluded
        )

    def _assert_not_downgrade(self) -> None:
        active_version = self._active_release_version()
        if active_version is None or active_version == self.expected_version:
            return
        if self._release_version_key(self.expected_version) < self._release_version_key(active_version):
            raise UpdateError(
                f"Candidate Treseko {self.expected_version} is older than active release {active_version}; "
                "download the current or a newer release before updating"
            )

    @staticmethod
    def _write_atomic_json(path: Path, value: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = path.with_name(f".{path.name}.{os.urandom(6).hex()}.tmp")
        temporary.write_text(json.dumps(value, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        try:
            temporary.chmod(0o600)
        except OSError:
            pass
        with temporary.open("r+b") as handle:
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        if os.name != "nt":
            try:
                directory_fd = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
            except OSError:
                pass

    def _prepare_project_release(self) -> Path:
        """Copy the complete candidate into an immutable, verified release dir."""
        source = self.candidate_root.resolve()
        if not source.is_dir():
            raise UpdateError("Candidate project directory is unavailable")
        source_manifest = self._release_manifest(source, self.expected_version)
        release_name = f"{self.expected_version}-{source_manifest['tree_sha256'][:16]}"
        target = self.release_root / release_name
        if self.release_root.is_symlink() or target.is_symlink():
            raise UpdateError("Immutable project release paths cannot be symbolic links")
        if source == target.resolve(strict=False):
            manifest_path = source / ".treseko-release.json"
            try:
                stored = json.loads(manifest_path.read_text(encoding="utf-8"))
            except (OSError, ValueError) as exc:
                raise UpdateError("Active project release manifest is missing or unreadable") from exc
            if stored != source_manifest:
                raise UpdateError("Active project release failed its file-integrity check")
            return source
        if target.exists():
            try:
                stored = json.loads((target / ".treseko-release.json").read_text(encoding="utf-8"))
            except (OSError, ValueError) as exc:
                raise UpdateError("A conflicting immutable project release already exists") from exc
            if stored != source_manifest:
                raise UpdateError("Existing immutable project release does not match the candidate files")
            return target

        self.release_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        staging = self.release_root / f".{release_name}.{self.transaction}.staging"
        if staging.exists():
            raise UpdateError("A staging directory for this update transaction already exists")
        try:
            shutil.copytree(source, staging, ignore=self._release_ignored, symlinks=False)
            staged_manifest = self._release_manifest(staging, self.expected_version)
            if staged_manifest != source_manifest:
                raise UpdateError("Staged project files differ from the validated candidate")
            self._write_atomic_json(staging / ".treseko-release.json", staged_manifest)
            os.replace(staging, target)
        except Exception:
            if staging.exists():
                shutil.rmtree(staging)
            raise
        return target

    @contextmanager
    def _installation_lock(self):
        lock_path = self.install_root / ".treseko-local" / "update.lock"
        lock_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if lock_path.is_symlink():
            raise UpdateError("Installation update lock cannot be a symbolic link")
        handle = lock_path.open("a+b")
        locked = False
        try:
            handle.seek(0, os.SEEK_END)
            if handle.tell() == 0:
                handle.write(b"\0")
                handle.flush()
            handle.seek(0)
            try:
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                locked = True
            except (OSError, BlockingIOError) as exc:
                raise UpdateError("Another update transaction already owns this installation") from exc
            handle.seek(0)
            handle.truncate()
            handle.write(f"pid={os.getpid()} transaction={self.transaction}\n".encode("ascii"))
            handle.flush()
            yield
        finally:
            if locked:
                try:
                    handle.seek(0)
                    if os.name == "nt":
                        import msvcrt
                        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                    else:
                        import fcntl
                        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
                except OSError:
                    pass
            handle.close()

    def _activate_project_release(self) -> None:
        release = self.candidate_root.resolve()
        try:
            relative = release.relative_to(self.release_root.resolve())
        except ValueError as exc:
            raise UpdateError("Candidate project release is outside the managed immutable release store") from exc
        manifest_path = release / ".treseko-release.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("version") != self.expected_version:
            raise UpdateError("Candidate project release version changed before activation")
        if self._release_manifest(release, self.expected_version) != manifest:
            raise UpdateError("Candidate project files changed before activation")
        self._write_atomic_json(self.active_release_path, {
            "schema": 1, "version": self.expected_version,
            "release": relative.as_posix(), "tree_sha256": manifest["tree_sha256"],
        })

    def _known_secret_values(self) -> list[str]:
        values = []
        secret_dir = self.install_root / ".treseko-local" / "secrets"
        if secret_dir.is_dir():
            for path in secret_dir.iterdir():
                if path.is_file():
                    try:
                        value = path.read_text(encoding="utf-8").strip()
                        if len(value) >= 4:
                            values.append(value)
                    except OSError:
                        pass
        if self.env_file.is_file():
            try:
                for line in self.env_file.read_text(encoding="utf-8").splitlines():
                    if "=" in line:
                        key, value = line.split("=", 1)
                        if re.search(r"password|passwd|token|secret|credential|api[_-]?key", key, re.I):
                            if len(value) >= 4:
                                values.append(value)
            except OSError:
                pass
        return values

    def _recover_interrupted_transaction(self) -> None:
        recoverable = {"stopping_old_project", "snapshot_complete", "candidate_database_starting",
                       "migration_started", "candidate_services_starting", "rolling_back",
                       "recovery_required"}
        terminal = {"committed", "rolled_back", "candidate_rejected", "abandoned_before_mutation"}
        pending = []
        for path in sorted(self.journal_root.glob("*.json")):
            try:
                value = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError) as exc:
                raise UpdateError("An update journal is unreadable; refusing to start another update") from exc
            phase = value.get("phase") if isinstance(value, dict) else None
            if phase in recoverable or phase == "release_pending":
                pending.append((path, value))
            elif phase not in terminal:
                # Candidate build and immutable-image probes run before the
                # old stack is stopped. Their incomplete journals are safe to
                # close without touching the installation.
                if phase == "preparing":
                    value["phase"] = "abandoned_before_mutation"
                    self._write_atomic_json(path, value)
                else:
                    raise UpdateError("An update journal has an unknown phase; refusing to guess recovery")
        if len(pending) > 1:
            raise UpdateError("Multiple interrupted updates require operator review")
        if not pending:
            return
        path, state = pending[0]
        candidate = Path(state.get("candidate_root", ""))
        if not candidate.is_absolute() or not (candidate / "docker-compose.prod.yml").is_file():
            raise UpdateError(f"Interrupted update source is unavailable; recovery journal: {path}")
        self.transaction = state["transaction"]
        self.journal_path = path
        self.candidate_root = candidate
        self.expected_version = state["version"]
        self.state = state
        print(f"Recovering interrupted transaction {self.transaction} before any new update...", file=sys.stderr)
        if state["phase"] == "release_pending":
            # All candidate services were already verified with ingress
            # fenced. Once release may have happened, never restore the old
            # database over writes accepted by the candidate.
            self._ensure_maintenance_marker()
            self._verify_candidate()
            self._activate_project_release()
            self._remove_maintenance_marker()
            self.state["phase"] = "committed"
            self._save()
        else:
            self._rollback()

    def _run(self, args: list[str], *, capture: bool = True, timeout: int = 1800) -> str:
        try:
            result = subprocess.run(args, text=True, capture_output=capture, timeout=timeout,
                                    check=False, env=self.command_environment)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise UpdateError(f"Command outcome uncertain: {Path(args[0]).name} {shlex.join(args[1:3])}") from exc
        if result.returncode:
            raw = (result.stderr or result.stdout or "") if capture else ""
            detail = _redact_known_text(raw, self._known_secret_values())
            raise UpdateError(f"Command failed ({Path(args[0]).name} {shlex.join(args[1:3])}, exit {result.returncode})"
                              + (f": {detail}" if detail else ""))
        return result.stdout if capture else ""

    def _docker(self, *args: str, capture: bool = True, timeout: int = 1800) -> str:
        return self._run([self.docker, *args], capture=capture, timeout=timeout)

    def _compose(self, root: Path, files: list[str], profiles: list[str], *args: str,
                 env_file: Path | None = None, project_directory: Path | None = None,
                 capture: bool = True, timeout: int = 1800) -> str:
        command = [self.docker, "compose", "--progress", "plain", "--project-name", self.project,
                   "--project-directory", str(project_directory or root)]
        for profile in profiles:
            command += ["--profile", profile]
        for filename in files:
            command += ["--file", filename]
        command += ["--env-file", str(env_file or self.env_file), *args]
        return self._run(command, capture=capture, timeout=timeout)

    def _save(self) -> None:
        self._write_atomic_json(self.journal_path, self.state)

    def _compose_model(self, root: Path, files: list[str], profiles: list[str],
                       project_directory: Path) -> dict[str, Any]:
        raw = self._compose(root, files, profiles, "config", "--format", "json",
                            project_directory=project_directory)
        try:
            model = json.loads(raw)
        except ValueError as exc:
            raise UpdateError("Compose did not return a valid project model") from exc
        if not isinstance(model.get("services"), dict) or not model["services"]:
            raise UpdateError("Compose project has no services")
        return model

    def _running_inventory(self) -> tuple[list[dict[str, Any]], list[str], Path, list[str], dict[str, Any]]:
        ids = self._docker("ps", "--all", "--no-trunc", "--format", "{{.ID}}",
                           "--filter", f"label=com.docker.compose.project={self.project}").split()
        if not ids:
            raise UpdateError("No existing Compose containers were found for the installation")
        records = json.loads(self._docker("inspect", "--type", "container", *ids))
        if len(records) != len(ids):
            raise UpdateError("Existing Compose container inventory is incomplete")
        by_service: dict[str, list[dict[str, Any]]] = {}
        for record in records:
            labels = (record.get("Config", {}).get("Labels") or {})
            if labels.get("com.docker.compose.project") != self.project:
                raise UpdateError("A container no longer matches the existing Compose project")
            service = labels.get("com.docker.compose.service", "")
            if service == "migrator":
                state = record.get("State", {})
                if state.get("Status") == "exited" and state.get("ExitCode") == 0:
                    # Compose keeps this successful one-shot dependency as an
                    # exited container after initial install. Its image is
                    # still captured from the old Compose dependency model.
                    continue
                raise UpdateError("Existing migrator is not in its expected successful one-shot state")
            if not _SERVICE.fullmatch(service) or labels.get("com.docker.compose.oneoff") == "True":
                continue
            by_service.setdefault(service, []).append(record)
        if any(len(items) != 1 for items in by_service.values()):
            raise UpdateError("Local atomic update supports exactly one container per service")
        records = [items[0] for items in by_service.values()]
        if not records:
            raise UpdateError("No managed service containers were identified")
        required_healthy = {"db", "redis", "backend", "engine", "frontend"}
        for record in records:
            service = record["Config"]["Labels"].get("com.docker.compose.service")
            state = record.get("State", {})
            if not state.get("Running"):
                raise UpdateError(f"Existing service {service} is not running; refusing to update an unhealthy baseline")
            health = state.get("Health", {}).get("Status")
            if service in required_healthy and health != "healthy":
                raise UpdateError(f"Existing service {service} has no confirmed healthy baseline")
            if service == "plugin-runner":
                self._verify_plugin_runner_baseline(record, health)
        working_dirs = {r["Config"]["Labels"].get("com.docker.compose.project.working_dir") for r in records}
        config_files = {r["Config"]["Labels"].get("com.docker.compose.project.config_files") for r in records}
        if len(working_dirs) != 1 or len(config_files) != 1:
            raise UpdateError("Existing Compose source identity is ambiguous")
        workdir = Path(next(iter(working_dirs)) or "")
        raw_files = next(iter(config_files)) or ""
        files = [value for value in raw_files.split(",") if value]
        transaction_root = self.journal_root.resolve()
        files = [value for value in files
                 if not (Path(value).parent.resolve() == transaction_root
                         and re.fullmatch(r"\d{14}-[a-f0-9]{8}-(?:rollback|atomic-candidate)\.compose\.yml",
                                          Path(value).name))]
        if not workdir.is_absolute() or not files or not all(Path(value).is_absolute() for value in files):
            raise UpdateError("Existing Compose file paths are unavailable for rollback")
        # Compose service profiles are preserved only when they were active
        # before the update. New candidate services in those profiles follow.
        active = {r["Config"]["Labels"].get("com.docker.compose.service") for r in records}
        # These are the currently supported optional installer profiles.
        # Detect them from actual running services, not from cached shell state.
        profiles = sorted(profile for service, profile in
                          (("automation-worker", "automation"), ("plugin-runner", "plugins"))
                          if service in active)
        old_model = self._compose_model(workdir, files, profiles, workdir)
        if not active <= set(old_model["services"]):
            raise UpdateError("Running services are not defined by their recorded Compose model")
        return records, profiles, workdir, files, old_model

    def _probe_plugin_runner_http(self, record: dict[str, Any], *, context: str) -> None:
        container_id = str(record.get("Id") or "").strip()
        if not container_id:
            raise UpdateError(f"{context} plugin-runner has no container identity for its health probe")
        probe = (
            "fetch('http://127.0.0.1:3020/health')"
            ".then(response => process.exit(response.ok ? 0 : 1))"
            ".catch(() => process.exit(1))"
        )
        try:
            self._docker("exec", container_id, "node", "-e", probe, timeout=10)
        except UpdateError as exc:
            raise UpdateError(f"{context} plugin-runner HTTP health probe failed") from exc

    def _verify_plugin_runner_baseline(self, record: dict[str, Any], health: str | None) -> None:
        if health == "healthy":
            return
        if health not in (None, ""):
            raise UpdateError("Existing plugin-runner has no confirmed healthy baseline")
        self._probe_plugin_runner_http(record, context="Existing")

    def _tag_old_images(self, records: list[dict[str, Any]], old_model: dict[str, Any]) -> dict[str, str]:
        images: dict[str, str] = {}
        record_images = {r["Config"]["Labels"]["com.docker.compose.service"]: r["Image"] for r in records}
        required = set(record_images)
        services = old_model["services"]
        pending = list(required)
        while pending:
            service = pending.pop()
            dependencies = services.get(service, {}).get("depends_on", {})
            dependencies = dependencies.keys() if isinstance(dependencies, dict) else dependencies
            for dependency in dependencies or []:
                if dependency not in required:
                    required.add(dependency)
                    pending.append(dependency)
        for record in records:
            service = record["Config"]["Labels"]["com.docker.compose.service"]
            tag = f"treseko-rollback:{self.transaction[:20]}-{service}"
            self._docker("image", "tag", record["Image"], tag)
            images[service] = tag
        for service in sorted(required - set(images)):
            if not _SERVICE.fullmatch(service) or service not in services:
                raise UpdateError("Old Compose dependency inventory is invalid")
            image_ref = services[service].get("image") or f"{self.project}-{service}"
            image_id = self._docker("image", "inspect", "--format", "{{.Id}}", image_ref).strip()
            if not re.fullmatch(r"sha256:[a-f0-9]{64}", image_id):
                raise UpdateError("An old Compose dependency image is unavailable for rollback")
            tag = f"treseko-rollback:{self.transaction[:20]}-{service}"
            self._docker("image", "tag", image_id, tag)
            images[service] = tag
        return images

    def _named_volumes(self, records: list[dict[str, Any]]) -> list[str]:
        names = set()
        for record in records:
            for mount in record.get("Mounts", []):
                if mount.get("Type") == "volume" and isinstance(mount.get("Name"), str):
                    names.add(mount["Name"])
        return sorted(names)

    def _stop_legacy_frontend(self, records: list[dict[str, Any]]) -> None:
        """Use TERM for old nginx wrappers whose image stop signal is QUIT.

        The 1.0.6 nginx image sends SIGQUIT to its shell entrypoint, which does
        not forward that signal to nginx. Stop that legacy container with TERM
        first; the existing entrypoint traps TERM and shuts down nginx. Newer
        entrypoints forward either signal, while other services keep their
        Compose-configured stop behavior.
        """
        frontend = next((record for record in records
                         if record.get("Config", {}).get("Labels", {}).get(
                             "com.docker.compose.service") == "frontend"), None)
        if not frontend or not frontend.get("State", {}).get("Running"):
            return
        stop_signal = str(frontend.get("Config", {}).get("StopSignal") or "").upper()
        if stop_signal not in {"SIGQUIT", "QUIT", "3"}:
            return
        container_id = frontend.get("Id")
        if not isinstance(container_id, str) or not re.fullmatch(r"[a-f0-9]{12,64}", container_id):
            raise UpdateError("Legacy frontend container identity is invalid")
        # `docker stop --signal` is not available in the Docker CLI shipped by
        # the trusted helper image (Docker 20.10). Send TERM through `docker
        # kill`, which supports an explicit signal in that CLI, then wait for
        # the legacy entrypoint to finish before Compose applies its default
        # stop signal.
        self._docker("kill", "--signal", "SIGTERM", container_id, timeout=30)
        self._docker("wait", container_id, timeout=30)

    def _snapshot_volumes(self, volumes: list[str], helper_image: str) -> dict[str, str]:
        backups: dict[str, str] = {}
        for index, source in enumerate(volumes):
            digest = hashlib.sha256(source.encode()).hexdigest()[:12]
            backup = f"{self.project}_treseko_backup_{self.transaction[:12]}_{index}_{digest}"
            self._docker("volume", "create", "--label", f"io.treseko.update.transaction={self.transaction}", backup)
            self._docker("run", "--rm", "--network", "none",
                         "--mount", f"type=volume,src={source},dst=/source,readonly",
                         "--mount", f"type=volume,src={backup},dst=/backup",
                         "--entrypoint", "sh", helper_image, "-ec",
                         "tar -C /source -cf /backup/data.tar . && sync")
            proof = self._docker("run", "--rm", "--network", "none",
                                 "--mount", f"type=volume,src={backup},dst=/backup,readonly",
                                 "--entrypoint", "sh", helper_image, "-ec",
                                 "test -s /backup/data.tar && tar -tf /backup/data.tar >/dev/null")
            del proof
            backups[source] = backup
            self.state["volume_backups"] = backups
            self._save()
        return backups

    def _frontend_volume(self, records: list[dict[str, Any]]) -> str:
        frontend = [record for record in records
                    if record["Config"]["Labels"].get("com.docker.compose.service") == "frontend"]
        mounts = [mount for record in frontend for mount in record.get("Mounts", [])
                  if mount.get("Destination") == "/usr/share/nginx/html" and mount.get("Type") == "volume"]
        if len(frontend) != 1 or len(mounts) != 1 or not mounts[0].get("Name"):
            raise UpdateError("Frontend runtime volume is not uniquely identifiable for the admission fence")
        return mounts[0]["Name"]

    def _assert_no_existing_maintenance(self, volume: str, helper_image: str) -> None:
        self._docker("run", "--rm", "--network", "none",
                     "--mount", f"type=volume,src={volume},dst=/html,readonly",
                     "--entrypoint", "sh", helper_image, "-ec",
                     "test ! -e /html/.maintenance")

    def _write_maintenance_marker(self, volume: str, helper_image: str) -> None:
        self._docker("run", "--rm", "--network", "none",
                     "--mount", f"type=volume,src={volume},dst=/html",
                     "--entrypoint", "sh", helper_image, "-ec",
                     "set -C; printf '%s\\n' \"$1\" > /html/.maintenance && sync",
                     "treseko-fence", self.transaction)

    def _ensure_maintenance_marker(self) -> None:
        volume = self.state.get("frontend_volume")
        helper_image = self.state.get("snapshot_image")
        if not isinstance(volume, str) or not isinstance(helper_image, str):
            raise UpdateError("Maintenance fence recovery inventory is incomplete")
        self._docker("run", "--rm", "--network", "none",
                     "--mount", f"type=volume,src={volume},dst=/html",
                     "--entrypoint", "sh", helper_image, "-ec",
                     "if [ -e /html/.maintenance ]; then "
                     "[ ! -L /html/.maintenance ] && [ \"$(cat /html/.maintenance)\" = \"$1\" ]; "
                     "else set -C; printf '%s\\n' \"$1\" > /html/.maintenance; fi; sync",
                     "treseko-fence", self.transaction)

    def _remove_maintenance_marker(self) -> None:
        volume = self.state.get("frontend_volume")
        helper_image = self.state.get("snapshot_image")
        if not isinstance(volume, str) or not isinstance(helper_image, str):
            raise UpdateError("Maintenance fence recovery inventory is incomplete")
        self._docker("run", "--rm", "--network", "none",
                     "--mount", f"type=volume,src={volume},dst=/html",
                     "--entrypoint", "sh", helper_image, "-ec",
                     "if [ -e /html/.maintenance ]; then "
                     "[ ! -L /html/.maintenance ] && [ \"$(cat /html/.maintenance)\" = \"$1\" ] "
                     "&& rm /html/.maintenance; fi; sync", "treseko-release", self.transaction)

    def _assert_fence_enforced(self) -> None:
        check = ("import urllib.error,urllib.request; "
                 "u='http://frontend:80/__treseko_update_gate_probe__'; "
                 "r=None; "
                 "\ntry:\n r=urllib.request.urlopen(u,timeout=5); code=r.status\n"
                 "except urllib.error.HTTPError as e:\n code=e.code\n"
                 "if code!=503:\n "
                 "print(f'Maintenance fence returned HTTP {code}; expected 503', file=__import__('sys').stderr); "
                 "raise SystemExit(31)")
        self._compose_candidate("exec", "-T", "backend", "python", "-c", check, timeout=30)

    def _rollback_override(self, tags: dict[str, str]) -> Path:
        path = self.journal_root / f"{self.transaction}-rollback.compose.yml"
        lines = ["services:"]
        for service, image in sorted(tags.items()):
            if not _SERVICE.fullmatch(service):
                raise UpdateError("Unsafe Compose service name in rollback inventory")
            lines += [f"  {service}:", f"    image: {image}", "    pull_policy: never"]
            if service == "migrator":
                # Rollback restores the old database snapshot; rerunning an
                # old migration here is both unnecessary and unsafe. The
                # service remains a successful one-shot dependency only.
                lines += ["    entrypoint: [\"/bin/true\"]", "    command: []"]
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        try:
            path.chmod(0o600)
        except OSError:
            pass
        return path

    def _restore_volumes(self, backups: dict[str, str], helper_image: str) -> None:
        for source, backup in backups.items():
            self._docker("volume", "inspect", source)
            self._docker("volume", "inspect", backup)
            self._docker("run", "--rm", "--network", "none",
                         "--mount", f"type=volume,src={source},dst=/target",
                         "--mount", f"type=volume,src={backup},dst=/backup,readonly",
                         "--entrypoint", "sh", helper_image, "-ec",
                         "find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} \\;; "
                         "tar -C /target -xf /backup/data.tar && sync")

    def _assert_version(self, service: str, command: list[str], expected: str) -> None:
        actual = self._compose(self.candidate_root, [str(self.candidate_root / "docker-compose.prod.yml")],
                               self.state["profiles"], "exec", "-T", service, *command).strip()
        if service == "frontend":
            try:
                actual = str(json.loads(actual).get("version") or "").strip()
            except ValueError as exc:
                raise UpdateError("Frontend version metadata is invalid") from exc
        if actual != expected:
            raise UpdateError(f"{service} version mismatch: expected {expected}, got {actual or 'empty'}")

    def _verify_candidate(self) -> None:
        self._assert_version("backend", ["cat", "/VERSION"], self.expected_version)
        self._assert_version("engine", ["node", "-p", "require('/engine/package.json').version"], self.expected_version)
        self._assert_version("frontend", ["cat", "/usr/share/nginx/html/version.json"], self.expected_version)
        services = ["backend", "frontend", "engine"]
        if "automation-worker" in self.state["active_services"]:
            services.append("automation-worker")
        if "plugin-runner" in self.state["active_services"]:
            services.append("plugin-runner")
        for service in services:
            self._assert_running_image_matches_candidate(service)
        self._assert_component_digest(
            "frontend", "/opt/treseko/frontend-dist", "/usr/share/nginx/html")
        self._assert_component_digest("engine", "/opt/treseko/engine-source", "/engine")
        if "automation-worker" in self.state["active_services"]:
            self._assert_version("automation-worker", ["node", "-p", "require('/worker/package.json').version"],
                                 self.expected_version)
            self._assert_component_digest("automation-worker", "/opt/treseko/worker-source", "/worker")
        if "plugin-runner" in self.state["active_services"]:
            self._assert_version("plugin-runner", ["cat", "/TRESEKO_RELEASE_VERSION"], self.expected_version)
        self._assert_database_at_candidate_heads()

    def _assert_running_image_matches_candidate(self, service: str) -> None:
        container_id = self._compose_candidate("ps", "-q", service).strip()
        if not re.fullmatch(r"[a-f0-9]{12,64}", container_id):
            raise UpdateError(f"Candidate container identity is missing for {service}")
        running_image = self._docker("inspect", "--format", "{{.Image}}", container_id).strip()
        candidate_image = self._docker(
            "image", "inspect", "--format", "{{.Id}}", f"{self.project}-{service}").strip()
        if (not re.fullmatch(r"sha256:[a-f0-9]{64}", running_image)
                or running_image != candidate_image):
            raise UpdateError(f"Running {service} image does not match the built release candidate")

    def _assert_database_at_candidate_heads(self) -> None:
        heads = self._compose_candidate("exec", "-T", "backend", "alembic", "heads")
        current = self._compose_candidate("exec", "-T", "backend", "alembic", "current")
        revision_pattern = re.compile(r"(?m)^([A-Za-z0-9_-]+)(?:\s+\(head\))?\s*$")
        expected = set(revision_pattern.findall(heads))
        actual = set(revision_pattern.findall(current))
        if not expected or actual != expected:
            raise UpdateError("Database migration revision does not match every candidate Alembic head")

    def _assert_component_digest(self, service: str, image_source: str, runtime_source: str) -> None:
        command = ["sh", "-ec",
                   f"expected=$(cat '{image_source}/.treseko-content-digest'); "
                   f"image=$(/usr/local/bin/treseko-hash-component-tree '{image_source}'); "
                   f"runtime=$(/usr/local/bin/treseko-hash-component-tree '{runtime_source}'); "
                   "test -n \"$expected\" && test \"$expected\" = \"$image\" "
                   "&& test \"$image\" = \"$runtime\" "
                   "|| { echo component-content-digest-mismatch >&2; exit 1; }"]
        try:
            self._compose(self.candidate_root, [str(self.candidate_root / "docker-compose.prod.yml")],
                          self.state["profiles"], "exec", "-T", service, *command)
        except UpdateError as exc:
            raise UpdateError(f"{service} runtime content differs from its candidate image") from exc

    def _candidate_start_snapshot(self) -> list[dict[str, str]]:
        """Capture only Docker state (never app logs) before startup rollback."""
        ids = self._docker("ps", "--all", "--no-trunc", "--format", "{{.ID}}",
                           "--filter", f"label=com.docker.compose.project={self.project}").split()
        if not ids:
            return [{"diagnostic": "candidate containers are absent"}]
        result: list[dict[str, str]] = []
        for record in json.loads(self._docker("inspect", "--type", "container", *ids)):
            labels = record.get("Config", {}).get("Labels") or {}
            state = record.get("State") or {}
            health = state.get("Health") or {}
            service = labels.get("com.docker.compose.service", "unknown")
            status = str(state.get("Status") or "unknown")
            health_status = str(health.get("Status") or "not-configured")
            restart_count = int(record.get("RestartCount") or 0)
            if service == "migrator" and status == "exited" and state.get("ExitCode") == 0:
                # The migrator is a successful one-shot dependency. Its image
                # has a long-running process healthcheck, so Docker may mark
                # the stopped job unhealthy even though the migration exited
                # successfully. Compose --wait incorrectly treats that as an
                # application service failure.
                continue
            if (not state.get("Running") or health_status not in {"healthy", "not-configured"}
                    or restart_count > 0):
                item = {"service": service, "status": status,
                        "exit_code": str(state.get("ExitCode", "")),
                        "health": health_status, "restart_count": str(restart_count)}
                error = _redact_known_text(str(state.get("Error") or ""), self._known_secret_values())
                if error:
                    item["docker_error"] = error[:300]
                checks = health.get("Log") or []
                if checks:
                    last = checks[-1]
                    item["health_exit_code"] = str(last.get("ExitCode", ""))
                    output = _redact_known_text(str(last.get("Output") or ""), self._known_secret_values())
                    if output:
                        item["health_output"] = output[-300:]
                result.append(item)
        return result or [{"diagnostic": "all candidate containers were running and healthchecks passed"}]

    def _wait_candidate_services_healthy(self, services: list[str], timeout: int = 300) -> None:
        expected = set(services)
        deadline = time.monotonic() + timeout
        last_states: dict[str, tuple[str, str]] = {}
        while True:
            ids = self._docker("ps", "--all", "--no-trunc", "--format", "{{.ID}}",
                               "--filter", f"label=com.docker.compose.project={self.project}").split()
            records = json.loads(self._docker("inspect", "--type", "container", *ids)) if ids else []
            states: dict[str, tuple[str, str, dict[str, Any]]] = {}
            for record in records:
                labels = record.get("Config", {}).get("Labels") or {}
                service = labels.get("com.docker.compose.service")
                if service not in expected:
                    continue
                state = record.get("State") or {}
                health = state.get("Health") or {}
                states[service] = ("running" if state.get("Running") else str(state.get("Status") or "missing"),
                                   str(health.get("Status") or "not-configured"), record)
            last_states = {service: (status, health) for service, (status, health, _) in states.items()}
            for service, (status, health, record) in states.items():
                if status != "running":
                    raise UpdateError(f"Candidate service {service} did not remain running ({status})")
                if health == "unhealthy":
                    raise UpdateError(f"Candidate service {service} healthcheck failed")
                if service in _CANDIDATE_HEALTHCHECK_SERVICES \
                        and health == "not-configured":
                    if service == "plugin-runner":
                        self._probe_plugin_runner_http(record, context="Candidate")
                    else:
                        raise UpdateError(f"Candidate service {service} has no configured healthcheck")
            if set(states) == expected and all(health in {"healthy", "not-configured"}
                                               for _, health, _ in states.values()):
                return
            if time.monotonic() >= deadline:
                waiting = sorted(service for service in expected
                                 if service not in states or states[service][1] == "starting")
                raise UpdateError("Candidate healthcheck timeout; still waiting: " + ", ".join(waiting))
            time.sleep(2)

    def _compose_candidate(self, *args: str, timeout: int = 1800) -> str:
        return self._compose(self.candidate_root, self._candidate_compose_files(),
                             self.state["profiles"], *args, project_directory=self.candidate_root,
                             timeout=timeout)

    @staticmethod
    def _candidate_services_to_start(candidate_model: dict[str, Any], profiles: list[str]) -> list[str]:
        """Select default services plus explicitly enabled optional profiles.

        Compose config includes profiled services even when their profile is
        disabled. Naming one explicitly in `compose up` bypasses that profile
        gate, so never start every service in the rendered model blindly.
        """
        services = candidate_model.get("services")
        if not isinstance(services, dict) or not services:
            raise UpdateError("Candidate Compose release has no persistent services")
        enabled_profiles = set(profiles)
        selected: list[str] = []
        for name, config in services.items():
            if name == "migrator":
                continue
            if not isinstance(config, dict):
                raise UpdateError(f"Candidate Compose service {name} is invalid")
            raw_profiles = config.get("profiles") or []
            if isinstance(raw_profiles, str):
                raw_profiles = [raw_profiles]
            if (not isinstance(raw_profiles, list)
                    or any(not isinstance(profile, str) or not profile for profile in raw_profiles)):
                raise UpdateError(f"Candidate Compose service {name} has invalid profile declarations")
            if raw_profiles and not enabled_profiles.intersection(raw_profiles):
                continue
            if name not in _INFRASTRUCTURE_SERVICES and name not in _VERSION_PROBES:
                raise UpdateError(f"Candidate service {name} has no release-version probe")
            selected.append(name)
        required = {"db", "redis", "backend", "engine", "frontend"}
        if not required.issubset(selected):
            raise UpdateError("Candidate Compose release is missing a required active service")
        return sorted(selected)

    @staticmethod
    def _validate_candidate_healthchecks(candidate_model: dict[str, Any],
                                         target_services: list[str]) -> None:
        """Reject missing runtime healthchecks before stopping the active release."""
        services = candidate_model.get("services") or {}
        for service in sorted(_CANDIDATE_HEALTHCHECK_SERVICES & set(target_services)):
            if not AtomicComposeUpdate._healthcheck_enabled(services.get(service)):
                raise UpdateError(f"Candidate service {service} has no enabled healthcheck")

    def _assert_baseline_unchanged(self) -> None:
        records, profiles, workdir, files, _ = self._running_inventory()
        current = {r["Config"]["Labels"]["com.docker.compose.service"]: [r["Id"], r["Image"]]
                   for r in records}
        changes = []
        if profiles != self.state["profiles"]:
            changes.append("profiles")
        if str(workdir) != self.state["old_working_dir"]:
            changes.append("working directory")
        if files != self.state["old_compose_files"]:
            changes.append("Compose files")
        if current != self.state["old_containers"]:
            changes.append("container/image identities")
        if changes:
            raise UpdateError("Existing installation changed or became unhealthy while candidate images were building: "
                              + ", ".join(changes))

    def _rollback(self) -> None:
        self.state["phase"] = "rolling_back"
        self._save()
        try:
            self._compose_candidate("down", "--remove-orphans", timeout=300)
        except UpdateError:
            # It may already be down; volume and old-image inventories below
            # remain authoritative, and old Compose up reconciles containers.
            pass
        self._restore_volumes(self.state["volume_backups"], self.state["snapshot_image"])
        override = self._rollback_override(self.state["old_images"])
        files = [*self.state["old_compose_files"], str(override)]
        services = self.state["old_active_services"]
        self._compose(Path(self.state["old_working_dir"]), files, self.state["profiles"],
                      "up", "-d", "--wait", "--wait-timeout", "240", *services,
                      env_file=self.env_file, project_directory=Path(self.state["old_working_dir"]), timeout=600)
        self.state["phase"] = "rolled_back"
        self._save()

    def run(self, *, reconcile_only: bool = False) -> dict[str, Any]:
        return self.run_mode(reconcile_only=reconcile_only)

    def run_mode(self, *, reconcile_only: bool = False,
                 validate_only: bool = False) -> dict[str, Any]:
        if reconcile_only and validate_only:
            raise UpdateError("Only one update inspection mode can be selected")
        with self._installation_lock():
            if reconcile_only:
                self._recover_interrupted_transaction()
                if self.journal_path.is_file():
                    state = json.loads(self.journal_path.read_text(encoding="utf-8"))
                    return {"transaction": state.get("transaction"), "phase": state.get("phase"),
                            "version": state.get("version")}
                return {"transaction": self.transaction, "phase": "not_started",
                        "version": self.expected_version}
            if validate_only:
                self._assert_not_downgrade()
                candidate = self._prepare_project_release()
                self.candidate_root = candidate
                inventory = self._validate_candidate()
                return {"transaction": self.transaction, "phase": "prepared",
                        "version": self.expected_version,
                        "candidate_tree_sha256": self._release_manifest(
                            candidate, self.expected_version)["tree_sha256"],
                        "active_services": inventory["active_services"],
                        "candidate_services": sorted(inventory["candidate_model"]["services"])}
            self._run_locked()
            return {"transaction": self.transaction, "phase": self.state.get("phase"),
                    "version": self.expected_version}

    def _validate_candidate(self) -> dict[str, Any]:
        """Check the current project and candidate Compose without changing services."""
        records, profiles, old_workdir, old_files, old_model = self._running_inventory()
        if self.expected_project_root is not None and old_workdir.resolve() != self.expected_project_root:
            raise UpdateError("Existing Compose project root differs from its private host binding")
        self.preserved_compose_overrides = self._host_compose_overrides(old_workdir, old_files)
        active_services = sorted(
            record["Config"]["Labels"]["com.docker.compose.service"] for record in records)
        required_active = {"db", "redis", "backend", "engine", "frontend"}
        if not required_active <= set(active_services):
            raise UpdateError("Installation is missing a required active service; refusing partial update")
        candidate_model = self._compose_model(
            self.candidate_root, self._candidate_compose_files(), profiles, self.candidate_root)
        required_candidate = {"db", "redis", "migrator", "backend", "engine", "frontend"}
        if not required_candidate <= set(candidate_model["services"]):
            raise UpdateError("Candidate Compose release is missing a required project service")
        target_services = self._candidate_services_to_start(candidate_model, profiles)
        candidate_model = self._ensure_plugin_runner_healthcheck(candidate_model, target_services)
        self._validate_candidate_healthchecks(candidate_model, target_services)
        omitted = sorted(set(active_services) - set(candidate_model["services"]))
        if omitted:
            raise UpdateError("Candidate Compose release omits existing installation services: "
                              + ", ".join(omitted))
        omitted_active = sorted(set(active_services) - set(target_services))
        if omitted_active:
            raise UpdateError("Candidate Compose release would leave existing services stopped: "
                              + ", ".join(omitted_active))
        nginx_config = self.candidate_root / "frontend" / "nginx.conf"
        if not nginx_config.is_file():
            raise UpdateError("Candidate frontend admission configuration is missing")
        nginx_text = nginx_config.read_text(encoding="utf-8")
        if ".maintenance" not in nginx_text or "__treseko_update_gate_probe__" not in nginx_text:
            raise UpdateError("Candidate frontend cannot fence every request during activation")
        return {"records": records, "profiles": profiles, "old_workdir": old_workdir,
                "old_files": old_files, "old_model": old_model,
                "active_services": active_services, "candidate_model": candidate_model,
                "target_services": target_services,
                "frontend_volume": self._frontend_volume(records)}

    def _run_locked(self) -> None:
        self._recover_interrupted_transaction()
        self._assert_not_downgrade()
        source_root = self.candidate_root
        self.candidate_root = self._prepare_project_release()
        inventory = self._validate_candidate()
        records = inventory["records"]
        profiles = inventory["profiles"]
        old_workdir = inventory["old_workdir"]
        old_files = inventory["old_files"]
        old_model = inventory["old_model"]
        active_services = inventory["active_services"]
        target_services = inventory["target_services"]
        frontend_volume = inventory["frontend_volume"]
        self.state = {"schema": 1, "transaction": self.transaction, "phase": "preparing",
                      "project": self.project, "version": self.expected_version,
                      "candidate_source_root": str(source_root),
                      "candidate_root": str(self.candidate_root), "old_working_dir": str(old_workdir),
                      "old_compose_files": old_files, "profiles": profiles,
                      "active_services": active_services, "old_active_services": active_services,
                      "old_containers": {r["Config"]["Labels"]["com.docker.compose.service"]:
                                         [r["Id"], r["Image"]] for r in records},
                      "frontend_volume": frontend_volume, "volume_backups": {},
                      "old_images": {}, "snapshot_image": None}
        self._save()
        # Retag every currently installed image before a build can move a tag.
        old_images = self._tag_old_images(records, old_model)
        self.state["old_images"] = old_images
        self._save()
        self._compose_candidate("build", timeout=3600)
        expected = self.expected_version
        services = ["backend", "frontend", "engine"]
        for service in ("automation-worker", "plugin-runner"):
            if service in active_services:
                services.append(service)
        try:
            try:
                from .validate_candidate_images import validate_candidate_images
            except ImportError:
                from validate_candidate_images import validate_candidate_images
            validate_candidate_images(self.docker, self.project, expected, services)
        except Exception:
            self.state["phase"] = "candidate_rejected"
            self._save()
            raise

        db_record = next(r for r in records
                         if r["Config"]["Labels"].get("com.docker.compose.service") == "db")
        self.state["snapshot_image"] = db_record["Image"]
        self._docker("run", "--rm", "--network", "none", "--entrypoint", "sh",
                     db_record["Image"], "-ec", "command -v tar >/dev/null")
        self._assert_no_existing_maintenance(frontend_volume, db_record["Image"])
        try:
            self._assert_baseline_unchanged()
        except Exception:
            self.state["phase"] = "candidate_rejected"
            self._save()
            raise
        self.state["phase"] = "stopping_old_project"
        self._save()
        try:
            self._stop_legacy_frontend(records)
            self._compose(old_workdir, old_files, profiles, "stop", "--timeout", "120", timeout=300)
            backups = self._snapshot_volumes(self._named_volumes(records), db_record["Image"])
            self.state["volume_backups"] = backups
            self.state["phase"] = "snapshot_complete"
            self._save()
            self._write_maintenance_marker(frontend_volume, db_record["Image"])
            self.state["phase"] = "candidate_database_starting"
            self._save()
            self._compose_candidate("up", "-d", "--wait", "--wait-timeout", "180", "db", "redis", timeout=300)
            self.state["phase"] = "migration_started"
            self._save()
            self._compose_candidate("run", "--rm", "migrator", timeout=1800)
            self.state["phase"] = "candidate_services_starting"
            self._save()
            # Compose --wait evaluates the exited one-shot migrator dependency
            # as an unhealthy container. Start without that aggregate wait,
            # then gate admission on every persistent service explicitly.
            # Recreate every persistent service, even when an old and new
            # Compose model happen to declare the same image/config. Besides
            # applying one coherent release, this normalizes Docker's source
            # identity labels to the candidate Compose root so a later update
            # cannot inherit ambiguous files from a prior worktree/install root.
            self._compose_candidate("up", "-d", "--force-recreate", "--remove-orphans", *target_services,
                                    timeout=900)
            # Cold Engine startup on Windows may exceed the default Docker
            # healthcheck grace period while it syncs runtime files.
            self._wait_candidate_services_healthy(target_services, timeout=420)
            self.state["active_services"] = sorted(target_services)
            self._verify_candidate()
            self._assert_fence_enforced()
            self.state["phase"] = "release_pending"
            self._save()
            self._activate_project_release()
            self._remove_maintenance_marker()
            self.state["phase"] = "committed"
            self.state["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            self._save()
        except Exception as failure:
            self.state["failed_phase"] = self.state.get("phase")
            self.state["failure_type"] = type(failure).__name__
            # Keep the diagnostic tail: Docker/Compose errors often put the
            # actionable Alembic or healthcheck cause at the end of a long
            # traceback. Truncating from the front preserves noise and hides
            # the actual reason an atomic rollback was triggered.
            self.state["failure_reason"] = str(failure)[-1200:]
            if self.state.get("phase") == "candidate_services_starting":
                try:
                    self.state["candidate_start_snapshot"] = self._candidate_start_snapshot()
                except Exception as diagnostic_failure:
                    self.state["candidate_start_snapshot"] = [
                        {"diagnostic": f"Docker state snapshot failed: {type(diagnostic_failure).__name__}"}
                    ]
            self._save()
            if self.state.get("phase") == "release_pending":
                # The marker removal may have succeeded even if its ACK was
                # lost. Do not roll back the database after candidate traffic
                # might have been admitted; the durable journal lets a retry
                # verify and complete this commit.
                try:
                    self._ensure_maintenance_marker()
                except Exception:
                    pass
                raise UpdateError(f"Candidate release is uncertain; data was not rolled back. Rerun update to reconcile transaction {self.transaction}") from failure
            try:
                self._rollback()
            except Exception as rollback_failure:
                self.state["phase"] = "recovery_required"
                self.state["failure"] = type(failure).__name__
                self.state["rollback_failure"] = type(rollback_failure).__name__
                self.state["rollback_failure_reason"] = _redact_known_text(
                    str(rollback_failure), self._known_secret_values())
                self._save()
                raise UpdateError(f"Update failed and automatic rollback needs recovery; transaction {self.transaction}") from failure
            raise UpdateError(f"Update failed; previous release restored (transaction {self.transaction})") from failure


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--docker", required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--candidate-root", type=Path, required=True)
    parser.add_argument("--install-root", type=Path, required=True)
    parser.add_argument("--env-file", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--transaction")
    parser.add_argument("--expected-project-root", type=Path)
    parser.add_argument("--reconcile-only", action="store_true")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args(argv)
    try:
        result = AtomicComposeUpdate(docker=args.docker, project=args.project,
                                     candidate_root=args.candidate_root, install_root=args.install_root,
                                     env_file=args.env_file, expected_version=args.version,
                                     transaction_id=args.transaction,
                                     expected_project_root=args.expected_project_root).run_mode(
                                         reconcile_only=args.reconcile_only,
                                         validate_only=args.validate_only)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
