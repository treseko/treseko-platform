"""Add durable MCP import idempotency reservations."""

from alembic import op
import sqlalchemy as sa

revision = "20260916_0063"
down_revision = "20260915_0058"
branch_labels = None
depends_on = None

_TABLE = "mcp_import_idempotency"
_INDEX = "ix_mcp_import_idempotency_project"
_UNIQUE = "uq_mcp_import_idempotency_project_key"
_MIGRATION_TABLE_COMMENT = "treseko-mcp-import-idempotency-created-by-20260916-0063"
_EXPECTED_COLUMNS = {
    "id", "proyecto_id", "idempotency_key", "fingerprint", "status",
    "result_json", "created_at", "updated_at",
}


def _created_by_this_migration() -> bool:
    return sa.inspect(op.get_bind()).get_table_comment(_TABLE).get("text") == _MIGRATION_TABLE_COMMENT


def _validate_existing_table(inspector) -> None:
    columns = {column["name"]: column for column in inspector.get_columns(_TABLE)}
    primary = inspector.get_pk_constraint(_TABLE).get("constrained_columns") or []
    unique_constraints = {item.get("name") for item in inspector.get_unique_constraints(_TABLE)}
    indexes = {item.get("name") for item in inspector.get_indexes(_TABLE)}
    foreign_keys = {
        (item.get("referred_table"), tuple(item.get("constrained_columns", [])), tuple(item.get("referred_columns", [])))
        for item in inspector.get_foreign_keys(_TABLE)
    }
    required_foreign_key = ("proyectos", ("proyecto_id",), ("id",))
    if (
        set(columns) != _EXPECTED_COLUMNS
        or primary != ["id"]
        or _UNIQUE not in unique_constraints
        or _INDEX not in indexes
        or required_foreign_key not in foreign_keys
        or any(columns[name]["nullable"] for name in _EXPECTED_COLUMNS - {"result_json"})
    ):
        raise RuntimeError("Existing MCP idempotency table does not match the required schema")

    if op.get_bind().dialect.name == "postgresql":
        if (
            any(not isinstance(columns[name]["type"], sa.Uuid) for name in ("id", "proyecto_id"))
            or getattr(columns["idempotency_key"]["type"], "length", None) != 128
            or getattr(columns["fingerprint"]["type"], "length", None) != 64
            or getattr(columns["status"]["type"], "length", None) != 20
            or any(not getattr(columns[name]["type"], "timezone", False) for name in ("created_at", "updated_at"))
        ):
            raise RuntimeError("Existing MCP idempotency column types are incompatible")


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    # Base.metadata.create_all(checkfirst=True) in the baseline imports this
    # current ORM model, so a fresh database already has the table. Validate it
    # rather than masking an incompatible schema with IF NOT EXISTS.
    if inspector.has_table(_TABLE):
        _validate_existing_table(inspector)
        return

    op.create_table(
        _TABLE,
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("proyecto_id", sa.UUID(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="PENDING", nullable=False),
        sa.Column("result_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["proyecto_id"], ["proyectos.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("proyecto_id", "idempotency_key", name=_UNIQUE),
    )
    op.execute(f"COMMENT ON TABLE {_TABLE} IS '{_MIGRATION_TABLE_COMMENT}'")
    op.create_index(_INDEX, _TABLE, ["proyecto_id"])


def downgrade() -> None:
    # Never remove a table supplied by the baseline or an older deployment.
    # Only a table this revision created is safe to reverse automatically.
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table(_TABLE) and _created_by_this_migration():
        op.drop_index(_INDEX, table_name=_TABLE)
        op.drop_table(_TABLE)
