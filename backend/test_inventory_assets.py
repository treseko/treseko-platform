import asyncio
import os
import sys
import uuid
from pathlib import Path

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
os.chdir(BACKEND_DIR)

from app import crud, models, schemas  # noqa: E402


async def _session_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
      await conn.run_sync(models.Organizacion.__table__.create)
      await conn.run_sync(models.Proyecto.__table__.create)
      await conn.run_sync(models.InventoryCategory.__table__.create)
      await conn.run_sync(models.InventoryAsset.__table__.create)
      await conn.run_sync(models.InventoryEndpoint.__table__.create)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def test_inventory_assets_allow_repeated_ips_and_children():
    engine, session_factory = await _session_factory()
    try:
        async with session_factory() as db:
            org = models.Organizacion(nombre=f"Org {uuid.uuid4()}", tipo="Cliente")
            project = models.Proyecto(nombre=f"Project {uuid.uuid4()}", organizacion=org)
            db.add_all([org, project])
            await db.commit()

            server = await crud.create_inventory_asset(
                db,
                project.id,
                schemas.InventoryAssetCreate(
                    nombre="Servidor QA-01",
                    tipo="Servidor",
                    naturaleza="fisico",
                    endpoints=[schemas.InventoryEndpointCreate(tipo="ip", valor="10.10.0.5", principal=True)],
                ),
            )

            api = await crud.create_inventory_asset(
                db,
                project.id,
                schemas.InventoryAssetCreate(
                    nombre="API QA",
                    tipo="API",
                    naturaleza="digital",
                    parent_id=server.id,
                    endpoints=[schemas.InventoryEndpointCreate(tipo="ip", valor="10.10.0.5", puerto=8443, protocolo="https")],
                ),
            )
            database = await crud.create_inventory_asset(
                db,
                project.id,
                schemas.InventoryAssetCreate(
                    nombre="DB QA",
                    tipo="Base de datos",
                    naturaleza="digital",
                    parent_id=server.id,
                    endpoints=[schemas.InventoryEndpointCreate(tipo="ip", valor="10.10.0.5", puerto=5432, protocolo="tcp")],
                ),
            )

            assert server.endpoints[0].valor == api.endpoints[0].valor == database.endpoints[0].valor
            assert api.parent_id == server.id
            assert database.parent_id == server.id

            hosted_assets = await crud.get_inventory_assets(db, project.id, parent_id=server.id)
            assert {asset.nombre for asset in hosted_assets} == {"API QA", "DB QA"}
    finally:
        await engine.dispose()


async def test_inventory_parent_must_belong_to_same_project():
    engine, session_factory = await _session_factory()
    try:
        async with session_factory() as db:
            org = models.Organizacion(nombre=f"Org {uuid.uuid4()}", tipo="Cliente")
            project_a = models.Proyecto(nombre=f"Project A {uuid.uuid4()}", organizacion=org)
            project_b = models.Proyecto(nombre=f"Project B {uuid.uuid4()}", organizacion=org)
            db.add_all([org, project_a, project_b])
            await db.commit()

            server = await crud.create_inventory_asset(
                db,
                project_a.id,
                schemas.InventoryAssetCreate(nombre="Servidor A", tipo="Servidor", naturaleza="fisico"),
            )
            invalid_child = await crud.create_inventory_asset(
                db,
                project_b.id,
                schemas.InventoryAssetCreate(
                    nombre="Servicio cruzado",
                    tipo="Servicio",
                    naturaleza="digital",
                    parent_id=server.id,
                ),
            )

            assert invalid_child is None
    finally:
        await engine.dispose()


async def run_checks():
    await test_inventory_assets_allow_repeated_ips_and_children()
    await test_inventory_parent_must_belong_to_same_project()
    print("Inventory asset checks OK")


if __name__ == "__main__":
    asyncio.run(run_checks())
