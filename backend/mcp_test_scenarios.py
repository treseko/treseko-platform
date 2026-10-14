"""Synthetic end-to-end MCP scenarios shared by integration checks."""
import base64
from types import SimpleNamespace
from uuid import UUID, uuid4

import httpx
from sqlalchemy import select
from app import models
from app.database import AsyncSessionLocal
from app.api.routers import api_tests
from app.services import mcp_execution_queue as queue, case_portability
from app.services.api_test_runner import run_api_test


async def exercise_remaining(monkeypatch, call, mutate, project_id, org_id, component_id, build_id, environment_id, user_id):
    created_project = await mutate('treseko.projects.create', {'organization_id': org_id, 'data': {'nombre': 'Created through MCP'}})
    assert created_project['organizacion_id'] == org_id
    case = await mutate('treseko.cases.create', {'project_id': project_id, 'title': 'MCP authored', 'description': 'Preserve me', 'steps': [{'action': 'Open', 'expected_result': 'Visible'}]})
    updated = await mutate('treseko.cases.update', {'project_id': project_id, 'case_id': case['id'], 'title': 'Updated through MCP'})
    detail = await call('treseko.cases.get', {'project_id': project_id, 'case_id': updated['id']})
    assert detail['description'] == 'Preserve me' and len(detail['steps']) == 1
    await mutate('treseko.cases.archive', {'project_id': project_id, 'case_id': updated['id']})
    api_config = {'schema_version': 'treseko.api-test/v1', 'steps': [{'name': 'health', 'request': {'method': 'GET', 'url': '{{base_url}}/health'}, 'assertions': [{'source': 'response.status', 'operator': 'equals', 'expected': 200}]}]}
    api_cases = []
    for index in range(2):
        api_cases.append(await mutate('treseko.cases.create', {'project_id': project_id, 'title': f'API fixture {index}', 'format': 'API', 'api_configuration': api_config}))
    async with AsyncSessionLocal() as db:
        for item in api_cases:
            db.add(models.BuildCaso(build_id=UUID(build_id), caso_id=UUID(item['id'])))
        await db.commit()
    run_args = {'project_id': project_id, 'name': 'MCP API suite', 'environment': 'QA', 'environment_id': environment_id, 'build_id': build_id, 'case_ids': [item['id'] for item in api_cases]}
    run = await mutate('treseko.test-runs.create', run_args)
    await call('treseko.test-runs.get', {'project_id': project_id, 'run_id': run['id']})
    dispatch = await mutate('treseko.test-runs.execute', {'project_id': project_id, 'run_id': run['id']})
    assert dispatch['accepted'] and dispatch['dispatch_status'] == 'PENDING'
    # A different operation key still refers to one durable job for this run.
    again = await mutate('treseko.test-runs.execute', {'project_id': project_id, 'run_id': run['id']})
    assert again['dispatch_status'] == 'PENDING'
    class Executor:
        count = 0
        async def execute(self, config, environment, variables, **kwargs):
            self.count += 1
            report = await run_api_test(config, environment, variables, transport=httpx.MockTransport(lambda request: httpx.Response(500, json={'ok': False})), **kwargs)
            if self.count == 1:
                await mutate('treseko.test-runs.cancel', {'project_id': project_id, 'run_id': run['id']})
            return report
    # Editing a case after acceptance must not change the queued request.
    async with AsyncSessionLocal() as db:
        queued_case = await db.get(models.CasoPrueba, UUID(api_cases[0]['id']))
        queued_case.configuracion_api = {}
        await db.commit()
    executor = Executor()
    monkeypatch.setattr(api_tests, 'get_api_test_executor', lambda: executor)
    assert await queue.dispatch_one()
    assert executor.count == 1  # cancellation must prevent the next API case
    status = await call('treseko.test-runs.status', {'project_id': project_id, 'run_id': run['id']})
    assert status['dispatch_status'] == 'CANCELLED'
    results = await call('treseko.test-results.list', {'project_id': project_id, 'run_id': run['id']})
    failed = next(item for item in results['items'] if item['status'] == models.EstadoResultado.FALLO.value)
    detail = await call('treseko.test-results.get', {'project_id': project_id, 'execution_id': failed['id']})
    assert detail['api_result']['steps'][0]['response']['status'] == 500
    async with AsyncSessionLocal() as db:
        snapshot = await db.scalar(select(models.SnapshotPaso).where(models.SnapshotPaso.ejecucion_caso_id == UUID(failed['id'])))
        attachment = models.Attachment(filename_original='fixture.txt', content_type='text/plain', size=7, sha256='f'*64, storage_path='synthetic/fixture.txt', public_url='/static/fixture.txt', scope='RESULT', created_by=user_id, proyecto_id=UUID(project_id))
        db.add(attachment); await db.flush()
        evidence = models.SnapshotAttachment(snapshot_id=snapshot.id, attachment_id=attachment.id, tipo='RESULT')
        db.add(evidence); await db.commit()
        snapshot_id, evidence_id = str(snapshot.id), str(evidence.id)
    await call('treseko.evidence.list', {'project_id': project_id, 'snapshot_id': snapshot_id})
    evidence_result = await call('treseko.evidence.get', {'project_id': project_id, 'evidence_id': evidence_id})
    assert evidence_result['filename'] == 'fixture.txt'
    bug = await mutate('treseko.bugs.create-from-result', {'project_id': project_id, 'execution_id': failed['id'], 'bug': {'title': 'Fixture API failure'}})
    await mutate('treseko.bugs.create-from-snapshot', {'project_id': project_id, 'snapshot_id': snapshot_id, 'bug': {'title': 'Fixture snapshot failure'}})
    await call('treseko.bugs.get', {'project_id': project_id, 'bug_id': bug['id']})
    await mutate('treseko.bugs.update', {'project_id': project_id, 'bug_id': bug['id'], 'bug': {'description': 'Fixture explanation'}})
    await mutate('treseko.bugs.transition', {'project_id': project_id, 'bug_id': bug['id'], 'transition': {'status': 'EN_PROGRESO'}})
    await mutate('treseko.bugs.close', {'project_id': project_id, 'bug_id': bug['id'], 'transition': {'status': 'NO_CORRESPONDE', 'close_reason': 'Synthetic test fixture'}})
    monkeypatch.setenv('TRESEKO_MCP_IMPORT_PREVIEW_SECRET', 'synthetic-import-signing-secret')
    async with AsyncSessionLocal() as db:
        source_case = await db.get(models.CasoPrueba, UUID(case['id']))
        source_case.componente_id = UUID(component_id)
        await db.commit()
        package = await case_portability.export_tcases(db, UUID(project_id), UUID(component_id), case_ids=[source_case.id])
    args = {'project_id': project_id, 'profile_id': 'treseko/tcases-v1', 'content_base64': base64.b64encode(package).decode(), 'component_id': component_id, 'file_name': 'fixture.tcases'}
    preview = await call('treseko.cases.import.preview', args)
    receipt = await mutate('treseko.cases.import.commit', {**args, 'preview_token': preview['preview_token'], 'package_sha256': preview['package_sha256']})
    await mutate('treseko.cases.import.rollback', {'project_id': project_id, 'batch_id': receipt['batch_id'], 'commit_receipt': receipt['commit_receipt'], 'rollback_token': receipt['rollback_token']})
