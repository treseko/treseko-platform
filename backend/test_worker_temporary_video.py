from uuid import uuid4
from types import SimpleNamespace
import pytest
from app.services import ai_video_recordings as service
from app.api.routers import ai_video_recordings as routes
from starlette.requests import Request

async def test_complete_large_temporary_video_is_private_and_deletable(tmp_path, monkeypatch):
    monkeypatch.setenv('AUTOMATION_RESULT_UPLOAD_DIR', str(tmp_path))
    rows = {}
    class Db:
        async def get(self, model, identifier): return rows.get(identifier)
        def add(self, row): rows[row.id] = row
        async def execute(self, statement): pass
        async def flush(self): pass
        async def delete(self, row): del rows[row.id]
        async def commit(self): pass
    db = Db()
    async def allowed(*args): pass
    monkeypatch.setattr(routes.access_control, 'require_project_access', allowed)
    content = b'\x1a\x45\xdf\xa3' + b'original-password' * 800000
    item = await service.import_worker_temporary_video(db, content, uuid4())
    from uuid import UUID
    identifier = UUID(item['recording_ref']['id'])
    file = service.worker_video_path(identifier)
    assert file.read_bytes() == content
    assert file.stat().st_mode & 0o777 == 0o600
    response = await routes.read_video(identifier, Request({'type':'http','headers':[]}), page=0, db=db, user=object())
    assert str(response.path) == str(file)
    assert response.headers['cache-control'] == 'private, no-store'
    await routes.delete_video(identifier, db=db, user=object())
    assert not file.exists() and not rows

async def test_expired_temporary_files_are_removed_without_removing_current_videos(tmp_path, monkeypatch):
    from datetime import timedelta
    from app.time_utils import utc_now
    monkeypatch.setenv('AUTOMATION_RESULT_UPLOAD_DIR', str(tmp_path))
    expired=SimpleNamespace(id=uuid4(),expires_at=utc_now()-timedelta(seconds=1))
    active=SimpleNamespace(id=uuid4(),expires_at=utc_now()+timedelta(hours=1))
    for row in (expired,active):
        path=service.worker_video_path(row.id)
        path.parent.mkdir(parents=True,exist_ok=True)
        path.write_bytes(b'complete')
    class Result:
        def scalars(self): return self
        def all(self): return [expired]
    class Db:
        removed=[]
        async def execute(self, stmt): return Result()
        async def delete(self,row): self.removed.append(row)
    db=Db()
    await service.cleanup_expired_worker_videos(db)
    assert not service.worker_video_path(expired.id).exists()
    assert service.worker_video_path(active.id).read_bytes()==b'complete'
    assert db.removed==[expired]
