from .legacy_common import *


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
            node = models.AiWorkflowNode(
                id=_default_workflow_uuid(f"default-node-{item['key']}"),
                workflow_id=workflow.id,
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
    result = await db.execute(
        select(models.AiWorkflow)
        .options(
            selectinload(models.AiWorkflow.nodes).selectinload(models.AiWorkflowNode.prompt_versions),
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
        node = models.AiWorkflowNode(
            id=node_id,
            workflow_id=workflow.id,
            type=item.type,
            name=item.name,
            agent_key=item.agent_key,
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
            condition_type=item.condition_type,
            condition_json=item.condition_json or {},
            priority=item.priority,
            max_passes=item.max_passes,
        ))


async def create_ai_workflow(db: AsyncSession, payload: schemas.AiWorkflowCreate, user_id: Optional[UUID]) -> models.AiWorkflow:
    workflow = models.AiWorkflow(
        name=payload.name,
        version=payload.version,
        status=payload.status,
        is_default=payload.is_default,
        created_by=user_id,
    )
    db.add(workflow)
    await db.flush()
    await _replace_workflow_graph(db, workflow, payload.nodes, payload.edges, user_id, payload.changelog or "Workflow creado")
    await db.flush()
    await db.commit()
    return await get_ai_workflow(db, workflow.id)


async def update_ai_workflow(db: AsyncSession, workflow_id: UUID, payload: schemas.AiWorkflowUpdate, user_id: Optional[UUID]) -> models.AiWorkflow:
    workflow = await get_ai_workflow(db, workflow_id)
    if payload.name is not None:
        workflow.name = payload.name
    if payload.version is not None:
        workflow.version = payload.version
    if payload.status is not None:
        workflow.status = payload.status
    if payload.is_default is not None:
        workflow.is_default = payload.is_default
    if payload.nodes is not None or payload.edges is not None:
        await _replace_workflow_graph(db, workflow, payload.nodes or [], payload.edges or [], user_id, payload.changelog or "Guardado draft")
    await db.flush()
    await db.commit()
    return await get_ai_workflow(db, workflow_id)


async def duplicate_ai_workflow(db: AsyncSession, workflow_id: UUID, user_id: Optional[UUID]) -> models.AiWorkflow:
    source = await get_ai_workflow(db, workflow_id)
    workflow = models.AiWorkflow(
        name=f"{source.name} copia",
        version=max(1, source.version),
        status="DRAFT",
        is_default=False,
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
            condition_type=source_edge.condition_type,
            condition_json=source_edge.condition_json or {},
            priority=source_edge.priority,
            max_passes=source_edge.max_passes,
        ))
    await db.flush()
    await db.commit()
    return await get_ai_workflow(db, workflow.id)


async def archive_ai_workflow(db: AsyncSession, workflow_id: UUID) -> models.AiWorkflow:
    workflow = await get_ai_workflow(db, workflow_id)
    if workflow.is_default:
        raise ValueError("No se puede archivar el workflow default")
    workflow.status = "ARCHIVED"
    await db.commit()
    return await get_ai_workflow(db, workflow_id)


async def restore_default_ai_workflow(db: AsyncSession, workflow_id: UUID, user_id: Optional[UUID]) -> models.AiWorkflow:
    workflow = await get_ai_workflow(db, workflow_id)
    workflow.name = "QA Agent Workflow Default"
    workflow.version = max(1, workflow.version + 1)
    workflow.status = "ACTIVE"
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
    await db.commit()
    return await get_ai_workflow(db, workflow_id)
