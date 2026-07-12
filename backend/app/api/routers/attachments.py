from fastapi import APIRouter
from sqlalchemy import func
import hashlib
import re

from ...attachment_access import require_attachment_link_access
from ...content_type_validation import content_matches_declared_type
from ...main_context import *
from ...services.edition.entitlement_service import check_limit


router = APIRouter(tags=["attachments"])

# --- ENDPOINTS ATTACHMENTS / EVIDENCIAS ---
LEGACY_CONTENT_TYPE_EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "application/pdf": "pdf",
}
def _legacy_upload_content_matches_type(content_type: str, content: bytes) -> bool:
    if content_type == "application/pdf":
        return content.startswith(b"%PDF-")
    if content_type == "image/png":
        return content.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type in {"image/jpeg", "image/jpg"}:
        return content.startswith(b"\xff\xd8\xff")
    if content_type == "image/gif":
        return content.startswith((b"GIF87a", b"GIF89a"))
    return False


def _safe_upload_filename(filename: str | None) -> str:
    raw = os.path.basename(filename or "attachment").strip() or "attachment"
    safe = re.sub(r"[\x00-\x1f\x7f]+", "_", raw)
    safe = re.sub(r"[^A-Za-z0-9._ -]+", "_", safe).strip(" .") or "attachment"
    return safe[:schemas.MAX_ATTACHMENT_FILENAME_LENGTH]


def _upload_content_matches_declared_type(content_type: str, content: bytes) -> bool:
    return content_matches_declared_type(content_type, content)


async def _read_upload_limited(file: UploadFile, max_size_bytes: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_size_bytes:
            raise HTTPException(status_code=400, detail=f"El archivo supera el máximo permitido de {max_size_bytes // (1024 * 1024)} MB.")
        chunks.append(chunk)
    return b"".join(chunks)


async def _resolve_upload_project(
    db: AsyncSession,
    current_user: models.Usuario,
    project_id: UUID | None,
    level: str,
):
    if project_id:
        result = await db.execute(select(models.Proyecto).filter(models.Proyecto.id == project_id))
        project = result.scalar_one_or_none()
        if not project:
            raise HTTPException(status_code=404, detail="Proyecto no encontrado para el adjunto")
        await access_control.require_project_access(db, current_user, project.id, level)
        return project
    if access_control.is_global_admin(current_user):
        raise HTTPException(
            status_code=400,
            detail="Debe indicar project_id/proyecto_id para aplicar el limite de storage por solucion.",
        )
    result = await db.execute(
        select(models.Proyecto)
        .join(models.ProyectoMiembro, models.ProyectoMiembro.proyecto_id == models.Proyecto.id)
        .filter(models.ProyectoMiembro.usuario_id == current_user.id)
        .filter(models.Proyecto.activo == True)
    )
    projects = result.scalars().all()
    if len(projects) == 1:
        return projects[0]
    raise HTTPException(
        status_code=400,
        detail="Debe indicar project_id/proyecto_id para aplicar el limite de storage por solucion.",
    )


async def _enforce_storage_limit(db: AsyncSession, incoming_size_bytes: int, *, solution_id: UUID) -> None:
    result = await db.execute(
        select(func.coalesce(func.sum(models.Attachment.size), 0))
        .filter(models.Attachment.organizacion_id == solution_id)
    )
    current_bytes = int(result.scalar() or 0)
    mb = 1024 * 1024
    current_mb = (current_bytes + mb - 1) // mb
    incoming_mb = max(1, (incoming_size_bytes + mb - 1) // mb)
    check = await check_limit(
        db,
        "max_storage_mb",
        int(current_mb),
        increment=int(incoming_mb),
        tenant_id=str(solution_id),
    )
    if not check["allowed"]:
        raise HTTPException(
            status_code=403,
            detail=(
                "Limite de storage alcanzado para la solucion: "
                f"{current_bytes // (1024 * 1024)} MB usados de {check['limit']} MB."
            ),
        )

async def _project_id_for_step(db: AsyncSession, paso_id: UUID):
    result = await db.execute(
        select(models.CasoPrueba.proyecto_id)
        .join(models.PasoPrueba, models.PasoPrueba.caso_id == models.CasoPrueba.id)
        .filter(models.PasoPrueba.id == paso_id)
    )
    return result.scalar_one_or_none()


async def _project_id_for_snapshot(db: AsyncSession, snapshot_id: UUID):
    result = await db.execute(
        select(models.TestRun.proyecto_id)
        .join(models.EjecucionCaso, models.EjecucionCaso.test_run_id == models.TestRun.id)
        .join(models.SnapshotPaso, models.SnapshotPaso.ejecucion_caso_id == models.EjecucionCaso.id)
        .filter(models.SnapshotPaso.id == snapshot_id)
    )
    return result.scalar_one_or_none()


async def _project_id_for_execution(db: AsyncSession, ejecucion_id: UUID):
    result = await db.execute(
        select(models.TestRun.proyecto_id)
        .join(models.EjecucionCaso, models.EjecucionCaso.test_run_id == models.TestRun.id)
        .filter(models.EjecucionCaso.id == ejecucion_id)
    )
    return result.scalar_one_or_none()


async def _require_step_access(db: AsyncSession, current_user: models.Usuario, paso_id: UUID, level: str):
    proyecto_id = await _project_id_for_step(db, paso_id)
    if not proyecto_id:
        raise HTTPException(status_code=404, detail="Paso no encontrado")
    await access_control.require_project_access(db, current_user, proyecto_id, level)
    return proyecto_id


async def _require_snapshot_access(db: AsyncSession, current_user: models.Usuario, snapshot_id: UUID, level: str):
    proyecto_id = await _project_id_for_snapshot(db, snapshot_id)
    if not proyecto_id:
        raise HTTPException(status_code=404, detail="Snapshot no encontrado")
    await access_control.require_project_access(db, current_user, proyecto_id, level)
    return proyecto_id


async def _require_execution_access(db: AsyncSession, current_user: models.Usuario, ejecucion_id: UUID, level: str):
    proyecto_id = await _project_id_for_execution(db, ejecucion_id)
    if not proyecto_id:
        raise HTTPException(status_code=404, detail="Ejecucion no encontrada")
    await access_control.require_project_access(db, current_user, proyecto_id, level)

@router.get("/attachments/config/", response_model=schemas.AttachmentConfig)
async def get_attachment_config(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.adjuntos", "read"))
):
    return await crud.get_attachment_config(db)

@router.patch("/attachments/config/", response_model=schemas.AttachmentConfig)
async def update_attachment_config(
    request: Request,
    config: schemas.AttachmentConfig,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.adjuntos", "edit"))
):
    previous = await crud.get_attachment_config(db)
    updated = await crud.update_attachment_config(db, config)
    client_ip = request.client.host if request.client else "unknown"
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="UPDATE",
        recurso="attachment_config",
        detalles={
            "old_value": previous,
            "new_value": updated,
        },
        ip_address=client_ip,
    )
    return updated

@router.post("/attachments/", response_model=schemas.Attachment)
async def upload_attachment_v2(
    request: Request,
    file: UploadFile = File(...),
    scope: str = "EXECUTION_EVIDENCE",
    project_id: Optional[UUID] = None,
    proyecto_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_active_user)
):
    scope_normalized = (scope or "").upper()
    if scope_normalized == "EXECUTION_EVIDENCE":
        required_capability = "ejecutar.evidencias"
    elif scope_normalized.startswith("BUG_"):
        required_capability = "bugs.adjuntos"
    else:
        required_capability = "crear_pruebas.adjuntos"
    if not auth.has_capability_permission(current_user, required_capability, "edit"):
        raise HTTPException(status_code=403, detail="No tienes permisos para subir adjuntos")
    upload_project = await _resolve_upload_project(db, current_user, project_id or proyecto_id, "edit")
    config = await crud.get_attachment_config(db)
    content_type = (file.content_type or "application/octet-stream").split(";", 1)[0].strip().lower()
    if content_type not in config["allowed_mime_types"]:
        raise HTTPException(status_code=400, detail="Tipo de archivo no permitido por la configuracion actual.")
    max_size = int(config["max_file_size_mb"]) * 1024 * 1024
    content = await _read_upload_limited(file, max_size)
    await _enforce_storage_limit(db, len(content), solution_id=upload_project.organizacion_id)
    if not _upload_content_matches_declared_type(content_type, content):
        raise HTTPException(status_code=400, detail="El contenido del archivo no coincide con el tipo declarado.")
    attachment = await crud.create_attachment(
        db,
        filename_original=_safe_upload_filename(file.filename),
        content_type=content_type,
        content=content,
        created_by=current_user.id,
        scope=scope,
        proyecto_id=upload_project.id,
        organizacion_id=upload_project.organizacion_id,
    )
    client_ip = request.client.host if request.client else "unknown"
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="UPLOAD",
        recurso="attachment",
        recurso_id=attachment.id,
        detalles={
            "filename_original": attachment.filename_original,
            "content_type": attachment.content_type,
            "size": attachment.size,
            "sha256": attachment.sha256,
            "scope": attachment.scope,
        },
        ip_address=client_ip,
    )
    return attachment

@router.post("/pasos/{paso_id}/attachments/", response_model=schemas.PasoAttachment)
async def link_paso_attachment(
    paso_id: UUID,
    payload: schemas.AttachmentLinkCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.adjuntos", "edit"))
):
    proyecto_id = await _require_step_access(db, current_user, paso_id, "edit")
    attachment = await crud.get_attachment(db, payload.attachment_id)
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment no encontrado")
    await require_attachment_link_access(db, current_user, attachment, proyecto_id)
    config = await crud.get_attachment_config(db)
    existing = await crud.get_paso_attachments(db, paso_id)
    if len(existing) >= int(config["max_files_per_step"]):
        raise HTTPException(status_code=400, detail=f"El paso ya tiene el máximo de {config['max_files_per_step']} adjuntos.")
    return await crud.link_paso_attachment(db, paso_id, payload.attachment_id, payload.tipo)

@router.get("/pasos/{paso_id}/attachments/", response_model=List[schemas.PasoAttachment])
async def list_paso_attachments(
    paso_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.adjuntos", "read"))
):
    await _require_step_access(db, current_user, paso_id, "read")
    return await crud.get_paso_attachments(db, paso_id)

@router.delete("/pasos/{paso_id}/attachments/{attachment_id}/")
async def unlink_paso_attachment(
    paso_id: UUID,
    attachment_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.adjuntos", "edit"))
):
    await _require_step_access(db, current_user, paso_id, "edit")
    deleted = await crud.delete_paso_attachment(db, paso_id, attachment_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Vinculo no encontrado")
    return {"ok": True}

@router.post("/snapshots/{snapshot_id}/attachments/", response_model=schemas.SnapshotAttachment)
async def link_snapshot_attachment(
    snapshot_id: UUID,
    payload: schemas.AttachmentLinkCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("ejecutar.evidencias", "edit"))
):
    proyecto_id = await _require_snapshot_access(db, current_user, snapshot_id, "edit")
    attachment = await crud.get_attachment(db, payload.attachment_id)
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment no encontrado")
    await require_attachment_link_access(db, current_user, attachment, proyecto_id)
    config = await crud.get_attachment_config(db)
    existing = await crud.get_snapshot_attachments(db, snapshot_id)
    if len(existing) >= int(config["max_files_per_snapshot"]):
        raise HTTPException(status_code=400, detail=f"El snapshot ya tiene el máximo de {config['max_files_per_snapshot']} adjuntos.")
    return await crud.link_snapshot_attachment(db, snapshot_id, payload.attachment_id, payload.tipo)

@router.get("/snapshots/{snapshot_id}/attachments/", response_model=List[schemas.SnapshotAttachment])
async def list_snapshot_attachments(
    snapshot_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("ejecutar.evidencias", "read"))
):
    await _require_snapshot_access(db, current_user, snapshot_id, "read")
    return await crud.get_snapshot_attachments(db, snapshot_id)

@router.post("/ejecuciones/{ejecucion_id}/general-evidence-snapshot/", response_model=schemas.SnapshotPaso)
async def ensure_general_evidence_snapshot(
    ejecucion_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("ejecutar.evidencias", "edit"))
):
    await _require_execution_access(db, current_user, ejecucion_id, "edit")
    snapshot = await crud.get_or_create_general_evidence_snapshot(db, ejecucion_id)
    if not snapshot:
        raise HTTPException(status_code=404, detail="Ejecucion no encontrada")
    return snapshot

@router.delete("/snapshots/{snapshot_id}/attachments/{attachment_id}/")
async def unlink_snapshot_attachment(
    snapshot_id: UUID,
    attachment_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("ejecutar.evidencias", "edit"))
):
    await _require_snapshot_access(db, current_user, snapshot_id, "edit")
    deleted = await crud.delete_snapshot_attachment(db, snapshot_id, attachment_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Vinculo no encontrado")
    return {"ok": True}

@router.post("/attachments/legacy/")
async def upload_attachment(
    file: UploadFile = File(...),
    project_id: Optional[UUID] = None,
    proyecto_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("ejecutar.evidencias", "edit"))
):
    upload_project = await _resolve_upload_project(db, current_user, project_id or proyecto_id, "edit")
    # Validar tipo de archivo
    allowed_types = list(LEGACY_CONTENT_TYPE_EXTENSIONS.keys())
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Tipo de archivo no permitido. Solo se permiten imágenes (PNG, JPG, GIF) y PDFs.")

    # Validar tamaño (máximo 10MB) sin cargar archivos enormes en memoria
    content = await _read_upload_limited(file, 10 * 1024 * 1024)
    file_size = len(content)
    await _enforce_storage_limit(db, file_size, solution_id=upload_project.organizacion_id)
    if not _legacy_upload_content_matches_type(file.content_type, content):
        raise HTTPException(status_code=400, detail="El contenido del archivo no coincide con el tipo declarado.")
    
    # Generar nombre único usando el content-type validado, no la extension enviada por el cliente
    file_extension = LEGACY_CONTENT_TYPE_EXTENSIONS[file.content_type]
    unique_filename = f"{uuid.uuid4()}.{file_extension}"
    
    # Guardar archivo
    evidence_dir = STATIC_ROOT / "evidencias"
    evidence_dir.mkdir(parents=True, exist_ok=True)
    file_path = str(evidence_dir / unique_filename)
    with open(file_path, "wb") as f:
        f.write(content)
    
    # Retornar URL pública
    file_url = f"/static/evidencias/{unique_filename}"
    sha256 = hashlib.sha256(content).hexdigest()
    attachment = models.Attachment(
        filename_original=_safe_upload_filename(file.filename),
        content_type=file.content_type,
        size=file_size,
        sha256=sha256,
        storage_path=file_path.replace("\\", "/"),
        public_url=file_url,
        scope="EXECUTION_EVIDENCE_LEGACY",
        proyecto_id=upload_project.id,
        organizacion_id=upload_project.organizacion_id,
        created_by=current_user.id,
    )
    db.add(attachment)
    await db.commit()
    
    return {
        "url": file_url,
        "filename": unique_filename,
        "attachment_id": str(attachment.id),
        "size": file_size,
        "content_type": file.content_type
    }
