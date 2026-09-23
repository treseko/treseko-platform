"""Small, deny-by-default governance layer for the Treseko MCP endpoint.

The module deliberately contains no shell, filesystem, secret or arbitrary HTTP
adapters.  The catalog is the security boundary: a tool must be declared here
and explicitly enabled by configuration before it can be called.
"""

from __future__ import annotations

import os
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from redis import Redis

from .mcp_tools import HANDLERS as CORE_HANDLERS
from .mcp_extended import HANDLERS as EXTENDED_HANDLERS
from .mcp_limits import McpResultTooLarge, bound_tool_result, request_limit_for_tool
from .mcp_validation import sanitize_arguments, validate_tool_arguments

HANDLERS = {**CORE_HANDLERS, **EXTENDED_HANDLERS}

MCP_MAX_REQUEST_BYTES = 64 * 1024
# Preview carries a bounded base64 package in addition to the JSON envelope.
# Keep ordinary MCP requests at the small protocol limit; only the explicitly
# authorized preview operation receives the larger, still finite admission cap.
MCP_JSON_OVERHEAD_BYTES = 16 * 1024
MCP_MAX_PREVIEW_REQUEST_BYTES = 12_000_000 + MCP_JSON_OVERHEAD_BYTES
MCP_MAX_RESPONSE_BYTES = 256 * 1024
MCP_RATE_LIMIT = 30
MCP_RATE_WINDOW_SECONDS = 60
MCP_DEFAULT_TOOLS = ("treseko.project.get", "treseko.builds.list")
MCP_HEALTH_CACHE_SECONDS = 2.0
MCP_ENABLED_SETTING_KEY = "mcp.enabled"
_configured_enabled: bool | None = None
_configured_enabled_lock = threading.Lock()


def set_configured_mcp_enabled(enabled: bool | None) -> None:
    global _configured_enabled
    with _configured_enabled_lock:
        _configured_enabled = None if enabled is None else bool(enabled)


def configured_mcp_enabled() -> bool:
    with _configured_enabled_lock:
        return bool(_configured_enabled)


def configured_mcp_enabled_state() -> bool | None:
    with _configured_enabled_lock:
        return _configured_enabled
MCP_FORBIDDEN_NAMES = {"shell", "filesystem", "fs", "secrets", "database", "network"}
# Credential scopes are the authoritative permission boundary for MCP.  Keep
# this mapping explicit: adding a catalog tool without assigning a scope must
# not accidentally make it available to existing credentials.
SCOPE_TO_TOOLS: dict[str, frozenset[str]] = {
    "mcp.projects.read": frozenset({"treseko.project.get"}),
    "mcp.builds.read": frozenset({"treseko.builds.list"}),
    "mcp.cases.read": frozenset({"treseko.cases.list"}),
    "mcp.cases.detail": frozenset({"treseko.cases.get"}),
    "mcp.test-runs.list": frozenset({"treseko.test-runs.list"}),
    "mcp.test-runs.detail": frozenset({"treseko.test-runs.get"}),
    "mcp.test-results.list": frozenset({"treseko.test-results.list"}),
    "mcp.test-results.detail": frozenset({"treseko.test-results.get"}),
    "mcp.bugs.list": frozenset({"treseko.bugs.list"}),
    "mcp.bugs.detail": frozenset({"treseko.bugs.get"}),
    "mcp.quality.summary": frozenset({"treseko.quality.summary"}),
    "mcp.evidence.read": frozenset({"treseko.evidence.list", "treseko.evidence.get"}),
    "mcp.environments.read": frozenset({"treseko.environments.list", "treseko.environments.get", "treseko.datasets.list", "treseko.datasets.get"}),
    "mcp.cases.versions": frozenset({"treseko.cases.versions.list"}),
    "mcp.quality.trends": frozenset({"treseko.quality.trends", "treseko.quality.compare"}),
    "mcp.test-runs.write": frozenset({"treseko.test-runs.create", "treseko.test-runs.execute", "treseko.test-runs.cancel"}),
    "mcp.test-runs.lifecycle": frozenset({"treseko.test-runs.status"}),
    "mcp.cases.write": frozenset({"treseko.cases.create", "treseko.cases.update", "treseko.cases.archive"}),
    "mcp.bugs.write": frozenset({"treseko.bugs.create-from-result", "treseko.bugs.create-from-snapshot", "treseko.bugs.update", "treseko.bugs.transition", "treseko.bugs.close"}),
    "mcp.cases.import.preview": frozenset({"treseko.cases.import.preview"}),
    "mcp.cases.import.commit": frozenset({"treseko.cases.import.commit"}),
    "mcp.cases.import.rollback": frozenset({"treseko.cases.import.rollback"}),
    # Accepted historical spellings remain valid during the migration.
    "treseko.project.get": frozenset({"treseko.project.get"}),
    "treseko.builds.list": frozenset({"treseko.builds.list"}),
}


@dataclass(frozen=True)
class McpTool:
    name: str
    description: str
    version: str = "1.0"
    capability: str = "proyectos.portfolio"
    read_only: bool = True
    operation: str = "read"
    required_scope: str = "mcp.projects.read"
    sensitivity: str = "non_sensitive"
    handler_key: str = "project.get"
    max_result_bytes: int = MCP_MAX_RESPONSE_BYTES - 512
    max_string_chars: int = 4096

    @property
    def input_schema(self) -> dict[str, Any]:
        mutation_shapes = {
            "treseko.test-runs.create": (["project_id", "name", "environment", "build_id", "case_ids", "confirmation", "idempotency_key"], {"name": {"type": "string", "maxLength": 256}, "environment": {"type": "string", "maxLength": 256}, "environment_id": {"type": "string", "format": "uuid"}, "dataset_id": {"type": "string", "format": "uuid"}, "build_id": {"type": "string", "format": "uuid"}, "case_ids": {"type": "array", "maxItems": 100, "items": {"type": "string", "format": "uuid"}}, "origin": {"type": "string", "enum": ["MANUAL", "AUTOMATIZADA"]}, "confirmation": {"type": "string", "const": "CREATE_TEST_RUN"}, "idempotency_key": {"type": "string", "minLength": 1, "maxLength": 128}}),
            "treseko.test-runs.execute": (["project_id", "run_id", "confirmation", "idempotency_key"], {"run_id": {"type": "string", "format": "uuid"}, "confirmation": {"type": "string", "const": "EXECUTE_TEST_RUN"}, "idempotency_key": {"type": "string", "minLength": 1, "maxLength": 128}}),
            "treseko.test-runs.status": (["project_id", "run_id"], {"run_id": {"type": "string", "format": "uuid"}}),
            "treseko.test-runs.cancel": (["project_id", "run_id", "confirmation", "idempotency_key"], {"run_id": {"type": "string", "format": "uuid"}, "confirmation": {"type": "string", "const": "CANCEL_TEST_RUN"}, "idempotency_key": {"type": "string", "minLength": 1, "maxLength": 128}}),
        }
        if self.name in mutation_shapes:
            required, extra = mutation_shapes[self.name]
            return {"type": "object", "required": required, "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, **extra}}
        if self.name in {"treseko.cases.create", "treseko.cases.update", "treseko.cases.archive", "treseko.bugs.create-from-result", "treseko.bugs.create-from-snapshot", "treseko.bugs.update", "treseko.bugs.transition", "treseko.bugs.close"}:
            required = ["project_id", "confirmation", "idempotency_key"]
            if self.name == "treseko.cases.create":
                required.append("title")
            if self.name in {"treseko.bugs.create-from-result", "treseko.bugs.create-from-snapshot"}:
                required.append("bug")
            if self.name.endswith(".update") or self.name.endswith(".archive") or self.name.endswith(".transition") or self.name.endswith(".close"):
                required.insert(1, "case_id" if self.name.startswith("treseko.cases") else "bug_id")
            if "from-result" in self.name: required.insert(1, "execution_id")
            if "from-snapshot" in self.name: required.insert(1, "snapshot_id")
            confirmation = {"type": "string", "const": {"treseko.cases.create": "CREATE_CASE", "treseko.cases.update": "UPDATE_CASE", "treseko.cases.archive": "ARCHIVE_CASE", "treseko.bugs.create-from-result": "CREATE_BUG_FROM_RESULT", "treseko.bugs.create-from-snapshot": "CREATE_BUG_FROM_SNAPSHOT", "treseko.bugs.update": "UPDATE_BUG", "treseko.bugs.transition": "TRANSITION_BUG", "treseko.bugs.close": "TRANSITION_BUG"}.get(self.name, "MUTATE")}
            step = {"type": "object", "required": ["action", "expected_result"], "additionalProperties": False, "properties": {"number": {"type": "integer", "minimum": 1, "maximum": 1000}, "action": {"type": "string", "minLength": 1, "maxLength": 10000}, "data": {}, "expected_result": {"type": "string", "minLength": 1, "maxLength": 10000}}}
            bug_update = {"type": "object", "additionalProperties": False, "properties": {"title": {"type": "string", "minLength": 1, "maxLength": 255}, "description": {"type": "string", "maxLength": 20000}, "severity": {"type": "string", "maxLength": 30}, "priority": {"type": "string", "maxLength": 30}, "status": {"type": "string", "maxLength": 30}, "expected_result": {"type": "string", "maxLength": 20000}, "actual_result": {"type": "string", "maxLength": 20000}, "test_data": {"type": "string", "maxLength": 20000}, "comment": {"type": "string", "maxLength": 10000}}}
            transition = {"type": "object", "required": ["status"], "additionalProperties": False, "properties": {"status": {"type": "string", "minLength": 1, "maxLength": 30}, "resolution_build_id": {"type": "string", "format": "uuid"}, "resolution": {"type": "string", "maxLength": 20000}, "close_reason": {"type": "string", "maxLength": 20000}}}
            return {"type": "object", "required": required, "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, "case_id": {"type": "string", "format": "uuid"}, "bug_id": {"type": "string", "format": "uuid"}, "execution_id": {"type": "string", "format": "uuid"}, "snapshot_id": {"type": "string", "format": "uuid"}, "confirmation": confirmation, "idempotency_key": {"type": "string", "minLength": 1, "maxLength": 128}, "name": {"type": "string", "maxLength": 256}, "title": {"type": "string", "minLength": 1, "maxLength": 255}, "description": {"type": "string", "maxLength": 20000}, "priority": {"type": "string", "maxLength": 30}, "criticality": {"type": "string", "maxLength": 30}, "test_type": {"type": "string", "enum": ["MANUAL", "AUTOMATIZADA", "AUTOMATIZADA_AI"]}, "format": {"type": "string", "enum": ["CLASICA", "API"]}, "steps": {"type": "array", "maxItems": 100, "items": step}, "dataset": {"type": "array", "maxItems": 100}, "api_configuration": {"type": "object", "additionalProperties": False}, "bug": bug_update, "transition": transition}}
        schemas = {
            "treseko.evidence.list": (["project_id", "snapshot_id"], {"snapshot_id": {"type": "string", "format": "uuid"}}),
            "treseko.evidence.get": (["project_id", "evidence_id"], {"evidence_id": {"type": "string", "format": "uuid"}}),
            "treseko.environments.list": (["project_id"], {}),
            "treseko.environments.get": (["project_id", "environment_id"], {"environment_id": {"type": "string", "format": "uuid"}}),
            "treseko.datasets.list": (["project_id", "environment_id"], {"environment_id": {"type": "string", "format": "uuid"}}),
            "treseko.datasets.get": (["project_id", "dataset_id"], {"dataset_id": {"type": "string", "format": "uuid"}}),
            "treseko.cases.versions.list": (["project_id", "case_id"], {"case_id": {"type": "string", "format": "uuid"}}),
            "treseko.quality.trends": (["project_id"], {"limit": {"type": "integer", "minimum": 1, "maximum": 50}}),
            "treseko.quality.compare": (["project_id", "baseline_build_id", "candidate_build_id"], {"baseline_build_id": {"type": "string", "format": "uuid"}, "candidate_build_id": {"type": "string", "format": "uuid"}}),
        }
        if self.name in schemas:
            required, extra = schemas[self.name]
            return {"type": "object", "required": required, "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, **extra}}
        if self.name == "treseko.cases.list":
            return {"type": "object", "required": ["project_id"], "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, "limit": {"type": "integer", "minimum": 1, "maximum": 100}, "offset": {"type": "integer", "minimum": 0, "maximum": 10000}}}
        if self.name == "treseko.cases.get":
            return {"type": "object", "required": ["project_id", "case_id"], "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, "case_id": {"type": "string", "format": "uuid"}}}
        if self.name == "treseko.test-runs.list":
            return {"type": "object", "required": ["project_id"], "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, "limit": {"type": "integer", "minimum": 1, "maximum": 100}, "offset": {"type": "integer", "minimum": 0, "maximum": 10000}}}
        if self.name == "treseko.test-runs.get":
            return {"type": "object", "required": ["project_id", "run_id"], "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, "run_id": {"type": "string", "format": "uuid"}}}
        if self.name == "treseko.test-results.list":
            return {"type": "object", "required": ["project_id", "run_id"], "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, "run_id": {"type": "string", "format": "uuid"}, "limit": {"type": "integer", "minimum": 1, "maximum": 100}, "offset": {"type": "integer", "minimum": 0, "maximum": 10000}}}
        if self.name == "treseko.test-results.get":
            return {"type": "object", "required": ["project_id", "execution_id"], "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, "execution_id": {"type": "string", "format": "uuid"}}}
        if self.name == "treseko.bugs.list":
            return {"type": "object", "required": ["project_id"], "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, "build_id": {"type": "string", "format": "uuid"}, "estado": {"type": "string", "maxLength": 30}, "severidad": {"type": "string", "maxLength": 20}, "prioridad": {"type": "string", "maxLength": 20}, "limit": {"type": "integer", "minimum": 1, "maximum": 100}, "offset": {"type": "integer", "minimum": 0, "maximum": 10000}}}
        if self.name == "treseko.bugs.get":
            return {"type": "object", "required": ["project_id", "bug_id"], "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, "bug_id": {"type": "string", "format": "uuid"}}}
        if self.name == "treseko.quality.summary":
            return {"type": "object", "required": ["project_id", "build_id"], "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, "build_id": {"type": "string", "format": "uuid"}}}
        if self.operation == "preview":
            return {
                "type": "object",
                "required": ["project_id", "profile_id", "content_base64"],
                "additionalProperties": False,
                "properties": {
                    "project_id": {"type": "string", "format": "uuid"},
                    "profile_id": {"type": "string", "maxLength": 100},
                    "content_base64": {"type": "string", "maxLength": 12000000},
                    "file_name": {"type": "string", "maxLength": 255},
                    "component_id": {"type": "string", "format": "uuid"},
                    "build_id": {"type": "string", "format": "uuid"},
                },
            }
        if self.operation == "commit":
            return {"type": "object", "required": ["project_id", "profile_id", "content_base64", "component_id", "confirmation", "preview_token", "package_sha256", "idempotency_key"], "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, "profile_id": {"type": "string", "maxLength": 100}, "content_base64": {"type": "string", "maxLength": 12000000}, "file_name": {"type": "string", "maxLength": 255}, "selected_external_ids": {"type": "array", "maxItems": 500, "items": {"type": "string", "maxLength": 255}}, "component_id": {"type": "string", "format": "uuid"}, "build_id": {"type": "string", "format": "uuid"}, "confirmation": {"type": "string", "const": "APPLY_CASE_IMPORT"}, "preview_token": {"type": "string", "maxLength": 128}, "package_sha256": {"type": "string", "pattern": "^[0-9a-f]{64}$"}, "idempotency_key": {"type": "string", "minLength": 1, "maxLength": 128}}}
        if self.operation == "rollback":
            return {"type": "object", "required": ["project_id", "batch_id", "commit_receipt", "rollback_token", "confirmation", "idempotency_key"], "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, "batch_id": {"type": "string", "format": "uuid"}, "commit_receipt": {"type": "string", "maxLength": 128}, "rollback_token": {"type": "string", "maxLength": 128}, "confirmation": {"type": "string", "const": "ROLLBACK_CASE_IMPORT"}, "idempotency_key": {"type": "string", "minLength": 1, "maxLength": 128}}}
        return {"type": "object", "required": ["project_id"], "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}}}


TOOL_CATALOG: dict[str, McpTool] = {
    "treseko.project.get": McpTool(
        name="treseko.project.get",
        description="Consulta los metadatos no sensibles de un proyecto permitido.",
    ),
    "treseko.builds.list": McpTool(
        name="treseko.builds.list",
        description="Consulta las builds de un proyecto permitido, incluidas las históricas.",
        required_scope="mcp.builds.read",
        handler_key="builds.list",
    ),
    "treseko.cases.list": McpTool(name="treseko.cases.list", description="Consulta los casos de prueba de un proyecto permitido.", required_scope="mcp.cases.read", handler_key="cases.list"),
    "treseko.cases.get": McpTool(name="treseko.cases.get", description="Consulta un caso de prueba permitido, incluidos sus pasos.", required_scope="mcp.cases.detail", handler_key="cases.get"),
    "treseko.test-runs.list": McpTool(name="treseko.test-runs.list", description="Lista ejecuciones de prueba de un proyecto permitido.", required_scope="mcp.test-runs.list", handler_key="test-runs.list"),
    "treseko.test-runs.get": McpTool(name="treseko.test-runs.get", description="Consulta una ejecución de prueba de un proyecto permitido.", required_scope="mcp.test-runs.detail", handler_key="test-runs.get"),
    "treseko.test-results.list": McpTool(name="treseko.test-results.list", description="Lista resultados de una ejecución de prueba autorizada.", required_scope="mcp.test-results.list", handler_key="test-results.list"),
    "treseko.test-results.get": McpTool(name="treseko.test-results.get", description="Consulta un resultado de prueba de un proyecto permitido.", required_scope="mcp.test-results.detail", handler_key="test-results.get"),
    "treseko.bugs.list": McpTool(name="treseko.bugs.list", description="Lista bugs saneados de un proyecto permitido.", required_scope="mcp.bugs.list", handler_key="bugs.list"),
    "treseko.bugs.get": McpTool(name="treseko.bugs.get", description="Consulta un bug saneado de un proyecto permitido.", required_scope="mcp.bugs.detail", handler_key="bugs.get"),
    "treseko.quality.summary": McpTool(name="treseko.quality.summary", description="Devuelve agregados acotados de calidad de una build.", required_scope="mcp.quality.summary", handler_key="quality.summary"),
    "treseko.evidence.list": McpTool(name="treseko.evidence.list", description="Lista metadatos y URLs de evidencia de un snapshot.", required_scope="mcp.evidence.read", handler_key="evidence.list"),
    "treseko.evidence.get": McpTool(name="treseko.evidence.get", description="Obtiene metadatos de una evidencia sin blobs.", required_scope="mcp.evidence.read", handler_key="evidence.get"),
    "treseko.environments.list": McpTool(name="treseko.environments.list", description="Lista ambientes activos sin exponer credenciales.", required_scope="mcp.environments.read", handler_key="environments.list"),
    "treseko.environments.get": McpTool(name="treseko.environments.get", description="Obtiene un ambiente sin valores secretos.", required_scope="mcp.environments.read", handler_key="environments.get"),
    "treseko.datasets.list": McpTool(name="treseko.datasets.list", description="Lista datasets activos con variables redactadas.", required_scope="mcp.environments.read", handler_key="datasets.list"),
    "treseko.datasets.get": McpTool(name="treseko.datasets.get", description="Obtiene un dataset con variables redactadas.", required_scope="mcp.environments.read", handler_key="datasets.get"),
    "treseko.cases.versions.list": McpTool(name="treseko.cases.versions.list", description="Lista versiones de un caso preservando formato y tipo.", required_scope="mcp.cases.versions", handler_key="cases.versions.list"),
    "treseko.quality.trends": McpTool(name="treseko.quality.trends", description="Compara tendencias usando conteos persistidos.", required_scope="mcp.quality.trends", handler_key="quality.trends"),
    "treseko.quality.compare": McpTool(name="treseko.quality.compare", description="Compara dos builds con métricas persistidas.", required_scope="mcp.quality.trends", handler_key="quality.compare"),

    "treseko.cases.import.preview": McpTool(
        name="treseko.cases.import.preview",
        description="Valida un paquete de casos sin persistir cambios.",
        read_only=False,
        operation="preview",
        required_scope="mcp.cases.import.preview",
        handler_key="cases.import.preview",
    ),
    "treseko.cases.import.commit": McpTool(
        name="treseko.cases.import.commit",
        description="Importa un paquete de casos en un proyecto autorizado.",
        read_only=False,
        operation="commit",
        required_scope="mcp.cases.import.commit",
        handler_key="cases.import.commit",
    ),
    "treseko.cases.import.rollback": McpTool(
        name="treseko.cases.import.rollback",
        description="Revierte únicamente una importación MCP confirmada y recibida.",
        read_only=False,
        operation="rollback",
        required_scope="mcp.cases.import.rollback",
        handler_key="cases.import.rollback",
    ),
    **{name: McpTool(name=name, description="Operación MCP gobernada.", read_only=(name == "treseko.test-runs.status"), operation=("read" if name == "treseko.test-runs.status" else "commit"), required_scope=scope, capability=capability, handler_key=key)
       for name, scope, capability, key in [
           ("treseko.test-runs.create", "mcp.test-runs.write", "ejecutar.manual", "test-runs.create"),
           ("treseko.test-runs.execute", "mcp.test-runs.write", "ejecutar.automatizada", "test-runs.execute"),
           ("treseko.test-runs.status", "mcp.test-runs.lifecycle", "ejecutar.manual", "test-runs.status"),
           ("treseko.test-runs.cancel", "mcp.test-runs.write", "ejecutar.manual", "test-runs.cancel"),
           ("treseko.cases.create", "mcp.cases.write", "crear_pruebas.casos", "cases.create"),
           ("treseko.cases.update", "mcp.cases.write", "crear_pruebas.casos", "cases.update"),
           ("treseko.cases.archive", "mcp.cases.write", "crear_pruebas.casos", "cases.archive"),
           ("treseko.bugs.create-from-result", "mcp.bugs.write", "bugs.editar", "bugs.create-from-result"),
           ("treseko.bugs.create-from-snapshot", "mcp.bugs.write", "bugs.editar", "bugs.create-from-snapshot"),
           ("treseko.bugs.update", "mcp.bugs.write", "bugs.editar", "bugs.update"),
           ("treseko.bugs.transition", "mcp.bugs.write", "bugs.editar", "bugs.transition"),
           ("treseko.bugs.close", "mcp.bugs.write", "bugs.editar", "bugs.close"),
       ]},
}


def _shared_limiter_url() -> str:
    return (os.getenv("TRESEKO_MCP_RATE_LIMIT_REDIS_URL", "").strip() or os.getenv("REDIS_URL", "").strip())


_health_cache: dict[str, tuple[float, bool]] = {}
_health_lock = threading.Lock()


def _shared_limiter_healthy(url: str) -> bool:
    """Ping Redis with bounded socket timeouts and a short safe cache."""
    now = time.monotonic()
    with _health_lock:
        cached = _health_cache.get(url)
        if cached and now - cached[0] < MCP_HEALTH_CACHE_SECONDS:
            return cached[1]
    healthy = False
    try:
        client = Redis.from_url(url, decode_responses=True, socket_connect_timeout=0.2, socket_timeout=0.2)
        healthy = bool(client.ping())
    except Exception:  # noqa: BLE001 - admission is deny-by-default
        healthy = False
    with _health_lock:
        _health_cache[url] = (now, healthy)
    return healthy


def mcp_enabled() -> bool:
    enabled = configured_mcp_enabled()
    if not enabled:
        return False
    topology = os.getenv("TRESEKO_MCP_DEPLOYMENT_TOPOLOGY", "").strip().lower()
    url = _shared_limiter_url()
    if topology not in {"", "single_process", "shared_redis"}:
        return False
    if deployment_requires_shared_limiter() or topology == "shared_redis":
        return bool(url and _shared_limiter_healthy(url))
    if topology == "single_process":
        return True
    # A missing declaration is ambiguous. A configured Redis URL is an
    # explicit shared-limiter declaration; otherwise MCP stays off.
    return bool(url and _shared_limiter_healthy(url))


def deployment_requires_shared_limiter() -> bool:
    """Detect only explicit multi-process deployment declarations."""
    for name in ("TRESEKO_MCP_MULTI_WORKER", "TRESEKO_MCP_MULTI_REPLICA"):
        if os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}:
            return True
    for name in ("WEB_CONCURRENCY", "TRESEKO_MCP_WORKERS", "TRESEKO_MCP_REPLICAS"):
        try:
            if int(os.getenv(name, "1")) > 1:
                return True
        except ValueError:
            return True
    return False


def enabled_tool_names() -> set[str]:
    configured = os.getenv("TRESEKO_MCP_TOOLS", "").strip()
    if not configured:
        return set(TOOL_CATALOG)
    names = {item.strip() for item in configured.split(",") if item.strip()}
    return names & set(TOOL_CATALOG)


def validate_scopes(scopes: Any) -> list[str]:
    if not isinstance(scopes, list) or any(not isinstance(scope, str) for scope in scopes):
        raise ValueError("scopes debe ser una lista de scopes MCP")
    normalized = list(dict.fromkeys(scope.strip() for scope in scopes))
    if any(not scope or scope not in SCOPE_TO_TOOLS for scope in normalized):
        raise ValueError("scope MCP desconocido")
    return normalized


def validate_scopes_for_user(scopes: Any, user) -> list[str]:
    """Validate scope names and reject scopes outside the user's RBAC."""
    normalized = validate_scopes(scopes)
    from .. import auth

    for scope in normalized:
        tools = [TOOL_CATALOG[name] for name in SCOPE_TO_TOOLS[scope] if name in TOOL_CATALOG]
        if not tools:
            raise ValueError("scope MCP sin herramientas disponibles")
        required_level = "edit" if any(tool.operation in {"commit", "rollback"} for tool in tools) else "read"
        if not all(auth.has_capability_permission(user, tool.capability, required_level) for tool in tools):
            raise ValueError(f"scope MCP no permitido para el usuario: {scope}")
    return normalized


def tool_allowed_by_scopes(tool_name: str, scopes: Any) -> bool:
    if not isinstance(scopes, list) or any(scope not in SCOPE_TO_TOOLS for scope in scopes):
        return False
    return any(tool_name in SCOPE_TO_TOOLS[scope] for scope in scopes)


def public_tools(scopes: Any = None) -> list[dict[str, Any]]:
    enabled = enabled_tool_names()
    allowed = None if scopes is None else set().union(*(SCOPE_TO_TOOLS.get(scope, frozenset()) for scope in scopes))
    return [
        {"name": tool.name, "description": tool.description, "version": tool.version,
         "capability": tool.capability, "read_only": tool.read_only,
         "operation": tool.operation, "required_scope": tool.required_scope,
         "sensitivity": tool.sensitivity, "handler_key": tool.handler_key,
         "inputSchema": tool.input_schema}
        for name, tool in TOOL_CATALOG.items()
        if name in enabled and (allowed is None or name in allowed)
        and ((tool.operation == "read" and tool.read_only) or tool.operation in {"preview", "commit", "rollback"})
        and tool.name in SCOPE_TO_TOOLS.get(tool.required_scope, frozenset())
        and callable(HANDLERS.get(tool.handler_key))
    ]


def resolve_tool(name: str) -> McpTool | None:
    normalized = str(name or "").strip()
    if normalized.lower() in MCP_FORBIDDEN_NAMES or normalized not in TOOL_CATALOG:
        return None
    if normalized not in enabled_tool_names():
        return None
    tool = TOOL_CATALOG[normalized]
    if (
        not ((tool.operation == "read" and tool.read_only) or tool.operation in {"preview", "commit", "rollback"})
        or tool.name not in SCOPE_TO_TOOLS.get(tool.required_scope, frozenset())
        or not callable(HANDLERS.get(tool.handler_key))
    ):
        return None
    return tool


'''validate_tool_arguments moved to mcp_validation to keep this boundary small.'''
'''sanitize_arguments moved to mcp_validation.'''
class McpRateLimiter:
    """Bounded process-local fallback; use shared Redis at multi-worker scale."""

    def __init__(self, limit: int = MCP_RATE_LIMIT, window_seconds: int = MCP_RATE_WINDOW_SECONDS, max_identities: int = 4096):
        self.limit = limit
        self.window_seconds = window_seconds
        self.max_identities = max(1, max_identities)
        self._calls: OrderedDict[str, list[float]] = OrderedDict()
        self._lock = threading.Lock()

    def allow(self, identity: str) -> bool:
        now = time.monotonic()
        with self._lock:
            calls = [stamp for stamp in self._calls.get(identity, []) if now - stamp < self.window_seconds]
            self._calls.pop(identity, None)
            if len(calls) >= self.limit:
                self._calls[identity] = calls
                return False
            calls.append(now)
            self._calls[identity] = calls
            while len(self._calls) > self.max_identities:
                self._calls.popitem(last=False)
            return True


class McpRedisRateLimiter:
    """Shared fixed-window limiter for multi-worker deployments."""

    def __init__(self, url: str, limit: int = MCP_RATE_LIMIT, window_seconds: int = MCP_RATE_WINDOW_SECONDS):
        self.client = Redis.from_url(url, decode_responses=True, socket_connect_timeout=0.2, socket_timeout=0.2)
        self.limit = limit
        self.window_seconds = window_seconds

    def allow(self, identity: str) -> bool:
        bucket = int(time.time() // self.window_seconds)
        key = f"treseko:mcp:rate:{identity}:{bucket}"
        try:
            pipe = self.client.pipeline()
            pipe.incr(key)
            pipe.expire(key, self.window_seconds)
            count, _ = pipe.execute()
            return int(count) <= self.limit
        except Exception:  # noqa: BLE001 - fail closed on limiter outage
            return False


def _rate_limiter():
    url = _shared_limiter_url()
    topology = os.getenv("TRESEKO_MCP_DEPLOYMENT_TOPOLOGY", "").strip().lower()
    return McpRedisRateLimiter(url) if url and (deployment_requires_shared_limiter() or topology == "shared_redis") else McpRateLimiter()


rate_limiter = _rate_limiter()

class McpRateLimiter:
    """Bounded process-local fallback; use shared Redis at multi-worker scale."""

    def __init__(self, limit: int = MCP_RATE_LIMIT, window_seconds: int = MCP_RATE_WINDOW_SECONDS, max_identities: int = 4096):
        self.limit = limit
        self.window_seconds = window_seconds
        self.max_identities = max(1, max_identities)
        self._calls: OrderedDict[str, list[float]] = OrderedDict()
        self._lock = threading.Lock()

    def allow(self, identity: str) -> bool:
        now = time.monotonic()
        with self._lock:
            calls = [stamp for stamp in self._calls.get(identity, []) if now - stamp < self.window_seconds]
            self._calls.pop(identity, None)
            if len(calls) >= self.limit:
                self._calls[identity] = calls
                return False
            calls.append(now)
            self._calls[identity] = calls
            while len(self._calls) > self.max_identities:
                self._calls.popitem(last=False)
            return True


class McpRedisRateLimiter:
    """Shared fixed-window limiter for multi-worker deployments."""

    def __init__(self, url: str, limit: int = MCP_RATE_LIMIT, window_seconds: int = MCP_RATE_WINDOW_SECONDS):
        self.client = Redis.from_url(url, decode_responses=True, socket_connect_timeout=0.2, socket_timeout=0.2)
        self.limit = limit
        self.window_seconds = window_seconds

    def allow(self, identity: str) -> bool:
        bucket = int(time.time() // self.window_seconds)
        key = f"treseko:mcp:rate:{identity}:{bucket}"
        try:
            pipe = self.client.pipeline()
            pipe.incr(key)
            pipe.expire(key, self.window_seconds)
            count, _ = pipe.execute()
            return int(count) <= self.limit
        except Exception:  # noqa: BLE001 - fail closed on limiter outage
            return False


def _rate_limiter():
    url = _shared_limiter_url()
    topology = os.getenv("TRESEKO_MCP_DEPLOYMENT_TOPOLOGY", "").strip().lower()
    return McpRedisRateLimiter(url) if url and (deployment_requires_shared_limiter() or topology == "shared_redis") else McpRateLimiter()


rate_limiter = _rate_limiter()