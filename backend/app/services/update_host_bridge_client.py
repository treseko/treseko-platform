"""Backend-side client for the host-owned coordinated update spool."""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
from pathlib import Path
import secrets
import stat
import tempfile
import re
from typing import Any, Mapping

from .update_host_bridge_spool import HostBridgeSpool, SpoolError
from .update_journal import exclusive_lock

MAX_REPORT_BYTES = 64 * 1024
REPORT_STATUSES = {"plan_validated", "prepared", "prepare_pending", "apply_pending",
                   "apply_uncertain", "complete", "rolled_back", "not_found", "blocked"}
REPORT_ACTIONS = {"plan", "prepare", "apply", "resume", "status"}


class CoordinatedBridgeError(RuntimeError):
    pass


class CoordinatedBridgeSettings:
    """Public producer settings; host-private bridge settings never cross here."""

    def __init__(self, request_inbox: Path, package_inbox: Path, report_dir: Path,
                 request_uid: int, request_gid: int, *, report_timeout: float = 30.0):
        self.request_inbox = _directory(request_inbox, "request_inbox")
        self.package_inbox = _directory(package_inbox, "package_inbox")
        self.report_dir = _directory(report_dir, "report_dir", forbidden=0o027)
        self.manifest_dir = package_inbox / ".coordinated-manifests"
        self.manifest_dir.mkdir(mode=0o700, exist_ok=True)
        _private_directory(self.manifest_dir, "manifest_dir")
        if (not isinstance(request_uid, int) or isinstance(request_uid, bool) or request_uid < 0
                or not isinstance(request_gid, int) or isinstance(request_gid, bool) or request_gid < 0):
            raise CoordinatedBridgeError("invalid_coordinated_uid_gid")
        self.request_uid, self.request_gid = request_uid, request_gid
        if not isinstance(report_timeout, (int, float)) or report_timeout <= 0 or report_timeout > 3600:
            raise CoordinatedBridgeError("invalid_coordinated_timeout")
        self.report_timeout = float(report_timeout)

    @classmethod
    def from_environment(cls) -> "CoordinatedBridgeSettings":
        names = {key: os.getenv(value, "").strip() for key, value in {
            "request_inbox": "TRESEKO_UPDATE_REQUEST_INBOX",
            "package_inbox": "TRESEKO_UPDATE_PACKAGE_INBOX",
            "report_dir": "TRESEKO_UPDATE_REPORT_DIR",
        }.items()}
        if not all(names.values()):
            raise CoordinatedBridgeError("coordinated_settings_missing")
        try:
            uid = int(os.getenv("TRESEKO_UPDATE_REQUEST_UID", ""))
            gid = int(os.getenv("TRESEKO_UPDATE_REQUEST_GID", ""))
            timeout = float(os.getenv("TRESEKO_UPDATE_REPORT_TIMEOUT", "30"))
        except ValueError as exc:
            raise CoordinatedBridgeError("invalid_coordinated_uid_gid") from exc
        return cls(Path(names["request_inbox"]), Path(names["package_inbox"]),
                   Path(names["report_dir"]), uid, gid, report_timeout=timeout)

    def producer_config(self) -> dict[str, Any]:
        return {"schema": 1, "request_inbox": str(self.request_inbox),
                "request_uid": self.request_uid, "request_gid": self.request_gid}


class CoordinatedBridgeClient:
    def __init__(self, settings: CoordinatedBridgeSettings):
        self.settings = settings
        self.producer = HostBridgeSpool.producer_for(settings.producer_config())

    def stage_package(self, source: Path, checksum: str, expected_size: int) -> Path:
        if not isinstance(checksum, str) or len(checksum) != 64 or any(c not in "0123456789abcdef" for c in checksum):
            raise CoordinatedBridgeError("invalid_package_checksum")
        if not isinstance(expected_size, int) or isinstance(expected_size, bool) or expected_size < 0:
            raise CoordinatedBridgeError("invalid_package_size")
        try:
            source_fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            info = os.fstat(source_fd)
            if (not stat.S_ISREG(info.st_mode) or info.st_uid not in {0, os.geteuid()}
                    or info.st_mode & 0o002 or info.st_size != expected_size):
                raise CoordinatedBridgeError("unsafe_downloaded_package")
            digest = hashlib.sha256()
            fd, temporary = tempfile.mkstemp(prefix=f".{checksum}-", suffix=".tmp", dir=self.settings.package_inbox)
            try:
                with os.fdopen(fd, "wb") as output:
                    copied = 0
                    while chunk := os.read(source_fd, min(1024 * 1024, expected_size + 1 - copied)):
                        copied += len(chunk)
                        if copied > expected_size:
                            raise CoordinatedBridgeError("download_changed")
                        digest.update(chunk)
                        output.write(chunk)
                    output.flush()
                    os.fsync(output.fileno())
                if copied != expected_size or digest.hexdigest() != checksum:
                    raise CoordinatedBridgeError("package_checksum_invalid")
                target = self.settings.package_inbox / checksum
                if target.is_symlink():
                    raise CoordinatedBridgeError("package_staging_conflict")
                if target.exists():
                    target_fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                    target_info = os.fstat(target_fd)
                    os.close(target_fd)
                    if not _file_matches(target, checksum, expected_size):
                        raise CoordinatedBridgeError("package_staging_conflict")
                    return target
                with exclusive_lock(self.settings.package_inbox / ".coordinated-package.lock"):
                    if target.exists() or target.is_symlink():
                        if target.is_symlink() or not _file_matches(target, checksum, expected_size):
                            raise CoordinatedBridgeError("package_staging_conflict")
                        return target
                    try:
                        os.link(temporary, target)
                    except FileExistsError:
                        if target.is_symlink() or not _file_matches(target, checksum, expected_size):
                            raise CoordinatedBridgeError("package_staging_conflict")
                    else:
                        os.unlink(temporary)
                    directory = os.open(self.settings.package_inbox, os.O_RDONLY | os.O_DIRECTORY)
                    try:
                        os.fsync(directory)
                    finally:
                        os.close(directory)
                    return target
            finally:
                Path(temporary).unlink(missing_ok=True)
        except CoordinatedBridgeError:
            raise
        except (OSError, ValueError) as exc:
            raise CoordinatedBridgeError("package_staging_failed") from exc
        finally:
            if "source_fd" in locals():
                os.close(source_fd)

    def submit_prepare(self, transaction: str, manifest: Mapping[str, Any], package: Path) -> dict[str, Any]:
        transaction = _transaction(transaction)
        checksum = str(manifest.get("checksum_sha256") or "").lower()
        size = manifest.get("package_size_bytes")
        if not isinstance(size, int) or size < 0:
            raise CoordinatedBridgeError("invalid_package_size")
        staged = self.stage_package(package, checksum, size)
        self.persist_manifest(transaction, manifest)
        return self._submit({"schema": 1, "transaction": transaction, "action": "prepare",
                             "manifest": dict(manifest), "package_checksum_sha256": checksum,
                             "nonce": secrets.token_hex(16)})

    def submit_apply(self, transaction: str, manifest: Mapping[str, Any]) -> dict[str, Any]:
        transaction = _transaction(transaction)
        return self._submit({"schema": 1, "transaction": transaction, "action": "apply",
                             "manifest": dict(manifest), "nonce": secrets.token_hex(16)})

    def submit_status(self, transaction: str) -> dict[str, Any]:
        transaction = _transaction(transaction)
        return self._submit({"schema": 1, "transaction": transaction, "action": "status",
                             "nonce": secrets.token_hex(16)})

    def _submit(self, request: dict[str, Any]) -> dict[str, Any]:
        request["nonce"] = self._stable_nonce(request["transaction"], request["action"])
        try:
            return self.producer.submit(request)
        except SpoolError as exc:
            raise CoordinatedBridgeError(exc.code) from exc

    def read_report(self, transaction: str, *, action: str | None = None) -> dict[str, Any] | None:
        if not isinstance(transaction, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}", transaction):
            raise CoordinatedBridgeError("invalid_transaction")
        path = self.settings.report_dir / f"{transaction}.json"
        try:
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(descriptor, "rb") as stream:
                info = os.fstat(stream.fileno())
                if (not stat.S_ISREG(info.st_mode) or info.st_uid not in {0, os.geteuid()}
                        or info.st_mode & 0o022 or info.st_size > MAX_REPORT_BYTES):
                    raise CoordinatedBridgeError("invalid_coordinated_report")
                value = json.loads(stream.read(MAX_REPORT_BYTES + 1))
        except FileNotFoundError:
            return None
        except CoordinatedBridgeError:
            raise
        except (OSError, ValueError, UnicodeError) as exc:
            raise CoordinatedBridgeError("invalid_coordinated_report") from exc
        if (not isinstance(value, dict) or value.get("schema") != 1
                or value.get("transaction") != transaction
                or value.get("action") not in REPORT_ACTIONS
                or value.get("status") not in REPORT_STATUSES):
            raise CoordinatedBridgeError("invalid_coordinated_report")
        if action is not None and value.get("action") != action:
            return None
        return {key: value[key] for key in ("schema", "transaction", "action", "status", "error") if key in value}

    async def wait_report(self, transaction: str, *, action: str) -> dict[str, Any] | None:
        deadline = asyncio.get_running_loop().time() + self.settings.report_timeout
        while True:
            report = self.read_report(transaction, action=action)
            if report is not None:
                return report
            if asyncio.get_running_loop().time() >= deadline:
                return None
            await asyncio.sleep(0.2)

    def _stable_nonce(self, transaction: str, action: str) -> str:
        transaction = _transaction(transaction)
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}", action):
            raise CoordinatedBridgeError("invalid_action")
        path = self.settings.manifest_dir / f".{transaction}-{action}.nonce"
        try:
            with exclusive_lock(self.settings.manifest_dir / ".coordinated-client.lock"):
                if path.exists() or path.is_symlink():
                    return _read_nonce(path)
                return self._create_nonce(path)
        except OSError as exc:
            raise CoordinatedBridgeError("nonce_persistence_failed") from exc

    @staticmethod
    def _create_nonce(path: Path) -> str:
        nonce = secrets.token_hex(16)
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        except FileExistsError:
            return _read_nonce(path)
        with os.fdopen(fd, "w") as stream:
            stream.write(nonce)
            stream.flush()
            os.fsync(stream.fileno())
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        return nonce

    def persist_manifest(self, transaction: str, manifest: Mapping[str, Any]) -> None:
        transaction = _transaction(transaction)
        path = self.settings.manifest_dir / f"{transaction}.json"
        with exclusive_lock(self.settings.manifest_dir / ".coordinated-client.lock"):
            if path.exists() or path.is_symlink():
                if path.is_symlink() or _read_json_file(path) != dict(manifest):
                    raise CoordinatedBridgeError("manifest_binding_changed")
                return
            fd, temporary = tempfile.mkstemp(prefix=f".{transaction}-", dir=self.settings.manifest_dir)
            try:
                with os.fdopen(fd, "w") as stream:
                    json.dump(dict(manifest), stream, sort_keys=True, separators=(",", ":"))
                    stream.flush()
                    os.fsync(stream.fileno())
                try:
                    os.link(temporary, path)
                except FileExistsError:
                    if path.is_symlink() or _read_json_file(path) != dict(manifest):
                        raise CoordinatedBridgeError("manifest_binding_changed")
                directory = os.open(self.settings.manifest_dir, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(directory)
                finally:
                    os.close(directory)
            finally:
                Path(temporary).unlink(missing_ok=True)

    def load_manifest(self, transaction: str) -> dict[str, Any] | None:
        transaction = _transaction(transaction)
        path = self.settings.manifest_dir / f"{transaction}.json"
        try:
            value = _read_json_file(path)
        except FileNotFoundError:
            return None
        except (OSError, ValueError, UnicodeError) as exc:
            raise CoordinatedBridgeError("manifest_binding_invalid") from exc
        return value if isinstance(value, dict) else None


def _transaction(value: Any) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}", value):
        raise CoordinatedBridgeError("invalid_transaction")
    return value


def _private_directory(path: Path, label: str) -> None:
    """Validate the manifest directory and every existing ancestor."""
    if not path.is_absolute() or ".." in path.parts:
        raise CoordinatedBridgeError(f"unsafe_{label}")
    cursor = path
    while True:
        try:
            info = cursor.lstat()
        except OSError as exc:
            raise CoordinatedBridgeError(f"unsafe_{label}") from exc
        if (stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode)
                or info.st_uid not in {0, os.geteuid()} or info.st_mode & 0o022):
            raise CoordinatedBridgeError(f"unsafe_{label}")
        if cursor.parent == cursor:
            return
        cursor = cursor.parent


def _file_matches(path: Path, checksum: str, expected_size: int) -> bool:
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size != expected_size:
                return False
            digest = hashlib.sha256()
            total = 0
            while True:
                chunk = os.read(stream.fileno(), min(1024 * 1024, expected_size + 1 - total))
                if not chunk:
                    break
                total += len(chunk)
                if total > expected_size:
                    return False
                digest.update(chunk)
            return total == expected_size and digest.hexdigest() == checksum
    except OSError:
        return False


def _read_json_file(path: Path) -> Any:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        info = os.fstat(stream.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid not in {0, os.geteuid()}
                or info.st_mode & 0o022 or info.st_size > 1024 * 1024):
            raise CoordinatedBridgeError("manifest_binding_invalid")
        return json.loads(stream.read(info.st_size + 1))


def _read_nonce(path: Path) -> str:
    value = _read_json_file(path) if path.suffix == ".json" else None
    if value is not None:
        raise CoordinatedBridgeError("nonce_persistence_failed")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        info = os.fstat(stream.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid not in {0, os.geteuid()}
                or info.st_mode & 0o077 or info.st_size != 32):
            raise CoordinatedBridgeError("nonce_persistence_failed")
        nonce = stream.read(33).decode("ascii", "strict")
    if not re.fullmatch(r"[0-9a-f]{32}", nonce):
        raise CoordinatedBridgeError("nonce_persistence_failed")
    return nonce


def _directory(path: Path, label: str, *, forbidden: int = 0o002) -> Path:
    if (not isinstance(path, Path) or not path.is_absolute() or ".." in path.parts
            or path.is_symlink() or not path.is_dir()):
        raise CoordinatedBridgeError(f"invalid_{label}")
    try:
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid not in {0, os.geteuid()} or info.st_mode & forbidden:
            raise CoordinatedBridgeError(f"unsafe_{label}")
    except OSError as exc:
        raise CoordinatedBridgeError(f"invalid_{label}") from exc
    return path
