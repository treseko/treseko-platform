from datetime import datetime, timezone
from uuid import UUID
from pydantic import BaseModel, Field, field_validator
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from ... import models, auth, access_control
from ...database import get_db
from ...time_utils import utc_now
from ...services.ai_scheduled_missions import validate_mission
from ...services.ai_scheduled_missions import launch_mission
from types import SimpleNamespace
from ...services.update_ai_queue_control import AI_QUEUE_LOCK
from sqlalchemy import text

router = APIRouter(tags=['AI schedules'])


class AiMissionBase(BaseModel):
    proyecto_id: UUID
    build_id: UUID
    record_video: bool = True
    nombre: str = Field(min_length=1, max_length=200)
    caso_ids: list[UUID] = Field(min_length=1, max_length=500)

    @field_validator('nombre', mode='before')
    @classmethod
    def trim_name(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator('caso_ids')
    @classmethod
    def unique_cases(cls, value):
        return list(dict.fromkeys(value))


class AiMissionRequest(AiMissionBase):
    scheduled_at: datetime

    @field_validator('scheduled_at')
    @classmethod
    def future_date(cls, value):
        if value.tzinfo is None or value.utcoffset() is None or value <= utc_now():
            raise ValueError('La fecha debe ser futura e incluir zona horaria')
        return value.astimezone(timezone.utc)


@router.post('/ai-missions/', status_code=201)
async def create_immediate_mission(payload: AiMissionBase, db=Depends(get_db), user=Depends(auth.check_capability('ejecutar.automatizada', 'edit'))):
    if db.bind.dialect.name == 'postgresql':
        await db.execute(text(f'SELECT pg_advisory_xact_lock({AI_QUEUE_LOCK})'))
    mission = SimpleNamespace(**payload.model_dump(exclude={'caso_ids'}), caso_ids=[str(value) for value in payload.caso_ids], creado_por=user.id)
    try:
        await launch_mission(db, mission)
        await db.commit()
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(409, str(exc))
    return {'id': mission.test_run_id, 'nombre': mission.nombre, 'status': 'QUEUED'}


def public_mission(row):
    return {key: getattr(row, key) for key in ('id', 'proyecto_id', 'build_id', 'nombre', 'caso_ids', 'record_video', 'scheduled_at', 'created_at', 'estado', 'test_run_id', 'error_message')}


@router.post('/ai-schedules/', status_code=201)
async def create_mission(payload: AiMissionRequest, db=Depends(get_db), user=Depends(auth.check_capability('ejecutar.automatizada', 'edit'))):
    await validate_mission(db, user, payload.proyecto_id, payload.build_id, payload.caso_ids, require_scheduling=True, lock_build=True)
    row = models.AiScheduledMission(**payload.model_dump(exclude={'caso_ids'}), caso_ids=[str(value) for value in payload.caso_ids], creado_por=user.id)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return public_mission(row)


@router.get('/proyectos/{project_id}/ai-schedules/')
async def list_missions(project_id: UUID, limit: int = Query(100, ge=1, le=500), db=Depends(get_db), user=Depends(auth.check_capability('ejecutar.ver', 'read'))):
    await access_control.require_project_access(db, user, project_id, 'read')
    rows = (await db.execute(select(models.AiScheduledMission).where(models.AiScheduledMission.proyecto_id == project_id).order_by(models.AiScheduledMission.created_at.desc()).limit(limit))).scalars().all()
    return [public_mission(row) for row in rows]


@router.delete('/ai-schedules/{mission_id}')
async def cancel_mission(mission_id: UUID, db=Depends(get_db), user=Depends(auth.check_capability('ejecutar.automatizada', 'edit'))):
    row = await db.get(models.AiScheduledMission, mission_id, with_for_update=True)
    if not row:
        raise HTTPException(404, 'Programación no encontrada')
    await access_control.require_project_access(db, user, row.proyecto_id, 'edit')
    if not auth.has_capability_permission(user, 'motor_ia.scheduler', 'edit'):
        raise HTTPException(403, 'El usuario no tiene permiso para cancelar programaciones IA')
    if row.estado != 'PENDING':
        raise HTTPException(409, 'Esta programación ya no está pendiente')
    row.estado = 'CANCELLED'
    await db.commit()
    return public_mission(row)
