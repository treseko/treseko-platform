"""Audit FastAPI route authorization declarations.

This script intentionally reads source files instead of importing the app, so it
can run without initializing the database or executing startup hooks.
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP_DIR = ROOT / "app"
SCAN_PATHS = [
    APP_DIR / "main.py",
    *(APP_DIR / "routers").glob("*.py"),
    *(APP_DIR / "api" / "routers").glob("*.py"),
]
HTTP_METHODS = {"get", "post", "put", "patch", "delete"}


@dataclass(frozen=True)
class RouteAudit:
    method: str
    path: str
    handler: str
    auth: str
    check_module: str
    module: str
    level: str
    status: str
    file: str
    line: int


def _is_route_decorator(node: ast.AST) -> tuple[str, str, str] | None:
    if not isinstance(node, ast.Call):
        return None
    func = node.func
    if not isinstance(func, ast.Attribute) or func.attr not in HTTP_METHODS:
        return None
    if not isinstance(func.value, ast.Name):
        return None
    if func.value.id != "app" and not func.value.id.endswith("_router") and func.value.id != "router":
        return None
    if not node.args or not isinstance(node.args[0], ast.Constant):
        return None
    return func.attr.upper(), str(node.args[0].value), func.value.id


def _router_prefix(tree: ast.AST, router_name: str) -> str:
    """Read the literal prefix declared on the module-level ``router``.

    Decorators keep local paths while FastAPI exposes the joined path. The
    audit must mirror that join before comparing static contracts with the
    runtime route table.
    """
    for node in getattr(tree, "body", []):
        if not isinstance(node, ast.Assign):
            continue
        if not any(isinstance(target, ast.Name) and target.id == router_name for target in node.targets):
            continue
        if not isinstance(node.value, ast.Call):
            continue
        if not isinstance(node.value.func, ast.Name) or node.value.func.id != "APIRouter":
            continue
        for keyword in node.value.keywords:
            if keyword.arg == "prefix" and isinstance(keyword.value, ast.Constant) and isinstance(keyword.value.value, str):
                return keyword.value.value.rstrip("/")
    return ""


def _runtime_path(prefix: str, route_path: str) -> str:
    if not prefix:
        return route_path or "/"
    joined = f"{prefix}/{route_path.lstrip('/')}"
    return joined.rstrip("/") or "/"


def _public_status(path: str) -> str | None:
    public_exact = {
        "/auth/login/",
        "/auth/register/",
        "/auth/refresh/",
        "/auth/ad/config/public/",
        "/auth/ad/login/",
        "/auth/ad/callback/",
        "/auth/ad/exchange/",
        "/auth/ad/password-login/",
        "/auth/activate/",
        "/health",
        "/system/version",
        "/system/branding/public",
        "/automation-runners/pairing-requests",
        "/automation-runners/pairing-requests/{code}",
        "/automation-runners/register",
    }
    # Shared reports are protected by their unguessable publication token,
    # therefore they are intentionally reachable without a user session.
    public_prefixes = ("/s/reports/", "/static/", "/informes/")
    if path in public_exact or path.startswith(public_prefixes):
        return "PUBLIC_INTENTIONAL"
    if path.startswith("/debug/"):
        return "REVIEW"
    return None


def _authenticated_intent(path: str) -> tuple[str, str] | None:
    """Classify authenticated endpoints whose resource is the current session.

    These routes intentionally have no assignable module capability: adding one
    would prevent users from ending their session, reading their own identity,
    or completing account-level setup.
    """
    self_service = {
        "/auth/logout/",
        "/users/me/",
        "/users/me/language",
        "/users/me/password",
    }
    authenticated_metadata = {
        "/system/edition",
        "/system/features",
        "/system/first-run",
    }
    if path in self_service:
        return "self_service", "current-user"
    if path in authenticated_metadata:
        return "system", "authenticated-metadata"
    if path == "/organizaciones/":
        return "organizaciones", "organization-membership-scope"
    return None


def _qualified_name(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        owner = _qualified_name(node.value)
        return f"{owner}.{node.attr}" if owner else node.attr
    return ""


class _ExpressionCallVisitor(ast.NodeVisitor):
    """Collect calls from one expression without crossing deferred bodies."""

    def __init__(self) -> None:
        self.calls: list[ast.Call] = []

    def visit_Call(self, node: ast.Call) -> None:  # noqa: N802 - ast API
        self.calls.append(node)
        self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:  # noqa: N802
        return

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:  # noqa: N802
        return

    def visit_Lambda(self, node: ast.Lambda) -> None:  # noqa: N802
        return

    def visit_ListComp(self, node: ast.ListComp) -> None:  # noqa: N802
        return

    def visit_SetComp(self, node: ast.SetComp) -> None:  # noqa: N802
        return

    def visit_DictComp(self, node: ast.DictComp) -> None:  # noqa: N802
        return

    def visit_GeneratorExp(self, node: ast.GeneratorExp) -> None:  # noqa: N802
        return


def _block_always_exits(statements: list[ast.stmt]) -> bool:
    if not statements:
        return False
    last = statements[-1]
    if isinstance(last, (ast.Return, ast.Raise)):
        return True
    if isinstance(last, ast.If):
        return _block_always_exits(last.body) and _block_always_exits(last.orelse)
    return False


def _is_fail_closed_permission_guard(node: ast.If) -> bool:
    """Recognize ``if not has_permission(...): raise/return`` guards."""
    if not _block_always_exits(node.body):
        return False
    test = node.test
    if not isinstance(test, ast.UnaryOp) or not isinstance(test.op, ast.Not):
        return False
    return any(
        _qualified_name(call.func) in {
            "auth.has_capability_permission",
            "auth.has_module_permission",
        }
        for call in ast.walk(test.operand)
        if isinstance(call, ast.Call)
    )


def _reachable_calls(node: ast.AST) -> list[ast.Call]:
    """Return only calls that dominate the handler's continuing path.

    Calls hidden in dynamic branches, loops, exception handlers or after a
    terminal statement cannot prove that every protected operation is guarded.
    """
    visitor = _ExpressionCallVisitor()
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        for decorator in node.decorator_list:
            visitor.visit(decorator)
        for default in [*node.args.defaults, *node.args.kw_defaults]:
            if default is not None:
                visitor.visit(default)
        for statement in node.body:
            if isinstance(statement, ast.If):
                if _is_fail_closed_permission_guard(statement):
                    visitor.visit(statement.test)
                continue
            if isinstance(statement, ast.Return):
                if statement.value is not None:
                    visitor.visit(statement.value)
                break
            if isinstance(statement, ast.Raise):
                if statement.exc is not None:
                    visitor.visit(statement.exc)
                break
            if isinstance(statement, (ast.For, ast.AsyncFor, ast.While, ast.Try, ast.With, ast.AsyncWith, ast.Match)):
                continue
            visitor.visit(statement)
    else:
        visitor.visit(node)
    return visitor.calls


def _calls(node: ast.AST, name: str) -> list[ast.Call]:
    return [call for call in _reachable_calls(node) if _qualified_name(call.func) == name]


def _literal_string(node: ast.AST | None) -> str | None:
    return str(node.value) if isinstance(node, ast.Constant) and isinstance(node.value, str) else None


def _extract_check_module(node: ast.AST) -> tuple[str, str] | None:
    for call in _calls(node, "auth.check_module"):
        module = _literal_string(call.args[0]) if call.args else None
        level = _literal_string(call.args[1]) if len(call.args) > 1 else "read"
        if module:
            return module, level or "read"
    return None


def _extract_check_capability(node: ast.AST) -> tuple[str, str] | None:
    for call in _calls(node, "auth.check_capability"):
        capability = _literal_string(call.args[0]) if call.args else None
        level = _literal_string(call.args[1]) if len(call.args) > 1 else "read"
        if capability:
            return capability, level or "read"
    return None


def _extract_check_any_capability(node: ast.AST) -> list[tuple[str, str]]:
    requirements: list[tuple[str, str]] = []
    for call in _calls(node, "auth.check_any_capability"):
        for item in call.args:
            if isinstance(item, (ast.List, ast.Tuple)) and len(item.elts) >= 2:
                capability = _literal_string(item.elts[0])
                level = _literal_string(item.elts[1])
                if capability and level:
                    requirements.append((capability, level))
    return requirements


def _extract_check_capabilities(node: ast.AST) -> list[tuple[str, str]]:
    requirements: list[tuple[str, str]] = []
    for call in _calls(node, "auth.check_capabilities"):
        items = call.args
        if len(call.args) == 1 and isinstance(call.args[0], ast.List):
            items = call.args[0].elts
        for item in items:
            if isinstance(item, (ast.List, ast.Tuple)) and len(item.elts) >= 2:
                capability = _literal_string(item.elts[0])
                level = _literal_string(item.elts[1])
                if capability and level:
                    requirements.append((capability, level))
    return requirements


def _extract_check_role(node: ast.AST) -> str | None:
    calls = _calls(node, "auth.check_role")
    if not calls:
        return None
    roles = {
        item.attr
        for call in calls
        for item in ast.walk(call)
        if isinstance(item, ast.Attribute) and item.attr.isupper()
    }
    return ",".join(sorted(roles)) or "role"


def _extract_manual_capability_checks(node: ast.AST) -> list[str]:
    capabilities = []
    for call in _calls(node, "auth.has_capability_permission"):
        capability = _literal_string(call.args[1]) if len(call.args) > 1 else None
        if capability:
            capabilities.append(capability)
    return sorted(set(capabilities))


DELEGATED_ROUTE_CONTRACTS: dict[tuple[str, str], tuple[str, str, tuple[str, ...]]] = {
    ("/case-portability/profiles", "read_profiles"): ("plugins.provider.case_portability.importar_casos", "read", ("_capability",)),
    ("/case-portability/templates/tcases-example", "download_tcases_example"): ("plugins.provider.case_portability.importar_casos", "read", ("_capability",)),
    ("/case-portability/projects/{project_id}/export", "export_cases"): ("plugins.provider.case_portability.importar_casos", "read", ("_capability",)),
    ("/case-portability/projects/{project_id}/preview", "preview_cases"): ("plugins.provider.case_portability.importar_casos", "edit", ("_capability",)),
    ("/case-portability/projects/{project_id}/import", "import_cases"): ("plugins.provider.case_portability.importar_casos", "edit", ("_capability",)),
    ("/case-portability/projects/{project_id}/batches", "read_batches"): ("plugins.provider.case_portability.importar_casos", "read", ("_capability",)),
    ("/case-portability/batches/{batch_id}/rollback", "rollback_import"): ("plugins.provider.case_portability.importar_casos", "edit", ("_capability",)),
    ("/integrations/catalog", "read_integrations_catalog"): ("extensions.catalog", "read", ("_catalog_response",)),
    ("/plugins/catalog", "read_plugins_catalog"): ("extensions.catalog", "read", ("_catalog_response",)),
    ("/extensions/catalog", "read_extensions_catalog"): ("extensions.catalog", "read", ("_catalog_response",)),
    ("/extensions/{provider_id}/install", "install_extension"): ("extensions.dynamic", "dynamic", ("_assert_capability", "_required_capability")),
    ("/plugins/store/releases/{release_id}/install", "install_paired_official_store_release"): ("plugins.instalar", "edit", ("_assert_capability",)),
    ("/plugins/store/catalog", "read_official_plugin_store_catalog"): ("plugins.catalogo", "read", ("_assert_capability",)),
    ("/plugins/store/register", "register_official_plugin_store"): ("plugins.configurar", "edit", ("_assert_capability",)),
    ("/plugins/store/connection", "read_official_plugin_store_connection"): ("plugins.configurar", "edit", ("_assert_capability",)),
    ("/plugins/store/{instance_id}/invoke", "invoke_official_store_plugin"): ("plugins.habilitar", "edit", ("_assert_capability", "_load_instance")),
    ("/plugins/store/{instance_id}", "uninstall_official_store_plugin"): ("plugins.desinstalar", "edit", ("_assert_capability", "_load_instance")),
    ("/plugins/store/{instance_id}/audit", "read_official_store_plugin_audit"): ("plugins.auditoria", "read", ("_assert_capability", "_load_instance")),
    ("/extensions/{instance_id}", "update_extension"): ("extensions.dynamic", "dynamic", ("_assert_capability", "_required_capability", "_load_instance")),
    ("/extensions/{instance_id}/secrets", "configure_extension_secrets"): ("extensions.dynamic", "dynamic", ("_assert_capability", "_required_capability", "_load_instance")),
    ("/extensions/{instance_id}/enable", "enable_extension"): ("extensions.enable", "edit", ("_set_extension_enabled",)),
    ("/extensions/{instance_id}/disable", "disable_extension"): ("extensions.enable", "edit", ("_set_extension_enabled",)),
    ("/extensions/{instance_id}/test", "test_extension"): ("extensions.dynamic", "dynamic", ("_assert_capability", "_required_capability", "_load_instance")),
    ("/proyectos/{project_id}/api-tests/execute", "execute_api_suite"): ("ejecutar.api", "dynamic", ("_require_api_execution_capability",)),
}


def _has_literal_call(node: ast.AST, name: str, expected: dict[int, str]) -> bool:
    return any(
        all(len(call.args) > index and _literal_string(call.args[index]) == value for index, value in expected.items())
        for call in _calls(node, name)
    )


def _extract_helper_capability(path: str, handler: str, node: ast.AST) -> tuple[str, str] | None:
    contract = DELEGATED_ROUTE_CONTRACTS.get((path, handler))
    if not contract:
        return None
    capability, level, required_calls = contract
    present_calls = {_qualified_name(call.func) for call in _reachable_calls(node)}
    if not all(required in present_calls for required in required_calls):
        return None
    if "_assert_capability" in required_calls and capability != "extensions.dynamic":
        if not _has_literal_call(node, "_assert_capability", {1: capability, 2: level}):
            return None
    if "_capability" in required_calls and not _has_literal_call(node, "_capability", {1: level}):
        return None
    return capability, level


def _extract_resource_scope(source: str) -> tuple[str, str] | None:
    match = re.search(
        r"access_control\.require_(?P<resource>organization|project|component|build)_access\([^)]*?(?:,\s*['\"](?P<level>read|edit)['\"])?\s*\)",
        source,
        re.DOTALL,
    )
    if not match:
        return None
    return match.group("resource"), match.group("level") or "read"


def _classify(path: str, handler: str, node: ast.AST, function_source: str) -> tuple[str, str, str, str, str]:
    role_check = _extract_check_role(node)
    if role_check:
        return "USER", "YES", "role", f"role:{role_check}", "OK"

    capability_checks = _extract_check_capabilities(node)
    if capability_checks:
        modules = sorted({capability.split('.', 1)[0] for capability, _ in capability_checks})
        requirements = ','.join(f'{level}:{capability}' for capability, level in capability_checks)
        return "USER", "YES", ",".join(modules), f"all:{requirements}", "OK"

    capability_check = _extract_check_capability(node)
    if capability_check:
        capability, level = capability_check
        module = capability.split(".", 1)[0]
        return "USER", "YES", module, f"{level}:{capability}", "OK"

    any_capability_checks = _extract_check_any_capability(node)
    if any_capability_checks:
        modules = sorted({capability.split('.', 1)[0] for capability, _ in any_capability_checks})
        requirements = ','.join(f'{level}:{capability}' for capability, level in any_capability_checks)
        return "USER", "YES", ",".join(modules), f"any:{requirements}", "OK"

    check = _extract_check_module(node)
    if check:
        module, level = check
        return "USER", "YES", module, level, "OK"

    manual_capabilities = _extract_manual_capability_checks(node)
    if manual_capabilities:
        modules = sorted({capability.split(".", 1)[0] for capability in manual_capabilities})
        return "USER", "YES", ",".join(modules), f"manual:{','.join(manual_capabilities)}", "OK"

    if _calls(node, "auth.has_capability_permission"):
        return "USER", "YES", "dynamic", "manual:dynamic", "OK"

    helper_capability = _extract_helper_capability(path, handler, node)
    if helper_capability:
        capability, level = helper_capability
        module = capability.split(".", 1)[0]
        return "USER", "YES", module, f"helper:{level}:{capability}", "OK"

    resource_scope = _extract_resource_scope(function_source)
    if resource_scope:
        resource, level = resource_scope
        return "USER", "NO", "resource_scope", f"scope-only:{level}:{resource}", "MISSING_CHECK_MODULE"

    # Governed MCP endpoints authenticate through a dedicated technical API
    # key helper instead of a browser-session dependency.
    if path == "/mcp" and "_authenticate_for_rpc(" in function_source:
        return "USER", "YES", "mcp", "technical-key", "OK"
    if path == "/mcp/tools" and "_authenticate_with_safe_failure(" in function_source:
        return "API_KEY", "NO", "mcp", "technical-key", "REVIEW"
    if path == "/mcp/internal/runtime-credential" and "x_engine_internal_token" in function_source:
        return "API_KEY", "NO", "mcp", "internal-token", "REVIEW"
    if "_technical_user(" in function_source:
        return "API_KEY", "NO", "mcp", "technical-key", "REVIEW"

    public = _public_status(path)
    if public:
        return "NONE", "NO", "-", "-", public

    if "get_current_automation_runner" in function_source:
        return "RUNNER_TOKEN", "NO", "automatizacion", "runner", "REVIEW"

    if "get_external_api_user" in function_source:
        return "API_KEY", "NO", "ejecutar", "edit", "REVIEW"

    if "get_current_active_user" in function_source or "get_current_user" in function_source:
        authenticated = _authenticated_intent(path)
        if authenticated:
            module, level = authenticated
            return "USER", "INTENTIONAL", module, level, "OK"
        return "USER", "NO", "-", "-", "MISSING_CHECK_MODULE"

    if "x_ai_engine_token" in function_source or "AI_ENGINE_CALLBACK_TOKEN" in function_source:
        return "CALLBACK_TOKEN", "NO", "motor_ia", "callback", "REVIEW"

    return "NONE", "NO", "-", "-", "MISSING_AUTH"


def audit_file(path: Path) -> list[RouteAudit]:
    text = path.read_text(encoding="utf-8")
    tree = ast.parse(text, filename=str(path))
    rows: list[RouteAudit] = []

    try:
        relative_file = str(path.relative_to(ROOT))
    except ValueError:
        relative_file = str(path)

    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        function_source = ast.get_source_segment(text, node) or ""
        for decorator in node.decorator_list:
            route = _is_route_decorator(decorator)
            if not route:
                continue
            method, route_path, router_name = route
            route_path = _runtime_path(_router_prefix(tree, router_name), route_path)
            auth, check_module, module, level, status = _classify(route_path, node.name, node, function_source)
            rows.append(
                RouteAudit(
                    method=method,
                    path=route_path,
                    handler=node.name,
                    auth=auth,
                    check_module=check_module,
                    module=module,
                    level=level,
                    status=status,
                    file=relative_file,
                    line=getattr(decorator, "lineno", node.lineno),
                )
            )

    return sorted(rows, key=lambda row: (row.file, row.line, row.method, row.path))


def audit_routes() -> list[RouteAudit]:
    rows: list[RouteAudit] = []
    for path in SCAN_PATHS:
        if path.exists() and path.suffix == ".py":
            rows.extend(audit_file(path))
    return rows


def format_rows(rows: list[RouteAudit]) -> str:
    header = "METHOD | PATH | HANDLER | AUTH | CHECK_MODULE | MODULE | LEVEL | STATUS"
    lines = [header]
    for row in rows:
        lines.append(
            " | ".join(
                [
                    row.method,
                    row.path,
                    row.handler,
                    row.auth,
                    row.check_module,
                    row.module,
                    row.level,
                    row.status,
                ]
            )
        )
    return "\n".join(lines)


def main() -> int:
    print(format_rows(audit_routes()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
