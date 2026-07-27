"""Treseko Universal Agent Contract v1.

The contract is intentionally declarative.  It can select a registered engine
adapter, but it cannot ship source code, shell commands, or credentials.
"""
from __future__ import annotations

import hashlib
import json
import re
from copy import deepcopy
from typing import Any, Dict, Iterable, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .. import models, schemas
from .ai_workflow_package_io import (
    _read_zip_payload,
    _zip_payload,
    workflow_create_payload_from_portable_graph,
)


UNIVERSAL_AGENT_CONTRACT_VERSION = "treseko.universal-agent/v1"
UNIVERSAL_AGENT_PACKAGE_FORMAT = "treseko.agent-package/v1"
UNIVERSAL_WORKFLOW_PACKAGE_FORMAT = "treseko.workflow-package/v1"
_KEY_RE = re.compile(r"^[a-z][a-z0-9-]*$")
_INLINE_SECRET_KEYS = {"api_key", "apikey", "password", "secret", "token", "authorization", "credential", "private_key"}
_FORBIDDEN_IMPLEMENTATION_KEYS = {"code", "script", "shell", "command", "javascript", "python", "source_code"}


def _schema_object() -> Dict[str, Any]:
    return {"type": "object", "additionalProperties": True}


def _capability(key: str, *, risk: str = "low", permissions: Optional[List[str]] = None,
                network: bool = False, browser: bool = False, ai: bool = False,
                evidence: bool = False, secrets: bool = False, handler: str = "universal-agent-runtime/v1") -> Dict[str, Any]:
    return {
        "key": key, "version": "v1", "input_schema": _schema_object(), "output_schema": _schema_object(),
        "required_permissions": permissions or ["motor_ia.workflow_execute"], "risk": risk,
        "limits": {"timeout_sec": 120}, "allows_network": network, "allows_browser": browser,
        "allows_ai": ai, "allows_evidence": evidence, "allows_secrets": secrets, "native_handler": handler,
    }


CAPABILITY_CATALOG: Dict[str, Dict[str, Any]] = {
    item["key"]: item for item in [
        _capability("context.read_case"), _capability("context.read_variables"), _capability("context.resolve_url"), _capability("context.transform"),
        _capability("memory.read"), _capability("memory.write"), _capability("memory.namespace_read"), _capability("memory.namespace_write"),
        _capability("browser.navigate", risk="high", browser=True), _capability("browser.observe", browser=True),
        _capability("browser.execute_safe_action", risk="high", browser=True), _capability("browser.wait", browser=True), _capability("browser.extract", browser=True),
        _capability("validation.evaluate_contract"), _capability("validation.compare_text"), _capability("validation.compare_value"),
        _capability("validation.compare_visual", ai=True, evidence=True), _capability("validation.evaluate_schema"),
        _capability("evidence.capture", browser=True, evidence=True), _capability("evidence.read", evidence=True),
        _capability("evidence.annotate", evidence=True), _capability("evidence.compare_image", ai=True, evidence=True),
        _capability("llm.reason", ai=True), _capability("llm.classify", ai=True), _capability("llm.extract", ai=True),
        _capability("llm.plan", ai=True), _capability("llm.audit", ai=True, evidence=True),
        _capability("rules.evaluate"), _capability("rules.route"), _capability("rules.transform"),
        _capability("integration.http_request", risk="high", network=True, secrets=True),
        _capability("integration.mcp_call", risk="high", network=True, secrets=True),
        _capability("integration.notify", risk="medium", network=True), _capability("human.request_approval", risk="medium"),
        _capability("report.generate"), _capability("trace.write"),
    ]
}


LEGACY_AGENT_ADAPTERS: Dict[str, Dict[str, Any]] = {
    "CONTEXT_RESOLVER": {"adapter": "legacy-context-resolver/v1", "strategy": "deterministic_then_llm", "capabilities": ["context.read_case", "context.read_variables", "context.resolve_url", "memory.write"], "category": "context"},
    "PRE_EXECUTION_ANALYST": {"adapter": "legacy-pre-execution-analyst/v1", "strategy": "deterministic", "capabilities": ["context.read_case", "validation.evaluate_contract", "memory.write"], "category": "planning"},
    "OBSERVER": {"adapter": "legacy-observer/v1", "strategy": "tool_orchestrated", "capabilities": ["browser.observe", "memory.write"], "category": "browser"},
    "PLANNER": {"adapter": "legacy-planner/v1", "strategy": "llm", "capabilities": ["llm.plan", "browser.observe", "memory.read", "memory.write"], "category": "planning"},
    "SECURITY_GUARD": {"adapter": "legacy-security-guard/v1", "strategy": "rules", "capabilities": ["rules.evaluate", "memory.read", "memory.write"], "category": "validation"},
    "EXECUTOR": {"adapter": "legacy-executor/v1", "strategy": "tool_orchestrated", "capabilities": ["browser.navigate", "browser.execute_safe_action", "evidence.capture", "memory.write"], "category": "browser"},
    "VALIDATOR": {"adapter": "legacy-validator/v1", "strategy": "deterministic_then_llm", "capabilities": ["validation.evaluate_contract", "validation.compare_visual", "evidence.read", "memory.write"], "category": "validation"},
    "RECOVERY": {"adapter": "legacy-recovery/v1", "strategy": "rules", "capabilities": ["rules.evaluate", "rules.route", "memory.read", "memory.write"], "category": "recovery"},
    "AUDITOR": {"adapter": "legacy-auditor/v1", "strategy": "deterministic_then_llm", "capabilities": ["evidence.read", "evidence.capture", "llm.audit", "memory.read", "memory.write"], "category": "audit"},
    "REPORTER": {"adapter": "legacy-reporter/v1", "strategy": "deterministic", "capabilities": ["report.generate", "trace.write", "memory.read"], "category": "reporting"},
    # Non-core catalog entries remain explicit profiles too. Profiles that
    # depend on an installation integration execute only through its safe
    # registered handler; they never downgrade to arbitrary LLM execution.
    "VISION_AGENT": {"adapter": "universal-llm/v1", "strategy": "llm", "capabilities": ["llm.reason", "evidence.read", "evidence.compare_image", "memory.write"], "category": "browser"},
    "ACCESSIBILITY_AGENT": {"adapter": "universal-validator/v1", "strategy": "rules", "capabilities": ["browser.observe", "validation.evaluate_contract", "memory.write"], "category": "validation"},
    "PERFORMANCE_AGENT": {"adapter": "universal-validator/v1", "strategy": "rules", "capabilities": ["browser.observe", "validation.compare_value", "memory.write"], "category": "validation"},
    "API_AGENT": {"adapter": "universal-http/v1", "strategy": "tool_orchestrated", "capabilities": ["integration.http_request", "validation.evaluate_schema", "memory.write"], "category": "integration"},
    "MCP_TOOL_AGENT": {"adapter": "universal-mcp/v1", "strategy": "tool_orchestrated", "capabilities": ["integration.mcp_call", "trace.write"], "category": "integration"},
    "A2A_REMOTE_AGENT": {"adapter": "universal-a2a-disabled/v1", "strategy": "rules", "capabilities": ["trace.write"], "category": "integration"},
    "WEBHOOK_AGENT": {"adapter": "universal-http/v1", "strategy": "tool_orchestrated", "capabilities": ["integration.http_request", "integration.notify", "trace.write"], "category": "integration"},
    "SCRIPT_AGENT": {"adapter": "universal-script-sandbox/v1", "strategy": "rules", "capabilities": ["rules.transform", "trace.write"], "category": "custom"},
    "HUMAN_APPROVAL": {"adapter": "universal-human-approval/v1", "strategy": "human", "capabilities": ["human.request_approval", "trace.write"], "category": "custom"},
    "VARIABLE_AGENT": {"adapter": "universal-transform/v1", "strategy": "rules", "capabilities": ["context.transform", "rules.transform", "memory.write"], "category": "context"},
    "MEMORY_AGENT": {"adapter": "universal-transform/v1", "strategy": "rules", "capabilities": ["memory.read", "memory.write", "memory.namespace_read", "memory.namespace_write"], "category": "context"},
    "EMAIL_AGENT": {"adapter": "universal-http/v1", "strategy": "tool_orchestrated", "capabilities": ["integration.notify", "trace.write"], "category": "integration"},
    "NOTIFICATION_AGENT": {"adapter": "universal-http/v1", "strategy": "tool_orchestrated", "capabilities": ["integration.notify", "trace.write"], "category": "integration"},
}

LEGACY_AGENT_KEY_ALIASES = {
    "AI_AGENT": "PLANNER",
    "QA_GUARD": "SECURITY_GUARD",
    "SENTINEL": "EXECUTOR",
}


def universal_agent_contract_schema() -> Dict[str, Any]:
    """Published JSON Schema shape for editor-side validation and portability."""
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": UNIVERSAL_AGENT_CONTRACT_VERSION,
        "type": "object",
        "required": ["contract_version", "key", "version", "name", "implementation", "inputs", "instructions", "capabilities", "output_contract", "execution", "ports", "security", "ui"],
        "properties": {
            "contract_version": {"const": UNIVERSAL_AGENT_CONTRACT_VERSION},
            "key": {"type": "string", "pattern": "^[a-z][a-z0-9-]*$"}, "version": {"type": "string"},
            "name": {"type": "string", "minLength": 1}, "description": {"type": "string"},
            "implementation": {"type": "object", "required": ["runtime_key", "native_adapter", "editable_strategy"]},
            "inputs": {"type": "object", "required": ["schema", "mapping"]},
            "instructions": {"type": "object", "required": ["mode", "objective"]},
            "capabilities": {"type": "array", "items": {"type": "string"}},
            "output_contract": {"type": "object", "required": ["schema", "publish"]},
            "execution": {"type": "object", "required": ["timeout_sec", "max_retries", "model"]},
            "ports": {"type": "object", "required": ["control_inputs", "control_outputs"]},
            "security": {"type": "object", "required": ["allow_private_network", "allow_filesystem", "allow_shell", "allow_arbitrary_code"]},
            "ui": {"type": "object", "required": ["category"]},
        },
        "additionalProperties": False,
    }


def _canonical_hash(value: Dict[str, Any]) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _walk(value: Any, path: str = "") -> Iterable[Tuple[str, Any]]:
    if isinstance(value, dict):
        for key, item in value.items():
            next_path = f"{path}.{key}" if path else str(key)
            yield next_path, item
            yield from _walk(item, next_path)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _walk(item, f"{path}[{index}]")


def _reject_inline_secrets(value: Dict[str, Any]) -> None:
    for path, item in _walk(value):
        key = path.rsplit(".", 1)[-1].lower().replace("-", "_")
        if key in _INLINE_SECRET_KEYS and item not in (None, "", [], {}):
            if "ref" not in key and not isinstance(item, dict):
                raise ValueError(f"No se permiten secretos inline ({path}); usa una referencia segura.")


def validate_universal_agent_contract(contract: Dict[str, Any]) -> Dict[str, Any]:
    """Strict semantic validation without allowing executable extension points."""
    if not isinstance(contract, dict):
        raise ValueError("El contrato universal debe ser un objeto JSON.")
    required = universal_agent_contract_schema()["required"]
    missing = [key for key in required if key not in contract]
    if missing:
        raise ValueError(f"El contrato universal no contiene: {', '.join(missing)}.")
    if contract.get("contract_version") != UNIVERSAL_AGENT_CONTRACT_VERSION:
        raise ValueError("Version de contrato universal no compatible.")
    if not _KEY_RE.fullmatch(str(contract.get("key") or "")):
        raise ValueError("La key del agente debe usar kebab-case y comenzar con una letra.")
    implementation = contract.get("implementation") or {}
    if implementation.get("runtime_key") != "universal-agent-runtime/v1":
        raise ValueError("El agente debe usar universal-agent-runtime/v1.")
    adapter = str(implementation.get("native_adapter") or "")
    allowed_adapters = {item["adapter"] for item in LEGACY_AGENT_ADAPTERS.values()} | {
        "universal-llm/v1", "universal-rules/v1", "universal-transform/v1", "universal-human-approval/v1",
        "universal-browser/v1", "universal-validator/v1", "universal-http/v1", "universal-mcp/v1", "universal-reporter/v1",
        "universal-script-sandbox/v1", "universal-a2a-disabled/v1",
    }
    if adapter not in allowed_adapters:
        raise ValueError("La implementacion debe usar un adaptador registrado y permitido.")
    if str(implementation.get("editable_strategy") or "") not in {"prompt", "rules", "mapping", "hybrid", "none"}:
        raise ValueError("La estrategia editable del agente no es valida.")
    for path, _value in _walk(implementation):
        if path.rsplit(".", 1)[-1].lower() in _FORBIDDEN_IMPLEMENTATION_KEYS:
            raise ValueError("El contrato no permite codigo ni scripts ejecutables.")
    capabilities = contract.get("capabilities") or []
    if not isinstance(capabilities, list) or not capabilities:
        raise ValueError("El agente debe declarar al menos una capability permitida.")
    unknown = [key for key in capabilities if key not in CAPABILITY_CATALOG]
    if unknown:
        raise ValueError(f"Capabilities no registradas: {', '.join(map(str, unknown))}.")
    security = contract.get("security") or {}
    for key in ("allow_private_network", "allow_filesystem", "allow_shell", "allow_arbitrary_code"):
        if security.get(key) is not False:
            raise ValueError(f"{key} debe ser false en agentes universales.")
    if adapter == "universal-http/v1" and not {"integration.http_request", "integration.notify"}.intersection(capabilities):
        raise ValueError("El adaptador HTTP requiere integration.http_request o integration.notify.")
    if adapter == "universal-browser/v1" and not {"browser.navigate", "browser.observe", "browser.execute_safe_action"}.intersection(capabilities):
        raise ValueError("El adaptador Browser requiere al menos una capability de navegador.")
    if adapter == "universal-validator/v1" and not {"validation.evaluate_contract", "validation.compare_text", "validation.compare_value", "validation.compare_visual"}.intersection(capabilities):
        raise ValueError("El adaptador Validator requiere una capability de validacion.")
    if adapter == "universal-mcp/v1" and "integration.mcp_call" not in capabilities:
        raise ValueError("El adaptador MCP requiere integration.mcp_call.")
    instructions = contract.get("instructions") or {}
    if instructions.get("mode") not in {"deterministic", "llm", "hybrid", "tool_orchestrated", "human"}:
        raise ValueError("El modo de instrucciones no es valido.")
    execution = contract.get("execution") or {}
    if not 1 <= int(execution.get("timeout_sec") or 0) <= 7200:
        raise ValueError("El timeout del agente debe estar entre 1 y 7200 segundos.")
    if not 0 <= int(execution.get("max_retries") or 0) <= 20:
        raise ValueError("El maximo de reintentos no es valido.")
    ports = contract.get("ports") or {}
    outputs = ports.get("control_outputs") or []
    if not {"success", "failed", "blocked", "retry"}.issubset(set(outputs)):
        raise ValueError("El contrato debe declarar los puertos success, failed, blocked y retry.")
    _reject_inline_secrets(contract)
    return deepcopy(contract)


def _legacy_contract(agent_key: str, *, name: str, description: str, version: str = "1.0.0") -> Dict[str, Any]:
    key = str(agent_key or "").upper().removeprefix("BLOCK_")
    key = LEGACY_AGENT_KEY_ALIASES.get(key, key)
    profile = LEGACY_AGENT_ADAPTERS.get(key)
    if not profile:
        raise ValueError(f"No existe adaptador universal para {agent_key}.")
    universal_key = f"builtin-{key.lower().replace('_', '-')}"
    return {
        "contract_version": UNIVERSAL_AGENT_CONTRACT_VERSION, "id": None, "key": universal_key, "version": version,
        "name": name, "description": description, "status": "DRAFT",
        "metadata": {"author_type": "builtin", "source_agent_id": None, "source_package": None, "tags": ["legacy-adapter"], "engine_compatibility": ">=1.0.0"},
        "implementation": {"runtime_key": "universal-agent-runtime/v1", "capability_profile": profile["category"], "native_adapter": profile["adapter"], "editable_strategy": "hybrid" if profile["strategy"] in {"llm", "deterministic_then_llm"} else "none"},
        "inputs": {"schema": _schema_object(), "mapping": {}, "allowed_context_sources": ["case", "step", "shared_memory", "evidence"]},
        "instructions": {"mode": "hybrid" if profile["strategy"] == "deterministic_then_llm" else "llm" if profile["strategy"] == "llm" else "deterministic", "system_policy_ref": "qa-safe-agent/v1", "role": name, "objective": description or name, "constraints": ["No ejecutar codigo arbitrario", "No exponer secretos"], "user_instructions": "", "context_sources": ["case", "shared_memory"], "output_format": "json_schema"},
        "capabilities": profile["capabilities"], "tools": {"allowed": [], "configuration": {}},
        "decision_policy": {"strategy": profile["strategy"], "on_success": "success", "on_failure": "failed", "on_inconclusive": "blocked", "fallback": None},
        "output_contract": {"schema": _schema_object(), "publish": {}, "required_evidence": []},
        "memory": {"read_namespaces": ["execution"], "write_namespaces": ["execution"], "retention": "execution"},
        "execution": {"timeout_sec": 60, "max_retries": 0, "retry_backoff_ms": 0, "model": {"selection": "runtime_default", "allowed_models": [], "temperature": None, "max_tokens": None, "requires_vision": "validation.compare_visual" in profile["capabilities"]}},
        "ports": {"control_inputs": ["input"], "control_outputs": ["success", "failed", "blocked", "retry"], "data_inputs": {}, "data_outputs": {}},
        "security": {"required_permissions": ["motor_ia.workflow_execute"], "required_secret_refs": [], "allow_private_network": False, "allow_filesystem": False, "allow_shell": False, "allow_arbitrary_code": False, "audit_level": "full"},
        "ui": {"category": profile["category"], "icon_key": "bot", "color": "", "help_text": "Adaptador compatible con el agente Treseko existente."},
    }


async def _load_universal_agent(db: AsyncSession, agent_id: UUID) -> Optional[models.AiUniversalAgent]:
    result = await db.execute(select(models.AiUniversalAgent).options(selectinload(models.AiUniversalAgent.versions)).where(models.AiUniversalAgent.id == agent_id))
    return result.scalar_one_or_none()


async def list_universal_agents(db: AsyncSession) -> List[models.AiUniversalAgent]:
    result = await db.execute(select(models.AiUniversalAgent).options(selectinload(models.AiUniversalAgent.versions)).order_by(models.AiUniversalAgent.updated_at.desc()))
    return result.scalars().unique().all()


async def get_universal_agent(db: AsyncSession, agent_id: UUID) -> models.AiUniversalAgent:
    agent = await _load_universal_agent(db, agent_id)
    if not agent:
        raise ValueError("Agente universal no encontrado.")
    return agent


async def create_universal_agent(db: AsyncSession, payload: schemas.AiUniversalAgentCreate, user_id: Optional[UUID]) -> models.AiUniversalAgent:
    contract = validate_universal_agent_contract(payload.contract)
    if contract["key"] != payload.key or contract["version"] != payload.version:
        raise ValueError("La key y version del contrato deben coincidir con el formulario.")
    existing = (await db.execute(select(models.AiUniversalAgent).where(models.AiUniversalAgent.key == payload.key))).scalar_one_or_none()
    if existing:
        raise ValueError("Ya existe un agente universal con esa key.")
    agent = models.AiUniversalAgent(key=payload.key, name=payload.name, description=payload.description, category=payload.category, origin_type=payload.origin_type, source_agent_id=payload.source_agent_id, created_by=user_id)
    db.add(agent)
    await db.flush()
    db.add(models.AiUniversalAgentVersion(agent_id=agent.id, version=payload.version, status="DRAFT", contract_json=contract, contract_hash=_canonical_hash(contract), source_package_json={}, created_by=user_id))
    await db.commit()
    return await get_universal_agent(db, agent.id)


async def create_universal_agent_version(db: AsyncSession, agent_id: UUID, payload: schemas.AiUniversalAgentVersionCreate, user_id: Optional[UUID]) -> models.AiUniversalAgentVersion:
    agent = await get_universal_agent(db, agent_id)
    contract = validate_universal_agent_contract(payload.contract)
    if contract["key"] != agent.key or contract["version"] != payload.version:
        raise ValueError("La version debe pertenecer al mismo agente y contrato.")
    if any(item.version == payload.version for item in agent.versions):
        raise ValueError("La version indicada ya existe y es inmutable.")
    version = models.AiUniversalAgentVersion(agent_id=agent.id, version=payload.version, status="DRAFT", contract_json=contract, contract_hash=_canonical_hash(contract), source_package_json={}, created_by=user_id)
    db.add(version)
    await db.commit()
    await db.refresh(version)
    return version


async def publish_universal_agent_version(db: AsyncSession, agent_id: UUID, version_id: UUID) -> models.AiUniversalAgentVersion:
    version = (await db.execute(select(models.AiUniversalAgentVersion).where(models.AiUniversalAgentVersion.id == version_id, models.AiUniversalAgentVersion.agent_id == agent_id))).scalar_one_or_none()
    if not version:
        raise ValueError("Version de agente universal no encontrada.")
    validate_universal_agent_contract(version.contract_json or {})
    version.status = "PUBLISHED"
    await db.commit()
    await db.refresh(version)
    return version


async def create_universal_variant(db: AsyncSession, source_agent_id: UUID, payload: schemas.AiUniversalAgentCreate, user_id: Optional[UUID]) -> models.AiUniversalAgent:
    source = await get_universal_agent(db, source_agent_id)
    payload.source_agent_id = source.id
    payload.origin_type = "variant"
    return await create_universal_agent(db, payload, user_id)


async def ensure_legacy_universal_adapter(db: AsyncSession, legacy_key: str, name: str, description: str, user_id: Optional[UUID] = None) -> models.AiUniversalAgentVersion:
    normalized = str(legacy_key or "").upper().removeprefix("BLOCK_")
    contract = _legacy_contract(normalized, name=name, description=description)
    agent = (await db.execute(select(models.AiUniversalAgent).options(selectinload(models.AiUniversalAgent.versions)).where(models.AiUniversalAgent.key == contract["key"]))).scalar_one_or_none()
    if not agent:
        agent = models.AiUniversalAgent(key=contract["key"], name=name, description=description, category=contract["ui"]["category"], origin_type="builtin", created_by=user_id)
        db.add(agent)
        await db.flush()
    version = (await db.execute(
        select(models.AiUniversalAgentVersion).where(
            models.AiUniversalAgentVersion.agent_id == agent.id,
            models.AiUniversalAgentVersion.version == contract["version"],
        )
    )).scalar_one_or_none()
    if not version:
        version = models.AiUniversalAgentVersion(agent_id=agent.id, version=contract["version"], status="PUBLISHED", contract_json=contract, contract_hash=_canonical_hash(contract), source_package_json={"adapter": normalized}, created_by=user_id)
        db.add(version)
        await db.flush()
    return version


def export_universal_agent_package(version: models.AiUniversalAgentVersion) -> Dict[str, Any]:
    contract = validate_universal_agent_contract(version.contract_json or {})
    agent_json = json.dumps(contract, ensure_ascii=False, indent=2).encode("utf-8")
    manifest = {
        "package_format": UNIVERSAL_AGENT_PACKAGE_FORMAT, "name": contract["key"], "version": version.version,
        "agent_contract": UNIVERSAL_AGENT_CONTRACT_VERSION, "engine_compatibility": ">=1.0.0",
        "dependencies": {"capabilities": contract["capabilities"], "schemas": [], "secret_requirements": (contract.get("security") or {}).get("required_secret_refs") or []},
        "integrity": {"sha256": hashlib.sha256(agent_json).hexdigest()}, "signature": {"issuer": None, "trusted": False},
    }
    files = {
        "manifest.json": json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"), "agent.json": agent_json,
        "schemas/input.schema.json": json.dumps((contract.get("inputs") or {}).get("schema") or {}, ensure_ascii=False, indent=2).encode("utf-8"),
        "schemas/output.schema.json": json.dumps((contract.get("output_contract") or {}).get("schema") or {}, ensure_ascii=False, indent=2).encode("utf-8"),
        "fixtures/sample-input.json": b"{}\n", "fixtures/expected-output.json": b"{}\n",
        "tests/agent.contract.test.json": json.dumps({"contract_version": UNIVERSAL_AGENT_CONTRACT_VERSION, "agent_key": contract["key"]}, ensure_ascii=False).encode("utf-8"),
        "README.md": f"# {contract['name']}\n\nAgente portable Treseko Universal Agent Contract v1.\n".encode("utf-8"),
        "assets/icon.svg": b"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"10\"/></svg>\n",
    }
    return {"filename": f"{contract['key']}-{version.version}.treseko-agent.zip", "package_base64": _zip_payload(files), "sha256": manifest["integrity"]["sha256"]}


async def import_universal_agent_package(db: AsyncSession, payload: schemas.AiUniversalAgentImport, user_id: Optional[UUID]) -> models.AiUniversalAgent:
    files = _read_zip_payload(payload.package_base64)
    try:
        manifest = json.loads(files["manifest.json"])
        contract = json.loads(files["agent.json"])
    except (KeyError, json.JSONDecodeError) as exc:
        raise ValueError("El paquete no contiene manifest.json y agent.json validos.") from exc
    agent_json = files["agent.json"]
    if manifest.get("package_format") != UNIVERSAL_AGENT_PACKAGE_FORMAT or manifest.get("agent_contract") != UNIVERSAL_AGENT_CONTRACT_VERSION:
        raise ValueError("El paquete no declara un formato Treseko compatible.")
    if manifest.get("integrity", {}).get("sha256") != hashlib.sha256(agent_json).hexdigest():
        raise ValueError("El hash de integridad del paquete no coincide.")
    contract = validate_universal_agent_contract(contract)
    imported_key = payload.key_override or contract["key"]
    if not _KEY_RE.fullmatch(imported_key):
        raise ValueError("La key de importacion no es valida.")
    existing = (await db.execute(select(models.AiUniversalAgent).where(models.AiUniversalAgent.key == imported_key))).scalar_one_or_none()
    if existing:
        raise ValueError("Ya existe un agente con esa key; importa una copia con otra key.")
    contract["key"] = imported_key
    contract["status"] = "DRAFT"
    agent = models.AiUniversalAgent(key=imported_key, name=str(contract.get("name") or imported_key), description=str(contract.get("description") or ""), category=str((contract.get("ui") or {}).get("category") or "custom"), origin_type="imported", created_by=user_id)
    db.add(agent)
    await db.flush()
    db.add(models.AiUniversalAgentVersion(agent_id=agent.id, version=str(contract["version"]), status="DRAFT", contract_json=contract, contract_hash=_canonical_hash(contract), source_package_json={"manifest": manifest}, created_by=user_id))
    await db.commit()
    return await get_universal_agent(db, agent.id)


async def export_universal_workflow_package(db: AsyncSession, workflow_id: UUID) -> Dict[str, Any]:
    from .ai_workflows import get_ai_workflow
    from .ai_workflow_serialization import _edge_payload, _node_payload, _workflow_payload

    workflow = await get_ai_workflow(db, workflow_id)
    if workflow.workflow_format != "universal_v2":
        raise ValueError("Solo los workflows universal_v2 se pueden exportar como paquete portable.")
    agents: Dict[str, Dict[str, Any]] = {}
    for node in workflow.nodes:
        version = node.universal_agent_version
        if not version:
            raise ValueError(f"El nodo {node.name} no referencia una version de agente universal.")
        agents[str(version.id)] = {
            "reference": f"{version.agent.key if version.agent else 'universal-agent'}@{version.version}",
            "mode": "reference" if version.agent and version.agent.origin_type == "builtin" else "embedded",
            "version_id": str(version.id),
            "agent_id": str(version.agent_id),
            "contract": version.contract_json or {},
            "contract_hash": version.contract_hash,
        }
    graph = {
        "workflow": _workflow_payload(workflow),
        "nodes": [_node_payload(node, include_versions=False) for node in workflow.nodes],
        "edges": [_edge_payload(edge) for edge in workflow.edges],
        "agents": list(agents.values()),
    }
    workflow_json = json.dumps(graph, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8")
    manifest = {
        "package_format": UNIVERSAL_WORKFLOW_PACKAGE_FORMAT,
        "name": workflow.name,
        "version": str(workflow.version),
        "workflow_format": "universal_v2",
        "agent_contract": UNIVERSAL_AGENT_CONTRACT_VERSION,
        "integrity": {"sha256": hashlib.sha256(workflow_json).hexdigest()},
    }
    files: Dict[str, bytes] = {
        "manifest.json": json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"),
        "workflow.json": workflow_json,
        "fixtures/README.md": b"Fixtures are intentionally empty; executions and evidence are not exported.\n",
        "tests/workflow.contract.test.json": json.dumps({"format": "universal_v2", "nodes": len(workflow.nodes)}).encode("utf-8"),
        "README.md": f"# {workflow.name}\n\nWorkflow portable Treseko Universal v2.\n".encode("utf-8"),
    }
    for version_id, item in agents.items():
        if item["mode"] == "embedded":
            files[f"agents/{version_id}.json"] = json.dumps(item["contract"], ensure_ascii=False, indent=2).encode("utf-8")
    return {"filename": f"{workflow.name.lower().replace(' ', '-')}.treseko-workflow.zip", "package_base64": _zip_payload(files), "sha256": manifest["integrity"]["sha256"]}


async def import_universal_workflow_package(
    db: AsyncSession,
    payload: schemas.AiUniversalWorkflowImport,
    user_id: Optional[UUID],
    *,
    imported_name_suffix: str = " - importado",
    agent_origin_type: str = "imported",
    agent_version_status: str = "DRAFT",
    preserve_catalog_metadata: bool = False,
) -> models.AiWorkflow:
    from .ai_workflows import create_ai_workflow

    if agent_origin_type not in {"builtin", "imported"}:
        raise ValueError("El origen de agente solicitado no es valido.")
    if agent_version_status not in {"DRAFT", "PUBLISHED"}:
        raise ValueError("El estado de version de agente solicitado no es valido.")
    files = _read_zip_payload(payload.package_base64)
    try:
        manifest = json.loads(files["manifest.json"])
        graph = json.loads(files["workflow.json"])
    except (KeyError, json.JSONDecodeError) as exc:
        raise ValueError("El paquete no contiene manifest.json y workflow.json validos.") from exc
    raw_workflow = graph.get("workflow") if isinstance(graph, dict) else None
    if manifest.get("package_format") != UNIVERSAL_WORKFLOW_PACKAGE_FORMAT or manifest.get("workflow_format") != "universal_v2":
        raise ValueError("El paquete no contiene un workflow universal compatible.")
    if manifest.get("integrity", {}).get("sha256") != hashlib.sha256(files["workflow.json"]).hexdigest():
        raise ValueError("El hash de integridad del workflow no coincide.")
    if not isinstance(raw_workflow, dict) or raw_workflow.get("workflow_format") != "universal_v2":
        raise ValueError("El workflow portable no tiene un grafo universal_v2 valido.")
    manifest_purpose = manifest.get("workflow_purpose")
    if manifest_purpose and manifest_purpose != raw_workflow.get("workflow_purpose"):
        raise ValueError("El proposito del manifest no coincide con el workflow.")
    version_map: Dict[str, UUID] = {}
    for source in graph.get("agents") or []:
        if not isinstance(source, dict):
            raise ValueError("El paquete contiene una referencia de agente invalida.")
        source_version_id = str(source.get("version_id") or "")
        contract = source.get("contract") if isinstance(source.get("contract"), dict) else None
        if not contract:
            embedded = files.get(f"agents/{source_version_id}.json")
            contract = json.loads(embedded) if embedded else None
        if not isinstance(contract, dict):
            raise ValueError("No se pudo resolver el contrato de un agente incluido.")
        contract = validate_universal_agent_contract(contract)
        contract_hash = _canonical_hash(contract)
        existing_version = (await db.execute(select(models.AiUniversalAgentVersion).where(models.AiUniversalAgentVersion.contract_hash == contract_hash))).scalar_one_or_none()
        if existing_version:
            version_map[source_version_id] = existing_version.id
            continue
        base_key = contract["key"]
        target_key = base_key
        existing_agent = (await db.execute(select(models.AiUniversalAgent).where(models.AiUniversalAgent.key == target_key))).scalar_one_or_none()
        if existing_agent:
            target_key = f"{base_key}-imported-{contract_hash[:8]}"
            contract["key"] = target_key
        agent = models.AiUniversalAgent(key=target_key, name=str(contract.get("name") or target_key), description=str(contract.get("description") or ""), category=str((contract.get("ui") or {}).get("category") or "custom"), origin_type=agent_origin_type, created_by=user_id)
        db.add(agent)
        await db.flush()
        version = models.AiUniversalAgentVersion(agent_id=agent.id, version=str(contract["version"]), status=agent_version_status, contract_json=contract, contract_hash=_canonical_hash(contract), source_package_json={"workflow_manifest": manifest}, created_by=user_id)
        db.add(version)
        await db.flush()
        version_map[source_version_id] = version.id
    create_payload = workflow_create_payload_from_portable_graph(
        graph,
        version_map,
        imported_name_suffix=imported_name_suffix,
        preserve_catalog_metadata=preserve_catalog_metadata,
    )
    workflow = await create_ai_workflow(db, create_payload, user_id)
    return workflow
