"""One-shot AI missions, claimed and enqueued in a single DB transaction."""
import asyncio
import logging
from uuid import UUID
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload
from .. import models, schemas, auth, access_control
from ..database import AsyncSessionLocal
from ..time_utils import utc_now
from ..repositories.test_runs_automation_runners import create_test_run
from .ai_execution_queue import enqueue_ai_execution
from .edition.entitlement_service import ensure_feature_enabled
from .edition.usage_limits import enforce_weekly_ai_execution_limit
from .update_ai_queue_control import AI_QUEUE_LOCK, ai_queue_paused
from .error_sanitizer import sanitize_external_error

log = logging.getLogger(__name__)
_lock = asyncio.Lock()


async def validate_mission(db, user, project_id, build_id, case_ids, *, require_scheduling=False, require_ai=True, lock_build=False):
    if not user or not user.activo or not all((
        auth.has_capability_permission(user, 'ejecutar.manual', 'edit'),
        auth.has_capability_permission(user, 'ejecutar.automatizada', 'edit'),
        auth.has_module_permission(user, 'automatizacion', 'read'),
    )):
        raise HTTPException(403, 'El usuario no tiene permiso para ejecutar la programación IA')
    if require_scheduling and not auth.has_capability_permission(user, 'motor_ia.scheduler', 'edit'):
        raise HTTPException(403, 'El usuario no tiene permiso para programar ejecuciones IA')
    await access_control.require_project_access(db, user, project_id, 'edit')
    if require_ai:
        await ensure_feature_enabled(db, 'ai.basic_execution')
    build = await db.get(models.Build, build_id, with_for_update=lock_build)
    if not build or build.proyecto_id != project_id or not access_control.is_build_active(build) or not build.componente_id:
        raise HTTPException(409, 'La programación requiere una build activa del proyecto')
    cases = (await db.execute(select(models.CasoPrueba).where(models.CasoPrueba.id.in_(case_ids)))).scalars().all()
    if len(cases) != len(set(case_ids)) or any(
        case.proyecto_id != project_id or case.componente_id != build.componente_id
        or not case.activo
        or case.estado_caso == models.EstadoCaso.ARCHIVADO
        or case.formato_prueba == models.FormatoPrueba.PERFORMANCE for case in cases
    ):
        raise HTTPException(409, 'Los casos no están disponibles para esta build y ejecución IA')
    conversational = [case.formato_prueba == models.FormatoPrueba.CONVERSACIONAL for case in cases]
    if any(conversational) and not all(conversational):
        raise HTTPException(409, 'No se pueden mezclar casos conversacionales con otros formatos en una programación IA')
    assigned = set((await db.execute(select(models.BuildCaso.caso_id).where(models.BuildCaso.build_id == build_id))).scalars().all())
    if not set(case_ids).issubset(assigned):
        raise HTTPException(409, 'Solo se pueden programar casos asignados a la build')


async def launch_mission(db, mission):
    user = (await db.execute(select(models.Usuario).options(selectinload(models.Usuario.rol_personalizado)).where(models.Usuario.id == mission.creado_por))).scalar_one_or_none()
    case_ids = [UUID(value) for value in mission.caso_ids]
    scheduled = isinstance(mission, models.AiScheduledMission)
    await validate_mission(db, user, mission.proyecto_id, mission.build_id, case_ids, require_scheduling=scheduled, lock_build=True)
    project = await db.get(models.Proyecto, mission.proyecto_id)
    await enforce_weekly_ai_execution_limit(db, solution_id=project.organizacion_id, increment=len(case_ids))
    run = await create_test_run(db, schemas.TestRunCreate(
        proyecto_id=mission.proyecto_id, build_id=mission.build_id, nombre=mission.nombre,
        origen='IA', entorno='Staging (QA)', caso_ids=case_ids,
    ), mission.creado_por, commit=False)
    executions = (await db.execute(select(models.EjecucionCaso).where(models.EjecucionCaso.test_run_id == run.id))).scalars().all()
    for execution in executions:
        job = await enqueue_ai_execution(db, execution, mission.creado_por)
        job.payload_congelado = {**job.payload_congelado, 'server_mission': True, 'server_scheduled': scheduled, 'record_video': getattr(mission, 'record_video', True)}
    mission.test_run_id = run.id
    mission.estado = 'QUEUED'
    if scheduled:
        mission.error_message = None


async def drain_scheduled_missions():
    if _lock.locked():
        return 0
    count = 0
    async with _lock:
        async with AsyncSessionLocal() as db:
            if db.bind.dialect.name == 'postgresql':
                await db.execute(text(f'SELECT pg_advisory_xact_lock({AI_QUEUE_LOCK})'))
            if await ai_queue_paused(db):
                return 0
            missions = (await db.execute(select(models.AiScheduledMission).where(
                models.AiScheduledMission.estado == 'PENDING', models.AiScheduledMission.scheduled_at <= utc_now(),
            ).order_by(models.AiScheduledMission.scheduled_at).limit(20).with_for_update(skip_locked=True))).scalars().all()
            for mission in missions:
                try:
                    async with db.begin_nested():
                        await launch_mission(db, mission)
                    count += 1
                except (HTTPException, ValueError) as exc:
                    transient = isinstance(exc, HTTPException) and (exc.status_code in (408, 429) or 500 <= exc.status_code < 600)
                    mission.estado = 'PENDING' if transient else 'BLOCKED'
                    mission.error_message = ('Problema temporal del servicio; la programación sigue pendiente y se reintentará.'
                        if transient else 'No se pudo iniciar: revisa permisos, plan, build y casos seleccionados.')
                    log.warning('AI schedule %s: %s', 'pending retry' if transient else 'blocked', sanitize_external_error(getattr(exc, 'detail', str(exc)), max_len=500))
                # Unexpected DB/infrastructure errors roll back the transaction:
                # leave PENDING for a subsequent tick, never create a partial run.
            await db.commit()
    return count
