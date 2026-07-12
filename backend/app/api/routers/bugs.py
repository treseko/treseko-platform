from typing import Annotated

from fastapi import APIRouter

from ...attachment_access import require_attachment_link_access
from ...main_context import *
from ...main_context import _emit_bug_event
from ...services.edition.entitlement_service import require_feature


router = APIRouter(tags=["bugs"])
BUG_CLOSED_STATES = {"RESUELTO", "CERRADO", "DUPLICADO", "NO_REPRODUCIBLE", "NO_CORRESPONDE"}

# --- ENDPOINTS BUG TRACKER INTERNO ---

async def _ensure_bug_build_is_active(db: AsyncSession, bug: models.BugIssue) -> None:
    if not bug.build_id:
        return
    build_active = (
        await db.execute(select(models.Build.activo).filter(models.Build.id == bug.build_id))
    ).scalar_one_or_none()
    if build_active is not False:
        return

    if bug.caso_id:
        bug_case = (
            await db.execute(select(models.CasoPrueba).filter(models.CasoPrueba.id == bug.caso_id))
        ).scalar_one_or_none()
        if bug_case:
            active_tracking_build = (
                await db.execute(
                    select(models.Build.id)
                    .join(models.BuildCaso, models.BuildCaso.build_id == models.Build.id)
                    .join(models.CasoPrueba, models.CasoPrueba.id == models.BuildCaso.caso_id)
                    .filter(models.Build.proyecto_id == bug.proyecto_id)
                    .filter(models.Build.activo == True)  # noqa: E712
                    .filter(models.CasoPrueba.master_id == bug_case.master_id)
                    .limit(1)
                )
            ).scalar_one_or_none()
            if active_tracking_build:
                return

    metadata = bug.metadata_json if isinstance(bug.metadata_json, dict) else {}
    occurrence_build_ids = [
        item.get("build_id")
        for item in (metadata.get("linked_execution_occurrences") or [])
        if isinstance(item, dict) and item.get("build_id")
    ]
    if occurrence_build_ids:
        active_occurrence = (
            await db.execute(
                select(models.Build.id)
                .filter(models.Build.id.in_(occurrence_build_ids))
                .filter(models.Build.proyecto_id == bug.proyecto_id)
                .filter(models.Build.activo == True)  # noqa: E712
                .limit(1)
            )
        ).scalar_one_or_none()
        if active_occurrence:
            return

    raise HTTPException(
        status_code=409,
        detail="La build origen del bug está inactiva. Para modificarlo, registra seguimiento en una build activa del mismo caso o reabre una build vigente.",
    )

@router.get("/proyectos/{proyecto_id}/bugs", response_model=schemas.BugListResponse)
@router.get("/proyectos/{proyecto_id}/bugs/", response_model=schemas.BugListResponse)
async def read_project_bugs(
    proyecto_id: UUID,
    q: Annotated[Optional[str], Query(max_length=200)] = None,
    estado: Annotated[Optional[str], Query(max_length=50)] = None,
    severidad: Annotated[Optional[str], Query(max_length=50)] = None,
    prioridad: Annotated[Optional[str], Query(max_length=50)] = None,
    componente_id: Optional[UUID] = None,
    build_id: Optional[UUID] = None,
    caso_id: Optional[UUID] = None,
    ejecucion_id: Optional[UUID] = None,
    snapshot_id: Optional[UUID] = None,
    asignado_a: Optional[UUID] = None,
    creado_por: Optional[UUID] = None,
    external_provider: Annotated[Optional[str], Query(max_length=80)] = None,
    has_external: Optional[bool] = None,
    origen: Annotated[Optional[str], Query(max_length=80)] = None,
    desde: Optional[datetime] = None,
    hasta: Optional[datetime] = None,
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("bugs.ver", "read"))
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    return await crud.list_project_bugs(
        db,
        proyecto_id,
        q=q,
        estado=estado,
        severidad=severidad,
        prioridad=prioridad,
        componente_id=componente_id,
        build_id=build_id,
        caso_id=caso_id,
        ejecucion_id=ejecucion_id,
        snapshot_id=snapshot_id,
        asignado_a=asignado_a,
        creado_por=creado_por,
        external_provider=external_provider,
        has_external=has_external,
        origen=origen,
        desde=desde,
        hasta=hasta,
        skip=skip,
        limit=limit,
    )

@router.get("/proyectos/{proyecto_id}/bugs/summary/", response_model=schemas.BugSummaryResponse)
async def read_project_bugs_summary(
    proyecto_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("bugs.ver", "read"))
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    return await crud.summarize_project_bugs(db, proyecto_id)

@router.get("/proyectos/{proyecto_id}/bugs/dedupe-suggestions/", response_model=List[schemas.BugDedupeSuggestionResponse])
async def read_project_bug_dedupe_suggestions(
    proyecto_id: UUID,
    dedupe_hash: Optional[str] = None,
    q: Annotated[Optional[str], Query(max_length=200)] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("bugs.ver", "read")),
    _premium_bugs: None = Depends(require_feature("bugs.enterprise")),
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    return await crud.bug_dedupe_suggestions(db, proyecto_id, dedupe_hash=dedupe_hash, q=q, limit=limit)

@router.get("/casos/{caso_id}/bugs/relacionados/", response_model=List[schemas.BugIssueResponse])
async def read_related_case_bugs(
    caso_id: UUID,
    include_closed: bool = True,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("bugs.ver", "read")),
):
    case = (
        await db.execute(select(models.CasoPrueba).filter(models.CasoPrueba.id == caso_id))
    ).scalar_one_or_none()
    if not case:
        raise HTTPException(status_code=404, detail="Caso de prueba no encontrado")
    await access_control.require_project_access(db, current_user, case.proyecto_id, "read")
    bugs = await crud.list_related_bugs_for_case(db, caso_id, include_closed=include_closed)
    return bugs or []

@router.get("/bugs/{bug_id}/", response_model=schemas.BugIssueResponse)
async def read_bug_detail(
    bug_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("bugs.ver", "read"))
):
    bug = await crud.get_bug_issue(db, bug_id)
    if not bug:
        raise HTTPException(status_code=404, detail="Bug no encontrado")
    await access_control.require_project_access(db, current_user, bug.proyecto_id, "read")
    return bug

@router.post("/bugs", response_model=schemas.BugIssueResponse)
@router.post("/bugs/", response_model=schemas.BugIssueResponse)
async def create_bug(
    payload: schemas.BugIssueCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("bugs.crear", "edit"))
):
    await access_control.require_project_access(db, current_user, payload.proyecto_id, "edit")
    try:
        bug = await crud.create_bug_issue(db, payload, current_user.id)
        await _emit_bug_event(db, "bug.created", bug, current_user)
        return bug
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

@router.post("/snapshots/{snapshot_id}/bugs/", response_model=schemas.BugIssueResponse)
async def create_bug_from_snapshot(
    snapshot_id: UUID,
    payload: schemas.BugIssueUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("bugs.crear", "edit"))
):
    project_result = await db.execute(
        select(models.TestRun.proyecto_id)
        .join(models.EjecucionCaso, models.EjecucionCaso.test_run_id == models.TestRun.id)
        .join(models.SnapshotPaso, models.SnapshotPaso.ejecucion_caso_id == models.EjecucionCaso.id)
        .filter(models.SnapshotPaso.id == snapshot_id)
    )
    proyecto_id = project_result.scalar_one_or_none()
    if not proyecto_id:
        raise HTTPException(status_code=404, detail="Snapshot no encontrado")
    await access_control.require_project_access(db, current_user, proyecto_id, "edit")
    try:
        bug = await crud.create_bug_from_snapshot(db, snapshot_id, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if not bug:
        raise HTTPException(status_code=404, detail="Snapshot no encontrado")
    await _emit_bug_event(db, "bug.created_from_snapshot", bug, current_user)
    return bug

@router.post("/ejecuciones/{ejecucion_id}/bugs/", response_model=schemas.BugIssueResponse)
async def create_bug_from_execution(
    ejecucion_id: UUID,
    payload: schemas.BugIssueUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("bugs.crear", "edit"))
):
    project_result = await db.execute(
        select(models.TestRun.proyecto_id)
        .join(models.EjecucionCaso, models.EjecucionCaso.test_run_id == models.TestRun.id)
        .filter(models.EjecucionCaso.id == ejecucion_id)
    )
    proyecto_id = project_result.scalar_one_or_none()
    if not proyecto_id:
        raise HTTPException(status_code=404, detail="Ejecucion no encontrada")
    await access_control.require_project_access(db, current_user, proyecto_id, "edit")
    try:
        bug = await crud.create_bug_from_execution(db, ejecucion_id, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if not bug:
        raise HTTPException(status_code=404, detail="Ejecucion no encontrada")
    await _emit_bug_event(db, "bug.created_from_execution", bug, current_user)
    return bug

@router.patch("/bugs/{bug_id}", response_model=schemas.BugIssueResponse)
async def update_bug(
    bug_id: UUID,
    payload: schemas.BugIssueUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("bugs.editar", "edit"))
):
    bug = await crud.get_bug_issue(db, bug_id)
    if not bug:
        raise HTTPException(status_code=404, detail="Bug no encontrado")
    await access_control.require_project_access(db, current_user, bug.proyecto_id, "edit")
    await _ensure_bug_build_is_active(db, bug)
    old_state = {"asignado_a": bug.asignado_a, "severidad": bug.severidad, "prioridad": bug.prioridad}
    updated = await crud.update_bug_issue(db, bug_id, payload)
    if payload.asignado_a is not None and old_state["asignado_a"] != updated.asignado_a:
        await _emit_bug_event(db, "bug.assigned", updated, current_user)
    if payload.severidad is not None and old_state["severidad"] != updated.severidad:
        await _emit_bug_event(db, "bug.severity_changed", updated, current_user, {"old_value": old_state["severidad"], "new_value": updated.severidad})
    if payload.prioridad is not None and old_state["prioridad"] != updated.prioridad:
        await _emit_bug_event(db, "bug.priority_changed", updated, current_user, {"old_value": old_state["prioridad"], "new_value": updated.prioridad})
    await _emit_bug_event(db, "bug.updated", updated, current_user)
    return updated

@router.post("/bugs/{bug_id}/link-execution/", response_model=schemas.BugIssueResponse)
async def link_bug_execution(
    bug_id: UUID,
    payload: schemas.BugExecutionLinkRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("bugs.editar", "edit")),
):
    bug = await crud.get_bug_issue(db, bug_id)
    if not bug:
        raise HTTPException(status_code=404, detail="Bug no encontrado")
    await access_control.require_project_access(db, current_user, bug.proyecto_id, "edit")
    for attachment_id in payload.attachment_ids or []:
        attachment = await crud.get_attachment(db, attachment_id)
        if not attachment:
            raise HTTPException(status_code=404, detail="Attachment no encontrado")
        await require_attachment_link_access(db, current_user, attachment, bug.proyecto_id)
    old_status = bug.estado
    try:
        updated = await crud.link_bug_to_execution(db, bug_id, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if not updated:
        raise HTTPException(status_code=404, detail="Bug o ejecución no encontrados")
    event_type = "bug.reopened" if old_status in BUG_CLOSED_STATES and updated.estado == "REABIERTO" else "bug.execution_linked"
    occurrence_created = getattr(updated, "_occurrence_created", True)
    if occurrence_created or event_type == "bug.reopened":
        await _emit_bug_event(
            db,
            event_type,
            updated,
            current_user,
            {
                "old_value": old_status,
                "new_value": updated.estado,
                "ejecucion_id": str(payload.ejecucion_id),
                "snapshot_id": str(payload.snapshot_id) if payload.snapshot_id else None,
            },
        )
    return updated

@router.post("/bugs/{bug_id}/transition/", response_model=schemas.BugIssueResponse)
async def transition_bug(
    bug_id: UUID,
    payload: schemas.BugTransitionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("bugs.triage", "edit"))
):
    bug = await crud.get_bug_issue(db, bug_id)
    if not bug:
        raise HTTPException(status_code=404, detail="Bug no encontrado")
    await access_control.require_project_access(db, current_user, bug.proyecto_id, "edit")
    await _ensure_bug_build_is_active(db, bug)
    old_status = bug.estado
    try:
        updated = await crud.transition_bug_issue(db, bug_id, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    event_type = "bug.status_changed"
    if updated.estado == "LISTO_PARA_RETEST":
        event_type = "bug.ready_for_retest"
    elif updated.estado in {"CERRADO", "RESUELTO", "DUPLICADO", "NO_REPRODUCIBLE", "NO_CORRESPONDE"}:
        event_type = "bug.closed"
    elif old_status in {"CERRADO", "RESUELTO", "DUPLICADO", "NO_REPRODUCIBLE", "NO_CORRESPONDE"}:
        event_type = "bug.reopened"
    await _emit_bug_event(db, event_type, updated, current_user, {"old_value": old_status, "new_value": updated.estado})
    return updated

@router.get("/bugs/{bug_id}/comments/", response_model=List[schemas.BugCommentResponse])
async def read_bug_comments(
    bug_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("bugs.ver", "read"))
):
    bug = await crud.get_bug_issue(db, bug_id)
    if not bug:
        raise HTTPException(status_code=404, detail="Bug no encontrado")
    await access_control.require_project_access(db, current_user, bug.proyecto_id, "read")
    return await crud.list_bug_comments(db, bug_id)

@router.post("/bugs/{bug_id}/comments", response_model=schemas.BugCommentResponse)
@router.post("/bugs/{bug_id}/comments/", response_model=schemas.BugCommentResponse)
async def create_bug_comment(
    bug_id: UUID,
    payload: schemas.BugCommentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("bugs.comentar", "edit"))
):
    bug = await crud.get_bug_issue(db, bug_id)
    if not bug:
        raise HTTPException(status_code=404, detail="Bug no encontrado")
    await access_control.require_project_access(db, current_user, bug.proyecto_id, "read")
    await _ensure_bug_build_is_active(db, bug)
    for attachment_id in payload.attachment_ids or []:
        attachment = await crud.get_attachment(db, attachment_id)
        if not attachment:
            raise HTTPException(status_code=404, detail="Attachment no encontrado")
        await require_attachment_link_access(db, current_user, attachment, bug.proyecto_id)
    comment = await crud.add_bug_comment(db, bug_id, payload, current_user.id)
    if not comment:
        raise HTTPException(status_code=404, detail="Bug no encontrado")
    await _emit_bug_event(db, "bug.comment_added", bug, current_user, {"comment": {"id": str(comment.id), "comentario": comment.comentario}})
    return comment

@router.get("/bugs/{bug_id}/attachments/", response_model=List[schemas.BugAttachmentResponse])
async def read_bug_attachments(
    bug_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("bugs.ver", "read"))
):
    bug = await crud.get_bug_issue(db, bug_id)
    if not bug:
        raise HTTPException(status_code=404, detail="Bug no encontrado")
    await access_control.require_project_access(db, current_user, bug.proyecto_id, "read")
    return await crud.list_bug_attachments(db, bug_id)

@router.post("/bugs/{bug_id}/attachments", response_model=schemas.BugAttachmentResponse)
@router.post("/bugs/{bug_id}/attachments/", response_model=schemas.BugAttachmentResponse)
async def create_bug_attachment(
    bug_id: UUID,
    payload: schemas.BugAttachmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("bugs.adjuntos", "edit"))
):
    bug = await crud.get_bug_issue(db, bug_id)
    if not bug:
        raise HTTPException(status_code=404, detail="Bug no encontrado")
    await access_control.require_project_access(db, current_user, bug.proyecto_id, "edit")
    await _ensure_bug_build_is_active(db, bug)
    attachment = await crud.get_attachment(db, payload.attachment_id)
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment no encontrado")
    await require_attachment_link_access(db, current_user, attachment, bug.proyecto_id)
    try:
        link = await crud.add_bug_attachment(db, bug_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    if not link:
        raise HTTPException(status_code=404, detail="Bug no encontrado")
    await _emit_bug_event(db, "bug.attachment_added", bug, current_user, {"attachment": {"id": str(link.attachment_id)}})
    return link

@router.delete("/bugs/{bug_id}/attachments/{attachment_id}/")
async def delete_bug_attachment(
    bug_id: UUID,
    attachment_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("bugs.adjuntos", "edit"))
):
    bug = await crud.get_bug_issue(db, bug_id)
    if not bug:
        raise HTTPException(status_code=404, detail="Bug no encontrado")
    await access_control.require_project_access(db, current_user, bug.proyecto_id, "edit")
    await _ensure_bug_build_is_active(db, bug)
    deleted = await crud.delete_bug_attachment(db, bug_id, attachment_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Adjunto no vinculado al bug")
    await _emit_bug_event(db, "bug.attachment_deleted", bug, current_user, {"attachment": {"id": str(attachment_id)}})
    return {"ok": True}

@router.get("/bugs/{bug_id}/external-links/", response_model=List[schemas.BugExternalLinkResponse])
async def read_bug_external_links(
    bug_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("bugs.ver", "read")),
    _premium_bugs: None = Depends(require_feature("bugs.enterprise")),
):
    bug = await crud.get_bug_issue(db, bug_id)
    if not bug:
        raise HTTPException(status_code=404, detail="Bug no encontrado")
    await access_control.require_project_access(db, current_user, bug.proyecto_id, "read")
    return await crud.list_bug_external_links(db, bug_id)

@router.post("/bugs/{bug_id}/external-links/", response_model=schemas.BugExternalLinkResponse)
async def create_bug_external_link(
    bug_id: UUID,
    payload: schemas.BugExternalLinkCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("bugs.vincular_externo", "edit")),
    _premium_bugs: None = Depends(require_feature("bugs.enterprise")),
):
    bug = await crud.get_bug_issue(db, bug_id)
    if not bug:
        raise HTTPException(status_code=404, detail="Bug no encontrado")
    await access_control.require_project_access(db, current_user, bug.proyecto_id, "edit")
    await _ensure_bug_build_is_active(db, bug)
    link = await crud.create_bug_external_link(db, bug_id, payload, current_user.id)
    if not link:
        raise HTTPException(status_code=404, detail="Bug no encontrado")
    await _emit_bug_event(db, "bug.external_link_added", bug, current_user, {"external_link": {"provider_id": link.provider_id, "external_issue_id": link.external_issue_id}})
    return link

@router.delete("/bugs/{bug_id}/external-links/{link_id}/")
async def delete_bug_external_link(
    bug_id: UUID,
    link_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("bugs.vincular_externo", "edit")),
    _premium_bugs: None = Depends(require_feature("bugs.enterprise")),
):
    bug = await crud.get_bug_issue(db, bug_id)
    if not bug:
        raise HTTPException(status_code=404, detail="Bug no encontrado")
    await access_control.require_project_access(db, current_user, bug.proyecto_id, "edit")
    await _ensure_bug_build_is_active(db, bug)
    deleted = await crud.delete_bug_external_link(db, bug_id, link_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Link externo no encontrado")
    await _emit_bug_event(db, "bug.external_link_deleted", bug, current_user, {"external_link": {"id": str(link_id)}})
    return {"ok": True}

@router.post("/bugs/{bug_id}/external-preview/", response_model=schemas.BugExternalPreviewResponse)
async def preview_bug_external_ticket(
    bug_id: UUID,
    payload: schemas.BugExternalPreviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("bugs.exportar", "read")),
    _premium_bugs: None = Depends(require_feature("bugs.enterprise")),
):
    bug = await crud.get_bug_issue(db, bug_id)
    if not bug:
        raise HTTPException(status_code=404, detail="Bug no encontrado")
    await access_control.require_project_access(db, current_user, bug.proyecto_id, "read")
    preview = await crud.bug_external_preview(db, bug_id, payload.provider_id)
    if not preview:
        raise HTTPException(status_code=404, detail="Bug no encontrado")
    return preview

@router.post("/bugs/{bug_id}/mark-duplicate/", response_model=schemas.BugIssueResponse)
async def mark_bug_duplicate(
    bug_id: UUID,
    payload: schemas.BugMarkDuplicateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("bugs.triage", "edit")),
    _premium_bugs: None = Depends(require_feature("bugs.enterprise")),
):
    bug = await crud.get_bug_issue(db, bug_id)
    if not bug:
        raise HTTPException(status_code=404, detail="Bug no encontrado")
    await access_control.require_project_access(db, current_user, bug.proyecto_id, "edit")
    try:
        updated = await crud.mark_bug_duplicate(db, bug_id, payload.duplicate_of_id, payload.comentario, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if not updated:
        raise HTTPException(status_code=404, detail="Bug duplicado no encontrado")
    await _emit_bug_event(db, "bug.marked_duplicate", updated, current_user, {"duplicate_of_id": str(payload.duplicate_of_id)})
    return updated
