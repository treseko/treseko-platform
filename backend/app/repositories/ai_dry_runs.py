from .repository_context import *
from .ai_provider_profiles import provider_payload_for_definition

async def run_ai_engine_dry_run(
    db: AsyncSession,
    payload: schemas.AiEngineDryRunRequest,
    *,
    run_id: str | None = None,
    progress_callback_token: str | None = None,
):
    config = await get_ai_engine_config(db)
    workflow_definition = await get_active_ai_workflow_definition(db)
    provider_payload = await provider_payload_for_definition(db, workflow_definition, config)
    health = await check_ai_engine_health(db, provider_payload)
    if health.get("status") != "ok":
        raise ConnectionError(f"Motor IA no disponible: {health.get('detail') or 'no responde'}")

    variables, environment_name, dataset_name, dataset_vars, case_vars = await _resolve_dry_run_variables(db, payload)
    base_url = get_ai_base_url_from_context(variables, payload.pasos) or ""

    steps = _automation_steps_for_payload(payload.pasos)
    guidance = "\n".join(
        [
            f"{step['number']}. Accion: {step['action']}. Datos: {step.get('data') or '-'}. Esperado: {step.get('expected') or '-'}"
            for step in steps
        ]
    )
    test_id = run_id or f"AI-DRY-RUN-{uuid.uuid4().hex[:10]}"
    correlation_id = current_correlation_id(test_id)
    task_payload = {
        "correlation_id": correlation_id,
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
        **provider_payload,
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
    if run_id:
        task_payload["progress_ws_url"] = f"{os.getenv('AI_ENGINE_CALLBACK_BASE_URL') or 'http://backend:8000'}/ws/ai-dry-run-engine/{run_id}".replace("http://", "ws://").replace("https://", "wss://")
        task_payload["callback_token"] = progress_callback_token or os.getenv("AI_ENGINE_CALLBACK_TOKEN") or ""
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
        response = await client.post(f"{ENGINE_URL.rstrip('/')}/run-task-sync", json=task_payload, headers=engine_internal_headers(correlation_id))
    if response.status_code >= 400:
        raise ConnectionError(f"Motor IA rechazo el dry-run: HTTP {response.status_code} {response.text[:300]}")
    data = response.json()
    if isinstance(data, dict):
        result_metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
        data["metadata"] = {
            **result_metadata,
            "provider": result_metadata.get("provider") or provider_payload.get("provider"),
            "model": result_metadata.get("model") or provider_payload.get("model"),
        }
    return schemas.AiEngineDryRunResult(**data)

# --- PORTABILIDAD ---
MAX_PROJECT_IMPORT_SUITES = 1000
MAX_PROJECT_IMPORT_CASES = 2000
MAX_PROJECT_IMPORT_STEPS_PER_CASE = schemas.MAX_TEST_CASE_STEPS
MAX_PROJECT_IMPORT_METADATA_BYTES = 32 * 1024
