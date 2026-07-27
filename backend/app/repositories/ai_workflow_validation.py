"""Server-side workflow graph validation."""

from __future__ import annotations

import os
from typing import Any, Dict, List
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models
from .ai_agent_definitions import ensure_ai_agent_definitions
from .ai_universal_agents import CAPABILITY_CATALOG, validate_universal_agent_contract


BLOCKING_STATUSES = {"experimental", "requires_configuration", "deprecated"}


def _issue(severity: str, code: str, message: str, node_id: UUID | None = None, edge_id: UUID | None = None) -> Dict[str, Any]:
    return {"severity": severity, "code": code, "message": message, "node_id": node_id, "edge_id": edge_id}


def _model_capabilities(config: Dict[str, Any], model_id: str) -> Dict[str, Any]:
    """Resolve capabilities from the scanned catalog before falling back to config."""
    for item in config.get("model_catalog") or []:
        if isinstance(item, dict) and str(item.get("id") or "") == model_id:
            capabilities = item.get("capabilities")
            if isinstance(capabilities, dict):
                return capabilities
    configured = config.get("model_capabilities") or {}
    if isinstance(configured, dict):
        scoped = configured.get(model_id)
        if isinstance(scoped, dict):
            return scoped
        if all(not isinstance(value, dict) for value in configured.values()):
            return configured
    return {}


async def _workflow_engine_config(db: AsyncSession) -> Dict[str, Any]:
    """Read only the settings needed by validation without importing CRUD modules."""
    setting = (await db.execute(select(models.AppSetting).filter(models.AppSetting.key == "ai_engine"))).scalar_one_or_none()
    value = setting.value if setting and isinstance(setting.value, dict) else {}
    return {
        "model": os.getenv("AI_MODEL", "google/gemma-4-e4b"),
        "timeout_seconds": 900,
        **value,
    }


def _configuration_issues(definition: models.AiAgentDefinition, node: models.AiWorkflowNode) -> List[Dict[str, Any]]:
    config = node.config_json or {}
    schema = definition.config_schema_json or {}
    issues: List[Dict[str, Any]] = []
    for field in schema.get("required") or []:
        if config.get(field) in (None, "", [], {}):
            issues.append(_issue("error", "MISSING_REQUIRED_CONFIG", f"{definition.name} requiere configurar '{field}'.", node_id=node.id))
    for key, value in config.items():
        normalized = str(key).lower().replace("-", "_")
        if any(token in normalized for token in ("api_key", "password", "secret", "token", "authorization")) and value:
            issues.append(_issue("error", "INLINE_SECRET_FORBIDDEN", f"{definition.name} debe usar una referencia segura, no un secreto en '{key}'.", node_id=node.id))
    return issues


def _uncontrolled_cycle_edges(
    adjacency: Dict[UUID, List[tuple[UUID, models.AiWorkflowEdge]]],
) -> List[models.AiWorkflowEdge]:
    """Find only DFS back-edges that can loop without a bounded exit.

    Iterating a set of UUIDs must not change validation.  A shared ``visited``
    set is safe only after a DFS branch fully unwinds, so keep the recursion
    stack separate and collect every problematic return edge.
    """
    visited: set[UUID] = set()
    stack: set[UUID] = set()
    invalid: List[models.AiWorkflowEdge] = []

    def visit(node_id: UUID) -> None:
        visited.add(node_id)
        stack.add(node_id)
        for target, edge in adjacency.get(node_id, []):
            if target in stack:
                if edge.condition_type == "always" or edge.max_passes <= 1:
                    invalid.append(edge)
            elif target not in visited:
                visit(target)
        stack.remove(node_id)

    for node_id in adjacency:
        if node_id not in visited:
            visit(node_id)
    return invalid


async def validate_workflow_graph(db: AsyncSession, workflow: models.AiWorkflow) -> List[Dict[str, Any]]:
    await ensure_ai_agent_definitions(db)
    await db.refresh(workflow, attribute_names=["nodes", "edges"])
    definitions = {item.id: item for item in (await db.execute(select(models.AiAgentDefinition))).scalars().all()}
    universal_versions = {
        item.id: item
        for item in (await db.execute(select(models.AiUniversalAgentVersion))).scalars().all()
    } if workflow.workflow_format == "universal_v2" else {}
    issues: List[Dict[str, Any]] = []
    if workflow.provider_profile_id:
        profile = await db.get(models.AiProviderProfile, workflow.provider_profile_id)
        if not profile or not profile.enabled:
            issues.append(_issue("error", "PROVIDER_PROFILE_UNAVAILABLE", "El perfil IA principal no existe o esta deshabilitado."))
        elif profile.capability_status == "unsupported":
            issues.append(_issue("error", "PROVIDER_PROFILE_UNSUPPORTED", "El perfil IA principal fue clasificado como no compatible."))
        elif profile.capability_status != "tested":
            issues.append(_issue("warning", "PROVIDER_PROFILE_UNTESTED", "El perfil IA todavia no tiene capacidades verificadas por Treseko."))
        seen_profiles = {str(workflow.provider_profile_id)}
        for raw_id in workflow.fallback_profile_ids or []:
            if str(raw_id) in seen_profiles:
                issues.append(_issue("error", "DUPLICATE_PROVIDER_FALLBACK", "La cadena de fallback contiene perfiles repetidos."))
                continue
            seen_profiles.add(str(raw_id))
            try:
                fallback = await db.get(models.AiProviderProfile, UUID(str(raw_id)))
            except ValueError:
                fallback = None
            if not fallback or not fallback.enabled:
                issues.append(_issue("error", "PROVIDER_FALLBACK_UNAVAILABLE", "Un perfil IA de fallback no existe o esta deshabilitado."))
    enabled = [node for node in workflow.nodes if node.enabled]
    enabled_ids = {node.id for node in enabled}
    if not enabled:
        return [_issue("error", "NO_ENABLED_NODES", "El workflow debe tener al menos un agente habilitado.")]
    incoming = {node.id: 0 for node in enabled}
    outgoing = {node.id: 0 for node in enabled}
    adjacency = {node.id: [] for node in enabled}
    cycle_adjacency: Dict[UUID, List[tuple[UUID, models.AiWorkflowEdge]]] = {node.id: [] for node in enabled}
    for edge in workflow.edges:
        if edge.source_node_id not in enabled_ids or edge.target_node_id not in enabled_ids:
            continue
        incoming[edge.target_node_id] += 1
        outgoing[edge.source_node_id] += 1
        adjacency[edge.source_node_id].append(edge.target_node_id)
        cycle_adjacency[edge.source_node_id].append((edge.target_node_id, edge))
        if edge.source_node_id == edge.target_node_id and edge.max_passes <= 1:
            issues.append(_issue("error", "UNBOUNDED_SELF_LOOP", "Un ciclo propio debe tener una politica de pases explicita.", edge_id=edge.id))
        if workflow.workflow_format == "universal_v2":
            source_node = next((node for node in enabled if node.id == edge.source_node_id), None)
            source_version = universal_versions.get(source_node.universal_agent_version_id) if source_node else None
            declared_ports = set(((source_version.contract_json or {}).get("ports") or {}).get("control_outputs") or []) if source_version else set()
            if edge.source_handle and edge.source_handle not in declared_ports:
                issues.append(_issue("error", "UNDECLARED_OUTPUT_PORT", "La conexion usa un puerto no declarado por el agente universal.", edge_id=edge.id))
            for mapping in edge.data_mapping_json or []:
                if not isinstance(mapping, dict) or not str(mapping.get("source") or "").startswith("outputs.") or not str(mapping.get("target") or "").startswith("inputs."):
                    issues.append(_issue("error", "INVALID_DATA_MAPPING", "Los mapeos universales deben ir de outputs.* hacia inputs.*.", edge_id=edge.id))
    starts = [node_id for node_id, count in incoming.items() if count == 0]
    terminals = [node_id for node_id, count in outgoing.items() if count == 0]
    if len(starts) != 1:
        issues.append(_issue("error", "INVALID_START_NODE", "El workflow debe tener exactamente un nodo inicial."))
    if not terminals:
        issues.append(_issue("error", "NO_TERMINAL_NODE", "El workflow debe tener al menos una ruta terminal."))
    if starts:
        visited, pending = set(), [starts[0]]
        while pending:
            current = pending.pop()
            if current in visited:
                continue
            visited.add(current)
            pending.extend(adjacency.get(current, []))
        for node in enabled:
            if node.id not in visited:
                issues.append(_issue("error", "ORPHAN_NODE", "El agente habilitado no es alcanzable desde el inicio.", node_id=node.id))
    for edge in _uncontrolled_cycle_edges(cycle_adjacency):
        issues.append(_issue("error", "UNCONTROLLED_CYCLE", "Los ciclos deben tener una condicion de salida y maximo de pases mayor a uno.", edge_id=edge.id))
    config = await _workflow_engine_config(db)
    configured_timeout = int(config.get("timeout_seconds") or 0)
    cumulative_timeout = sum(node.timeout_sec for node in enabled)
    if configured_timeout and cumulative_timeout > configured_timeout:
        # A graph can contain mutually-exclusive recovery/audit branches; this
        # is a planning warning, while the engine keeps the hard global limit.
        issues.append(_issue("warning", "TIMEOUT_BUDGET_EXCEEDED", "La suma potencial de timeouts supera el limite del motor; revisar rutas de reintento."))
    for node in enabled:
        if workflow.workflow_format == "universal_v2":
            if node.model_override:
                issues.append(_issue("error", "NODE_MODEL_OVERRIDE_FORBIDDEN", "Los workflows universales usan un unico perfil/modelo por workflow.", node_id=node.id))
            universal_version = universal_versions.get(node.universal_agent_version_id)
            if not universal_version:
                issues.append(_issue("error", "MISSING_UNIVERSAL_AGENT_VERSION", "El nodo universal debe referenciar una version de agente inmutable.", node_id=node.id))
                continue
            try:
                contract = validate_universal_agent_contract(universal_version.contract_json or {})
            except ValueError as exc:
                issues.append(_issue("error", "INVALID_UNIVERSAL_AGENT_CONTRACT", str(exc), node_id=node.id))
                continue
            if universal_version.status not in {"DRAFT", "PUBLISHED"}:
                issues.append(_issue("error", "UNIVERSAL_AGENT_NOT_EXECUTABLE", "La version del agente universal no se puede ejecutar.", node_id=node.id))
            requested = set(contract.get("capabilities") or [])
            forbidden = requested - set(CAPABILITY_CATALOG)
            if forbidden:
                issues.append(_issue("error", "UNAUTHORIZED_CAPABILITY", "El agente solicita capabilities no autorizadas.", node_id=node.id))
            continue
        definition = definitions.get(node.agent_definition_id)
        if not definition:
            issues.append(_issue("error", "MISSING_AGENT_DEFINITION", "El nodo no referencia una definicion de agente valida.", node_id=node.id))
            continue
        if definition.status in BLOCKING_STATUSES or not definition.runtime_handler:
            issues.append(_issue("error", "AGENT_NOT_EXECUTABLE", f"{definition.name} no tiene runtime operativo.", node_id=node.id))
        if definition.requires_secret_reference and not (node.config_json or {}).get("secret_reference"):
            issues.append(_issue("error", "MISSING_SECRET_REFERENCE", f"{definition.name} requiere una referencia segura a secreto o integracion.", node_id=node.id))
        issues.extend(_configuration_issues(definition, node))
        required_capabilities = definition.allowed_model_capabilities or {}
        if required_capabilities:
            model_id = str(node.model_override or definition.default_model or config.get("model") or "").strip()
            if not model_id:
                issues.append(_issue("error", "MODEL_REQUIRED", f"{definition.name} requiere seleccionar un modelo compatible.", node_id=node.id))
                continue
            capabilities = _model_capabilities(config, model_id)
            missing = [key for key, required in required_capabilities.items() if required and not capabilities.get(key)]
            if missing:
                issues.append(_issue("error", "MODEL_CAPABILITY_MISMATCH", f"El modelo '{model_id}' no cumple: {', '.join(missing)}.", node_id=node.id))
    # V2 wraps the same audited handlers with a BLOCK_ contract key. Treat it
    # as the same protected capability instead of warning on valid V2 graphs.
    protected = {str(node.agent_key or "").removeprefix("BLOCK_").removeprefix("UNIVERSAL_") for node in enabled}
    for agent_key in ("QA_GUARD", "VALIDATOR"):
        if agent_key not in protected:
            issues.append(_issue("warning", "PROTECTED_AGENT_MISSING", f"El workflow no incluye {agent_key}; su activacion requerira confirmacion administrativa."))
    return issues


def is_valid_for_activation(issues: List[Dict[str, Any]]) -> bool:
    return not any(item["severity"] == "error" for item in issues)
