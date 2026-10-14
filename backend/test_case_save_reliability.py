"""HTTP/database regression checks; run only with owned local infrastructure."""
import asyncio
import os
from uuid import uuid4
import httpx
import pytest
from sqlalchemy import select, func
from app import auth, crud, models
from app.database import AsyncSessionLocal, engine
from app.main import app
from app.api.routers import cases as routes

pytestmark = pytest.mark.skipif(os.getenv('TRESEKO_TEST_ISOLATE_HTTP_DATA') != '1', reason='Requires controlled local PostgreSQL')


async def test_case_save_archive_clone_and_reference_recovery(monkeypatch):
    assert engine.url.database == 'treseko_tests' and engine.url.host in {'127.0.0.1', 'localhost'}
    async with AsyncSessionLocal() as db:
        user = models.Usuario(email=f'case-save-{uuid4()}@example.invalid', rol=models.Rol.ADMIN, activo=True)
        org = models.Organizacion(nombre='Cases regression')
        db.add_all([user, org]); await db.flush()
        project = models.Proyecto(nombre='Save recovery', organizacion_id=org.id)
        db.add(project); await db.flush()
        component = models.Componente(nombre='Web', proyecto_id=project.id)
        db.add(component); await db.flush()
        suite = models.Suite(nombre='Checkout', proyecto_id=project.id, componente_id=component.id)
        build = models.Build(nombre='Current', proyecto_id=project.id, componente_id=component.id, estado='ACTIVA', activo=True)
        db.add_all([suite, build]); await db.commit()
        headers = {'Authorization': 'Bearer ' + auth.create_access_token({'sub': user.email, 'sv': user.session_version})}
        payload = dict(proyecto_id=str(project.id), componente_id=str(component.id), suite_id=str(suite.id), titulo='Payment', prioridad='MEDIA', tipo_prueba='MANUAL', request_id=str(uuid4()), pasos=[dict(numero_paso=1, accion='Pay', resultado_esperado='Approved')])
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False), base_url='http://qa', headers=headers) as client:
            original_publish = routes._publish_case_change
            async def publication_failure(*args, **kwargs):
                raise RuntimeError('Controlled realtime failure')
            monkeypatch.setattr(routes, '_publish_case_change', publication_failure)
            created = await client.post('/casos/', json=payload)
            assert created.status_code == 200, created.text
            case = created.json()
            retries = await asyncio.gather(client.post('/casos/', json=payload), client.post('/casos/', json=payload))
            assert all(response.status_code == 200 and response.json()['id'] == case['id'] for response in retries)
            retry = await client.post('/casos/', json=payload)
            assert retry.status_code == 200 and retry.json()['id'] == case['id']
            changed = await client.post('/casos/', json={**payload, 'titulo': 'Different request'})
            assert changed.status_code == 409
            assert await db.scalar(select(func.count()).select_from(models.CasoPrueba).where(models.CasoPrueba.proyecto_id == project.id)) == 1
            monkeypatch.setattr(routes, '_publish_case_change', original_publish)

            original_audit = routes.crud.create_audit_log
            async def audit_failure(*args, **kwargs):
                raise RuntimeError('Controlled audit failure')
            monkeypatch.setattr(routes.crud, 'create_audit_log', audit_failure)
            failed_payload = {**payload, 'titulo': 'Must roll back', 'request_id': str(uuid4())}
            failed = await client.post('/casos/', json=failed_payload)
            assert failed.status_code == 503
            assert await db.scalar(select(func.count()).select_from(models.CasoPrueba).where(models.CasoPrueba.titulo == 'Must roll back')) == 0
            failed_update = await client.put('/casos/' + case['master_id'], json={**payload, 'titulo': 'Must not change'})
            assert failed_update.status_code == 503
            async with AsyncSessionLocal() as verify:
                persisted = await verify.scalar(select(models.CasoPrueba).where(models.CasoPrueba.master_id == case['master_id']))
                assert persisted.titulo == 'Payment'
            monkeypatch.setattr(routes.crud, 'create_audit_log', original_audit)

            row = await db.scalar(select(models.CasoPrueba).where(models.CasoPrueba.id == case['id']))
            run = models.TestRun(proyecto_id=project.id, build_id=build.id, nombre='Finished', entorno='QA', creado_por=user.id)
            db.add(run); await db.flush()
            db.add(models.EjecucionCaso(test_run_id=run.id, caso_id=row.id, version_ejecutada=1, ejecutado_por=user.id, estado_resultado=models.EstadoResultado.PASO))
            await db.commit()
            edited = await client.put('/casos/' + case['master_id'], json={**payload, 'titulo': 'Payment v2'})
            assert edited.status_code == 200 and edited.json()['version'] == 2
            latest = edited.json()
            stale = await client.patch('/casos/' + case['id'] + '/metadata', json={'titulo': 'Old editor'})
            assert stale.status_code == 409
            copied = await client.post('/suites/' + str(suite.id) + '/clone', json={'nuevo_nombre': 'Copy', 'include_cases': True})
            assert copied.status_code == 200, copied.text
            assert copied.json()['casos_copiados'] == 1
            copied_suite = copied.json()['suite']['id']
            copy_rows = (await db.execute(select(models.CasoPrueba).where(models.CasoPrueba.suite_id == copied_suite))).scalars().all()
            assert len(copy_rows) == 1 and copy_rows[0].titulo.startswith('Copia de Payment v2')
            db.add(models.BuildCaso(build_id=build.id, caso_id=latest['id'])); await db.commit()
            for path, method, body in [
                ('/casos/' + latest['id'] + '/metadata', 'patch', {'estado_caso': 'ARCHIVADO'}),
                ('/casos/' + case['master_id'], 'put', {**payload, 'titulo': 'Payment v2', 'estado_caso': 'ARCHIVADO'}),
                ('/suites/' + str(suite.id) + '/archive', 'patch', {'archivado': True}),
            ]:
                result = await getattr(client, method)(path, json=body)
                assert result.status_code == 409, result.text
            async with AsyncSessionLocal() as verify:
                assert not (await verify.get(models.Suite, suite.id)).archivado
                states = (await verify.execute(select(models.CasoPrueba.estado_caso).where(models.CasoPrueba.master_id == row.master_id))).scalars().all()
                assert all(state != models.EstadoCaso.ARCHIVADO for state in states)
            detail = (await client.get('/casos/' + latest['id'])).json()
            step_id = detail['pasos'][0]['id']
            references = []
            for index in range(3):
                attachment = models.Attachment(filename_original=f'{index}.png', content_type='image/png', size=1, sha256=str(index)*64, storage_path=f'controlled/{index}', public_url=f'/static/controlled/{index}', scope='step', proyecto_id=project.id, created_by=user.id)
                db.add(attachment); await db.flush(); references.append(attachment)
            db.add_all([models.PasoAttachment(paso_id=step_id, attachment_id=references[0].id, tipo='ACTION_REFERENCE'), models.PasoAttachment(paso_id=step_id, attachment_id=references[1].id, tipo='evidence')]); await db.commit()
            replaced = await client.put('/pasos/' + step_id + '/references/', json={'attachments': [{'attachment_id': str(references[2].id), 'tipo': 'EXPECTED_REFERENCE'}]})
            assert replaced.status_code == 200, replaced.text
            assert {link['tipo'] for link in replaced.json()} == {'evidence', 'EXPECTED_REFERENCE'}
            invalid = await client.put('/pasos/' + step_id + '/references/', json={'attachments': [{'attachment_id': str(uuid4()), 'tipo': 'ACTION_REFERENCE'}]})
            assert invalid.status_code == 404
            after = (await client.get('/pasos/' + step_id + '/attachments/')).json()
            assert {link['tipo'] for link in after} == {'evidence', 'EXPECTED_REFERENCE'}
            from sqlalchemy.ext.asyncio import AsyncSession
            original_commit = AsyncSession.commit
            async def commit_failure(self):
                raise RuntimeError('Controlled commit failure')
            monkeypatch.setattr(AsyncSession, 'commit', commit_failure)
            try:
                failed_replacement = await client.put('/pasos/' + step_id + '/references/', json={'attachments': [{'attachment_id': str(references[0].id), 'tipo': 'ACTION_REFERENCE'}]})
                assert failed_replacement.status_code == 503
            finally:
                monkeypatch.setattr(AsyncSession, 'commit', original_commit)
            after_failure = (await client.get('/pasos/' + step_id + '/attachments/')).json()
            assert {link['tipo'] for link in after_failure} == {'evidence', 'EXPECTED_REFERENCE'}
            viewer = models.Usuario(email=f'viewer-{uuid4()}@example.invalid', rol=models.Rol.VIEWER, activo=True)
            db.add(viewer); await db.commit()
            denied = await client.put('/pasos/' + step_id + '/references/', json={'attachments': []}, headers={'Authorization': 'Bearer ' + auth.create_access_token({'sub': viewer.email, 'sv': viewer.session_version})})
            assert denied.status_code == 403
            wrong_type = await client.put('/pasos/' + step_id + '/references/', json={'attachments': [{'attachment_id': str(references[0].id), 'tipo': 'evidence'}]})
            assert wrong_type.status_code == 422
    await engine.dispose()
