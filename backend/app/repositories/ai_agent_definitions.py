"""Canonical catalog for workflow blocks.

The catalog is deliberately data-driven: the editor renders configuration from
these schemas and the engine only receives blocks that declare a real handler.
"""

from __future__ import annotations

from typing import Any, Dict, List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models


COMMON_OUTPUT_SCHEMA = {
    "type": "object",
    "required": ["status", "reason", "confidence"],
    "properties": {
        "status": {"enum": ["SUCCESS", "FAILED", "BLOCKED", "WAITING_RETRY", "SKIPPED"]},
        "reason": {"type": "string"},
        "confidence": {"type": "number", "minimum": 0, "maximum": 100},
        "outputs": {"type": "object"},
        "shared_memory_patch": {"type": "object"},
        "evidence_refs": {"type": "array", "items": {"type": "string"}},
        "metrics": {"type": "object"},
    },
}

COMMON_CONFIG_SCHEMA = {
    "type": "object",
    "properties": {
        "max_tokens": {"type": "integer", "minimum": 1, "maximum": 65536, "label": "Maximo de tokens"},
        "failure_policy": {"type": "string", "enum": ["fail", "retry", "block"], "label": "Politica de error"},
        "input_mapping": {"type": "object", "label": "Variables de entrada"},
        "output_mapping": {"type": "object", "label": "Variables de salida"},
    },
}

RUNTIME_METADATA = {
    "CONTEXT_RESOLVER": ("context-resolver/v1", "engine/src/index.ts#ContextResolver", "prompt"),
    "PRE_EXECUTION_ANALYST": ("pre-execution-analyst/v1", "engine/src/index.ts#PreExecutionAnalyst", "prompt"),
    "OBSERVER": ("browser-observer/v1", "engine/src/automation/observation.ts#observeBrowser", "prompt"),
    "AI_AGENT": ("qa-planner/v1", "engine/src/automation/step-runner.ts#runQaSteps", "prompt"),
    "QA_GUARD": ("qa-security-guard/v1", "engine/src/automation/action-executor.ts#validateAction", "rules"),
    "SENTINEL": ("browser-executor/v1", "engine/src/automation/step-runner.ts#runQaSteps", "none"),
    "VALIDATOR": ("contract-validator/v1", "engine/src/automation/step-contract.ts#evaluateStepContract", "rules"),
    "RECOVERY": ("recovery-policy/v1", "engine/src/automation/step-runner.ts#deterministicRecoveryAction", "rules"),
    "AUDITOR": ("evidence-auditor/v1", "engine/src/audit/consensus.ts#resolveAuditConsensus", "prompt"),
    "REPORTER": ("execution-reporter/v1", "engine/src/automation/report-generator.ts#ReportGenerator", "none"),
}


def _definition(
    key: str,
    name: str,
    category: str,
    kind: str,
    status: str,
    handler: str | None,
    icon: str,
    description: str,
    **extra: Any,
) -> Dict[str, Any]:
    implementation, source_module, editable_strategy = RUNTIME_METADATA.get(key, (None, None, "sandbox_script" if kind == "script" else "none"))
    return {
        "key": key,
        "version": 1,
        "name": name,
        "description": description,
        "category": category,
        "kind": kind,
        "runtime_handler": handler,
        "status": status,
        "input_schema_json": {"type": "object"},
        "output_schema_json": COMMON_OUTPUT_SCHEMA,
        "config_schema_json": COMMON_CONFIG_SCHEMA,
        "capabilities_json": {},
        "allowed_model_capabilities": {},
        "default_timeout_sec": 60,
        "default_retry_policy": {},
        "required_permissions_json": [],
        "requires_secret_reference": False,
        "icon_key": icon,
        "ui_metadata_json": {
            "implementation": implementation,
            "source_module": source_module,
            "editable_strategy": editable_strategy,
            "code_policy": "native_allowlist" if implementation else "sandbox_only",
        },
        **extra,
    }


CATALOG: List[Dict[str, Any]] = [
    _definition("CONTEXT_RESOLVER", "Context Resolver", "context", "builtin", "operational", "ContextResolver", "database", "Resuelve URL, variables, datos y contexto de ejecucion."),
    _definition("PRE_EXECUTION_ANALYST", "Analista Previo de Ejecucion", "validation", "builtin", "operational", "PreExecutionAnalyst", "brain-circuit", "Traduce los tres campos del caso a contratos temporales verificables."),
    _definition("OBSERVER", "Observer", "observation", "builtin", "operational", "Observer", "eye", "Observa DOM, URL, carga y errores visibles."),
    _definition("AI_AGENT", "Planner", "ai", "llm", "operational", "Planner", "brain", "Planifica una accion QA con un modelo configurado."),
    _definition("QA_GUARD", "Security Guard", "security", "rule", "operational", "SecurityGuard", "shield-check", "Aprueba solo acciones coherentes y seguras."),
    _definition("SENTINEL", "Executor", "execution", "builtin", "operational", "Executor", "play", "Ejecuta acciones seguras en navegador.", default_timeout_sec=900, default_retry_policy={"max_retries": 2}),
    _definition("VALIDATOR", "Validator", "validation", "builtin", "operational", "Validator", "badge-check", "Valida contratos DOM, URL, campos, conteos y estados."),
    _definition("RECOVERY", "Recovery", "recovery", "rule", "operational", "Recovery", "refresh-cw", "Decide reintentos, correccion o bloqueo."),
    _definition("AUDITOR", "Auditor", "audit", "llm", "operational", "Auditor", "clipboard-check", "Audita evidencia del intento y solicita revision cuando corresponde."),
    _definition("REPORTER", "Reporter", "reporting", "builtin", "operational", "Reporter", "file-text", "Construye reporte, metricas y trazabilidad."),
    _definition("VISION_AGENT", "Vision Agent", "observation", "llm", "experimental", None, "camera", "Evalua evidencia visual cuando haya un modelo compatible.", capabilities_json={"vision": True}, allowed_model_capabilities={"vision": True}),
    _definition("ACCESSIBILITY_AGENT", "Accessibility Agent", "validation", "builtin", "experimental", None, "accessibility", "Analiza accesibilidad con reglas y navegador."),
    _definition("PERFORMANCE_AGENT", "Performance Agent", "validation", "builtin", "experimental", None, "gauge", "Analiza metricas y umbrales de rendimiento."),
    _definition("API_AGENT", "API Agent", "integration", "builtin", "requires_configuration", None, "server", "Ejecuta validaciones API configuradas."),
    _definition("MCP_TOOL_AGENT", "MCP Tool Agent", "integration", "mcp_tool", "requires_configuration", None, "plug-zap", "Invoca una herramienta MCP autorizada.", requires_secret_reference=True),
    _definition("A2A_REMOTE_AGENT", "A2A Remote Agent", "integration", "a2a_remote", "requires_configuration", None, "bot", "Delega una tarea a un agente A2A verificado.", requires_secret_reference=True),
    _definition("WEBHOOK_AGENT", "Webhook Agent", "integration", "webhook", "requires_configuration", "webhook_agent", "webhook", "Invoca una integracion webhook permitida.", requires_secret_reference=True),
    _definition("SCRIPT_AGENT", "Script Agent", "script", "script", "experimental", "script_agent", "file-code-2", "Ejecuta un script limitado y auditado."),
    _definition("HUMAN_APPROVAL", "Human Approval", "custom", "human_approval", "requires_configuration", None, "user-round-check", "Pausa el flujo hasta una aprobacion con rol permitido."),
    _definition("VARIABLE_AGENT", "Variable Agent", "context", "rule", "experimental", None, "variable", "Transforma y valida variables compartidas."),
    _definition("MEMORY_AGENT", "Memory Agent", "context", "builtin", "experimental", None, "brain-circuit", "Gestiona memoria de ejecucion con politicas explicitas."),
    _definition("EMAIL_AGENT", "Email Agent", "integration", "webhook", "requires_configuration", None, "mail", "Envia notificaciones por una integracion permitida.", requires_secret_reference=True),
    _definition("NOTIFICATION_AGENT", "Notification Agent", "integration", "webhook", "requires_configuration", None, "bell", "Emite notificaciones por integraciones autorizadas.", requires_secret_reference=True),
]

# V2 blocks reuse audited native handlers but expose a typed, visual contract.
# They are separate definitions so a V1 workflow is never rewritten in place.
BLOCK_SOURCE_KEYS = ["CONTEXT_RESOLVER", "PRE_EXECUTION_ANALYST", "OBSERVER", "AI_AGENT", "QA_GUARD", "SENTINEL", "VALIDATOR", "RECOVERY", "AUDITOR", "REPORTER"]

def _block_definition(source: Dict[str, Any]) -> Dict[str, Any]:
    key = str(source["key"])
    input_schema = {"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object", "additionalProperties": True}
    output_schema = {"$schema": "https://json-schema.org/draft/2020-12/schema", **COMMON_OUTPUT_SCHEMA}
    return {
        **source,
        "key": f"BLOCK_{key}",
        "name": f"{source['name']} Block",
        "version": 1,
        "input_schema_json": input_schema,
        "output_schema_json": output_schema,
        "config_schema_json": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "properties": {**COMMON_CONFIG_SCHEMA["properties"], "block_contract_version": {"const": "treseko.block/v1"}},
        },
        "ui_metadata_json": {
            **(source.get("ui_metadata_json") or {}),
            "block_contract": "treseko.block/v1",
            "ports": {"inputs": ["input"], "outputs": ["success", "failed", "blocked", "retry"]},
            "legacy_agent_key": key,
        },
    }

CATALOG.extend([_block_definition(item) for item in CATALOG if item["key"] in BLOCK_SOURCE_KEYS])


async def ensure_ai_agent_definitions(db: AsyncSession) -> None:
    existing = {item.key: item for item in (await db.execute(select(models.AiAgentDefinition))).scalars().all()}
    for payload in CATALOG:
        definition = existing.get(payload["key"])
        if definition is None:
            db.add(models.AiAgentDefinition(**payload))
            continue
        # Keep user-managed configuration but continuously repair metadata for
        # Treseko-provided blocks as their runtime evolves.
        for key, value in payload.items():
            setattr(definition, key, value)
    await db.flush()
    definitions = {item.key: item for item in (await db.execute(select(models.AiAgentDefinition))).scalars().all()}
    # Backfill legacy nodes lazily after migration. Existing execution snapshots
    # remain untouched; only editable workflow nodes gain the catalog link.
    for node in (await db.execute(select(models.AiWorkflowNode).filter(models.AiWorkflowNode.agent_definition_id.is_(None)))).scalars().all():
        definition = definitions.get(node.agent_key)
        if definition:
            node.agent_definition_id = definition.id
    await db.flush()


async def list_ai_agent_definitions(db: AsyncSession) -> List[models.AiAgentDefinition]:
    await ensure_ai_agent_definitions(db)
    result = await db.execute(select(models.AiAgentDefinition).order_by(models.AiAgentDefinition.category, models.AiAgentDefinition.name))
    return result.scalars().all()


async def definition_by_key(db: AsyncSession, key: str) -> models.AiAgentDefinition | None:
    await ensure_ai_agent_definitions(db)
    result = await db.execute(select(models.AiAgentDefinition).filter(models.AiAgentDefinition.key == key))
    return result.scalar_one_or_none()
