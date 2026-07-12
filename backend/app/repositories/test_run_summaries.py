from .legacy_common import *
from ..services.execution_output_sanitizer import sanitize_execution_snapshot_item


async def get_test_runs_summary(
    db: AsyncSession,
    proyecto_id: UUID,
    skip: int = 0,
    limit: int = 100,
    build_id: Optional[UUID] = None,
    component_id: Optional[UUID] = None,
    case_query: Optional[str] = None,
    case_code: Optional[str] = None,
    status: Optional[str] = None,
    origin: Optional[str] = None,
    runner_id: Optional[UUID] = None,
    environment_id: Optional[UUID] = None,
    dataset_id: Optional[UUID] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    has_evidence: Optional[bool] = None,
    version_executed: Optional[int] = None,
    ai_review_status: Optional[str] = None,
):
    runs = await get_test_runs_proyecto(
        db,
        proyecto_id=proyecto_id,
        skip=skip,
        limit=limit,
        build_id=build_id,
        component_id=component_id,
        case_query=case_query,
        case_code=case_code,
        status=status,
        origin=origin,
        runner_id=runner_id,
        environment_id=environment_id,
        dataset_id=dataset_id,
        date_from=date_from,
        date_to=date_to,
        has_evidence=has_evidence,
        version_executed=version_executed,
        ai_review_status=ai_review_status,
    )
    run_ids = [run.id for run in runs]
    if not run_ids:
        return []

    result_ejecuciones = await db.execute(
        select(models.EjecucionCaso)
        .filter(models.EjecucionCaso.test_run_id.in_(run_ids))
    )
    ejecuciones = result_ejecuciones.scalars().all()

    result_builds = await db.execute(
        select(models.Build).filter(models.Build.id.in_([run.build_id for run in runs if run.build_id]))
    )
    builds = {build.id: build for build in result_builds.scalars().all()}

    component_ids = {build.componente_id for build in builds.values() if build.componente_id}
    result_components = await db.execute(
        select(models.Componente).filter(models.Componente.id.in_(component_ids))
    ) if component_ids else None
    components = {component.id: component for component in result_components.scalars().all()} if result_components else {}

    result_entornos = await db.execute(
        select(models.Entorno).filter(models.Entorno.id.in_([run.entorno_id for run in runs if run.entorno_id]))
    )
    entornos = {entorno.id: entorno for entorno in result_entornos.scalars().all()}

    result_datasets = await db.execute(
        select(models.EntornoDataset).filter(models.EntornoDataset.id.in_([run.dataset_id for run in runs if run.dataset_id]))
    )
    datasets = {dataset.id: dataset for dataset in result_datasets.scalars().all()}

    result_users = await db.execute(
        select(models.Usuario).filter(models.Usuario.id.in_([run.creado_por for run in runs if run.creado_por]))
    )
    users = {user.id: user for user in result_users.scalars().all()}

    by_run = {run.id: [] for run in runs}
    for ejec in ejecuciones:
        by_run.setdefault(ejec.test_run_id, []).append(ejec)
    evidencias_by_run = await _load_run_evidence_preview(db, ejecuciones)

    summaries = []
    for run in runs:
        run_ejecuciones = by_run.get(run.id, [])
        passed = sum(1 for item in run_ejecuciones if item.estado_resultado == models.EstadoResultado.PASO)
        failed = sum(1 for item in run_ejecuciones if item.estado_resultado == models.EstadoResultado.FALLO)
        blocked = sum(1 for item in run_ejecuciones if item.estado_resultado == models.EstadoResultado.BLOQUEADO)
        pending = sum(1 for item in run_ejecuciones if item.estado_resultado == models.EstadoResultado.SIN_CORRER)
        execution_modes = {"manual": 0, "ia": 0, "automatizada": 0, "externa": 0}
        ai_review_required = 0
        ai_review_reviewed = 0
        ai_review_pending = 0
        for ejec in run_ejecuciones:
            mode = _execution_mode_value(ejec, run_origin=run.origen)
            execution_modes[_execution_mode_key(mode)] += 1
            is_ai_execution = mode == models.ExecutionMode.IA.value or _has_ai_execution_data(ejec)
            if is_ai_execution:
                review_status = _review_status_for_execution(ejec)
                if review_status == models.AiReviewStatus.REQUIERE_REVISION.value:
                    ai_review_required += 1
                    ai_review_pending += 1
                elif review_status == models.AiReviewStatus.REVISADA.value:
                    ai_review_reviewed += 1
        mode_summary = _execution_modes_summary(execution_modes)
        status = "failed" if failed else "blocked" if blocked else "passed" if passed else "pending"
        user = users.get(run.creado_por)
        build = builds.get(run.build_id)
        component = components.get(build.componente_id) if build and build.componente_id else None
        entorno = entornos.get(run.entorno_id)
        dataset = datasets.get(run.dataset_id)
        summaries.append({
            "id": str(run.id),
            "runId": run.nombre or str(run.id)[:8].upper(),
            "projectId": str(run.proyecto_id),
            "build_id": str(run.build_id) if run.build_id else None,
            "build_name": build.nombre if build else None,
            "build_code": build.codigo if build else None,
            "component_id": str(component.id) if component else None,
            "component_name": component.nombre if component else None,
            "environment_id": str(run.entorno_id) if run.entorno_id else None,
            "environment_name": entorno.nombre if entorno else run.entorno,
            "dataset_id": str(run.dataset_id) if run.dataset_id else None,
            "dataset_name": dataset.nombre if dataset else None,
            "origin": run.origen,
            "execution_modes": execution_modes,
            **mode_summary,
            "ai_review_required": ai_review_required,
            "ai_review_reviewed": ai_review_reviewed,
            "ai_review_pending": ai_review_pending,
            "runner_id": str(run.creado_por),
            "date": run.fecha_creacion.isoformat() if run.fecha_creacion else None,
            "suite": build.nombre if build else run.entorno,
            "runner": (user.nombre_completo or user.email) if user else "Sistema",
            "passed": passed,
            "failed": failed,
            "blocked": blocked,
            "pending": pending,
            "status": status,
            "evidencias": evidencias_by_run.get(run.id, []),
        })
    return summaries


async def _load_snapshot_attachments_by_snapshot_ids(
    db: AsyncSession,
    snapshot_ids: List[UUID],
) -> Dict[UUID, List[models.SnapshotAttachment]]:
    if not snapshot_ids:
        return {}
    result = await db.execute(
        select(models.SnapshotAttachment)
        .options(selectinload(models.SnapshotAttachment.attachment))
        .filter(models.SnapshotAttachment.snapshot_id.in_(snapshot_ids))
        .order_by(models.SnapshotAttachment.created_at)
    )
    grouped: Dict[UUID, List[models.SnapshotAttachment]] = {}
    for link in result.scalars().all():
        grouped.setdefault(link.snapshot_id, []).append(link)
    return grouped


async def _load_paso_attachments_by_paso_ids(
    db: AsyncSession,
    paso_ids: List[UUID],
) -> Dict[UUID, List[models.PasoAttachment]]:
    if not paso_ids:
        return {}
    result = await db.execute(
        select(models.PasoAttachment)
        .options(selectinload(models.PasoAttachment.attachment))
        .filter(models.PasoAttachment.paso_id.in_(paso_ids))
        .order_by(models.PasoAttachment.created_at)
    )
    grouped: Dict[UUID, List[models.PasoAttachment]] = {}
    for link in result.scalars().all():
        grouped.setdefault(link.paso_id, []).append(link)
    return grouped


async def _load_run_evidence_preview(
    db: AsyncSession,
    ejecuciones: List[models.EjecucionCaso],
    max_per_run: int = 3,
) -> Dict[UUID, List[Dict[str, Any]]]:
    execution_ids = [ejec.id for ejec in ejecuciones]
    if not execution_ids:
        return {}
    result = await db.execute(
        select(models.SnapshotPaso)
        .filter(models.SnapshotPaso.ejecucion_caso_id.in_(execution_ids))
        .order_by(models.SnapshotPaso.ejecucion_caso_id, models.SnapshotPaso.numero_paso)
    )
    snapshots = result.scalars().all()
    attachments_by_snapshot = await _load_snapshot_attachments_by_snapshot_ids(db, [snapshot.id for snapshot in snapshots])
    run_by_execution = {ejec.id: ejec.test_run_id for ejec in ejecuciones}
    evidence_by_run: Dict[UUID, Dict[str, Dict[str, Any]]] = {}
    for snapshot in snapshots:
        run_id = run_by_execution.get(snapshot.ejecucion_caso_id)
        if not run_id:
            continue
        run_evidence = evidence_by_run.setdefault(run_id, {})
        if len(run_evidence) >= max_per_run:
            continue
        links = attachments_by_snapshot.get(snapshot.id, [])
        for link in links:
            item = _attachment_to_dict(link.attachment)
            run_evidence.setdefault(item["id"], item)
            if len(run_evidence) >= max_per_run:
                break
    return {run_id: list(items.values()) for run_id, items in evidence_by_run.items()}


async def _load_enriched_snapshots_by_execution(
    db: AsyncSession,
    ejecuciones: List[models.EjecucionCaso],
    run: models.TestRun,
) -> Dict[UUID, List[Dict[str, Any]]]:
    execution_ids = [ejec.id for ejec in ejecuciones]
    if not execution_ids:
        return {}

    snapshots_result = await db.execute(
        select(models.SnapshotPaso)
        .filter(models.SnapshotPaso.ejecucion_caso_id.in_(execution_ids))
        .order_by(models.SnapshotPaso.ejecucion_caso_id, models.SnapshotPaso.numero_paso)
    )
    snapshots = snapshots_result.scalars().all()
    if not snapshots:
        return {ejec.id: [] for ejec in ejecuciones}

    execution_by_id = {ejec.id: ejec for ejec in ejecuciones}
    run_variables = {str(key): str(value) for key, value in ((run.variables_resueltas if run else {}) or {}).items()}
    case_ids = list({ejec.caso_id for ejec in ejecuciones})
    step_numbers = list({snapshot.numero_paso for snapshot in snapshots})
    snapshot_step_ids = list({snapshot.paso_id for snapshot in snapshots if snapshot.paso_id})

    steps_by_id: Dict[UUID, models.PasoPrueba] = {}
    steps_by_case_number: Dict[tuple, models.PasoPrueba] = {}
    if case_ids and step_numbers:
        steps_result = await db.execute(
            select(models.PasoPrueba).filter(
                models.PasoPrueba.caso_id.in_(case_ids),
                models.PasoPrueba.numero_paso.in_(step_numbers),
            )
        )
        for step in steps_result.scalars().all():
            steps_by_id[step.id] = step
            steps_by_case_number[(step.caso_id, step.numero_paso)] = step
    if snapshot_step_ids:
        steps_by_id_result = await db.execute(
            select(models.PasoPrueba).filter(models.PasoPrueba.id.in_(snapshot_step_ids))
        )
        for step in steps_by_id_result.scalars().all():
            steps_by_id[step.id] = step
            steps_by_case_number[(step.caso_id, step.numero_paso)] = step

    all_step_ids = list(steps_by_id.keys())
    paso_attachments_by_paso = await _load_paso_attachments_by_paso_ids(db, all_step_ids)
    snapshot_attachments_by_snapshot = await _load_snapshot_attachments_by_snapshot_ids(
        db,
        [snapshot.id for snapshot in snapshots],
    )

    grouped: Dict[UUID, List[Dict[str, Any]]] = {ejec.id: [] for ejec in ejecuciones}
    for snapshot in snapshots:
        execution = execution_by_id.get(snapshot.ejecucion_caso_id)
        if not execution:
            continue
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
            step = steps_by_case_number.get((execution.caso_id, snapshot.numero_paso))
        if step:
            if item["datos_congelados"] is None:
                item["datos_congelados"] = step.datos
                item["datos_resueltos"] = _resolve_placeholders(step.datos or "", run_variables) if step.datos else None
            links = paso_attachments_by_paso.get(step.id, [])
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
        item["evidencias"] = [
            _attachment_to_dict(link.attachment)
            for link in snapshot_attachments_by_snapshot.get(snapshot.id, [])
        ]
        grouped.setdefault(snapshot.ejecucion_caso_id, []).append(_json_safe(sanitize_execution_snapshot_item(item)))
    return grouped
