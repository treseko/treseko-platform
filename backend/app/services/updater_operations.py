from .updater import *
from .updater import _utc_iso, _pg_dump_url

async def check_community_update(self, channel: str | None = None, *, force_refresh: bool = False) -> dict[str, Any]:
    channel = channel if channel in COMMUNITY_UPDATE_CHANNELS else configured_community_update_channel()
    now = time.monotonic()
    cache_key = f"treseko:update:{channel}:latest"
    def cache_matches_installed_version(payload: dict[str, Any] | None) -> bool:
        if not isinstance(payload, dict):
            return False
        cached_current = str(payload.get("current_version") or "").strip()
        return not cached_current or cached_current == PRODUCT_VERSION
    if (
        not force_refresh
        and
        self._community_update_cache is not None
        and UPDATE_CHECK_CACHE_SECONDS > 0
        and now - self._community_update_cache_at < UPDATE_CHECK_CACHE_SECONDS
        and self._community_update_cache.get("channel") == channel
        and cache_matches_installed_version(self._community_update_cache)
    ):
        return copy.deepcopy(self._community_update_cache)
    cached = None if force_refresh else await self._get_redis_json(cache_key)
    if cached is not None and cache_matches_installed_version(cached):
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
        requested_version = str(manifest.get("version") or manifest.get("latest_version") or "").strip()
        for existing in self._tasks.values():
            if (
                existing.version == requested_version
                and existing.channel == channel
                and existing.stage in {"prepared", "restarting"}
            ):
                return existing.task_id
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

async def restart_prepared_update(self, task_id: str) -> dict[str, Any]:
    state = self._tasks.get(task_id)
    if not state or state.stage != "prepared":
        raise ValueError("No hay una actualizacion preparada para reiniciar.")
    if not ENABLE_SELF_UPDATE_APPLY:
        raise ValueError("La aplicacion automatica esta deshabilitada por configuracion.")
    state.status = "restarting"
    state.stage = "restarting"
    state.progress_pct = 95
    state.message = "Reinicio confirmado. Aplicando paquete y migraciones."
    self._append_event(state, "restarting", message=state.message, persist=False)
    self._persist_history()
    asyncio.create_task(self._restart_after_ack())
    return state.as_dict()

async def _restart_after_ack(self) -> None:
    await asyncio.sleep(1)
    await self._restart_services()

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
