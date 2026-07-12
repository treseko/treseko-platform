import logging

from .legacy_common import *
from .. import auth
from ..services.edition.entitlement_service import ensure_feature_enabled
from ..services.edition.usage_limits import enforce_weekly_ai_execution_limit
from ..services.error_sanitizer import sanitize_external_error


logger = logging.getLogger(__name__)


def _safe_ai_error_detail(value: object) -> str:
    return sanitize_external_error(value)


async def _require_ai_execution_entitlement(db: AsyncSession, execution: models.EjecucionCaso):
    await ensure_feature_enabled(db, "ai.basic_execution")
    result = await db.execute(
        select(models.TestRun, models.Proyecto)
        .join(models.Proyecto, models.Proyecto.id == models.TestRun.proyecto_id)
        .filter(models.TestRun.id == execution.test_run_id)
    )
    row = result.first()
    if not row:
        raise ValueError("Run o proyecto no encontrado para aplicar cuota IA")
    run, project = row
    if execution.execution_mode != models.ExecutionMode.IA:
        await enforce_weekly_ai_execution_limit(db, solution_id=project.organizacion_id)
    return run, project


async def trigger_ai_execution(ejecucion_id: UUID, db: AsyncSession):
    result = await db.execute(
        select(models.EjecucionCaso, models.CasoPrueba)
        .join(models.CasoPrueba, models.CasoPrueba.id == models.EjecucionCaso.caso_id)
        .filter(models.EjecucionCaso.id == ejecucion_id)
    )
    row = result.first()
    if not row:
        return
    ejec, case = row
    run, _project = await _require_ai_execution_entitlement(db, ejec)
    config = await get_ai_engine_config(db)
    workflow_definition = await get_active_ai_workflow_definition(db)
    engine_url = ENGINE_URL.rstrip("/")
    callback_url = f"{os.getenv('BACKEND_PUBLIC_URL', 'http://localhost:8000').rstrip('/')}/ai-engine/executions/{ejecucion_id}/result"

    # VALIDACION 1: Engine activo - si esta caido, devolver error claro
    # No marcar como BLOQUEADO silenciosamente, el usuario tiene que saber que el engine no funciona
    health = await check_ai_engine_health(db)
    if health.get("status") != "ok":
        error_detail = _safe_ai_error_detail(health.get('detail', 'Motor IA no responde'))
        # Marcar como BLOQUEADO pero con mensaje claro y descriptivo
        ejec.estado_resultado = models.EstadoResultado.BLOQUEADO
        ejec.execution_mode = models.ExecutionMode.IA
        ejec.observaciones = (
            f"NO SE PUEDE EJECUTAR: El Motor IA no esta disponible. "
            f"Verifica que el servicio interno del Motor IA este corriendo. "
            f"Detalle del error: {error_detail}"
        )
        await db.commit()
        await _emit_ai_engine_unavailable_event(db, ejec, case, str(error_detail))
        logger.warning("AI execution %s blocked: engine unavailable: %s", ejecucion_id, error_detail)
        # Devolver error para que el frontend lo muestre al usuario
        raise ConnectionError(f"Motor IA no disponible: {error_detail}")

    ejec.estado_resultado = models.EstadoResultado.EJECUTANDO_AI
    ejec.execution_mode = models.ExecutionMode.IA
    ejec.ai_review_status = models.AiReviewStatus.NO_REQUIERE_REVISION
    await db.commit()

    snapshots = await get_snapshots_ejecucion(db, ejecucion_id)
    dataset_resuelto = []
    variables_resueltas = {}
    if run:
        dataset_resuelto = (run.datasets_resueltos or {}).get(str(ejec.caso_id), [])
        variables_resueltas = run.variables_resueltas or {}
        resolved_dataset = await resolve_case_dataset(db, case.id, run.build_id, run.entorno_id, run.dataset_id)
        if resolved_dataset:
            dataset_resuelto = resolved_dataset["dataset_resuelto"]
            variables_resueltas = resolved_dataset["variables_resueltas"]

    base_url = get_ai_base_url_from_context(variables_resueltas, snapshots)
    if not base_url:
        ejec.estado_resultado = models.EstadoResultado.BLOQUEADO
        ejec.execution_mode = models.ExecutionMode.IA
        ejec.observaciones = "Motor IA requiere una URL base en el ambiente/dataset o en los datos de un paso."
        await db.commit()
        return
    frozen_workflow = workflow_definition or {}
    frozen_workflow_meta = frozen_workflow.get("workflow") if isinstance(frozen_workflow, dict) else {}
    if isinstance(frozen_workflow_meta, dict):
        ejec.ai_report = {
            **(ejec.ai_report or {}),
            "workflow_id": frozen_workflow_meta.get("id"),
            "workflow_version": frozen_workflow_meta.get("version"),
            "workflow_snapshot": frozen_workflow,
            "workflow_nodes": frozen_workflow.get("nodes", []) if isinstance(frozen_workflow, dict) else [],
            "workflow_edges": frozen_workflow.get("edges", []) if isinstance(frozen_workflow, dict) else [],
        }
        await db.commit()

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
    payload = {
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
        "callback_url": callback_url,
        "engine_ws_token": auth.create_access_token(
            data={"sub": "ai-engine", "scope": "ai-engine-ws", "execution_id": str(ejecucion_id)},
            expires_delta=timedelta(hours=6),
            token_type="engine_ws",
        ),
        "maxSteps": len(steps) or int(config.get("max_steps") or 10),
        "timeout_seconds": int(config.get("timeout_seconds") or 900),
        "headless": bool(config.get("headless")),
        "viewport_width": int(config.get("viewport_width") or 1920),
        "viewport_height": int(config.get("viewport_height") or 1080),
        "agent_workflow": config.get("agent_workflow") or _legacy_agent_workflow_from_definition(workflow_definition),
        "workflow_definition": frozen_workflow,
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
        "request_id": str(ejecucion_id),
        "method": "POST",
        "url": f"{engine_url}/run-task",
        "execution_id": str(ejecucion_id),
        "case_code": case.codigo,
        "body": payload,
    })

    # TIMEOUT: Diferenciar entre timeout de conexion y timeout de ejecucion
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
                ejec_t.estado_resultado = models.EstadoResultado.FALLO
                ejec_t.execution_mode = models.ExecutionMode.IA
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
                }
                await timeout_db.commit()
                logger.warning("AI execution %s failed by execution timeout (%ss)", ejec_id, timeout_seg)

    # Iniciar watcher de timeout de ejecucion
    asyncio.create_task(ai_execution_timeout_watcher(ejecucion_id, timeout_seconds))

    # REINTENTOS: Solo para errores de conexion, no para errores de ejecucion
    max_retries = 3
    retry_delay = 5  # segundos

    for attempt in range(max_retries):
        try:
            # Timeout corto (10s) para la conexion HTTP con el engine
            # Si el engine no acepta la peticion en 10s, es un problema de conexion
            async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
                resp = await client.post(f"{engine_url}/run-task", json=payload)
                if resp.status_code == 200:
                    logger.info("AI execution %s sent to engine (attempt %s/%s)", ejecucion_id, attempt + 1, max_retries)
                    return
                else:
                    # El engine respondio pero con error - no es un timeout de conexion
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
                        ejec.execution_mode = models.ExecutionMode.IA
                        ejec.ai_human_review_required = True
                        ejec.ai_review_status = models.AiReviewStatus.REQUIERE_REVISION
                        ejec.observaciones = (
                            f"ERROR DE MOTOR IA: El engine rechazo la tarea tras {max_retries} intentos "
                            f"(HTTP {resp.status_code}). "
                            f"El engine esta corriendo pero no acepta la tarea. "
                            f"Revisa la configuracion del engine."
                        )
                        ejec.ai_report = {
                            **(ejec.ai_report or {}),
                            "error_code": "AI_MODEL_UNAVAILABLE",
                            "human_review_required": True,
                            "failure_category": "model_unavailable",
                        }
                        await db.commit()
                        await _emit_ai_engine_unavailable_event(db, ejec, case, f"Engine rechazo HTTP {resp.status_code}")

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
                ejec.execution_mode = models.ExecutionMode.IA
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
                }
                await db.commit()
                await _emit_ai_engine_unavailable_event(db, ejec, case, sanitized_error)
                raise ConnectionError(f"Motor IA no accesible: {sanitized_error}")

        except httpx.ConnectTimeout as e:
            # TIMEOUT DE CONEXION: El engine tardo demasiado en aceptar la conexion
            sanitized_error = _safe_ai_error_detail(e)
            if attempt < max_retries - 1:
                logger.warning(
                    "AI engine connection timeout (attempt %s/%s), retrying in %ss",
                    attempt + 1,
                    max_retries,
                    retry_delay,
                )
                await asyncio.sleep(retry_delay)
            else:
                ejec.estado_resultado = models.EstadoResultado.BLOQUEADO
                ejec.execution_mode = models.ExecutionMode.IA
                ejec.ai_human_review_required = True
                ejec.ai_review_status = models.AiReviewStatus.REQUIERE_REVISION
                ejec.observaciones = (
                    f"NO SE PUEDE EJECUTAR - TIMEOUT DE CONEXION: El Motor IA "
                    f"no acepto la conexion tras {max_retries} intentos. "
                    f"El engine puede estar sobrecargado o con problemas de red. "
                    f"Error: {sanitized_error}"
                )
                ejec.ai_report = {
                    **(ejec.ai_report or {}),
                    "error_code": "AI_TIMEOUT",
                    "human_review_required": True,
                    "failure_category": "timeout",
                }
                await db.commit()
                await _emit_ai_engine_unavailable_event(db, ejec, case, sanitized_error)
                raise ConnectionError(f"Timeout de conexion con Motor IA: {sanitized_error}")

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
                ejec.execution_mode = models.ExecutionMode.IA
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


async def trigger_ai_execution_background(ejecucion_id: UUID):
    async with AsyncSessionLocal() as db:
        try:
            await trigger_ai_execution(ejecucion_id, db)
        except Exception as exc:
            sanitized_error = _safe_ai_error_detail(exc)
            result = await db.execute(
                select(models.EjecucionCaso).filter(models.EjecucionCaso.id == ejecucion_id)
            )
            ejec = result.scalar_one_or_none()
            if ejec and ejec.estado_resultado == models.EstadoResultado.EJECUTANDO_AI:
                ejec.estado_resultado = models.EstadoResultado.BLOQUEADO
                ejec.execution_mode = models.ExecutionMode.IA
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
