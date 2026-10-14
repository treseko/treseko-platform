"""Revalidate execution authority at claim and every lease renewal."""
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from fastapi import HTTPException
from .. import models, auth, access_control
from .automation_payloads import worker_payload
from uuid import UUID


async def validate_worker_job_scope(db, job):
    user = (await db.execute(select(models.Usuario).options(selectinload(models.Usuario.rol_personalizado)).where(models.Usuario.id == job.creado_por))).scalar_one_or_none()
    if not user or not user.activo:
        raise ValueError('El usuario que creó el job ya no está activo')
    capability = 'crear_pruebas.scripts' if job.job_type == 'DRY_RUN' else 'ejecutar.automatizada'
    if not auth.has_capability_permission(user, capability, 'edit') or not auth.has_module_permission(user, 'automatizacion', 'read'):
        raise ValueError('El usuario ya no tiene permiso para ejecutar este job')
    try:
        await access_control.require_project_access(db, user, job.proyecto_id, 'edit')
    except HTTPException as exc:
        raise ValueError('El usuario ya no tiene acceso al proyecto del job') from exc
    project = await db.get(models.Proyecto, job.proyecto_id)
    if not project or project.organizacion_id != job.organizacion_id:
        raise ValueError('El proyecto del job no corresponde a su solución')
    if job.job_type != 'DRY_RUN':
        build = await db.get(models.Build, job.build_id)
        if not build or build.proyecto_id != job.proyecto_id or not access_control.is_build_active(build):
            raise ValueError('La build del job está inactiva')
        case_ids = [job.caso_id] if job.caso_id else []
        if job.job_type == 'API_EXECUTION':
            case_ids = [UUID(str(item['case_id'])) for item in worker_payload(job).get('cases', [])]
            if not case_ids:
                raise ValueError('El job API no conserva sus casos de ejecución')
        for case_id in case_ids:
            case = await db.get(models.CasoPrueba, case_id)
            if not case or not case.activo or case.estado_caso == models.EstadoCaso.ARCHIVADO or case.proyecto_id != job.proyecto_id or case.componente_id != build.componente_id:
                raise ValueError('El caso del job ya no está disponible')
            assigned = await db.scalar(select(models.BuildCaso.caso_id).where(
                models.BuildCaso.build_id == job.build_id, models.BuildCaso.caso_id == case_id))
            if assigned is None:
                raise ValueError('El caso del job ya no está asignado a la build')
    return user
