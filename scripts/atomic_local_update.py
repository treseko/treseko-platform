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
_SERVICE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]*$")
_INFRASTRUCTURE_SERVICES = {"db", "redis", "migrator"}
_VERSION_PROBES = {"backend", "frontend", "engine", "automation-worker", "plugin-runner"}
_RELEASE_VERSION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$")
_RELEASE_CACHE_DIRS = {".venv", "venv", "node_modules", "__pycache__", ".pytest_cache",
                       ".mypy_cache", ".ruff_cache"}
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
                 install_root: Path, env_file: Path, expected_version: str):
        self.docker = str(Path(docker).resolve())
        self.project = project
        self.candidate_root = candidate_root.resolve()
        self.install_root = install_root.resolve()
        self.env_file = env_file.resolve()
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
        self.transaction = time.strftime("%Y%m%d%H%M%S", time.gmtime()) + "-" + os.urandom(4).hex()
        self.journal_path = self.journal_root / f"{self.transaction}.json"
        self.candidate_override = self.journal_root / f"{self.transaction}-atomic-candidate.compose.yml"
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

    def _release_ignored(self, directory: str, names: list[str]) -> set[str]:
        """Exclude only VCS and mutable installation state from release code."""
        ignored = {name for name in names if name == ".git" or name == ".treseko-local"
                   or name == ".treseko-release.json" or name in _RELEASE_CACHE_DIRS
                   or name == ".DS_Store" or name.startswith("._")}
        # The installed secret/environment files are outside the candidate in
        # normal package use. If someone updates from the installation root,
        # keep those mutable files out of the immutable application snapshot.
        if Path(directory).resolve() == self.candidate_root.resolve() and "compose.production.env" in names:
            ignored.add("compose.production.env")
        return ignored

    @staticmethod
    def _release_files(root: Path) -> list[Path]:
        files: list[Path] = []
        for current, dirs, names in os.walk(root, topdown=True, followlinks=False):
            current_path = Path(current)
            if any((current_path / name).is_symlink() for name in dirs):
                raise UpdateError("Candidate project contains a symbolic link; refusing a non-portable release snapshot")
            dirs[:] = sorted(name for name in dirs if name not in {".git", ".treseko-local"}
                             and name not in _RELEASE_CACHE_DIRS)
            for name in sorted(names):
                if (name == ".treseko-release.json" or name == ".DS_Store" or name.startswith("._")
                        or (current_path == root and name == "compose.production.env")):
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

    def _verify_plugin_runner_baseline(self, record: dict[str, Any], health: str | None) -> None:
        if health == "healthy":
            return
        if health not in (None, ""):
            raise UpdateError("Existing plugin-runner has no confirmed healthy baseline")
        container_id = str(record.get("Id") or "").strip()
        if not container_id:
            raise UpdateError("Existing plugin-runner has no container identity for its health probe")
        probe = (
            "fetch('http://127.0.0.1:3020/health')"
            ".then(response => process.exit(response.ok ? 0 : 1))"
            ".catch(() => process.exit(1))"
        )
        try:
            self._docker("exec", container_id, "node", "-e", probe, timeout=10)
        except UpdateError as exc:
            raise UpdateError("Existing plugin-runner HTTP health probe failed") from exc

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
            states = {}
            for record in records:
                labels = record.get("Config", {}).get("Labels") or {}
                service = labels.get("com.docker.compose.service")
                if service not in expected:
                    continue
                state = record.get("State") or {}
                health = state.get("Health") or {}
                states[service] = ("running" if state.get("Running") else str(state.get("Status") or "missing"),
                                   str(health.get("Status") or "not-configured"))
            last_states = states
            for service, (status, health) in states.items():
                if status != "running":
                    raise UpdateError(f"Candidate service {service} did not remain running ({status})")
                if health == "unhealthy":
                    raise UpdateError(f"Candidate service {service} healthcheck failed")
                if service in {"db", "redis", "backend", "engine", "frontend", "plugin-runner"} \
                        and health == "not-configured":
                    raise UpdateError(f"Candidate service {service} has no configured healthcheck")
            if set(states) == expected and all(health in {"healthy", "not-configured"}
                                               for _, health in states.values()):
                return
            if time.monotonic() >= deadline:
                waiting = sorted(service for service in expected
                                 if service not in states or states[service][1] == "starting")
                raise UpdateError("Candidate healthcheck timeout; still waiting: " + ", ".join(waiting))
            time.sleep(2)

    def _compose_candidate(self, *args: str, timeout: int = 1800) -> str:
        return self._compose(self.candidate_root,
                             [str(self.candidate_root / "docker-compose.prod.yml"),
                              str(self.candidate_override)],
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

    def run(self) -> None:
        with self._installation_lock():
            self._run_locked()

    def _run_locked(self) -> None:
        self._recover_interrupted_transaction()
        source_root = self.candidate_root
        self.candidate_root = self._prepare_project_release()
        records, profiles, old_workdir, old_files, old_model = self._running_inventory()
        active_services = sorted(r["Config"]["Labels"]["com.docker.compose.service"] for r in records)
        if not {"db", "redis", "backend", "engine", "frontend"} <= set(active_services):
            raise UpdateError("Installation is missing a required active service; refusing partial update")
        candidate_file = str(self.candidate_root / "docker-compose.prod.yml")
        candidate_model = self._compose_model(self.candidate_root, [candidate_file], profiles, self.candidate_root)
        if not {"db", "redis", "migrator", "backend", "engine", "frontend"} <= set(candidate_model["services"]):
            raise UpdateError("Candidate Compose release is missing a required project service")
        candidate_services = set(candidate_model["services"])
        omitted_existing = set(active_services) - candidate_services
        if omitted_existing:
            raise UpdateError(
                "Candidate Compose release omits existing installation services: "
                + ", ".join(sorted(omitted_existing))
            )
        target_services = self._candidate_services_to_start(candidate_model, profiles)
        omitted_active = set(active_services) - set(target_services)
        if omitted_active:
            raise UpdateError(
                "Candidate Compose release would leave existing services stopped: "
                + ", ".join(sorted(omitted_active))
            )
        nginx_config = self.candidate_root / "frontend" / "nginx.conf"
        if not nginx_config.is_file():
            raise UpdateError("Candidate frontend admission configuration is missing")
        nginx_text = nginx_config.read_text(encoding="utf-8")
        if ".maintenance" not in nginx_text or "__treseko_update_gate_probe__" not in nginx_text:
            raise UpdateError("Candidate frontend cannot fence every request during activation")
        frontend_volume = self._frontend_volume(records)
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
    args = parser.parse_args(argv)
    try:
        AtomicComposeUpdate(docker=args.docker, project=args.project,
                            candidate_root=args.candidate_root, install_root=args.install_root,
                            env_file=args.env_file, expected_version=args.version).run()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(f"Treseko {args.version} committed atomically. Recovery snapshots retained.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
