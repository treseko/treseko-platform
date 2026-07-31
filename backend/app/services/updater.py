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
from ..runtime_environment import IS_PRODUCTION


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
    return IS_PRODUCTION


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
        # Mientras una tarea esta en curso, ``previous_version`` identifica
        # correctamente la version desde la que se esta actualizando. Una vez
        # aplicada, la version actual debe ser la que expone el proceso que ya
        # arranco con el paquete nuevo; conservar la anterior en este campo
        # hacia que la UI mostrara un estado final contradictorio.
        installed_version = (
            PRODUCT_VERSION
            if self.status == "done" and self.stage == "applied"
            else self.previous_version or PRODUCT_VERSION
        )
        pending_version = None if self.status == "done" and self.stage == "applied" else self.version
        return {
            "task_id": self.task_id,
            "status": self.status,
            "channel": self.channel,
            "current_version": installed_version,
            "pending_version": pending_version,
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

from . import updater_operations as _updater_operations
UpdateService.check_community_update = _updater_operations.check_community_update
UpdateService._redis_client = _updater_operations._redis_client
UpdateService._get_redis_json = _updater_operations._get_redis_json
UpdateService._set_redis_json = _updater_operations._set_redis_json
UpdateService.apply_update = _updater_operations.apply_update
UpdateService.validate_update_request = _updater_operations.validate_update_request
UpdateService.get_update_status = _updater_operations.get_update_status
UpdateService.get_update_history = _updater_operations.get_update_history
UpdateService.restart_prepared_update = _updater_operations.restart_prepared_update
UpdateService._restart_after_ack = _updater_operations._restart_after_ack
UpdateService.report_failure = _updater_operations.report_failure
UpdateService.rollback = _updater_operations.rollback

from . import updater_lifecycle as _updater_lifecycle
UpdateService._run_apply = _updater_lifecycle._run_apply
UpdateService._with_step_timeout = _updater_lifecycle._with_step_timeout
UpdateService._normalize_manifest = _updater_lifecycle._normalize_manifest
UpdateService._preflight_update = _updater_lifecycle._preflight_update
UpdateService._report_failure_best_effort = _updater_lifecycle._report_failure_best_effort

from . import updater_history as _updater_history
UpdateService._update_state = _updater_history._update_state
UpdateService._append_event = _updater_history._append_event
UpdateService._load_history = _updater_history._load_history
UpdateService._read_applied_update_task_id = _updater_history._read_applied_update_task_id
UpdateService._persist_history = _updater_history._persist_history
UpdateService._schedule_db_history_persist = _updater_history._schedule_db_history_persist
UpdateService._persist_db_history_snapshot = _updater_history._persist_db_history_snapshot
UpdateService._parse_iso_datetime = _updater_history._parse_iso_datetime
UpdateService._parse_uuid = _updater_history._parse_uuid
UpdateService._copy_task_payload_to_db_row = _updater_history._copy_task_payload_to_db_row
UpdateService._event_row_from_payload = _updater_history._event_row_from_payload

from . import updater_artifacts as _updater_artifacts
UpdateService._download_package = _updater_artifacts._download_package
UpdateService._backup_database = _updater_artifacts._backup_database
UpdateService._restore_database_backup = _updater_artifacts._restore_database_backup
UpdateService._restart_services = _updater_artifacts._restart_services
UpdateService._backup_code = _updater_artifacts._backup_code
UpdateService._restore_code_backup = _updater_artifacts._restore_code_backup
UpdateService._extract_package = _updater_artifacts._extract_package
UpdateService._validate_extracted_package_metadata = _updater_artifacts._validate_extracted_package_metadata
UpdateService._stage_next_entrypoint = _updater_artifacts._stage_next_entrypoint
UpdateService._write_update_ready_flag = _updater_artifacts._write_update_ready_flag
UpdateService._safe_extract = _updater_artifacts._safe_extract
UpdateService._rotate_backups = _updater_artifacts._rotate_backups

_update_service: UpdateService | None = None

def get_update_service() -> UpdateService:
    global _update_service
    if _update_service is None:
        _update_service = UpdateService()
    return _update_service
