"""Behavioral coverage for filtered summaries and stable server pagination."""
import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app import crud, models, schemas
from app.database import Base


def test_bug_tracker_pages_filters_summaries_and_order():
    async def scenario():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        project_id, other_id, org_id = uuid4(), uuid4(), uuid4()
        async with sessions() as db:
            db.add(models.Organizacion(id=org_id, nombre="QA listado"))
            db.add_all([models.Proyecto(id=project_id, organizacion_id=org_id, nombre="Listado"), models.Proyecto(id=other_id, organizacion_id=org_id, nombre="Aislado")])
            await db.flush()
            now = datetime(2026, 10, 10, tzinfo=timezone.utc)
            bugs = [models.BugIssue(id=uuid4(), codigo=f"BUG-{index}", proyecto_id=project_id,
                titulo=f"Pago {index}", estado="ABIERTO" if index % 2 == 0 else "CERRADO",
                severidad="CRITICA" if index % 3 == 0 else "MEDIA", prioridad=f"P{index % 5}",
                created_at=now + timedelta(seconds=index)) for index in range(125)]
            db.add_all(bugs)
            db.add(models.BugIssue(id=uuid4(), codigo="OTHER", proyecto_id=other_id, titulo="Otro proyecto", estado="ABIERTO"))
            await db.commit()
            pages = [await crud.list_project_bugs(db, project_id, skip=skip, limit=25, include_summary=True) for skip in range(0, 125, 25)]
            assert all(page["total"] == 125 and page["summary"]["total"] == 125 for page in pages)
            ids = [item.id for page in pages for item in page["items"]]
            assert len(set(ids)) == 125
            assert pages[0]["items"][0].codigo == "BUG-124"
            assert pages[-1]["items"][-1].codigo == "BUG-0"
            filtered = await crud.list_project_bugs(db, project_id, estado="ABIERTO", severidad="CRITICA", limit=25, include_summary=True)
            assert filtered["total"] == 21
            assert filtered["summary"]["abiertos"] == 21
            assert filtered["summary"]["criticos"] == 21
            assert all(item.estado == "ABIERTO" and item.severidad == "CRITICA" for item in filtered["items"])
            for attention in ["open", "critical", "unassigned", "retest", "no_evidence", "linked"]:
                result = await crud.list_project_bugs(db, project_id, attention=attention, include_summary=True)
                assert result["summary"]["total"] == result["total"]
            center = await crud.list_incident_center(db, allowed_project_ids=[project_id], attention="critical", sort="priority", limit=5)
            assert center["total"] == 21
            assert center["summary"]["criticos"] == 21
            assert len(center["items"]) == 5
            assert all(item.proyecto_id == project_id for item in center["items"])
            exported = await crud.list_incident_center_export(db, allowed_project_ids=[project_id], attention="critical", sort="priority")
            assert len(exported) == 21
            assert [item.id for item in center["items"]] == [item.id for item in exported[:5]]
            center_oldest = await crud.list_incident_center(db, allowed_project_ids=[project_id], sort="oldest", limit=1)
            assert center_oldest["items"][0].codigo == "BUG-0"
            oldest = await crud.list_project_bugs(db, project_id, sort="oldest", limit=1)
            assert oldest["items"][0].codigo == "BUG-0"
            priority = await crud.list_project_bugs(db, project_id, sort="priority", limit=26)
            assert all(item.prioridad == "P0" for item in priority["items"][:25])
            assert priority["items"][25].prioridad == "P1"
            assert priority["items"][0].codigo == "BUG-0"
            assert schemas.BugListResponse.model_validate(filtered).summary.total == 21
            assert "summary" not in oldest
        await engine.dispose()
    asyncio.run(scenario())
