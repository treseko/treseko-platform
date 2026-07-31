import re

from ...main_context import *
from ...services.error_sanitizer import sanitize_external_error

MAX_AUTOMATION_HEADER_TOKEN_LENGTH = 160
PAIRING_CODE_RE = re.compile(r"^WK-\d{6}$", re.IGNORECASE)

def _request_ip(request: Request | None) -> str:
    return request.client.host if request and request.client else "unknown"


def _runner_audit_details(runner: models.AutomationRunner | None) -> dict:
    if not runner:
        return {}
    return {
        "runner_id": str(runner.id),
        "nombre": runner.nombre,
        "tipo": runner.tipo,
        "estado": runner.estado,
        "activo": runner.activo,
        "capability_keys": sorted((runner.capabilities or {}).keys()),
    }


def _normalize_automation_header_token(value: Optional[str], *, unauthorized: bool = False) -> str:
    token = (value or "").strip()
    if (
        not token
        or len(token) > MAX_AUTOMATION_HEADER_TOKEN_LENGTH
        or any(char.isspace() for char in token)
        or "\x00" in token
    ):
        status_code = status.HTTP_401_UNAUTHORIZED if unauthorized else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail="Token de automatizacion invalido")
    return token


def _normalize_pairing_code(value: str) -> str:
    code = (value or "").strip().upper()
    if not PAIRING_CODE_RE.fullmatch(code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Codigo de vinculacion invalido")
    return code


def _safe_automation_event_text(value: object) -> str:
    return sanitize_external_error(value, max_len=1000) if value else ""


async def _automation_job_context(db: AsyncSession, job: models.AutomationJob):
    if job.test_run_id:
        result = await db.execute(
            select(models.TestRun.proyecto_id, models.TestRun.build_id, models.Build.componente_id)
            .outerjoin(models.Build, models.Build.id == models.TestRun.build_id)
            .filter(models.TestRun.id == job.test_run_id)
        )
        row = result.first()
        if row:
            return row.proyecto_id, row.build_id or job.build_id, row.componente_id
    if job.build_id:
        result = await db.execute(
            select(models.Build.proyecto_id, models.Build.id, models.Build.componente_id)
            .filter(models.Build.id == job.build_id)
        )
        row = result.first()
        if row:
            return row.proyecto_id, row.id, row.componente_id
    if job.caso_id:
        result = await db.execute(
            select(models.CasoPrueba.proyecto_id, models.CasoPrueba.componente_id)
            .filter(models.CasoPrueba.id == job.caso_id)
        )
        row = result.first()
        if row:
            return row.proyecto_id, None, row.componente_id
    return None, job.build_id, None


async def _accessible_project_ids(db: AsyncSession, current_user: models.Usuario):
    if access_control.is_global_admin(current_user):
        return None
    result = await db.execute(
        select(models.ProyectoMiembro.proyecto_id)
        .filter(models.ProyectoMiembro.usuario_id == current_user.id)
    )
    return list(result.scalars().all())


async def _require_automation_job_access(
    db: AsyncSession,
    current_user: models.Usuario,
    job: models.AutomationJob,
    level: str = "read",
):
    project_id, _build_id, _component_id = await _automation_job_context(db, job)
    if project_id:
        await access_control.require_project_access(db, current_user, project_id, level)
        return project_id
    if (
        (job.job_type or "EXECUTION") == "DRY_RUN"
        and job.creado_por == current_user.id
    ):
        return None
    if access_control.is_global_admin(current_user):
        return None
    raise HTTPException(status_code=403, detail="No tienes acceso a este job")


async def _publish_automation_job_event(
    db: AsyncSession,
    event_type: str,
    job: models.AutomationJob,
    *,
    runner: models.AutomationRunner | None = None,
    actor_id: UUID | None = None,
    extra_payload: dict | None = None,
):
    project_id, build_id, component_id = await _automation_job_context(db, job)
    payload = {
        "automation_job": {
            "id": str(job.id),
            "estado": job.estado.value if hasattr(job.estado, "value") else str(job.estado),
            "job_type": job.job_type,
            "runner_id": str(runner.id) if runner else (str(job.runner_id) if job.runner_id else None),
        },
    }
    if extra_payload:
        payload.update(extra_payload)
    await realtime_event_bus.publish(
        project_id,
        event_type,
        actor_id=actor_id,
        component_id=component_id,
        build_id=build_id,
        case_id=job.caso_id,
        run_id=job.test_run_id,
        execution_id=job.ejecucion_id,
        payload=payload,
    )


async def _publish_worker_status_for_runner(db: AsyncSession, runner: models.AutomationRunner):
    result = await db.execute(
        select(models.TestRun.proyecto_id)
        .join(models.AutomationJob, models.AutomationJob.test_run_id == models.TestRun.id)
        .filter(models.AutomationJob.runner_id == runner.id)
        .distinct()
    )
    project_ids = result.scalars().all()
    for project_id in project_ids:
        await realtime_event_bus.publish(
            project_id,
            "worker.status.updated",
            payload={
                "worker": {
                    "id": str(runner.id),
                    "nombre": runner.nombre,
                    "estado": runner.estado,
                },
            },
        )
