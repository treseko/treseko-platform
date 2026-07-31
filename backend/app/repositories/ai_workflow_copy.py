from .repository_context import *
from .ai_agent_definitions import definition_by_key, ensure_ai_agent_definitions
from .ai_universal_agents import ensure_legacy_universal_adapter
from . import ai_workflows

async def copy_ai_workflow_as_blocks(db: AsyncSession, workflow_id: UUID, user_id: Optional[UUID]) -> models.AiWorkflow:
    """Create a V2 draft without mutating the source graph or its history."""
    # Upsert the V2 catalog first so this route is safe immediately after an
    # upgrade, before a background/default-workflow bootstrap has run.
    await ensure_ai_agent_definitions(db)
    source = await ai_workflows.get_ai_workflow(db, workflow_id)
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
    await ai_workflows.create_ai_workflow_version(db, workflow, f"Copia V2 creada desde {source.name}", user_id)
    await db.commit()
    return await ai_workflows.get_ai_workflow(db, workflow.id)


async def copy_ai_workflow_as_universal(db: AsyncSession, workflow_id: UUID, user_id: Optional[UUID]) -> models.AiWorkflow:
    """Create an explicit Universal v2 draft while preserving the source graph."""
    source = await ai_workflows.get_ai_workflow(db, workflow_id)
    if source.workflow_format == "universal_v2":
        return await ai_workflows.duplicate_ai_workflow(db, workflow_id, user_id)
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
    await ai_workflows.create_ai_workflow_version(db, workflow, f"Copia universal creada desde {source.name}", user_id)
    await db.commit()
    return await ai_workflows.get_ai_workflow(db, workflow.id)
