from .legacy_common import *
from .core_settings_ai_workflow_helpers import (
    _create_artifact_attachment_no_commit,
    _project_context_for_automation_job,
    _project_context_for_execution,
)


SAFE_ATTACHMENT_EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "application/pdf": "pdf",
    "text/plain": "txt",
    "text/csv": "csv",
    "application/json": "json",
    "application/xml": "xml",
    "text/xml": "xml",
    "application/zip": "zip",
    "application/x-zip-compressed": "zip",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "application/octet-stream": "bin",
}


def _safe_attachment_extension(content_type: str) -> str:
    return SAFE_ATTACHMENT_EXTENSIONS.get((content_type or "").split(";", 1)[0].strip().lower(), "bin")


async def _probe_redis_component():
    redis_url = os.getenv("REDIS_URL", "").strip()
    target = redis_url or f"{SYSTEM_MONITOR_REDIS_HOST}:{SYSTEM_MONITOR_REDIS_PORT}"
    started = asyncio.get_running_loop().time()
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(SYSTEM_MONITOR_REDIS_HOST, SYSTEM_MONITOR_REDIS_PORT),
            timeout=1.5,
        )
        writer.close()
        await writer.wait_closed()
        return _monitor_component(
            "redis",
            "Redis",
            "CACHE",
            "ONLINE",
            target=target,
            latency_ms=int((asyncio.get_running_loop().time() - started) * 1000),
            detail="Puerto Redis disponible",
        )
    except Exception as exc:
        status = "OFFLINE" if redis_url else "NOT_CONFIGURED"
        detail = str(exc) if redis_url else "REDIS_URL no configurado y localhost:6379 no responde"
        return _monitor_component(
            "redis",
            "Redis",
            "CACHE",
            status,
            target=target,
            latency_ms=int((asyncio.get_running_loop().time() - started) * 1000),
            detail=detail,
        )


def _effective_runner_status(runner: models.AutomationRunner):
    if not runner.activo:
        return "DISABLED"
    if not runner.ultimo_heartbeat:
        return "OFFLINE"
    last_seen = ensure_utc(runner.ultimo_heartbeat)
    if utc_now() - last_seen > timedelta(seconds=60):
        return "OFFLINE"
    return runner.estado or "ONLINE"


async def get_system_monitor_summary(db: AsyncSession):
    engine_url = ENGINE_URL.rstrip("/")
    backend = _monitor_component(
        "backend",
        "Backend FastAPI",
        "API",
        "ONLINE",
        target="http://backend:8000" if IS_PRODUCTION_MONITOR else "http://127.0.0.1:8000",
        detail="API respondio esta solicitud",
    )
    frontend_name = "Frontend Nginx" if IS_PRODUCTION_MONITOR else "Frontend Vite"
    frontend_task = _probe_http_component("frontend", frontend_name, SYSTEM_MONITOR_FRONTEND_URL)
    database_task = _probe_database_component(db)
    redis_task = _probe_redis_component()
    components = [backend, *(await asyncio.gather(frontend_task, database_task, redis_task))]

    engine_started = asyncio.get_running_loop().time()
    engine_health = await check_ai_engine_health(db)
    engine_status = "ONLINE" if engine_health.get("status") == "ok" else ("DEGRADED" if engine_health.get("engine") else "OFFLINE")
    components.append(
        _monitor_component(
            "ai_engine",
            "Motor IA",
            "AI_ENGINE",
            engine_status,
            target=f"{engine_url}/health",
            latency_ms=int((asyncio.get_running_loop().time() - engine_started) * 1000),
            detail=engine_health.get("detail") or "Health OK",
        )
    )

    runners_result = await db.execute(select(models.AutomationRunner).order_by(models.AutomationRunner.fecha_creacion.desc()))
    workers = []
    has_worker_issue = False
    for runner in runners_result.scalars().all():
        capabilities = runner.capabilities or {}
        resources = capabilities.get("resources") or {}
        status = _effective_runner_status(runner)
        if runner.activo and status not in {"ONLINE", "BUSY", "RUNNING"}:
            has_worker_issue = True
        workers.append(
            {
                "runner_id": runner.id,
                "name": runner.nombre,
                "type": runner.tipo,
                "status": status,
                "active": runner.activo,
                "last_heartbeat": runner.ultimo_heartbeat,
                "hostname": capabilities.get("hostname"),
                "local_ips": capabilities.get("local_ips") or [],
                "pid": capabilities.get("pid"),
                "tags": capabilities.get("tags") or [],
                "capabilities": capabilities,
                "resources": resources,
                "active_jobs": int(capabilities.get("active_jobs") or 0),
                "current_job_id": capabilities.get("current_job_id"),
                "uptime_seconds": capabilities.get("uptime_seconds"),
            }
        )

    counted_components = [component for component in components if component["status"] != "NOT_CONFIGURED"]
    online_components = [component for component in counted_components if component["status"] == "ONLINE"]
    uptime_percent = int(round((len(online_components) / len(counted_components)) * 100)) if counted_components else 0
    if uptime_percent == 100 and not has_worker_issue:
        overall_status = "ONLINE"
    elif uptime_percent == 0:
        overall_status = "OFFLINE"
    else:
        overall_status = "DEGRADED"

    return {
        "overall_status": overall_status,
        "uptime_percent": uptime_percent,
        "components": components,
        "workers": workers,
        "restart_hints": SYSTEM_RESTART_HINTS,
        "checked_at": utc_now(),
    }


async def create_attachment(
    db: AsyncSession,
    filename_original: str,
    content_type: str,
    content: bytes,
    created_by: UUID,
    scope: str,
    proyecto_id: UUID | None = None,
    organizacion_id: UUID | None = None,
):
    sha256 = hashlib.sha256(content).hexdigest()
    ext = _safe_attachment_extension(content_type)
    rel_dir = os.path.join(sha256[:2], sha256[2:4])
    abs_dir = os.path.join(ATTACHMENTS_DIR, rel_dir)
    os.makedirs(abs_dir, exist_ok=True)
    filename = f"{sha256}.{ext}"
    storage_path = os.path.join(abs_dir, filename)
    if not os.path.exists(storage_path):
        with open(storage_path, "wb") as output:
            output.write(content)

    public_path = f"/static/attachments/{sha256[:2]}/{sha256[2:4]}/{filename}"
    db_attachment = models.Attachment(
        filename_original=filename_original or filename,
        content_type=content_type,
        size=len(content),
        sha256=sha256,
        storage_path=storage_path.replace("\\", "/"),
        public_url=public_path,
        scope=scope,
        proyecto_id=proyecto_id,
        organizacion_id=organizacion_id,
        created_by=created_by,
    )
    db.add(db_attachment)
    await db.commit()
    await db.refresh(db_attachment)
    return db_attachment


async def get_attachment(db: AsyncSession, attachment_id: UUID):
    result = await db.execute(select(models.Attachment).filter(models.Attachment.id == attachment_id))
    return result.scalar_one_or_none()


async def link_paso_attachment(db: AsyncSession, paso_id: UUID, attachment_id: UUID, tipo: str):
    result = await db.execute(
        select(models.PasoAttachment)
        .filter(models.PasoAttachment.paso_id == paso_id)
        .filter(models.PasoAttachment.attachment_id == attachment_id)
        .filter(models.PasoAttachment.tipo == tipo)
    )
    existing = result.scalar_one_or_none()
    if existing:
        return await get_paso_attachment(db, existing.id)
    link = models.PasoAttachment(paso_id=paso_id, attachment_id=attachment_id, tipo=tipo)
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return await get_paso_attachment(db, link.id)


async def get_paso_attachment(db: AsyncSession, link_id: UUID):
    result = await db.execute(
        select(models.PasoAttachment)
        .options(selectinload(models.PasoAttachment.attachment))
        .filter(models.PasoAttachment.id == link_id)
    )
    return result.scalar_one_or_none()


async def get_paso_attachments(db: AsyncSession, paso_id: UUID):
    result = await db.execute(
        select(models.PasoAttachment)
        .options(selectinload(models.PasoAttachment.attachment))
        .filter(models.PasoAttachment.paso_id == paso_id)
        .order_by(models.PasoAttachment.created_at)
    )
    return result.scalars().all()


async def delete_paso_attachment(db: AsyncSession, paso_id: UUID, attachment_id: UUID):
    result = await db.execute(
        select(models.PasoAttachment)
        .filter(models.PasoAttachment.paso_id == paso_id)
        .filter(models.PasoAttachment.attachment_id == attachment_id)
    )
    links = result.scalars().all()
    for link in links:
        await db.delete(link)
    await db.commit()
    return bool(links)


async def link_snapshot_attachment(db: AsyncSession, snapshot_id: UUID, attachment_id: UUID, tipo: str):
    result = await db.execute(
        select(models.SnapshotAttachment)
        .filter(models.SnapshotAttachment.snapshot_id == snapshot_id)
        .filter(models.SnapshotAttachment.attachment_id == attachment_id)
        .filter(models.SnapshotAttachment.tipo == tipo)
    )
    existing = result.scalar_one_or_none()
    if existing:
        return await get_snapshot_attachment(db, existing.id)
    link = models.SnapshotAttachment(snapshot_id=snapshot_id, attachment_id=attachment_id, tipo=tipo)
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return await get_snapshot_attachment(db, link.id)


async def get_snapshot_attachment(db: AsyncSession, link_id: UUID):
    result = await db.execute(
        select(models.SnapshotAttachment)
        .options(selectinload(models.SnapshotAttachment.attachment))
        .filter(models.SnapshotAttachment.id == link_id)
    )
    return result.scalar_one_or_none()


async def get_snapshot_attachments(db: AsyncSession, snapshot_id: UUID):
    result = await db.execute(
        select(models.SnapshotAttachment)
        .options(selectinload(models.SnapshotAttachment.attachment))
        .filter(models.SnapshotAttachment.snapshot_id == snapshot_id)
        .order_by(models.SnapshotAttachment.created_at)
    )
    return result.scalars().all()


async def delete_snapshot_attachment(db: AsyncSession, snapshot_id: UUID, attachment_id: UUID):
    result = await db.execute(
        select(models.SnapshotAttachment)
        .filter(models.SnapshotAttachment.snapshot_id == snapshot_id)
        .filter(models.SnapshotAttachment.attachment_id == attachment_id)
    )
    links = result.scalars().all()
    for link in links:
        await db.delete(link)
    await db.commit()
    return bool(links)


async def get_or_create_general_evidence_snapshot(db: AsyncSession, ejecucion_id: UUID):
    result = await db.execute(
        select(models.SnapshotPaso)
        .filter(models.SnapshotPaso.ejecucion_caso_id == ejecucion_id)
        .filter(models.SnapshotPaso.numero_paso == 0)
    )
    snapshot = result.scalar_one_or_none()
    if snapshot:
        return snapshot

    execution_result = await db.execute(
        select(models.EjecucionCaso).filter(models.EjecucionCaso.id == ejecucion_id)
    )
    execution = execution_result.scalar_one_or_none()
    if not execution:
        return None

    snapshot = models.SnapshotPaso(
        ejecucion_caso_id=ejecucion_id,
        paso_id=None,
        numero_paso=0,
        accion_congelada="Evidencia general de ejecucion",
        datos_congelados=None,
        resultado_esperado_congelado="Veredicto general del caso",
        estado_paso=models.EstadoResultado.SIN_CORRER,
        comentarios=None,
    )
    db.add(snapshot)
    await db.commit()
    await db.refresh(snapshot)
    return snapshot


async def _persist_automation_artifacts(
    db: AsyncSession,
    job: models.AutomationJob,
    artifacts: List[schemas.AutomationJobResultArtifact],
    snapshots_by_number: Optional[Dict[int, models.SnapshotPaso]] = None,
    default_snapshot: Optional[models.SnapshotPaso] = None,
):
    persisted = []
    snapshots_by_number = snapshots_by_number or {}
    project_id, solution_id = await _project_context_for_automation_job(db, job)
    for index, artifact in enumerate(artifacts or [], start=1):
        content_type = artifact.content_type or "image/png"
        if content_type not in CONTENT_TYPE_EXTENSIONS:
            continue
        try:
            content = base64.b64decode(artifact.base64, validate=True)
        except (binascii.Error, ValueError):
            continue
        if not content or len(content) > 10 * 1024 * 1024:
            continue
        if not _content_matches_declared_type(content_type, content):
            continue
        filename = _safe_artifact_filename(
            artifact.filename,
            content_type,
            f"automation-job-{str(job.id)[:8]}-{index}",
        )
        attachment = await _create_artifact_attachment_no_commit(
            db,
            filename_original=filename,
            content_type=content_type,
            content=content,
            created_by=job.creado_por,
            proyecto_id=project_id,
            organizacion_id=solution_id,
        )
        target_snapshot = snapshots_by_number.get(artifact.step_number or -1) or default_snapshot
        if target_snapshot:
            existing_result = await db.execute(
                select(models.SnapshotAttachment)
                .filter(models.SnapshotAttachment.snapshot_id == target_snapshot.id)
                .filter(models.SnapshotAttachment.attachment_id == attachment.id)
                .filter(models.SnapshotAttachment.tipo == "AUTOMATION_EVIDENCE")
            )
            if not existing_result.scalar_one_or_none():
                db.add(models.SnapshotAttachment(
                    snapshot_id=target_snapshot.id,
                    attachment_id=attachment.id,
                    tipo="AUTOMATION_EVIDENCE",
                ))
            if not target_snapshot.evidencia_url:
                target_snapshot.evidencia_url = attachment.public_url
        item = _attachment_to_dict(attachment)
        item["type"] = artifact.type or "screenshot"
        item["step_number"] = artifact.step_number
        item["snapshot_id"] = str(target_snapshot.id) if target_snapshot else None
        persisted.append(item)
    return persisted


async def _persist_ai_screenshot(
    db: AsyncSession,
    execution: models.EjecucionCaso,
    snapshot: Optional[models.SnapshotPaso],
    filename: str,
    screenshot_base64: Optional[str],
):
    if not screenshot_base64:
        return None
    try:
        content = base64.b64decode(screenshot_base64, validate=True)
    except (binascii.Error, ValueError):
        return None
    if not content or len(content) > 10 * 1024 * 1024:
        return None
    if not _content_matches_declared_type("image/png", content):
        return None
    project_id, solution_id = await _project_context_for_execution(db, execution)
    attachment = await _create_artifact_attachment_no_commit(
        db,
        filename_original=_safe_artifact_filename(filename, "image/png", filename),
        content_type="image/png",
        content=content,
        created_by=execution.ejecutado_por,
        proyecto_id=project_id,
        organizacion_id=solution_id,
    )
    if snapshot:
        db.add(models.SnapshotAttachment(
            snapshot_id=snapshot.id,
            attachment_id=attachment.id,
            tipo="AI_ENGINE_EVIDENCE",
        ))
        if not snapshot.evidencia_url:
            snapshot.evidencia_url = attachment.public_url
    return _attachment_to_dict(attachment)

# --- ROLES PERSONALIZADOS ---
