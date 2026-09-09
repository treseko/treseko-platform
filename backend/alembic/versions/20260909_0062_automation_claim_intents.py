"""Persist runner claim intent identity and closed-request tombstones."""
from alembic import op
import sqlalchemy as sa

revision = "20260909_0062"
down_revision = "20260905_0061"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("automation_claim_intents"):
        # The historical baseline imports current Base.metadata. Fresh installs
        # therefore already have this table before reaching this revision.
        columns = {column["name"]: column for column in inspector.get_columns("automation_claim_intents")}
        expected = {"runner_id", "attempt_id", "job_id", "state", "lease_fingerprint", "created_at", "closed_at"}
        checks = {check["name"] for check in inspector.get_check_constraints("automation_claim_intents")}
        primary = inspector.get_pk_constraint("automation_claim_intents")["constrained_columns"]
        if (set(columns) != expected or primary != ["runner_id", "attempt_id"]
                or any(columns[name]["nullable"] for name in expected - {"lease_fingerprint", "closed_at"})
                or not {"ck_claim_intent_state", "ck_claim_intent_closed_at", "ck_claim_intent_claimed_lease"} <= checks):
            raise RuntimeError("Existing claim intent table does not match the required schema")
        if op.get_bind().dialect.name == "postgresql":
            if (any(not isinstance(columns[name]["type"], sa.Uuid) for name in ("runner_id", "attempt_id", "job_id"))
                    or getattr(columns["state"]["type"], "length", None) != 10
                    or getattr(columns["lease_fingerprint"]["type"], "length", None) != 64
                    or any(not getattr(columns[name]["type"], "timezone", False) for name in ("created_at", "closed_at"))):
                raise RuntimeError("Existing claim intent column types are incompatible")
        return
    op.create_table(
        "automation_claim_intents",
        sa.Column("runner_id", sa.UUID(), primary_key=True),
        sa.Column("attempt_id", sa.UUID(), primary_key=True),
        sa.Column("job_id", sa.UUID(), nullable=False),
        sa.Column("state", sa.String(10), nullable=False, server_default="OPEN"),
        sa.Column("lease_fingerprint", sa.String(64)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("closed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("state IN ('OPEN', 'CLAIMED', 'CLOSED')", name="ck_claim_intent_state"),
        sa.CheckConstraint(
            "(state = 'CLOSED' AND closed_at IS NOT NULL) OR "
            "(state != 'CLOSED' AND closed_at IS NULL)", name="ck_claim_intent_closed_at"),
        sa.CheckConstraint("state != 'CLAIMED' OR lease_fingerprint IS NOT NULL",
                           name="ck_claim_intent_claimed_lease"),
    )


def downgrade() -> None:
    # Removing tombstones can make previously closed requests executable again.
    # Use coordinated backup restoration for a populated installation instead.
    bind = op.get_bind()
    if bind.execute(sa.text("SELECT 1 FROM automation_claim_intents LIMIT 1")).first():
        raise RuntimeError("Cannot discard claim reconciliation history; use coordinated recovery")
    op.drop_table("automation_claim_intents")
