import hashlib
import json
from uuid import uuid4
import pytest
from app.main import app
from app.services.worker_result_uploads import ResultUploadStore

def test_chunked_result_resume_and_checksum_preserve_complete_data(tmp_path):
    store=ResultUploadStore(tmp_path)
    job,event=uuid4(),uuid4()
    content=json.dumps({'logs':'password=synthetic\n'+'x'*20000,'artifacts':list(range(25))}).encode()
    manifest=store.begin(job,event,len(content),hashlib.sha256(content).hexdigest())
    assert manifest['offset']==0
    store.append(job,event,0,content[:1000])
    assert ResultUploadStore(tmp_path).begin(job,event,len(content),hashlib.sha256(content).hexdigest())['offset']==1000
    store.append(job,event,1000,content[1000:])
    assert store.read_complete(job,event)==content
    with pytest.raises(ValueError):store.append(job,event,1000,b'replaced')

def test_upload_does_not_ack_partial_or_different_evidence(tmp_path):
    store=ResultUploadStore(tmp_path);job,event=uuid4(),uuid4()
    store.begin(job,event,100,'a'*64)
    with pytest.raises(ValueError):store.read_complete(job,event)
    with pytest.raises(ValueError):store.begin(job,event,100,'b'*64)

def test_insufficient_disk_space_never_acknowledges_or_truncates_evidence(tmp_path,monkeypatch):
    from app.services import worker_result_uploads as module
    from types import SimpleNamespace
    monkeypatch.setattr(module.shutil,'disk_usage',lambda path:SimpleNamespace(free=1))
    store=module.ResultUploadStore(tmp_path)
    with pytest.raises(OSError):store.begin(uuid4(),uuid4(),100,'a'*64)
