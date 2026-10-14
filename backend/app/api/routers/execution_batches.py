"""Create and enqueue a complete execution selection in one transaction."""
from typing import Literal
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from sqlalchemy import select, text
from ... import models, schemas, auth, access_control
from ...database import get_db
from ...repositories.test_run_creation import create_test_run
from ...repositories.automation_jobs import create_automation_job_for_execution
from ...services.ai_execution_queue import enqueue_ai_execution
from ...services.ai_scheduled_missions import validate_mission
from ...services.edition.usage_limits import enforce_weekly_ai_execution_limit, enforce_weekly_automated_execution_limit
from ...services.update_ai_queue_control import AI_QUEUE_LOCK

router = APIRouter(tags=['Execution batches'])


class ExecutionBatchRequest(schemas.TestRunCreate):
    origen: Literal['IA', 'AUTOMATIZADA_WORKER']
    caso_ids: list[UUID] = Field(min_length=1, max_length=500)
    record_video: bool = True


@router.post('/execution-batches/', status_code=201)
async def create_execution_batch(payload: ExecutionBatchRequest, db=Depends(get_db), user=Depends(auth.check_capability('ejecutar.automatizada', 'edit'))):
    if not auth.has_module_permission(user, 'automatizacion', 'read') or not auth.has_capability_permission(user, 'ejecutar.manual', 'edit'):
        raise HTTPException(403, 'Necesitas permisos para crear y ejecutar el lote')
    await access_control.require_project_access(db, user, payload.proyecto_id, 'edit')
    try:
        if db.bind.dialect.name == 'postgresql':
            await db.execute(text(f'SELECT pg_advisory_xact_lock({AI_QUEUE_LOCK})'))
        cases = (await db.execute(select(models.CasoPrueba).where(models.CasoPrueba.id.in_(payload.caso_ids)))).scalars().all()
        build = await db.get(models.Build, payload.build_id) if payload.build_id else None
        if not build or not access_control.is_build_active(build) or build.proyecto_id != payload.proyecto_id:
            raise ValueError('El lote requiere una build activa del proyecto')
        if len(cases) != len(set(payload.caso_ids)) or any(not case.activo or case.proyecto_id != payload.proyecto_id or case.componente_id != build.componente_id or case.estado_caso == models.EstadoCaso.ARCHIVADO for case in cases):
            raise ValueError('Los casos no están disponibles en esta build')
        formats = {case.formato_prueba for case in cases}
        if formats & {models.FormatoPrueba.API, models.FormatoPrueba.PERFORMANCE}:
            raise ValueError('Este lote solo admite pruebas clásicas o conversacionales')
        chatbot = formats == {models.FormatoPrueba.CONVERSACIONAL}
        if models.FormatoPrueba.CONVERSACIONAL in formats and not chatbot:
            raise ValueError('No mezcles casos conversacionales con otros formatos')
        ai_mode = payload.origen == 'IA'
        if not ai_mode and any(case.tipo_prueba != models.TipoPrueba.AUTOMATIZADA for case in cases):
            raise ValueError('La ejecución automatizada requiere casos de tipo AUTOMATIZADA')
        project = await db.get(models.Proyecto, payload.proyecto_id)
        if ai_mode:
            await validate_mission(db, user, payload.proyecto_id, payload.build_id, list(set(payload.caso_ids)))
            await enforce_weekly_ai_execution_limit(db, solution_id=project.organizacion_id, increment=len(cases))
        else:
            await enforce_weekly_automated_execution_limit(db, solution_id=project.organizacion_id, increment=len(cases))
        run = await create_test_run(db, schemas.TestRunCreate(**payload.model_dump(exclude={'record_video'})), user.id, commit=False)
        rows = (await db.execute(select(models.EjecucionCaso, models.CasoPrueba).join(models.CasoPrueba, models.CasoPrueba.id == models.EjecucionCaso.caso_id).where(models.EjecucionCaso.test_run_id == run.id))).all()
        jobs = []
        for execution, case in rows:
            if ai_mode or chatbot:
                mode = models.ExecutionMode.IA if ai_mode else models.ExecutionMode.AUTOMATIZADA
                job = await enqueue_ai_execution(db, execution, user.id, mode)
                job.payload_congelado = {**job.payload_congelado, 'record_video': payload.record_video, 'server_batch': True}
                execution.execution_mode = mode
            else:
                job = await create_automation_job_for_execution(db, execution.id, user.id, record_video=payload.record_video, commit=False, quota_checked=True)
            jobs.append({'executionId': str(execution.id), 'caseId': str(case.id), 'jobId': str(job.id), 'status': getattr(getattr(job, 'estado', None), 'value', 'PENDING'), 'error': getattr(job, 'error_message', None)})
        await db.commit()
        return {'id': run.id, 'nombre': run.nombre, 'proyecto_id': run.proyecto_id, 'build_id': run.build_id, 'jobs': jobs, 'status': 'QUEUED'}
    except (ValueError, HTTPException) as exc:
        await db.rollback()
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(409, str(exc)) from exc
    except Exception:
        await db.rollback()
        raise
