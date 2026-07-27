from .repository_context import *


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
    if data["estado"] in BUG_CLOSED_STATES:
        raise ValueError("Los bugs nuevos deben crearse abiertos y cerrarse mediante una transición auditable.")
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
    await db.flush()
    _add_bug_status_history(
        db,
        bug,
        None,
        user_id=created_by,
        source="created_from_failure" if from_failure else "created_manual",
    )
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
    requested_status = payload.model_dump(exclude_unset=True).get("estado")
    if requested_status is not None and str(requested_status).upper() != str(bug.estado).upper():
        raise ValueError("Usa la transición de estado para conservar el historial del bug.")
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


BUG_CORRECTED_STATES = {"RESUELTO", "CERRADO"}
BUG_ADMIN_CLOSED_STATES = {"DUPLICADO", "NO_REPRODUCIBLE", "NO_CORRESPONDE"}


async def _validate_resolution_build(db: AsyncSession, bug, build_id: UUID, *, allow_inactive: bool = False):
    build = (
        await db.execute(select(models.Build).filter(models.Build.id == build_id))
    ).scalar_one_or_none()
    if not build or build.proyecto_id != bug.proyecto_id:
        raise ValueError("La build de corrección no pertenece al proyecto del bug.")
    if bug.componente_id and build.componente_id and build.componente_id != bug.componente_id:
        raise ValueError("La build de corrección no corresponde al componente del bug.")
    if not allow_inactive and not build.activo:
        raise ValueError("La build de corrección está inactiva.")
    return build


def _add_bug_status_history(db: AsyncSession, bug, old_status: Optional[str], *, build_id=None, user_id=None, source="manual"):
    db.add(models.BugStatusHistory(
        bug_id=bug.id,
        project_id=bug.proyecto_id,
        from_status=old_status,
        to_status=bug.estado,
        build_id=build_id,
        actor_id=user_id,
        resolution=bug.resolucion,
        close_reason=bug.motivo_cierre,
        source=source,
        occurred_at=utc_now(),
    ))


async def transition_bug_issue(
    db: AsyncSession,
    bug_id: UUID,
    payload: schemas.BugTransitionRequest,
    user_id: Optional[UUID],
    *,
    source: str = "manual",
):
    bug = await get_bug_issue(db, bug_id)
    if not bug:
        return None
    next_state = payload.estado.upper()
    if next_state not in BUG_ALLOWED_STATES:
        raise ValueError("Estado invalido.")
    old_status = str(bug.estado or "").upper()
    if old_status == next_state:
        return bug

    resolution_build_id = payload.resolution_build_id
    if next_state in BUG_CORRECTED_STATES:
        reused = next_state == "CERRADO" and not resolution_build_id and bug.resolved_build_id
        resolution_build_id = resolution_build_id or (bug.resolved_build_id if reused else None)
        if not resolution_build_id:
            raise ValueError("Selecciona la build donde se corrigió el bug.")
        resolution_build = await _validate_resolution_build(db, bug, resolution_build_id, allow_inactive=bool(reused))
        bug.resolved_build_id = resolution_build_id
        bug.resolved_build = resolution_build
    elif next_state in BUG_ADMIN_CLOSED_STATES:
        if resolution_build_id:
            await _validate_resolution_build(db, bug, resolution_build_id)
        bug.resolved_build_id = None
        bug.resolved_build = None

    if old_status in BUG_CLOSED_STATES and next_state in BUG_OPEN_STATES:
        if not resolution_build_id:
            raise ValueError("Selecciona la build donde reapareció el bug.")
        await _validate_resolution_build(db, bug, resolution_build_id)
        bug.reopened_count = int(bug.reopened_count or 0) + 1
        bug.resolved_build_id = None
        bug.resolved_build = None
        bug.fecha_resolucion = None
        bug.resuelto_por = None
        bug.closed_at = None
    bug.estado = next_state
    if payload.resolucion is not None:
        bug.resolucion = payload.resolucion
    if payload.motivo_cierre is not None:
        bug.motivo_cierre = payload.motivo_cierre
    if next_state in BUG_CLOSED_STATES:
        bug.closed_at = utc_now()
        bug.fecha_resolucion = bug.fecha_resolucion or bug.closed_at
        bug.resuelto_por = user_id
    _add_bug_status_history(
        db,
        bug,
        old_status,
        build_id=resolution_build_id if next_state in BUG_CLOSED_STATES or old_status in BUG_CLOSED_STATES else None,
        user_id=user_id,
        source=source,
    )
    bug.updated_at = utc_now()
    await db.commit()
    return await get_bug_issue(db, bug_id)


async def list_bug_status_history(db: AsyncSession, bug_id: UUID):
    result = await db.execute(
        select(models.BugStatusHistory)
        .options(selectinload(models.BugStatusHistory.build))
        .filter(models.BugStatusHistory.bug_id == bug_id)
        .order_by(models.BugStatusHistory.occurred_at.desc())
    )
    return result.scalars().all()

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
        previous_status = bug.estado
        bug.estado = "REABIERTO"
        bug.reopened_count = int(bug.reopened_count or 0) + 1
        bug.fecha_resolucion = None
        bug.resuelto_por = None
        bug.closed_at = None
        bug.motivo_cierre = None
        bug.resolucion = None
        bug.resolved_build_id = None
        bug.resolved_build = None
        _add_bug_status_history(
            db,
            bug,
            previous_status,
            build_id=run.build_id,
            user_id=user_id,
            source="execution_link",
        )

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
