from __future__ import annotations

import asyncio
import copy
import gzip
import hashlib
import json
import logging
import os
import platform
import re
import shutil
import tarfile
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit, urlunsplit

import httpx
from redis.asyncio import Redis

from ..version import PRODUCT_VERSION


UPDATE_SERVER_URL = (os.getenv("TRESEKO_UPDATE_SERVER_URL") or "https://updates.treseko.com").rstrip("/")
UPDATE_CHECK_TIMEOUT_SECONDS = float(os.getenv("TRESEKO_UPDATE_CHECK_TIMEOUT_SECONDS") or "15")
UPDATE_CHECK_CACHE_SECONDS = float(os.getenv("TRESEKO_UPDATE_CHECK_CACHE_SECONDS") or "3600")
UPDATE_STEP_TIMEOUT_SECONDS = float(os.getenv("TRESEKO_UPDATE_STEP_TIMEOUT_SECONDS") or "300")
UPDATE_CACHE_REDIS_URL = (os.getenv("TRESEKO_UPDATE_CACHE_REDIS_URL") or os.getenv("REDIS_URL") or "").strip()
ENABLE_SELF_UPDATE_APPLY = str(os.getenv("TRESEKO_ENABLE_SELF_UPDATE_APPLY") or "").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
COMMUNITY_UPDATE_CHANNEL_ENV = "TRESEKO_COMMUNITY_UPDATE_CHANNEL"
DEFAULT_COMMUNITY_UPDATE_CHANNEL = "community-stable"
COMMUNITY_UPDATE_CHANNELS = {"community-stable", "community-beta", "community-smoke"}


def _is_production_env() -> bool:
    return (os.getenv("APP_ENV") or os.getenv("ENVIRONMENT") or os.getenv("ENV") or "development").strip().lower() in {
        "prod",
        "production",
    }


UPDATE_DB_HISTORY_ENABLED = str(
    os.getenv("TRESEKO_UPDATE_DB_HISTORY_ENABLED")
    or ("true" if _is_production_env() else "false")
).strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}

logger = logging.getLogger(__name__)

UpdateStatus = Literal["idle", "queued", "in_progress", "done", "failed", "restarting"]


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _version_tuple(value: str) -> tuple[int, ...]:
    parts = re.findall(r"\d+", str(value or ""))
    return tuple(int(part) for part in parts[:4]) or (0,)


def version_gt(candidate: str, current: str) -> bool:
    left = _version_tuple(candidate)
    right = _version_tuple(current)
    max_len = max(len(left), len(right))
    return left + (0,) * (max_len - len(left)) > right + (0,) * (max_len - len(right))


def configured_community_update_channel() -> str:
    channel = str(os.getenv(COMMUNITY_UPDATE_CHANNEL_ENV) or DEFAULT_COMMUNITY_UPDATE_CHANNEL).strip()
    if channel in COMMUNITY_UPDATE_CHANNELS:
        return channel
    logger.warning(
        "Canal Community de updates invalido %r; usando %s",
        channel,
        DEFAULT_COMMUNITY_UPDATE_CHANNEL,
    )
    return DEFAULT_COMMUNITY_UPDATE_CHANNEL


def _pg_dump_url(database_url: str) -> str:
    url = database_url.strip()
    if url.startswith("postgresql+asyncpg://"):
        url = "postgresql://" + url.split("://", 1)[1]
    elif url.startswith("postgres+asyncpg://"):
        url = "postgresql://" + url.split("://", 1)[1]
    elif url.startswith("postgres://"):
        url = "postgresql://" + url.split("://", 1)[1]
    parts = urlsplit(url)
    if parts.scheme not in {"postgresql", "postgres"}:
        return ""
    return urlunsplit(parts)


def _env_or_file(name: str) -> str:
    direct_value = (os.getenv(name) or "").strip()
    if direct_value:
        return direct_value
    file_path = (os.getenv(f"{name}_FILE") or "").strip()
    if not file_path:
        return ""
    try:
        return Path(file_path).read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError(f"No se pudo leer {name}_FILE={file_path}") from exc


@dataclass(frozen=True)
class UpdateSettings:
    updates_dir: Path = Path(os.getenv("UPDATES_DIR") or "/data/updates")
    backups_dir: Path = Path(os.getenv("BACKUPS_DIR") or os.getenv("DB_BACKUP_DIR") or "/data/backups")
    app_dir: Path = Path(os.getenv("TRESEKO_APP_DIR") or "/app")
    frontend_dir: Path = Path(os.getenv("TRESEKO_FRONTEND_DIR") or "/usr/share/nginx/html")
    engine_dir: Path = Path(os.getenv("TRESEKO_ENGINE_DIR") or "/engine")
    worker_dir: Path = Path(os.getenv("TRESEKO_WORKER_DIR") or "/worker")
    history_file: Path = Path(
        os.getenv("UPDATES_HISTORY_FILE")
        or os.path.join(os.getenv("UPDATES_DIR") or "/data/updates", "update-history.json")
    )
    update_server_url: str = UPDATE_SERVER_URL
    database_url: str = _env_or_file("DATABASE_URL")
    pg_dump_path: str = os.getenv("PG_DUMP_PATH") or "pg_dump"
    psql_path: str = os.getenv("PSQL_PATH") or "psql"
    systemctl_path: str = os.getenv("SYSTEMCTL_PATH") or "systemctl"
    systemd_service_name: str = os.getenv("TRESEKO_SYSTEMD_SERVICE") or "treseko-backend"
    max_backups: int = int(os.getenv("MAX_BACKUPS") or "3")
    docker_mode: bool = (os.getenv("TRESEKO_DEPLOY_MODE") or "docker").lower() == "docker"


@dataclass
class UpdateTaskState:
    task_id: str
    status: UpdateStatus
    channel: str
    version: str | None = None
    previous_version: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    progress_pct: int = 0
    stage: str = "idle"
    message: str = "Sin actualizacion en curso."
    error: str | None = None
    backup_path: str | None = None
    rollback_path: str | None = None
    package_path: str | None = None
    extracted_path: str | None = None
    initiated_by_user_id: str | None = None
    initiated_by_email: str | None = None
    initiated_from_ip: str | None = None
    apply_confirmation: str | None = None
    rollback_by_user_id: str | None = None
    rollback_by_email: str | None = None
    rollback_from_ip: str | None = None
    rollback_requested_at: str | None = None
    rollback_restore_database: bool = False
    rollback_confirmation: str | None = None
    events: list[dict[str, Any]] | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "status": self.status,
            "channel": self.channel,
            "current_version": self.previous_version or PRODUCT_VERSION,
            "pending_version": self.version,
            "version": self.version,
            "previous_version": self.previous_version,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "progress_pct": self.progress_pct,
            "stage": self.stage,
            "message": self.message,
            "error": self.error,
            "backup_path": self.backup_path,
            "rollback_path": self.rollback_path,
            "package_path": self.package_path,
            "extracted_path": self.extracted_path,
            "initiated_by_user_id": self.initiated_by_user_id,
            "initiated_by_email": self.initiated_by_email,
            "initiated_from_ip": self.initiated_from_ip,
            "apply_confirmation": self.apply_confirmation,
            "rollback_by_user_id": self.rollback_by_user_id,
            "rollback_by_email": self.rollback_by_email,
            "rollback_from_ip": self.rollback_from_ip,
            "rollback_requested_at": self.rollback_requested_at,
            "rollback_restore_database": self.rollback_restore_database,
            "rollback_confirmation": self.rollback_confirmation,
            "events": list(self.events or []),
        }


class UpdateService:
    def __init__(self, settings: UpdateSettings | None = None, update_server_url: str | None = None):
        base_settings = settings or UpdateSettings()
        if update_server_url:
            base_settings = UpdateSettings(
                updates_dir=base_settings.updates_dir,
                backups_dir=base_settings.backups_dir,
                app_dir=base_settings.app_dir,
                frontend_dir=base_settings.frontend_dir,
                engine_dir=base_settings.engine_dir,
                worker_dir=base_settings.worker_dir,
                history_file=base_settings.history_file,
                update_server_url=update_server_url.rstrip("/"),
                database_url=base_settings.database_url,
                pg_dump_path=base_settings.pg_dump_path,
                psql_path=base_settings.psql_path,
                max_backups=base_settings.max_backups,
                docker_mode=base_settings.docker_mode,
            )
        self.settings = base_settings
        self.update_server_url = base_settings.update_server_url.rstrip("/")
        self._lock = asyncio.Lock()
        self._tasks: dict[str, UpdateTaskState] = {}
        self._latest_task_id: str | None = None
        self._running_task: asyncio.Task[None] | None = None
        self._community_update_cache: dict[str, Any] | None = None
        self._community_update_cache_at = 0.0
        self._redis_cache_url = UPDATE_CACHE_REDIS_URL
        self._redis: Redis | None = None
        self._db_history_task: asyncio.Task[None] | None = None
        self._db_history_dirty = False
        self._load_history()

    async def check_community_update(self, channel: str | None = None) -> dict[str, Any]:
        channel = channel if channel in COMMUNITY_UPDATE_CHANNELS else configured_community_update_channel()
        now = time.monotonic()
        cache_key = f"treseko:update:{channel}:latest"
        if (
            self._community_update_cache is not None
            and UPDATE_CHECK_CACHE_SECONDS > 0
            and now - self._community_update_cache_at < UPDATE_CHECK_CACHE_SECONDS
            and self._community_update_cache.get("channel") == channel
        ):
            return copy.deepcopy(self._community_update_cache)
        cached = await self._get_redis_json(cache_key)
        if cached is not None:
            self._community_update_cache = copy.deepcopy(cached)
            self._community_update_cache_at = now
            return cached
        url = f"{self.update_server_url}/api/updates/check"
        update_key_id = ""
        try:
            from .edition.update_manager import update_keyring_status

            fingerprints = update_keyring_status().get("fingerprints") or []
            update_key_id = str(fingerprints[0] if fingerprints else "")
        except Exception:
            update_key_id = ""
        request_payload = {
            "current_version": PRODUCT_VERSION,
            "edition": "community",
            "channel": channel,
            "platform": platform.system().lower() or "unknown",
            "update_key_id": update_key_id or None,
        }
        async with httpx.AsyncClient(timeout=httpx.Timeout(UPDATE_CHECK_TIMEOUT_SECONDS, connect=5.0)) as client:
            try:
                response = await client.post(url, json=request_payload)
                response.raise_for_status()
                payload = response.json()
            except httpx.HTTPStatusError:
                legacy_response = await client.get(f"{self.update_server_url}/community/latest")
                legacy_response.raise_for_status()
                payload = legacy_response.json()
        latest_version = str(payload.get("version") or payload.get("latest_version") or "").strip()
        available = bool(latest_version and version_gt(latest_version, PRODUCT_VERSION))
        manifest = payload.get("manifest") if isinstance(payload.get("manifest"), dict) else dict(payload)
        if manifest and "version" not in manifest and latest_version:
            manifest["version"] = latest_version
        if manifest and "channel" not in manifest:
            manifest["channel"] = str(payload.get("channel") or channel)
        if manifest and "edition" not in manifest:
            manifest["edition"] = "community"
        result = {
            "available": available,
            "current_version": PRODUCT_VERSION,
            "latest_version": latest_version or None,
            "version": latest_version or None,
            "channel": str(payload.get("channel") or manifest.get("channel") or channel),
            "checksum_sha256": payload.get("checksum_sha256") or payload.get("checksum"),
            "package_size_bytes": payload.get("package_size_bytes"),
            "changelog": payload.get("changelog"),
            "published_at": payload.get("published_at") or payload.get("released_at"),
            "requires_migration": bool(payload.get("requires_migration")),
            "min_backend_version": payload.get("min_backend_version"),
            "manifest": manifest,
            "reason": payload.get("reason"),
        }
        self._community_update_cache = copy.deepcopy(result)
        self._community_update_cache_at = now
        await self._set_redis_json(cache_key, result, int(UPDATE_CHECK_CACHE_SECONDS))
        return result

    def _redis_client(self) -> Redis | None:
        if not self._redis_cache_url:
            return None
        if self._redis is None:
            self._redis = Redis.from_url(self._redis_cache_url, decode_responses=True)
        return self._redis

    async def _get_redis_json(self, key: str) -> dict[str, Any] | None:
        if UPDATE_CHECK_CACHE_SECONDS <= 0:
            return None
        client = self._redis_client()
        if client is None:
            return None
        try:
            raw = await client.get(key)
        except Exception:
            return None
        if not raw:
            return None
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return None
        return copy.deepcopy(payload) if isinstance(payload, dict) else None

    async def _set_redis_json(self, key: str, value: dict[str, Any], ttl_seconds: int) -> None:
        if ttl_seconds <= 0:
            return
        client = self._redis_client()
        if client is None:
            return
        try:
            await client.setex(key, ttl_seconds, json.dumps(value, sort_keys=True))
        except Exception:
            return

    async def apply_update(
        self,
        *,
        channel: str,
        manifest: dict[str, Any] | None,
        force: bool = False,
        initiated_by_user_id: str | None = None,
        initiated_by_email: str | None = None,
        initiated_from_ip: str | None = None,
        apply_confirmation: str | None = None,
    ) -> str:
        manifest = manifest or {}
        self.validate_update_request(channel=channel, manifest=manifest)
        async with self._lock:
            running = [task for task in self._tasks.values() if task.status in {"queued", "in_progress", "restarting"}]
            if running:
                raise ValueError("Ya hay una actualizacion en curso.")
            task_id = str(uuid.uuid4())
            version = str((manifest or {}).get("version") or "").strip() or None
            state = UpdateTaskState(
                task_id=task_id,
                status="queued",
                channel=channel,
                version=version,
                previous_version=PRODUCT_VERSION,
                started_at=_utc_iso(),
                progress_pct=1,
                stage="queued",
                message="Actualizacion encolada.",
                initiated_by_user_id=initiated_by_user_id,
                initiated_by_email=initiated_by_email,
                initiated_from_ip=initiated_from_ip,
                apply_confirmation="APPLY_UPDATE" if apply_confirmation == "APPLY_UPDATE" else None,
            )
            self._tasks[task_id] = state
            self._latest_task_id = task_id
            self._append_event(
                state,
                "queued",
                message="Actualizacion encolada.",
                actor_email=initiated_by_email,
                actor_user_id=initiated_by_user_id,
                ip_address=initiated_from_ip,
                details={
                    "confirmation": "APPLY_UPDATE" if apply_confirmation == "APPLY_UPDATE" else None,
                    "force_restart": bool(force),
                    "manifest_version": version,
                },
                persist=False,
            )
            self._persist_history()
            self._running_task = asyncio.create_task(self._run_apply(task_id, manifest, force))
            return task_id

    def validate_update_request(self, *, channel: str, manifest: dict[str, Any] | None) -> dict[str, Any]:
        normalized = self._normalize_manifest(manifest or {})
        manifest_channel = str(normalized.get("channel") or channel).strip()
        if channel and manifest_channel and manifest_channel != channel:
            raise ValueError(f"El canal del manifest ({manifest_channel}) no coincide con el canal solicitado ({channel}).")
        manifest_edition = str(normalized.get("edition") or "").strip().lower()
        expected_edition = "premium" if str(channel).startswith("premium-") else "community"
        if manifest_edition and manifest_edition != expected_edition:
            raise ValueError("La edicion del manifest no coincide con el canal solicitado.")
        package_size = int(normalized.get("package_size_bytes") or 0)
        if package_size > 0:
            for label, path in {"updates": self.settings.updates_dir, "backups": self.settings.backups_dir}.items():
                path.mkdir(parents=True, exist_ok=True)
                free_bytes = shutil.disk_usage(path).free
                if free_bytes < package_size * 3:
                    raise ValueError(f"Espacio insuficiente para preparar update en {label}.")
        return normalized

    async def get_update_status(self, task_id: str | None = None) -> dict[str, Any]:
        requested_id = task_id or self._latest_task_id
        if requested_id and requested_id in self._tasks:
            return self._tasks[requested_id].as_dict()
        return UpdateTaskState(task_id="", status="idle", channel="").as_dict()

    async def get_update_history(self, limit: int = 20) -> list[dict[str, Any]]:
        limit = min(max(int(limit or 20), 1), 100)
        tasks = sorted(
            self._tasks.values(),
            key=lambda item: item.started_at or item.completed_at or "",
            reverse=True,
        )
        return [task.as_dict() for task in tasks[:limit]]

    async def report_failure(self, task_id: str) -> bool:
        state = self._tasks.get(task_id)
        if not state or state.status != "failed":
            return False
        await self._report_failure_best_effort(state)
        return True

    async def rollback(
        self,
        task_id: str | None = None,
        *,
        restore_database: bool = False,
        confirmation: str | None = None,
        requested_by_user_id: str | None = None,
        requested_by_email: str | None = None,
        requested_from_ip: str | None = None,
    ) -> dict[str, Any]:
        requested_id = task_id or self._latest_task_id
        if not requested_id or requested_id not in self._tasks:
            raise ValueError("No existe una tarea de actualizacion para revertir.")
        state = self._tasks[requested_id]
        state.rollback_by_user_id = requested_by_user_id
        state.rollback_by_email = requested_by_email
        state.rollback_from_ip = requested_from_ip
        state.rollback_requested_at = _utc_iso()
        state.rollback_restore_database = bool(restore_database)
        state.rollback_confirmation = "RESTORE_DATABASE" if confirmation == "RESTORE_DATABASE" else None
        self._append_event(
            state,
            "rollback_requested",
            message="Rollback solicitado.",
            actor_email=requested_by_email,
            actor_user_id=requested_by_user_id,
            ip_address=requested_from_ip,
            details={
                "restore_database": bool(restore_database),
                "confirmation": "RESTORE_DATABASE" if confirmation == "RESTORE_DATABASE" else None,
            },
        )
        flag_file = self.settings.updates_dir / "update-ready"
        if flag_file.exists():
            flag_file.unlink()
        restored_database = False
        if restore_database:
            if confirmation != "RESTORE_DATABASE":
                raise ValueError("Para restaurar la base de datos confirma con RESTORE_DATABASE.")
            if not state.backup_path:
                raise ValueError("La tarea no tiene backup de base de datos para restaurar.")
            db_backup_path = Path(state.backup_path)
            if not db_backup_path.exists():
                raise ValueError("El backup de base de datos ya no existe en disco.")
            await self._restore_database_backup(db_backup_path, requested_id)
            restored_database = True
        restored_code = False
        if state.rollback_path:
            backup_path = Path(state.rollback_path)
            if backup_path.exists():
                await self._restore_code_backup(backup_path, requested_id)
                restored_code = True
        state.status = "done"
        state.stage = "rollback_db_restored" if restored_database else "rollback_restored" if restored_code else "rollback"
        state.progress_pct = 100
        state.message = (
            "Rollback de codigo y base de datos restaurado desde backups. Reinicia Treseko para terminar de volver a la version anterior."
            if restored_database and restored_code
            else "Rollback de base de datos restaurado desde backup. Reinicia Treseko y revisa el estado de la aplicacion."
            if restored_database
            else
            "Rollback de codigo restaurado desde backup. Reinicia Treseko para terminar de volver a la version anterior."
            if restored_code
            else "Update pendiente cancelado. No se aplicaran cambios en el proximo reinicio."
        )
        state.completed_at = _utc_iso()
        self._append_event(
            state,
            state.stage,
            message=state.message,
            details={"restored_code": restored_code, "restored_database": restored_database},
            persist=False,
        )
        self._persist_history()
        return state.as_dict()

    async def _run_apply(self, task_id: str, manifest: dict[str, Any], force: bool) -> None:
        state = self._tasks[task_id]
        try:
            state.status = "in_progress"
            self._append_event(state, "started", message="Comienza preparacion de update.", persist=False)
            self._persist_history()
            self._update_state(state, "validating", 5, "Validando manifest de actualizacion.")
            normalized_manifest = self._normalize_manifest(manifest)
            state.version = normalized_manifest["version"]
            checksum = normalized_manifest["checksum_sha256"]

            self._update_state(state, "preflight", 8, "Validando preflight de espacio, version origen y backups.")
            await self._with_step_timeout(
                self._preflight_update(normalized_manifest, task_id),
                "preflight de actualizacion",
                timeout_seconds=30,
            )

            package_url = normalized_manifest["package_url"]
            package_path = await self._with_step_timeout(
                self._download_package(package_url, checksum, task_id, state),
                "descarga del paquete",
            )
            state.package_path = str(package_path)

            self._update_state(state, "backing_up_db", 42, "Creando backup de base de datos.")
            db_backup = await self._with_step_timeout(self._backup_database(task_id), "backup de base de datos")
            state.backup_path = str(db_backup) if db_backup else None

            self._update_state(state, "backing_up_code", 55, "Creando backup del codigo actual.")
            code_backup = await self._with_step_timeout(self._backup_code(PRODUCT_VERSION, task_id), "backup de codigo")
            state.rollback_path = str(code_backup)

            self._update_state(state, "extracting", 70, "Extrayendo paquete verificado.")
            extracted_dir = await self._with_step_timeout(
                self._extract_package(package_path, normalized_manifest, task_id),
                "extraccion del paquete",
            )
            state.extracted_path = str(extracted_dir)

            self._update_state(state, "ready_to_restart", 88, "Update preparado para aplicar en el proximo reinicio.")
            await self._with_step_timeout(self._write_update_ready_flag(extracted_dir), "preparacion del reinicio")

            if ENABLE_SELF_UPDATE_APPLY and force:
                state.status = "restarting"
                state.stage = "restarting"
                state.progress_pct = 95
                state.message = "Update preparado. Reiniciando servicio para aplicar cambios."
                state.completed_at = _utc_iso()
                self._append_event(state, "restarting", message=state.message, persist=False)
                self._persist_history()
                await asyncio.sleep(1)
                await self._restart_services()

            state.status = "done"
            state.stage = "prepared"
            state.progress_pct = 100
            state.message = (
                "Update descargado, verificado y preparado. Reinicia Treseko para que el entrypoint aplique "
                "el paquete antes de migrar la base."
            )
            state.completed_at = _utc_iso()
            self._append_event(state, "prepared", message=state.message, persist=False)
            self._persist_history()
        except Exception as exc:
            state.status = "failed"
            state.stage = "failed"
            state.error = str(exc)
            state.message = "No se pudo preparar la actualizacion."
            state.completed_at = _utc_iso()
            self._append_event(
                state,
                "failed",
                message=state.message,
                details={"error": state.error},
                persist=False,
            )
            self._persist_history()
            await self._report_failure_best_effort(state)

    async def _with_step_timeout(self, awaitable: Any, step_name: str, timeout_seconds: float | None = None) -> Any:
        timeout = UPDATE_STEP_TIMEOUT_SECONDS if timeout_seconds is None else float(timeout_seconds)
        if timeout <= 0:
            return await awaitable
        try:
            return await asyncio.wait_for(awaitable, timeout=timeout)
        except asyncio.TimeoutError as exc:
            raise TimeoutError(f"Timeout durante {step_name} despues de {timeout:.0f}s.") from exc

    def _normalize_manifest(self, manifest: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(manifest, dict):
            raise ValueError("El manifest debe ser un objeto JSON.")
        version = str(manifest.get("version") or manifest.get("latest_version") or "").strip()
        package_url = str(manifest.get("package_url") or manifest.get("download_url") or "").strip()
        checksum = str(manifest.get("checksum_sha256") or manifest.get("checksum") or "").strip().lower()
        if not version:
            raise ValueError("El manifest no incluye version.")
        if not package_url:
            raise ValueError("El manifest no incluye package_url/download_url.")
        if not re.fullmatch(r"[a-f0-9]{64}", checksum):
            raise ValueError("El checksum SHA-256 del manifest no es valido.")
        previous_version = str(manifest.get("previous_version") or "").strip()
        from_versions = manifest.get("from_versions")
        if previous_version and previous_version != PRODUCT_VERSION:
            raise ValueError(f"El paquete requiere actualizar desde {previous_version}; esta instalacion tiene {PRODUCT_VERSION}.")
        if isinstance(from_versions, list) and from_versions:
            allowed_sources = {str(item).strip() for item in from_versions if str(item).strip()}
            if PRODUCT_VERSION not in allowed_sources:
                raise ValueError("Esta version instalada no esta habilitada como origen para el paquete.")
        return {
            **manifest,
            "version": version,
            "package_url": package_url,
            "checksum_sha256": checksum,
        }

    async def _preflight_update(self, manifest: dict[str, Any], task_id: str) -> None:
        required_free_mb = int(os.getenv("TRESEKO_UPDATE_MIN_FREE_MB") or "1024")
        paths = {
            "updates": self.settings.updates_dir,
            "backups": self.settings.backups_dir,
        }
        for label, path in paths.items():
            path.mkdir(parents=True, exist_ok=True)
            usage = shutil.disk_usage(path)
            free_mb = usage.free // (1024 * 1024)
            if free_mb < required_free_mb:
                raise RuntimeError(f"Espacio insuficiente para updates en {label}: {free_mb} MB libres, minimo {required_free_mb} MB.")
        package_size = int(manifest.get("package_size_bytes") or 0)
        if package_size > 0:
            free_bytes = shutil.disk_usage(self.settings.updates_dir).free
            if free_bytes < package_size * 3:
                raise RuntimeError("Espacio insuficiente para descargar, extraer y respaldar el paquete de update.")
        if self.settings.database_url and not _pg_dump_url(self.settings.database_url):
            self._append_event(
                self._tasks[task_id],
                "preflight_warning",
                message="DATABASE_URL no es PostgreSQL; no se generara backup SQL automatico.",
                details={"database_backup": "skipped"},
            )

    async def _report_failure_best_effort(self, state: UpdateTaskState) -> None:
        if str(os.getenv("TRESEKO_UPDATE_DISABLE_FAILURE_REPORTS") or "").strip().lower() in {"1", "true", "yes", "on"}:
            return
        report_url = f"{self.update_server_url}/api/updates/failure-report"
        payload = {
            "task_id": state.task_id,
            "version": state.version,
            "previous_version": state.previous_version,
            "channel": state.channel,
            "edition": "premium" if str(state.channel).startswith("premium-") else "community",
            "status": state.status,
            "stage": state.stage,
            "error": state.error,
            "current_version": PRODUCT_VERSION,
            "events": list(state.events or [])[-50:],
            "diagnostics": {
                "platform": platform.system().lower() or "unknown",
                "python": platform.python_version(),
            },
        }
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=3.0)) as client:
                await client.post(report_url, json=payload)
        except Exception:
            return

    def _update_state(self, state: UpdateTaskState, stage: str, progress: int, message: str) -> None:
        state.stage = stage
        state.progress_pct = progress
        state.message = message
        self._append_event(state, stage, message=message, details={"progress_pct": progress}, persist=False)
        self._persist_history()

    def _append_event(
        self,
        state: UpdateTaskState,
        event: str,
        *,
        message: str | None = None,
        actor_email: str | None = None,
        actor_user_id: str | None = None,
        ip_address: str | None = None,
        details: dict[str, Any] | None = None,
        persist: bool = True,
    ) -> None:
        events = list(state.events or [])
        payload: dict[str, Any] = {
            "at": _utc_iso(),
            "event": str(event),
            "stage": state.stage,
            "status": state.status,
        }
        if message:
            payload["message"] = message
        actor_email = actor_email or state.initiated_by_email
        actor_user_id = actor_user_id or state.initiated_by_user_id
        ip_address = ip_address or state.initiated_from_ip
        if actor_email:
            payload["actor_email"] = actor_email
        if actor_user_id:
            payload["actor_user_id"] = actor_user_id
        if ip_address:
            payload["ip_address"] = ip_address
        if details:
            payload["details"] = details
        events.append(payload)
        state.events = events[-80:]
        if persist:
            self._persist_history()

    def _load_history(self) -> None:
        history_file = self.settings.history_file
        if not history_file.exists():
            return
        try:
            payload = json.loads(history_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        allowed = set(UpdateTaskState.__dataclass_fields__)
        changed = False
        for item in payload.get("tasks", []):
            if not isinstance(item, dict):
                continue
            data = {key: value for key, value in item.items() if key in allowed}
            task_id = str(data.get("task_id") or "").strip()
            if not task_id:
                continue
            try:
                state = UpdateTaskState(**data)
            except TypeError:
                continue
            if state.status in {"queued", "in_progress", "restarting"}:
                state.status = "failed"
                state.stage = "interrupted"
                state.progress_pct = min(state.progress_pct, 99)
                state.error = "El proceso se reinicio antes de terminar la tarea de update."
                state.message = "La tarea quedo interrumpida por reinicio del proceso."
                state.completed_at = state.completed_at or _utc_iso()
                changed = True
            self._tasks[task_id] = state
        if self._tasks:
            latest = max(
                self._tasks.values(),
                key=lambda item: item.started_at or item.completed_at or "",
            )
            self._latest_task_id = latest.task_id
        if changed:
            self._persist_history()

    def _persist_history(self) -> None:
        history_file = self.settings.history_file
        history_file.parent.mkdir(parents=True, exist_ok=True)
        tasks = sorted(
            self._tasks.values(),
            key=lambda item: item.started_at or item.completed_at or "",
            reverse=True,
        )
        max_items = max(20, self.settings.max_backups * 20)
        payload = {
            "updated_at": _utc_iso(),
            "tasks": [task.as_dict() for task in tasks[:max_items]],
        }
        tmp_file = history_file.with_name(f"{history_file.name}.{uuid.uuid4().hex}.tmp")
        tmp_file.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
        tmp_file.replace(history_file)
        self._schedule_db_history_persist(payload["tasks"])

    def _schedule_db_history_persist(self, tasks_snapshot: list[dict[str, Any]]) -> None:
        if not UPDATE_DB_HISTORY_ENABLED:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        if self._db_history_task and not self._db_history_task.done():
            self._db_history_dirty = True
            return
        snapshot = copy.deepcopy(tasks_snapshot)
        self._db_history_dirty = False
        self._db_history_task = loop.create_task(self._persist_db_history_snapshot(snapshot))

        def _reschedule_if_dirty(task: asyncio.Task[None]) -> None:
            if task.cancelled():
                return
            try:
                task.result()
            except Exception as exc:  # pragma: no cover - best effort background mirror
                logger.debug("No se pudo persistir historial de updates en DB: %s", exc)
            if self._db_history_dirty:
                latest = sorted(
                    self._tasks.values(),
                    key=lambda item: item.started_at or item.completed_at or "",
                    reverse=True,
                )
                self._schedule_db_history_persist([task_state.as_dict() for task_state in latest])

        self._db_history_task.add_done_callback(_reschedule_if_dirty)

    async def _persist_db_history_snapshot(self, tasks_snapshot: list[dict[str, Any]]) -> None:
        if not tasks_snapshot:
            return
        from sqlalchemy import delete, select
        from ..database import AsyncSessionLocal
        from .. import models

        async with AsyncSessionLocal() as session:
            for task_payload in tasks_snapshot:
                task_id = str(task_payload.get("task_id") or "").strip()
                if not task_id:
                    continue
                result = await session.execute(
                    select(models.SystemUpdateTask).where(models.SystemUpdateTask.task_id == task_id)
                )
                row = result.scalar_one_or_none()
                if row is None:
                    row = models.SystemUpdateTask(task_id=task_id)
                    session.add(row)
                self._copy_task_payload_to_db_row(row, task_payload)
                await session.flush()
                await session.execute(
                    delete(models.SystemUpdateEvent).where(models.SystemUpdateEvent.task_id == task_id)
                )
                for event_index, event_payload in enumerate(task_payload.get("events") or []):
                    if not isinstance(event_payload, dict):
                        continue
                    session.add(self._event_row_from_payload(task_id, event_index, event_payload))
            await session.commit()

    @staticmethod
    def _parse_iso_datetime(value: Any) -> datetime | None:
        if not value:
            return None
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None

    @staticmethod
    def _parse_uuid(value: Any) -> uuid.UUID | None:
        if not value:
            return None
        try:
            return uuid.UUID(str(value))
        except (TypeError, ValueError):
            return None

    def _copy_task_payload_to_db_row(self, row: Any, payload: dict[str, Any]) -> None:
        row.status = str(payload.get("status") or "idle")
        row.channel = str(payload.get("channel") or "")
        row.version = payload.get("version")
        row.previous_version = payload.get("previous_version")
        row.stage = payload.get("stage")
        row.progress_pct = int(payload.get("progress_pct") or 0)
        row.message = payload.get("message")
        row.error = payload.get("error")
        row.initiated_by_user_id = self._parse_uuid(payload.get("initiated_by_user_id"))
        row.initiated_by_email = payload.get("initiated_by_email")
        row.initiated_from_ip = payload.get("initiated_from_ip")
        row.apply_confirmation = payload.get("apply_confirmation")
        row.rollback_by_user_id = self._parse_uuid(payload.get("rollback_by_user_id"))
        row.rollback_by_email = payload.get("rollback_by_email")
        row.rollback_from_ip = payload.get("rollback_from_ip")
        row.rollback_requested_at = self._parse_iso_datetime(payload.get("rollback_requested_at"))
        row.rollback_confirmation = payload.get("rollback_confirmation")
        row.rollback_restore_database = bool(payload.get("rollback_restore_database"))
        row.backup_path = payload.get("backup_path")
        row.rollback_path = payload.get("rollback_path")
        row.package_path = payload.get("package_path")
        row.extracted_path = payload.get("extracted_path")
        row.started_at = self._parse_iso_datetime(payload.get("started_at"))
        row.completed_at = self._parse_iso_datetime(payload.get("completed_at"))
        row.payload = payload

    def _event_row_from_payload(self, task_id: str, event_index: int, payload: dict[str, Any]) -> Any:
        from .. import models

        return models.SystemUpdateEvent(
            task_id=task_id,
            event_index=event_index,
            event=str(payload.get("event") or ""),
            stage=payload.get("stage"),
            status=payload.get("status"),
            actor_user_id=self._parse_uuid(payload.get("actor_user_id")),
            actor_email=payload.get("actor_email"),
            ip_address=payload.get("ip_address"),
            message=payload.get("message"),
            details=payload.get("details") if isinstance(payload.get("details"), dict) else {},
            occurred_at=self._parse_iso_datetime(payload.get("at")),
            payload=payload,
        )

    async def _download_package(
        self,
        package_url: str,
        expected_checksum: str,
        task_id: str,
        state: UpdateTaskState,
    ) -> Path:
        downloads_dir = self.settings.updates_dir / "downloads"
        downloads_dir.mkdir(parents=True, exist_ok=True)
        package_path = downloads_dir / f"{task_id}.tar.gz"
        digest = hashlib.sha256()
        self._update_state(state, "downloading", 12, "Descargando paquete desde Update Server.")
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0, read=120.0)) as client:
            async with client.stream("GET", package_url) as response:
                response.raise_for_status()
                with package_path.open("wb") as fh:
                    async for chunk in response.aiter_bytes(chunk_size=1024 * 1024):
                        if not chunk:
                            continue
                        fh.write(chunk)
                        digest.update(chunk)
        actual_checksum = digest.hexdigest()
        self._update_state(state, "verifying", 35, "Verificando checksum SHA-256.")
        if actual_checksum.lower() != expected_checksum.lower():
            package_path.unlink(missing_ok=True)
            raise ValueError("El checksum del paquete descargado no coincide con el manifest.")
        return package_path

    async def _backup_database(self, task_id: str) -> Path | None:
        pg_url = _pg_dump_url(self.settings.database_url)
        if not pg_url:
            return None
        self.settings.backups_dir.mkdir(parents=True, exist_ok=True)
        backup_path = self.settings.backups_dir / f"pre-update-db-{task_id}.sql.gz"
        proc = await asyncio.create_subprocess_exec(
            self.settings.pg_dump_path,
            "--clean",
            "--if-exists",
            pg_url,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        assert proc.stdout is not None
        with gzip.open(backup_path, "wb") as out:
            while True:
                chunk = await proc.stdout.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            backup_path.unlink(missing_ok=True)
            raise RuntimeError(f"pg_dump fallo: {stderr.decode('utf-8', errors='replace')[:500]}")
        await asyncio.to_thread(self._rotate_backups, "pre-update-db-*.sql.gz")
        return backup_path

    async def _restore_database_backup(self, backup_path: Path, task_id: str) -> None:
        allow_db_rollback = str(os.getenv("TRESEKO_ALLOW_DB_ROLLBACK") or "").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        if not allow_db_rollback:
            raise ValueError("Rollback de base de datos deshabilitado. Define TRESEKO_ALLOW_DB_ROLLBACK=true para habilitarlo.")
        pg_url = _pg_dump_url(self.settings.database_url)
        if not pg_url:
            raise ValueError("DATABASE_URL no es PostgreSQL; no se puede restaurar backup SQL.")
        proc = await asyncio.create_subprocess_exec(
            self.settings.psql_path,
            pg_url,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        assert proc.stdin is not None
        try:
            reset_schema = (
                "DROP SCHEMA IF EXISTS public CASCADE;\n"
                "CREATE SCHEMA public;\n"
                "GRANT ALL ON SCHEMA public TO public;\n"
            )
            proc.stdin.write(reset_schema.encode("utf-8"))
            await proc.stdin.drain()
            with gzip.open(backup_path, "rb") as source:
                while True:
                    chunk = source.read(1024 * 1024)
                    if not chunk:
                        break
                    proc.stdin.write(chunk)
                    await proc.stdin.drain()
        finally:
            proc.stdin.close()
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(f"psql restore fallo para tarea {task_id}: {stderr.decode('utf-8', errors='replace')[:500]}")

    async def _restart_services(self) -> None:
        if self.settings.docker_mode:
            os._exit(0)
        proc = await asyncio.create_subprocess_exec(
            self.settings.systemctl_path,
            "restart",
            "--no-block",
            self.settings.systemd_service_name,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(
                "No se pudo solicitar reinicio systemd: "
                f"{stderr.decode('utf-8', errors='replace')[:500]}"
            )

    async def _backup_code(self, version: str, task_id: str) -> Path:
        self.settings.backups_dir.mkdir(parents=True, exist_ok=True)
        backup_path = self.settings.backups_dir / f"pre-update-code-{version}-{task_id}.tar.gz"

        def create_archive() -> None:
            with tarfile.open(backup_path, "w:gz") as tar:
                for label, path in {
                    "backend_app": self.settings.app_dir / "app",
                    "backend_alembic": self.settings.app_dir / "alembic",
                    "frontend_html": self.settings.frontend_dir,
                    "engine": self.settings.engine_dir,
                    "worker": self.settings.worker_dir,
                }.items():
                    if path.exists():
                        tar.add(path, arcname=label, recursive=True)

        await asyncio.to_thread(create_archive)
        await asyncio.to_thread(self._rotate_backups, "pre-update-code-*.tar.gz")
        return backup_path

    async def _restore_code_backup(self, backup_path: Path, task_id: str) -> None:
        restore_dir = self.settings.updates_dir / "rollback" / f"{backup_path.stem}-{task_id}"
        if restore_dir.exists():
            shutil.rmtree(restore_dir)
        restore_dir.mkdir(parents=True, exist_ok=True)

        def restore() -> None:
            with tarfile.open(backup_path, "r:gz") as tar:
                self._safe_extract(tar, restore_dir)

            targets = {
                "backend_app": self.settings.app_dir / "app",
                "backend_alembic": self.settings.app_dir / "alembic",
                "frontend_html": self.settings.frontend_dir,
                "engine": self.settings.engine_dir,
                "worker": self.settings.worker_dir,
            }
            for label, target in targets.items():
                source = restore_dir / label
                if not source.exists():
                    continue
                if target.exists():
                    if target.is_dir():
                        shutil.rmtree(target)
                    else:
                        target.unlink()
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copytree(source, target)

        try:
            await asyncio.to_thread(restore)
        finally:
            shutil.rmtree(restore_dir, ignore_errors=True)

    async def _extract_package(self, package_path: Path, manifest: dict[str, Any], task_id: str) -> Path:
        version = manifest["version"]
        extracted_dir = self.settings.updates_dir / "extracted" / f"{version}-{task_id}"
        if extracted_dir.exists():
            shutil.rmtree(extracted_dir)
        extracted_dir.mkdir(parents=True, exist_ok=True)

        def extract() -> None:
            with tarfile.open(package_path, "r:gz") as tar:
                self._safe_extract(tar, extracted_dir)

        await asyncio.to_thread(extract)
        self._validate_extracted_package_metadata(extracted_dir, manifest)
        return extracted_dir

    def _validate_extracted_package_metadata(self, extracted_dir: Path, manifest: dict[str, Any]) -> None:
        package_manifest_path = extracted_dir / "manifest.json"
        version_path = extracted_dir / "VERSION"
        changelog_path = extracted_dir / "CHANGELOG.md"
        if not package_manifest_path.exists():
            raise ValueError("El paquete no contiene manifest.json en la raiz.")
        if not version_path.exists():
            raise ValueError("El paquete no contiene VERSION en la raiz.")
        if not changelog_path.exists():
            raise ValueError("El paquete no contiene CHANGELOG.md en la raiz.")
        try:
            package_manifest = json.loads(package_manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError("El manifest interno del paquete no es JSON valido.") from exc
        if not isinstance(package_manifest, dict):
            raise ValueError("El manifest interno del paquete debe ser un objeto JSON.")
        expected_version = str(manifest.get("version") or "").strip()
        package_version = str(package_manifest.get("version") or "").strip()
        version_file = version_path.read_text(encoding="utf-8").strip()
        if package_version != expected_version or version_file != expected_version:
            raise ValueError("La version interna del paquete no coincide con el manifest autorizado.")
        if not changelog_path.read_text(encoding="utf-8").strip():
            raise ValueError("El CHANGELOG.md del paquete esta vacio.")
        for field_name in ("channel", "edition", "artifact"):
            expected = str(manifest.get(field_name) or "").strip()
            actual = str(package_manifest.get(field_name) or "").strip()
            if expected and actual and expected != actual:
                raise ValueError(f"El campo interno {field_name} no coincide con el manifest autorizado.")

    async def _write_update_ready_flag(self, extracted_dir: Path) -> None:
        self.settings.updates_dir.mkdir(parents=True, exist_ok=True)
        flag_file = self.settings.updates_dir / "update-ready"
        tmp_file = self.settings.updates_dir / f"update-ready.{uuid.uuid4().hex}.tmp"
        tmp_file.write_text(str(extracted_dir), encoding="utf-8")
        tmp_file.replace(flag_file)

    def _safe_extract(self, tar: tarfile.TarFile, target: Path) -> None:
        target_resolved = target.resolve()
        for member in tar.getmembers():
            member_path = (target / member.name).resolve()
            if target_resolved != member_path and target_resolved not in member_path.parents:
                raise ValueError("El paquete contiene rutas fuera del directorio de extraccion.")
            if member.issym() or member.islnk():
                raise ValueError("El paquete no puede contener links simbolicos o hardlinks.")
        tar.extractall(target)

    def _rotate_backups(self, pattern: str) -> None:
        backups = sorted(self.settings.backups_dir.glob(pattern), key=lambda path: path.stat().st_mtime, reverse=True)
        for old_backup in backups[self.settings.max_backups:]:
            old_backup.unlink(missing_ok=True)


_update_service: UpdateService | None = None


def get_update_service() -> UpdateService:
    global _update_service
    if _update_service is None:
        _update_service = UpdateService()
    return _update_service
