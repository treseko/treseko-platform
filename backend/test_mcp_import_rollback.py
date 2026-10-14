from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy.sql.selectable import Select

from app.services import mcp_governance as governance
from app.services import mcp_import


PROJECT_ID = uuid4()
BATCH_ID = uuid4()
RECEIPT = "receipt-1"


def test_rollback_has_separate_scope_and_write_metadata(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.cases.import.rollback")
    tool = governance.resolve_tool("treseko.cases.import.rollback")
    assert tool is not None
    assert tool.required_scope == "mcp.cases.import.rollback"
    assert tool.operation == "rollback"
    assert tool.read_only is False
    assert governance.tool_allowed_by_scopes(tool.name, ["mcp.cases.import.rollback"])
    assert not governance.tool_allowed_by_scopes(tool.name, ["mcp.cases.import.commit"])


def test_rollback_arguments_require_confirmation_receipt_token_and_idempotency(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.cases.import.rollback")
    tool = governance.resolve_tool("treseko.cases.import.rollback")
    args = {
        "project_id": str(PROJECT_ID), "batch_id": str(BATCH_ID),
        "commit_receipt": RECEIPT, "rollback_token": "token",
        "confirmation": "ROLLBACK_CASE_IMPORT", "idempotency_key": "retry-1",
    }
    assert governance.validate_tool_arguments(tool, args)["batch_id"] == str(BATCH_ID)
    for field in args:
        if field in {"project_id"}:
            continue
        invalid = dict(args); invalid.pop(field)
        with pytest.raises(ValueError):
            governance.validate_tool_arguments(tool, invalid)


def test_rollback_token_binds_project_batch_and_commit_receipt(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_IMPORT_PREVIEW_SECRET", "test-secret")
    token = mcp_import.make_rollback_token(PROJECT_ID, BATCH_ID, RECEIPT)
    assert mcp_import.valid_rollback_token(PROJECT_ID, BATCH_ID, RECEIPT, token)
    assert not mcp_import.valid_rollback_token(uuid4(), BATCH_ID, RECEIPT, token)
    assert not mcp_import.valid_rollback_token(PROJECT_ID, uuid4(), RECEIPT, token)
    assert not mcp_import.valid_rollback_token(PROJECT_ID, BATCH_ID, "foreign", token)


@pytest.mark.asyncio
async def test_rollback_requires_durable_completed_mcp_receipt(monkeypatch):
    user = SimpleNamespace(id=uuid4())
    project = SimpleNamespace(id=PROJECT_ID)
    args = {
        "project_id": str(PROJECT_ID), "batch_id": str(BATCH_ID),
        "commit_receipt": RECEIPT, "rollback_token": "bad",
        "confirmation": "ROLLBACK_CASE_IMPORT", "idempotency_key": "retry-1",
    }
    with pytest.raises(ValueError, match="receipt"):
        await mcp_import.rollback_import(object(), user, project, args)


@pytest.mark.asyncio
async def test_distinct_rollback_keys_serialize_on_the_import_batch_row(monkeypatch):
    """A second rollback key must observe the first transaction's target state."""
    batch = SimpleNamespace(id=BATCH_ID, proyecto_id=PROJECT_ID, status="COMPLETED")
    statements = []

    class Result:
        def scalar_one_or_none(self):
            return batch

        def scalars(self):
            return SimpleNamespace(all=lambda: [SimpleNamespace(result_json={
                "batch_id": str(BATCH_ID), "commit_receipt": RECEIPT,
                "operation": "treseko.cases.import.commit",
            })])

    class DB:
        async def get(self, *_args, **_kwargs):
            return batch

        async def execute(self, statement):
            statements.append(statement)
            return Result()

        async def commit(self):
            return None

    async def resolved(value):
        return value

    monkeypatch.setattr(mcp_import, "valid_rollback_token", lambda *_args: True)
    monkeypatch.setattr(mcp_import, "_reserve_idempotency", lambda *_args: resolved((SimpleNamespace(), None)))
    monkeypatch.setattr(mcp_import.case_portability, "rollback_batch", lambda *_args, **_kwargs: resolved(batch))
    result = await mcp_import.rollback_import(DB(), SimpleNamespace(id=uuid4()), SimpleNamespace(id=PROJECT_ID), {
        "project_id": str(PROJECT_ID), "batch_id": str(BATCH_ID), "commit_receipt": RECEIPT,
        "rollback_token": "token", "confirmation": "ROLLBACK_CASE_IMPORT", "idempotency_key": "key-a",
    })
    assert result["rolled_back"] is True
    assert statements, "the target must be selected in the transaction"
    locked = [statement for statement in statements if isinstance(statement, Select) and statement._for_update_arg is not None]
    assert locked, "the target must be selected FOR UPDATE"


@pytest.mark.asyncio
async def test_locked_rollback_reload_refreshes_state_after_prior_rollback(monkeypatch):
    """A distinct key must not mutate a batch already rolled back by another key."""
    stale_batch = SimpleNamespace(id=BATCH_ID, proyecto_id=PROJECT_ID, status="COMPLETED")
    rolled_back_batch = SimpleNamespace(id=BATCH_ID, proyecto_id=PROJECT_ID, status="ROLLED_BACK")

    class Result:
        def __init__(self, value):
            self.value = value

        def scalar_one_or_none(self):
            return self.value

        def scalars(self):
            return SimpleNamespace(all=lambda: [SimpleNamespace(result_json={
                "batch_id": str(BATCH_ID), "commit_receipt": RECEIPT,
                "operation": "treseko.cases.import.commit",
            })])

    class DB:
        async def get(self, *_args, **_kwargs):
            return stale_batch

        async def execute(self, statement):
            if isinstance(statement, Select) and statement._for_update_arg is not None:
                refreshed = statement.get_execution_options().get("populate_existing")
                return Result(rolled_back_batch if refreshed else stale_batch)
            return Result(None)

        async def commit(self):
            pytest.fail("a stale rollback must not commit")

        async def rollback(self):
            return None

    async def resolved(value):
        return value

    async def reject_rolled_back_batch(_db, batch, *_args, **_kwargs):
        if batch.status == "ROLLED_BACK":
            raise ValueError("El lote no se puede revertir")
        return batch

    monkeypatch.setattr(mcp_import, "valid_rollback_token", lambda *_args: True)
    monkeypatch.setattr(mcp_import, "_reserve_idempotency", lambda *_args: resolved((SimpleNamespace(), None)))
    monkeypatch.setattr(mcp_import.case_portability, "rollback_batch", reject_rolled_back_batch)

    with pytest.raises(ValueError, match="no se puede revertir"):
        await mcp_import.rollback_import(DB(), SimpleNamespace(id=uuid4()), SimpleNamespace(id=PROJECT_ID), {
            "project_id": str(PROJECT_ID), "batch_id": str(BATCH_ID), "commit_receipt": RECEIPT,
            "rollback_token": "token", "confirmation": "ROLLBACK_CASE_IMPORT", "idempotency_key": "key-b",
        })
