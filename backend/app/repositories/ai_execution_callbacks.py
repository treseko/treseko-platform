from .repository_context import *
from .core_settings_ai_workflow_helpers import get_configured_ai_provider_api_key
from ..services import config_service
from ..services.ai_report_sanitizer import sanitize_ai_report_payload


async def recover_ai_execution_from_engine_log(db: AsyncSession, ejecucion_id: UUID):
    """Recover a terminal result only when the Engine log proves a PASO outcome."""
    execution = await db.get(models.EjecucionCaso, ejecucion_id)
    if not execution:
        raise ValueError("Ejecucion no encontrada")
    if execution.estado_resultado != models.EstadoResultado.EJECUTANDO_AI:
        raise ValueError("Solo se pueden recuperar ejecuciones IA que siguen en ejecucion")
    engine_url = ENGINE_URL.rstrip("/")
    headers = engine_internal_headers(current_correlation_id(str(ejecucion_id)))
    async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0)) as client:
        response = await client.get(f"{engine_url}/internal/executions/{ejecucion_id}/recovery-evidence", headers=headers)
    if not response.is_success:
        detail = response.json().get("error") if response.headers.get("content-type", "").startswith("application/json") else None
        raise ValueError(detail or "El Engine no pudo acreditar la recuperacion")
    evidence = response.json()
    if evidence.get("recoverable") is not True or evidence.get("status") != "PASO":
        raise ValueError("La evidencia del Engine no acredita un resultado PASO")
    passed_steps = [int(number) for number in evidence.get("passed_steps", []) if int(number) > 0]
    payload = schemas.AiEngineExecutionResult(
        status="PASO",
        observations=str(evidence.get("summary") or "Resultado recuperado desde evidencia del Engine."),
        metadata={
            "terminal_delivery_id": f"ai-recovery:{ejecucion_id}",
            "terminal_sequence": 1,
            "recovered": True,
            "recovery_reason": "backend_restart_during_terminal_callback",
        },
        ai_report={
            "schema_version": 1,
            "status": "PASO",
            "consensus": str(evidence.get("consensus") or "PASO"),
            "confidence": 90,
            "summary": str(evidence.get("summary") or "Resultado recuperado desde evidencia del Engine."),
            "recovered": True,
            "recovery_reason": "backend_restart_during_terminal_callback",
            "completed_via": "engine.log_recovery",
            "human_review_required": False,
        },
        steps=[{"number": number, "status": "PASO", "observations": "Paso acreditado por el log del Engine."} for number in passed_steps],
    )
    return await complete_ai_engine_execution(db, ejecucion_id, payload)


async def complete_ai_engine_execution(
    db: AsyncSession,
    ejecucion_id: UUID,
    payload: schemas.AiEngineExecutionResult,
):
    result = await db.execute(
        select(models.EjecucionCaso, models.CasoPrueba)
        .join(models.CasoPrueba, models.CasoPrueba.id == models.EjecucionCaso.caso_id)
        .filter(models.EjecucionCaso.id == ejecucion_id)
        .with_for_update()
    )
    row = result.first()
    if not row:
        raise ValueError("Ejecucion no encontrada")

    execution, case = row
    metadata = payload.metadata if isinstance(payload.metadata, dict) else {}
    delivery_id = str(metadata.get("terminal_delivery_id") or "").strip()
    current_report = execution.ai_report if isinstance(execution.ai_report, dict) else {}
    if (
        delivery_id
        and current_report.get("report_complete") is True
        and execution.estado_resultado != models.EstadoResultado.EJECUTANDO_AI
    ):
        # First terminal result wins. A repeated delivery is acknowledged without
        # duplicating screenshots, traces or case transitions.
        if current_report.get("terminal_delivery_id") == delivery_id:
            return execution
        return execution
    now = utc_now()
    final_status = payload.status
    execution.estado_resultado = final_status
    execution.execution_mode = models.ExecutionMode.IA
    execution.duracion_segundos = max(0, payload.duration_seconds or 0)
    execution.observaciones = payload.observations or payload.error_message or payload.logs
    execution.fecha_ejecucion = now
    ai_report = {**(execution.ai_report or {}), **(payload.ai_report or {})}
    ai_report["report_complete"] = True
    ai_report["report_delivery_status"] = "complete"
    ai_report["completed_via"] = str(ai_report.get("completed_via") or "engine.callback")
    if delivery_id:
        ai_report["terminal_delivery_id"] = delivery_id
        ai_report["terminal_sequence"] = int(metadata.get("terminal_sequence") or 1)
        ai_report["terminal_completed_at"] = metadata.get("terminal_completed_at")
    # Close the durable scheduler slot only after the terminal callback was
    # persisted.  The next FIFO item can then be dispatched safely.
    from ..services.ai_execution_queue import mark_ai_execution_finished
    await mark_ai_execution_finished(db, ejecucion_id, final_status)
    evidence_policy = await config_service.get_evidence_sanitization_policy(db)
    sanitize_output = bool(evidence_policy.get("sanitization_enabled", True))
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
        .limit(25)
    )
    if current_run:
        previous_query = previous_query.filter(models.TestRun.build_id == current_run.build_id)
        if current_run.dataset_id:
            previous_query = previous_query.filter(models.TestRun.dataset_id == current_run.dataset_id)
    previous_rows = (await db.execute(previous_query)).all()
    decision_mode = ai_report.get("decision_mode")
    decision_contract_version = ai_report.get("decision_contract_version")
    previous_rows = [
        row for row in previous_rows
        if isinstance(row[0].ai_report, dict)
        and (row[0].ai_report or {}).get("decision_mode") == decision_mode
        and (row[0].ai_report or {}).get("decision_contract_version") == decision_contract_version
    ][:5]
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
            metrics = item.get("metrics_json") if isinstance(item.get("metrics_json"), dict) else item.get("metrics") if isinstance(item.get("metrics"), dict) else {}
            try:
                universal_agent_version_id = UUID(str(metrics.get("universal_agent_version_id"))) if metrics.get("universal_agent_version_id") else None
            except (TypeError, ValueError):
                universal_agent_version_id = None
            db.add(models.AiExecutionTrace(
                execution_id=execution.id,
                workflow_id=workflow_id,
                workflow_version=item.get("workflow_version"),
                node_id=node_id,
                universal_agent_version_id=universal_agent_version_id,
                workflow_format=str(metrics.get("workflow_format") or "")[:32] or None,
                implementation_key=str(metrics.get("implementation") or "")[:160] or None,
                execution_plan_hash=str(metrics.get("execution_plan_hash") or "")[:64] or None,
                capabilities_json=metrics.get("capabilities") if isinstance(metrics.get("capabilities"), list) else [],
                tools_json=metrics.get("tools") if isinstance(metrics.get("tools"), list) else [],
                model_id=str(metrics.get("model_id") or "")[:160] or None,
                prompt_hash=str(metrics.get("prompt_hash") or "")[:64] or None,
                evidence_refs_json=(item.get("output_json") or item.get("output") or {}).get("decision", {}).get("universal_result", {}).get("evidence_refs", []) if isinstance((item.get("output_json") or item.get("output") or {}), dict) else [],
                status=str(item.get("status") or item.get("level") or "SUCCESS")[:30],
                input_json=sanitize_ai_report_payload(item.get("input_json") if isinstance(item.get("input_json"), dict) else item.get("input") if isinstance(item.get("input"), dict) else {}) if sanitize_output else (item.get("input_json") if isinstance(item.get("input_json"), dict) else item.get("input") if isinstance(item.get("input"), dict) else {}),
                output_json=sanitize_ai_report_payload(item.get("output_json") if isinstance(item.get("output_json"), dict) else item.get("output") if isinstance(item.get("output"), dict) else {}) if sanitize_output else (item.get("output_json") if isinstance(item.get("output_json"), dict) else item.get("output") if isinstance(item.get("output"), dict) else {}),
                metrics_json=sanitize_ai_report_payload(metrics) if sanitize_output else metrics,
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
    execution.ai_report = sanitize_ai_report_payload(ai_report) if sanitize_output else ai_report

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
