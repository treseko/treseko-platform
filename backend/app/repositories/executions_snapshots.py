from .legacy_common import *
from ..evidence_url_security import sanitize_evidence_url
from ..services.ai_report_sanitizer import sanitize_ai_report_payload
from ..services.execution_output_sanitizer import sanitize_execution_snapshot_item


async def get_test_run_detail(db: AsyncSession, run_id: UUID):
    result = await db.execute(select(models.TestRun).filter(models.TestRun.id == run_id))
    run = result.scalar_one_or_none()
    if not run:
        return None

    build = None
    component = None
    if run.build_id:
        build_result = await db.execute(select(models.Build).filter(models.Build.id == run.build_id))
        build = build_result.scalar_one_or_none()
        if build and build.componente_id:
            component_result = await db.execute(select(models.Componente).filter(models.Componente.id == build.componente_id))
            component = component_result.scalar_one_or_none()

    entorno = None
    if run.entorno_id:
        entorno_result = await db.execute(select(models.Entorno).filter(models.Entorno.id == run.entorno_id))
        entorno = entorno_result.scalar_one_or_none()

    dataset = None
    if run.dataset_id:
        dataset_result = await db.execute(select(models.EntornoDataset).filter(models.EntornoDataset.id == run.dataset_id))
        dataset = dataset_result.scalar_one_or_none()

    user_result = await db.execute(select(models.Usuario).filter(models.Usuario.id == run.creado_por))
    user = user_result.scalar_one_or_none()

    ejecuciones = await get_ejecuciones_run(db, run_id=run_id, skip=0, limit=500)
    caso_ids = [ejec.caso_id for ejec in ejecuciones]
    casos = {}
    if caso_ids:
        casos_result = await db.execute(select(models.CasoPrueba).filter(models.CasoPrueba.id.in_(caso_ids)))
        casos = {caso.id: caso for caso in casos_result.scalars().all()}

    snapshots_by_execution = await _load_enriched_snapshots_by_execution(db, ejecuciones, run)
    cases_detail = []
    execution_modes = {"manual": 0, "ia": 0, "automatizada": 0, "externa": 0}
    for ejec in ejecuciones:
        caso = casos.get(ejec.caso_id)
        execution_mode = _execution_mode_value(ejec, caso, run.origen)
        execution_modes[_execution_mode_key(execution_mode)] += 1
        enriched_snapshots = snapshots_by_execution.get(ejec.id, [])
        ai_report = ejec.ai_report if isinstance(ejec.ai_report, dict) else {}
        is_ai_execution = execution_mode == models.ExecutionMode.IA.value or _has_ai_execution_data(ejec)
        review_status = _review_status_for_execution(ejec) if is_ai_execution else None
        review_required = bool(is_ai_execution and review_status == models.AiReviewStatus.REQUIERE_REVISION.value)
        if not ai_report and is_ai_execution and (
            bool(enriched_snapshots) or
            ejec.estado_resultado in {models.EstadoResultado.FALLO, models.EstadoResultado.BLOQUEADO}
            or any(str(snap.get("comentarios") or snap.get("error_log") or "").lower().find("ia") >= 0 for snap in enriched_snapshots)
        ):
            failed_snapshots = [
                snap for snap in enriched_snapshots
                if str(snap.get("estado_paso")).upper() in {"FALLO", "BLOQUEADO"}
            ]
            ai_report = {
                "schema_version": 1,
                "legacy": True,
                "execution_id": str(ejec.id),
                "summary": ejec.observaciones or (failed_snapshots[0].get("comentarios") if failed_snapshots else "Ejecucion IA sin reporte estructurado."),
                "status": ejec.estado_resultado.value,
                "confidence": ejec.ai_confidence or 0,
                "consensus": ejec.ai_consensus or ejec.estado_resultado.value,
                "failure_category": ejec.ai_failure_category or "legacy_ai_execution",
                "human_review_required": review_required,
                "errors": [snap.get("error_log") or snap.get("comentarios") for snap in failed_snapshots if snap.get("error_log") or snap.get("comentarios")],
                "steps": [
                    {
                        "number": snap.get("numero_paso"),
                        "status": snap.get("estado_paso"),
                        "observations": snap.get("comentarios") or snap.get("error_log"),
                        "confidence": 0,
                        "failure_category": "legacy_snapshot",
                        "attempts": [],
                    }
                    for snap in enriched_snapshots
                ],
            }
        has_ai_report = bool(ai_report) and is_ai_execution
        ai_report = sanitize_ai_report_payload(ai_report) if ai_report else {}
        cases_detail.append({
            "id": str(ejec.id),
            "execution_id": str(ejec.id),
            "caso_id": str(ejec.caso_id),
            "case_id": str(ejec.caso_id),
            "codigo": caso.codigo if caso else None,
            "titulo": caso.titulo if caso else "Caso no disponible",
            "case_type": _case_type_key(caso) if caso else "manual",
            "case_type_label": _case_type_label(caso),
            "descripcion": caso.descripcion if caso else None,
            "precondiciones": caso.precondiciones if caso else None,
            "postcondiciones": caso.postcondiciones if caso else None,
            "version_ejecutada": ejec.version_ejecutada,
            "estado": ejec.estado_resultado.value,
            "execution_mode": execution_mode,
            "execution_mode_label": _execution_mode_label(execution_mode),
            "duracion_segundos": ejec.duracion_segundos,
            "observaciones": sanitize_ai_report_payload(ejec.observaciones),
            "ai_report": ai_report,
            "has_ai_report": has_ai_report,
            "ai_confidence": ejec.ai_confidence or ai_report.get("confidence"),
            "ai_consensus": ejec.ai_consensus or ai_report.get("consensus"),
            "ai_failure_category": ejec.ai_failure_category or ai_report.get("failure_category"),
            "ai_error_code": _ai_error_code_from_report(ai_report, ejec.estado_resultado) if isinstance(ai_report, dict) else None,
            "ai_review_status": review_status,
            "ai_reviewed_at": ejec.ai_reviewed_at.isoformat() if ejec.ai_reviewed_at else None,
            "ai_review_note": sanitize_ai_report_payload(ejec.ai_review_note),
            "ai_human_review_required": review_required,
            "fecha_ejecucion": ejec.fecha_ejecucion.isoformat() if ejec.fecha_ejecucion else None,
            "snapshots": enriched_snapshots,
            "dataset_resuelto": (run.datasets_resueltos or {}).get(str(ejec.caso_id), []),
        })

    return {
        "id": str(run.id),
        "nombre": run.nombre,
        "origen": run.origen,
        "execution_modes": execution_modes,
        **_execution_modes_summary(execution_modes),
        "external_run_id": run.external_run_id,
        "estado_run": run.estado_run.value if hasattr(run.estado_run, "value") else run.estado_run,
        "proyecto_id": str(run.proyecto_id),
        "build": {
            "id": str(build.id),
            "codigo": build.codigo,
            "nombre": build.nombre,
            "contexto_cambio": build.contexto_cambio,
        } if build else None,
        "componente": {
            "id": str(component.id),
            "codigo": component.codigo,
            "nombre": component.nombre,
        } if component else None,
        "entorno": {
            "id": str(entorno.id),
            "nombre": entorno.nombre,
            "url": entorno.url,
            "version": entorno.version,
        } if entorno else {"id": None, "nombre": run.entorno},
        "dataset": {
            "id": str(dataset.id),
            "nombre": dataset.nombre,
            "descripcion": dataset.descripcion,
        } if dataset else None,
        "variables_resueltas": run.variables_resueltas or {},
        "datasets_resueltos": run.datasets_resueltos or {},
        "creado_por": str(run.creado_por),
        "creado_por_nombre": (user.nombre_completo or user.email) if user else None,
        "fecha_creacion": run.fecha_creacion.isoformat() if run.fecha_creacion else None,
        "fecha_cierre": run.fecha_cierre.isoformat() if run.fecha_cierre else None,
        "casos": cases_detail,
    }

async def get_ejecuciones_run(db: AsyncSession, run_id: UUID, skip: int = 0, limit: int = 100):
    result = await db.execute(
        select(models.EjecucionCaso)
        .filter(models.EjecucionCaso.test_run_id == run_id)
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()

async def update_snapshot_status(db: AsyncSession, snapshot_id: UUID, estado: models.EstadoResultado, comentarios: Optional[str] = None, evidencia_url: Optional[str] = None):
    # Obtener el snapshot actual
    result = await db.execute(select(models.SnapshotPaso).filter(models.SnapshotPaso.id == snapshot_id))
    db_snapshot = result.scalar_one_or_none()
    if not db_snapshot: 
        return None
    
    # Validar orden secuencial: solo permitir actualizar si el paso anterior está completado
    if db_snapshot.numero_paso > 1:
        # Buscar el paso anterior
        prev_result = await db.execute(
            select(models.SnapshotPaso).filter(
                models.SnapshotPaso.ejecucion_caso_id == db_snapshot.ejecucion_caso_id,
                models.SnapshotPaso.numero_paso == db_snapshot.numero_paso - 1
            )
        )
        prev_snapshot = prev_result.scalar_one_or_none()
        
        # Si el paso anterior existe y no está completado, rechazar
        if prev_snapshot and prev_snapshot.estado_paso == models.EstadoResultado.SIN_CORRER:
            raise ValueError(f"Debe completar el paso {db_snapshot.numero_paso - 1} antes de continuar")
    
    # Actualizar el snapshot
    db_snapshot.estado_paso = estado
    if comentarios: 
        db_snapshot.comentarios = comentarios
    if evidencia_url: 
        db_snapshot.evidencia_url = sanitize_evidence_url(evidencia_url)
    
    await db.commit()
    await db.refresh(db_snapshot)
    return db_snapshot

async def update_execution_snapshots_bulk(
    db: AsyncSession,
    ejecucion_id: UUID,
    updates: list[schemas.SnapshotPasoUpdate],
):
    if not updates:
        return []

    result = await db.execute(
        select(models.SnapshotPaso)
        .filter(models.SnapshotPaso.ejecucion_caso_id == ejecucion_id)
        .order_by(models.SnapshotPaso.numero_paso)
    )
    snapshots = result.scalars().all()
    snapshots_by_id = {snapshot.id: snapshot for snapshot in snapshots}
    updates_by_id = {update.id: update for update in updates}

    missing_ids = [update.id for update in updates if update.id not in snapshots_by_id]
    if missing_ids:
        raise ValueError("Uno o mas pasos no pertenecen a la ejecucion")

    planned_status = {
        snapshot.id: updates_by_id[snapshot.id].estado if snapshot.id in updates_by_id else snapshot.estado_paso
        for snapshot in snapshots
    }
    for index, snapshot in enumerate(snapshots):
        if index == 0:
            continue
        previous = snapshots[index - 1]
        if snapshot.id in updates_by_id and planned_status[previous.id] == models.EstadoResultado.SIN_CORRER:
            raise ValueError(f"Debe completar el paso {previous.numero_paso} antes de continuar")

    for update in updates:
        snapshot = snapshots_by_id[update.id]
        snapshot.estado_paso = update.estado
        if update.comentarios is not None:
            snapshot.comentarios = update.comentarios
        if update.evidencia_url is not None:
            snapshot.evidencia_url = sanitize_evidence_url(update.evidencia_url)

    await db.commit()
    refreshed = await get_snapshots_ejecucion(db, ejecucion_id)
    return refreshed

async def update_ejecucion_status(db: AsyncSession, ejecucion_id: UUID, estado: models.EstadoResultado, duracion: int = 0, observaciones: str | None = None):
    result = await db.execute(
        select(models.EjecucionCaso)
        .filter(models.EjecucionCaso.id == ejecucion_id)
        .with_for_update()
    )
    db_ejecucion = result.scalar_one_or_none()
    if not db_ejecucion: return None
    db_ejecucion.estado_resultado = estado
    db_ejecucion.fecha_ejecucion = utc_now()
    if duracion > 0: db_ejecucion.duracion_segundos += duracion
    if observaciones is not None:
        db_ejecucion.observaciones = observaciones
    await db.commit()
    await db.refresh(db_ejecucion)
    return db_ejecucion

async def mark_ai_execution_reviewed(
    db: AsyncSession,
    ejecucion_id: UUID,
    user_id: UUID,
    note: Optional[str] = None,
):
    result = await db.execute(select(models.EjecucionCaso).filter(models.EjecucionCaso.id == ejecucion_id))
    execution = result.scalar_one_or_none()
    if not execution:
        return None
    run_result = await db.execute(select(models.TestRun).filter(models.TestRun.id == execution.test_run_id))
    run = run_result.scalar_one_or_none()
    execution_mode = _execution_mode_value(execution, run_origin=run.origen if run else None)
    if execution_mode != models.ExecutionMode.IA.value and not _has_ai_execution_data(execution):
        raise ValueError("La ejecucion no tiene datos de IA para revisar")
    execution.execution_mode = models.ExecutionMode.IA
    execution.ai_review_status = models.AiReviewStatus.REVISADA
    execution.ai_human_review_required = False
    execution.ai_reviewed_by = user_id
    execution.ai_reviewed_at = utc_now()
    execution.ai_review_note = note
    report = execution.ai_report if isinstance(execution.ai_report, dict) else {}
    execution.ai_report = {
        **report,
        "human_review_required": False,
        "human_review_status": models.AiReviewStatus.REVISADA.value,
        "human_review_note": note,
        "human_reviewed_at": isoformat_utc(execution.ai_reviewed_at),
        "human_reviewed_by": str(user_id),
    }
    await db.commit()
    await db.refresh(execution)
    return execution

async def get_snapshots_ejecucion(db: AsyncSession, ejecucion_id: UUID, skip: int = 0, limit: int = 100):
    result = await db.execute(
        select(models.SnapshotPaso)
        .filter(models.SnapshotPaso.ejecucion_caso_id == ejecucion_id)
        .order_by(models.SnapshotPaso.numero_paso)
        .offset(skip)
        .limit(limit)
    )
    snapshots = result.scalars().all()
    if not snapshots:
        return []

    execution_result = await db.execute(
        select(models.EjecucionCaso).filter(models.EjecucionCaso.id == ejecucion_id)
    )
    ejecucion = execution_result.scalar_one_or_none()
    if not ejecucion:
        return snapshots
    run_result = await db.execute(select(models.TestRun).filter(models.TestRun.id == ejecucion.test_run_id))
    run = run_result.scalar_one_or_none()
    run_variables = {str(key): str(value) for key, value in ((run.variables_resueltas if run else {}) or {}).items()}

    steps_result = await db.execute(
        select(models.PasoPrueba)
        .filter(models.PasoPrueba.caso_id == ejecucion.caso_id)
        .filter(models.PasoPrueba.numero_paso.in_([snapshot.numero_paso for snapshot in snapshots]))
    )
    steps_by_number = {step.numero_paso: step for step in steps_result.scalars().all()}
    step_ids = {snapshot.paso_id for snapshot in snapshots if snapshot.paso_id}
    steps_by_id = {}
    if step_ids:
        steps_by_id_result = await db.execute(
            select(models.PasoPrueba).filter(models.PasoPrueba.id.in_(step_ids))
        )
        steps_by_id = {step.id: step for step in steps_by_id_result.scalars().all()}

    enriched = []
    for snapshot in snapshots:
        item = {
            "id": snapshot.id,
            "ejecucion_caso_id": snapshot.ejecucion_caso_id,
            "paso_id": snapshot.paso_id,
            "numero_paso": snapshot.numero_paso,
            "accion_congelada": snapshot.accion_congelada,
            "datos_congelados": snapshot.datos_congelados,
            "datos_resueltos": _resolve_placeholders(snapshot.datos_congelados or "", run_variables) if snapshot.datos_congelados else None,
            "resultado_esperado_congelado": snapshot.resultado_esperado_congelado,
            "estado_paso": snapshot.estado_paso,
            "comentarios": snapshot.comentarios,
            "evidencia_url": snapshot.evidencia_url,
            "error_log": snapshot.error_log,
            "action_references": [],
            "expected_references": [],
        }
        step = steps_by_id.get(snapshot.paso_id) if snapshot.paso_id else None
        if not step:
            step = steps_by_number.get(snapshot.numero_paso)
        if step:
            if item["datos_congelados"] is None:
                item["datos_congelados"] = step.datos
                item["datos_resueltos"] = _resolve_placeholders(step.datos or "", run_variables) if step.datos else None
            links = await get_paso_attachments(db, step.id)
            item["action_references"] = [
                _attachment_to_dict(link.attachment)
                for link in links
                if link.tipo == "ACTION_REFERENCE"
            ]
            item["expected_references"] = [
                _attachment_to_dict(link.attachment)
                for link in links
                if link.tipo == "EXPECTED_REFERENCE"
            ]
        enriched.append(sanitize_execution_snapshot_item(item))
    return enriched

async def get_caso_execution_history(db: AsyncSession, caso_id: UUID, limit: int = 10, build_id: Optional[UUID] = None):
    """Obtener historial de ejecuciones de un caso específico"""
    case_result = await db.execute(select(models.CasoPrueba).filter(models.CasoPrueba.id == caso_id))
    db_case = case_result.scalar_one_or_none()
    if not db_case:
        return []
    version_ids_result = await db.execute(
        select(models.CasoPrueba.id).filter(models.CasoPrueba.master_id == db_case.master_id)
    )
    version_ids = list(version_ids_result.scalars().all())
    query = (
        select(models.EjecucionCaso)
        .join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
        .filter(models.EjecucionCaso.caso_id.in_(version_ids))
        .filter(models.EjecucionCaso.estado_resultado != models.EstadoResultado.SIN_CORRER)
    )
    if build_id:
        query = query.filter(models.TestRun.build_id == build_id)
    result = await db.execute(
        query
        .order_by(models.EjecucionCaso.fecha_ejecucion.desc())
        .limit(limit)
    )
    return result.scalars().all()
