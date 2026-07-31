from .repository_context import *
from .ai_provider_catalog import AI_PROVIDER_KEY_ENV, AI_PROVIDER_NO_KEY, AI_PROVIDER_PRESET_MODELS
from .core_settings_ai_workflow_helpers import ai_provider_api_key_status, get_configured_ai_provider_api_key
from ..services.error_sanitizer import sanitize_external_error
from .ai_provider_profiles import resolve_ai_provider_credential


def _safe_ai_monitor_detail(value: object) -> str:
    return sanitize_external_error(value)

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
            # The managed process may need to start and load its provider
            # registry on the first request.
            async with httpx.AsyncClient(timeout=45) as client:
                headers = engine_internal_headers(current_correlation_id())
                response = await client.post(f"{engine_url}/opencode/providers", json={"provider_api_key": api_key}, headers=headers)
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
