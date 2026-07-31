from .repository_context import *

async def add_bug_comment(db: AsyncSession, bug_id: UUID, payload: schemas.BugCommentCreate, autor_id: Optional[UUID]):
    bug = await get_bug_issue(db, bug_id)
    if not bug:
        return None
    comment = models.BugComment(bug_id=bug_id, autor_id=autor_id, comentario=payload.comentario)
    db.add(comment)
    await db.flush()
    for attachment_id in payload.attachment_ids or []:
        attachment = await get_attachment(db, attachment_id)
        if not attachment:
            raise ValueError("Attachment no encontrado")
        db.add(models.BugAttachment(
            bug_id=bug_id,
            comment_id=comment.id,
            attachment_id=attachment_id,
            tipo="COMMENT_EVIDENCE",
        ))
    bug.updated_at = utc_now()
    await db.commit()
    result = await db.execute(
        select(models.BugComment)
        .options(selectinload(models.BugComment.attachments).selectinload(models.BugAttachment.attachment))
        .filter(models.BugComment.id == comment.id)
    )
    return result.scalar_one_or_none()


async def list_bug_comments(db: AsyncSession, bug_id: UUID):
    result = await db.execute(
        select(models.BugComment)
        .options(selectinload(models.BugComment.attachments).selectinload(models.BugAttachment.attachment))
        .filter(models.BugComment.bug_id == bug_id)
        .order_by(models.BugComment.created_at)
    )
    return result.scalars().all()


async def add_bug_attachment(db: AsyncSession, bug_id: UUID, payload: schemas.BugAttachmentCreate):
    bug = await get_bug_issue(db, bug_id)
    if not bug:
        return None
    attachment = await get_attachment(db, payload.attachment_id)
    if not attachment:
        raise ValueError("Attachment no encontrado")
    existing = await db.execute(
        select(models.BugAttachment)
        .filter(models.BugAttachment.bug_id == bug_id)
        .filter(models.BugAttachment.comment_id.is_(None))
        .filter(models.BugAttachment.attachment_id == payload.attachment_id)
        .filter(models.BugAttachment.tipo == payload.tipo)
    )
    link = existing.scalar_one_or_none()
    if not link:
        link = models.BugAttachment(bug_id=bug_id, attachment_id=payload.attachment_id, tipo=payload.tipo)
        db.add(link)
    bug.updated_at = utc_now()
    await db.commit()
    result = await db.execute(
        select(models.BugAttachment)
        .options(selectinload(models.BugAttachment.attachment))
        .filter(models.BugAttachment.id == link.id)
    )
    return result.scalar_one_or_none()


async def list_bug_attachments(db: AsyncSession, bug_id: UUID):
    result = await db.execute(
        select(models.BugAttachment)
        .options(selectinload(models.BugAttachment.attachment))
        .filter(models.BugAttachment.bug_id == bug_id)
        .filter(models.BugAttachment.comment_id.is_(None))
        .order_by(models.BugAttachment.created_at)
    )
    return result.scalars().all()


async def delete_bug_attachment(db: AsyncSession, bug_id: UUID, attachment_id: UUID):
    result = await db.execute(delete(models.BugAttachment).where(models.BugAttachment.bug_id == bug_id, models.BugAttachment.attachment_id == attachment_id, models.BugAttachment.comment_id.is_(None)))
    await db.commit()
    return (getattr(result, "rowcount", 0) or 0) > 0


async def create_bug_from_snapshot(db: AsyncSession, snapshot_id: UUID, payload: schemas.BugIssueUpdate, created_by: Optional[UUID]):
    result = await db.execute(
        select(models.SnapshotPaso, models.EjecucionCaso, models.TestRun, models.CasoPrueba, models.Build)
        .join(models.EjecucionCaso, models.EjecucionCaso.id == models.SnapshotPaso.ejecucion_caso_id)
        .join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
        .join(models.CasoPrueba, models.CasoPrueba.id == models.EjecucionCaso.caso_id)
        .outerjoin(models.Build, models.Build.id == models.TestRun.build_id)
        .filter(models.SnapshotPaso.id == snapshot_id)
    )
    row = result.first()
    if not row:
        return None
    snapshot, execution, run, case, build = row
    if build and not access_control.is_build_active(build):
        raise ValueError("La build está inactiva. No se pueden reportar bugs sobre una build cerrada.")
    if snapshot.estado_paso not in {models.EstadoResultado.FALLO, models.EstadoResultado.BLOQUEADO} and execution.estado_resultado not in {models.EstadoResultado.FALLO, models.EstadoResultado.BLOQUEADO}:
        raise ValueError("Solo se puede crear bug directo desde snapshot fallido o bloqueado.")
    component = None
    component_id = case.componente_id or (build.componente_id if build else None)
    if component_id:
        component = (await db.execute(select(models.Componente).filter(models.Componente.id == component_id))).scalar_one_or_none()
    environment = None
    if run.entorno_id:
        environment = (await db.execute(select(models.Entorno).filter(models.Entorno.id == run.entorno_id))).scalar_one_or_none()
    dataset = None
    if run.dataset_id:
        dataset = (await db.execute(select(models.EntornoDataset).filter(models.EntornoDataset.id == run.dataset_id))).scalar_one_or_none()
    resolved_dataset = await resolve_case_dataset(db, case.id, run.build_id, run.entorno_id, run.dataset_id)
    dataset_values = (resolved_dataset or {}).get("variables_resueltas") or {}
    run_variables = {str(key): str(value) for key, value in ((run.variables_resueltas if run else {}) or {}).items()}
    snapshot_data = _resolve_placeholders(snapshot.datos_congelados or "", run_variables) if snapshot.datos_congelados else None
    base = {
        "proyecto_id": run.proyecto_id,
        "componente_id": component_id,
        "build_id": run.build_id,
        "caso_id": case.id,
        "test_run_id": run.id,
        "ejecucion_id": execution.id,
        "snapshot_id": snapshot.id,
        "entorno_id": run.entorno_id,
        "dataset_id": run.dataset_id,
        "numero_paso": snapshot.numero_paso,
        "execution_mode": execution.execution_mode.value if hasattr(execution.execution_mode, "value") else str(execution.execution_mode),
        "case_code": case.codigo,
        "build_code": (build.codigo or build.nombre) if build else None,
        "titulo": f"{case.codigo or 'Caso'} - {case.titulo}: paso {snapshot.numero_paso} {snapshot.estado_paso.value.lower()}",
        "descripcion": snapshot.comentarios or execution.observaciones or "Fallo detectado durante la ejecucion de prueba.",
        "resultado_esperado": snapshot.resultado_esperado_congelado,
        "resultado_obtenido": snapshot.comentarios or snapshot.error_log or "El paso no cumplio el resultado esperado.",
        "pasos_reproduccion": "\n".join([
            f"1. Ejecutar caso {case.codigo or case.titulo} en build {build.nombre if build else run.nombre}.",
            f"2. Llegar al paso {snapshot.numero_paso}: {snapshot.accion_congelada}",
            "3. Usar los mismos datos congelados del snapshot.",
        ]),
        "datos_prueba": snapshot_data or snapshot.datos_congelados,
        "logs_relevantes": snapshot.error_log,
        "notas_qa": snapshot.comentarios,
        "origen": "ejecucion_manual" if execution.execution_mode == models.ExecutionMode.MANUAL else str(execution.execution_mode.value).lower(),
        "severidad": "ALTA" if snapshot.estado_paso == models.EstadoResultado.BLOQUEADO else "MEDIA",
        "prioridad": "P1" if snapshot.estado_paso == models.EstadoResultado.BLOQUEADO else "P2",
        "criticidad": "ALTA" if snapshot.estado_paso == models.EstadoResultado.BLOQUEADO else "MEDIA",
        "bloquea_caso": False,
        "ambiente_nombre": environment.nombre if environment else run.entorno,
        "ambiente_url": environment.url if environment else None,
        "version_app": build.nombre if build else None,
        "modulo_funcional": component.nombre if component else None,
        "metadata_json": {
            "project_id": str(run.proyecto_id),
            "build_name": build.nombre if build else None,
            "build_code": build.codigo if build else None,
            "component_name": component.nombre if component else None,
            "component_code": getattr(component, "codigo", None) if component else None,
            "environment_name": environment.nombre if environment else run.entorno,
            "environment_url": environment.url if environment else None,
            "dataset_name": dataset.nombre if dataset else None,
            "dataset_variables": dataset_values,
            "snapshot_action": snapshot.accion_congelada,
            "snapshot_data": snapshot_data or snapshot.datos_congelados,
            "snapshot_expected": snapshot.resultado_esperado_congelado,
            "snapshot_status": snapshot.estado_paso.value if hasattr(snapshot.estado_paso, "value") else str(snapshot.estado_paso),
            "execution_date": isoformat_utc(execution.fecha_ejecucion),
            "executed_by": str(execution.ejecutado_por),
            "case_version": execution.version_ejecutada,
            "legacy_evidence_url": snapshot.evidencia_url,
        },
    }
    overrides = payload.model_dump(exclude_unset=True)
    override_metadata = overrides.pop("metadata_json", None)
    base.update({key: value for key, value in overrides.items() if value is not None})
    if override_metadata:
        base["metadata_json"] = {**(base.get("metadata_json") or {}), **override_metadata}
    dedupe_hash = compute_bug_dedupe_hash(base)
    existing = await find_existing_failure_bug(
        db,
        proyecto_id=run.proyecto_id,
        ejecucion_id=execution.id,
        snapshot_id=snapshot.id,
        dedupe_hash=dedupe_hash,
    )
    if existing:
        return existing
    base["dedupe_hash"] = dedupe_hash
    create_payload = schemas.BugIssueCreate(**base)
    bug = await create_bug_issue(db, create_payload, created_by, from_failure=True)
    if bug:
        links = await get_snapshot_attachments(db, snapshot.id)
        for link in links:
            await add_bug_attachment(db, bug.id, schemas.BugAttachmentCreate(attachment_id=link.attachment_id, tipo=link.tipo or "SNAPSHOT_EVIDENCE"))
    return await get_bug_issue(db, bug.id) if bug else None
