"""Provider health capabilities must come from measured Engine output."""
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4
import httpx
import pytest
from app import crud  # Initialize the repository facade in the production import order.
from app.repositories import ai_provider_profiles as profiles

@pytest.mark.parametrize('reported,expected', [(True, True), (False, False), (None, False), ('true', False)])
@pytest.mark.asyncio
async def test_profile_preserves_measured_json_capability(monkeypatch, reported, expected):
    row = SimpleNamespace(id=uuid4(), name='probe', provider='openai-compatible', adapter='openai-compatible', endpoint='http://127.0.0.1:1235/v1', model='probe', credential_id=None, capabilities_json={'structured_json': True}, capability_status='unknown', enabled=True, request_timeout_seconds=30, max_retries=0, max_input_tokens=4096, max_output_tokens=512, created_at=datetime.now(timezone.utc), updated_at=None)
    async def get_profile(*_args): return row
    async def resolve(*_args): return {'provider': row.provider, 'endpoint': row.endpoint, 'model': row.model, 'api_key': None, 'max_retries': 0}
    class Database:
        async def commit(self): pass
        async def refresh(self, _row): pass
    class Client:
        def __init__(self, **_kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *_args): pass
        async def post(self, *_args, **_kwargs):
            return httpx.Response(200, json={'capabilities': {'structured_json': reported, 'vision': False, 'vision_status': 'unknown'}})
    monkeypatch.setattr(profiles, 'get_ai_provider_profile', get_profile)
    monkeypatch.setattr(profiles, 'resolved_ai_provider_profile', resolve)
    monkeypatch.setattr(profiles, 'engine_internal_headers', lambda *_: {'X-Engine-Internal-Token':'controlled'})
    monkeypatch.setattr(profiles.httpx, 'AsyncClient', Client)
    result = await profiles.test_ai_provider_profile(Database(), row.id)
    assert result['profile']['capabilities_json']['structured_json'] is expected

@pytest.mark.parametrize('explicit', [False, True])
@pytest.mark.asyncio
async def test_workflow_uses_active_profile_limits_unless_explicitly_bound(monkeypatch, explicit):
    active_id, explicit_id = uuid4(), uuid4()
    seen = []
    async def resolve(_db, profile_id):
        seen.append(profile_id)
        return {'id': profile_id, 'provider': 'openai-compatible', 'endpoint': 'http://127.0.0.1:1235/v1', 'model': 'local', 'api_key': None, 'max_retries': 0, 'request_timeout_seconds': 900}
    monkeypatch.setattr(profiles, 'resolved_ai_provider_profile', resolve)
    workflow = SimpleNamespace(provider_profile_id=explicit_id if explicit else None, fallback_profile_ids=[])
    result = await profiles.workflow_provider_payload(None, workflow, {'active_provider_profile_id': str(active_id), 'model': 'legacy'})
    assert seen == [explicit_id if explicit else active_id]
    assert result['provider_max_retries'] == 0
    assert result['provider_request_timeout_seconds'] == 900
    assert result['model'] == 'local'

@pytest.mark.asyncio
async def test_workflow_without_profile_preserves_legacy_configuration(monkeypatch):
    monkeypatch.setattr(profiles, 'get_configured_ai_provider_api_key', lambda *_: None)
    result = await profiles.workflow_provider_payload(None, SimpleNamespace(provider_profile_id=None), {'provider': 'ollama', 'llm_endpoint': 'http://127.0.0.1:11434/v1', 'model': 'legacy'})
    assert result['model'] == 'legacy'
    assert 'provider_max_retries' not in result
