from .legacy_common import *
from ..services.edition.entitlement_service import enforce_limit


async def _enforce_worker_limit_for_solution(db: AsyncSession, organizacion_id: UUID | None):
    if not organizacion_id:
        raise ValueError("Debe indicar la solucion para vincular el worker")
    count_result = await db.execute(
        select(func.count())
        .select_from(models.AutomationRunner)
        .filter(models.AutomationRunner.organizacion_id == organizacion_id)
    )
    await enforce_limit(db, "max_workers", int(count_result.scalar() or 0), tenant_id=str(organizacion_id))


async def create_test_run(db: AsyncSession, run: schemas.TestRunCreate, user_id: UUID):
    run_data = run.model_dump(exclude={"caso_ids"})
    if run.entorno_id:
        entorno_result = await db.execute(
            select(models.Entorno).filter(
                models.Entorno.id == run.entorno_id,
                models.Entorno.proyecto_id == run.proyecto_id,
                models.Entorno.activo == True,
            )
        )
        db_entorno = entorno_result.scalar_one_or_none()
        if not db_entorno:
            raise ValueError("El ambiente seleccionado no pertenece al proyecto")
        run_data["entorno"] = db_entorno.nombre
        if run.dataset_id:
            dataset_result = await db.execute(
                select(models.EntornoDataset).filter(
                    models.EntornoDataset.id == run.dataset_id,
                    models.EntornoDataset.entorno_id == run.entorno_id,
                    models.EntornoDataset.activo == True,
                )
            )
            db_dataset = dataset_result.scalar_one_or_none()
            if not db_dataset:
                raise ValueError("El dataset seleccionado no pertenece al ambiente o esta inactivo")
        else:
            dataset_result = await db.execute(
                select(models.EntornoDataset)
                .filter(
                    models.EntornoDataset.entorno_id == run.entorno_id,
                    models.EntornoDataset.activo == True,
                )
                .order_by(models.EntornoDataset.es_default.desc(), models.EntornoDataset.fecha_creacion)
            )
            db_dataset = dataset_result.scalars().first()
            if db_dataset:
                run_data["dataset_id"] = db_dataset.id
    elif run.dataset_id:
        raise ValueError("Selecciona un ambiente antes de seleccionar dataset")
    assigned_result = await db.execute(select(models.BuildCaso.caso_id).filter(models.BuildCaso.build_id == run.build_id))
    assigned_case_ids = set(assigned_result.scalars().all())
    if not assigned_case_ids:
        raise ValueError("La build no tiene casos asignados")

    db_run = models.TestRun(**run_data, creado_por=user_id, estado_run=models.EstadoRun.ABIERTO)
    db.add(db_run)
    await db.flush()

    if run.caso_ids:
        if any(caso_id not in assigned_case_ids for caso_id in run.caso_ids):
            raise ValueError("Solo puedes ejecutar casos asignados a la build")
        result = await db.execute(
            select(models.CasoPrueba).filter(
                models.CasoPrueba.id.in_(run.caso_ids),
                models.CasoPrueba.proyecto_id == run.proyecto_id,
                models.CasoPrueba.activo == True,
            )
        )
        casos_activos = result.scalars().all()
    else:
        build_result = await db.execute(select(models.Build).filter(models.Build.id == run.build_id))
        db_build = build_result.scalar_one_or_none()
        filtros = [
            models.CasoPrueba.id.in_(assigned_case_ids),
            models.CasoPrueba.proyecto_id == run.proyecto_id,
            models.CasoPrueba.activo == True,
        ]
        if db_build and db_build.componente_id:
            filtros.append(models.CasoPrueba.componente_id == db_build.componente_id)
        result = await db.execute(select(models.CasoPrueba).filter(*filtros))
        casos_activos = result.scalars().all()

    datasets_resueltos = {}
    variables_resueltas = {}
    run_execution_mode = _run_origin_execution_mode(run.origen) or models.ExecutionMode.MANUAL.value
    for caso in casos_activos:
        resolved_dataset = await resolve_case_dataset(db, caso.id, run.build_id, run.entorno_id, run.dataset_id)
        if resolved_dataset:
            datasets_resueltos[str(caso.id)] = resolved_dataset["dataset_resuelto"]
            variables_resueltas.update(resolved_dataset["variables_resueltas"])
        db_ejecucion = models.EjecucionCaso(
            test_run_id=db_run.id,
            caso_id=caso.id,
            version_ejecutada=caso.version,
            ejecutado_por=user_id,
            estado_resultado=models.EstadoResultado.SIN_CORRER,
            execution_mode=models.ExecutionMode(run_execution_mode),
        )
        db.add(db_ejecucion)
        await db.flush()
        result_pasos = await db.execute(select(models.PasoPrueba).filter(models.PasoPrueba.caso_id == caso.id).order_by(models.PasoPrueba.numero_paso))
        pasos_orig = result_pasos.scalars().all()
        for p in pasos_orig:
            db_snapshot = models.SnapshotPaso(
                ejecucion_caso_id=db_ejecucion.id,
                paso_id=p.id,
                numero_paso=p.numero_paso,
                accion_congelada=p.accion,
                datos_congelados=p.datos,
                resultado_esperado_congelado=p.resultado_esperado,
                estado_paso=models.EstadoResultado.SIN_CORRER,
            )
            db.add(db_snapshot)
    db_run.datasets_resueltos = datasets_resueltos
    db_run.variables_resueltas = variables_resueltas
    await db.commit()
    await db.refresh(db_run)
    return db_run

# --- AUTOMATION RUNNERS / JOBS ---
async def create_automation_runner_registration_token(
    db: AsyncSession,
    payload: schemas.AutomationRunnerRegistrationTokenCreate,
    user_id: UUID,
):
    if not payload.organizacion_id:
        raise ValueError("Debe indicar la solucion para vincular el worker")
    organization = await db.get(models.Organizacion, payload.organizacion_id)
    if not organization or organization.activo is not True:
        raise ValueError("La solucion indicada no esta disponible")
    ttl = max(5, min(int(payload.ttl_minutes or 60), 24 * 60))
    raw_token = f"qreg_{secrets.token_urlsafe(32)}"
    registration = models.AutomationRunnerRegistrationToken(
        token_hash=_hash_token(raw_token),
        nombre=payload.nombre or "Local Playwright Worker",
        organizacion_id=payload.organizacion_id,
        tipo=payload.tipo or "LOCAL",
        expires_at=utc_now() + timedelta(minutes=ttl),
        creado_por=user_id,
    )
    db.add(registration)
    await db.commit()
    await db.refresh(registration)
    return registration, raw_token

async def create_automation_runner(db: AsyncSession, payload: schemas.AutomationRunnerRegister):
    token_result = await db.execute(
        select(models.AutomationRunnerRegistrationToken).filter(
            models.AutomationRunnerRegistrationToken.token_hash == _hash_token(payload.registration_token),
            models.AutomationRunnerRegistrationToken.used_at.is_(None),
        )
    )
    registration = token_result.scalar_one_or_none()
    if not registration:
        raise ValueError("Token de vinculacion invalido o ya utilizado")
    organization = await db.get(models.Organizacion, registration.organizacion_id)
    if not organization or organization.activo is not True:
        raise ValueError("La solucion indicada no esta disponible")
    expires_at = ensure_utc(registration.expires_at)
    if expires_at < utc_now():
        raise ValueError("Token de vinculacion expirado")
    await _enforce_worker_limit_for_solution(db, registration.organizacion_id)

    raw_token = f"qar_{secrets.token_urlsafe(32)}"
    runner = models.AutomationRunner(
        nombre=payload.nombre or registration.nombre,
        organizacion_id=registration.organizacion_id,
        tipo=payload.tipo or registration.tipo or "LOCAL",
        token_hash=_hash_token(raw_token),
        capabilities=schemas.redact_automation_capabilities(payload.capabilities or {}),
        estado="ONLINE",
        ultimo_heartbeat=utc_now(),
    )
    db.add(runner)
    await db.flush()
    registration.used_at = utc_now()
    registration.used_runner_id = runner.id
    await db.commit()
    await db.refresh(runner)
    return runner, raw_token

def _is_expired(value: datetime):
    expires_at = ensure_utc(value)
    return expires_at < utc_now()

async def _generate_pairing_code(db: AsyncSession):
    for _ in range(20):
        code = f"WK-{secrets.randbelow(1_000_000):06d}"
        result = await db.execute(
            select(models.AutomationRunnerPairingRequest.id).filter(
                models.AutomationRunnerPairingRequest.code == code
            )
        )
        if result.scalar_one_or_none() is None:
            return code
    raise ValueError("No se pudo generar codigo de vinculacion")

async def create_automation_runner_pairing_request(
    db: AsyncSession,
    payload: schemas.AutomationRunnerPairingRequestCreate,
):
    if not payload.organizacion_id:
        raise ValueError("Debe indicar la solucion para vincular el worker")
    ttl = max(2, min(int(payload.ttl_minutes or 10), 60))
    code = await _generate_pairing_code(db)
    pairing_token = f"qpair_{secrets.token_urlsafe(32)}"
    request = models.AutomationRunnerPairingRequest(
        code=code,
        pairing_token_hash=_hash_token(pairing_token),
        nombre=payload.nombre or "Local Playwright Worker",
        organizacion_id=payload.organizacion_id,
        tipo=payload.tipo or "LOCAL",
        capabilities=schemas.redact_automation_capabilities(payload.capabilities or {}),
        estado="PENDING",
        expires_at=utc_now() + timedelta(minutes=ttl),
    )
    db.add(request)
    await db.commit()
    await db.refresh(request)
    return request, pairing_token

async def get_pending_automation_runner_pairing_requests(db: AsyncSession):
    result = await db.execute(
        select(models.AutomationRunnerPairingRequest)
        .join(models.Organizacion, models.Organizacion.id == models.AutomationRunnerPairingRequest.organizacion_id)
        .filter(models.AutomationRunnerPairingRequest.estado == "PENDING")
        .filter(models.Organizacion.activo.is_(True))
        .order_by(models.AutomationRunnerPairingRequest.fecha_creacion.desc())
    )
    requests = result.scalars().all()
    changed = False
    approved_result = await db.execute(
        select(models.AutomationRunnerPairingRequest).filter(
            models.AutomationRunnerPairingRequest.estado == "APPROVED",
            models.AutomationRunnerPairingRequest.runner_token.is_not(None),
        )
    )
    for request in approved_result.scalars().all():
        if _is_expired(request.expires_at):
            request.runner_token = None
            changed = True
    for request in requests:
        if _is_expired(request.expires_at):
            request.estado = "EXPIRED"
            changed = True
    if changed:
        await db.commit()
    return [request for request in requests if request.estado == "PENDING" and not _is_expired(request.expires_at)]

async def poll_automation_runner_pairing_request(db: AsyncSession, code: str, pairing_token: str):
    result = await db.execute(
        select(models.AutomationRunnerPairingRequest).filter(
            models.AutomationRunnerPairingRequest.code == code.upper()
        )
    )
    request = result.scalar_one_or_none()
    if not request or request.pairing_token_hash != _hash_token(pairing_token):
        raise ValueError("Solicitud de vinculacion invalida")
    if request.estado == "PENDING" and _is_expired(request.expires_at):
        request.estado = "EXPIRED"
        await db.commit()
        await db.refresh(request)
    if request.estado == "APPROVED" and _is_expired(request.expires_at):
        request.runner_token = None
        await db.commit()
        await db.refresh(request)
        raise ValueError("Solicitud de vinculacion expirada")
    return request

async def approve_automation_runner_pairing_request(db: AsyncSession, code: str, user_id: UUID):
    result = await db.execute(
        select(models.AutomationRunnerPairingRequest).filter(
            models.AutomationRunnerPairingRequest.code == code.upper()
        )
    )
    request = result.scalar_one_or_none()
    if not request:
        raise ValueError("Solicitud de vinculacion no encontrada")
    if request.estado != "PENDING":
        raise ValueError("La solicitud ya no esta pendiente")
    if _is_expired(request.expires_at):
        request.estado = "EXPIRED"
        await db.commit()
        raise ValueError("La solicitud de vinculacion expiro")
    await _enforce_worker_limit_for_solution(db, request.organizacion_id)

    raw_token = f"qar_{secrets.token_urlsafe(32)}"
    now = utc_now()
    runner = models.AutomationRunner(
        nombre=request.nombre,
        organizacion_id=request.organizacion_id,
        tipo=request.tipo or "LOCAL",
        token_hash=_hash_token(raw_token),
        capabilities=schemas.redact_automation_capabilities(request.capabilities or {}),
        estado="ONLINE",
        ultimo_heartbeat=now,
    )
    db.add(runner)
    await db.flush()
    request.estado = "APPROVED"
    request.approved_at = now
    request.approved_by = user_id
    request.runner_id = runner.id
    request.runner_token = raw_token
    request.expires_at = now + timedelta(minutes=10)
    await db.commit()
    await db.refresh(request)
    await db.refresh(runner)
    return request, runner, raw_token

async def deny_automation_runner_pairing_request(db: AsyncSession, code: str):
    result = await db.execute(
        select(models.AutomationRunnerPairingRequest).filter(
            models.AutomationRunnerPairingRequest.code == code.upper()
        )
    )
    request = result.scalar_one_or_none()
    if not request:
        raise ValueError("Solicitud de vinculacion no encontrada")
    if request.estado != "PENDING":
        raise ValueError("La solicitud ya no esta pendiente")
    request.estado = "DENIED"
    request.denied_at = utc_now()
    await db.commit()
    await db.refresh(request)
    return request

async def get_automation_runners(db: AsyncSession):
    result = await db.execute(
        select(models.AutomationRunner)
        .join(models.Organizacion, models.Organizacion.id == models.AutomationRunner.organizacion_id)
        .filter(models.Organizacion.activo.is_(True))
        .order_by(models.AutomationRunner.fecha_creacion.desc())
    )
    return result.scalars().all()

def automation_runner_response(runner: models.AutomationRunner):
    return {
        "id": runner.id,
        "nombre": runner.nombre,
        "organizacion_id": runner.organizacion_id,
        "tipo": runner.tipo,
        "estado": _effective_runner_status(runner),
        "capabilities": runner.capabilities or {},
        "activo": runner.activo,
        "ultimo_heartbeat": runner.ultimo_heartbeat,
        "fecha_creacion": runner.fecha_creacion,
    }

async def get_automation_runner(db: AsyncSession, runner_id: UUID):
    result = await db.execute(
        select(models.AutomationRunner).filter(models.AutomationRunner.id == runner_id)
    )
    return result.scalar_one_or_none()

async def get_runner_by_token(db: AsyncSession, token: str):
    if not token:
        return None
    result = await db.execute(
        select(models.AutomationRunner).filter(
            models.AutomationRunner.token_hash == _hash_token(token),
            models.AutomationRunner.activo == True,
        )
    )
    return result.scalar_one_or_none()

async def update_runner_heartbeat(db: AsyncSession, runner: models.AutomationRunner, payload: schemas.AutomationRunnerHeartbeat):
    runner.estado = payload.estado or "ONLINE"
    capabilities = dict(runner.capabilities or {})
    if payload.capabilities is not None:
        capabilities.update(schemas.redact_automation_capabilities(payload.capabilities))
    if payload.resources is not None:
        capabilities["resources"] = schemas.redact_automation_capabilities(payload.resources)
    if payload.active_jobs is not None:
        capabilities["active_jobs"] = payload.active_jobs
    if payload.current_job_id is not None:
        capabilities["current_job_id"] = str(payload.current_job_id)
    else:
        capabilities.pop("current_job_id", None)
    if payload.uptime_seconds is not None:
        capabilities["uptime_seconds"] = payload.uptime_seconds
    runner.capabilities = capabilities
    runner.ultimo_heartbeat = utc_now()
    await db.commit()
    await db.refresh(runner)
    return runner

async def update_automation_runner(db: AsyncSession, runner_id: UUID, payload: schemas.AutomationRunnerUpdate):
    result = await db.execute(select(models.AutomationRunner).filter(models.AutomationRunner.id == runner_id))
    runner = result.scalar_one_or_none()
    if not runner:
        return None
    if payload.nombre is not None:
        runner.nombre = payload.nombre
    if payload.tipo is not None:
        runner.tipo = payload.tipo
    if payload.capabilities is not None:
        runner.capabilities = schemas.redact_automation_capabilities(payload.capabilities)
    if payload.activo is not None:
        runner.activo = payload.activo
        if not payload.activo:
            runner.estado = "OFFLINE"
    await db.commit()
    await db.refresh(runner)
    return runner
