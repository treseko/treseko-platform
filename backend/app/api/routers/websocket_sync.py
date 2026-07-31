from .websocket_support import *

def _log_engine_ws_error(exc: Exception) -> None:
    logger.warning("WS Engine error: %s", sanitize_external_error(exc))


@router.websocket("/ws/project-sync/{project_id}")
async def sync_project_events(websocket: WebSocket, project_id: UUID):
    async with AsyncSessionLocal() as session:
        current_user = await _authenticate_websocket_user(websocket, session)
        if not current_user or not current_user.activo:
            await websocket.close(code=1008)
            return
        try:
            await access_control.require_project_access(session, current_user, project_id, "read")
        except HTTPException:
            await websocket.close(code=1008)
            return

    await realtime_event_bus.connect(project_id, websocket)
    await websocket.send_json({
        "event_id": f"connected:{project_id}",
        "event_type": "realtime.connected",
        "project_id": str(project_id),
        "component_id": None,
        "build_id": None,
        "suite_id": None,
        "case_id": None,
        "run_id": None,
        "execution_id": None,
        "bug_id": None,
        "actor_id": None,
        "timestamp": utc_now().isoformat(),
        "payload": {"transport": "websocket"},
    })
    try:
        while True:
            message = await websocket.receive_text()
            if message == "ping":
                await websocket.send_json({
                    "event_id": f"pong:{project_id}:{utc_now().timestamp()}",
                    "event_type": "realtime.pong",
                    "project_id": str(project_id),
                    "payload": {},
                })
    except WebSocketDisconnect:
        await realtime_event_bus.disconnect(project_id, websocket)


@router.websocket("/ws/ai-dry-run/{run_id}")
async def sync_ai_dry_run_client(websocket: WebSocket, run_id: str):
    context = await ai_dry_run_stream.run_context(run_id)
    if not context:
        await websocket.close(code=1008)
        return
    async with AsyncSessionLocal() as session:
        current_user = await _authenticate_websocket_user(websocket, session)
        if not current_user or not current_user.activo:
            await websocket.close(code=1008)
            return
        try:
            await access_control.require_project_access(session, current_user, UUID(context["project_id"]), "read")
        except (HTTPException, ValueError):
            await websocket.close(code=1008)
            return
    replay = await ai_dry_run_stream.connect(run_id, websocket)
    try:
        for event in replay:
            await websocket.send_json(event)
        while True:
            message = await websocket.receive_text()
            if message == "ping":
                await websocket.send_json({"type": "PROGRESS", "message": "conectado"})
    except WebSocketDisconnect:
        await ai_dry_run_stream.disconnect(run_id, websocket)


@router.websocket("/ws/ai-dry-run-engine/{run_id}")
async def sync_ai_dry_run_engine(websocket: WebSocket, run_id: str):
    context = await ai_dry_run_stream.run_context(run_id)
    callback_token = _normalize_ws_token(websocket.query_params.get("callback_token"), max_length=MAX_WS_CALLBACK_TOKEN_LENGTH)
    token_matches = bool(context and callback_token and secrets.compare_digest(callback_token, context["callback_token"]))
    if not token_matches:
        logger.warning(
            "AI dry-run Engine WS rejected run=%s context=%s token_present=%s token_matches=%s",
            run_id,
            bool(context),
            bool(callback_token),
            token_matches,
        )
        await websocket.close(code=1008)
        return
    await websocket.accept()
    set_correlation_id(_websocket_correlation_id(websocket))
    try:
        while True:
            event = await _read_engine_event(websocket)
            if event is None:
                break
            safe_event = _sanitize_ai_dry_run_event(event)
            if safe_event:
                await ai_dry_run_stream.publish(run_id, safe_event)
    except WebSocketDisconnect:
        return

@router.websocket("/ws/client-sync/{ejecucion_id}")
async def sync_frontend_client(websocket: WebSocket, ejecucion_id: UUID):
    async with AsyncSessionLocal() as session:
        current_user = await _authenticate_websocket_user(websocket, session)
        context = await _get_execution_context(session, ejecucion_id)
        if not current_user or not current_user.activo or not context or not _can_view_execution_stream(current_user):
            await websocket.close(code=1008)
            return
        try:
            await access_control.require_project_access(session, current_user, context.proyecto_id, "read")
        except HTTPException:
            await websocket.close(code=1008)
            return

    await manager.connect(websocket, str(ejecucion_id))
    try:
        while True:
            await websocket.receive_text() # Mantener viva
    except WebSocketDisconnect:
        manager.disconnect(websocket, str(ejecucion_id))

@router.websocket("/ws/engine-sync/{ejecucion_id}")
async def sync_ai_engine(websocket: WebSocket, ejecucion_id: UUID):
    if websocket.query_params.get("token"):
        await websocket.close(code=1008)
        return
    async with AsyncSessionLocal() as session:
        context = await _get_execution_context(session, ejecucion_id)
        if not context:
            await websocket.close(code=1008)
            return

        authorized = False
        if _get_engine_ws_payload(websocket, ejecucion_id) or _has_valid_shared_engine_token(websocket):
            authorized = True
        else:
            authorized = False

        if not authorized:
            await websocket.close(code=1008)
            return

    await websocket.accept()
    ws_correlation_id = _websocket_correlation_id(websocket)
    set_correlation_id(ws_correlation_id)
    logger.info("WS Engine connected for execution %s correlation_id=%s", ejecucion_id, ws_correlation_id)
    try:
        while True:
            event = await _read_engine_event(websocket)
            if event is None:
                break
            if not event:
                continue

            if event["type"] == "STREAM_DOM_LOG":
                sanitized_event = _sanitize_engine_broadcast_event(event)
                if sanitized_event:
                    await manager.broadcast(sanitized_event, str(ejecucion_id))

            elif event["type"] == "STEP_RESULT":
                try:
                    snapshot_id = UUID(str(event.get("snapshot_id") or ""))
                except (TypeError, ValueError):
                    await _send_engine_error(websocket, "Snapshot invalido.")
                    continue
                raw_status = event.get("status")
                try:
                    estado = models.EstadoResultado(raw_status)
                except (TypeError, ValueError):
                    await _send_engine_error(websocket, "Estado de paso invalido.")
                    continue

                image_base64 = event.get("screenshot")
                if image_base64 is not None and (
                    not isinstance(image_base64, str)
                    or len(image_base64) > schemas.MAX_AI_SCREENSHOT_BASE64_LENGTH
                ):
                    await _send_engine_error(websocket, "Captura de evidencia invalida o demasiado grande.")
                    continue

                async with AsyncSessionLocal() as session:
                    context = await _get_snapshot_execution_context(session, snapshot_id)
                    if not context or context.ejecucion_caso_id != ejecucion_id:
                        await _send_engine_error(websocket, "Snapshot no pertenece a la ejecucion autorizada.")
                        continue

                    evidencia_url = utils.save_evidence_image(snapshot_id, image_base64) if image_base64 else None
                    await crud.update_snapshot_status(
                        db=session,
                        snapshot_id=snapshot_id,
                        estado=estado,
                        comentarios="Actualizado vía WebSocket",
                        evidencia_url=evidencia_url
                    )
                    error_log = _bounded_optional_text(event.get("error_log"), max_length=schemas.MAX_AI_ERROR_LENGTH)
                    if error_log:
                        result = await session.execute(select(models.SnapshotPaso).filter(models.SnapshotPaso.id == snapshot_id))
                        db_snap = result.scalar_one_or_none()
                        if db_snap:
                            db_snap.error_log = error_log
                            await session.commit()
                    await realtime_event_bus.publish(
                        context.proyecto_id,
                        "execution.snapshot.updated",
                        component_id=context.componente_id,
                        build_id=context.build_id,
                        case_id=context.caso_id,
                        run_id=context.test_run_id,
                        execution_id=context.ejecucion_caso_id,
                        payload={
                            "snapshot": {
                                "id": str(snapshot_id),
                                "estado": event.get("status"),
                            },
                            "source": "ai.engine.websocket",
                        },
                    )
                sanitized_event = _sanitize_engine_broadcast_event(event)
                if sanitized_event:
                    await manager.broadcast(sanitized_event, str(ejecucion_id))
                logger.info("WS Engine saved snapshot %s", snapshot_id)
            elif event["type"] == "EXECUTION_FINISHED":
                raw_status = event.get("status")
                try:
                    estado = models.EstadoResultado(raw_status)
                except (TypeError, ValueError):
                    await _send_engine_error(websocket, "Estado final invalido.")
                    continue

                try:
                    duration_seconds = max(0, min(604800, int(event.get("duration_seconds") or 0)))
                except (TypeError, ValueError):
                    duration_seconds = 0

                observations = _bounded_optional_text(
                    event.get("observations") or event.get("message") or event.get("error_message"),
                    max_length=8_000,
                )
                error_message = _bounded_optional_text(event.get("error_message"), max_length=schemas.MAX_AI_ERROR_LENGTH)
                summary = event.get("ai_report_summary")
                if not isinstance(summary, dict):
                    summary = {}

                async with AsyncSessionLocal() as session:
                    context = await _get_execution_context(session, ejecucion_id)
                    result = await session.execute(
                        select(models.EjecucionCaso).filter(models.EjecucionCaso.id == ejecucion_id)
                    )
                    execution = result.scalar_one_or_none()
                    if not context or not execution:
                        await _send_engine_error(websocket, "Ejecucion no encontrada.")
                        continue

                    report_pending = event.get("report_pending") is True
                    if execution.estado_resultado == models.EstadoResultado.EJECUTANDO_AI and report_pending:
                        current_report = execution.ai_report if isinstance(execution.ai_report, dict) else {}
                        execution.ai_report = {
                            **current_report,
                            "report_delivery_status": "pending",
                            "engine_status": estado.value,
                            "duration_seconds": duration_seconds,
                        }
                        await session.commit()
                    elif execution.estado_resultado == models.EstadoResultado.EJECUTANDO_AI:
                        now = utc_now()
                        execution.estado_resultado = estado
                        execution.execution_mode = models.ExecutionMode.IA
                        execution.duracion_segundos = duration_seconds
                        execution.observaciones = observations or error_message or execution.observaciones
                        execution.fecha_ejecucion = now
                        current_report = execution.ai_report if isinstance(execution.ai_report, dict) else {}
                        fallback_report = {
                            **current_report,
                            "status": estado.value,
                            "summary": observations,
                            "duration_seconds": duration_seconds,
                            "consensus": summary.get("consensus") or estado.value,
                            "confidence": summary.get("confidence"),
                            "failure_category": summary.get("failure_category"),
                            "human_review_required": bool(
                                summary.get("human_review_required", estado != models.EstadoResultado.PASO)
                            ),
                            "completed_via": "engine.websocket.finish",
                        }
                        if error_message:
                            fallback_report["error_message"] = error_message
                        execution.ai_report = fallback_report
                        try:
                            execution.ai_confidence = (
                                int(round(float(fallback_report["confidence"])))
                                if fallback_report.get("confidence") is not None
                                else None
                            )
                        except (TypeError, ValueError):
                            execution.ai_confidence = None
                        execution.ai_consensus = str(fallback_report.get("consensus") or estado.value)[:30]
                        failure_category = fallback_report.get("failure_category")
                        execution.ai_failure_category = str(failure_category)[:80] if failure_category else None
                        execution.ai_human_review_required = bool(
                            fallback_report.get("human_review_required", estado != models.EstadoResultado.PASO)
                        )
                        execution.ai_review_status = (
                            models.AiReviewStatus.REQUIERE_REVISION
                            if execution.ai_human_review_required
                            else models.AiReviewStatus.NO_REQUIERE_REVISION
                        )

                        pending_result = await session.execute(
                            select(models.EjecucionCaso.id)
                            .filter(
                                models.EjecucionCaso.test_run_id == execution.test_run_id,
                                models.EjecucionCaso.id != execution.id,
                                models.EjecucionCaso.estado_resultado.in_([
                                    models.EstadoResultado.SIN_CORRER,
                                    models.EstadoResultado.EJECUTANDO_AI,
                                ]),
                            )
                            .limit(1)
                        )
                        if pending_result.scalar_one_or_none() is None:
                            run_result = await session.execute(
                                select(models.TestRun).filter(models.TestRun.id == execution.test_run_id)
                            )
                            run = run_result.scalar_one_or_none()
                            if run:
                                run.estado_run = models.EstadoRun.CERRADO
                                run.fecha_cierre = now
                        await session.commit()

                    await realtime_event_bus.publish(
                        context.proyecto_id,
                        "execution.ai.report_pending" if report_pending else "execution.ai.finished",
                        component_id=context.componente_id,
                        build_id=context.build_id,
                        case_id=context.caso_id,
                        run_id=context.test_run_id,
                        execution_id=ejecucion_id,
                        payload={
                            "status": estado.value,
                            "duration_seconds": duration_seconds,
                            "source": "ai.engine.websocket",
                            "report_pending": report_pending,
                        },
                    )

                sanitized_event = _sanitize_engine_broadcast_event(event)
                if sanitized_event:
                    await manager.broadcast(sanitized_event, str(ejecucion_id))
                logger.info("WS Engine finished execution %s with %s", ejecucion_id, estado.value)
            else:
                sanitized_event = _sanitize_engine_broadcast_event(event)
                if sanitized_event:
                    await manager.broadcast(sanitized_event, str(ejecucion_id))
                else:
                    await _send_engine_error(websocket, "Tipo de evento WebSocket no permitido.")

    except WebSocketDisconnect:
        logger.info("WS Engine disconnected for execution %s", ejecucion_id)
    except Exception as e:
        _log_engine_ws_error(e)
