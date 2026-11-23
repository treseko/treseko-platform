"""HTTP negative contracts for every FastAPI operation.

The authorization audit proves that a route was classified in source.  This
matrix exercises the application itself: every operation receives 250 distinct
invalid requests with deterministic placeholder values. Protected routes must
reject them without a server error; intentional-public operations must also
handle them without leaking a 5xx response.

Business-flow tests remain responsible for valid payloads and state changes.
Keeping this matrix negative makes it safe to run against an empty CI database
without creating projects, users, executions or external side effects.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient


BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import app  # noqa: E402
from app.database import engine  # noqa: E402
from scripts.audit_rbac_routes import audit_routes  # noqa: E402


ROUTE_AUTH = {
    (route.method, route.path): route.auth
    for route in audit_routes()
}
# app_factory keeps this compatibility alias for installations that still
# point the Engine at the URL shipped by older Compose releases. Its handler is
# the same internal-token-protected function audited at /mcp/... above.
ROUTE_AUTH[("POST", "/api/mcp/internal/runtime-credential")] = ROUTE_AUTH[(
    "POST", "/mcp/internal/runtime-credential"
)]
RUNTIME_OPERATIONS = sorted({
    (method, route.path)
    for route in app.routes
    if isinstance(route, APIRoute)
    for method in route.methods - {"HEAD", "OPTIONS"}
})
NEGATIVE_VARIANT_FAMILIES = (
    "anonymous",
    "unexpected_payload",
    "malformed_json",
    "empty_body",
    "empty_json_object",
    "json_array",
    "urlencoded_payload",
    "plain_text_payload",
    "unknown_query",
    "wrong_method",
)
# Each API operation receives 250 negative requests: 25 concrete mutations of
# every invalid-input family.  Keeping the family in the parametrized id makes
# a failing request actionable while the ordinal proves it was not a duplicate
# re-run of the same payload.
MUTATIONS_PER_NEGATIVE_FAMILY = 25
NEGATIVE_VARIANTS = tuple(
    f"{family}-{mutation:02d}"
    for family in NEGATIVE_VARIANT_FAMILIES
    for mutation in range(1, MUTATIONS_PER_NEGATIVE_FAMILY + 1)
)


def _request_path(path: str) -> str:
    """Replace route parameters with safe invalid values, without path traversal."""
    return re.sub(r"\{[^}]+\}", "invalid-contract-value", path)


def _variant_request(
    method: str,
    path: str,
    variant: str,
) -> tuple[str, dict[str, object]]:
    """Build a distinct, deterministic invalid request for a matrix entry."""
    family, raw_mutation = variant.rsplit("-", 1)
    mutation = int(raw_mutation)
    probe = f"negative-contract-{family}-{mutation:02d}"
    options: dict[str, object] = {
        "follow_redirects": False,
        "headers": {"x-treseko-contract-probe": probe},
    }

    if family == "anonymous":
        options["params"] = {f"unexpected_anonymous_{mutation}": probe}
    elif family == "unexpected_payload":
        options["json"] = {
            "unexpected_contract_value": probe,
            "nested": {"mutation": mutation, "invalid": True},
        }
    elif family == "malformed_json":
        malformed_payloads = (
            b'{"unterminated":',
            b'{"leading_zero": 01}',
            b'{"trailing": true,}',
            b'{"single_quotes": \'invalid\'}',
            b'{"invalid_escape": "\\x"}',
        )
        options["content"] = malformed_payloads[(mutation - 1) % len(malformed_payloads)] + (b" " * mutation)
        options["headers"] = {
            "content-type": "application/json",
            "x-treseko-contract-probe": probe,
        }
    elif family == "empty_body":
        options["content"] = b""
    elif family == "empty_json_object":
        options["json"] = {f"ignored_{mutation}": None}
    elif family == "json_array":
        options["json"] = [probe, mutation, {"invalid": True}]
    elif family == "urlencoded_payload":
        options["data"] = {f"unexpected_contract_value_{mutation}": probe}
    elif family == "plain_text_payload":
        options["content"] = f"unexpected plain-text contract payload {probe}".encode()
        options["headers"] = {
            "content-type": "text/plain",
            "x-treseko-contract-probe": probe,
        }
    elif family == "unknown_query":
        options["params"] = {f"unexpected_contract_query_{mutation}": probe}
    else:
        wrong_methods = ("POST", "PUT", "PATCH", "DELETE", "OPTIONS")
        request_method = wrong_methods[(mutation - 1) % len(wrong_methods)]
        if request_method == method:
            request_method = "GET" if method != "GET" else "POST"
        return request_method, options
    return method, options


@pytest.fixture(scope="module")
def anonymous_client():
    # Keep one lifespan/event loop for the whole matrix.  Several dependencies
    # use asyncpg, whose connections cannot be reused across TestClient loops.
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client
        client.portal.call(engine.dispose)


@pytest.mark.parametrize(
    "operation,variant",
    [(operation, variant) for operation in RUNTIME_OPERATIONS for variant in NEGATIVE_VARIANTS],
    ids=[f"{method} {path} [{variant}]" for method, path in RUNTIME_OPERATIONS for variant in NEGATIVE_VARIANTS],
)
def test_every_http_operation_rejects_anonymous_or_invalid_requests(
    anonymous_client: TestClient,
    operation: tuple[str, str],
    variant: str,
):
    """No route may turn an anonymous or malformed request into a 5xx."""
    method, path = operation
    request_path = _request_path(path)
    request_method, options = _variant_request(method, request_path, variant)
    # Wrong-method probes cannot be reverse-mapped from the actual dispatched
    # route.  Preserve their intended contract target for the coverage
    # observer; application code ignores this diagnostic header.
    headers = dict(options.get("headers") or {})
    headers["x-treseko-negative-operation"] = f"{method} {path}"
    options["headers"] = headers
    response = anonymous_client.request(request_method, request_path, **options)

    assert response.status_code < 500, response.text[:500]
    if ROUTE_AUTH[(method, path)] != "NONE":
        assert response.status_code >= 400, response.text[:500]
