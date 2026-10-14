"""Real PostgreSQL regression for MCP contracts, workspace writes and atomicity."""
import json
from types import SimpleNamespace
from uuid import uuid4, UUID

import pytest
from jsonschema import Draft7Validator
from sqlalchemy import select
from starlette.requests import Request
from app import models, schemas, crud
from app.database import AsyncSessionLocal, engine
from app.api.routers import mcp as router
from app.services import mcp_governance as gov, mcp_mutations
from app.services.mcp_redaction import redact
from app.services.mcp_unit_of_work import mutation_session
from app.services.mcp_idempotency import reserve


def request(body, key='fixture', origin=None):
    async def receive(): return {'type': 'http.request', 'body': json.dumps(body).encode(), 'more_body': False}
    headers = [(b'x-mcp-api-key', key.encode()), (b'content-type', b'application/json')]
    if origin: headers.append((b'origin', origin.encode()))
    return Request({'type': 'http', 'method': 'POST', 'path': '/mcp', 'headers': headers, 'state': {'correlation_id': 'synthetic-mcp'}, 'client': ('127.0.0.1', 0), 'scheme': 'http', 'server': ('localhost', 0), 'query_string': b''}, receive)


def test_every_schema_is_valid_and_has_annotations(monkeypatch):
    monkeypatch.delenv('TRESEKO_MCP_TOOLS', raising=False)
    tools = gov.public_tools()
    assert len(tools) == 56
    for tool in tools:
        Draft7Validator.check_schema(tool['inputSchema'])
        # Every advertised required argument is rejected if omitted.
        if tool['inputSchema'].get('required'):
            assert not Draft7Validator(tool['inputSchema']).is_valid({})
        assert tool['annotations']['readOnlyHint'] == tool['read_only']
        if tool['operation'] == 'commit':
            assert tool['inputSchema']['properties']['confirmation']['const']
            assert 'idempotency_key' in tool['inputSchema']['required']
        assert callable(gov.HANDLERS[tool['handler_key']])


def test_redaction_preserves_payload_and_embedded_json():
    original = {'token_count': 100, 'items': list(range(101)), 'body': json.dumps({'api_key': 'synthetic-secret', 'text': 'Bearer hidden', 'steps': ['x' * 20000]})}
    result = redact(original)
    assert result['token_count'] == 100 and len(result['items']) == 101
    assert len(json.loads(result['body'])['steps'][0]) == 20000
    assert 'synthetic-secret' not in str(result) and 'Bearer hidden' not in str(result)
    assert original['body'] != result['body']


@pytest.mark.asyncio
async def test_activation_refreshes_and_recovers(monkeypatch):
    class DB:
        enabled = False
        broken = False
        async def get(self, *_):
            if self.broken: raise RuntimeError('synthetic outage')
            return SimpleNamespace(value={'enabled': self.enabled})
        async def __aenter__(self): return self
        async def __aexit__(self, *_): return False
    db = DB()
    monkeypatch.setattr(router, 'AsyncSessionLocal', lambda: db)
    gov.set_configured_mcp_enabled(True)
    await router._ensure_persisted_mcp_activation()
    assert gov.configured_mcp_enabled() is False
    db.broken = True
    await router._ensure_persisted_mcp_activation()
    assert gov.configured_mcp_enabled() is False
    db.broken, db.enabled = False, True
    await router._ensure_persisted_mcp_activation()
    assert gov.configured_mcp_enabled() is True


@pytest.mark.asyncio
async def test_postgres_workspace_and_atomic_receipts(monkeypatch):
    if engine.url.database != 'treseko_tests' or engine.url.host not in {'127.0.0.1', 'localhost'}:
        pytest.skip('requires isolated local treseko_tests PostgreSQL')
    monkeypatch.setenv('TRESEKO_MCP_DEPLOYMENT_TOPOLOGY', 'single_process')
    monkeypatch.delenv('TRESEKO_MCP_TOOLS', raising=False)
    monkeypatch.setattr(router, 'rate_limiter', gov.McpRateLimiter(limit=1000))
    async with AsyncSessionLocal() as db:
        user = models.Usuario(email=f'mcp-{uuid4()}@example.test', rol=models.Rol.ADMIN, activo=True)
        org = models.Organizacion(nombre=f'MCP isolated {uuid4()}')
        db.add_all([user, org]); await db.flush()
        project = models.Proyecto(nombre='MCP matrix', organizacion_id=org.id)
        db.add(project); await db.flush()
        component = models.Componente(nombre='Web', proyecto_id=project.id)
        build = models.Build(nombre='Fixture', proyecto_id=project.id, estado='ACTIVA', activo=True)
        env = models.Entorno(nombre='QA', proyecto_id=project.id, url='https://api.example.test')
        db.add_all([component, build, env]); await db.flush()
        dataset = models.EntornoDataset(nombre='QA', entorno_id=env.id, variables={'token_count': 42, 'password': 'hidden'})
        case = models.CasoPrueba(master_id=uuid4(), proyecto_id=project.id, titulo='Fixture', prioridad=models.Prioridad.MEDIA, tipo_prueba=models.TipoPrueba.MANUAL, formato_prueba=models.FormatoPrueba.CLASICA, creado_por=user.id)
        db.add_all([dataset, case]); await db.flush()
        db.add(models.BuildCaso(build_id=build.id, caso_id=case.id))
        setting = await db.get(models.AppSetting, 'mcp.enabled')
        if setting: setting.value = {'enabled': True}
        else: db.add(models.AppSetting(key='mcp.enabled', value={'enabled': True}))
        await db.commit()
        _, key = await crud.create_mcp_api_key(db, user.id, schemas.McpApiKeyCreate(nombre='Synthetic matrix', scopes=list(gov.SCOPE_TO_TOOLS)))
        pid, oid, cid, bid, uid = str(project.id), str(org.id), str(case.id), str(build.id), user.id
    invoked = set()
    async def call(name, args):
        response = await router.mcp_json_rpc(request({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': name, 'arguments': args}}, key))
        assert 'error' not in response, (name, response)
        assert response['result'].get('isError') is not True
        invoked.add(name)
        return json.loads(response['result']['content'][0]['text'])
    async def mutate(name, args):
        return await call(name, {**args, 'confirmation': gov.TOOL_CATALOG[name].input_schema['properties']['confirmation']['const'], 'idempotency_key': str(uuid4())})
    for name in ('project.get', 'builds.list', 'cases.list', 'test-runs.list', 'bugs.list', 'environments.list', 'quality.trends', 'projects.get', 'components.list'):
        await call('treseko.' + name, {'project_id': pid})
    await call('treseko.organizations.list', {})
    await call('treseko.projects.list', {'organization_id': oid})
    for name in ('cases.get', 'cases.versions.list'): await call('treseko.' + name, {'project_id': pid, 'case_id': cid})
    await call('treseko.quality.summary', {'project_id': pid, 'build_id': bid})
    await call('treseko.quality.compare', {'project_id': pid, 'baseline_build_id': bid, 'candidate_build_id': bid})
    await call('treseko.environments.get', {'project_id': pid, 'environment_id': str(env.id)})
    await call('treseko.datasets.list', {'project_id': pid, 'environment_id': str(env.id)})
    data = await call('treseko.datasets.get', {'project_id': pid, 'dataset_id': str(dataset.id)})
    assert data['variables']['token_count'] == 42 and data['variables']['password'] == '[REDACTED]'
    req = await mutate('treseko.requirements.create', {'project_id': pid, 'data': {'titulo': 'Checkout', 'componente_ids': [str(component.id)]}})
    story = await mutate('treseko.stories.create', {'project_id': pid, 'data': {'titulo': 'Comprar', 'requisito_id': req['id'], 'descripcion_markdown': 'Como cliente quiero comprar para recibir mi producto'}})
    page = await mutate('treseko.wiki.create', {'project_id': pid, 'data': {'titulo': 'Proyecto', 'contenido': 'x' * 30000}})
    for family, identifier, original in [('requirements', 'requirement_id', req), ('stories', 'story_id', story), ('wiki', 'page_id', page)]:
        await call(f'treseko.{family}.list', {'project_id': pid})
        current = await call(f'treseko.{family}.get', {'project_id': pid, identifier: original['id']})
        if family == 'wiki':
            assert current['next_content_offset'] == 16000
            rest = await call('treseko.wiki.get', {'project_id': pid, identifier: original['id'], 'content_offset': 16000})
            assert len(current['contenido'] + rest['contenido']) == 30000
        updated = await mutate(f'treseko.{family}.update', {'project_id': pid, identifier: original['id'], 'expected_revision': current['revision'], 'data': {'titulo': 'Actualizado'}})
        assert updated['titulo'] == 'Actualizado'
        await call(f'treseko.{family}.history', {'project_id': pid, identifier: original['id'], 'limit': 1})
        conflict = await router.mcp_json_rpc(request({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': f'treseko.{family}.update', 'arguments': {'project_id': pid, identifier: original['id'], 'expected_revision': current['revision'], 'data': {'titulo': 'Obsoleto'}, 'confirmation': gov.TOOL_CATALOG[f'treseko.{family}.update'].input_schema['properties']['confirmation']['const'], 'idempotency_key': str(uuid4())}}}, key))
        assert conflict['error']['data']['code'] == 'REVISION_CONFLICT'
    replay_key = str(uuid4())
    replay_args = {'project_id': pid, 'data': {'titulo': 'Idempotent story', 'requisito_id': req['id']}, 'confirmation': gov.TOOL_CATALOG['treseko.stories.create'].input_schema['properties']['confirmation']['const'], 'idempotency_key': replay_key}
    first = await call('treseko.stories.create', replay_args)
    replay = await call('treseko.stories.create', replay_args)
    assert replay == first
    collision = await router.mcp_json_rpc(request({'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {'name': 'treseko.stories.create', 'arguments': {**replay_args, 'data': {'titulo': 'Conflicting replay', 'requisito_id': req['id']}}}}, key))
    assert 'error' in collision
    before = await call('treseko.projects.get', {'project_id': pid})
    updated = await mutate('treseko.projects.update', {'project_id': pid, 'expected_revision': before['revision'], 'data': {'descripcion': 'Actualizado'}})
    assert updated['descripcion'] == 'Actualizado'
    async with AsyncSessionLocal() as db:
        with pytest.raises(ValueError): await mcp_mutations.archive_case(db, SimpleNamespace(id=uid), SimpleNamespace(id=UUID(pid)), {'case_id': cid, 'confirmation': 'ARCHIVE_CASE'})
        await db.rollback()
    receipt_key = str(uuid4())
    with pytest.raises(RuntimeError):
        async with mutation_session(AsyncSessionLocal) as db:
            await reserve(db, UUID(pid), receipt_key, 'f' * 64)
            item = await db.get(models.Proyecto, UUID(pid)); item.descripcion = 'must roll back'
            await db.commit()
            raise RuntimeError('synthetic crash after domain commit')
    async with AsyncSessionLocal() as db:
        assert (await db.get(models.Proyecto, UUID(pid))).descripcion == 'Actualizado'
        assert await db.scalar(select(models.McpImportIdempotency).where(models.McpImportIdempotency.idempotency_key == receipt_key)) is None
    from mcp_test_scenarios import exercise_remaining
    await exercise_remaining(monkeypatch, call, mutate, pid, oid, str(component.id), bid, str(env.id), uid)
    assert invoked == set(gov.TOOL_CATALOG), set(gov.TOOL_CATALOG) - invoked

    from mcp_sdk_scenario import exercise_sdk
    await exercise_sdk(key, pid)
