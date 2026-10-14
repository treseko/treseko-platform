"""Licensed duplicate flow, persistence and access checks on an isolated API."""
import asyncio
from uuid import uuid4

import httpx
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app import auth, models
from app.database import Base, get_db
from app.api.routers import bugs as bugs_router


def test_duplicate_http_persists_history_and_rejects_cycles_and_cross_project(monkeypatch):
    async def no_notifications(*args, **kwargs):
        pass
    monkeypatch.setattr(bugs_router, "_emit_bug_event", no_notifications)

    async def scenario():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        org, project, foreign_project, user_id = uuid4(), uuid4(), uuid4(), uuid4()
        source_id, original_id, foreign_id = uuid4(), uuid4(), uuid4()
        async with sessions() as db:
            user = models.Usuario(id=user_id, email="bug-tracker@qa.test", nombre_completo="QA", rol=models.Rol.ADMIN, activo=True, hashed_password="unused", modulos=[], permisos={})
            db.add(user)
            db.add(models.Organizacion(id=org, nombre="QA bugs"))
            db.add_all([models.Proyecto(id=project, organizacion_id=org, nombre="QA principal"), models.Proyecto(id=foreign_project, organizacion_id=org, nombre="QA aislado")])
            await db.flush()
            db.add_all([models.BugIssue(id=source_id, codigo="BUG-1", proyecto_id=project, titulo="Origen", estado="ABIERTO"), models.BugIssue(id=original_id, codigo="BUG-2", proyecto_id=project, titulo="Principal", estado="ABIERTO"), models.BugIssue(id=foreign_id, codigo="BUG-3", proyecto_id=foreign_project, titulo="Aislado", estado="ABIERTO")])
            await db.commit()

            app = FastAPI()
            app.include_router(bugs_router.router)
            async def current_user():
                return user
            async def database():
                yield db
            async def licensed():
                pass
            app.dependency_overrides[get_db] = database
            app.dependency_overrides[auth.get_current_active_user] = current_user
            # Only the isolated test app has its edition gate controlled.
            route = next(route for route in bugs_router.router.routes if getattr(route, "path", "") == "/bugs/{bug_id}/mark-duplicate/")
            feature_dependency = next(dep.call for dep in route.dependant.dependencies if dep.name == "_premium_bugs")
            app.dependency_overrides[feature_dependency] = licensed
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://qa.test") as client:
                incomplete = await client.post(f"/bugs/{source_id}/transition/", json={"estado": "DUPLICADO"})
                assert incomplete.status_code == 422
                assert "bug principal" in incomplete.json()["detail"]
                cross = await client.post(f"/bugs/{source_id}/mark-duplicate/", json={"duplicate_of_id": str(foreign_id)})
                assert cross.status_code == 422
                own = await client.post(f"/bugs/{source_id}/mark-duplicate/", json={"duplicate_of_id": str(source_id)})
                assert own.status_code == 422
                payload = {"duplicate_of_id": str(original_id), "comentario": "Misma causa confirmada"}
                marked = await client.post(f"/bugs/{source_id}/mark-duplicate/", json=payload)
                assert marked.status_code == 200, marked.text
                assert marked.json()["estado"] == "DUPLICADO"
                assert marked.json()["duplicate_of_id"] == str(original_id)
                repeated = await client.post(f"/bugs/{source_id}/mark-duplicate/", json=payload)
                assert repeated.status_code == 200
                cycle = await client.post(f"/bugs/{original_id}/mark-duplicate/", json={"duplicate_of_id": str(source_id)})
                assert cycle.status_code == 422
                history = await client.get(f"/bugs/{source_id}/history/")
                assert history.status_code == 200
                assert len(history.json()) == 1
                assert history.json()[0]["actor_id"] == str(user_id)
                stored = (await db.execute(select(models.BugIssue).where(models.BugIssue.id == source_id))).scalar_one()
                assert stored.duplicate_of_id == original_id
                comments = (await db.execute(select(models.BugComment).where(models.BugComment.bug_id == source_id))).scalars().all()
                assert len(comments) == 1
                # A viewer cannot mutate the relationship.
                user.rol = models.Rol.VIEWER
                denied = await client.post(f"/bugs/{original_id}/mark-duplicate/", json={"duplicate_of_id": str(source_id)})
                assert denied.status_code == 403
        await engine.dispose()
    asyncio.run(scenario())
