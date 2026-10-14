"""Worker-only bounded transport for full automation evidence."""
import json
import os
from pathlib import Path
from uuid import UUID
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from ... import models, schemas, auth
from ...database import get_db
from ...services.worker_result_uploads import ResultUploadStore
from .automation import get_current_automation_runner, report_automation_job_result
from .automation_helpers import _require_automation_job_access

router=APIRouter(tags=['Worker result evidence'])


def store():
    return ResultUploadStore(os.getenv('AUTOMATION_RESULT_UPLOAD_DIR', str(Path(__file__).resolve().parents[3]/'.treseko'/'worker-results')))


class UploadStart(BaseModel):
    total_bytes:int=Field(ge=1)
    sha256:str=Field(pattern='^[a-f0-9]{64}$')


async def owner(db,runner,job_id,event_id,lease):
    job=await db.get(models.AutomationJob,job_id,with_for_update=True)
    if not job:raise HTTPException(404,'Job no encontrado')
    if job.runner_id!=runner.id or job.organizacion_id!=runner.organizacion_id:raise HTTPException(403,'El worker no es propietario de este resultado')
    completed=job.result_event_id==str(event_id) and job.estado not in {models.AutomationJobStatus.CLAIMED,models.AutomationJobStatus.RUNNING,models.AutomationJobStatus.PENDING}
    if not completed and (not lease or lease!=job.lease_token):raise HTTPException(409,'El lease del resultado fue reemplazado')
    return job,completed


@router.post('/automation-jobs/{job_id}/result-uploads/{event_id}')
async def begin_upload(job_id:UUID,event_id:UUID,payload:UploadStart,lease:str=Header(alias='X-Lease-Token'),db=Depends(get_db),runner=Depends(get_current_automation_runner)):
    job,completed=await owner(db,runner,job_id,event_id,lease)
    upload_store=store()
    if completed:
        _,manifest=upload_store.paths(job_id,event_id)
        if not manifest.is_file():
            raise HTTPException(409,'No existe una transferencia confirmada para este evento')
    try:state=await run_in_threadpool(upload_store.begin,job_id,event_id,payload.total_bytes,payload.sha256)
    except ValueError as exc:raise HTTPException(409,str(exc)) from exc
    if completed:state.update(confirmed=True,result=schemas.AutomationJob.model_validate(job).model_dump(mode='json'))
    await db.commit()
    return state


@router.put('/automation-jobs/{job_id}/result-uploads/{event_id}/{offset}')
async def upload_chunk(job_id:UUID,event_id:UUID,offset:int,request:Request,lease:str=Header(alias='X-Lease-Token'),db=Depends(get_db),runner=Depends(get_current_automation_runner)):
    await owner(db,runner,job_id,event_id,lease)
    chunks=[];length=0
    async for chunk in request.stream():
        length+=len(chunk)
        if length>1024*1024:raise HTTPException(413,'El fragmento supera 1 MiB')
        chunks.append(chunk)
    try:state=await run_in_threadpool(store().append,job_id,event_id,offset,b''.join(chunks))
    except (ValueError,FileNotFoundError) as exc:raise HTTPException(409,str(exc)) from exc
    await db.commit()
    return state


@router.post('/automation-jobs/{job_id}/result-uploads/{event_id}/complete')
async def complete_upload(job_id:UUID,event_id:UUID,lease:str=Header(alias='X-Lease-Token'),db=Depends(get_db),runner=Depends(get_current_automation_runner)):
    job,completed=await owner(db,runner,job_id,event_id,lease)
    try:
        raw=await run_in_threadpool(store().read_complete,job_id,event_id)
        data=json.loads(raw)
        if data.get('result_event_id')!=str(event_id) or data.get('lease_token')!=lease:raise ValueError('El resultado no corresponde al evento y lease de la transferencia')
        payload=schemas.AutomationJobResult.model_validate(data)
    except (ValueError,FileNotFoundError) as exc:raise HTTPException(422,'El resultado completo no es válido o está incompleto') from exc
    # Keep exact business evidence for authorized review, excluding the
    # transport lease credential which is not test data.
    data.pop('lease_token',None)
    data_path,_=store().paths(job_id,event_id)
    evidence_path=data_path.with_suffix('.evidence.json')
    with evidence_path.open('w') as output:
        os.chmod(evidence_path,0o600);json.dump(data,output,ensure_ascii=False);output.flush();os.fsync(output.fileno())
    result = await report_automation_job_result(job_id,payload,db,runner)
    job.metadata_resultado = {**(job.metadata_resultado or {}),
        'complete_evidence_url': f'/automation-jobs/{job_id}/complete-evidence/{event_id}'}
    await db.commit()
    await db.refresh(job)
    return schemas.AutomationJob.model_validate(job)


@router.get('/automation-jobs/{job_id}/complete-evidence/{event_id}')
async def download_evidence(job_id:UUID,event_id:UUID,db=Depends(get_db),user=Depends(auth.check_capability('automatizacion.jobs','read'))):
    job=await db.get(models.AutomationJob,job_id)
    if not job:raise HTTPException(404,'Job no encontrado')
    await _require_automation_job_access(db,user,job)
    data_path,_=store().paths(job_id,event_id)
    evidence=data_path.with_suffix('.evidence.json')
    if not evidence.is_file() or evidence.is_symlink():raise HTTPException(404,'Evidencia no disponible')
    return FileResponse(evidence,headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'},media_type='application/json',filename=f'automation-{job_id}-{event_id}.json')
