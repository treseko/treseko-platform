import asyncio
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app import crud, models, schemas
from app.database import Base
from app.repositories.bug_version_metrics import bug_build_history_metrics


def test_bug_resolution_build_and_history_are_transactional():
    async def scenario():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        organization_id = uuid.uuid4()
        project_id = uuid.uuid4()
        component_id = uuid.uuid4()
        build_id = uuid.uuid4()
        other_build_id = uuid.uuid4()
        bug_id = uuid.uuid4()
        async with sessions() as db:
            db.add_all([
                models.Organizacion(id=organization_id, nombre="Org historial"),
                models.Proyecto(id=project_id, organizacion_id=organization_id, nombre="Proyecto historial"),
                models.Componente(id=component_id, proyecto_id=project_id, nombre="API"),
                models.Build(id=build_id, proyecto_id=project_id, componente_id=component_id, nombre="1.2.0", activo=True, estado="ACTIVA"),
                models.Build(id=other_build_id, proyecto_id=project_id, componente_id=component_id, nombre="1.1.0", activo=False, estado="HISTORICA"),
                models.BugIssue(
                    id=bug_id, codigo="BUG-HISTORY-1", proyecto_id=project_id,
                    componente_id=component_id, titulo="Error trazable", estado="ABIERTO",
                ),
            ])
            await db.commit()

            with pytest.raises(ValueError, match="Selecciona la build"):
                await crud.transition_bug_issue(db, bug_id, schemas.BugTransitionRequest(estado="RESUELTO"), None)

            with pytest.raises(ValueError, match="inactiva"):
                await crud.transition_bug_issue(
                    db, bug_id,
                    schemas.BugTransitionRequest(estado="RESUELTO", resolution_build_id=other_build_id),
                    None,
                )

            resolved = await crud.transition_bug_issue(
                db, bug_id,
                schemas.BugTransitionRequest(
                    estado="RESUELTO", resolution_build_id=build_id,
                    resolucion="Se corrigió la validación",
                ),
                None,
            )
            assert resolved.resolved_build_id == build_id
            assert resolved.resolved_build_name == "1.2.0"
            resolution_build = resolved.resolved_build

            reopened = await crud.transition_bug_issue(
                db, bug_id,
                schemas.BugTransitionRequest(estado="REABIERTO", resolution_build_id=build_id),
                None,
            )
            assert reopened.resolved_build_id is None
            assert reopened.reopened_count == 1

            closed = await crud.transition_bug_issue(
                db, bug_id,
                schemas.BugTransitionRequest(
                    estado="NO_CORRESPONDE", resolution_build_id=build_id,
                    motivo_cierre="Comportamiento esperado",
                ),
                None,
            )
            assert closed.resolved_build_id is None

            history = await crud.list_bug_status_history(db, bug_id)
            assert [event.to_status for event in history] == ["NO_CORRESPONDE", "REABIERTO", "RESUELTO"]
            assert history[-1].build_id == build_id
            assert history[-1].resolution == "Se corrigió la validación"
            metrics = bug_build_history_metrics([closed], history, resolution_build)
            assert metrics["corrected"] == {bug_id}
            assert metrics["administrative"] == {bug_id}
            assert metrics["reopened"] == {bug_id}

        await engine.dispose()

    asyncio.run(scenario())
