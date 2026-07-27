from .repository_context import *
from .ai_provider_catalog import AI_PROVIDER_KEY_ENV, AI_PROVIDER_NO_KEY, AI_PROVIDER_PRESET_MODELS
from .core_settings_ai_workflow_helpers import (
    ai_provider_api_key_status,
    get_configured_ai_provider_api_key,
)
from ..services.error_sanitizer import sanitize_external_error
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
    model_id = str(item.get("id") or item.get("key") or item.get("name") or item.get("model") or "").strip()
    if not model_id:
        return {}
    capabilities = item.get("capabilities") if isinstance(item.get("capabilities"), dict) else _model_capabilities_from_name(model_id, source)
    capabilities = {**capabilities}
    native_config = item.get("config") if isinstance(item.get("config"), dict) else {}
    loaded_context = native_config.get("context_length") or item.get("context_length")
    max_context = item.get("max_context_length") or item.get("context_window")
    try:
        if loaded_context:
            capabilities["context_window"] = int(loaded_context)
            capabilities["loaded_context_window"] = int(loaded_context)
        if max_context:
            capabilities["max_context_window"] = int(max_context)
    except (TypeError, ValueError):
        pass
    return {
        "id": model_id,
        "name": str(item.get("display_name") or item.get("name") or model_id),
        "provider": provider,
        "source": source,
        "capabilities": capabilities,
        "raw": item,
    }


async def scan_ai_engine_models(db: AsyncSession, payload: schemas.AiModelScanRequest):
    config = await get_ai_engine_config(db)
    profile = await db.get(models.AiProviderProfile, payload.profile_id) if payload.profile_id else None
    if profile and not profile.enabled:
        raise ValueError("El perfil IA está deshabilitado")
    endpoint = str((profile.endpoint if profile else payload.llm_endpoint) or config.get("llm_endpoint") or "").rstrip("/")
    provider = _infer_ai_provider((profile.provider if profile else payload.provider) or config.get("provider") or "openai-compatible", endpoint)
    key_metadata = _provider_key_metadata(provider, config)
    scanned_at = utc_now()
    models_found: List[Dict[str, Any]] = []
    status = "ok"
    detail = None

    if provider == "opencode":
        # OpenCode is managed by the Engine; its catalog is account-scoped and
        # must never be synthesized from a preset or exposed with the key.
        endpoint = "http://127.0.0.1:4096"
        credential = await db.get(models.AiProviderCredential, profile.credential_id) if profile and profile.credential_id else (await db.execute(
            select(models.AiProviderCredential)
            .where(models.AiProviderCredential.provider == "opencode", models.AiProviderCredential.active.is_(True))
            .order_by(models.AiProviderCredential.updated_at.desc())
        )).scalars().first()
        api_key = await resolve_ai_provider_credential(db, credential.id) if credential else None
        key_metadata = {"requires_api_key": True, "api_key_env": None, "api_key_configured": bool(api_key), "api_key_source": "vault" if api_key else None}
        if not api_key:
            return {"status": "blocked", "detail": "OpenCode requiere una API key guardada en el vault para consultar el catálogo.", "provider": provider, "llm_endpoint": endpoint, "models": [], "scanned_at": scanned_at, **key_metadata}
        try:
            engine_url = os.getenv("ENGINE_URL", "http://127.0.0.1:3010").rstrip("/")
            token = os.getenv("AI_ENGINE_INTERNAL_TOKEN", "").strip()
            token_file = os.getenv("AI_ENGINE_INTERNAL_TOKEN_FILE", "").strip()
            if not token and token_file:
                try:
                    token = Path(token_file).read_text(encoding="utf-8").strip()
                except OSError as exc:
                    return {
                        "status": "blocked",
                        "detail": f"No se pudo leer el token interno del Motor IA: {_safe_ai_monitor_detail(exc)}",
                        "provider": provider,
                        "llm_endpoint": endpoint,
                        "models": [],
                        "scanned_at": scanned_at,
                        **key_metadata,
                    }
            # The managed process may need to start and load its provider
            # registry on the first request.
            async with httpx.AsyncClient(timeout=45) as client:
                response = await client.post(f"{engine_url}/opencode/providers", json={"provider_api_key": api_key}, headers={"X-Engine-Internal-Token": token} if token else {})
            data = response.json() if response.text else {}
            providers = data.get("providers", []) if isinstance(data, dict) else []
            for provider_item in providers:
                provider_id = str(provider_item.get("id") or provider_item.get("name") or "opencode")
                model_entries = list(provider_item.get("models", {}).items()) if isinstance(provider_item.get("models"), dict) else [(None, item) for item in provider_item.get("models", [])]
                for model_key, item in model_entries:
                    item = item if isinstance(item, dict) else {}
                    model_id = str(item.get("id") or model_key or item.get("name") or "").strip()
                    if model_id:
                        full_id = model_id if "/" in model_id else f"{provider_id}/{model_id}"
                        models_found.append(_normalize_model_item("opencode", {**item, "id": full_id, "name": item.get("name") or full_id}, "opencode"))
            if response.status_code >= 400:
                status, detail = "blocked", "OpenCode no pudo consultar el catálogo de proveedores (key inválida o servicio no disponible)."
            elif not models_found:
                status, detail = "empty", "OpenCode respondió sin modelos disponibles para esta cuenta."
            else:
                detail = f"{len(models_found)} modelos OpenCode detectados para la cuenta."
        except Exception as exc:
            status, detail = "blocked", f"No se pudo consultar el catálogo OpenCode: {_safe_ai_monitor_detail(exc)}"
        return {"status": status, "detail": detail, "provider": provider, "llm_endpoint": endpoint, "models": models_found, "scanned_at": scanned_at, **key_metadata}

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
                if provider == "lm-studio":
                    root_endpoint = endpoint
                    for suffix in ("/api/v1", "/v1"):
                        if root_endpoint.endswith(suffix):
                            root_endpoint = root_endpoint[:-len(suffix)]
                    candidates = [
                        (root_endpoint, f"{root_endpoint}/api/v1/models"),
                        (root_endpoint, f"{root_endpoint}/v1/models"),
                        (root_endpoint, f"{root_endpoint}/models"),
                    ]
                else:
                    candidates = [(endpoint, f"{endpoint}/models")]
                response = None
                headers = _provider_auth_headers(config, provider)
                for candidate_endpoint, models_url in candidates:
                    response = await client.get(models_url, headers=headers)
                    data = response.json() if response.text else {}
                    raw_models = (data.get("data") or data.get("models") or []) if isinstance(data, dict) else []
                    models_found = [_normalize_model_item(provider, item, "detected") for item in raw_models]
                    if response.status_code < 400 and models_found:
                        # Keep the configured inference endpoint. LM Studio's
                        # native API is only used to discover loaded metadata.
                        if provider != "lm-studio":
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
                    response = await client.post(f"{engine_url}/agent-health", params={"driver": "opencode"}, json={"provider": config.get("provider"), "model": config.get("model"), "provider_api_key": (provider_payload or {}).get("provider_api_key")})
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

    if provider_payload:
        token = os.getenv("AI_ENGINE_INTERNAL_TOKEN", "").strip()
        token_file = os.getenv("AI_ENGINE_INTERNAL_TOKEN_FILE", "").strip()
        if not token and token_file:
            try:
                token = Path(token_file).read_text(encoding="utf-8").strip()
            except OSError as exc:
                return {
                    "status": "error",
                    "detail": f"No se pudo leer token interno del Motor IA: {_safe_ai_monitor_detail(exc)}",
                    "engine": health_payload,
                }
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
        headers = {"X-Engine-Internal-Token": token} if token else {}
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
