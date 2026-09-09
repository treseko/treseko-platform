import logging
from .repository_context import *
from .core_settings_ai_workflow_helpers import get_configured_ai_provider_api_key
from .ai_provider_profiles import provider_payload_for_definition
from .chatbot_execution import build_chatbot_context, resolve_chatbot_workflow, validate_chatbot_execution_config
from .ai_workflow_serialization import runtime_agent_workflow
from .. import auth
from ..services.edition.entitlement_service import ensure_feature_enabled
from ..services.edition.usage_limits import enforce_weekly_ai_execution_limit, enforce_weekly_automated_execution_limit
from ..services.error_sanitizer import sanitize_external_error
from ..services.api_dynamic_variables import DynamicVariableContext, derive_case_dynamic_seed, safe_dynamic_values
from ..services.ai_report_sanitizer import sanitize_ai_report_payload
from ..services.api_evidence_policy import evidence_policy_marker, public_test_data_evidence_enabled
from ..services.api_test_runner import ApiTestRunnerError
from ..services.chatbot_http import resolve_chatbot_endpoint, validate_chatbot_destination
from ..services.ai_execution_lifecycle import terminal_report_metadata
from ..services.notifications import event_service as notification_event_service
logger = logging.getLogger(__name__)
def _safe_ai_error_detail(value: object) -> str: return sanitize_external_error(value)
async def _emit_chatbot_blocked(db, execution, case, run, error_code: str): await notification_event_service.emit_event(db=db, event_type="chatbot.evaluation.failed", actor_user_id=execution.ejecutado_por, proyecto_id=run.proyecto_id, entity_type="execution", entity_id=execution.id, severity="warning", payload={"execution": {"id": str(execution.id), "estado": "BLOQUEADO", "error_code": error_code}, "caso": {"id": str(case.id), "codigo": case.codigo, "formato_prueba": "CONVERSACIONAL"}}, dedupe_key=f"chatbot.evaluation.failed:{execution.id}:{error_code}")
def _engine_error_metadata(response: httpx.Response, fallback_correlation_id: str) -> tuple[str, str]:
    try:
        payload = response.json()
    except (ValueError, TypeError):
        payload = {}
    error = payload.get("error") if isinstance(payload, dict) else {}
    error = error if isinstance(error, dict) else {}
    code = str(error.get("error_code") or "").strip().upper()
    correlation = str(error.get("correlation_id") or response.headers.get("x-correlation-id") or fallback_correlation_id).strip()
    return code, correlation[:100] or fallback_correlation_id
def _engine_error_code(response: httpx.Response, fallback_correlation_id: str) -> tuple[str, str]:
    code, correlation = _engine_error_metadata(response, fallback_correlation_id)
    if code.startswith("AI_PROVIDER_"):
        return code, correlation
    return {
        "UNAUTHORIZED": "AI_ENGINE_UNAUTHORIZED",
        "FORBIDDEN": "AI_ENGINE_FORBIDDEN",
        "REQUEST_TIMEOUT": "AI_ENGINE_TIMEOUT",
        "UPSTREAM_TIMEOUT": "AI_ENGINE_TIMEOUT",
        "RATE_LIMITED": "AI_ENGINE_RATE_LIMITED",
    }.get(code, {
        401: "AI_ENGINE_UNAUTHORIZED",
        403: "AI_ENGINE_FORBIDDEN",
        408: "AI_ENGINE_TIMEOUT",
        429: "AI_ENGINE_RATE_LIMITED",
        504: "AI_ENGINE_TIMEOUT",
    }.get(response.status_code, "AI_ENGINE_UNAVAILABLE")), correlation
async def recover_stale_ai_executions(
    db: AsyncSession,
    *,
    timeout_seconds: int | None = None,
    commit: bool = True,
) -> int:
    config = await get_ai_engine_config(db)
    limit = max(60, int(timeout_seconds or config.get("timeout_seconds") or 900))
    cutoff = utc_now() - timedelta(seconds=limit)
    result = await db.execute(
        select(models.EjecucionCaso).filter(
            models.EjecucionCaso.estado_resultado == models.EstadoResultado.EJECUTANDO_AI,
            models.EjecucionCaso.fecha_ejecucion < cutoff,
        ).with_for_update(skip_locked=True)
    )
    recovered = 0
    for execution in result.scalars().all():
        report = dict(execution.ai_report or {})
        if report.get("report_complete") is True:
            continue
        execution.estado_resultado = models.EstadoResultado.FALLO
        execution.execution_mode = (
            models.ExecutionMode.AUTOMATIZADA
            if str(report.get("execution_mode") or report.get("chatbot_execution_mode") or "").upper() == models.ExecutionMode.AUTOMATIZADA.value
            else models.ExecutionMode.IA
        )
        execution.ai_human_review_required = True
        execution.ai_review_status = models.AiReviewStatus.REQUIERE_REVISION
        execution.ai_failure_category = "timeout"
        execution.observaciones = (
            f"TIMEOUT DE EJECUCION RECUPERADO: la ejecucion supero {limit} segundos "
            "sin callback terminal; fue cerrada para evitar un estado IA huerfano."
        )
        execution.ai_report = {
            **report,
            "error_code": "AI_TIMEOUT",
            "failure_category": "timeout",
            "human_review_required": True,
            "stale_execution_recovered": True,
            "stale_execution_timeout_seconds": limit,
            "report_complete": True,
            "report_delivery_status": "complete",
            "completed_via": "backend.stale_recovery",
            **terminal_report_metadata(
                delivery_id=f"ai-recovery:{execution.id}",
                completed_via="backend.stale_recovery",
                human_review_required=True,
            ),
        }
        jobs = (await db.execute(
            select(models.AutomationJob).where(
                models.AutomationJob.ejecucion_id == execution.id,
                models.AutomationJob.job_type == "AI_EXECUTION",
                models.AutomationJob.estado.in_((models.AutomationJobStatus.CLAIMED, models.AutomationJobStatus.RUNNING)),
            ).with_for_update()
        )).scalars().all()
        for job in jobs:
            job.estado = models.AutomationJobStatus.TIMEOUT
            job.fecha_fin = utc_now()
            job.error_message = "Ejecución IA cerrada por recuperación de timeout."
        recovered += 1
    if recovered:
        if commit:
            await db.commit()
        logger.warning("Recovered %s stale AI execution(s) older than %ss", recovered, limit)
    return recovered
def _backend_callback_base_url() -> str:
    configured = os.getenv("AI_ENGINE_CALLBACK_BASE_URL") or os.getenv("BACKEND_PUBLIC_URL")
    if configured:
        return configured.rstrip("/")
    return "http://backend:8000"
async def _require_ai_execution_entitlement(db: AsyncSession, execution: models.EjecucionCaso, requested_mode: models.ExecutionMode = models.ExecutionMode.IA):
    result = await db.execute(
        select(models.TestRun, models.Proyecto)
        .join(models.Proyecto, models.Proyecto.id == models.TestRun.proyecto_id)
        .filter(models.TestRun.id == execution.test_run_id)
    )
    row = result.first()
    if not row:
        raise ValueError("Run o proyecto no encontrado para aplicar cuota IA")
    run, project = row
    if requested_mode == models.ExecutionMode.IA:
        await ensure_feature_enabled(db, "ai.basic_execution")
        if execution.execution_mode != models.ExecutionMode.IA:
            await enforce_weekly_ai_execution_limit(db, solution_id=project.organizacion_id)
    elif execution.execution_mode != models.ExecutionMode.AUTOMATIZADA:
        await enforce_weekly_automated_execution_limit(db, solution_id=project.organizacion_id)
    return run, project
async def trigger_ai_execution(ejecucion_id: UUID, db: AsyncSession, requested_mode: models.ExecutionMode = models.ExecutionMode.IA):
    result = await db.execute(
        select(models.EjecucionCaso, models.CasoPrueba)
        .join(models.CasoPrueba, models.CasoPrueba.id == models.EjecucionCaso.caso_id)
        .filter(models.EjecucionCaso.id == ejecucion_id)
    )
    row = result.first()
    if not row:
        return
    ejec, case = row
    run, _project = await _require_ai_execution_entitlement(db, ejec, requested_mode)
    config = await get_ai_engine_config(db)
    is_chatbot = case.formato_prueba == models.FormatoPrueba.CONVERSACIONAL
    execution_mode = requested_mode
    snapshots = await get_snapshots_ejecucion(db, ejecucion_id, sanitize_output=False)
    dataset_resuelto = []
    variables_resueltas = {}
    resolved_dataset = None
    if run:
        dataset_resuelto = (run.datasets_resueltos or {}).get(str(ejec.caso_id), [])
        variables_resueltas = run.variables_resueltas or {}
        resolved_dataset = await resolve_case_dataset(db, case.id, run.build_id, run.entorno_id, run.dataset_id)
        if resolved_dataset:
            dataset_resuelto = resolved_dataset["dataset_resuelto"]
            variables_resueltas = resolved_dataset["variables_resueltas"]
    base_url = get_ai_base_url_from_context(variables_resueltas, snapshots) or ""
    environment_chatbot_config = (resolved_dataset or {}).get("configuracion_chatbot_ambiente") or {}
    environment = await db.get(models.Entorno, run.entorno_id) if is_chatbot and run and run.entorno_id else None
    dynamic_context = None
    if is_chatbot:
        dynamic_context = DynamicVariableContext(
            getattr(ejec, "dynamic_seed", None)
            or derive_case_dynamic_seed(getattr(run, "dynamic_seed", None), str(case.id))
        )
        if isinstance(getattr(ejec, "dynamic_variables", None), dict):
            dynamic_context.values.update(
                item for item in ejec.dynamic_variables.items() if item[1] != "[REDACTED]"
            )
        ejec.dynamic_seed = dynamic_context.seed
    chatbot_context = build_chatbot_context(
        case, run, variables_resueltas, dataset_resuelto, base_url, environment_chatbot_config,
        dynamic_variables=dynamic_context,
    ) if is_chatbot else None
    if dynamic_context is not None:
        ejec.dynamic_variables = safe_dynamic_values(dynamic_context)
    if chatbot_context:
        chatbot_context["execution_mode"] = execution_mode.value
        chatbot_context["conversation_strategy"] = "profile_goal" if execution_mode == models.ExecutionMode.IA else "fixed"
    public_chatbot_evidence = public_test_data_evidence_enabled(
        environment=environment,
        case=case,
        execution=ejec,
        config=chatbot_context.get("config") if chatbot_context else None,
    ) if is_chatbot else False
    if is_chatbot:
        ejec.evidence_policy = evidence_policy_marker(public_chatbot_evidence)["evidence_policy"]
    chatbot_config_errors = validate_chatbot_execution_config(case, environment_config=environment_chatbot_config, variables=variables_resueltas) if is_chatbot else []
    if is_chatbot and chatbot_config_errors:
        ejec.estado_resultado = models.EstadoResultado.BLOQUEADO
        ejec.execution_mode = execution_mode
        ejec.ai_human_review_required = False
        ejec.observaciones = "No se puede ejecutar el caso Chatbot: " + " ".join(chatbot_config_errors)
        ejec.ai_report = {**(ejec.ai_report or {}), "chatbot": True, "error_code": "CHATBOT_CONFIGURATION_REQUIRED", "configuration_errors": chatbot_config_errors, "human_review_required": False}
        await db.commit()
        await _emit_chatbot_blocked(db, ejec, case, run, "CHATBOT_CONFIGURATION_REQUIRED")
        return
    if is_chatbot and chatbot_context:
        try:
            resolved_chatbot_endpoint = resolve_chatbot_endpoint(
                chatbot_context.get("config") or {},
                variables_resueltas,
                base_url,
                dynamic_variables=dynamic_context,
            )
            validate_chatbot_destination(
                resolved_chatbot_endpoint,
                environment,
                chatbot_context.get("config") or {},
            )
        except ApiTestRunnerError as error:
            ejec.estado_resultado = models.EstadoResultado.BLOQUEADO
            ejec.execution_mode = execution_mode
            ejec.ai_human_review_required = False
            ejec.observaciones = "No se puede ejecutar el caso Chatbot: destino no permitido o no resoluble."
            ejec.ai_report = {
                **(ejec.ai_report or {}),
                "chatbot": True,
                "error_code": "CHATBOT_DESTINATION_NOT_ALLOWED",
                "configuration_errors": [sanitize_external_error(error)],
                "human_review_required": False,
            }
            await db.commit()
            await _emit_chatbot_blocked(db, ejec, case, run, "CHATBOT_DESTINATION_NOT_ALLOWED")
            return
    workflow_definition = await get_active_ai_workflow_definition(db, "chatbot_evaluation" if is_chatbot else "test_execution")
    if is_chatbot:
        try:
            workflow_definition = await resolve_chatbot_workflow(db, case, workflow_definition)
        except (TypeError, ValueError) as error:
            ejec.estado_resultado = models.EstadoResultado.BLOQUEADO
            ejec.execution_mode = execution_mode
            ejec.ai_human_review_required = False
            ejec.observaciones = str(error)
            ejec.ai_report = {**(ejec.ai_report or {}), "chatbot": True, "error_code": "CHATBOT_WORKFLOW_OVERRIDE_INVALID", "human_review_required": False}
            await db.commit()
            await _emit_chatbot_blocked(db, ejec, case, run, "CHATBOT_WORKFLOW_OVERRIDE_INVALID")
            return
    provider_payload = await provider_payload_for_definition(db, workflow_definition, config)
    engine_url = ENGINE_URL.rstrip("/")
    callback_url = f"{_backend_callback_base_url()}/ai-engine/executions/{ejecucion_id}/result"
    health = await check_ai_engine_health(db, provider_payload)
    if health.get("status") != "ok":
        error_detail = _safe_ai_error_detail(health.get('detail', 'Motor IA no responde'))
        ejec.estado_resultado = models.EstadoResultado.BLOQUEADO
        ejec.execution_mode = execution_mode
        ejec.observaciones = (
            f"NO SE PUEDE EJECUTAR: El Motor IA no esta disponible. "
            f"Verifica que el servicio interno del Motor IA este corriendo. "
            f"Detalle del error: {error_detail}"
        )
        await db.commit()
        await _emit_ai_engine_unavailable_event(db, ejec, case, str(error_detail))
        logger.warning("AI execution %s blocked: engine unavailable: %s", ejecucion_id, error_detail)
        raise ConnectionError(f"Motor IA no disponible: {error_detail}")
    # Freeze the execution definition and mark the real start in one
    # transaction. The queue only claims a slot before reaching this point;
    # a restart cannot leave an active execution without its snapshot.
    started_at = utc_now()
    ejec.estado_resultado = models.EstadoResultado.EJECUTANDO_AI
    ejec.execution_mode = execution_mode
    ejec.fecha_ejecucion = started_at
    ejec.ai_review_status = models.AiReviewStatus.NO_REQUIERE_REVISION
    chatbot_context_for_storage = (
        chatbot_context
        if public_chatbot_evidence or not chatbot_context
        else sanitize_ai_report_payload(chatbot_context)
    )
    if chatbot_context_for_storage:
        ejec.chatbot_config_snapshot = chatbot_context_for_storage
    frozen_workflow = workflow_definition or {}
    frozen_workflow_meta = frozen_workflow.get("workflow") if isinstance(frozen_workflow, dict) else {}
    if isinstance(frozen_workflow_meta, dict):
        ejec.ai_report = {
            **(ejec.ai_report or {}),
            "chatbot_execution_mode": execution_mode.value if is_chatbot else None,
            "workflow_id": frozen_workflow_meta.get("id"),
            "workflow_version": frozen_workflow_meta.get("version"),
            "workflow_format": frozen_workflow_meta.get("workflow_format") or "legacy_v1",
            "workflow_snapshot": frozen_workflow,
            "workflow_nodes": frozen_workflow.get("nodes", []) if isinstance(frozen_workflow, dict) else [],
            "workflow_edges": frozen_workflow.get("edges", []) if isinstance(frozen_workflow, dict) else [],
            **({"chatbot_config_snapshot": chatbot_context_for_storage} if chatbot_context_for_storage else {}),
        }
    await db.commit()
    if is_chatbot: await notification_event_service.emit_event(db=db, event_type="chatbot.evaluation.started", actor_user_id=ejec.ejecutado_por, proyecto_id=run.proyecto_id, entity_type="execution", entity_id=ejec.id, payload={"execution": {"id": str(ejec.id), "estado": ejec.estado_resultado.value, "started_at": started_at.isoformat()}, "caso": {"id": str(case.id), "codigo": case.codigo, "formato_prueba": "CONVERSACIONAL"}, "workflow": {"version": (workflow_definition or {}).get("workflow", {}).get("version") if isinstance(workflow_definition, dict) else None}}, dedupe_key=f"chatbot.evaluation.started:{ejec.id}")
    step_map = {
        str(number): snapshot_id
        for snapshot in snapshots
        for number, snapshot_id in [(_snapshot_step_number(snapshot), _snapshot_id(snapshot))]
        if number and snapshot_id
    }
    steps = []
    for snapshot in snapshots:
        number = _snapshot_step_number(snapshot)
        if not number:
            continue
        steps.append({
            "number": number,
            "action": _snapshot_value(snapshot, "accion_congelada"),
            "data": _snapshot_step_data(snapshot),
            "expected": _snapshot_value(snapshot, "resultado_esperado_congelado"),
        })
    guidance = "\n".join(
        [
            f"{step['number']}. Accion: {step['action']}. Datos: {step.get('data') or '-'}. Esperado: {step.get('expected') or '-'}"
            for step in steps
        ]
    )
    model_capabilities = config.get("model_capabilities") or {}
    active_model_capabilities = (
        model_capabilities.get(config.get("model"), model_capabilities)
        if isinstance(model_capabilities, dict)
        else {}
    )
    correlation_id = current_correlation_id(str(ejecucion_id))
    payload = {
        "correlation_id": correlation_id,
        "execution_id": str(ejecucion_id),
        "case_id": str(case.id),
        "case_code": case.codigo,
        "case_title": case.titulo,
        "task": f"Ejecutar caso manual {case.codigo}: {case.titulo}\nPrecondiciones: {case.precondiciones or '-'}\nPasos:\n{guidance}\nPostcondiciones: {case.postcondiciones or '-'}",
        "url": base_url,
        "base_url": base_url,
        "testId": str(ejecucion_id),
        "suite": run.nombre if run else "ai-run",
        "expected": case.descripcion or case.postcondiciones or None,
        "guidance": guidance,
        "steps": steps,
        "step_map": step_map,
        "environment": run.entorno if run else None,
        "dataset": dataset_resuelto,
        "variables": variables_resueltas,
        "dynamic_seed": dynamic_context.seed if dynamic_context is not None else None,
        "dynamic_variables": safe_dynamic_values(dynamic_context) if dynamic_context is not None else {},
        "callback_url": callback_url,
        # A configured internal token is stable across worker processes.  Use
        # it for both terminal callbacks and the progress WebSocket; a JWT
        # generated by another local process can be signed with a different
        # development secret after a backend reload.
        "callback_token": (shared_callback_token := (os.getenv("AI_ENGINE_CALLBACK_TOKEN") or "").strip()) or auth.create_access_token(
            data={"sub": "ai-engine", "scope": "ai-engine-callback", "execution_id": str(ejecucion_id)},
            expires_delta=timedelta(hours=6),
            token_type="engine_callback",
        ),
        "engine_ws_token": None if shared_callback_token else auth.create_access_token(
            data={"sub": "ai-engine", "scope": "ai-engine-ws", "execution_id": str(ejecucion_id)},
            expires_delta=timedelta(hours=6),
            token_type="engine_ws",
        ),
        "maxSteps": len(steps) or int(config.get("max_steps") or 10),
        "timeout_seconds": int(config.get("timeout_seconds") or 900),
        "headless": bool(config.get("headless")),
        "viewport_width": int(config.get("viewport_width") or 1920),
        "viewport_height": int(config.get("viewport_height") or 1080),
        "agent_workflow": runtime_agent_workflow(config, workflow_definition),
        "workflow_definition": frozen_workflow,
        "workflow_purpose": "chatbot_evaluation" if is_chatbot else "test_execution",
        "execution_mode": execution_mode.value,
        "chatbot_execution_strategy": chatbot_context.get("conversation_strategy") if chatbot_context else None,
        **({"chatbot": chatbot_context} if chatbot_context else {}),
        "max_parallel_ai_runs": int(config.get("max_parallel_ai_runs") or 1),
        **provider_payload,
        # Vision is opt-in per model. Unknown models must not receive screenshots.
        "vision_enabled": bool(active_model_capabilities.get("vision")) if isinstance(active_model_capabilities, dict) else False,
        "temperature": config.get("temperature"),
        "token_cost_prompt_per_1k": config.get("token_cost_prompt_per_1k"),
        "token_cost_completion_per_1k": config.get("token_cost_completion_per_1k"),
        "token_cost_per_1k": config.get("token_cost_per_1k"),
        "ai_execution_driver": config.get("ai_execution_driver", "treseko_engine"),
        "opencode_url": os.getenv("OPENCODE_URL", "http://127.0.0.1:4096"),
        "opencode_username": os.getenv("OPENCODE_USERNAME", "treseko"),
        "opencode_model": config.get("opencode_model"),
        "opencode_agent": config.get("opencode_agent"),
        "opencode_timeout_seconds": config.get("opencode_timeout_seconds", 30),
    }
    write_trace("backend", "ai_request", {
        "request_id": str(ejecucion_id),
        "method": "POST",
        "url": f"{engine_url}/run-task",
        "execution_id": str(ejecucion_id),
        "case_code": case.codigo,
        "body": payload,
    })
    timeout_seconds = int(config.get("timeout_seconds") or 900)
    async def ai_execution_timeout_watcher(ejec_id: UUID, timeout_seg: int):
        """Watcher que detecta si el engine recibio la tarea pero no respondio a tiempo.
        Esto es diferente a un timeout de conexion: aqui el engine SI esta corriendo
        pero la prueba tardo mas de lo esperado."""
        await asyncio.sleep(timeout_seg)
        async with AsyncSessionLocal() as timeout_db:
            result_t = await timeout_db.execute(
                select(models.EjecucionCaso).filter(models.EjecucionCaso.id == ejec_id)
            )
            ejec_t = result_t.scalar_one_or_none()
            if ejec_t and ejec_t.estado_resultado == models.EstadoResultado.EJECUTANDO_AI:
                # Serialize timeout against the callback and make timeout a
                # terminal, report-complete result. A late callback is then
                # acknowledged without changing the verdict.
                await timeout_db.refresh(ejec_t, with_for_update=True)
            if ejec_t and ejec_t.estado_resultado == models.EstadoResultado.EJECUTANDO_AI:
                ejec_t.estado_resultado = models.EstadoResultado.FALLO
                ejec_t.execution_mode = execution_mode
                ejec_t.ai_human_review_required = True
                ejec_t.ai_review_status = models.AiReviewStatus.REQUIERE_REVISION
                ejec_t.observaciones = (
                    f"TIMEOUT DE EJECUCION: El Motor IA recibio la tarea pero no completo "
                    f"la ejecucion en {timeout_seg} segundos. "
                    f"Posibles causas: la pagina tardo demasiado en cargar, la IA se quedo "
                    f"en un bucle, o el LLM no respondio. "
                    f"Revisa los logs del engine para mas detalle."
                )
                ejec_t.ai_report = {
                    **(ejec_t.ai_report or {}),
                    "error_code": "AI_TIMEOUT",
                    "human_review_required": True,
                    "failure_category": "timeout",
                    "report_complete": True,
                    "report_delivery_status": "complete",
                    "completed_via": "backend.timeout_watcher",
                    **terminal_report_metadata(
                        delivery_id=f"ai-timeout:{ejec_id}",
                        completed_via="backend.timeout_watcher",
                        human_review_required=True,
                    ),
                }
                timeout_job = (await timeout_db.execute(
                    select(models.AutomationJob).where(
                        models.AutomationJob.ejecucion_id == ejec_id,
                        models.AutomationJob.job_type == "AI_EXECUTION",
                        models.AutomationJob.estado.in_((models.AutomationJobStatus.CLAIMED, models.AutomationJobStatus.RUNNING)),
                    ).with_for_update()
                )).scalars().all()
                for job in timeout_job:
                    job.estado = models.AutomationJobStatus.TIMEOUT
                    job.fecha_fin = utc_now()
                    job.error_message = "Ejecución IA cerrada por timeout."
                await timeout_db.commit()
                logger.warning("AI execution %s failed by execution timeout (%ss)", ejec_id, timeout_seg)
    asyncio.create_task(ai_execution_timeout_watcher(ejecucion_id, timeout_seconds))
    max_retries = 3
    retry_delay = 5  # segundos
    for attempt in range(max_retries):
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
                resp = await client.post(f"{engine_url}/run-task", json=payload, headers=engine_internal_headers(correlation_id))
                if resp.status_code == 200:
                    logger.info("AI execution %s sent to engine (attempt %s/%s)", ejecucion_id, attempt + 1, max_retries)
                    return
                else:
                    if attempt < max_retries - 1:
                        logger.warning(
                            "AI engine rejected request with HTTP %s (attempt %s/%s), retrying in %ss",
                            resp.status_code,
                            attempt + 1,
                            max_retries,
                            retry_delay,
                        )
                        await asyncio.sleep(retry_delay)
                    else:
                        ejec.estado_resultado = models.EstadoResultado.BLOQUEADO
                        ejec.execution_mode = execution_mode
                        ejec.ai_human_review_required = True
                        ejec.ai_review_status = models.AiReviewStatus.REQUIERE_REVISION
                        ejec.observaciones = (
                            f"ERROR DE MOTOR IA: El engine rechazo la tarea tras {max_retries} intentos "
                            f"(HTTP {resp.status_code}). "
                            f"El engine esta corriendo pero no acepta la tarea. "
                            f"Revisa la configuracion del engine."
                        )
                        engine_error_code, engine_correlation_id = _engine_error_code(resp, correlation_id)
                        ejec.ai_report = {
                            **(ejec.ai_report or {}),
                            "error_code": engine_error_code,
                            "human_review_required": True,
                            "failure_category": "model_unavailable",
                            "correlation_id": engine_correlation_id,
                        }
                        await db.commit()
                        await _emit_ai_engine_unavailable_event(db, ejec, case, f"Engine rechazo HTTP {resp.status_code}")
        except (httpx.ConnectTimeout, httpx.ReadTimeout, httpx.WriteTimeout, httpx.PoolTimeout) as e:
            sanitized_error = _safe_ai_error_detail(e)
            if attempt < max_retries - 1:
                logger.warning(
                    "AI engine timeout (attempt %s/%s), retrying in %ss",
                    attempt + 1,
                    max_retries,
                    retry_delay,
                )
                await asyncio.sleep(retry_delay)
            else:
                ejec.estado_resultado = models.EstadoResultado.BLOQUEADO
                ejec.execution_mode = execution_mode
                ejec.ai_human_review_required = True
                ejec.ai_review_status = models.AiReviewStatus.REQUIERE_REVISION
                ejec.observaciones = (
                    f"NO SE PUEDE EJECUTAR - TIMEOUT DEL MOTOR IA: no respondió "
                    f"tras {max_retries} intentos. Error: {sanitized_error}"
                )
                ejec.ai_report = {
                    **(ejec.ai_report or {}),
                    "error_code": "AI_ENGINE_TIMEOUT",
                    "human_review_required": True,
                    "failure_category": "timeout",
                    "correlation_id": correlation_id,
                }
                await db.commit()
                await _emit_ai_engine_unavailable_event(db, ejec, case, sanitized_error)
                raise ConnectionError(f"Timeout con Motor IA: {sanitized_error}")
        except httpx.ConnectError as e:
            # TIMEOUT DE CONEXION: No se pudo conectar al engine
            sanitized_error = _safe_ai_error_detail(e)
            if attempt < max_retries - 1:
                logger.warning(
                    "AI engine connection error (attempt %s/%s): %s, retrying in %ss",
                    attempt + 1,
                    max_retries,
                    sanitized_error,
                    retry_delay,
                )
                await asyncio.sleep(retry_delay)
            else:
                ejec.estado_resultado = models.EstadoResultado.BLOQUEADO
                ejec.execution_mode = execution_mode
                ejec.ai_human_review_required = True
                ejec.ai_review_status = models.AiReviewStatus.REQUIERE_REVISION
                ejec.observaciones = (
                    f"NO SE PUEDE EJECUTAR - ERROR DE CONEXION: No se pudo conectar al Motor IA "
                    f"tras {max_retries} intentos. "
                    f"El engine no esta corriendo o no es accesible. "
                    f"Error: {sanitized_error}"
                )
                ejec.ai_report = {
                    **(ejec.ai_report or {}),
                    "error_code": "AI_MODEL_UNAVAILABLE",
                    "human_review_required": True,
                    "failure_category": "model_unavailable",
                    "correlation_id": correlation_id,
                }
                await db.commit()
                await _emit_ai_engine_unavailable_event(db, ejec, case, sanitized_error)
                raise ConnectionError(f"Motor IA no accesible: {sanitized_error}")
        except Exception as e:
            # Error generico - identificar si es de conexion o de ejecucion
            error_type = type(e).__name__
            sanitized_error = _safe_ai_error_detail(e)
            if attempt < max_retries - 1:
                logger.warning(
                    "AI engine %s (attempt %s/%s): %s, retrying in %ss",
                    error_type,
                    attempt + 1,
                    max_retries,
                    sanitized_error,
                    retry_delay,
                )
                await asyncio.sleep(retry_delay)
            else:
                ejec.estado_resultado = models.EstadoResultado.BLOQUEADO
                ejec.execution_mode = execution_mode
                ejec.ai_human_review_required = True
                ejec.ai_review_status = models.AiReviewStatus.REQUIERE_REVISION
                ejec.observaciones = (
                    f"ERROR INESPERADO: {error_type} tras {max_retries} intentos. "
                    f"No se pudo enviar la tarea al Motor IA. "
                    f"Error: {sanitized_error}"
                )
                ejec.ai_report = {
                    **(ejec.ai_report or {}),
                    "error_code": "AI_MODEL_UNAVAILABLE",
                    "human_review_required": True,
                    "failure_category": "model_unavailable",
                }
                await db.commit()
                await _emit_ai_engine_unavailable_event(db, ejec, case, f"{error_type}: {sanitized_error}")
async def trigger_ai_execution_background(ejecucion_id: UUID, requested_mode: models.ExecutionMode = models.ExecutionMode.IA):
    async with AsyncSessionLocal() as db:
        try:
            await trigger_ai_execution(ejecucion_id, db, requested_mode)
        except Exception as exc:
            sanitized_error = _safe_ai_error_detail(exc)
            result = await db.execute(
                select(models.EjecucionCaso).filter(models.EjecucionCaso.id == ejecucion_id)
            )
            ejec = result.scalar_one_or_none()
            if ejec and ejec.estado_resultado == models.EstadoResultado.EJECUTANDO_AI:
                ejec.estado_resultado = models.EstadoResultado.BLOQUEADO
                ejec.execution_mode = requested_mode
                ejec.ai_human_review_required = True
                ejec.ai_review_status = models.AiReviewStatus.REQUIERE_REVISION
                ejec.observaciones = (
                    "Ejecución IA interrumpida antes de enviar al engine. "
                    f"Detalle: {type(exc).__name__}: {sanitized_error}"
                )
                ejec.ai_report = {
                    **(ejec.ai_report or {}),
                    "error_code": "AI_MODEL_UNAVAILABLE",
                    "human_review_required": True,
                    "failure_category": "model_unavailable",
                }
                await db.commit()
                case = (await db.execute(select(models.CasoPrueba).filter(models.CasoPrueba.id == ejec.caso_id))).scalar_one_or_none()
                await _emit_ai_engine_unavailable_event(db, ejec, case, f"{type(exc).__name__}: {sanitized_error}")
            write_trace("backend", "error", {
                "request_id": str(ejecucion_id),
                "phase": "ai_background_error",
                "execution_id": str(ejecucion_id),
                "error": {
                    "type": type(exc).__name__,
                    "message": sanitized_error,
                },
            })
            logger.warning(
                "AI execution %s interrupted before sending to engine: %s",
                ejecucion_id,
                sanitized_error,
            )
