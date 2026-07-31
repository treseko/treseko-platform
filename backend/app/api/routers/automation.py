from fastapi import APIRouter
from sqlalchemy import func

from ...main_context import *
from ...services.edition.entitlement_service import enforce_limit
from ...services.error_sanitizer import sanitize_external_error
from .automation_helpers import (_accessible_project_ids, _automation_job_context, _normalize_automation_header_token, _normalize_pairing_code, _publish_automation_job_event, _publish_worker_status_for_runner, _request_ip, _require_automation_job_access, _runner_audit_details, _safe_automation_event_text)

router = APIRouter(tags=["Automatizacion"])

async def get_current_automation_runner(
    x_runner_token: Optional[str] = Header(default=None),
    authorization: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    token = x_runner_token
    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    token = _normalize_automation_header_token(token, unauthorized=True)
    runner = await crud.get_runner_by_token(db, token)
    if not runner:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Runner token invalido")
    organization = await db.get(models.Organizacion, runner.organizacion_id) if runner.organizacion_id else None
    if not organization or organization.activo is not True:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Runner token invalido")
    return runner


@router.post("/automation-runners/registration-tokens", response_model=schemas.AutomationRunnerRegistrationTokenCreated)
async def create_automation_runner_registration_token(
    request: Request,
    payload: schemas.AutomationRunnerRegistrationTokenCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("automatizacion.workers", "edit")),
):
    if not payload.organizacion_id:
        raise HTTPException(status_code=400, detail="Debe indicar la solucion para generar el token de worker")
    await access_control.require_organization_access(db, current_user, payload.organizacion_id, "edit")
    count_result = await db.execute(
        select(func.count())
        .select_from(models.AutomationRunner)
        .filter(models.AutomationRunner.organizacion_id == payload.organizacion_id)
    )
    await enforce_limit(db, "max_workers", int(count_result.scalar() or 0), tenant_id=str(payload.organizacion_id))
    registration, token = await crud.create_automation_runner_registration_token(db, payload, current_user.id)
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="CREATE",
        recurso="automation_runner_registration_token",
        recurso_id=registration.id,
        detalles={
            "nombre": registration.nombre,
            "tipo": registration.tipo,
            "expires_at": isoformat_utc(registration.expires_at),
        },
        ip_address=_request_ip(request),
    )
    return {
        "registration_token": token,
        "expires_at": registration.expires_at,
        "nombre": registration.nombre,
        "tipo": registration.tipo,
    }

@router.post("/automation-runners/pairing-requests", response_model=schemas.AutomationRunnerPairingRequestCreated)
async def create_automation_runner_pairing_request(
    payload: schemas.AutomationRunnerPairingRequestCreate,
    db: AsyncSession = Depends(get_db),
):
    if not payload.organizacion_id:
        raise HTTPException(status_code=400, detail="Debe indicar la solucion para solicitar un worker")
    organization = await db.get(models.Organizacion, payload.organizacion_id)
    if not organization or organization.activo is not True:
        raise HTTPException(status_code=404, detail="Solucion no disponible")
    request, pairing_token = await crud.create_automation_runner_pairing_request(db, payload)
    return {
        "code": request.code,
        "pairing_token": pairing_token,
        "expires_at": request.expires_at,
        "nombre": request.nombre,
        "tipo": request.tipo,
        "estado": request.estado,
    }

@router.get("/automation-runners/pairing-requests/", response_model=List[schemas.AutomationRunnerPairingRequest])
async def list_automation_runner_pairing_requests(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("automatizacion.workers", "edit")),
):
    return await crud.get_pending_automation_runner_pairing_requests(db)

@router.get("/automation-runners/pairing-requests/{code}", response_model=schemas.AutomationRunnerPairingPoll)
async def poll_automation_runner_pairing_request(
    code: str,
    x_pairing_token: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    try:
        request = await crud.poll_automation_runner_pairing_request(
            db,
            _normalize_pairing_code(code),
            _normalize_automation_header_token(x_pairing_token),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    runner_payload = None
    runner_token = None
    if request.estado == "APPROVED" and request.runner_id:
        runner = await crud.get_automation_runner(db, request.runner_id)
        if runner:
            runner_payload = {
                "id": str(runner.id),
                "nombre": runner.nombre,
                "tipo": runner.tipo,
                "estado": runner.estado,
                "capabilities": runner.capabilities or {},
                "activo": runner.activo,
                "ultimo_heartbeat": isoformat_utc(runner.ultimo_heartbeat),
                "fecha_creacion": isoformat_utc(runner.fecha_creacion),
            }
        runner_token = request.runner_token
        if runner_token:
            request.runner_token = None
            await db.commit()

    return {
        "code": request.code,
        "estado": request.estado,
        "expires_at": request.expires_at,
        "runner_token": runner_token,
        "runner": runner_payload,
    }

@router.post("/automation-runners/pairing-requests/{code}/approve", response_model=schemas.AutomationRunnerPairingRequest)
async def approve_automation_runner_pairing_request(
    request: Request,
    code: str,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("automatizacion.workers", "edit")),
):
    normalized_code = _normalize_pairing_code(code)
    try:
        pending = (
            await db.execute(
                select(models.AutomationRunnerPairingRequest).filter(
                    models.AutomationRunnerPairingRequest.code == normalized_code
                )
            )
        ).scalar_one_or_none()
        if not pending:
            raise HTTPException(status_code=404, detail="Solicitud de vinculacion no encontrada")
        if not pending.organizacion_id:
            raise HTTPException(status_code=400, detail="La solicitud de worker no tiene solucion asociada")
        await access_control.require_organization_access(db, current_user, pending.organizacion_id, "edit")
        count_result = await db.execute(
            select(func.count())
            .select_from(models.AutomationRunner)
            .filter(models.AutomationRunner.organizacion_id == pending.organizacion_id)
        )
        await enforce_limit(db, "max_workers", int(count_result.scalar() or 0), tenant_id=str(pending.organizacion_id))
        pairing_request, runner, _ = await crud.approve_automation_runner_pairing_request(db, normalized_code, current_user.id)
        await crud.create_audit_log(
            db=db,
            usuario_id=current_user.id,
            accion="APPROVE",
            recurso="automation_runner_pairing_request",
            recurso_id=pairing_request.id,
            detalles={
                "code": pairing_request.code,
                "runner": _runner_audit_details(runner),
                "expires_at": isoformat_utc(pairing_request.expires_at),
            },
            ip_address=_request_ip(request),
        )
        return pairing_request
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.post("/automation-runners/pairing-requests/{code}/deny", response_model=schemas.AutomationRunnerPairingRequest)
async def deny_automation_runner_pairing_request(
    request: Request,
    code: str,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("automatizacion.workers", "edit")),
):
    try:
        pairing_request = await crud.deny_automation_runner_pairing_request(db, _normalize_pairing_code(code))
        await crud.create_audit_log(
            db=db,
            usuario_id=current_user.id,
            accion="DENY",
            recurso="automation_runner_pairing_request",
            recurso_id=pairing_request.id,
            detalles={"code": pairing_request.code, "nombre": pairing_request.nombre, "tipo": pairing_request.tipo},
            ip_address=_request_ip(request),
        )
        return pairing_request
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.post("/automation-runners/register", response_model=schemas.AutomationRunnerCreated)
async def register_automation_runner(
    payload: schemas.AutomationRunnerRegister,
    db: AsyncSession = Depends(get_db),
):
    try:
        runner, token = await crud.create_automation_runner(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    data = schemas.AutomationRunner.model_validate(runner).model_dump()
    data["runner_token"] = token
    return data

@router.get("/automation-runners/me", response_model=schemas.AutomationRunner)
async def get_current_runner_profile(
    runner: models.AutomationRunner = Depends(get_current_automation_runner),
):
    return runner

@router.get("/automation-runners/", response_model=List[schemas.AutomationRunner])
async def list_automation_runners(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("automatizacion.workers", "read")),
):
    runners = await crud.get_automation_runners(db)
    return [crud.automation_runner_response(runner) for runner in runners]

@router.patch("/automation-runners/{runner_id}", response_model=schemas.AutomationRunner)
async def update_automation_runner(
    request: Request,
    runner_id: UUID,
    payload: schemas.AutomationRunnerUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("automatizacion.workers", "edit")),
):
    previous = await crud.get_automation_runner(db, runner_id)
    previous_details = _runner_audit_details(previous)
    runner = await crud.update_automation_runner(db, runner_id, payload)
    if not runner:
        raise HTTPException(status_code=404, detail="Runner no encontrado")
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="UPDATE",
        recurso="automation_runner",
        recurso_id=runner.id,
        detalles={
            "old_value": previous_details,
            "new_value": _runner_audit_details(runner),
        },
        ip_address=_request_ip(request),
    )
    return runner

@router.post("/automation-runners/{runner_id}/revoke", response_model=schemas.AutomationRunner)
async def revoke_automation_runner(
    request: Request,
    runner_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("automatizacion.workers", "edit")),
):
    runner = await crud.revoke_automation_runner(db, runner_id)
    if not runner:
        raise HTTPException(status_code=404, detail="Runner no encontrado")
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="REVOKE",
        recurso="automation_runner",
        recurso_id=runner.id,
        detalles=_runner_audit_details(runner),
        ip_address=_request_ip(request),
    )
    return runner

@router.post("/automation-runners/{runner_id}/heartbeat", response_model=schemas.AutomationRunner)
async def automation_runner_heartbeat(
    runner_id: UUID,
    payload: schemas.AutomationRunnerHeartbeat,
    db: AsyncSession = Depends(get_db),
    runner: models.AutomationRunner = Depends(get_current_automation_runner),
):
    if runner.id != runner_id:
        raise HTTPException(status_code=403, detail="El token no pertenece a este runner")
    updated = await crud.update_runner_heartbeat(db, runner, payload)
    await _publish_worker_status_for_runner(db, updated)
    if str(payload.estado or "").upper() == "OFFLINE":
        await notification_event_service.emit_event(
            db=db,
            event_type="automation.runner.offline",
            entity_type="automation_runner",
            entity_id=runner_id,
            severity="warning",
            payload={
                "runner": {"id": str(runner_id), "nombre": updated.nombre, "estado": updated.estado},
                "message": f"Automation runner offline: {updated.nombre}",
            },
            dedupe_key=f"automation.runner.offline:{runner_id}:{utc_now().strftime('%Y%m%d%H%M')}",
        )
    return updated

@router.get("/automation-jobs/next", response_model=Optional[schemas.AutomationJob])
async def get_next_automation_job(
    db: AsyncSession = Depends(get_db),
    runner: models.AutomationRunner = Depends(get_current_automation_runner),
):
    return await crud.get_next_automation_job(db, runner)

@router.post("/automation-jobs/{job_id}/claim", response_model=schemas.AutomationJob)
async def claim_automation_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    runner: models.AutomationRunner = Depends(get_current_automation_runner),
):
    job = await crud.get_automation_job(db, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job no encontrado")
    try:
        claimed = await crud.claim_automation_job(db, job, runner)
        await _publish_automation_job_event(db, "automation.job.updated", claimed, runner=runner)
        return claimed
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.post("/automation-jobs/{job_id}/result", response_model=schemas.AutomationJob)
async def report_automation_job_result(
    job_id: UUID,
    payload: schemas.AutomationJobResult,
    db: AsyncSession = Depends(get_db),
    runner: models.AutomationRunner = Depends(get_current_automation_runner),
):
    job = await crud.get_automation_job(db, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job no encontrado")
    if not job.runner_id:
        raise HTTPException(status_code=409, detail="El job debe ser reclamado antes de reportar resultados")
    if job.runner_id != runner.id:
        raise HTTPException(status_code=403, detail="Este job fue tomado por otro runner")
    try:
        updated = await crud.complete_automation_job(db, job, payload)
        event_map = {
            models.AutomationJobStatus.PASSED: "automation.job.completed",
            models.AutomationJobStatus.FAILED: "automation.job.failed",
            models.AutomationJobStatus.ERROR: "automation.job.failed",
            models.AutomationJobStatus.BLOCKED: "automation.job.failed",
            models.AutomationJobStatus.TIMEOUT: "automation.job.timeout",
        }
        event_type = event_map.get(updated.estado)
        if event_type:
            project_id = None
            if updated.test_run_id:
                project_id = (await db.execute(select(models.TestRun.proyecto_id).filter(models.TestRun.id == updated.test_run_id))).scalar_one_or_none()
            await notification_event_service.emit_event(
                db=db,
                event_type=event_type,
                proyecto_id=project_id,
                entity_type="automation_job",
                entity_id=updated.id,
                severity="info" if event_type == "automation.job.completed" else "warning",
                payload={
                    "automation_job": {
                        "id": str(updated.id),
                        "estado": updated.estado.value if hasattr(updated.estado, "value") else str(updated.estado),
                        "framework": updated.required_framework,
                        "language": updated.required_language,
                        "runner_id": str(runner.id),
                        "runner": runner.nombre,
                        "error": _safe_automation_event_text(updated.error_message),
                    },
                    "message": f"Automation job {updated.estado.value if hasattr(updated.estado, 'value') else updated.estado}",
                },
                dedupe_key=f"{event_type}:{updated.id}:{updated.estado.value if hasattr(updated.estado, 'value') else updated.estado}",
            )
        await _publish_automation_job_event(db, "automation.job.updated", updated, runner=runner)
        if event_type:
            await _publish_automation_job_event(db, event_type, updated, runner=runner)
        return updated
    except ValueError as exc:
        detail = str(exc)
        if "build" in detail.lower() and "inactiva" in detail.lower():
            job.estado = models.AutomationJobStatus.ERROR
            job.error_message = detail
            job.fecha_fin = utc_now()
            if job.runner:
                job.runner.estado = "ONLINE"
                job.runner.ultimo_heartbeat = utc_now()
            await db.commit()
            await db.refresh(job)
            await _publish_automation_job_event(
                db,
                "automation.job.failed",
                job,
                runner=runner,
                extra_payload={"error": detail, "reason": "inactive_build"},
            )
            raise HTTPException(status_code=409, detail=detail)
        raise HTTPException(status_code=400, detail=detail)

@router.get("/automation-jobs/", response_model=List[schemas.AutomationJob])
async def list_automation_jobs(
    limit: int = Query(20, ge=1, le=100),
    runner_id: Optional[UUID] = None,
    status: Optional[models.AutomationJobStatus] = None,
    include_dry_runs: bool = False,
    proyecto_id: Optional[UUID] = None,
    component_id: Optional[UUID] = None,
    build_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("automatizacion.jobs", "read")),
):
    if proyecto_id:
        await access_control.require_project_access(db, current_user, proyecto_id, "read")
    if component_id:
        db_component = await access_control.require_component_access(db, current_user, component_id, "read")
        if proyecto_id and db_component.proyecto_id != proyecto_id:
            raise HTTPException(status_code=404, detail="Componente no encontrado para el proyecto")
    if build_id:
        db_build = await access_control.require_build_access(db, current_user, build_id, "read")
        if proyecto_id and db_build.proyecto_id != proyecto_id:
            raise HTTPException(status_code=404, detail="Build no encontrado para el proyecto")
    accessible_project_ids = None if proyecto_id else await _accessible_project_ids(db, current_user)
    return await crud.list_automation_jobs(
        db,
        limit=limit,
        runner_id=runner_id,
        status=status,
        include_dry_runs=include_dry_runs,
        proyecto_id=proyecto_id,
        component_id=component_id,
        build_id=build_id,
        accessible_project_ids=accessible_project_ids,
        accessible_user_id=current_user.id,
    )

@router.post("/automation-jobs/dry-run", response_model=schemas.AutomationJob)
async def create_automation_dry_run(
    payload: schemas.AutomationDryRunRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.scripts", "edit")),
):
    if not auth.has_capability_permission(current_user, "automatizacion.workers", "read"):
        raise HTTPException(
            status_code=403,
            detail="Necesitas permiso de automatizacion para probar scripts con workers",
        )
    await access_control.require_project_access(db, current_user, payload.proyecto_id, "edit")
    if payload.componente_id:
        db_component = await access_control.require_component_access(db, current_user, payload.componente_id, "read")
        if db_component.proyecto_id != payload.proyecto_id:
            raise HTTPException(status_code=404, detail="Componente no encontrado para el proyecto")
    if payload.entorno_id:
        env_result = await db.execute(
            select(models.Entorno).filter(
                models.Entorno.id == payload.entorno_id,
                models.Entorno.proyecto_id == payload.proyecto_id,
            )
        )
        if not env_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Entorno no encontrado para el proyecto")
    try:
        job = await crud.create_automation_dry_run_job(db, payload, current_user.id)
        await _publish_automation_job_event(db, "automation.job.created", job, actor_id=current_user.id)
        return job
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.get("/automation-jobs/{job_id}", response_model=schemas.AutomationJob)
async def get_automation_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("automatizacion.jobs", "read")),
):
    job = await crud.get_automation_job(db, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job no encontrado")
    await _require_automation_job_access(db, current_user, job, "read")
    if (
        (job.job_type or "EXECUTION") == "DRY_RUN"
        and job.creado_por != current_user.id
        and not auth.has_module_permission(current_user, "automatizacion", "edit")
    ):
        raise HTTPException(status_code=403, detail="No tienes acceso a esta prueba temporal")
    return job


router.export_symbols = {"get_current_automation_runner": get_current_automation_runner}
