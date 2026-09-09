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
from ..services.ai_workflow_runtime_manifest import workflow_runtime_adapters


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
    } if workflow.workflow_format in {"universal_v2", "universal_v3"} else {}
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
        if workflow.workflow_format in {"universal_v2", "universal_v3"}:
            source_node = next((node for node in enabled if node.id == edge.source_node_id), None)
            target_node = next((node for node in enabled if node.id == edge.target_node_id), None)
            source_version = universal_versions.get(source_node.universal_agent_version_id) if source_node else None
            target_version = universal_versions.get(target_node.universal_agent_version_id) if target_node else None
            declared_ports = set(((source_version.contract_json or {}).get("ports") or {}).get("control_outputs") or []) if source_version else set()
            declared_inputs = set(((target_version.contract_json or {}).get("ports") or {}).get("control_inputs") or []) if target_version else set()
            if edge.source_handle and edge.source_handle not in declared_ports:
                issues.append(_issue("error", "UNDECLARED_OUTPUT_PORT", "La conexion usa un puerto no declarado por el agente universal.", edge_id=edge.id))
            if edge.target_handle and edge.target_handle not in declared_inputs:
                issues.append(_issue("error", "UNDECLARED_INPUT_PORT", "La conexion usa una entrada no declarada por el agente universal.", edge_id=edge.id))
            if edge.condition_type in {"output_port", "decision_is"}:
                expected_port = str((edge.condition_json or {}).get("value") or (edge.condition_json or {}).get("output_port") or edge.source_handle or "").strip()
                if not expected_port:
                    issues.append(_issue("error", "MISSING_OUTPUT_PORT_CONDITION", "Una condicion por puerto debe indicar el puerto de salida esperado.", edge_id=edge.id))
                elif expected_port not in declared_ports:
                    issues.append(_issue("error", "UNDECLARED_OUTPUT_PORT", "La condicion usa un puerto de salida no declarado por el agente universal.", edge_id=edge.id))
            for mapping in edge.data_mapping_json or []:
                if not isinstance(mapping, dict) or not str(mapping.get("source") or "").startswith("outputs.") or not str(mapping.get("target") or "").startswith("inputs."):
                    issues.append(_issue("error", "INVALID_DATA_MAPPING", "Los mapeos universales deben ir de outputs.* hacia inputs.*.", edge_id=edge.id))
            if workflow.workflow_format == "universal_v3":
                if not edge.source_handle:
                    issues.append(_issue("error", "V3_SOURCE_PORT_REQUIRED", "Cada conexion V3 debe salir de un puerto explicito.", edge_id=edge.id))
                if not edge.target_handle:
                    issues.append(_issue("error", "V3_TARGET_PORT_REQUIRED", "Cada conexion V3 debe entrar por un puerto explicito.", edge_id=edge.id))
                if edge.condition_type not in {"output_port", "decision_is"}:
                    issues.append(_issue("error", "V3_TYPED_EDGE_REQUIRED", "Las conexiones V3 deben seleccionar una salida tipada del nodo.", edge_id=edge.id))
    starts = [node_id for node_id, count in incoming.items() if count == 0]
    terminals = [node_id for node_id, count in outgoing.items() if count == 0]
    if len(starts) != 1:
        issues.append(_issue("error", "INVALID_START_NODE", "El workflow debe tener exactamente un nodo inicial."))
    if not terminals:
        issues.append(_issue("error", "NO_TERMINAL_NODE", "El workflow debe tener al menos una ruta terminal."))
    if workflow.workflow_format == "universal_v3":
        policy = workflow.decision_policy_json or {}
        if policy.get("runtime_mode") != "graph_native":
            issues.append(_issue("error", "V3_REQUIRES_GRAPH_NATIVE", "Universal V3 requiere runtime_mode=graph_native."))
        if policy.get("source_of_truth") != "persisted_graph" or policy.get("legacy_step_runner_allowed") is not False:
            issues.append(_issue("error", "V3_GRAPH_NOT_AUTHORITATIVE", "Universal V3 debe declarar al grafo persistido como unica fuente de verdad y deshabilitar el runner heredado."))
        entry_node_id = str(policy.get("entry_node_id") or "")
        if not entry_node_id:
            issues.append(_issue("error", "V3_ENTRY_NODE_REQUIRED", "Universal V3 requiere entry_node_id explicito."))
        elif entry_node_id not in {str(node_id) for node_id in enabled_ids}:
            issues.append(_issue("error", "V3_ENTRY_NODE_INVALID", "El entry_node_id V3 no referencia un nodo habilitado."))
        elif starts and entry_node_id != str(starts[0]):
            issues.append(_issue("error", "V3_ENTRY_NODE_MISMATCH", "El entry_node_id V3 no coincide con la entrada estructural del grafo."))
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
        if workflow.workflow_format in {"universal_v2", "universal_v3"}:
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
            if workflow.workflow_format == "universal_v3":
                adapter = str((node.config_json or {}).get("runtime_adapter") or (contract.get("implementation") or {}).get("native_adapter") or "").strip()
                if not adapter:
                    issues.append(_issue("error", "V3_NATIVE_ADAPTER_REQUIRED", "El nodo V3 debe declarar un adaptador nativo explicito.", node_id=node.id))
                else:
                    manifest_entry = workflow_runtime_adapters().get(adapter)
                    if not manifest_entry:
                        issues.append(_issue("error", "UNKNOWN_RUNTIME_ADAPTER", f"El adaptador V3 '{adapter}' no esta registrado.", node_id=node.id))
                    elif manifest_entry.get("atomic") is not True:
                        issues.append(_issue("error", "V3_ATOMIC_ADAPTER_REQUIRED", f"El adaptador '{adapter}' no es atomico y podria ocultar otro workflow.", node_id=node.id))
                terminal_ports = (node.config_json or {}).get("terminal_ports") or []
                if node.id in terminals and not terminal_ports:
                    issues.append(_issue("error", "V3_TERMINAL_PORT_REQUIRED", "El nodo terminal V3 debe declarar al menos un puerto terminal.", node_id=node.id))
                elif node.id in terminals:
                    declared_outputs = set((contract.get("ports") or {}).get("control_outputs") or [])
                    invalid_terminal_ports = [port for port in terminal_ports if not isinstance(port, str) or port not in declared_outputs]
                    if invalid_terminal_ports:
                        issues.append(_issue("error", "V3_TERMINAL_PORT_UNDECLARED", "Los puertos terminales V3 deben estar declarados como salidas de control.", node_id=node.id))
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
