from .repository_context import *
from .ai_agent_definitions import definition_by_key, ensure_ai_agent_definitions
from .ai_universal_agents import ensure_legacy_universal_adapter
from .ai_workflow_validation import is_valid_for_activation, validate_workflow_graph
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


_V3_PRIMARY_PORT_BY_TYPE = {
    "ContextResolver": "resolved",
    "PreExecutionAnalyst": "ready",
    "Observer": "observed",
    "Planner": "planned",
    "SecurityGuard": "allowed",
    "Executor": "executed",
    "Validator": "valid",
    "Recovery": "recovered",
    "Auditor": "audited",
    "Reporter": "reported",
}

_V3_ATOMIC_ADAPTER_BY_TYPE = {
    "ContextResolver": "qa-context-resolver/v2",
    "PreExecutionAnalyst": "qa-pre-execution-analyst/v2",
    "Observer": "qa-browser-observer/v2",
    "Planner": "qa-action-planner/v2",
    "SecurityGuard": "qa-security-guard/v2",
    "Executor": "qa-browser-action-executor/v2",
    "Validator": "qa-step-validator/v2",
    "Recovery": "qa-recovery-strategist/v2",
    "Auditor": "qa-final-auditor/v2",
    "Reporter": "qa-execution-reporter/v2",
}


def _contract_ports(node: models.AiWorkflowNode, direction: str) -> list[str]:
    version = node.universal_agent_version
    contract = version.contract_json if version and isinstance(version.contract_json, dict) else {}
    ports = (contract.get("ports") or {}).get(direction) or []
    return [str(item) for item in ports if isinstance(item, str) and item]


def _v3_source_port(node: models.AiWorkflowNode, edge: models.AiWorkflowEdge) -> str:
    declared = _contract_ports(node, "control_outputs")
    explicit = str(edge.source_handle or (edge.condition_json or {}).get("output_port") or (edge.condition_json or {}).get("value") or "").strip()
    if explicit and explicit in declared:
        return explicit
    condition = str(edge.condition_type or "always").lower()
    candidates = {
        "on_failed": ["failed"],
        "on_blocked": ["blocked"],
        "on_rejected": ["rejected", "blocked", "failed"],
        "retry_count_lt": ["recovered", "retry"],
    }.get(condition, [_V3_PRIMARY_PORT_BY_TYPE.get(str(node.type), "success"), "success"])
    selected = next((port for port in candidates if port in declared), None)
    if not selected:
        raise ValueError(f"No se puede migrar el nodo '{node.name}' a V3: la salida de {condition} no esta declarada.")
    return selected


async def copy_ai_workflow_as_universal_v3(db: AsyncSession, workflow_id: UUID, user_id: Optional[UUID]) -> models.AiWorkflow:
    """Create an isolated graph-authoritative V3 draft without mutating V1/V2."""
    source = await ai_workflows.get_ai_workflow(db, workflow_id)
    if source.workflow_format not in {"universal_v2", "universal_v3"}:
        raise ValueError("Universal V3 solo puede crearse desde un workflow universal V2/V3 validado.")
    source_issues = await validate_workflow_graph(db, source)
    if not is_valid_for_activation(source_issues):
        raise ValueError("El workflow universal fuente debe ser valido antes de crear un borrador V3.")

    workflow = models.AiWorkflow(
        name=f"{source.name} - universal V3",
        version=1,
        status="DRAFT",
        is_default=False,
        workflow_format="universal_v3",
        workflow_purpose=source.workflow_purpose or "test_execution",
        source_workflow_id=source.id,
        provider_profile_id=source.provider_profile_id,
        fallback_profile_ids=list(source.fallback_profile_ids or []),
        decision_policy_json={
            **(source.decision_policy_json or {}),
            "runtime_mode": "graph_native",
            "source_of_truth": "persisted_graph",
            "legacy_step_runner_allowed": False,
            "workflow_contract_version": "treseko.workflow/v3",
        },
        created_by=user_id,
    )
    db.add(workflow)
    await db.flush()

    enabled_ids = {node.id for node in source.nodes if node.enabled}
    incoming = {node_id: 0 for node_id in enabled_ids}
    for edge in source.edges:
        if edge.source_node_id in enabled_ids and edge.target_node_id in enabled_ids:
            incoming[edge.target_node_id] += 1
    starts = [node_id for node_id, count in incoming.items() if count == 0]
    if len(starts) != 1:
        raise ValueError("El workflow fuente debe tener exactamente un nodo inicial antes de crear V3.")

    id_map: Dict[UUID, UUID] = {}
    source_by_id = {node.id: node for node in source.nodes}
    for source_node in source.nodes:
        if not source_node.universal_agent_version_id or not source_node.universal_agent_version:
            raise ValueError(f"El nodo '{source_node.name}' no referencia una version universal inmutable.")
        new_id = uuid.uuid4()
        id_map[source_node.id] = new_id
        declared_outputs = _contract_ports(source_node, "control_outputs")
        preferred_port = _V3_PRIMARY_PORT_BY_TYPE.get(str(source_node.type), "success")
        primary_port = preferred_port if preferred_port in declared_outputs else ("success" if "success" in declared_outputs else (declared_outputs[0] if declared_outputs else ""))
        has_enabled_outgoing = any(
            edge.source_node_id == source_node.id and edge.target_node_id in enabled_ids
            for edge in source.edges
        )
        terminal_ports = [primary_port] if source_node.enabled and not has_enabled_outgoing and primary_port else []
        existing_adapter = str((source_node.config_json or {}).get("runtime_adapter") or "").strip()
        runtime_adapter = existing_adapter if existing_adapter.startswith("qa-") and existing_adapter.endswith("/v2") else _V3_ATOMIC_ADAPTER_BY_TYPE.get(str(source_node.type))
        if not runtime_adapter:
            raise ValueError(f"No existe un adaptador atomico V3 para el nodo '{source_node.name}'.")
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
            config_json={
                **(source_node.config_json or {}),
                "workflow_contract_version": "treseko.workflow/v3",
                "runtime_adapter": runtime_adapter,
                "terminal_ports": terminal_ports,
                "legacy_source_node_id": str(source_node.id),
            },
            position_x=source_node.position_x,
            position_y=source_node.position_y,
            retry_policy=source_node.retry_policy or {},
            timeout_sec=source_node.timeout_sec,
            model_override=None,
            temperature_override=source_node.temperature_override,
        ))
    await db.flush()

    for source_edge in source.edges:
        source_node = source_by_id[source_edge.source_node_id]
        target_node = source_by_id[source_edge.target_node_id]
        target_inputs = _contract_ports(target_node, "control_inputs")
        source_port = _v3_source_port(source_node, source_edge)
        condition_json = dict(source_edge.condition_json or {})
        condition_json["output_port"] = source_port
        db.add(models.AiWorkflowEdge(
            workflow_id=workflow.id,
            source_node_id=id_map[source_edge.source_node_id],
            target_node_id=id_map[source_edge.target_node_id],
            source_handle=source_port,
            target_handle=source_edge.target_handle or (target_inputs[0] if target_inputs else "input"),
            condition_type="output_port",
            condition_json=condition_json,
            priority=source_edge.priority,
            max_passes=source_edge.max_passes,
            data_mapping_json=source_edge.data_mapping_json or [],
        ))
    workflow.decision_policy_json = {
        **workflow.decision_policy_json,
        "entry_node_id": str(id_map[starts[0]]),
    }
    await db.flush()
    validation_issues = await validate_workflow_graph(db, workflow)
    if any(issue.get("severity") == "error" for issue in validation_issues):
        workflow.status = "INVALID"
    await ai_workflows.create_ai_workflow_version(db, workflow, f"Borrador Universal V3 creado desde {source.name}", user_id)
    await db.commit()
    return await ai_workflows.get_ai_workflow(db, workflow.id)
