"""The generation transport must honor the persisted UI/API wait budget."""
import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app.api.routers import traceability  # initialize the public application facade before repositories
from app.repositories import case_generation, story_generation_helpers


@pytest.mark.parametrize('module', [story_generation_helpers, case_generation])
@pytest.mark.parametrize('configured,expected', [(30,30),(900,900),(3600,3600),(7200,7200),(9000,7200)])
def test_authoring_transport_preserves_configured_budget(monkeypatch,module,configured,expected):
    captured = {}

    async def config(_db):
        return {'timeout_seconds':configured,'context_window_tokens':8192,'max_completion_tokens':1024}

    async def provider(_db,_workflow,_config):
        return {'provider':'openai-compatible','llm_endpoint':'http://127.0.0.1:1235/v1','model':'controlled',
                'provider_request_timeout_seconds':900,'provider_max_retries':0}

    class Client:
        def __init__(self, **kwargs):
            captured.update(kwargs)
        async def __aenter__(self):
            return self
        async def __aexit__(self, *_args):
            return False
        async def post(self, _url, *, json, headers):
            captured['payload'] = json
            return httpx.Response(200,json={'analysis':{},'propuestas':[]})

    monkeypatch.setattr(module,'get_ai_engine_config',config)
    monkeypatch.setattr(module,'workflow_provider_payload',provider)
    monkeypatch.setattr(module,'_workflow_definition',lambda _workflow: {})
    monkeypatch.setattr(module.httpx,'AsyncClient',Client)
    asyncio.run(module._call_engine(None,SimpleNamespace(),'generate',{},'Keep all sources.'))
    assert captured['timeout'] == expected
    assert captured['payload']['provider_request_timeout_seconds'] == 900
    assert captured['payload']['provider_max_retries'] == 0


@pytest.mark.parametrize('error', [httpx.ReadTimeout(''),httpx.ConnectTimeout('')])
def test_authoring_timeout_has_an_actionable_error(error):
    message = story_generation_helpers._safe_error(error)
    assert 'tiempo de espera configurado' in message


def test_empty_authoring_error_keeps_a_visible_diagnostic():
    assert story_generation_helpers._safe_error(ValueError('')).strip()
    assert story_generation_helpers._safe_error(ValueError('Existing\nreason')) == 'Existing reason'
    assert len(story_generation_helpers._safe_error(ValueError('x'*600))) == 500
