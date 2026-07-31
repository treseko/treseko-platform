from .repository_context import *
from .ai_provider_catalog import AI_PROVIDER_KEY_ENV, AI_PROVIDER_NO_KEY, AI_PROVIDER_PRESET_MODELS
from .core_settings_ai_workflow_helpers import (
    ai_provider_api_key_status,
    get_configured_ai_provider_api_key,
)
from ..services.error_sanitizer import sanitize_external_error
from ..services.error_contract import correlation_headers, current_correlation_id
from .ai_provider_profiles import resolve_ai_provider_credential


def _safe_ai_monitor_detail(value: object) -> str:
    return sanitize_external_error(value)


async def add_workflow_node_from_preset(
    db: AsyncSession,
    workflow_id: UUID,
    payload: schemas.AiWorkflowNodeFromPresetRequest,
    user_id: Optional[UUID],
) -> models.AiWorkflow:
    workflow = await get_ai_workflow(db, workflow_id)
    if workflow.status == "ACTIVE":
        raise ValueError("No se puede editar el workflow activo; duplica o crea un borrador.")
    preset = None
    definition = None
    universal_version = None
    if payload.universal_agent_version_id:
        if workflow.workflow_format != "universal_v2":
            raise ValueError("Los agentes universales solo se pueden insertar en workflows universal_v2.")
        universal_version = (await db.execute(
            select(models.AiUniversalAgentVersion).filter(models.AiUniversalAgentVersion.id == payload.universal_agent_version_id)
        )).scalar_one_or_none()
        if not universal_version:
            raise ValueError("Version de agente universal no encontrada")
    elif payload.agent_definition_id:
        definition = (await db.execute(select(models.AiAgentDefinition).filter(models.AiAgentDefinition.id == payload.agent_definition_id))).scalar_one_or_none()
        if not definition:
            raise ValueError("Definicion de agente no encontrada")
    else:
        preset_result = await db.execute(select(models.AiAgentPreset).filter(models.AiAgentPreset.id == payload.preset_id))
        preset = preset_result.scalar_one_or_none()
        if not preset:
            raise ValueError("Preset de agente no encontrado")
    contract = universal_version.contract_json if universal_version else {}
    adapter = str((contract.get("implementation") or {}).get("native_adapter") or "")
    adapter_types = {
        "legacy-context-resolver/v1": "ContextResolver", "legacy-pre-execution-analyst/v1": "PreExecutionAnalyst",
        "legacy-observer/v1": "Observer", "legacy-planner/v1": "Planner", "legacy-security-guard/v1": "SecurityGuard",
        "legacy-executor/v1": "Executor", "legacy-validator/v1": "Validator", "legacy-recovery/v1": "Recovery",
        "legacy-auditor/v1": "Auditor", "legacy-reporter/v1": "Reporter", "universal-llm/v1": "llm_agent",
        "universal-rules/v1": "rule_agent", "universal-transform/v1": "rule_agent",
        "universal-browser/v1": "browser_action_agent", "universal-validator/v1": "validator_agent",
        "universal-reporter/v1": "reporter_agent", "universal-http/v1": "webhook_agent",
        "universal-human-approval/v1": "human_approval_agent", "universal-mcp/v1": "mcp_tool_agent",
        "universal-script-sandbox/v1": "script_agent", "universal-a2a-disabled/v1": "a2a_disabled_agent",
    }
    name = str(contract.get("name") or "Agente universal") if universal_version else (definition.name if definition else preset.name)
    node_type = adapter_types.get(adapter, "llm_agent") if universal_version else (definition.runtime_handler if definition and definition.runtime_handler else (definition.kind if definition else preset.type))
    agent_key = f"UNIVERSAL_{str(contract.get('key') or 'AGENT').upper().replace('-', '_')}" if universal_version else (definition.key if definition else f"CUSTOM_{preset.type.upper()}")
    config = {} if universal_version or definition else preset.config_json
    node = models.AiWorkflowNode(
        workflow_id=workflow.id,
        type=node_type,
        name=name,
        agent_key=agent_key,
        agent_definition_id=definition.id if definition else None,
        universal_agent_version_id=universal_version.id if universal_version else None,
        enabled=True,
        locked=False,
        prompt_template=str((contract.get("instructions") or {}).get("user_instructions") or "") if universal_version else ("" if definition else preset.prompt_template or ""),
        config_json={
            **(config or {}),
            **({"input_mapping": preset.input_mapping or {}, "output_schema": preset.output_schema or {}} if preset else {}),
            **({"agent_status": definition.status} if definition else {}),
            **({"universal_contract_version": "treseko.universal-agent/v1"} if universal_version else {}),
        },
        position_x=payload.position_x,
        position_y=payload.position_y,
        retry_policy={} if universal_version else ((definition.default_retry_policy or {}) if definition else {}),
        timeout_sec=int((contract.get("execution") or {}).get("timeout_sec") or 60) if universal_version else int(definition.default_timeout_sec if definition else (preset.config_json or {}).get("timeout_sec") or 60),
    )
    db.add(node)
    await db.flush()
    db.add(models.AiPromptVersion(
        node_id=node.id,
        version=1,
        prompt_template=node.prompt_template,
        changelog=f"Nodo creado desde {'definicion' if definition else 'preset'} {name}",
        created_by=user_id,
    ))
    if payload.source_node_id:
        db.add(models.AiWorkflowEdge(
            workflow_id=workflow.id,
            source_node_id=payload.source_node_id,
            target_node_id=node.id,
            condition_type=payload.condition_type or "always",
            condition_json={},
            priority=50,
            max_passes=1,
        ))
    await db.flush()
    await create_ai_workflow_version(db, workflow, f"Nodo agregado desde {'definicion' if definition else 'preset'} {name}", user_id)
    await db.commit()
    # The workflow was loaded with its relationships before adding the node.
    # Refresh them so FastAPI serializes the graph committed in this request,
    # rather than the session's previous relationship collection.
    await db.refresh(workflow, attribute_names=["nodes", "edges"])
    return await get_ai_workflow(db, workflow_id)


async def get_active_ai_workflow_definition(db: AsyncSession) -> Optional[Dict[str, Any]]:
    await ensure_default_ai_workflow(db)
    config = await get_ai_engine_config(db)
    workflow_id = (config.get("active_workflow_ids") or {}).get("test_execution") or config.get("active_workflow_id")
    workflow = None
    if workflow_id:
        try:
            workflow = await _load_workflow(db, UUID(str(workflow_id)))
        except (TypeError, ValueError):
            workflow = None
    if not workflow or workflow.workflow_purpose != "test_execution" or workflow.status != "ACTIVE":
        result = await db.execute(select(models.AiWorkflow).filter(
            models.AiWorkflow.status == "ACTIVE",
            models.AiWorkflow.workflow_purpose == "test_execution",
        ).order_by(models.AiWorkflow.is_default.desc()))
        candidate = result.scalars().first()
        workflow = await _load_workflow(db, candidate.id) if candidate else None
    if not workflow:
        return None
    return _workflow_definition(workflow)


async def list_ai_execution_traces(db: AsyncSession, execution_id: UUID) -> List[models.AiExecutionTrace]:
    result = await db.execute(
        select(models.AiExecutionTrace)
        .filter(models.AiExecutionTrace.execution_id == execution_id)
        .order_by(models.AiExecutionTrace.started_at, models.AiExecutionTrace.ended_at)
    )
    return result.scalars().all()


from .ai_engine_provider_scan import (_infer_ai_provider, _model_capabilities_from_name, _normalize_model_item, _provider_auth_headers, _provider_key_metadata, scan_ai_engine_models)
async def check_ai_engine_health(db: AsyncSession, provider_payload: Optional[Dict[str, Any]] = None):
    engine_url = ENGINE_URL.rstrip("/")
    config = await get_ai_engine_config(db)
    if config.get("ai_execution_driver") == "opencode":
        try:
            # OpenCode may need several seconds to start its managed local
            # server after a credential change or an Engine restart. Retry the
            # initial probe so that normal process startup is not shown as an
            # unavailable provider in the UI.
            response = None
            async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0)) as client:
                for attempt in range(3):
                    response = await client.post(
                        f"{engine_url}/agent-health",
                        params={"driver": "opencode"},
                        json={"provider": config.get("provider"), "model": config.get("model"), "provider_api_key": (provider_payload or {}).get("provider_api_key")},
                        headers=engine_internal_headers(current_correlation_id()),
                    )
                    if response.is_success or attempt == 2:
                        break
                    await asyncio.sleep(1)
            assert response is not None
            data = response.json() if response.text else {}
            return {"status": "ok" if response.is_success else "error", "detail": data.get("detail") if isinstance(data, dict) else None, "engine": data}
        except Exception as exc:
            return {"status": "error", "detail": f"OpenCode no disponible: {_safe_ai_monitor_detail(exc)}", "engine": None}
    if provider_payload:
        llm_endpoint = str(provider_payload.get("llm_endpoint") or "").rstrip("/")
        model = provider_payload.get("model") or config.get("model") or DEFAULT_AI_ENGINE_CONFIG["model"]
        provider = _infer_ai_provider(provider_payload.get("provider") or config.get("provider") or "openai-compatible", llm_endpoint)
    else:
        llm_endpoint = str(config.get("llm_endpoint") or "").rstrip("/")
        model = config.get("model") or DEFAULT_AI_ENGINE_CONFIG["model"]
        provider = _infer_ai_provider(config.get("provider") or "openai-compatible", llm_endpoint)
    key_metadata = _provider_key_metadata(provider, config)
    health_payload: Dict[str, Any] = {}
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"{engine_url}/health", headers=correlation_headers(current_correlation_id()))
        data = response.json() if response.text else {}
        health_payload["engine"] = data if isinstance(data, dict) else {"raw": data}
        if response.status_code >= 400:
            return {
                "status": "error",
                "detail": f"Motor IA no responde correctamente: HTTP {response.status_code}",
                "engine": health_payload,
            }
    except Exception as exc:
        return {
            "status": "error",
            "detail": f"Motor IA no disponible: {_safe_ai_monitor_detail(exc)}",
            "engine": health_payload or None,
        }

    if provider_payload:
        if key_metadata["requires_api_key"] and not provider_payload.get("provider_api_key"):
            return {
                "status": "error",
                "detail": f"El proveedor {provider} requiere configurar la API key",
                "engine": health_payload,
            }
        if not llm_endpoint:
            return {
                "status": "error",
                "detail": "Endpoint LLM no configurado",
                "engine": health_payload,
            }
        payload = {
            "provider": provider,
            "llm_endpoint": llm_endpoint,
            "model": model,
            "provider_api_key": provider_payload.get("provider_api_key"),
            "max_retries": provider_payload.get("provider_max_retries")
            or provider_payload.get("max_retries")
            or 1,
            "provider_fallbacks": provider_payload.get("provider_fallbacks") or [],
        }
        headers = engine_internal_headers(current_correlation_id())
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.post(
                    f"{engine_url}/provider-health",
                    json={k: v for k, v in payload.items() if v not in (None, {}, [], "")},
                    headers=headers,
                )
            provider_health = response.json() if response.text else {}
            health_payload["llm"] = {
                "endpoint": llm_endpoint,
                "provider": provider,
                "model": model,
                "status_code": response.status_code,
                "provider_api_key_configured": bool(provider_payload.get("provider_api_key")),
            }
            if response.status_code >= 400:
                detail = provider_health.get("error") if isinstance(provider_health, dict) else response.text[:300]
                return {
                    "status": "error",
                    "detail": (
                        f"LLM rechazo la verificacion: HTTP {response.status_code} "
                        f"{_safe_ai_monitor_detail(detail)}"
                    ),
                    "engine": health_payload,
                }
            return {
                "status": "ok",
                "detail": "Motor IA disponible",
                "engine": health_payload,
            }
        except Exception as exc:
            health_payload["llm"] = {
                "endpoint": llm_endpoint,
                "provider": provider,
                "model": model,
            }
            return {
                "status": "error",
                "detail": f"No se pudo conectar con el LLM: {_safe_ai_monitor_detail(exc)}",
                "engine": health_payload,
            }

    if provider not in {"anthropic", "cohere"}:
        if not llm_endpoint:
            return {
                "status": "error",
                "detail": "Endpoint LLM no configurado",
                "engine": health_payload,
            }
        if key_metadata["requires_api_key"] and not key_metadata["api_key_configured"]:
            return {
                "status": "error",
                "detail": f"El proveedor {provider} requiere configurar {key_metadata['api_key_env']} en el servidor",
                "engine": health_payload,
            }
        llm_base_endpoint = llm_endpoint
        if provider == "ollama" and not llm_base_endpoint.endswith("/v1"):
            llm_base_endpoint = f"{llm_base_endpoint}/v1"
        headers = _provider_auth_headers(config, provider)
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                llm_response = await client.post(
                    f"{llm_base_endpoint}/chat/completions",
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": "ping"}],
                        "max_tokens": 5,
                    },
                    headers=headers,
                )
            llm_data = llm_response.json() if llm_response.text else {}
            health_payload["llm"] = {
                "endpoint": llm_base_endpoint,
                "provider": provider,
                "model": model,
                "status_code": llm_response.status_code,
                "model_response": llm_data.get("model") if isinstance(llm_data, dict) else None,
                "requires_api_key": key_metadata["requires_api_key"],
                "api_key_configured": key_metadata["api_key_configured"],
            }
            if llm_response.status_code >= 400:
                detail = llm_data.get("error") if isinstance(llm_data, dict) else llm_response.text[:300]
                return {
                    "status": "error",
                    "detail": (
                        f"LLM rechazo la verificacion: HTTP {llm_response.status_code} "
                        f"{_safe_ai_monitor_detail(detail)}"
                    ),
                    "engine": health_payload,
                }
        except Exception as exc:
            health_payload["llm"] = {
                "endpoint": llm_base_endpoint,
                "provider": provider,
                "model": model,
            }
            return {
                "status": "error",
                "detail": f"No se pudo conectar con el LLM: {_safe_ai_monitor_detail(exc)}",
                "engine": health_payload,
            }
    else:
        health_payload["llm"] = {
            "endpoint": llm_endpoint,
            "provider": provider,
            "model": model,
            "requires_api_key": key_metadata["requires_api_key"],
            "api_key_configured": key_metadata["api_key_configured"],
            "detail": "Health remoto nativo no ejecutado; use un endpoint OpenAI-compatible o proxy compatible para este motor.",
        }
        return {
            "status": "error",
            "detail": f"El proveedor {provider} no esta soportado directamente por el Motor IA actual; use OpenRouter, LiteLLM u otro proxy OpenAI-compatible.",
            "engine": health_payload,
        }

    return {
        "status": "ok",
        "detail": None,
        "engine": health_payload,
    }


def _monitor_component(
    component_id: str,
    name: str,
    component_type: str,
    status: str,
    version: Optional[str] = None,
    target: Optional[str] = None,
    latency_ms: Optional[int] = None,
    detail: Optional[str] = None,
):
    return {
        "id": component_id,
        "name": name,
        "type": component_type,
        "version": version,
        "target": target,
        "status": status,
        "latency_ms": latency_ms,
        "detail": detail,
        "restart_hint": SYSTEM_RESTART_HINTS.get(component_id),
        "checked_at": utc_now(),
    }


async def _probe_http_component(component_id: str, name: str, target: str, timeout_seconds: float = 3.0):
    started = asyncio.get_running_loop().time()
    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.get(target)
        latency_ms = int((asyncio.get_running_loop().time() - started) * 1000)
        status = "ONLINE" if response.status_code < 500 else "DEGRADED"
        return _monitor_component(
            component_id,
            name,
            "HTTP",
            status,
            target=target,
            latency_ms=latency_ms,
            detail=f"HTTP {response.status_code}",
        )
    except Exception as exc:
        latency_ms = int((asyncio.get_running_loop().time() - started) * 1000)
        return _monitor_component(
            component_id,
            name,
            "HTTP",
            "OFFLINE",
            target=target,
            latency_ms=latency_ms,
            detail=_safe_ai_monitor_detail(exc),
        )

async def _probe_database_component(db: AsyncSession):
    started = asyncio.get_running_loop().time()
    try:
        result = await db.execute(text("SELECT version()"))
        version_text = str(result.scalar_one_or_none() or "")
        version = None
        match = re.search(r"PostgreSQL\s+([0-9]+(?:\.[0-9]+)*)", version_text)
        if match:
            version = match.group(1)
        return _monitor_component(
            "database",
            "PostgreSQL / Base de datos",
            "DATABASE",
            "ONLINE",
            version=version,
            target=os.getenv("DATABASE_URL", "").split("@")[-1] or "DATABASE_URL",
            latency_ms=int((asyncio.get_running_loop().time() - started) * 1000),
            detail="SELECT version() OK",
        )
    except Exception as exc:
        return _monitor_component(
            "database",
            "PostgreSQL / Base de datos",
            "DATABASE",
            "OFFLINE",
            target="DATABASE_URL",
            latency_ms=int((asyncio.get_running_loop().time() - started) * 1000),
            detail=_safe_ai_monitor_detail(exc),
        )
