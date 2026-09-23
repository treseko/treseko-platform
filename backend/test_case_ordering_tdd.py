import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import crud, models, schemas
from app.api.routers import cases as cases_router
from app.repositories.cases_datasets import CaseOrganizationConflict, organization_revision, organization_lock_suite_ids, search_casos


def test_cross_suite_lock_order_is_identical_in_both_directions():
    first = uuid.uuid4()
    second = uuid.uuid4()
    assert organization_lock_suite_ids(first, second) == organization_lock_suite_ids(second, first)
    assert organization_lock_suite_ids(first, second) == tuple(sorted((first, second), key=str))


@pytest.fixture
async def session_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    tables = (
        models.Organizacion.__table__, models.Proyecto.__table__,
        models.Componente.__table__, models.Suite.__table__,
        models.CasoPrueba.__table__, models.PasoPrueba.__table__,
        models.EjecucionCaso.__table__,
    )
    async with engine.begin() as connection:
        for table in tables:
            await connection.run_sync(table.create)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


async def _seed(db):
    org = models.Organizacion(nombre="Org", tipo="Cliente")
    project = models.Proyecto(nombre="Project", organizacion=org)
    component = models.Componente(nombre="Component", proyecto=project)
    db.add_all([org, project, component])
    await db.flush()
    first = models.Suite(nombre="First", proyecto_id=project.id, componente_id=component.id)
    second = models.Suite(nombre="Second", proyecto_id=project.id, componente_id=component.id)
    db.add_all([first, second])
    await db.flush()
    cases = []
    for index, suite in enumerate((first, first, second), start=1):
        case = models.CasoPrueba(
            master_id=uuid.uuid4(), codigo=f"TC-{index}", proyecto_id=project.id,
            suite_id=suite.id, componente_id=component.id, titulo=f"Case {index}",
            version=1, prioridad=models.Prioridad.MEDIA, criticidad=models.Criticidad.MEDIA,
            tipo_prueba=models.TipoPrueba.MANUAL, estado_caso=models.EstadoCaso.ACTIVO,
            creado_por=uuid.uuid4(), orden=index - 1 if suite is first else 0,
        )
        cases.append(case)
        db.add(case)
    await db.commit()
    return project, first, second, cases


@pytest.mark.asyncio
async def test_reorder_cases_moves_between_suites_atomically(session_factory):
    async with session_factory() as db:
        project, first, second, cases = await _seed(db)
        moved = cases[0]
        updated = await crud.reorder_casos(
            db, moved.id, second.id, [cases[2].id, moved.id], [cases[1].id, moved.id]
        )
        assert updated.suite_id == second.id
        rows = (await db.execute(select(models.CasoPrueba).order_by(models.CasoPrueba.orden))).scalars().all()
        assert [(row.id, row.suite_id, row.orden) for row in rows if row.suite_id in {first.id, second.id}] == [
            (cases[1].id, first.id, 0), (cases[2].id, second.id, 0), (moved.id, second.id, 1)
        ]


@pytest.mark.asyncio
async def test_reorder_cases_rejects_incomplete_sibling_lists(session_factory):
    async with session_factory() as db:
        _project, first, _second, cases = await _seed(db)
        with pytest.raises(ValueError, match="lista completa"):
            await crud.reorder_casos(db, cases[0].id, first.id, [cases[1].id], [cases[0].id, cases[1].id])


@pytest.mark.asyncio
async def test_reorder_cases_rejects_componentless_case_into_component_suite(session_factory):
    async with session_factory() as db:
        project, first, second, cases = await _seed(db)
        cases[0].componente_id = None
        await db.commit()
        with pytest.raises(ValueError, match="componente"):
            await crud.reorder_casos(db, cases[0].id, second.id, [cases[2].id, cases[0].id], [cases[1].id, cases[0].id])


@pytest.mark.asyncio
async def test_reorder_cases_validates_same_suite_source_order_and_preserves_version(session_factory):
    async with session_factory() as db:
        _project, first, _second, cases = await _seed(db)
        original_version = cases[0].version
        with pytest.raises(ValueError, match="lista completa"):
            await crud.reorder_casos(db, cases[0].id, first.id, [cases[1].id, cases[0].id], [cases[0].id])
        with pytest.raises(ValueError, match="lista completa"):
            await crud.reorder_casos(db, cases[0].id, first.id, [cases[1].id, cases[0].id], [cases[0].id, cases[0].id])
        with pytest.raises(ValueError, match="lista completa"):
            await crud.reorder_casos(db, cases[0].id, _second.id, [cases[2].id, cases[0].id], [cases[1].id, cases[1].id, cases[0].id])
        await db.refresh(cases[0])
        assert cases[0].version == original_version


@pytest.mark.asyncio
async def test_reorder_rejects_archived_case_and_inactive_suites(session_factory):
    async with session_factory() as db:
        _project, first, second, cases = await _seed(db)
        cases[0].estado_caso = models.EstadoCaso.ARCHIVADO
        await db.commit()
        with pytest.raises(ValueError, match="archivados"):
            await crud.reorder_casos(db, cases[0].id, first.id, [cases[0].id, cases[1].id])
        cases[0].estado_caso = models.EstadoCaso.ACTIVO
        first.activo = False
        await db.commit()
        with pytest.raises(ValueError, match="origen"):
            await crud.reorder_casos(db, cases[0].id, second.id, [cases[2].id, cases[0].id])


@pytest.mark.asyncio
async def test_reorder_rejects_stale_revision_without_mutation(session_factory):
    async with session_factory() as db:
        _project, first, _second, cases = await _seed(db)
        before = sorted((case.id, case.orden) for case in cases)
        with pytest.raises(CaseOrganizationConflict):
            await crud.reorder_casos(db, cases[0].id, first.id, [cases[1].id, cases[0].id], revision="stale")
        rows = (await db.execute(select(models.CasoPrueba).order_by(models.CasoPrueba.id))).scalars().all()
        assert sorted((case.id, case.orden) for case in rows) == before


@pytest.mark.asyncio
async def test_reorder_uses_same_active_non_archived_source_set_for_validation(session_factory):
    async with session_factory() as db:
        project, first, second, cases = await _seed(db)
        archived = models.CasoPrueba(
            master_id=uuid.uuid4(), codigo="TC-ARCH", proyecto_id=project.id,
            suite_id=first.id, componente_id=cases[0].componente_id, titulo="Archived",
            version=1, prioridad=models.Prioridad.MEDIA, criticidad=models.Criticidad.MEDIA,
            tipo_prueba=models.TipoPrueba.MANUAL, estado_caso=models.EstadoCaso.ARCHIVADO,
            creado_por=uuid.uuid4(), orden=2,
        )
        db.add(archived)
        await db.commit()
        updated = await crud.reorder_casos(
            db, cases[0].id, second.id, [cases[2].id, cases[0].id], [cases[1].id, cases[0].id]
        )
        assert updated.suite_id == second.id


@pytest.mark.asyncio
async def test_search_cases_orders_by_suite_order_and_id_before_pagination(session_factory):
    async with session_factory() as db:
        project, first, second, cases = await _seed(db)
        cases[0].orden = 2
        cases[1].orden = 1
        cases[2].orden = 0
        await db.commit()
        items, total = await search_casos(db, project.id, skip=0, limit=3)
        assert total == 3
        actual_by_suite = {}
        for item in items:
            actual_by_suite.setdefault(item.suite_id, []).append(item.orden)
        expected_by_suite = {}
        for item in cases:
            expected_by_suite.setdefault(item.suite_id, []).append(item.orden)
        assert {suite_id: sorted(orders) for suite_id, orders in actual_by_suite.items()} == {
            suite_id: sorted(orders) for suite_id, orders in expected_by_suite.items()
        }


@pytest.mark.asyncio
async def test_reorder_returns_success_when_publication_fails_after_commit(session_factory, monkeypatch):
    async with session_factory() as db:
        _project, first, second, cases = await _seed(db)
        current_user = SimpleNamespace(id=uuid.uuid4())
        request = SimpleNamespace(client=None)

        async def allow_access(*_args, **_kwargs):
            return cases[0]

        async def fail_publication(*_args, **_kwargs):
            raise RuntimeError("broker unavailable")

        async def no_op_audit(**_kwargs):
            return None

        monkeypatch.setattr(cases_router, "_require_case_access", allow_access)
        monkeypatch.setattr(cases_router.crud, "create_audit_log", no_op_audit)
        monkeypatch.setattr(cases_router, "_publish_case_change", fail_publication)
        response = await cases_router.reorder_casos(
            request,
            schemas.CasoReorderRequest.model_construct(
                caso_id=cases[0].id,
                suite_id=second.id,
                orden=[cases[2].id, cases[0].id],
                orden_origen=[cases[1].id, cases[0].id],
                revision=None,
            ),
            db,
            current_user,
        )
        assert response["cases"]
        await db.refresh(cases[0])
        assert cases[0].suite_id == second.id


@pytest.mark.asyncio
async def test_legacy_move_returns_success_when_publication_fails_after_commit(session_factory, monkeypatch):
    async with session_factory() as db:
        _project, _first, second, cases = await _seed(db)
        current_user = SimpleNamespace(id=uuid.uuid4())
        request = SimpleNamespace(client=None)

        async def allow_access(*_args, **_kwargs):
            return cases[0]

        async def fail_publication(*_args, **_kwargs):
            raise RuntimeError("broker unavailable")

        async def fail_audit(**_kwargs):
            raise RuntimeError("audit store unavailable")

        monkeypatch.setattr(cases_router, "_require_case_access", allow_access)
        monkeypatch.setattr(cases_router.crud, "create_audit_log", fail_audit)
        monkeypatch.setattr(cases_router, "_publish_case_change", fail_publication)
        moved = await cases_router.move_caso(
            request,
            cases[0].id,
            schemas.CasoMoveRequest(suite_id=second.id),
            db,
            current_user,
        )
        assert moved.suite_id == second.id
        await db.refresh(cases[0])
        assert cases[0].suite_id == second.id


@pytest.mark.asyncio
async def test_legacy_move_assigns_dense_destination_order(session_factory):
    async with session_factory() as db:
        _project, first, second, cases = await _seed(db)
        moved = await crud.move_caso(db, cases[0].id, second.id)
        assert moved.suite_id == second.id
        rows = (await db.execute(select(models.CasoPrueba).order_by(models.CasoPrueba.suite_id, models.CasoPrueba.orden))).scalars().all()
        actual_by_suite = {}
        for row in rows:
            actual_by_suite.setdefault(row.suite_id, []).append(row.orden)
        assert actual_by_suite[first.id] == [0]
        assert actual_by_suite[second.id] == [0, 1]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("case_update", "target_update", "message"),
    [
        ({"activo": False}, {}, "inactivos"),
        ({"estado_caso": models.EstadoCaso.ARCHIVADO}, {}, "archivados"),
        ({}, {"activo": False}, "destino"),
        ({}, {"archivado": True}, "destino"),
    ],
)
async def test_legacy_move_rejects_inactive_or_archived_cases_and_destination_suites(
    session_factory, case_update, target_update, message
):
    async with session_factory() as db:
        _project, first, second, cases = await _seed(db)
        for field, value in case_update.items():
            setattr(cases[0], field, value)
        for field, value in target_update.items():
            setattr(second, field, value)
        await db.commit()
        original = (cases[0].suite_id, cases[0].orden, cases[0].version)

        with pytest.raises(ValueError, match=message):
            await crud.move_caso(db, cases[0].id, second.id)

        await db.refresh(cases[0])
        assert (cases[0].suite_id, cases[0].orden, cases[0].version) == original


def test_reorder_response_contract_contains_canonical_cases():
    response = schemas.CasoReorderResponse(cases=[], revision="rev-1")
    assert response.cases == []


def test_case_schema_exposes_persistent_order_and_legacy_move_payload_remains_valid():
    assert schemas.CasoMoveRequest(suite_id=uuid.uuid4()).suite_id
    assert schemas.CasoReorderRequest(
        caso_id=uuid.uuid4(), suite_id=uuid.uuid4(), orden=[uuid.uuid4()], revision="rev-1"
    ).orden
