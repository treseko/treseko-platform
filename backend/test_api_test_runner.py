from types import SimpleNamespace

import httpx
import pytest

from app.services.api_test_runner import ApiTestRunnerError, run_api_test, sanitize_api_config


@pytest.mark.asyncio
async def test_workflow_extracts_variables_and_runs_cleanup():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, str(request.url)))
        if request.method == "GET" and str(request.url).endswith("/users"):
            return httpx.Response(200, json={"data": {"id": "u-42"}})
        if request.method == "GET" and str(request.url).endswith("/users/u-42"):
            return httpx.Response(200, json={"ok": True})
        if request.method == "DELETE":
            return httpx.Response(204)
        return httpx.Response(404)

    config = {
        "schema_version": "treseko.api-test/v1",
        "steps": [
            {
                "name": "create lookup",
                "request": {"method": "GET", "url": "{{base_url}}/users"},
                "assertions": [{"source": "response.status", "operator": "equals", "expected": 200}],
                "extractors": [{"name": "user_id", "selector": "$.data.id", "required": True}],
            },
            {
                "name": "read lookup",
                "request": {"method": "GET", "url": "{{base_url}}/users/{{user_id}}"},
                "assertions": [{"source": "response.body", "selector": "$.ok", "operator": "equals", "expected": True}],
            },
        ],
        "cleanup": {
            "always_run": True,
            "steps": [{"name": "delete lookup", "request": {"method": "DELETE", "url": "{{base_url}}/users/{{user_id}}"}}],
        },
    }
    environment = SimpleNamespace(url="https://api.example.test", variables={}, configuracion_api={})

    result = await run_api_test(config, environment, transport=httpx.MockTransport(handler))

    assert result["status"] == "PASSED"
    assert [step["status"] for step in result["steps"]] == ["PASSED", "PASSED"]
    assert result["cleanup"]["status"] == "PASSED"
    assert calls == [
        ("GET", "https://api.example.test/users"),
        ("GET", "https://api.example.test/users/u-42"),
        ("DELETE", "https://api.example.test/users/u-42"),
    ]


@pytest.mark.asyncio
async def test_runner_blocks_destination_outside_environment_allowlist():
    environment = SimpleNamespace(url="https://api.example.test", variables={}, configuracion_api={})

    with pytest.raises(ApiTestRunnerError, match="allowlist"):
        await run_api_test({"request": {"method": "GET", "url": "https://evil.example.test"}}, environment, transport=httpx.MockTransport(lambda request: httpx.Response(200)))


@pytest.mark.asyncio
async def test_runner_validates_response_types_headers_and_array_lengths():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-type": "application/json"}, json={
            "data": {"id": 42, "name": "Ada", "active": True},
            "items": ["one", "two"],
        })

    config = {
        "request": {"method": "GET", "url": "{{base_url}}/users"},
        "assertions": [
            {"source": "response.status", "operator": "equals", "expected": 200},
            {"source": "response.body", "selector": "$.data.id", "operator": "type_is", "expected": "number"},
            {"source": "response.body", "selector": "$.data.name", "operator": "type_is", "expected": "string"},
            {"source": "response.body", "selector": "$.data.active", "operator": "equals", "expected": True},
            {"source": "response.body", "selector": "$.items", "operator": "array_length_equals", "expected": 2},
            {"source": "response.headers", "selector": "content-type", "operator": "contains", "expected": "application/json"},
        ],
    }
    environment = SimpleNamespace(url="https://api.example.test", variables={}, configuracion_api={})

    result = await run_api_test(config, environment, transport=httpx.MockTransport(handler))

    assert result["status"] == "PASSED"
    assert all(assertion["status"] == "PASSED" for assertion in result["steps"][0]["assertions"])


@pytest.mark.asyncio
async def test_runner_reports_type_mismatch_as_assertion_failure():
    environment = SimpleNamespace(url="https://api.example.test", variables={}, configuracion_api={})
    config = {
        "request": {"method": "GET", "url": "{{base_url}}"},
        "assertions": [{"source": "response.body", "selector": "$.value", "operator": "type_is", "expected": "number"}],
    }

    result = await run_api_test(config, environment, transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"value": "42"})))

    assertion = result["steps"][0]["assertions"][0]
    assert result["status"] == "FAILED"
    assert assertion["status"] == "FAILED"
    assert "tipo recibido" in assertion["error"]


@pytest.mark.asyncio
async def test_runner_validates_nested_json_schema_constraints():
    environment = SimpleNamespace(url="https://api.example.test", variables={}, configuracion_api={})
    config = {
        "request": {"method": "GET", "url": "{{base_url}}"},
        "assertions": [{
            "source": "response.body",
            "operator": "json_schema",
            "expected": {
                "type": "object",
                "required": ["data"],
                "properties": {
                    "data": {
                        "type": "object",
                        "required": ["id", "name"],
                        "properties": {
                            "id": {"type": "number", "minimum": 1},
                            "name": {"type": "string", "minLength": 2},
                        },
                    },
                },
            },
        }],
    }

    result = await run_api_test(config, environment, transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"data": {"id": 0, "name": ""}})))

    assertion = result["steps"][0]["assertions"][0]
    assert result["status"] == "FAILED"
    assert assertion["status"] == "FAILED"
    assert "minimum" in assertion["error"]
    assert "minLength" in assertion["error"]


def test_api_config_sanitization_removes_inline_credentials():
    safe = sanitize_api_config({"request": {"auth": {"type": "basic", "username": "alice", "password": "secret"}, "headers": [{"key": "X-Api-Key", "value": "abc"}]}})

    assert safe["request"]["auth"]["password"] == "[REDACTED]"
    assert safe["request"]["headers"][0]["value"] == "[REDACTED]"


@pytest.mark.asyncio
async def test_postman_scripts_cookies_and_redirects_are_supported():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/start":
            return httpx.Response(302, headers={"location": "/final", "set-cookie": "session=s-42"})
        if request.url.path == "/final":
            return httpx.Response(200, json={"ok": True}, headers={"content-type": "application/json"})
        assert request.headers.get("x-session") == "s-42"
        return httpx.Response(200, json={"ok": True}, headers={"content-type": "application/json"})

    config = {
        "schema_version": "treseko.api-test/v2",
        "steps": [
            {"name": "redirect", "request": {"method": "GET", "url": "{{base_url}}/start", "redirects": {"follow": True}}, "post_response_script": "pm.test('ok', () => pm.expect(pm.response.json().ok).to.be.true); pm.variables.set('session', 's-42')"},
            {"name": "session", "request": {"method": "GET", "url": "{{base_url}}/session", "headers": [{"key": "X-Session", "value": "{{session}}"}]}, "assertions": [{"source": "response.body", "selector": "$.ok", "operator": "equals", "expected": True}]},
        ],
    }
    environment = SimpleNamespace(url="https://api.example.test", variables={}, configuracion_api={})
    result = await run_api_test(config, environment, transport=httpx.MockTransport(handler))

    assert result["status"] == "PASSED"
    assert result["steps"][0]["response"]["status"] == 200
    assert result["steps"][0]["assertions"][-1]["status"] == "PASSED"


@pytest.mark.asyncio
async def test_api_variables_flow_between_cases_and_scripts_can_mark_persistent_values():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.headers.get("authorization"))
        if request.url.path == "/login":
            return httpx.Response(200, json={"access_token": "token-a"})
        assert request.headers.get("authorization") == "Bearer token-a"
        return httpx.Response(200, json={"last_id": "item-5"})

    environment = SimpleNamespace(url="https://api.example.test", variables={}, configuracion_api={})
    login = {
        "steps": [{
            "request": {"method": "POST", "url": "{{base_url}}/login"},
            "post_response_script": "pm.variables.set('api.user_a.access_token', pm.response.json().access_token); pm.variables.persist('api.items.last_id', 'item-5')",
        }],
    }
    protected = {
        "request": {
            "method": "GET",
            "url": "{{base_url}}/items",
            "auth": {"type": "bearer", "variable": "api.user_a.access_token"},
        },
        "assertions": [{"source": "response.body", "selector": "$.last_id", "operator": "equals", "expected": "item-5"}],
    }

    shared = {}
    first = await run_api_test(login, environment, transport=httpx.MockTransport(handler), shared_variables=shared)
    assert first["status"] == "PASSED"
    assert shared["api.user_a.access_token"] == "token-a"
    assert first["persistent_variables"] == {"api.items.last_id": "item-5"}

    second = await run_api_test(protected, environment, transport=httpx.MockTransport(handler), shared_variables=shared)
    assert second["status"] == "PASSED"
    assert calls == [None, "Bearer token-a"]


@pytest.mark.asyncio
async def test_runner_accepts_postman_cookie_name_rows():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers.get("cookie") == "session=s-42"
        return httpx.Response(200, json={"ok": True})

    config = {
        "schema_version": "treseko.api-test/v2",
        "request": {
            "method": "GET",
            "url": "{{base_url}}/session",
            "cookies": [{"name": "session", "value": "s-42", "enabled": True}],
        },
        "assertions": [{"source": "response.status", "operator": "equals", "expected": 200}],
    }
    environment = SimpleNamespace(url="https://api.example.test", variables={}, configuracion_api={})

    result = await run_api_test(config, environment, transport=httpx.MockTransport(handler))

    assert result["status"] == "PASSED"
