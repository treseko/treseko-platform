from .legacy_common import *

REDACTED_AI_EXPORT_SECRET = "[redacted]"
AI_EXPORT_SECRET_KEYS = {
    "api_key",
    "apikey",
    "authorization",
    "bearer",
    "client_secret",
    "credential",
    "credentials",
    "password",
    "secret",
    "token",
}


def _is_sensitive_export_key(key: Any) -> bool:
    normalized = str(key or "").lower().replace("-", "_").replace(" ", "_")
    return any(marker in normalized for marker in AI_EXPORT_SECRET_KEYS)


def _redact_ai_export_secrets(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: REDACTED_AI_EXPORT_SECRET if _is_sensitive_export_key(key) else _redact_ai_export_secrets(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact_ai_export_secrets(item) for item in value]
    return value


def _redact_ai_workflow_export_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    return _redact_ai_export_secrets(payload)


async def export_ai_workflow(db: AsyncSession, workflow_id: UUID, include_versions: bool = True) -> Dict[str, Any]:
    workflow = await get_ai_workflow(db, workflow_id)
    prompt_versions = []
    for node in workflow.nodes:
        for version in node.prompt_versions or []:
            prompt_versions.append({
                "id": str(version.id),
                "node_id": str(version.node_id),
                "version": version.version,
                "prompt_template": version.prompt_template,
                "changelog": version.changelog,
                "created_by": str(version.created_by) if version.created_by else None,
                "created_at": isoformat_utc(version.created_at),
            })
    export_payload = {
        "workflow": _workflow_payload(workflow),
        "nodes": [_node_payload(node, include_versions=False) for node in workflow.nodes],
        "edges": [_edge_payload(edge) for edge in workflow.edges],
        "prompt_versions": prompt_versions,
        "workflow_versions": [],
    }
    if include_versions:
        versions = await list_ai_workflow_versions(db, workflow_id)
        export_payload["workflow_versions"] = [
            {
                "id": str(item.id),
                "workflow_id": str(item.workflow_id),
                "version": item.version,
                "snapshot_json": item.snapshot_json or {},
                "changelog": item.changelog,
                "restored_from_version": item.restored_from_version,
                "created_by": str(item.created_by) if item.created_by else None,
                "created_at": isoformat_utc(item.created_at),
            }
            for item in versions
        ]
    return _redact_ai_workflow_export_payload(export_payload)


async def import_ai_workflow(db: AsyncSession, payload: schemas.AiWorkflowImport, user_id: Optional[UUID]) -> models.AiWorkflow:
    raw_workflow = payload.workflow or {}
    requested_id = raw_workflow.get("id")
    workflow_id = None
    if requested_id:
        try:
            candidate = UUID(str(requested_id))
            existing = await _load_workflow(db, candidate)
            workflow_id = candidate if not existing else None
        except (TypeError, ValueError):
            workflow_id = None
    workflow = models.AiWorkflow(
        id=workflow_id or uuid.uuid4(),
        name=str(raw_workflow.get("name") or "Workflow importado"),
        version=int(raw_workflow.get("version") or 1),
        status=str(raw_workflow.get("status") or "DRAFT"),
        is_default=False,
        created_by=user_id,
    )
    db.add(workflow)
    await db.flush()
    id_map: Dict[str, UUID] = {}
    node_payloads = []
    for raw_node in payload.nodes:
        old_id = str(raw_node.get("id") or uuid.uuid4())
        new_id = UUID(old_id) if workflow_id and raw_node.get("id") else uuid.uuid4()
        id_map[old_id] = new_id
        node_payloads.append(schemas.AiWorkflowNodeBase(
            id=new_id,
            type=str(raw_node.get("type") or "llm_agent"),
            name=str(raw_node.get("name") or raw_node.get("type") or "Agente"),
            agent_key=str(raw_node.get("agent_key") or raw_node.get("type") or "CUSTOM"),
            enabled=bool(raw_node.get("enabled", True)),
            locked=bool(raw_node.get("locked", False)),
            prompt_template=str(raw_node.get("prompt_template") or raw_node.get("prompt") or ""),
            config_json=raw_node.get("config_json") if isinstance(raw_node.get("config_json"), dict) else {},
            position_x=int(raw_node.get("position_x") or 0),
            position_y=int(raw_node.get("position_y") or 0),
            retry_policy=raw_node.get("retry_policy") if isinstance(raw_node.get("retry_policy"), dict) else {},
            timeout_sec=int(raw_node.get("timeout_sec") or 60),
            model_override=raw_node.get("model_override"),
            temperature_override=raw_node.get("temperature_override"),
        ))
    edge_payloads = []
    for raw_edge in payload.edges:
        source = id_map.get(str(raw_edge.get("source_node_id")))
        target = id_map.get(str(raw_edge.get("target_node_id")))
        if not source or not target:
            raise ValueError("El JSON importado contiene conexiones con nodos inexistentes")
        edge_payloads.append(schemas.AiWorkflowEdgeBase(
            id=UUID(str(raw_edge["id"])) if workflow_id and raw_edge.get("id") else None,
            source_node_id=source,
            target_node_id=target,
            condition_type=str(raw_edge.get("condition_type") or "always"),
            condition_json=raw_edge.get("condition_json") if isinstance(raw_edge.get("condition_json"), dict) else {},
            priority=int(raw_edge.get("priority") or 0),
            max_passes=max(1, int(raw_edge.get("max_passes") or 1)),
        ))
    await _replace_workflow_graph(db, workflow, node_payloads, edge_payloads, user_id, "Workflow importado")
    await db.flush()
    await db.commit()
    return await get_ai_workflow(db, workflow.id)


async def list_ai_workflow_versions(db: AsyncSession, workflow_id: UUID) -> List[models.AiWorkflowVersion]:
    result = await db.execute(
        select(models.AiWorkflowVersion)
        .filter(models.AiWorkflowVersion.workflow_id == workflow_id)
        .order_by(models.AiWorkflowVersion.version.desc())
    )
    return result.scalars().all()


async def get_ai_workflow_version(db: AsyncSession, workflow_id: UUID, version: int) -> models.AiWorkflowVersion:
    result = await db.execute(
        select(models.AiWorkflowVersion).filter(
            models.AiWorkflowVersion.workflow_id == workflow_id,
            models.AiWorkflowVersion.version == version,
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise ValueError("Version de workflow no encontrada")
    return item


def _workflow_payloads_from_snapshot(snapshot: Dict[str, Any]) -> tuple[List[schemas.AiWorkflowNodeBase], List[schemas.AiWorkflowEdgeBase]]:
    node_payloads = [
        schemas.AiWorkflowNodeBase(
            id=UUID(str(raw_node.get("id"))),
            type=str(raw_node.get("type") or "llm_agent"),
            name=str(raw_node.get("name") or "Agente"),
            agent_key=str(raw_node.get("agent_key") or raw_node.get("type") or "CUSTOM"),
            enabled=bool(raw_node.get("enabled", True)),
            locked=bool(raw_node.get("locked", False)),
            prompt_template=str(raw_node.get("prompt_template") or ""),
            config_json=raw_node.get("config_json") if isinstance(raw_node.get("config_json"), dict) else {},
            position_x=int(raw_node.get("position_x") or 0),
            position_y=int(raw_node.get("position_y") or 0),
            retry_policy=raw_node.get("retry_policy") if isinstance(raw_node.get("retry_policy"), dict) else {},
            timeout_sec=int(raw_node.get("timeout_sec") or 60),
            model_override=raw_node.get("model_override"),
            temperature_override=raw_node.get("temperature_override"),
        )
        for raw_node in snapshot.get("nodes", [])
        if raw_node.get("id")
    ]
    node_ids = {item.id for item in node_payloads}
    edge_payloads: List[schemas.AiWorkflowEdgeBase] = []
    for raw_edge in snapshot.get("edges", []):
        try:
            source = UUID(str(raw_edge.get("source_node_id")))
            target_node = UUID(str(raw_edge.get("target_node_id")))
        except (TypeError, ValueError):
            continue
        if source not in node_ids or target_node not in node_ids:
            continue
        edge_payloads.append(schemas.AiWorkflowEdgeBase(
            id=UUID(str(raw_edge["id"])) if raw_edge.get("id") else None,
            source_node_id=source,
            target_node_id=target_node,
            condition_type=str(raw_edge.get("condition_type") or "always"),
            condition_json=raw_edge.get("condition_json") if isinstance(raw_edge.get("condition_json"), dict) else {},
            priority=int(raw_edge.get("priority") or 0),
            max_passes=max(1, int(raw_edge.get("max_passes") or 1)),
        ))
    return node_payloads, edge_payloads


async def _has_running_ai_executions_for_workflow(db: AsyncSession, workflow_id: UUID) -> bool:
    result = await db.execute(
        select(models.EjecucionCaso)
        .filter(models.EjecucionCaso.estado_resultado == models.EstadoResultado.EJECUTANDO_AI)
    )
    for execution in result.scalars().all():
        report = execution.ai_report or {}
        if str(report.get("workflow_id") or "") == str(workflow_id):
            return True
    return False


async def activate_ai_workflow_version(
    db: AsyncSession,
    workflow_id: UUID,
    version: int,
    confirm_running: bool,
    user_id: Optional[UUID],
) -> models.AiWorkflow:
    if not confirm_running and await _has_running_ai_executions_for_workflow(db, workflow_id):
        raise ValueError("Existen ejecuciones RUNNING con este workflow; no se puede activar otra version sin confirmacion admin")
    workflow = await get_ai_workflow(db, workflow_id)
    target = await get_ai_workflow_version(db, workflow_id, version)
    snapshot = target.snapshot_json or {}
    node_payloads, edge_payloads = _workflow_payloads_from_snapshot(snapshot)
    meta = snapshot.get("workflow") or {}
    workflow.name = str(meta.get("name") or workflow.name)
    workflow.version = target.version
    workflow.status = "ACTIVE"
    await _replace_workflow_graph(db, workflow, node_payloads, edge_payloads, user_id, f"Activacion de version {version}")
    config = await get_ai_engine_config(db)
    config["active_workflow_id"] = workflow.id
    config["agent_workflow"] = _legacy_agent_workflow_from_definition(_workflow_definition(await _load_workflow(db, workflow.id)))
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == AI_ENGINE_CONFIG_KEY))
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = _json_safe(config)
    else:
        db.add(models.AppSetting(key=AI_ENGINE_CONFIG_KEY, value=_json_safe(config)))
    await db.commit()
    return await get_ai_workflow(db, workflow_id)


async def restore_ai_workflow_version_as_draft(
    db: AsyncSession,
    workflow_id: UUID,
    version: int,
    user_id: Optional[UUID],
) -> models.AiWorkflow:
    source_workflow = await get_ai_workflow(db, workflow_id)
    target = await get_ai_workflow_version(db, workflow_id, version)
    snapshot = target.snapshot_json or {}
    workflow_meta = snapshot.get("workflow") or {}
    workflow = models.AiWorkflow(
        name=f"{workflow_meta.get('name') or source_workflow.name} draft rollback v{version}",
        version=max(1, int(workflow_meta.get("version") or target.version)),
        status="DRAFT",
        is_default=False,
        created_by=user_id,
    )
    db.add(workflow)
    await db.flush()
    node_payloads, edge_payloads = _workflow_payloads_from_snapshot(snapshot)
    id_map: Dict[UUID, UUID] = {}
    cloned_nodes = []
    for node in node_payloads:
        new_id = uuid.uuid4()
        id_map[node.id] = new_id
        cloned_nodes.append(node.model_copy(update={"id": new_id, "locked": False}))
    cloned_edges = [
        edge.model_copy(update={
            "id": uuid.uuid4(),
            "source_node_id": id_map[edge.source_node_id],
            "target_node_id": id_map[edge.target_node_id],
        })
        for edge in edge_payloads
        if edge.source_node_id in id_map and edge.target_node_id in id_map
    ]
    await _replace_workflow_graph(db, workflow, cloned_nodes, cloned_edges, user_id, f"Rollback desde version {version}")
    await db.commit()
    return await get_ai_workflow(db, workflow.id)


async def rollback_ai_workflow_and_activate(
    db: AsyncSession,
    workflow_id: UUID,
    version: int,
    confirm_running: bool,
    user_id: Optional[UUID],
) -> models.AiWorkflow:
    if not confirm_running and await _has_running_ai_executions_for_workflow(db, workflow_id):
        raise ValueError("Existen ejecuciones RUNNING con este workflow; no se puede activar rollback sin confirmacion admin")
    workflow = await get_ai_workflow(db, workflow_id)
    target = await get_ai_workflow_version(db, workflow_id, version)
    node_payloads, edge_payloads = _workflow_payloads_from_snapshot(target.snapshot_json or {})
    await _replace_workflow_graph(db, workflow, node_payloads, edge_payloads, user_id, f"Rollback desde version {version}")
    workflow.status = "ACTIVE"
    await db.flush()
    await _create_official_prompt_versions(db, workflow, f"Rollback desde version {version}", user_id)
    await create_ai_workflow_version(db, workflow, f"Rollback desde version {version}", user_id, restored_from_version=version)
    config = await get_ai_engine_config(db)
    config["active_workflow_id"] = workflow.id
    config["agent_workflow"] = _legacy_agent_workflow_from_definition(_workflow_definition(await _load_workflow(db, workflow.id)))
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == AI_ENGINE_CONFIG_KEY))
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = _json_safe(config)
    else:
        db.add(models.AppSetting(key=AI_ENGINE_CONFIG_KEY, value=_json_safe(config)))
    await db.commit()
    return await get_ai_workflow(db, workflow_id)


DEFAULT_AI_AGENT_PRESETS = [
    {
        "name": "LLM Reviewer",
        "type": "llm_agent",
        "category": "analysis",
        "description": "Agente LLM generico para revisar estado, memoria e historial.",
        "prompt_template": "Analiza el input del workflow y responde AgentOutput JSON con status, reason, confidence y sharedMemoryPatch si corresponde.",
        "output_schema": {"required": ["status", "reason"]},
    },
    {
        "name": "Webhook Notifier",
        "type": "webhook_agent",
        "category": "integration",
        "description": "Envia el contexto del workflow a un endpoint permitido.",
        "config_json": {"method": "POST", "timeout_ms": 5000, "retries": 0, "allowlist": [], "allowed_headers": ["content-type"]},
        "output_schema": {"required": ["status"]},
    },
    {
        "name": "Script Decision",
        "type": "script_agent",
        "category": "automation",
        "description": "Evalua una decision simple con sandbox JS sin filesystem ni shell.",
        "config_json": {"script": "return { status: 'SUCCESS', reason: 'Script ejecutado', confidence: 90, events: [] }", "timeout_ms": 1000},
        "output_schema": {"required": ["status"]},
        "enabled": False,
    },
]


async def ensure_default_ai_agent_presets(db: AsyncSession, created_by: Optional[UUID] = None):
    for preset in DEFAULT_AI_AGENT_PRESETS:
        result = await db.execute(
            select(models.AiAgentPreset).filter(
                models.AiAgentPreset.name == preset["name"],
                models.AiAgentPreset.type == preset["type"],
            )
        )
        if result.scalar_one_or_none():
            continue
        db.add(models.AiAgentPreset(
            name=preset["name"],
            type=preset["type"],
            category=preset.get("category") or "custom",
            description=preset.get("description"),
            prompt_template=preset.get("prompt_template") or "",
            config_json=preset.get("config_json") or {},
            input_mapping=preset.get("input_mapping") or {},
            output_schema=preset.get("output_schema") or {},
            enabled=bool(preset.get("enabled", True)),
            created_by=created_by,
        ))
    await db.commit()


async def list_ai_agent_presets(db: AsyncSession) -> List[models.AiAgentPreset]:
    await ensure_default_ai_agent_presets(db)
    query = select(models.AiAgentPreset).filter(models.AiAgentPreset.enabled == True)
    if os.getenv("AI_SCRIPT_AGENT_ENABLED", "false").lower() not in {"1", "true", "yes", "on"}:
        query = query.filter(models.AiAgentPreset.type != "script_agent")
    result = await db.execute(query.order_by(models.AiAgentPreset.category, models.AiAgentPreset.name))
    return result.scalars().all()


async def create_ai_agent_preset(db: AsyncSession, payload: schemas.AiAgentPresetCreate, user_id: Optional[UUID]) -> models.AiAgentPreset:
    preset = models.AiAgentPreset(
        name=payload.name,
        type=payload.type,
        category=payload.category,
        description=payload.description,
        prompt_template=payload.prompt_template,
        config_json=payload.config_json,
        input_mapping=payload.input_mapping,
        output_schema=payload.output_schema,
        enabled=payload.enabled,
        created_by=user_id,
    )
    db.add(preset)
    await db.commit()
    await db.refresh(preset)
    return preset


async def update_ai_agent_preset(db: AsyncSession, preset_id: UUID, payload: schemas.AiAgentPresetUpdate) -> models.AiAgentPreset:
    result = await db.execute(select(models.AiAgentPreset).filter(models.AiAgentPreset.id == preset_id))
    preset = result.scalar_one_or_none()
    if not preset:
        raise ValueError("Preset de agente no encontrado")
    if preset.type == "script_agent" and os.getenv("AI_SCRIPT_AGENT_ENABLED", "false").lower() not in {"1", "true", "yes", "on"}:
        raise ValueError("script_agent esta deshabilitado")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(preset, field, value)
    await db.commit()
    await db.refresh(preset)
    return preset
