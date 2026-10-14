from __future__ import annotations

import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest
import sqlalchemy as sa


MIGRATION_PATH = Path(__file__).parent / "alembic" / "versions" / "20260916_0063_mcp_import_idempotency.py"


class FakeInspector:
    def __init__(self, *, tables=(), columns=None, primary=None, uniques=(), indexes=(), foreign_keys=(), comment=None):
        self.tables = set(tables)
        self.columns = columns or {}
        self.primary = primary or []
        self.uniques = list(uniques)
        self.indexes = list(indexes)
        self.foreign_keys = list(foreign_keys)
        self.comment = comment

    def has_table(self, name):
        return name in self.tables

    def get_columns(self, name):
        return self.columns[name]

    def get_pk_constraint(self, name):
        return {"constrained_columns": self.primary}

    def get_unique_constraints(self, name):
        return self.uniques

    def get_indexes(self, name):
        return self.indexes

    def get_foreign_keys(self, name):
        return self.foreign_keys

    def get_table_comment(self, name):
        return {"text": self.comment}


class FakeOp:
    def __init__(self, inspector):
        self.inspector = inspector
        self.created_tables = []
        self.created_indexes = []
        self.dropped_tables = []
        self.dropped_indexes = []

    def get_bind(self):
        return SimpleNamespace(dialect=SimpleNamespace(name="sqlite"))

    def create_table(self, *args, **kwargs):
        self.created_tables.append((args, kwargs))

    def create_index(self, *args, **kwargs):
        self.created_indexes.append((args, kwargs))

    def execute(self, statement):
        pass

    def drop_table(self, name):
        self.dropped_tables.append(name)

    def drop_index(self, name, table_name=None):
        self.dropped_indexes.append((name, table_name))


@pytest.fixture
def migration():
    spec = importlib.util.spec_from_file_location("mcp_idempotency_migration", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_upgrade_rejects_existing_incomplete_table_instead_of_masking_it(migration, monkeypatch):
    inspector = FakeInspector(tables={"mcp_import_idempotency"}, columns={"mcp_import_idempotency": []})
    op = FakeOp(inspector)
    monkeypatch.setattr(migration.sa, "inspect", lambda bind: inspector)
    monkeypatch.setattr(migration, "op", op)

    with pytest.raises(RuntimeError, match="does not match the required schema"):
        migration.upgrade()

    assert op.created_tables == []


def test_upgrade_creates_table_only_when_revision_history_lacks_it(migration, monkeypatch):
    inspector = FakeInspector()
    op = FakeOp(inspector)
    monkeypatch.setattr(migration.sa, "inspect", lambda bind: inspector)
    monkeypatch.setattr(migration, "op", op)

    migration.upgrade()

    assert [args[0] for args, _ in op.created_tables] == ["mcp_import_idempotency"]
    assert [args[:2] for args, _ in op.created_indexes] == [("ix_mcp_import_idempotency_project", "mcp_import_idempotency")]


def test_downgrade_preserves_baseline_table_but_removes_revision_owned_table(migration, monkeypatch):
    inspector = FakeInspector(tables={"mcp_import_idempotency"}, comment=None)
    op = FakeOp(inspector)
    monkeypatch.setattr(migration.sa, "inspect", lambda bind: inspector)
    monkeypatch.setattr(migration, "op", op)

    migration.downgrade()
    assert op.dropped_tables == []

    inspector.comment = migration._MIGRATION_TABLE_COMMENT
    migration.downgrade()
    assert op.dropped_tables == ["mcp_import_idempotency"]
    assert op.dropped_indexes == [("ix_mcp_import_idempotency_project", "mcp_import_idempotency")]
