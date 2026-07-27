from .repository_context import *
from .ai_agent_definitions import definition_by_key, ensure_ai_agent_definitions
from .ai_universal_agents import ensure_legacy_universal_adapter
from .ai_workflow_validation import validate_workflow_graph


async def create_ai_workflow_version(
    db: AsyncSession,
    workflow: models.AiWorkflow,
    changelog: str,
    user_id: Optional[UUID],
    restored_from_version: Optional[int] = None,
) -> models.AiWorkflowVersion:
    loaded = await _load_workflow(db, workflow.id)
    if not loaded:
        raise ValueError("Workflow IA no encontrado")
    next_version = await _next_workflow_version(db, workflow.id)
    loaded.version = next_version
    snapshot = await export_ai_workflow(db, workflow.id, include_versions=False)
    version = models.AiWorkflowVersion(
        workflow_id=workflow.id,
        version=next_version,
        snapshot_json=snapshot,
        changelog=(changelog or "Workflow actualizado").strip() or "Workflow actualizado",
        restored_from_version=restored_from_version,
        created_by=user_id,
    )
    db.add(version)
    await db.flush()
    return version


async def _next_prompt_version(db: AsyncSession, node_id: UUID) -> int:
    result = await db.execute(
        select(func.max(models.AiPromptVersion.version)).filter(models.AiPromptVersion.node_id == node_id)
    )
    return int(result.scalar_one_or_none() or 0) + 1


async def _create_official_prompt_versions(
    db: AsyncSession,
    workflow: models.AiWorkflow,
    changelog: str,
    user_id: Optional[UUID],
):
    loaded = await _load_workflow(db, workflow.id)
    if not loaded:
        raise ValueError("Workflow IA no encontrado")
    for node in loaded.nodes or []:
        current_prompt = node.prompt_template or ""
        latest = sorted(node.prompt_versions or [], key=lambda row: row.version)[-1:] or []
        if latest and (latest[0].prompt_template or "") == current_prompt:
            continue
        db.add(models.AiPromptVersion(
            node_id=node.id,
            version=await _next_prompt_version(db, node.id),
            prompt_template=current_prompt,
            changelog=changelog,
            created_by=user_id,
        ))
    await db.flush()


async def publish_ai_workflow_version(
    db: AsyncSession,
    workflow_id: UUID,
    changelog: str,
    user_id: Optional[UUID],
    restored_from_version: Optional[int] = None,
) -> models.AiWorkflowVersion:
    if not (changelog or "").strip():
        raise ValueError("El changelog es obligatorio para publicar una version")
    workflow = await get_ai_workflow(db, workflow_id)
    await _create_official_prompt_versions(db, workflow, changelog.strip(), user_id)
    version = await create_ai_workflow_version(db, workflow, changelog.strip(), user_id, restored_from_version=restored_from_version)
    await db.commit()
    return version


async def ensure_default_ai_workflow(db: AsyncSession, created_by: Optional[UUID] = None) -> models.AiWorkflow:
    await ensure_ai_agent_definitions(db)
    default_id = _default_workflow_uuid("qa-agent-workflow-default")
    workflow = await _load_workflow(db, default_id)
    if not workflow:
        workflow = models.AiWorkflow(
            id=default_id,
            name="QA Agent Workflow Default",
            version=1,
            status="ACTIVE",
            is_default=True,
            created_by=created_by,
        )
        db.add(workflow)
        await db.flush()
        nodes_by_key: Dict[str, models.AiWorkflowNode] = {}
        for item in DEFAULT_AI_WORKFLOW_NODES:
            definition = await definition_by_key(db, item["agent_key"])
            node = models.AiWorkflowNode(
                id=_default_workflow_uuid(f"default-node-{item['key']}"),
                workflow_id=workflow.id,
                type=item["type"],
                name=item["name"],
                agent_key=item["agent_key"],
                agent_definition_id=definition.id if definition else None,
                enabled=True,
                locked=True,
                prompt_template=item.get("prompt_template") or "",
                config_json=item.get("config_json") or {},
                position_x=item["position_x"],
                position_y=item["position_y"],
                retry_policy=item.get("retry_policy") or {},
                timeout_sec=item.get("timeout_sec") or 60,
            )
            db.add(node)
            nodes_by_key[item["key"]] = node
            db.add(models.AiPromptVersion(
                node_id=node.id,
                version=1,
                prompt_template=node.prompt_template,
                changelog="Seed default workflow",
                created_by=created_by,
            ))
        await db.flush()
        for index, (source, target, condition, condition_json, priority, max_passes) in enumerate(DEFAULT_AI_WORKFLOW_EDGES, start=1):
            db.add(models.AiWorkflowEdge(
                id=_default_workflow_uuid(f"default-edge-{index}-{source}-{target}-{condition}"),
                workflow_id=workflow.id,
                source_node_id=nodes_by_key[source].id,
                target_node_id=nodes_by_key[target].id,
                condition_type=condition,
                condition_json=condition_json,
                priority=priority,
                max_passes=max_passes,
            ))
        await db.flush()
        await create_ai_workflow_version(db, workflow, "Seed default workflow", created_by)
        await db.commit()
        workflow = await _load_workflow(db, default_id)

    config = await get_ai_engine_config(db)
    existing_versions = await list_ai_workflow_versions(db, workflow.id)
    if not existing_versions:
        await create_ai_workflow_version(db, workflow, "Snapshot inicial de workflow existente", created_by)
        await db.commit()
    if not config.get("active_workflow_id"):
        config["active_workflow_id"] = workflow.id
        config["agent_workflow"] = _legacy_agent_workflow_from_definition(_workflow_definition(workflow))
        result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == AI_ENGINE_CONFIG_KEY))
        setting = result.scalar_one_or_none()
        if setting:
            setting.value = _json_safe(config)
        else:
            db.add(models.AppSetting(key=AI_ENGINE_CONFIG_KEY, value=_json_safe(config)))
        await db.commit()
    return workflow


async def list_ai_workflows(db: AsyncSession) -> List[models.AiWorkflow]:
    await ensure_default_ai_workflow(db)
    from .ai_builtin_workflows import ensure_builtin_workflow_catalog
    await ensure_builtin_workflow_catalog(db)
    result = await db.execute(
        select(models.AiWorkflow)
        .options(
            selectinload(models.AiWorkflow.nodes).selectinload(models.AiWorkflowNode.prompt_versions),
            selectinload(models.AiWorkflow.nodes).selectinload(models.AiWorkflowNode.universal_agent_version),
            selectinload(models.AiWorkflow.edges),
        )
        .order_by(models.AiWorkflow.is_default.desc(), models.AiWorkflow.updated_at.desc())
    )
    return result.scalars().all()


async def get_ai_workflow(db: AsyncSession, workflow_id: UUID) -> models.AiWorkflow:
    workflow = await _load_workflow(db, workflow_id)
    if not workflow:
        raise ValueError("Workflow IA no encontrado")
    return workflow


async def _replace_workflow_graph(
    db: AsyncSession,
    workflow: models.AiWorkflow,
    nodes: List[schemas.AiWorkflowNodeBase],
    edges: List[schemas.AiWorkflowEdgeBase],
    user_id: Optional[UUID],
    changelog: str = "Workflow graph update",
    persist_prompt_versions: bool = False,
):
    existing = await _load_workflow(db, workflow.id)
    prompt_history: Dict[UUID, List[Dict[str, Any]]] = {}
    current_prompts: Dict[UUID, str] = {}
    if existing:
        for node in existing.nodes or []:
            current_prompts[node.id] = node.prompt_template or ""
            prompt_history[node.id] = [
                {
                    "version": item.version,
                    "prompt_template": item.prompt_template,
                    "changelog": item.changelog,
                    "created_by": item.created_by,
                }
                for item in sorted(node.prompt_versions or [], key=lambda row: row.version)
            ]
    await db.execute(delete(models.AiWorkflowEdge).where(models.AiWorkflowEdge.workflow_id == workflow.id))
    await db.execute(delete(models.AiWorkflowNode).where(models.AiWorkflowNode.workflow_id == workflow.id))
    await db.flush()
    node_ids = set()
    for item in nodes:
        node_id = item.id or uuid.uuid4()
        node_ids.add(node_id)
        definition = None
        if item.agent_definition_id:
            definition = (await db.execute(select(models.AiAgentDefinition).filter(models.AiAgentDefinition.id == item.agent_definition_id))).scalar_one_or_none()
        if not definition:
            definition = await definition_by_key(db, item.agent_key)
        node = models.AiWorkflowNode(
            id=node_id,
            workflow_id=workflow.id,
            type=item.type,
            name=item.name,
            agent_key=item.agent_key,
            agent_definition_id=definition.id if definition else item.agent_definition_id,
            universal_agent_version_id=item.universal_agent_version_id,
            enabled=item.enabled,
            locked=item.locked,
            prompt_template=item.prompt_template or "",
            config_json=item.config_json or {},
            position_x=item.position_x,
            position_y=item.position_y,
            retry_policy=item.retry_policy or {},
            timeout_sec=item.timeout_sec,
            model_override=item.model_override,
            temperature_override=item.temperature_override,
        )
        db.add(node)
        previous_versions = prompt_history.get(node.id, [])
        for old_version in previous_versions:
            db.add(models.AiPromptVersion(
                node_id=node.id,
                version=old_version["version"],
                prompt_template=old_version["prompt_template"],
                changelog=old_version["changelog"],
                created_by=old_version["created_by"],
            ))
        if not previous_versions:
            db.add(models.AiPromptVersion(
                node_id=node.id,
                version=1,
                prompt_template=node.prompt_template,
                changelog=changelog or "Prompt inicial",
                created_by=user_id,
            ))
        elif persist_prompt_versions and current_prompts.get(node.id, "") != node.prompt_template:
            db.add(models.AiPromptVersion(
                node_id=node.id,
                version=(max([item["version"] for item in previous_versions], default=0) + 1),
                prompt_template=node.prompt_template,
                changelog=changelog or "Prompt publicado",
                created_by=user_id,
            ))
    await db.flush()
    for item in edges:
        if item.source_node_id not in node_ids or item.target_node_id not in node_ids:
            raise ValueError("Una conexion referencia un nodo inexistente")
        db.add(models.AiWorkflowEdge(
            id=item.id or uuid.uuid4(),
            workflow_id=workflow.id,
            source_node_id=item.source_node_id,
            target_node_id=item.target_node_id,
            source_handle=item.source_handle,
            target_handle=item.target_handle,
            condition_type=item.condition_type,
            condition_json=item.condition_json or {},
            priority=item.priority,
            max_passes=item.max_passes,
            data_mapping_json=item.data_mapping_json or [],
        ))


async def create_ai_workflow(db: AsyncSession, payload: schemas.AiWorkflowCreate, user_id: Optional[UUID]) -> models.AiWorkflow:
    await ensure_ai_agent_definitions(db)
    if str(payload.status).upper() not in {"DRAFT", "INVALID"}:
        raise ValueError("Los workflows nuevos deben crearse como borrador; publica y activa una version despues.")
    workflow = models.AiWorkflow(
        name=payload.name,
        version=payload.version,
        status=payload.status,
        is_default=payload.is_default,
        workflow_format=payload.workflow_format,
        workflow_purpose=payload.workflow_purpose,
        source_workflow_id=payload.source_workflow_id,
        provider_profile_id=payload.provider_profile_id,
        fallback_profile_ids=[str(item) for item in payload.fallback_profile_ids],
        decision_policy_json=payload.decision_policy_json,
        created_by=user_id,
    )
    db.add(workflow)
    await db.flush()
    await _replace_workflow_graph(db, workflow, payload.nodes, payload.edges, user_id, payload.changelog or "Workflow creado")
    await db.flush()
    issues = await validate_workflow_graph(db, workflow)
    if workflow.status == "DRAFT" and any(issue["severity"] == "error" for issue in issues):
        workflow.status = "INVALID"
    await db.commit()
    return await get_ai_workflow(db, workflow.id)


async def update_ai_workflow(db: AsyncSession, workflow_id: UUID, payload: schemas.AiWorkflowUpdate, user_id: Optional[UUID]) -> models.AiWorkflow:
    workflow = await get_ai_workflow(db, workflow_id)
    if workflow.status == "ACTIVE" and (payload.nodes is not None or payload.edges is not None):
        raise ValueError("No se puede editar el workflow activo directamente; crea o clona un borrador.")
    if payload.name is not None:
        workflow.name = payload.name
    if payload.version is not None:
        workflow.version = payload.version
    if payload.status is not None:
        if str(payload.status).upper() not in {"DRAFT", "ACTIVE", "ARCHIVED", "INVALID"}:
            raise ValueError("Estado de workflow invalido")
        if str(payload.status).upper() == "ACTIVE":
            raise ValueError("La activacion debe hacerse desde una version publicada.")
        workflow.status = payload.status
    if payload.is_default is not None:
        workflow.is_default = payload.is_default
    if payload.workflow_format is not None and payload.workflow_format != workflow.workflow_format:
        raise ValueError("El formato del workflow es inmutable; crea una copia para cambiar de generacion.")
    if payload.workflow_purpose is not None and payload.workflow_purpose != workflow.workflow_purpose:
        raise ValueError("El propósito del workflow es inmutable; crea un workflow dedicado.")
    if "provider_profile_id" in payload.model_fields_set:
        workflow.provider_profile_id = payload.provider_profile_id
    if payload.fallback_profile_ids is not None:
        workflow.fallback_profile_ids = [str(item) for item in payload.fallback_profile_ids]
    if payload.decision_policy_json is not None:
        workflow.decision_policy_json = payload.decision_policy_json
    if payload.nodes is not None or payload.edges is not None:
        await _replace_workflow_graph(db, workflow, payload.nodes or [], payload.edges or [], user_id, payload.changelog or "Guardado draft")
    await db.flush()
    issues = await validate_workflow_graph(db, workflow)
    if workflow.status == "DRAFT" and any(issue["severity"] == "error" for issue in issues):
        workflow.status = "INVALID"
    await db.commit()
    return await get_ai_workflow(db, workflow_id)


async def duplicate_ai_workflow(db: AsyncSession, workflow_id: UUID, user_id: Optional[UUID]) -> models.AiWorkflow:
    source = await get_ai_workflow(db, workflow_id)
    workflow = models.AiWorkflow(
        name=f"{source.name} copia",
        version=max(1, source.version),
        status="DRAFT",
        is_default=False,
        workflow_format=source.workflow_format or "legacy_v1",
        workflow_purpose=source.workflow_purpose or "test_execution",
        source_workflow_id=source.source_workflow_id,
        provider_profile_id=source.provider_profile_id,
        fallback_profile_ids=source.fallback_profile_ids or [],
        decision_policy_json=source.decision_policy_json or {},
        created_by=user_id,
    )
    db.add(workflow)
    await db.flush()
    id_map: Dict[UUID, UUID] = {}
    for source_node in source.nodes:
        new_id = uuid.uuid4()
        id_map[source_node.id] = new_id
        db.add(models.AiWorkflowNode(
            id=new_id,
            workflow_id=workflow.id,
            type=source_node.type,
            name=source_node.name,
            agent_key=source_node.agent_key,
            agent_definition_id=source_node.agent_definition_id,
            universal_agent_version_id=source_node.universal_agent_version_id,
            enabled=source_node.enabled,
            locked=False,
            prompt_template=source_node.prompt_template,
            config_json=source_node.config_json or {},
            position_x=source_node.position_x,
            position_y=source_node.position_y,
            retry_policy=source_node.retry_policy or {},
            timeout_sec=source_node.timeout_sec,
            model_override=source_node.model_override,
            temperature_override=source_node.temperature_override,
        ))
    await db.flush()
    for source_edge in source.edges:
        db.add(models.AiWorkflowEdge(
            workflow_id=workflow.id,
            source_node_id=id_map[source_edge.source_node_id],
            target_node_id=id_map[source_edge.target_node_id],
            source_handle=source_edge.source_handle,
            target_handle=source_edge.target_handle,
            condition_type=source_edge.condition_type,
            condition_json=source_edge.condition_json or {},
            priority=source_edge.priority,
            max_passes=source_edge.max_passes,
            data_mapping_json=source_edge.data_mapping_json or [],
        ))
    await db.flush()
    await db.commit()
    return await get_ai_workflow(db, workflow.id)


async def copy_ai_workflow_as_blocks(db: AsyncSession, workflow_id: UUID, user_id: Optional[UUID]) -> models.AiWorkflow:
    """Create a V2 draft without mutating the source graph or its history."""
    # Upsert the V2 catalog first so this route is safe immediately after an
    # upgrade, before a background/default-workflow bootstrap has run.
    await ensure_ai_agent_definitions(db)
    source = await get_ai_workflow(db, workflow_id)
    workflow = models.AiWorkflow(
        name=f"{source.name} - bloques",
        version=1,
        status="DRAFT",
        is_default=False,
        workflow_format="block_v2",
        workflow_purpose=source.workflow_purpose or "test_execution",
        source_workflow_id=source.id,
        provider_profile_id=source.provider_profile_id,
        fallback_profile_ids=list(source.fallback_profile_ids or []),
        decision_policy_json=dict(source.decision_policy_json or {}),
        created_by=user_id,
    )
    db.add(workflow)
    await db.flush()
    id_map: Dict[UUID, UUID] = {}
    for source_node in source.nodes:
        definition = await definition_by_key(db, f"BLOCK_{source_node.agent_key}") or await definition_by_key(db, source_node.agent_key)
        new_id = uuid.uuid4()
        id_map[source_node.id] = new_id
        config = {**(source_node.config_json or {}), "block_contract_version": "treseko.block/v1", "legacy_source_node_id": str(source_node.id)}
        db.add(models.AiWorkflowNode(
            id=new_id, workflow_id=workflow.id, type=source_node.type, name=source_node.name,
            agent_key=definition.key if definition else source_node.agent_key,
            agent_definition_id=definition.id if definition else source_node.agent_definition_id,
            universal_agent_version_id=source_node.universal_agent_version_id,
            enabled=source_node.enabled, locked=False, prompt_template=source_node.prompt_template,
            config_json=config, position_x=source_node.position_x, position_y=source_node.position_y,
            retry_policy=source_node.retry_policy or {}, timeout_sec=source_node.timeout_sec,
            model_override=source_node.model_override, temperature_override=source_node.temperature_override,
        ))
    await db.flush()
    for source_edge in source.edges:
        db.add(models.AiWorkflowEdge(
            workflow_id=workflow.id, source_node_id=id_map[source_edge.source_node_id], target_node_id=id_map[source_edge.target_node_id],
            source_handle=source_edge.source_handle, target_handle=source_edge.target_handle,
            condition_type=source_edge.condition_type, condition_json={**(source_edge.condition_json or {}), "contract": "cel-v1"},
            priority=source_edge.priority, max_passes=source_edge.max_passes,
            data_mapping_json=source_edge.data_mapping_json or [],
        ))
    await db.flush()
    await create_ai_workflow_version(db, workflow, f"Copia V2 creada desde {source.name}", user_id)
    await db.commit()
    return await get_ai_workflow(db, workflow.id)


async def copy_ai_workflow_as_universal(db: AsyncSession, workflow_id: UUID, user_id: Optional[UUID]) -> models.AiWorkflow:
    """Create an explicit Universal v2 draft while preserving the source graph."""
    source = await get_ai_workflow(db, workflow_id)
    if source.workflow_format == "universal_v2":
        return await duplicate_ai_workflow(db, workflow_id, user_id)
    workflow = models.AiWorkflow(
        name=f"{source.name} - universal",
        version=1,
        status="DRAFT",
        is_default=False,
        workflow_format="universal_v2",
        workflow_purpose=source.workflow_purpose or "test_execution",
        source_workflow_id=source.id,
        provider_profile_id=source.provider_profile_id,
        fallback_profile_ids=list(source.fallback_profile_ids or []),
        decision_policy_json=dict(source.decision_policy_json or {}),
        created_by=user_id,
    )
    db.add(workflow)
    await db.flush()
    id_map: Dict[UUID, UUID] = {}
    for source_node in source.nodes:
        universal_version = await ensure_legacy_universal_adapter(
            db,
            source_node.agent_key,
            source_node.name,
            source_node.agent_definition.description if source_node.agent_definition else source_node.name,
            user_id,
        )
        new_id = uuid.uuid4()
        id_map[source_node.id] = new_id
        db.add(models.AiWorkflowNode(
            id=new_id,
            workflow_id=workflow.id,
            type=source_node.type,
            name=source_node.name,
            agent_key=f"UNIVERSAL_{str(source_node.agent_key).removeprefix('BLOCK_')}",
            agent_definition_id=source_node.agent_definition_id,
            universal_agent_version_id=universal_version.id,
            enabled=source_node.enabled,
            locked=False,
            prompt_template=source_node.prompt_template,
            config_json={
                **(source_node.config_json or {}),
                "universal_contract_version": "treseko.universal-agent/v1",
                "legacy_source_node_id": str(source_node.id),
            },
            position_x=source_node.position_x,
            position_y=source_node.position_y,
            retry_policy=source_node.retry_policy or {},
            timeout_sec=source_node.timeout_sec,
            model_override=source_node.model_override,
            temperature_override=source_node.temperature_override,
        ))
    await db.flush()
    for source_edge in source.edges:
        db.add(models.AiWorkflowEdge(
            workflow_id=workflow.id,
            source_node_id=id_map[source_edge.source_node_id],
            target_node_id=id_map[source_edge.target_node_id],
            source_handle=source_edge.source_handle,
            target_handle=source_edge.target_handle,
            condition_type=source_edge.condition_type,
            condition_json=source_edge.condition_json or {},
            priority=source_edge.priority,
            max_passes=source_edge.max_passes,
            data_mapping_json=source_edge.data_mapping_json or [],
        ))
    await db.flush()
    await create_ai_workflow_version(db, workflow, f"Copia universal creada desde {source.name}", user_id)
    await db.commit()
    return await get_ai_workflow(db, workflow.id)


async def archive_ai_workflow(db: AsyncSession, workflow_id: UUID) -> models.AiWorkflow:
    workflow = await get_ai_workflow(db, workflow_id)
    if workflow.is_default:
        raise ValueError("No se puede archivar el workflow default")
    if workflow.status == "ACTIVE":
        raise ValueError("No se puede archivar el workflow activo; activa otro workflow primero.")
    workflow.status = "ARCHIVED"
    await db.commit()
    return await get_ai_workflow(db, workflow_id)


async def restore_default_ai_workflow(db: AsyncSession, workflow_id: UUID, user_id: Optional[UUID]) -> models.AiWorkflow:
    workflow = await get_ai_workflow(db, workflow_id)
    workflow.name = "QA Agent Workflow Default"
    workflow.version = max(1, workflow.version + 1)
    workflow.status = "DRAFT"
    workflow.is_default = True
    node_payloads = [
        schemas.AiWorkflowNodeBase(
            id=_default_workflow_uuid(f"restore-{workflow.id}-{item['key']}"),
            type=item["type"],
            name=item["name"],
            agent_key=item["agent_key"],
            enabled=True,
            locked=True,
            prompt_template=item.get("prompt_template") or "",
            config_json=item.get("config_json") or {},
            position_x=item["position_x"],
            position_y=item["position_y"],
            retry_policy=item.get("retry_policy") or {},
            timeout_sec=item.get("timeout_sec") or 60,
        )
        for item in DEFAULT_AI_WORKFLOW_NODES
    ]
    ids_by_key = {item["key"]: node_payloads[index].id for index, item in enumerate(DEFAULT_AI_WORKFLOW_NODES)}
    edge_payloads = [
        schemas.AiWorkflowEdgeBase(
            source_node_id=ids_by_key[source],
            target_node_id=ids_by_key[target],
            condition_type=condition,
            condition_json=condition_json,
            priority=priority,
            max_passes=max_passes,
        )
        for source, target, condition, condition_json, priority, max_passes in DEFAULT_AI_WORKFLOW_EDGES
    ]
    await _replace_workflow_graph(db, workflow, node_payloads, edge_payloads, user_id, "Restauracion de workflow default")
    await db.flush()
    issues = await validate_workflow_graph(db, workflow)
    if any(issue["severity"] == "error" for issue in issues):
        await db.rollback()
        raise ValueError("No se pudo restaurar el workflow default porque su grafo es invalido")
    active_workflows = (await db.execute(
        select(models.AiWorkflow).filter(
            models.AiWorkflow.status == "ACTIVE",
            models.AiWorkflow.workflow_purpose == workflow.workflow_purpose,
            models.AiWorkflow.id != workflow.id,
        )
    )).scalars().all()
    for active_workflow in active_workflows:
        active_workflow.status = "DRAFT"
    workflow.status = "ACTIVE"
    await create_ai_workflow_version(db, workflow, "Restauracion de workflow default", user_id)
    config = await get_ai_engine_config(db)
    active_workflow_ids = dict(config.get("active_workflow_ids") or {})
    active_workflow_ids[workflow.workflow_purpose] = workflow.id
    config["active_workflow_ids"] = active_workflow_ids
    if workflow.workflow_purpose == "test_execution":
        config["active_workflow_id"] = workflow.id
        config["agent_workflow"] = _legacy_agent_workflow_from_definition(_workflow_definition(await _load_workflow(db, workflow.id)))
    setting = (await db.execute(select(models.AppSetting).filter(models.AppSetting.key == AI_ENGINE_CONFIG_KEY))).scalar_one_or_none()
    if setting:
        setting.value = _json_safe(config)
    else:
        db.add(models.AppSetting(key=AI_ENGINE_CONFIG_KEY, value=_json_safe(config)))
    await db.commit()
    return await get_ai_workflow(db, workflow_id)
