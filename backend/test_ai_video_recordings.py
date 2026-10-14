from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4
import pytest
from fastapi import HTTPException
from starlette.requests import Request
from app.main import app as _app
from app.api.routers import ai_video_recordings as routes
from app.services.ai_video_recordings import register_recording
from app.services.ai_report_sanitizer import sanitize_ai_report_payload
from app.time_utils import utc_now


def test_recording_reference_survives_sanitizer_without_exposing_raw_media():
    value = {'recording_ref': {'id': str(uuid4()), 'url': '/ai-videos/id/', 'size_bytes': 20}, 'video_base64': 'private-media'}
    sanitized = sanitize_ai_report_payload(value)
    assert sanitized['recording_ref'] == value['recording_ref']
    assert sanitized['video_base64'] != 'private-media'
    value['large_trace'] = {str(index): 'x' * 2000 for index in range(100)}
    assert sanitize_ai_report_payload(value)['recording_ref'] == value['recording_ref']


async def test_project_access_checked_before_proxying_video(monkeypatch):
    class Db:
        async def get(self, *args): return SimpleNamespace(proyecto_id=uuid4(), expires_at=None)
    async def denied(*args): raise HTTPException(403, 'denied')
    monkeypatch.setattr(routes.access_control, 'require_project_access', denied)
    request = Request({'type': 'http', 'headers': []})
    with pytest.raises(HTTPException) as error:
        await routes.read_video(uuid4(), request, db=Db(), user=object())
    assert error.value.status_code == 403


async def test_expired_video_returns_gone_without_contacting_engine(monkeypatch):
    class Db:
        async def get(self, *args): return SimpleNamespace(proyecto_id=uuid4(), expires_at=utc_now() - timedelta(seconds=1))
    async def allowed(*args): pass
    monkeypatch.setattr(routes.access_control, 'require_project_access', allowed)
    with pytest.raises(HTTPException) as error:
        await routes.read_video(uuid4(), Request({'type': 'http', 'headers': []}), db=Db(), user=object())
    assert error.value.status_code == 410


@pytest.mark.parametrize('reference', [
    {'id': '../outside', 'size_bytes': 20},
    {'id': str(uuid4()), 'size_bytes': 0},
    {'id': str(uuid4()), 'size_bytes': 129 * 1024 * 1024},
    {'id': str(uuid4()), 'size_bytes': 20, 'expires_at': '2020-01-01T00:00:00Z'},
])
async def test_rejects_invalid_temporary_recording_metadata(reference):
    report = {'recording_ref': reference}
    assert await register_recording(None, report, uuid4(), temporary=True) is None
    assert 'recording_ref' not in report

async def test_regular_video_cannot_be_deleted(monkeypatch):
    class Db:
        async def get(self,*args): return SimpleNamespace(proyecto_id=uuid4(), expires_at=None)
    async def allowed(*args): pass
    monkeypatch.setattr(routes.access_control,'require_project_access',allowed)
    with pytest.raises(HTTPException) as error:
        await routes.delete_video(uuid4(),db=Db(),user=object())
    assert error.value.status_code==409

async def test_delete_requires_project_edit_access(monkeypatch):
    class Db:
        async def get(self,*args): return SimpleNamespace(proyecto_id=uuid4(),expires_at=utc_now()+timedelta(hours=24))
    async def denied(db,user,project,action):
        assert action=='edit'
        raise HTTPException(403,'denied')
    monkeypatch.setattr(routes.access_control,'require_project_access',denied)
    with pytest.raises(HTTPException) as error:
        await routes.delete_video(uuid4(),db=Db(),user=object())
    assert error.value.status_code==403

@pytest.mark.parametrize('engine_status', [204, 503])
async def test_delete_commits_metadata_only_after_file_removal(monkeypatch,engine_status):
    import httpx
    row=SimpleNamespace(proyecto_id=uuid4(),expires_at=utc_now()+timedelta(hours=24))
    class Db:
        deleted=False
        committed=False
        async def get(self,*args): return row
        async def delete(self,value): self.deleted=True
        async def commit(self): self.committed=True
    db=Db()
    async def allowed(*args): pass
    monkeypatch.setattr(routes.access_control,'require_project_access',allowed)
    original=httpx.AsyncClient
    def response(request):
        assert request.method=='DELETE'
        return httpx.Response(engine_status)
    monkeypatch.setattr(routes.httpx,'AsyncClient',lambda **kwargs: original(transport=httpx.MockTransport(response),**kwargs))
    if engine_status==503:
        with pytest.raises(HTTPException): await routes.delete_video(uuid4(),db=db,user=object())
        assert not db.deleted and not db.committed
    else:
        await routes.delete_video(uuid4(),db=db,user=object())
        assert db.deleted and db.committed
