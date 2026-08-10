from .updater import *
from .updater import _pg_dump_url, _utc_iso

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

        await self._with_step_timeout(
            self._stage_next_entrypoint(extracted_dir),
            "preparacion del entrypoint",
        )

        self._update_state(state, "ready_to_restart", 88, "Update preparado para aplicar en el proximo reinicio.")
        await self._with_step_timeout(
            self._write_update_ready_flag(extracted_dir, task_id=task_id, version=state.version),
            "preparacion del reinicio",
        )

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
