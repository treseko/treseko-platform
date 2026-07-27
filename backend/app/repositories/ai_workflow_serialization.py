from .repository_context import *

def _node_payload(node: models.AiWorkflowNode, include_versions: bool = True) -> Dict[str, Any]:
    payload = {
        "id": str(node.id),
        "workflow_id": str(node.workflow_id),
        "type": node.type,
        "name": node.name,
        "agent_key": node.agent_key,
        "agent_definition_id": str(node.agent_definition_id) if node.agent_definition_id else None,
        "universal_agent_version_id": str(node.universal_agent_version_id) if node.universal_agent_version_id else None,
        "enabled": bool(node.enabled),
        "locked": bool(node.locked),
        "prompt_template": node.prompt_template or "",
        "config_json": node.config_json or {},
        "position_x": node.position_x or 0,
        "position_y": node.position_y or 0,
        "retry_policy": node.retry_policy or {},
        "timeout_sec": node.timeout_sec or 60,
        "model_override": node.model_override,
        "temperature_override": node.temperature_override,
    }
    if include_versions:
        payload["prompt_versions"] = [
            {
                "id": str(version.id),
                "node_id": str(version.node_id),
                "version": version.version,
                "prompt_template": version.prompt_template,
                "changelog": version.changelog,
                "created_by": str(version.created_by) if version.created_by else None,
                "created_at": isoformat_utc(version.created_at),
            }
            for version in sorted(node.prompt_versions or [], key=lambda item: item.version)
        ]
    if node.universal_agent_version:
        payload["universal_agent"] = {
            "version_id": str(node.universal_agent_version.id),
            "version": node.universal_agent_version.version,
            "status": node.universal_agent_version.status,
            "contract": node.universal_agent_version.contract_json or {},
            "contract_hash": node.universal_agent_version.contract_hash,
        }
    return payload


def _edge_payload(edge: models.AiWorkflowEdge) -> Dict[str, Any]:
    return {
        "id": str(edge.id),
        "workflow_id": str(edge.workflow_id),
        "source_node_id": str(edge.source_node_id),
        "target_node_id": str(edge.target_node_id),
        "source_handle": edge.source_handle,
        "target_handle": edge.target_handle,
        "condition_type": edge.condition_type,
        "condition_json": edge.condition_json or {},
        "priority": edge.priority or 0,
        "max_passes": edge.max_passes or 1,
        "data_mapping_json": edge.data_mapping_json or [],
    }


def _workflow_payload(workflow: models.AiWorkflow) -> Dict[str, Any]:
    return {
        "id": str(workflow.id),
        "name": workflow.name,
        "version": workflow.version,
        "status": workflow.status,
        "is_default": bool(workflow.is_default),
        "workflow_format": workflow.workflow_format or "legacy_v1",
        "workflow_purpose": workflow.workflow_purpose or "test_execution",
        "source_workflow_id": str(workflow.source_workflow_id) if workflow.source_workflow_id else None,
        "provider_profile_id": str(workflow.provider_profile_id) if workflow.provider_profile_id else None,
        "fallback_profile_ids": workflow.fallback_profile_ids or [],
        "decision_policy_json": workflow.decision_policy_json or {},
        "created_by": str(workflow.created_by) if workflow.created_by else None,
        "created_at": isoformat_utc(workflow.created_at),
        "updated_at": isoformat_utc(workflow.updated_at),
    }


def _workflow_definition(workflow: models.AiWorkflow) -> Dict[str, Any]:
    return {
        "workflow": _workflow_payload(workflow),
        "nodes": [_node_payload(node) for node in sorted(workflow.nodes or [], key=lambda item: (item.position_x, item.position_y, item.name))],
        "edges": [_edge_payload(edge) for edge in sorted(workflow.edges or [], key=lambda item: (item.priority, item.condition_type))],
    }


def _legacy_agent_workflow_from_definition(definition: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not definition:
        return DEFAULT_AI_AGENT_WORKFLOW
    # Block and universal graphs reuse the same audited core handlers. Their
    # keys are namespaced for graph identity, but the step runner consumes the
    # legacy core IDs. Without this normalization it silently falls back to
    # defaults and discards the copied retry/prompt/configuration policy.
    def core_key(node: Dict[str, Any]) -> str:
        value = str(node.get("agent_key") or "").upper()
        for prefix in ("UNIVERSAL_", "BLOCK_"):
            if value.startswith(prefix):
                value = value[len(prefix):]
        aliases = {"PLANNER": "AI_AGENT", "SECURITY_GUARD": "QA_GUARD", "EXECUTOR": "SENTINEL"}
        return aliases.get(value, value)

    by_agent = {core_key(node): node for node in definition.get("nodes", [])}
    legacy = []
    for preset in DEFAULT_AI_AGENT_WORKFLOW:
        node = by_agent.get(preset["id"])
        legacy.append({
            **preset,
            "enabled": bool(node.get("enabled", preset["enabled"])) if node else preset["enabled"],
            "locked": bool(node.get("locked", preset["locked"])) if node else preset["locked"],
            "prompt": node.get("prompt_template", preset["prompt"]) if node else preset["prompt"],
            "retry_limit": int((node.get("retry_policy") or {}).get("max_retries", preset.get("retry_limit", 0))) if node else preset.get("retry_limit", 0),
            # The execution engine receives this legacy projection. Preserve
            # per-node policy switches so a published workflow changes runtime
            # behavior instead of only changing its visual graph.
            "config": node.get("config_json") or {} if node else {},
        })
    return legacy


async def _load_workflow(db: AsyncSession, workflow_id: UUID) -> Optional[models.AiWorkflow]:
    result = await db.execute(
        select(models.AiWorkflow)
        .options(
            selectinload(models.AiWorkflow.nodes).selectinload(models.AiWorkflowNode.prompt_versions),
            selectinload(models.AiWorkflow.nodes).selectinload(models.AiWorkflowNode.agent_definition),
            selectinload(models.AiWorkflow.nodes).selectinload(models.AiWorkflowNode.universal_agent_version).selectinload(models.AiUniversalAgentVersion.agent),
            selectinload(models.AiWorkflow.edges),
        )
        .filter(models.AiWorkflow.id == workflow_id)
    )
    return result.scalar_one_or_none()


async def _next_workflow_version(db: AsyncSession, workflow_id: UUID) -> int:
    result = await db.execute(
        select(func.max(models.AiWorkflowVersion.version)).filter(models.AiWorkflowVersion.workflow_id == workflow_id)
    )
    return int(result.scalar_one_or_none() or 0) + 1
