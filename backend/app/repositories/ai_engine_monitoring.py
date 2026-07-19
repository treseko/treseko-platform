from .legacy_common import *
from .ai_provider_catalog import AI_PROVIDER_KEY_ENV, AI_PROVIDER_NO_KEY, AI_PROVIDER_PRESET_MODELS
from .core_settings_ai_workflow_helpers import (
    ai_provider_api_key_status,
    get_configured_ai_provider_api_key,
)
from ..services.error_sanitizer import sanitize_external_error


def _safe_ai_monitor_detail(value: object) -> str:
    return sanitize_external_error(value)


async def add_workflow_node_from_preset(
    db: AsyncSession,
    workflow_id: UUID,
    payload: schemas.AiWorkflowNodeFromPresetRequest,
    user_id: Optional[UUID],
) -> models.AiWorkflow:
    workflow = await get_ai_workflow(db, workflow_id)
    preset_result = await db.execute(select(models.AiAgentPreset).filter(models.AiAgentPreset.id == payload.preset_id))
    preset = preset_result.scalar_one_or_none()
    if not preset:
        raise ValueError("Preset de agente no encontrado")
    node = models.AiWorkflowNode(
        workflow_id=workflow.id,
        type=preset.type,
        name=preset.name,
        agent_key=f"CUSTOM_{preset.type.upper()}",
        enabled=True,
        locked=False,
        prompt_template=preset.prompt_template or "",
        config_json={
            **(preset.config_json or {}),
            "input_mapping": preset.input_mapping or {},
            "output_schema": preset.output_schema or {},
        },
        position_x=payload.position_x,
        position_y=payload.position_y,
        retry_policy={},
        timeout_sec=int((preset.config_json or {}).get("timeout_sec") or 60),
    )
    db.add(node)
    await db.flush()
    db.add(models.AiPromptVersion(
        node_id=node.id,
        version=1,
        prompt_template=node.prompt_template,
        changelog=f"Nodo creado desde preset {preset.name}",
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
    await create_ai_workflow_version(db, workflow, f"Nodo agregado desde preset {preset.name}", user_id)
    await db.commit()
    # The workflow was loaded with its relationships before adding the node.
    # Refresh them so the endpoint returns the graph committed in this request.
    await db.refresh(workflow, attribute_names=["nodes", "edges"])
    return await get_ai_workflow(db, workflow_id)


async def get_active_ai_workflow_definition(db: AsyncSession) -> Optional[Dict[str, Any]]:
    await ensure_default_ai_workflow(db)
    config = await get_ai_engine_config(db)
    workflow_id = config.get("active_workflow_id")
    workflow = None
    if workflow_id:
        try:
            workflow = await _load_workflow(db, UUID(str(workflow_id)))
        except (TypeError, ValueError):
            workflow = None
    if not workflow:
        result = await db.execute(select(models.AiWorkflow).filter(models.AiWorkflow.status == "ACTIVE").order_by(models.AiWorkflow.is_default.desc()))
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


def _infer_ai_provider(provider: str, endpoint: str) -> str:
    value = (provider or "openai-compatible").lower().replace("_", "-")
    aliases = {
        "google": "gemini",
        "lmstudio": "lm-studio",
        "lm-studio-local": "lm-studio",
        "openai-compatible-local": "openai-compatible",
        "custom-http": "openai-compatible",
    }
    value = aliases.get(value, value)
    endpoint_value = (endpoint or "").lower()
    if "127.0.0.1:1234" in endpoint_value or "localhost:1234" in endpoint_value:
        return "lm-studio"
    if "11434" in endpoint_value:
        return "ollama"
    if "openrouter.ai" in endpoint_value:
        return "openrouter"
    if "api.groq.com" in endpoint_value:
        return "groq"
    if "api.deepseek.com" in endpoint_value:
        return "deepseek"
    if "api.mistral.ai" in endpoint_value:
        return "mistral"
    if "api.together.xyz" in endpoint_value:
        return "together"
    if "fireworks.ai" in endpoint_value:
        return "fireworks"
    if "api.perplexity.ai" in endpoint_value:
        return "perplexity"
    if "api.x.ai" in endpoint_value:
        return "xai"
    if "anthropic.com" in endpoint_value:
        return "anthropic"
    if "generativelanguage.googleapis.com" in endpoint_value:
        return "gemini"
    if "openai.azure.com" in endpoint_value:
        return "azure-openai"
    return value


def _provider_key_metadata(provider: str, config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    normalized = (provider or "openai-compatible").lower().replace("_", "-")
    env_name = AI_PROVIDER_KEY_ENV.get(normalized)
    requires_key = bool(env_name) and normalized not in AI_PROVIDER_NO_KEY
    status = ai_provider_api_key_status(config or {}, normalized)
    return {
        "requires_api_key": requires_key,
        "api_key_env": env_name,
        "api_key_configured": bool(status["configured"]),
        "api_key_source": status["source"],
    }


def _provider_auth_headers(config: Dict[str, Any], provider: str) -> Dict[str, str]:
    api_key = get_configured_ai_provider_api_key(config, provider)
    return {"Authorization": f"Bearer {api_key}"} if api_key else {}


def _model_capabilities_from_name(model_id: str, source: str = "detected") -> Dict[str, Any]:
    value = (model_id or "").lower()
    vision = any(token in value for token in [
        "vision", "vl", "llava", "pixtral", "qwen2.5-vl", "qwen-vl", "gemma-3", "gemma-4",
        "gpt-4o", "claude-3", "claude-sonnet", "claude-opus", "gemini",
    ])
    reasoning = any(token in value for token in [
        "reason", "reasoner", "r1", "o1", "o3", "o4", "thinking", "qwq", "deepseek",
        "grok-3", "claude-opus", "claude-sonnet", "gemini-2.5", "gpt-4.1",
    ])
    tools = any(token in value for token in [
        "gpt", "claude", "gemini", "qwen", "llama-3.1", "llama-3.2", "llama-3.3",
        "llama-4", "mistral", "mixtral", "command", "grok", "deepseek-chat",
    ])
    context_window = 0
    for pattern, size in [
        ("2m", 2000000),
        ("1m", 1000000),
        ("200k", 200000),
        ("128k", 128000),
        ("64k", 64000),
        ("32k", 32000),
        ("16k", 16000),
        ("8k", 8000),
    ]:
        if pattern in value:
            context_window = size
            break
    return {
        "vision": vision,
        "reasoning": reasoning,
        "tools": tools,
        "json_mode": True,
        "context_window": context_window,
        "notes": f"Capacidades {source}; ajustar manualmente si el proveedor no las informa.",
        "source": source,
    }


def _normalize_model_item(provider: str, item: Dict[str, Any], source: str) -> Dict[str, Any]:
    model_id = str(item.get("id") or item.get("name") or item.get("model") or "").strip()
    if not model_id:
        return {}
    capabilities = item.get("capabilities") if isinstance(item.get("capabilities"), dict) else _model_capabilities_from_name(model_id, source)
    return {
        "id": model_id,
        "name": str(item.get("name") or model_id),
        "provider": provider,
        "source": source,
        "capabilities": capabilities,
        "raw": item,
    }


async def scan_ai_engine_models(db: AsyncSession, payload: schemas.AiModelScanRequest):
    config = await get_ai_engine_config(db)
    endpoint = str(payload.llm_endpoint or config.get("llm_endpoint") or "").rstrip("/")
    provider = _infer_ai_provider(payload.provider or config.get("provider") or "openai-compatible", endpoint)
    key_metadata = _provider_key_metadata(provider, config)
    scanned_at = utc_now()
    models_found: List[Dict[str, Any]] = []
    status = "ok"
    detail = None

    if provider in AI_PROVIDER_PRESET_MODELS:
        if key_metadata["api_key_configured"] and endpoint and provider not in {"anthropic", "cohere"}:
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    response = await client.get(f"{endpoint}/models", headers=_provider_auth_headers(config, provider))
                data = response.json() if response.text else {}
                raw_models = data.get("data", []) if isinstance(data, dict) else []
                models_found = [_normalize_model_item(provider, item, "detected") for item in raw_models]
                models_found = [item for item in models_found if item]
                if response.status_code < 400 and models_found:
                    return {
                        "status": "ok",
                        "detail": f"{len(models_found)} modelos detectados desde el proveedor.",
                        "provider": provider,
                        "llm_endpoint": endpoint or None,
                        "models": models_found,
                        "scanned_at": scanned_at,
                        **key_metadata,
                    }
                detail = f"Catalogo preset local; el proveedor no devolvio modelos detectables por /models."
            except Exception as exc:
                detail = f"Catalogo preset local; no se pudo consultar /models: {_safe_ai_monitor_detail(exc)}"
        models_found = [_normalize_model_item(provider, item, "preset") for item in AI_PROVIDER_PRESET_MODELS[provider]]
        models_found = [item for item in models_found if item]
        return {
            "status": status,
            "detail": detail or (
                "Catalogo preset local; configure la API key en el servidor para ejecutar llamadas reales."
                if key_metadata["requires_api_key"] and not key_metadata["api_key_configured"]
                else "Catalogo preset local; no se consultaron APIs remotas."
            ),
            "provider": provider,
            "llm_endpoint": endpoint or None,
            "models": models_found,
            "scanned_at": scanned_at,
            **key_metadata,
        }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            if provider == "ollama":
                base_endpoint = endpoint.replace("/v1", "").rstrip("/") or "http://127.0.0.1:11434"
                response = await client.get(f"{base_endpoint}/api/tags")
                data = response.json() if response.text else {}
                raw_models = data.get("models", []) if isinstance(data, dict) else []
                models_found = [_normalize_model_item(provider, item, "detected") for item in raw_models]
                endpoint = base_endpoint
            else:
                base_endpoint = endpoint
                if provider == "lm-studio" and not endpoint.endswith("/v1") and not endpoint.endswith("/api/v1"):
                    candidates = [
                        (f"{endpoint}/v1", f"{endpoint}/v1/models"),
                        (f"{endpoint}/api/v1", f"{endpoint}/api/v1/models"),
                        (endpoint, f"{endpoint}/models"),
                    ]
                else:
                    candidates = [(endpoint, f"{endpoint}/models")]
                response = None
                headers = _provider_auth_headers(config, provider)
                for candidate_endpoint, models_url in candidates:
                    response = await client.get(models_url, headers=headers)
                    data = response.json() if response.text else {}
                    raw_models = data.get("data", []) if isinstance(data, dict) else []
                    models_found = [_normalize_model_item(provider, item, "detected") for item in raw_models]
                    if response.status_code < 400 and models_found:
                        base_endpoint = candidate_endpoint
                        break
                endpoint = base_endpoint
        models_found = [item for item in models_found if item]
        if response is not None and response.status_code >= 400:
            status = "error"
            detail = f"El proveedor respondio HTTP {response.status_code}"
        elif not models_found:
            status = "empty"
            detail = "El proveedor respondio sin modelos."
    except Exception as exc:
        status = "error"
        detail = f"No se pudo escanear modelos: {_safe_ai_monitor_detail(exc)}"

    return {
        "status": status,
        "detail": detail,
        "provider": provider,
        "llm_endpoint": endpoint or None,
        "models": models_found,
        "scanned_at": scanned_at,
        **key_metadata,
    }


async def check_ai_engine_health(db: AsyncSession):
    engine_url = ENGINE_URL.rstrip("/")
    config = await get_ai_engine_config(db)
    llm_endpoint = str(config.get("llm_endpoint") or "").rstrip("/")
    model = config.get("model") or DEFAULT_AI_ENGINE_CONFIG["model"]
    provider = _infer_ai_provider(config.get("provider") or "openai-compatible", llm_endpoint)
    key_metadata = _provider_key_metadata(provider, config)
    health_payload: Dict[str, Any] = {}
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"{engine_url}/health")
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
