from .legacy_common import *


def _apply_bug_filters(query, filters: Dict[str, Any]):
    if filters.get("q"):
        like = f"%{filters['q'].strip()}%"
        query = query.filter(or_(
            models.BugIssue.codigo.ilike(like),
            models.BugIssue.titulo.ilike(like),
            models.BugIssue.descripcion.ilike(like),
            models.BugIssue.resultado_obtenido.ilike(like),
            models.BugIssue.error_tecnico.ilike(like),
        ))
    for field in [
        "estado", "severidad", "prioridad", "componente_id", "build_id", "caso_id",
        "ejecucion_id", "snapshot_id", "asignado_a", "creado_por", "external_provider",
        "origen",
    ]:
        if filters.get(field) is not None:
            query = query.filter(getattr(models.BugIssue, field) == filters[field])
    if filters.get("has_external") is not None:
        if filters["has_external"]:
            query = query.filter(or_(models.BugIssue.external_issue_id.isnot(None), models.BugIssue.external_provider.isnot(None)))
        else:
            query = query.filter(models.BugIssue.external_issue_id.is_(None), models.BugIssue.external_provider.is_(None))
    if filters.get("desde"):
        query = query.filter(models.BugIssue.created_at >= ensure_utc(filters["desde"]))
    if filters.get("hasta"):
        query = query.filter(models.BugIssue.created_at <= ensure_utc(filters["hasta"]))
    return query


async def list_project_bugs(db: AsyncSession, proyecto_id: UUID, **filters):
    skip = int(filters.pop("skip", 0) or 0)
    limit = min(max(int(filters.pop("limit", 50) or 50), 1), 200)
    base = select(models.BugIssue).filter(models.BugIssue.proyecto_id == proyecto_id)
    filtered = _apply_bug_filters(base, filters)
    count_result = await db.execute(select(func.count()).select_from(filtered.subquery()))
    total = int(count_result.scalar() or 0)
    result = await db.execute(
        filtered.options(*_bug_options()).order_by(models.BugIssue.created_at.desc()).offset(skip).limit(limit)
    )
    return {"items": result.scalars().unique().all(), "total": total, "skip": skip, "limit": limit}

async def list_related_bugs_for_case(db: AsyncSession, caso_id: UUID, include_closed: bool = True):
    case = (
        await db.execute(select(models.CasoPrueba).filter(models.CasoPrueba.id == caso_id))
    ).scalar_one_or_none()
    if not case:
        return None
    version_ids_result = await db.execute(
        select(models.CasoPrueba.id).filter(
            models.CasoPrueba.proyecto_id == case.proyecto_id,
            models.CasoPrueba.master_id == case.master_id,
        )
    )
    version_ids = list(version_ids_result.scalars().all())
    if not version_ids:
        return []
    query = (
        select(models.BugIssue)
        .options(*_bug_options())
        .filter(models.BugIssue.proyecto_id == case.proyecto_id)
        .filter(models.BugIssue.caso_id.in_(version_ids))
    )
    if not include_closed:
        query = query.filter(models.BugIssue.estado.notin_(BUG_CLOSED_STATES))
    result = await db.execute(
        query.order_by(
            models.BugIssue.estado.in_(BUG_CLOSED_STATES).asc(),
            models.BugIssue.updated_at.desc(),
            models.BugIssue.created_at.desc(),
        )
    )
    return result.scalars().unique().all()


async def _next_bug_code(db: AsyncSession) -> str:
    result = await db.execute(
        select(models.BugIssue.codigo).filter(models.BugIssue.codigo.like("BUG-%"))
    )
    max_number = 0
    for code in result.scalars().all():
        match = re.fullmatch(r"BUG-0*(\d+)", str(code or "").strip().upper())
        if match:
            max_number = max(max_number, int(match.group(1)))
    return f"BUG-{max_number + 1}"


async def create_bug_issue(db: AsyncSession, payload: schemas.BugIssueCreate, created_by: Optional[UUID], from_failure: bool = False):
    data = _bug_payload_dict(payload)
    data["severidad"] = str(data.get("severidad") or "MEDIA").upper()
    data["prioridad"] = str(data.get("prioridad") or "P2").upper()
    data["estado"] = str(data.get("estado") or "ABIERTO").upper()
    data["criticidad"] = str(data.get("criticidad") or data["severidad"]).upper()
    if data["estado"] not in BUG_ALLOWED_STATES:
        raise ValueError("Estado invalido.")
    if data.get("build_id"):
        build = (
            await db.execute(
                select(models.Build).filter(
                    models.Build.id == data["build_id"],
                    models.Build.proyecto_id == data["proyecto_id"],
                )
            )
        ).scalar_one_or_none()
        if not build:
            raise ValueError("Build no encontrada para el proyecto.")
        if not build.activo:
            raise ValueError("La build está inactiva. No se pueden reportar bugs sobre una build cerrada.")
    if not data.get("dedupe_hash"):
        data["dedupe_hash"] = compute_bug_dedupe_hash(data)
    _validate_bug_payload(data, from_failure=from_failure)
    if from_failure:
        existing = await find_existing_failure_bug(
            db,
            proyecto_id=data["proyecto_id"],
            ejecucion_id=data.get("ejecucion_id"),
            snapshot_id=data.get("snapshot_id"),
            dedupe_hash=data.get("dedupe_hash"),
        )
        if existing:
            return existing
    bug = models.BugIssue(
        codigo=await _next_bug_code(db),
        creado_por=created_by,
        **data,
    )
    db.add(bug)
    await db.commit()
    return await get_bug_issue(db, bug.id)


async def find_existing_failure_bug(
    db: AsyncSession,
    *,
    proyecto_id: UUID,
    ejecucion_id: Optional[UUID] = None,
    snapshot_id: Optional[UUID] = None,
    dedupe_hash: Optional[str] = None,
):
    query = select(models.BugIssue).options(*_bug_options()).filter(models.BugIssue.proyecto_id == proyecto_id)
    if snapshot_id:
        query = query.filter(models.BugIssue.snapshot_id == snapshot_id)
    elif ejecucion_id:
        query = query.filter(models.BugIssue.ejecucion_id == ejecucion_id)
    elif dedupe_hash:
        query = query.filter(models.BugIssue.dedupe_hash == dedupe_hash)
    else:
        return None
    query = query.filter(models.BugIssue.estado.notin_(BUG_CLOSED_STATES)).order_by(models.BugIssue.created_at.desc())
    result = await db.execute(query)
    return result.scalars().unique().first()


async def get_bug_issue(db: AsyncSession, bug_id: UUID):
    result = await db.execute(
        select(models.BugIssue)
        .options(*_bug_options())
        .filter(models.BugIssue.id == bug_id)
    )
    return result.scalar_one_or_none()


async def update_bug_issue(db: AsyncSession, bug_id: UUID, payload: schemas.BugIssueUpdate):
    bug = await get_bug_issue(db, bug_id)
    if not bug:
        return None
    for field, value in payload.model_dump(exclude_unset=True).items():
        if isinstance(value, str) and field in {"estado", "severidad", "prioridad", "criticidad"}:
            value = value.upper()
        setattr(bug, field, value)
    bug.dedupe_hash = bug.dedupe_hash or compute_bug_dedupe_hash({k: getattr(bug, k, None) for k in [
        "proyecto_id", "componente_id", "build_id", "caso_id", "numero_paso", "titulo", "error_tecnico", "resultado_obtenido", "descripcion"
    ]})
    bug.updated_at = utc_now()
    await db.commit()
    return await get_bug_issue(db, bug_id)


async def transition_bug_issue(db: AsyncSession, bug_id: UUID, payload: schemas.BugTransitionRequest, user_id: Optional[UUID]):
    bug = await get_bug_issue(db, bug_id)
    if not bug:
        return None
    next_state = payload.estado.upper()
    if next_state not in BUG_ALLOWED_STATES:
        raise ValueError("Estado invalido.")
    if bug.estado in BUG_CLOSED_STATES and next_state in BUG_OPEN_STATES:
        bug.reopened_count = int(bug.reopened_count or 0) + 1
    bug.estado = next_state
    if payload.resolucion is not None:
        bug.resolucion = payload.resolucion
    if payload.motivo_cierre is not None:
        bug.motivo_cierre = payload.motivo_cierre
    if payload.retest_status is not None:
        bug.retest_status = payload.retest_status
    if next_state in BUG_CLOSED_STATES:
        bug.closed_at = utc_now()
        bug.fecha_resolucion = bug.fecha_resolucion or bug.closed_at
        bug.resuelto_por = user_id
    bug.updated_at = utc_now()
    await db.commit()
    return await get_bug_issue(db, bug_id)

async def link_bug_to_execution(
    db: AsyncSession,
    bug_id: UUID,
    payload: schemas.BugExecutionLinkRequest,
    user_id: Optional[UUID],
):
    result = await db.execute(
        select(models.BugIssue, models.EjecucionCaso, models.TestRun, models.CasoPrueba, models.Build, models.Componente)
        .join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
        .join(models.CasoPrueba, models.CasoPrueba.id == models.EjecucionCaso.caso_id)
        .outerjoin(models.Build, models.Build.id == models.TestRun.build_id)
        .outerjoin(models.Componente, models.Componente.id == models.CasoPrueba.componente_id)
        .filter(models.BugIssue.id == bug_id)
        .filter(models.EjecucionCaso.id == payload.ejecucion_id)
    )
    row = result.first()
    if not row:
        return None
    bug, execution, run, executed_case, build, component = row
    if build and not build.activo:
        raise ValueError("La build está inactiva. No se puede registrar seguimiento sobre una build cerrada.")
    if bug.proyecto_id != run.proyecto_id:
        raise ValueError("El bug y la ejecución pertenecen a proyectos distintos.")
    if not bug.caso_id:
        raise ValueError("El bug no está asociado a un caso de prueba.")
    bug_case = (
        await db.execute(select(models.CasoPrueba).filter(models.CasoPrueba.id == bug.caso_id))
    ).scalar_one_or_none()
    if not bug_case or bug_case.master_id != executed_case.master_id:
        raise ValueError("El bug no pertenece al mismo caso lógico de la ejecución.")
    if execution.estado_resultado not in {models.EstadoResultado.FALLO, models.EstadoResultado.BLOQUEADO}:
        raise ValueError("Solo se puede registrar seguimiento sobre una ejecución fallida o bloqueada.")

    snapshot = None
    if payload.snapshot_id:
        snapshot = (
            await db.execute(
                select(models.SnapshotPaso).filter(
                    models.SnapshotPaso.id == payload.snapshot_id,
                    models.SnapshotPaso.ejecucion_caso_id == execution.id,
                )
            )
        ).scalar_one_or_none()
        if not snapshot:
            raise ValueError("El snapshot no pertenece a la ejecución indicada.")
    if snapshot is None:
        details = await get_execution_history_details(db, execution.id)
        snapshot_id = details.get("snapshot_id")
        if snapshot_id:
            try:
                parsed_snapshot_id = UUID(str(snapshot_id))
                snapshot = (
                    await db.execute(select(models.SnapshotPaso).filter(models.SnapshotPaso.id == parsed_snapshot_id))
                ).scalar_one_or_none()
            except (TypeError, ValueError):
                snapshot = None

    status = execution.estado_resultado.value if hasattr(execution.estado_resultado, "value") else str(execution.estado_resultado)
    execution_date = isoformat_utc(execution.fecha_ejecucion)
    snapshot_status = None
    if snapshot:
        snapshot_status = snapshot.estado_paso.value if hasattr(snapshot.estado_paso, "value") else str(snapshot.estado_paso)
    context_lines = [
        "Nueva ocurrencia registrada desde ejecución.",
        f"Build: {build.nombre if build else run.nombre}",
        f"Componente: {component.nombre if component else 'N/D'}",
        f"Caso: {executed_case.codigo or executed_case.titulo} v{execution.version_ejecutada}",
        f"Resultado: {snapshot_status or status}",
        f"Ejecución: {execution_date or 'N/D'}",
    ]
    if snapshot:
        context_lines.append(f"Paso: {snapshot.numero_paso} - {snapshot.accion_congelada}")
        if snapshot.comentarios:
            context_lines.append(f"Observación: {snapshot.comentarios}")
        elif snapshot.error_log:
            context_lines.append(f"Error: {snapshot.error_log}")
    elif execution.observaciones:
        context_lines.append(f"Observación: {execution.observaciones}")
    if payload.comentario:
        context_lines.append(f"Comentario QA: {payload.comentario}")

    was_closed = bug.estado in BUG_CLOSED_STATES
    if was_closed:
        bug.estado = "REABIERTO"
        bug.reopened_count = int(bug.reopened_count or 0) + 1
        bug.fecha_resolucion = None
        bug.resuelto_por = None
        bug.closed_at = None
        bug.motivo_cierre = None
        bug.resolucion = None
        bug.retest_status = "pendiente"

    metadata = dict(bug.metadata_json or {})
    occurrences = list(metadata.get("linked_execution_occurrences") or [])
    occurrence = {
        "test_run_id": str(run.id),
        "ejecucion_id": str(execution.id),
        "snapshot_id": str(snapshot.id) if snapshot else None,
        "build_id": str(run.build_id) if run.build_id else None,
        "build_name": build.nombre if build else None,
        "build_code": build.codigo if build else None,
        "component_id": str(component.id) if component else None,
        "component_name": component.nombre if component else None,
        "case_id": str(executed_case.id),
        "case_master_id": str(executed_case.master_id),
        "case_version": execution.version_ejecutada,
        "status": snapshot_status or status,
        "linked_at": isoformat_utc(utc_now()),
        "linked_by": str(user_id) if user_id else None,
    }
    already_recorded = any(
        item.get("ejecucion_id") == occurrence["ejecucion_id"] and item.get("snapshot_id") == occurrence["snapshot_id"]
        for item in occurrences
    )
    if already_recorded:
        if was_closed:
            metadata["linked_execution_occurrences"] = occurrences[-50:]
            bug.metadata_json = metadata
            bug.updated_at = utc_now()
            await db.commit()
        updated_bug = await get_bug_issue(db, bug.id)
        if updated_bug:
            setattr(updated_bug, "_occurrence_created", False)
        return updated_bug

    occurrences.append(occurrence)
    metadata["linked_execution_occurrences"] = occurrences[-50:]
    bug.metadata_json = metadata
    bug.updated_at = utc_now()

    comment = models.BugComment(
        bug_id=bug.id,
        autor_id=user_id,
        comentario="\n".join(context_lines),
    )
    db.add(comment)
    await db.flush()
    for attachment_id in payload.attachment_ids or []:
        attachment = await get_attachment(db, attachment_id)
        if not attachment:
            raise ValueError("Attachment no encontrado")
        db.add(models.BugAttachment(
            bug_id=bug.id,
            comment_id=comment.id,
            attachment_id=attachment_id,
            tipo="EXECUTION_OCCURRENCE",
        ))
    await db.commit()
    updated_bug = await get_bug_issue(db, bug.id)
    if updated_bug:
        setattr(updated_bug, "_occurrence_created", True)
    return updated_bug


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
    await db.refresh(link)
    return link


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
    if build and not build.activo:
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
