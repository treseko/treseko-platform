"""History pages, evidence contracts and RBAC exercised against real ORM queries."""
from datetime import datetime, timezone
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app import auth, crud, models
from app.api.routers import test_runs
from app.database import Base, get_db
from app.services.history_evidence import redact_history_evidence


@pytest_asyncio.fixture
async def history_db():
    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with sessions() as db:
        org, project, user = uuid4(), uuid4(), uuid4()
        db.add(models.Organizacion(id=org, nombre='Historial'))
        db.add(models.Proyecto(id=project, organizacion_id=org, nombre='Historial'))
        cases = []
        for kind in ['CLASICA', 'API', 'CONVERSACIONAL']:
            case = models.CasoPrueba(id=uuid4(), master_id=uuid4(), proyecto_id=project,
                titulo=kind, codigo=kind, version=1, prioridad=models.Prioridad.MEDIA,
                tipo_prueba=models.TipoPrueba.MANUAL, formato_prueba=models.FormatoPrueba(kind), creado_por=user)
            db.add(case); cases.append(case)
        runs = []
        for index in range(63):
            run = models.TestRun(id=uuid4(), proyecto_id=project, nombre=f'Historial {index}',
                creado_por=user, entorno='QA', origen='MANUAL', fecha_creacion=datetime(2026, 10, 10, tzinfo=timezone.utc))
            db.add(run); runs.append(run)
        executions = []
        for index, run in enumerate(runs):
            case = cases[1] if index == 1 else cases[2] if index == 2 else cases[0]
            execution = models.EjecucionCaso(id=uuid4(), test_run_id=run.id, caso_id=case.id,
                version_ejecutada=1, ejecutado_por=user, estado_resultado=models.EstadoResultado.FALLO if index % 2 else models.EstadoResultado.PASO,
                observaciones='Observación del caso', evidence_policy={'public_test_data': False})
            if index == 1:
                execution.api_config_snapshot = {'request': {'headers': {'authorization': 'Bearer secret-value'}}}
                execution.api_resultado = {'steps': [{'request': {'headers': {'authorization': 'Bearer secret-value'}}, 'response': {'status': 500, 'body': 'secret-value'}, 'assertions': [{'status': 'FAILED'}]}]}
            if index == 2:
                execution.chatbot_resultado = {'turns': [{'message': f'Turno {i}', 'responseText': 'Respuesta', 'statusCode': 200} for i in range(45)]}
                execution.chatbot_config_snapshot = {'conversation': {'turns': [{'input': {'text': f'Turno {i}'}} for i in range(45)]}}
            db.add(execution); executions.append(execution)
        for index in range(7):
            db.add(models.SnapshotPaso(id=uuid4(), ejecucion_caso_id=executions[0].id, numero_paso=index + 1,
                accion_congelada='Paso', resultado_esperado_congelado='Resultado', evidencia_url=None if index == 6 else f'https://example.test/evidence/{index}.png'))
        await db.commit()
        yield db, project, runs, executions, org
    await engine.dispose()


async def test_history_pages_have_exact_total_stable_order_and_legacy_list(history_db):
    db, project, runs, _, _ = history_db
    pages = [await crud.get_test_runs_summary(db, project, skip=skip, limit=25, paginated=True) for skip in [0, 25, 50]]
    assert [len(page['items']) for page in pages] == [25, 25, 13]
    assert all(page['total'] == 63 for page in pages)
    ids = [item['id'] for page in pages for item in page['items']]
    assert len(set(ids)) == 63
    assert ids == [str(run.id) for run in sorted(runs, key=lambda run: run.id, reverse=True)]
    assert isinstance(await crud.get_test_runs_summary(db, project, limit=10), list)
    assert (await crud.get_test_runs_summary(db, project, skip=100, paginated=True))['total'] == 63
    failed = await crud.get_test_runs_summary(db, project, status='FALLO', paginated=True)
    assert failed['total'] == 31
    assert all(item['failed'] == 1 for item in failed['items'])


async def test_evidence_filter_counts_the_whole_run_and_structured_formats(history_db):
    db, project, runs, _, _ = history_db
    yes = await crud.get_test_runs_summary(db, project, has_evidence=True, paginated=True)
    no = await crud.get_test_runs_summary(db, project, has_evidence=False, paginated=True)
    assert yes['total'] == 3 and no['total'] == 60
    assert not {item['id'] for item in yes['items']} & {item['id'] for item in no['items']}
    mixed = next(item for item in yes['items'] if item['id'] == str(runs[0].id))
    assert mixed['evidence_count'] == 6 and len(mixed['evidencias']) == 3
    assert any(item['evidencias'][0].get('kind') == 'API' for item in yes['items'])


async def test_detail_keeps_observations_api_results_all_turns_and_frozen_policy(history_db):
    db, _, runs, executions, _ = history_db
    api = (await crud.get_test_run_detail(db, runs[1].id, sanitize_output=True))['casos'][0]
    assert api['observaciones'] == 'Observación del caso'
    assert api['api_resultado']['steps'][0]['response']['status'] == 500
    assert 'secret-value' not in str(api)
    chatbot = (await crud.get_test_run_detail(db, runs[2].id, sanitize_output=True))['casos'][0]
    assert len(chatbot['chatbot_resultado']['turns']) == 45
    assert len(chatbot['chatbot_config_snapshot']['conversation']['turns']) == 45
    executions[1].evidence_policy = {'public_test_data': True}
    await db.commit()
    public = (await crud.get_test_run_detail(db, runs[1].id, sanitize_output=True))['casos'][0]
    assert public['api_resultado']['steps'][0]['request']['headers']['authorization'] == 'Bearer secret-value'


@pytest.mark.parametrize('restricted', ['none', 'detail', 'evidence'])
async def test_history_http_viewer_and_restricted_capabilities(history_db, restricted):
    db, project, runs, _, _ = history_db
    user = models.Usuario(id=uuid4(), email='history@example.invalid', nombre_completo='History reader',
        rol=models.Rol.VIEWER, activo=True, permisos={}, permisos_detallados={})
    db.add(models.ProyectoMiembro(proyecto_id=project, usuario_id=user.id, rol_proyecto='VIEWER'))
    await db.commit()
    if restricted == 'detail': user.permisos_detallados = {'historial.detalle': 'none'}
    if restricted == 'evidence': user.permisos_detallados = {'historial.evidencias': 'none'}
    app = FastAPI(); app.include_router(test_runs.router)
    async def identity(): return user
    async def database(): yield db
    app.dependency_overrides[auth.get_current_active_user] = identity
    app.dependency_overrides[get_db] = database
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://history-test') as client:
        listing = await client.get(f'/proyectos/{project}/test-runs/?view=historial&paginated=true&limit=25')
        assert listing.status_code == 200 and listing.json()['total'] == 63
        detail = await client.get(f'/test-runs/{runs[1].id}/detalle/?view=historial')
        if restricted == 'detail': assert detail.status_code == 403
        else:
            assert detail.status_code == 200
            if restricted == 'evidence':
                assert detail.json()['casos'][0]['api_resultado'] == {}
                assert detail.json()['variables_resueltas'] == {}
                assert all(item['evidence_count'] == 0 for item in listing.json()['items'])
        assert (await client.get(f'/proyectos/{uuid4()}/test-runs/?view=historial')).status_code == 404
        assert (await client.get(f'/proyectos/{project}/test-runs/?view=ejecutar')).status_code == 403
        assert (await client.get(f'/proyectos/{project}/test-runs/?version_executed=0')).status_code == 422
        assert (await client.get(f'/proyectos/{project}/test-runs/?date_from=2026-10-11&date_to=2026-10-10')).status_code == 422


def test_redaction_preserves_full_structure_and_header_pairs():
    safe = redact_history_evidence({'headers': [{'name': 'Authorization', 'value': 'Bearer full-secret'}],
        'turns': [{'response': 'Bearer full-secret'} for _ in range(60)]})
    assert len(safe['turns']) == 60
    assert 'full-secret' not in str(safe)


async def test_case_status_and_whole_run_result_are_independent(history_db):
    db, project, runs, executions, _ = history_db
    db.add(models.EjecucionCaso(id=uuid4(), test_run_id=runs[0].id, caso_id=executions[1].caso_id,
        version_ejecutada=1, ejecutado_por=executions[0].ejecutado_por, estado_resultado=models.EstadoResultado.FALLO))
    await db.commit()
    case_passed = await crud.get_test_runs_summary(db, project, status='PASO', paginated=True)
    mixed = next(item for item in case_passed['items'] if item['id'] == str(runs[0].id))
    assert mixed['status'] == 'failed' and mixed['passed'] == 1 and mixed['failed'] == 1
    runs_passed = await crud.get_test_runs_summary(db, project, run_result='PASO', paginated=True)
    assert runs_passed['total'] == 31
    assert str(runs[0].id) not in {item['id'] for item in runs_passed['items']}
    filtered = await crud.get_test_runs_summary(db, project, case_query='API', run_result='FALLO', paginated=True, limit=1)
    assert filtered['total'] == 2 and len(filtered['items']) == 1
    assert all(item['status'] == 'failed' for item in filtered['items'])
    assert (await crud.get_test_runs_summary(db, project, case_query='API', run_result='PASO', paginated=True))['total'] == 0


async def test_active_ai_count_and_result_follow_completion(history_db):
    db, project, runs, executions, _ = history_db
    executions[0].estado_resultado = models.EstadoResultado.EJECUTANDO_AI
    executions[0].execution_mode = models.ExecutionMode.IA
    await db.commit()
    running = await crud.get_test_runs_summary(db, project, run_result='EN_PROGRESO', paginated=True)
    assert running['total'] == 1
    assert running['items'][0]['status'] == 'running'
    assert running['items'][0]['running'] == 1 and running['items'][0]['pending'] == 0
    assert (await crud.get_test_runs_summary(db, project, status='EJECUTANDO_AI', paginated=True))['total'] == 1
    for state, result, status in [(models.EstadoResultado.PASO, 'PASO', 'passed'), (models.EstadoResultado.FALLO, 'FALLO', 'failed')]:
        executions[0].estado_resultado = state
        await db.commit()
        finished = await crud.get_test_runs_summary(db, project, run_result=result, paginated=True)
        row = next(item for item in finished['items'] if item['id'] == str(runs[0].id))
        assert row['status'] == status and row['running'] == 0
        assert (await crud.get_test_runs_summary(db, project, run_result='EN_PROGRESO', paginated=True))['total'] == 0


async def test_detail_urls_are_visible_safe_and_deduplicated(history_db, tmp_path):
    from sqlalchemy import select
    db, _, runs, executions, _ = history_db
    snapshots = (await db.execute(select(models.SnapshotPaso).where(models.SnapshotPaso.ejecucion_caso_id == executions[0].id).order_by(models.SnapshotPaso.numero_paso))).scalars().all()
    snapshots[-1].evidencia_url = 'javascript:alert(1)'
    file = tmp_path / 'capture.png'; file.write_bytes(b'fixture')
    attachment = models.Attachment(
        id=uuid4(), filename_original='capture.png', content_type='image/png', size=7, sha256='a'*64,
        storage_path=str(file), public_url=snapshots[0].evidencia_url, scope='EXECUTION_EVIDENCE', created_by=executions[0].ejecutado_por)
    db.add(attachment)
    db.add(models.SnapshotAttachment(id=uuid4(), snapshot_id=snapshots[0].id, attachment_id=attachment.id, tipo='EXECUTION_EVIDENCE'))
    await db.commit()
    detail = (await crud.get_test_run_detail(db, runs[0].id, sanitize_output=True))['casos'][0]
    assert sum(len(item['evidencias']) for item in detail['snapshots']) == 6
    assert len(detail['snapshots'][0]['evidencias']) == 1
    assert all(item['content_type'] == 'image/png' for snapshot in detail['snapshots'] for item in snapshot['evidencias'])
    assert 'javascript:' not in str(detail)


@pytest.mark.parametrize('membership, denied, allowed', [('VIEWER', None, False), ('TESTER', 'bugs.crear', False), ('TESTER', 'bugs.ver', False), ('TESTER', None, True)])
async def test_history_bug_action_uses_capabilities_and_project_write_access(history_db, membership, denied, allowed):
    db, project, runs, _, _ = history_db
    user = models.Usuario(id=uuid4(), email='history-action@example.invalid', nombre_completo='Reader', rol=models.Rol.VIEWER,
        activo=True, permisos={}, permisos_detallados={'bugs.ver': 'read', 'bugs.crear': 'edit'})
    if denied: user.permisos_detallados = {**user.permisos_detallados, denied: 'none'}
    db.add(models.ProyectoMiembro(proyecto_id=project, usuario_id=user.id, rol_proyecto=membership)); await db.commit()
    app = FastAPI(); app.include_router(test_runs.router)
    async def identity(): return user
    async def database(): yield db
    app.dependency_overrides[auth.get_current_active_user] = identity
    app.dependency_overrides[get_db] = database
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://history-test') as client:
        response = await client.get(f'/test-runs/{runs[2].id}/detalle/?view=historial')
        assert response.status_code == 200
        assert response.json()['can_create_bug'] is allowed
        assert (await client.get(f'/proyectos/{project}/test-runs/?view=historial&run_result=UNKNOWN')).status_code == 422
