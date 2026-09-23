"""Regression tests for MCP resource and deployment limits."""
from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services import mcp_governance, mcp_tools, schema_readiness


@pytest.mark.asyncio
async def test_schema_readiness_rejects_governed_revision_with_multiple_heads(monkeypatch):
    monkeypatch.setattr(schema_readiness, "_migration_heads", lambda: frozenset({"head-a", "head-b"}))
    with pytest.raises(schema_readiness.SchemaNotReadyError, match="Database schema is not ready"):
        await schema_readiness.ensure_schema_ready(
            SimpleNamespace(connect=lambda: _Connection(schema_readiness.GOVERNED_MCP_CREDENTIAL_REVISION))
        )


class _Result:
    def __init__(self, rows):
        self.rows = rows

    def all(self):
        return self.rows


class _BuildDB:
    def __init__(self, rows):
        self.rows = rows
        self.statement = None

    async def execute(self, statement):
        self.statement = statement
        return _Result(self.rows)


@pytest.mark.asyncio
async def test_build_listing_limits_rows_and_fields_before_materialization():
    project = SimpleNamespace(id=uuid4())
    rows = [(uuid4(), "x" * 1000, "active", True)] * (mcp_tools.MCP_MAX_BUILD_ITEMS + 1)
    db = _BuildDB(rows)
    result = await mcp_tools.list_project_builds(db, None, project)
    assert len(result["items"]) == mcp_tools.MCP_MAX_BUILD_ITEMS
    assert all(len(item["name"]) <= mcp_tools.MCP_BUILD_NAME_MAX_CHARS for item in result["items"])
    assert result["truncated"] is True
    assert db.statement._limit_clause is not None


@pytest.mark.asyncio
async def test_chunked_request_reader_stops_after_limit():
    from app.api.routers.mcp import _read_bounded_body

    class Request:
        async def stream(self):
            yield b"{" + b"x" * 100
            yield b"y" * 100
            raise AssertionError("reader consumed beyond bounded request")

    body, too_large = await _read_bounded_body(Request(), 150)
    assert too_large is True
    assert len(body) == 151


def test_mcp_refuses_explicit_multi_worker_without_shared_limiter(monkeypatch):
    mcp_governance.set_configured_mcp_enabled(True)
    monkeypatch.setenv("WEB_CONCURRENCY", "2")
    monkeypatch.delenv("TRESEKO_MCP_RATE_LIMIT_REDIS_URL", raising=False)
    monkeypatch.delenv("REDIS_URL", raising=False)
    assert mcp_governance.mcp_enabled() is False


def test_mcp_refuses_ambiguous_topology_without_shared_limiter(monkeypatch):
    mcp_governance.set_configured_mcp_enabled(True)
    monkeypatch.delenv("TRESEKO_MCP_DEPLOYMENT_TOPOLOGY", raising=False)
    monkeypatch.delenv("TRESEKO_MCP_RATE_LIMIT_REDIS_URL", raising=False)
    monkeypatch.delenv("REDIS_URL", raising=False)
    assert mcp_governance.mcp_enabled() is False


def test_mcp_refuses_unknown_topology_even_when_redis_is_healthy(monkeypatch):
    mcp_governance.set_configured_mcp_enabled(True)
    monkeypatch.setenv("TRESEKO_MCP_DEPLOYMENT_TOPOLOGY", "unknown-topology")
    monkeypatch.setenv("REDIS_URL", "redis://redis:6379/0")
    monkeypatch.setattr(mcp_governance, "_shared_limiter_healthy", lambda _url: True)
    assert mcp_governance.mcp_enabled() is False


def test_mcp_requires_healthy_shared_limiter_for_every_enabled_route(monkeypatch):
    mcp_governance.set_configured_mcp_enabled(True)
    monkeypatch.setenv("TRESEKO_MCP_DEPLOYMENT_TOPOLOGY", "shared_redis")
    monkeypatch.setenv("REDIS_URL", "redis://unavailable.invalid/0")
    monkeypatch.setattr(mcp_governance, "_shared_limiter_healthy", lambda _url: False)
    assert mcp_governance.mcp_enabled() is False


def test_tool_result_is_bounded_before_rpc_envelope(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.project.get")
    tool = mcp_governance.resolve_tool("treseko.project.get")
    assert tool is not None
    bounded = mcp_governance.bound_tool_result(tool, {"name": "x" * 100_000})
    assert len(bounded["name"]) < 100_000
    assert bounded["truncated"] is True


def test_tool_result_rejects_unserializable_values_before_envelope(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.project.get")
    tool = mcp_governance.resolve_tool("treseko.project.get")
    assert tool is not None
    with pytest.raises(mcp_governance.McpResultTooLarge):
        mcp_governance.bound_tool_result(tool, {"value": object()})


class _ScalarResult:
    def __init__(self, revision):
        self.revision = revision

    def scalar_one_or_none(self):
        return self.revision


class _Connection:
    def __init__(self, revision):
        self.revision = revision

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def execute(self, _query):
        return _ScalarResult(self.revision)


class _Connect:
    def __init__(self, revision):
        self.revision = revision

    def __call__(self):
        return _Connection(self.revision)
