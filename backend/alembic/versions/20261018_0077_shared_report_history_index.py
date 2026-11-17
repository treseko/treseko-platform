"""index shared report identity and compact history metadata"""

from alembic import op
import sqlalchemy as sa
import copy
import json


revision = "20261018_0077"
down_revision = "20261015_0076"
branch_labels = None
depends_on = None


def _json_object(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return {}
    return value if isinstance(value, dict) else {}


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("shared_report_snapshots")}
    if "snapshot_group_id" not in columns:
        op.add_column("shared_report_snapshots", sa.Column("snapshot_group_id", sa.String(length=80), nullable=True))
    if "report_type" not in columns:
        op.add_column("shared_report_snapshots", sa.Column("report_type", sa.String(length=24), nullable=True))
    if "history_metadata" not in columns:
        op.add_column("shared_report_snapshots", sa.Column("history_metadata", sa.JSON(), nullable=True))
    tables = set(inspector.get_table_names())
    if "shared_report_payloads" not in tables:
        op.create_table(
            "shared_report_payloads",
            sa.Column("snapshot_group_id", sa.String(length=80), primary_key=True),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        )

    bind = op.get_bind()
    select_first_batch = sa.text(
        "SELECT id, payload FROM shared_report_snapshots ORDER BY id LIMIT 10"
    )
    select_next_batch = sa.text(
        "SELECT id, payload FROM shared_report_snapshots "
        "WHERE id > :last_id ORDER BY id LIMIT 10"
    )
    update = sa.text(
        "UPDATE shared_report_snapshots "
        "SET snapshot_group_id = :group_id, report_type = :report_type, history_metadata = :history_metadata "
        "WHERE id = :id"
    ).bindparams(sa.bindparam("history_metadata", type_=sa.JSON()))
    metadata_keys = (
        "organizacion", "proyecto", "componente", "build", "build_code",
        "requested_report_type", "build_definition", "qa_comment",
        "definition_responsible_id", "definition_responsible_display", "definition_at",
        "snapshot_hash", "snapshot_bundle_version",
    )
    last_id = None
    while True:
        statement = select_first_batch if last_id is None else select_next_batch
        rows = bind.execute(statement, {} if last_id is None else {"last_id": last_id}).mappings().all()
        if not rows:
            break
        updates = []
        for row in rows:
            payload = _json_object(row["payload"])
            metadata = payload.get("metadata")
            metadata = metadata if isinstance(metadata, dict) else {}
            group_id = metadata.get("snapshot_group_id") or f"legacy:{row['id']}"
            report_type = str(metadata.get("report_type") or "executive").lower()
            if report_type not in {"executive", "development", "internal"}:
                report_type = "executive"
            updates.append({
                "id": row["id"],
                "group_id": str(group_id)[:80],
                "report_type": report_type,
                "history_metadata": {key: metadata.get(key) for key in metadata_keys},
            })
        bind.execute(update, updates)
        last_id = rows[-1]["id"]

    group_batch = sa.text(
        "SELECT snapshot_group_id FROM shared_report_snapshots "
        "WHERE snapshot_group_id > :last_group_id GROUP BY snapshot_group_id "
        "ORDER BY snapshot_group_id LIMIT 25"
    )
    first_group_batch = sa.text(
        "SELECT snapshot_group_id FROM shared_report_snapshots "
        "GROUP BY snapshot_group_id ORDER BY snapshot_group_id LIMIT 25"
    )
    group_rows_query = sa.text(
        "SELECT id, snapshot_group_id, report_type FROM shared_report_snapshots "
        "WHERE snapshot_group_id = :group_id "
        "ORDER BY CASE report_type WHEN 'development' THEN 0 WHEN 'internal' THEN 1 ELSE 2 END, created_at"
    )
    payload_by_id = sa.text("SELECT payload FROM shared_report_snapshots WHERE id = :id")
    insert_shared = sa.text(
        "INSERT INTO shared_report_payloads (snapshot_group_id, payload) VALUES (:group_id, :payload)"
    ).bindparams(sa.bindparam("payload", type_=sa.JSON()))
    compact_snapshot = sa.text(
        "UPDATE shared_report_snapshots SET payload = :payload WHERE id = :id"
    ).bindparams(sa.bindparam("payload", type_=sa.JSON()))
    last_group_id = None
    while True:
        group_statement = first_group_batch if last_group_id is None else group_batch
        group_params = {} if last_group_id is None else {"last_group_id": last_group_id}
        group_ids = [row[0] for row in bind.execute(group_statement, group_params).all()]
        if not group_ids:
            break
        for group_id in group_ids:
            rows = bind.execute(group_rows_query, {"group_id": group_id}).mappings().all()
            if not rows:
                continue
            canonical_row = bind.execute(payload_by_id, {"id": rows[0]["id"]}).first()
            canonical = copy.deepcopy(_json_object(canonical_row[0] if canonical_row else {}))
            if not bind.execute(
                sa.text("SELECT 1 FROM shared_report_payloads WHERE snapshot_group_id = :group_id"),
                {"group_id": group_id},
            ).first():
                bind.execute(insert_shared, {"group_id": group_id, "payload": canonical})
            for row in rows:
                payload_row = bind.execute(payload_by_id, {"id": row["id"]}).first()
                current_payload = _json_object(payload_row[0] if payload_row else {})
                metadata = current_payload.get("metadata")
                metadata = metadata if isinstance(metadata, dict) else {}
                summary_keys = (
                    "organizacion", "proyecto", "componente", "build", "build_code", "branding",
                    "snapshot_at", "snapshot_hash", "snapshot_created_for_build", "snapshot_bundle_version",
                    "snapshot_group_id", "report_type", "requested_report_type", "build_definition", "qa_comment",
                    "definition_responsible_id", "definition_responsible_display", "definition_at",
                    "bundle_tokens", "bundle_paths",
                )
                compact_payload = {
                    "metadata": {key: metadata.get(key) for key in summary_keys},
                    "stats": ((current_payload.get("metrics") or {}).get("stats") or current_payload.get("stats") or {}),
                    "qa_summary": current_payload.get("qa_summary") or {},
                }
                bind.execute(compact_snapshot, {"id": row["id"], "payload": compact_payload})
        last_group_id = group_ids[-1]

    indexes = {index["name"] for index in sa.inspect(bind).get_indexes("shared_report_snapshots")}
    if "ix_shared_report_snapshots_snapshot_group_id" not in indexes:
        op.create_index("ix_shared_report_snapshots_snapshot_group_id", "shared_report_snapshots", ["snapshot_group_id"])
    if "ix_shared_report_scope_created" not in indexes:
        op.create_index("ix_shared_report_scope_created", "shared_report_snapshots", ["proyecto_id", "build_id", "componente_id", "created_at"])
    if "ix_shared_report_group_scope" not in indexes:
        op.create_index("ix_shared_report_group_scope", "shared_report_snapshots", ["proyecto_id", "snapshot_group_id"])
    if "ix_shared_report_scope_latest_type" not in indexes:
        op.create_index("ix_shared_report_scope_latest_type", "shared_report_snapshots", ["proyecto_id", "build_id", "componente_id", "report_type", "created_at"])


def downgrade() -> None:
    bind = op.get_bind()
    if "shared_report_payloads" in set(sa.inspect(bind).get_table_names()):
        groups = bind.execute(sa.text(
            "SELECT snapshot_group_id FROM shared_report_snapshots "
            "GROUP BY snapshot_group_id ORDER BY snapshot_group_id"
        )).all()
        snapshot_rows_query = sa.text(
            "SELECT id, snapshot_group_id, report_type FROM shared_report_snapshots WHERE snapshot_group_id = :group_id"
        )
        payload_query = sa.text("SELECT payload FROM shared_report_payloads WHERE snapshot_group_id = :group_id")
        restore = sa.text("UPDATE shared_report_snapshots SET payload = :payload WHERE id = :id").bindparams(
            sa.bindparam("payload", type_=sa.JSON())
        )
        for group_row in groups:
            group_id = group_row[0]
            payload_row = bind.execute(payload_query, {"group_id": group_id}).first()
            canonical = _json_object(payload_row[0] if payload_row else {})
            for row in bind.execute(snapshot_rows_query, {"group_id": group_id}).mappings():
                base = copy.deepcopy(canonical)
                metadata = base.setdefault("metadata", {})
                report_type = row["report_type"] or "executive"
                metadata["report_type"] = report_type
                if report_type == "executive":
                    base["development"] = {}
                    base["internal"] = {}
                elif report_type == "development":
                    base["internal"] = {}
                else:
                    cases = []
                    stack = list((base.get("metrics") or {}).get("por_suite_tree") or [])
                    while stack:
                        current = stack.pop()
                        cases.extend(current.get("casos") or [])
                        stack.extend(current.get("children") or [])
                    base["internal"] = {
                        "cases": cases,
                        "notes": "Vista interna autenticada con detalle operativo del snapshot.",
                    }
                bind.execute(restore, {"id": row["id"], "payload": base})
    indexes = {index["name"] for index in sa.inspect(op.get_bind()).get_indexes("shared_report_snapshots")}
    for index_name in (
        "ix_shared_report_scope_latest_type",
        "ix_shared_report_group_scope",
        "ix_shared_report_scope_created",
        "ix_shared_report_snapshots_snapshot_group_id",
    ):
        if index_name in indexes:
            op.drop_index(index_name, table_name="shared_report_snapshots")
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("shared_report_snapshots")}
    for column_name in ("history_metadata", "report_type", "snapshot_group_id"):
        if column_name in columns:
            op.drop_column("shared_report_snapshots", column_name)
    if "shared_report_payloads" in set(sa.inspect(op.get_bind()).get_table_names()):
        op.drop_table("shared_report_payloads")
