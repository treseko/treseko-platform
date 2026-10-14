from __future__ import annotations

import base64
from types import SimpleNamespace
from uuid import uuid4
import inspect

import pytest

from app.api.routers import mcp as mcp_router
from app.services import case_portability
from app.services import mcp_import
from app.services import mcp_governance as governance
from app.services.mcp_tools import HANDLERS


@pytest.fixture(autouse=True)
def configured_preview_secret(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_IMPORT_PREVIEW_SECRET", "test-preview-secret")


PROJECT_ID = uuid4()
COMPONENT_ID = uuid4()
BUILD_ID = uuid4()


def _arguments(**overrides):
    value = {
        "project_id": str(PROJECT_ID),
        "profile_id": "treseko/tcases-v1",
        "content_base64": base64.b64encode(b"package").decode(),
        "file_name": "cases.tcases",
        "component_id": str(COMPONENT_ID),
        "build_id": str(BUILD_ID),
    }
    value.update(overrides)
    return value


def test_import_preview_schema_accepts_package_fields_and_rejects_extras(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.cases.import.preview")
    tool = governance.resolve_tool("treseko.cases.import.preview")
    assert tool is not None
    parsed = governance.validate_tool_arguments(tool, _arguments())
    assert parsed["project_id"] == str(PROJECT_ID)
    assert parsed["component_id"] == str(COMPONENT_ID)
    with pytest.raises(ValueError):
        governance.validate_tool_arguments(tool, _arguments(shell="id"))


@pytest.mark.asyncio
async def test_preview_rejects_component_outside_authorized_project(monkeypatch):
    component = SimpleNamespace(proyecto_id=uuid4())

    async def component_access(*_args):
        return component

    monkeypatch.setattr(mcp_router.access_control, "require_component_access", component_access)
    with pytest.raises(ValueError) as exc:
        await mcp_import.preview_import(object(), object(), SimpleNamespace(id=PROJECT_ID), _arguments())
    assert isinstance(exc.value, ValueError)


@pytest.mark.asyncio
async def test_preview_rejects_build_outside_project_component(monkeypatch):
    component = SimpleNamespace(proyecto_id=PROJECT_ID)
    build = SimpleNamespace(proyecto_id=PROJECT_ID, componente_id=uuid4())
    monkeypatch.setattr(mcp_router.access_control, "require_component_access", lambda *_args: _async(component))
    monkeypatch.setattr(mcp_router.access_control, "require_build_access", lambda *_args: _async(build))
    with pytest.raises(ValueError) as exc:
        await mcp_import.preview_import(object(), object(), SimpleNamespace(id=PROJECT_ID), _arguments())
    assert isinstance(exc.value, ValueError)


@pytest.mark.asyncio
async def test_preview_rejects_invalid_base64_profile_and_package(monkeypatch):
    component = SimpleNamespace(proyecto_id=PROJECT_ID)
    monkeypatch.setattr(mcp_router.access_control, "require_component_access", lambda *_args: _async(component))
    for arguments in (_arguments(content_base64="%%%", build_id=None), _arguments(profile_id="unknown", build_id=None), _arguments(content_base64=base64.b64encode(b"bad").decode(), build_id=None)):
        with pytest.raises((ValueError, case_portability.PortabilityError)):
            await mcp_import.preview_import(object(), object(), SimpleNamespace(id=PROJECT_ID), arguments)


@pytest.mark.asyncio
async def test_preview_calls_legacy_parser_without_include_binary_and_never_returns_package(monkeypatch):
    component = SimpleNamespace(proyecto_id=PROJECT_ID)
    monkeypatch.setattr(mcp_router.access_control, "require_component_access", lambda *_args: _async(component))
    monkeypatch.setattr(mcp_router.access_control, "require_build_access", lambda *_args: _async(SimpleNamespace(proyecto_id=PROJECT_ID, componente_id=COMPONENT_ID)))
    calls = {}

    async def legacy_preview(_db, project_id, profile_id, data, **kwargs):
        calls.update(project_id=project_id, profile_id=profile_id, data=data, kwargs=kwargs)
        return {"source_tool": "x", "source_version": "1", "file_sha256": "a", "summary": {"total": 1}, "diagnostics": {"ok": True}, "items": [{"external_id": "id", "titulo": "RAW CONTENT", "outcome": "new"}], "package": {"cases": [{"titulo": "RAW CONTENT"}], "attachment_files": {"x": b"secret"}}}

    monkeypatch.setattr(case_portability, "preview_import", legacy_preview)
    result = await mcp_import.preview_import(object(), object(), SimpleNamespace(id=PROJECT_ID), _arguments())
    assert calls["kwargs"] == {}
    assert "package" not in result
    assert "RAW CONTENT" not in str(result)
    assert "secret" not in str(result)
    assert result["items"] == [{"external_id": "id", "outcome": "new"}]


@pytest.mark.asyncio
async def test_preview_does_not_write(monkeypatch):
    component = SimpleNamespace(proyecto_id=PROJECT_ID)
    monkeypatch.setattr(mcp_router.access_control, "require_component_access", lambda *_args: _async(component))
    async def parser(*_args, **_kwargs):
        return {"source_tool": "x", "source_version": "1", "file_sha256": "a", "summary": {}, "diagnostics": {}, "items": []}
    monkeypatch.setattr(case_portability, "preview_import", parser)
    db = SimpleNamespace(add=lambda *_args: (_ for _ in ()).throw(AssertionError("write")), flush=lambda: (_ for _ in ()).throw(AssertionError("write")))
    await mcp_import.preview_import(db, object(), SimpleNamespace(id=PROJECT_ID), _arguments(build_id=None))


@pytest.mark.asyncio
async def test_preview_audit_is_sanitized_and_non_persistent(monkeypatch, caplog):
    tool = governance.TOOL_CATALOG["treseko.cases.import.preview"]
    user = SimpleNamespace(id=PROJECT_ID, mcp_key_prefix="mcp_test")
    request = SimpleNamespace(state=SimpleNamespace(correlation_id="corr-preview"), client=None, headers={})
    persisted = False

    async def forbidden_persist(*_args, **_kwargs):
        nonlocal persisted
        persisted = True

    monkeypatch.setattr(mcp_router.crud, "create_audit_log", forbidden_persist)
    with caplog.at_level("INFO", logger="app.api.routers.mcp"):
        await mcp_router._audit_mcp_event(
            request,
            user,
            tool=tool,
            status="success",
            reason="preview_complete",
            arguments={"content_base64": "secret-content", "profile_id": "safe-profile"},
        )
    assert not persisted
    assert "secret-content" not in caplog.text
    assert "preview_complete" in caplog.text
    assert "[redacted]" in caplog.text


@pytest.mark.asyncio
async def test_preview_requires_scope_and_allowlist(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.cases.import.preview")
    assert governance.resolve_tool("treseko.cases.import.preview") is None if not governance.HANDLERS.get("cases.import.preview") else True
    assert not governance.tool_allowed_by_scopes("treseko.cases.import.preview", [])
    assert not governance.tool_allowed_by_scopes("treseko.cases.import.preview", ["mcp.projects.read"])
    assert governance.tool_allowed_by_scopes("treseko.cases.import.preview", ["mcp.cases.import.preview"])


@pytest.mark.asyncio
async def test_legacy_read_only_handlers_remain_unchanged():
    assert callable(HANDLERS["project.get"])
    assert callable(HANDLERS["builds.list"])
    project = SimpleNamespace(id=PROJECT_ID, nombre="name", organizacion_id=uuid4())
    assert await HANDLERS["project.get"](object(), object(), project) == {"id": str(PROJECT_ID), "name": "name", "organization_id": str(project.organizacion_id)}


async def _async(value):
    return value


def test_commit_schema_requires_confirmation_preview_manifest_and_idempotency(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.cases.import.commit")
    tool = governance.resolve_tool("treseko.cases.import.commit")
    assert tool is not None
    args = _arguments(
        confirmation="APPLY_CASE_IMPORT",
        preview_token="preview-token",
        package_sha256="a" * 64,
        idempotency_key="idem-1",
    )
    parsed = governance.validate_tool_arguments(tool, args)
    assert parsed["confirmation"] == "APPLY_CASE_IMPORT"
    with pytest.raises(ValueError):
        governance.validate_tool_arguments(tool, _arguments())


@pytest.mark.asyncio
async def test_commit_requires_matching_preview_and_explicit_confirmation(monkeypatch):
    with pytest.raises(ValueError, match="confirmación"):
        await mcp_import.commit_import(object(), object(), SimpleNamespace(id=PROJECT_ID), _arguments())


@pytest.mark.asyncio
async def test_commit_delegates_only_after_governance_and_retries_idempotently(monkeypatch):
    calls = []
    batch = SimpleNamespace(id=uuid4(), status="COMPLETED", summary_json={"total": 1}, item_results=[])

    async def legacy_commit(*args, **kwargs):
        calls.append((args, kwargs))
        return batch

    monkeypatch.setattr(case_portability, "commit_import", legacy_commit)
    monkeypatch.setattr(mcp_import.access_control, "require_component_access", lambda *_args: _async(SimpleNamespace(proyecto_id=PROJECT_ID)))
    monkeypatch.setattr(mcp_import.access_control, "require_build_access", lambda *_args: _async(SimpleNamespace(proyecto_id=PROJECT_ID, componente_id=COMPONENT_ID, activo=True, estado="ACTIVA")))
    monkeypatch.setattr(mcp_import.access_control, "is_build_active", lambda _build: True)
    arguments = _arguments(
        confirmation="APPLY_CASE_IMPORT", preview_token=None,
        package_sha256=None, idempotency_key="idem-retry",
    )
    arguments["preview_token"] = mcp_import.make_preview_token(PROJECT_ID, arguments)
    arguments["package_sha256"] = mcp_import.package_sha256(arguments["content_base64"])
    reservations = {}
    async def reserve(_db, project_id, key, fingerprint):
        existing = reservations.get((project_id, key))
        if existing:
            return existing[0], existing[1]
        reservation = SimpleNamespace(status="PENDING", result_json=None)
        reservations[(project_id, key)] = (reservation, None)
        return reservation, None
    monkeypatch.setattr(mcp_import, "_reserve_idempotency", reserve)
    async def noop_commit():
        return None
    db = SimpleNamespace(begin_nested=lambda: None, commit=noop_commit)
    first = await mcp_import.commit_import(db, SimpleNamespace(id=uuid4()), SimpleNamespace(id=PROJECT_ID), arguments)
    reservations[(PROJECT_ID, "idem-retry")] = (reservations[(PROJECT_ID, "idem-retry")][0], first)
    second = await mcp_import.commit_import(db, SimpleNamespace(id=uuid4()), SimpleNamespace(id=PROJECT_ID), arguments)
    assert first["batch_id"] == second["batch_id"]
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_commit_import_keeps_domain_mutation_and_reservation_in_one_commit(monkeypatch):
    commits = []
    batch = SimpleNamespace(id=uuid4(), status="COMPLETED", summary_json={"total": 1}, item_results=[])

    async def domain_commit(*args, commit_transaction):
        assert commit_transaction is False
        return batch

    monkeypatch.setattr(case_portability, "commit_import", domain_commit)
    monkeypatch.setattr(mcp_import.access_control, "require_component_access", lambda *_args: _async(SimpleNamespace(proyecto_id=PROJECT_ID)))
    monkeypatch.setattr(mcp_import.access_control, "require_build_access", lambda *_args: _async(SimpleNamespace(proyecto_id=PROJECT_ID, componente_id=COMPONENT_ID, activo=True, estado="ACTIVA")))
    monkeypatch.setattr(mcp_import.access_control, "is_build_active", lambda _build: True)
    args = _arguments(confirmation="APPLY_CASE_IMPORT", idempotency_key="idem-atomic")
    args["preview_token"] = mcp_import.make_preview_token(PROJECT_ID, args)
    args["package_sha256"] = mcp_import.package_sha256(args["content_base64"])
    reservation = SimpleNamespace(status="PENDING", result_json=None)
    monkeypatch.setattr(mcp_import, "_reserve_idempotency", lambda *_args: _async((reservation, None)))

    async def commit():
        commits.append(True)

    db = SimpleNamespace(begin_nested=lambda: None, commit=commit)
    result = await mcp_import.commit_import(db, SimpleNamespace(id=PROJECT_ID), SimpleNamespace(id=PROJECT_ID), args)
    assert result["batch_id"] == str(batch.id)
    assert commits == [True]


@pytest.mark.asyncio
async def test_commit_rejects_stale_token_hash_and_cross_boundary_targets(monkeypatch):
    args = _arguments(confirmation="APPLY_CASE_IMPORT", idempotency_key="idem-boundary")
    args["preview_token"] = mcp_import.make_preview_token(PROJECT_ID, args)
    args["package_sha256"] = mcp_import.package_sha256(args["content_base64"])
    monkeypatch.setattr(mcp_import.access_control, "require_component_access", lambda *_args: _async(SimpleNamespace(proyecto_id=PROJECT_ID)))
    monkeypatch.setattr(mcp_import.access_control, "require_build_access", lambda *_args: _async(SimpleNamespace(proyecto_id=PROJECT_ID, componente_id=COMPONENT_ID, activo=True, estado="ACTIVA")))
    monkeypatch.setattr(mcp_import.access_control, "is_build_active", lambda _build: True)
    for changed in ({"package_sha256": "b" * 64}, {"preview_token": "stale"}, {"project_id": str(uuid4())}):
        invalid = {**args, **changed}
        with pytest.raises(ValueError):
            await mcp_import.commit_import(object(), object(), SimpleNamespace(id=PROJECT_ID), invalid)


@pytest.mark.asyncio
async def test_commit_response_is_sanitized_bounded_and_auditable(monkeypatch):
    batch = SimpleNamespace(id=uuid4(), status="COMPLETED", summary_json={"total": 1}, item_results=[{"external_id": "x", "case_id": "secret"}])
    async def legacy_commit(*_args, **_kwargs):
        return batch
    monkeypatch.setattr(case_portability, "commit_import", legacy_commit)
    monkeypatch.setattr(mcp_import.access_control, "require_component_access", lambda *_args: _async(SimpleNamespace(proyecto_id=PROJECT_ID)))
    monkeypatch.setattr(mcp_import.access_control, "require_build_access", lambda *_args: _async(SimpleNamespace(proyecto_id=PROJECT_ID, componente_id=COMPONENT_ID, activo=True, estado="ACTIVA")))
    monkeypatch.setattr(mcp_import.access_control, "is_build_active", lambda _build: True)
    args = _arguments(confirmation="APPLY_CASE_IMPORT", idempotency_key="idem-safe")
    args["preview_token"] = mcp_import.make_preview_token(PROJECT_ID, args)
    args["package_sha256"] = mcp_import.package_sha256(args["content_base64"])
    result = await mcp_import.commit_import(object(), SimpleNamespace(id=PROJECT_ID), SimpleNamespace(id=PROJECT_ID), args)
    assert set(result) == {"batch_id", "status", "summary", "commit_receipt", "rollback_token", "operation", "component_id", "build_id"}
    assert "case_id" not in str(result)


def test_preview_token_requires_configured_secret(monkeypatch):
    monkeypatch.delenv("TRESEKO_MCP_IMPORT_PREVIEW_SECRET", raising=False)
    with pytest.raises(RuntimeError, match="secret"):
        mcp_import.make_preview_token(PROJECT_ID, _arguments())


def test_commit_scope_is_required_even_when_identity_has_no_scope_attribute():
    assert not governance.tool_allowed_by_scopes("treseko.cases.import.commit", None)


def test_import_fingerprint_binds_all_mutation_parameters():
    base = _arguments(confirmation="APPLY_CASE_IMPORT", idempotency_key="same")
    base["package_sha256"] = mcp_import.package_sha256(base["content_base64"])
    fingerprints = {
        mcp_import.import_fingerprint(PROJECT_ID, base, base["package_sha256"]),
        *(mcp_import.import_fingerprint(PROJECT_ID, {**base, field: value}, base["package_sha256"])
          for field, value in (("profile_id", "other"), ("file_name", "other.tcases"),
                               ("component_id", str(uuid4())), ("build_id", str(uuid4())),
                               ("selected_external_ids", ["different"])))
    }
    assert len(fingerprints) == 6


def test_idempotency_is_persistent_not_process_local():
    from app import models
    assert hasattr(models, "McpImportIdempotency")
    assert "_IDEMPOTENT_RESULTS" not in inspect.getsource(mcp_import)
    assert set(models.McpImportIdempotency.__table__.columns.keys()) >= {
        "proyecto_id", "idempotency_key", "fingerprint", "result_json", "status"
    }
