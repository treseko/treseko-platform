from .legacy_common import *
from ..services.ai_report_sanitizer import sanitize_ai_report_payload


async def complete_ai_engine_execution(
    db: AsyncSession,
    ejecucion_id: UUID,
    payload: schemas.AiEngineExecutionResult,
):
    result = await db.execute(
        select(models.EjecucionCaso, models.CasoPrueba)
        .join(models.CasoPrueba, models.CasoPrueba.id == models.EjecucionCaso.caso_id)
        .filter(models.EjecucionCaso.id == ejecucion_id)
    )
    row = result.first()
    if not row:
        raise ValueError("Ejecucion no encontrada")

    execution, case = row
    now = utc_now()
    final_status = payload.status
    execution.estado_resultado = final_status
    execution.execution_mode = models.ExecutionMode.IA
    execution.duracion_segundos = max(0, payload.duration_seconds or 0)
    execution.observaciones = payload.observations or payload.error_message or payload.logs
    execution.fecha_ejecucion = now
    ai_report = {**(execution.ai_report or {}), **(payload.ai_report or {})}
    report_summary = payload.metadata.get("ai_report_summary") if isinstance(payload.metadata, dict) else None
    if not isinstance(report_summary, dict):
        report_summary = {}
    current_run_result = await db.execute(
        select(models.TestRun).filter(models.TestRun.id == execution.test_run_id)
    )
    current_run = current_run_result.scalar_one_or_none()
    previous_query = (
        select(models.EjecucionCaso, models.TestRun)
        .join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
        .filter(
            models.EjecucionCaso.caso_id == execution.caso_id,
            models.EjecucionCaso.id != execution.id,
            models.EjecucionCaso.estado_resultado.in_([
                models.EstadoResultado.PASO,
                models.EstadoResultado.FALLO,
                models.EstadoResultado.BLOQUEADO,
            ]),
        )
        .order_by(models.EjecucionCaso.fecha_ejecucion.desc())
        .limit(5)
    )
    if current_run:
        previous_query = previous_query.filter(models.TestRun.build_id == current_run.build_id)
        if current_run.dataset_id:
            previous_query = previous_query.filter(models.TestRun.dataset_id == current_run.dataset_id)
    previous_rows = (await db.execute(previous_query)).all()
    previous_recent_results = [
        {
            "execution_id": str(prev_exec.id),
            "run_id": str(prev_run.id),
            "run_name": prev_run.nombre,
            "status": prev_exec.estado_resultado.value,
            "date": isoformat_utc(prev_exec.fecha_ejecucion),
            "duration_seconds": prev_exec.duracion_segundos,
        }
        for prev_exec, prev_run in previous_rows
    ]
    if previous_recent_results:
        ai_report.setdefault("previous_recent_results", previous_recent_results)
        if any(item["status"] != final_status.value for item in previous_recent_results):
            ai_report["repeatability_warning"] = True
            ai_report.setdefault("failure_category", "unstable_result")
            ai_report["human_review_required"] = True
    execution.ai_report = ai_report
    trace_items = []
    if isinstance(ai_report, dict):
        if isinstance(ai_report.get("workflow_traces"), list):
            trace_items = ai_report.get("workflow_traces") or []
        elif isinstance(ai_report.get("timeline"), list):
            trace_items = [
                item for item in ai_report.get("timeline") or []
                if isinstance(item, dict) and (item.get("node_id") or item.get("workflow_id"))
            ]
    if trace_items:
        await db.execute(delete(models.AiExecutionTrace).where(models.AiExecutionTrace.execution_id == execution.id))

        def _parse_trace_time(value):
            if not value:
                return None
            try:
                return ensure_utc(datetime.fromisoformat(str(value).replace("Z", "+00:00")))
            except Exception:
                return None

        for item in trace_items:
            if not isinstance(item, dict):
                continue
            try:
                workflow_id = UUID(str(item.get("workflow_id"))) if item.get("workflow_id") else None
            except (TypeError, ValueError):
                workflow_id = None
            try:
                node_id = UUID(str(item.get("node_id"))) if item.get("node_id") else None
            except (TypeError, ValueError):
                node_id = None
            db.add(models.AiExecutionTrace(
                execution_id=execution.id,
                workflow_id=workflow_id,
                workflow_version=item.get("workflow_version"),
                node_id=node_id,
                status=str(item.get("status") or item.get("level") or "SUCCESS")[:30],
                input_json=sanitize_ai_report_payload(item.get("input_json") if isinstance(item.get("input_json"), dict) else item.get("input") if isinstance(item.get("input"), dict) else {}),
                output_json=sanitize_ai_report_payload(item.get("output_json") if isinstance(item.get("output_json"), dict) else item.get("output") if isinstance(item.get("output"), dict) else {}),
                metrics_json=sanitize_ai_report_payload(item.get("metrics_json") if isinstance(item.get("metrics_json"), dict) else item.get("metrics") if isinstance(item.get("metrics"), dict) else {}),
                started_at=_parse_trace_time(item.get("started_at") or item.get("ts")),
                ended_at=_parse_trace_time(item.get("ended_at") or item.get("ts")),
            ))
    raw_confidence = ai_report.get("confidence", report_summary.get("confidence"))
    try:
        execution.ai_confidence = int(round(float(raw_confidence))) if raw_confidence is not None else None
    except (TypeError, ValueError):
        execution.ai_confidence = None
    execution.ai_consensus = str(ai_report.get("consensus") or report_summary.get("consensus") or final_status.value)[:30]
    failure_category = ai_report.get("failure_category") or report_summary.get("failure_category")
    execution.ai_failure_category = str(failure_category)[:80] if failure_category else None
    error_code = _ai_error_code_from_report(ai_report, final_status)
    if error_code:
        ai_report["error_code"] = error_code
    execution.ai_human_review_required = bool(
        ai_report.get("human_review_required", report_summary.get("human_review_required", final_status != models.EstadoResultado.PASO))
    )
    execution.ai_review_status = (
        models.AiReviewStatus.REQUIERE_REVISION
        if execution.ai_human_review_required
        else models.AiReviewStatus.NO_REQUIERE_REVISION
    )
    execution.ai_report = sanitize_ai_report_payload(ai_report)

    snapshots_result = await db.execute(
        select(models.SnapshotPaso)
        .filter(models.SnapshotPaso.ejecucion_caso_id == execution.id)
        .order_by(models.SnapshotPaso.numero_paso)
    )
    snapshots = snapshots_result.scalars().all()
    snapshots_by_number = {snapshot.numero_paso: snapshot for snapshot in snapshots}

    for step in payload.steps:
        snapshot = snapshots_by_number.get(step.number)
        if not snapshot:
            snapshot = models.SnapshotPaso(
                ejecucion_caso_id=execution.id,
                numero_paso=step.number,
                accion_congelada=f"Paso IA {step.number}",
                resultado_esperado_congelado="Resultado reportado por Motor IA",
            )
            db.add(snapshot)
            await db.flush()
            snapshots.append(snapshot)
            snapshots_by_number[snapshot.numero_paso] = snapshot
        snapshot.estado_paso = step.status
        snapshot.comentarios = step.observations
        snapshot.error_log = step.error_log
        await _persist_ai_screenshot(
            db,
            execution,
            snapshot,
            f"ai-engine-step-{step.number}.png",
            step.screenshot_base64,
        )

    if snapshots and not payload.steps:
        for index, snapshot in enumerate(snapshots):
            snapshot.estado_paso = models.EstadoResultado.PASO if final_status == models.EstadoResultado.PASO else (
                final_status if index == 0 else models.EstadoResultado.SIN_CORRER
            )
            if index == 0:
                snapshot.comentarios = payload.observations or payload.error_message
                snapshot.error_log = payload.logs
    elif not snapshots:
        snapshot = models.SnapshotPaso(
            ejecucion_caso_id=execution.id,
            numero_paso=0,
            accion_congelada="Ejecucion con Motor IA",
            resultado_esperado_congelado="Resultado reportado por Motor IA",
            estado_paso=final_status,
            comentarios=payload.observations or payload.error_message,
            error_log=payload.logs,
        )
        db.add(snapshot)
        await db.flush()
        snapshots.append(snapshot)

    default_snapshot = next(
        (
            snapshot for snapshot in snapshots
            if snapshot.estado_paso in {models.EstadoResultado.FALLO, models.EstadoResultado.BLOQUEADO}
        ),
        snapshots[0] if snapshots else None,
    )
    await _persist_ai_screenshot(
        db,
        execution,
        default_snapshot,
        "ai-engine-final.png",
        payload.final_screenshot_base64,
    )

    case.ultimo_resultado = final_status.value
    case.ultima_ejecucion_por = execution.ejecutado_por
    case.ultima_ejecucion_fecha = now

    pending_result = await db.execute(
        select(models.EjecucionCaso.id)
        .filter(
            models.EjecucionCaso.test_run_id == execution.test_run_id,
            models.EjecucionCaso.estado_resultado.in_([
                models.EstadoResultado.SIN_CORRER,
                models.EstadoResultado.EJECUTANDO_AI,
            ]),
        )
        .limit(1)
    )
    run_result = await db.execute(select(models.TestRun).filter(models.TestRun.id == execution.test_run_id))
    run = run_result.scalar_one_or_none()
    if run and pending_result.scalar_one_or_none() is None:
        run.estado_run = models.EstadoRun.CERRADO
        run.fecha_cierre = now

    await db.commit()
    await db.refresh(execution)
    return execution

async def run_ai_engine_dry_run(
    db: AsyncSession,
    payload: schemas.AiEngineDryRunRequest,
):
    config = await get_ai_engine_config(db)
    workflow_definition = await get_active_ai_workflow_definition(db)
    health = await check_ai_engine_health(db)
    if health.get("status") != "ok":
        raise ConnectionError(f"Motor IA no disponible: {health.get('detail') or 'no responde'}")

    variables, environment_name, dataset_name, dataset_vars, case_vars = await _resolve_dry_run_variables(db, payload)
    base_url = get_ai_base_url_from_context(variables, payload.pasos)
    if not base_url:
        raise ValueError("Motor IA requiere una URL base en el ambiente/dataset o en los datos de un paso.")

    steps = _automation_steps_for_payload(payload.pasos)
    guidance = "\n".join(
        [
            f"{step['number']}. Accion: {step['action']}. Datos: {step.get('data') or '-'}. Esperado: {step.get('expected') or '-'}"
            for step in steps
        ]
    )
    test_id = f"AI-DRY-RUN-{uuid.uuid4().hex[:10]}"
    task_payload = {
        "dry_run": True,
        "case_code": payload.codigo or "AI-DRY-RUN",
        "case_title": payload.titulo,
        "task": f"Dry-run IA del caso manual {payload.codigo or 'AI-DRY-RUN'}: {payload.titulo}\nPrecondiciones: {payload.precondiciones or '-'}\nPasos:\n{guidance}\nPostcondiciones: {payload.postcondiciones or '-'}",
        "url": base_url,
        "base_url": base_url,
        "testId": test_id,
        "suite": "ai-dry-run",
        "expected": payload.descripcion or payload.postcondiciones or None,
        "guidance": guidance,
        "steps": steps,
        "step_map": {},
        "environment": environment_name,
        "dataset_name": dataset_name,
        "dataset": [{"key": key, "value": value} for key, value in variables.items()],
        "dataset_ambiente": dataset_vars,
        "dataset_caso": case_vars,
        "variables": variables,
        "maxSteps": len(steps) or int(config.get("max_steps") or 10),
        "timeout_seconds": int(config.get("timeout_seconds") or 900),
        "headless": bool(config.get("headless")) and not payload.debug_mode,
        "viewport_width": int(config.get("viewport_width") or 1920),
        "viewport_height": int(config.get("viewport_height") or 1080),
        "agent_workflow": config.get("agent_workflow") or _legacy_agent_workflow_from_definition(workflow_definition),
        "workflow_definition": workflow_definition,
        "max_parallel_ai_runs": int(config.get("max_parallel_ai_runs") or 1),
        "provider": config.get("provider"),
        "llm_endpoint": config.get("llm_endpoint"),
        "model": config.get("model"),
        "temperature": config.get("temperature"),
        "token_cost_prompt_per_1k": config.get("token_cost_prompt_per_1k"),
        "token_cost_completion_per_1k": config.get("token_cost_completion_per_1k"),
        "token_cost_per_1k": config.get("token_cost_per_1k"),
    }
    write_trace("backend", "ai_request", {
        "request_id": test_id,
        "method": "POST",
        "url": f"{ENGINE_URL.rstrip('/')}/run-task-sync",
        "execution_id": test_id,
        "case_code": payload.codigo or "AI-DRY-RUN",
        "body": task_payload,
    })

    timeout_seconds = int(config.get("timeout_seconds") or 900)
    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_seconds, connect=10.0)) as client:
        response = await client.post(f"{ENGINE_URL.rstrip('/')}/run-task-sync", json=task_payload)
    if response.status_code >= 400:
        raise ConnectionError(f"Motor IA rechazo el dry-run: HTTP {response.status_code} {response.text[:300]}")
    data = response.json()
    return schemas.AiEngineDryRunResult(**data)

# --- PORTABILIDAD ---
MAX_PROJECT_IMPORT_SUITES = 1000
MAX_PROJECT_IMPORT_CASES = 2000
MAX_PROJECT_IMPORT_STEPS_PER_CASE = schemas.MAX_TEST_CASE_STEPS
MAX_PROJECT_IMPORT_METADATA_BYTES = 32 * 1024


def _require_import_mapping(value: Any, label: str) -> dict:
    if not isinstance(value, dict):
        raise ValueError(f"{label} debe ser un objeto")
    return value


def _require_import_list(value: Any, label: str, max_items: int) -> list:
    if not isinstance(value, list):
        raise ValueError(f"{label} debe ser una lista")
    if len(value) > max_items:
        raise ValueError(f"{label} no puede tener mas de {max_items} elementos")
    return value


def _bounded_import_text(value: Any, label: str, max_length: int, *, required: bool = False) -> Optional[str]:
    if value is None:
        if required:
            raise ValueError(f"{label} es requerido")
        return None
    if not isinstance(value, str):
        raise ValueError(f"{label} debe ser texto")
    text = value.strip()
    if required and not text:
        raise ValueError(f"{label} es requerido")
    if len(text) > max_length:
        raise ValueError(f"{label} no puede superar {max_length} caracteres")
    return text


def _bounded_import_int(value: Any, label: str, *, minimum: int, maximum: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"{label} debe ser numerico")
    if value < minimum or value > maximum:
        raise ValueError(f"{label} debe estar entre {minimum} y {maximum}")
    return value


def _import_enum_value(value: Any, label: str, enum_cls: type, default: str) -> str:
    text = _bounded_import_text(value if value is not None else default, label, 30, required=True)
    allowed = {item.value for item in enum_cls}
    if text not in allowed:
        raise ValueError(f"{label} invalido")
    return text


def _normalize_import_package(package: dict) -> dict:
    package = _require_import_mapping(package, "package")
    proyecto_data = _require_import_mapping(package.get("proyecto"), "proyecto")
    suites_data = _require_import_list(package.get("suites", []), "suites", MAX_PROJECT_IMPORT_SUITES)
    cases_data = _require_import_list(package.get("casos", []), "casos", MAX_PROJECT_IMPORT_CASES)

    normalized_suites = []
    seen_suite_ids: set[str] = set()
    for index, suite in enumerate(suites_data):
        suite = _require_import_mapping(suite, f"suites[{index}]")
        suite_id = _bounded_import_text(suite.get("id"), f"suites[{index}].id", 100, required=True)
        if suite_id in seen_suite_ids:
            raise ValueError("El paquete contiene suites duplicadas")
        seen_suite_ids.add(suite_id)
        parent_id = _bounded_import_text(suite.get("parent_id"), f"suites[{index}].parent_id", 100)
        normalized_suites.append({
            "id": suite_id,
            "parent_id": parent_id,
            "nombre": _bounded_import_text(suite.get("nombre"), f"suites[{index}].nombre", schemas.MAX_SUITE_NAME_LENGTH, required=True),
            "descripcion": _bounded_import_text(suite.get("descripcion"), f"suites[{index}].descripcion", schemas.MAX_SUITE_DESCRIPTION_LENGTH),
        })

    normalized_cases = []
    for index, case in enumerate(cases_data):
        case = _require_import_mapping(case, f"casos[{index}]")
        suite_id = _bounded_import_text(case.get("suite_id"), f"casos[{index}].suite_id", 100)
        if suite_id and suite_id not in seen_suite_ids:
            raise ValueError("El paquete referencia una suite inexistente")
        steps_data = _require_import_list(case.get("pasos", []), f"casos[{index}].pasos", MAX_PROJECT_IMPORT_STEPS_PER_CASE)
        normalized_steps = []
        for step_index, step in enumerate(steps_data):
            step = _require_import_mapping(step, f"casos[{index}].pasos[{step_index}]")
            metadata_ai = step.get("metadata_ai")
            if metadata_ai is not None:
                metadata_ai = schemas.validate_preference_json_payload(
                    metadata_ai,
                    max_bytes=MAX_PROJECT_IMPORT_METADATA_BYTES,
                    label="metadata_ai",
                )
            normalized_steps.append({
                "numero_paso": _bounded_import_int(
                    step.get("numero_paso"),
                    f"casos[{index}].pasos[{step_index}].numero_paso",
                    minimum=1,
                    maximum=schemas.MAX_TEST_CASE_STEPS,
                ),
                "accion": _bounded_import_text(
                    step.get("accion"),
                    f"casos[{index}].pasos[{step_index}].accion",
                    schemas.MAX_TEST_CASE_TEXT_LENGTH,
                    required=True,
                ),
                "resultado_esperado": _bounded_import_text(
                    step.get("resultado_esperado"),
                    f"casos[{index}].pasos[{step_index}].resultado_esperado",
                    schemas.MAX_TEST_CASE_TEXT_LENGTH,
                ),
                "metadata_ai": metadata_ai,
            })
        normalized_cases.append({
            "master_id": _bounded_import_text(case.get("master_id"), f"casos[{index}].master_id", 100, required=True),
            "suite_id": suite_id,
            "titulo": _bounded_import_text(case.get("titulo"), f"casos[{index}].titulo", schemas.MAX_TEST_CASE_TITLE_LENGTH, required=True),
            "precondiciones": _bounded_import_text(case.get("precondiciones"), f"casos[{index}].precondiciones", schemas.MAX_TEST_CASE_TEXT_LENGTH),
            "version": _bounded_import_int(case.get("version", 1), f"casos[{index}].version", minimum=1, maximum=10_000),
            "prioridad": _import_enum_value(case.get("prioridad"), f"casos[{index}].prioridad", models.Prioridad, models.Prioridad.MEDIA.value),
            "tipo_prueba": _import_enum_value(case.get("tipo_prueba"), f"casos[{index}].tipo_prueba", models.TipoPrueba, models.TipoPrueba.MANUAL.value),
            "estado_caso": _import_enum_value(case.get("estado_caso"), f"casos[{index}].estado_caso", models.EstadoCaso, models.EstadoCaso.ACTIVO.value),
            "pasos": normalized_steps,
        })

    return {
        "proyecto": {
            "nombre": _bounded_import_text(proyecto_data.get("nombre"), "proyecto.nombre", schemas.MAX_PROJECT_NAME_LENGTH, required=True),
            "descripcion": _bounded_import_text(proyecto_data.get("descripcion"), "proyecto.descripcion", schemas.MAX_PROJECT_DESCRIPTION_LENGTH),
            "organizacion_id": proyecto_data.get("organizacion_id"),
        },
        "suites": normalized_suites,
        "casos": normalized_cases,
    }


async def export_proyecto(db: AsyncSession, proyecto_id: UUID):
    proyecto = await get_proyecto(db, proyecto_id)
    if not proyecto: return None
    suites = await get_suites_proyecto(db, proyecto_id)
    result = await db.execute(select(models.CasoPrueba).filter(models.CasoPrueba.proyecto_id == proyecto_id).order_by(models.CasoPrueba.master_id, models.CasoPrueba.version))
    casos = result.scalars().all()
    package = {"version_formato": "1.0", "proyecto": {"nombre": proyecto.nombre, "descripcion": proyecto.descripcion}, "suites": [{"id": str(s.id), "parent_id": str(s.parent_id) if s.parent_id else None, "nombre": s.nombre, "descripcion": s.descripcion} for s in suites], "casos": []}
    for c in casos:
        result_pasos = await db.execute(select(models.PasoPrueba).filter(models.PasoPrueba.caso_id == c.id).order_by(models.PasoPrueba.numero_paso))
        pasos = result_pasos.scalars().all()
        package["casos"].append({"master_id": str(c.master_id), "suite_id": str(c.suite_id) if c.suite_id else None, "titulo": c.titulo, "precondiciones": c.precondiciones, "version": c.version, "prioridad": c.prioridad, "tipo_prueba": c.tipo_prueba, "estado_caso": c.estado_caso, "pasos": [{"numero_paso": p.numero_paso, "accion": p.accion, "resultado_esperado": p.resultado_esperado, "metadata_ai": p.metadata_ai} for p in pasos]})
    return package

async def import_proyecto(db: AsyncSession, package: dict, imported_by: UUID):
    package = _normalize_import_package(package)
    proyecto_data = package["proyecto"]
    organizacion_id = await resolve_project_organizacion(db, proyecto_data.get("organizacion_id"))
    db_proyecto = models.Proyecto(
        nombre=f"{proyecto_data['nombre']} (Importado {uuid.uuid4().hex[:4]})",
        descripcion=proyecto_data["descripcion"],
        organizacion_id=organizacion_id,
    )
    db.add(db_proyecto)
    await db.flush()
    id_map_suites = {}
    suites_pendientes = package["suites"]
    intentos = 0
    while suites_pendientes and intentos < 10:
        actuales = []
        for s in suites_pendientes:
            if s["parent_id"] is None or s["parent_id"] in id_map_suites:
                db_suite = models.Suite(proyecto_id=db_proyecto.id, parent_id=id_map_suites.get(s["parent_id"]), nombre=s["nombre"], descripcion=s["descripcion"])
                db.add(db_suite)
                await db.flush()
                id_map_suites[s["id"]] = db_suite.id
            else: actuales.append(s)
        suites_pendientes = actuales
        intentos += 1
    id_map_masters = {}
    for c in package["casos"]:
        if c["master_id"] not in id_map_masters: id_map_masters[c["master_id"]] = uuid.uuid4()
        db_caso = models.CasoPrueba(master_id=id_map_masters[c["master_id"]], proyecto_id=db_proyecto.id, suite_id=id_map_suites.get(c["suite_id"]), titulo=c["titulo"], precondiciones=c.get("precondiciones"), version=c["version"], prioridad=c["prioridad"], tipo_prueba=c["tipo_prueba"], estado_caso=c.get("estado_caso", "ACTIVO"), creado_por=imported_by)
        db.add(db_caso)
        await db.flush()
        for p in c["pasos"]:
            db_paso = models.PasoPrueba(caso_id=db_caso.id, numero_paso=p["numero_paso"], accion=p["accion"], resultado_esperado=p["resultado_esperado"], metadata_ai=p.get("metadata_ai"))
            db.add(db_paso)
    await db.commit()
    await db.refresh(db_proyecto)
    return db_proyecto

# --- ENTORNOS ---
async def get_entornos_proyecto(db: AsyncSession, proyecto_id: UUID, skip: int = 0, limit: int = 100):
    result = await db.execute(
        select(models.Entorno)
        .options(
            selectinload(models.Entorno.datasets),
            with_loader_criteria(models.EntornoDataset, models.EntornoDataset.activo == True),
        )
        .filter(
            models.Entorno.proyecto_id == proyecto_id,
            models.Entorno.activo == True,
        )
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()

async def create_entorno(db: AsyncSession, entorno: schemas.EntornoCreate):
    db_entorno = models.Entorno(**entorno.model_dump())
    db.add(db_entorno)
    await db.commit()
    result = await db.execute(
        select(models.Entorno)
        .options(
            selectinload(models.Entorno.datasets),
            with_loader_criteria(models.EntornoDataset, models.EntornoDataset.activo == True),
        )
        .filter(models.Entorno.id == db_entorno.id)
    )
    return result.scalar_one()
