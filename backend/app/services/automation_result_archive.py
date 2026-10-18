"""Authenticated review copy, including results rejected by a changed build."""
from uuid import UUID, uuid5, NAMESPACE_URL
from starlette.concurrency import run_in_threadpool
from .worker_result_uploads import ResultUploadStore
from .worker_result_storage import result_upload_root


def evidence_identifier(job_id, event_id):
    try:return UUID(str(event_id))
    except ValueError:return uuid5(NAMESPACE_URL,f'treseko-result:{job_id}:{event_id}')


async def archive_worker_result(job_id, payload):
    store=ResultUploadStore(result_upload_root())
    event=evidence_identifier(job_id,payload.result_event_id)
    data,manifest=store.paths(job_id,event)
    file=data.with_suffix('.evidence.json')
    # Chunk uploads retain the original JSON before entering the result route.
    # The result fingerprint still validates retries in the repository.
    if not (manifest.exists() and file.is_file() and not file.is_symlink()):
        value=payload.model_dump(mode='json',exclude={'lease_token'})
        await run_in_threadpool(store.save_evidence,job_id,event,value)
    return f'/automation-jobs/{job_id}/complete-evidence/{event}'
