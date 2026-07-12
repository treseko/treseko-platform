from .legacy_common import *
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
    value = (provider or "openai-compatible").lower()
    endpoint_value = (endpoint or "").lower()
    if "127.0.0.1:1234" in endpoint_value or "localhost:1234" in endpoint_value:
        return "lm-studio"
    return value


def _model_capabilities_from_name(model_id: str, source: str = "detected") -> Dict[str, Any]:
    value = (model_id or "").lower()
    vision = any(token in value for token in ["vision", "vl", "llava", "pixtral", "qwen2.5-vl", "gemma-3", "gemma-4"])
    reasoning = any(token in value for token in ["reason", "r1", "o1", "o3", "thinking", "qwq", "deepseek"])
    tools = any(token in value for token in ["gpt", "claude", "gemini", "qwen", "llama-3.1", "llama-3.2", "llama-3.3", "mistral", "command"])
    context_window = 0
    for pattern, size in [("1m", 1000000), ("128k", 128000), ("64k", 64000), ("32k", 32000), ("16k", 16000), ("8k", 8000)]:
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
    scanned_at = utc_now()
    models_found: List[Dict[str, Any]] = []
    status = "ok"
    detail = None

    if provider in AI_PROVIDER_PRESET_MODELS:
        models_found = [_normalize_model_item(provider, item, "preset") for item in AI_PROVIDER_PRESET_MODELS[provider]]
        models_found = [item for item in models_found if item]
        return {
            "status": status,
            "detail": "Catalogo preset local; no se consultaron secretos ni API remotas.",
            "provider": provider,
            "llm_endpoint": endpoint or None,
            "models": models_found,
            "scanned_at": scanned_at,
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
                for candidate_endpoint, models_url in candidates:
                    response = await client.get(models_url)
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
    }


async def check_ai_engine_health(db: AsyncSession):
    engine_url = ENGINE_URL.rstrip("/")
    config = await get_ai_engine_config(db)
    llm_endpoint = str(config.get("llm_endpoint") or "").rstrip("/")
    model = config.get("model") or DEFAULT_AI_ENGINE_CONFIG["model"]
    provider = config.get("provider") or "openai-compatible"
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

    if provider in {"openai", "openai-compatible"}:
        if not llm_endpoint:
            return {
                "status": "error",
                "detail": "Endpoint LLM no configurado",
                "engine": health_payload,
            }
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                llm_response = await client.post(
                    f"{llm_endpoint}/chat/completions",
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": "ping"}],
                        "max_tokens": 5,
                    },
                )
            llm_data = llm_response.json() if llm_response.text else {}
            health_payload["llm"] = {
                "endpoint": llm_endpoint,
                "model": model,
                "status_code": llm_response.status_code,
                "model_response": llm_data.get("model") if isinstance(llm_data, dict) else None,
            }
            if llm_response.status_code >= 400:
                detail = llm_data.get("error") if isinstance(llm_data, dict) else llm_response.text[:300]
                return {
                    "status": "error",
                    "detail": (
                        f"LM Studio/LLM rechazo la verificacion: HTTP {llm_response.status_code} "
                        f"{_safe_ai_monitor_detail(detail)}"
                    ),
                    "engine": health_payload,
                }
        except Exception as exc:
            health_payload["llm"] = {
                "endpoint": llm_endpoint,
                "model": model,
            }
            return {
                "status": "error",
                "detail": f"No se pudo conectar con LM Studio/LLM: {_safe_ai_monitor_detail(exc)}",
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
    target: Optional[str] = None,
    latency_ms: Optional[int] = None,
    detail: Optional[str] = None,
):
    return {
        "id": component_id,
        "name": name,
        "type": component_type,
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
        await db.execute(text("SELECT 1"))
        return _monitor_component(
            "database",
            "PostgreSQL / Base de datos",
            "DATABASE",
            "ONLINE",
            target=os.getenv("DATABASE_URL", "").split("@")[-1] or "DATABASE_URL",
            latency_ms=int((asyncio.get_running_loop().time() - started) * 1000),
            detail="SELECT 1 OK",
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
