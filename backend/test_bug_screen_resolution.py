import importlib.util
import uuid
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
import sqlalchemy as sa

from app import schemas


def test_new_and_legacy_screen_fields_do_not_overwrite_solution():
    new = schemas.BugIssueUpdate(resolucion_pantalla="1920x1080", resolucion="Se corrigió el pago")
    assert new.resolucion_pantalla == "1920x1080"
    assert new.resolucion == "Se corrigió el pago"
    legacy = schemas.BugIssueUpdate(resolucion=" 1280 × 720 ")
    assert legacy.model_dump(exclude_unset=True) == {"resolucion_pantalla": " 1280 × 720 "}
    solution = schemas.BugIssueUpdate(resolucion="Corregir el layout a 1280x720")
    assert solution.model_dump(exclude_unset=True) == {"resolucion": "Corregir el layout a 1280x720"}
    created = schemas.BugIssueCreate(proyecto_id=uuid.uuid4(), titulo="Pago", resolucion="1920x1080")
    assert created.resolucion_pantalla == "1920x1080"
    assert created.resolucion is None


def test_migration_preserves_dimensions_free_text_and_round_trip():
    path = Path(__file__).parent / "alembic/versions/20261010_0072_bug_screen_resolution.py"
    spec = importlib.util.spec_from_file_location("screen_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = sa.create_engine("sqlite:///:memory:")
    meta = sa.MetaData()
    table = sa.Table("bug_issues", meta, sa.Column("id", sa.Uuid, primary_key=True),
                     sa.Column("resolucion", sa.Text), sa.Column("metadata_json", sa.JSON))
    ids = [uuid.uuid4() for _ in range(3)]
    with engine.begin() as connection:
        meta.create_all(connection)
        connection.execute(table.insert(), [
            {"id": ids[0], "resolucion": " 1920 × 1080 ", "metadata_json": {"keep": True}},
            {"id": ids[1], "resolucion": "Se corrigió el pago", "metadata_json": {}},
            {"id": ids[2], "resolucion": "Layout en 1280x720", "metadata_json": {}},
        ])
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            upgraded = migration._table()
            rows = {row["id"]: row for row in connection.execute(sa.select(upgraded)).mappings()}
            assert rows[ids[0]]["resolucion_pantalla"] == " 1920 × 1080 "
            assert rows[ids[0]]["resolucion"] is None
            assert rows[ids[1]]["resolucion"] == "Se corrigió el pago"
            assert rows[ids[2]]["resolucion"] == "Layout en 1280x720"
            connection.execute(upgraded.update().where(upgraded.c.id == ids[0]).values(resolucion="Solución independiente"))
            migration.downgrade()
            legacy = connection.execute(sa.select(table).where(table.c.id == ids[0])).mappings().one()
            assert legacy["resolucion"] == "Solución independiente"
            assert legacy["metadata_json"][migration.BACKUP_KEY] == " 1920 × 1080 "
            assert legacy["metadata_json"]["keep"] is True
            migration.upgrade()
            restored = connection.execute(sa.select(upgraded).where(upgraded.c.id == ids[0])).mappings().one()
            assert restored["resolucion_pantalla"] == " 1920 × 1080 "
            assert restored["resolucion"] == "Solución independiente"
