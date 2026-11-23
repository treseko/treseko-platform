from ..services.automation_dispatch_scope import validate_worker_job_scope
from .repository_context import *
from ..services.edition.entitlement_service import enforce_limit
from ..services.api_dynamic_variables import (
    DynamicVariableContext,
    derive_case_dynamic_seed,
    extract_unsupported_dynamic_variable_names,
    safe_dynamic_values,
)
from ..services.api_test_runner import resolve_variables
from ..services.api_evidence_policy import evidence_policy_marker, public_test_data_evidence_enabled


async def _enforce_worker_limit_for_solution(db: AsyncSession, organizacion_id: UUID | None):
    if not organizacion_id:
        raise ValueError("Debe indicar la solucion para vincular el worker")
    count_result = await db.execute(
        select(func.count())
        .select_from(models.AutomationRunner)
        .filter(
            models.AutomationRunner.organizacion_id == organizacion_id,
            models.AutomationRunner.activo.is_(True),
        )
    )
    await enforce_limit(db, "max_workers", int(count_result.scalar() or 0), tenant_id=str(organizacion_id))


from .test_run_creation import create_test_run

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
        ).with_for_update()
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
    ttl = max(2, min(int(payload.ttl_minutes or 120), 120))
    capabilities = schemas.redact_automation_capabilities(payload.capabilities or {})
    worker_instance_id = capabilities.get("worker_instance_id") if isinstance(capabilities, dict) else None
    # A worker may lose its local pending-request file during a recovery. Do
    # not leave several approval cards for the same installation behind.
    # New workers provide a stable instance id; the name fallback keeps the
    # behavior safe for legacy 1.0.2 workers until they receive 1.0.3.
    pending_result = await db.execute(
        select(models.AutomationRunnerPairingRequest).filter(
            models.AutomationRunnerPairingRequest.organizacion_id == payload.organizacion_id,
            models.AutomationRunnerPairingRequest.estado == "PENDING",
        ).order_by(models.AutomationRunnerPairingRequest.fecha_creacion.desc())
    )
    for existing in pending_result.scalars().all():
        existing_capabilities = existing.capabilities or {}
        existing_instance_id = existing_capabilities.get("worker_instance_id") if isinstance(existing_capabilities, dict) else None
        same_worker = bool(worker_instance_id and existing_instance_id == worker_instance_id)
        legacy_same_worker = not worker_instance_id and not existing_instance_id and existing.nombre == (payload.nombre or "Local Playwright Worker")
        if same_worker or legacy_same_worker:
            existing.estado = "EXPIRED"
    code = await _generate_pairing_code(db)
    pairing_token = f"qpair_{secrets.token_urlsafe(32)}"
    request = models.AutomationRunnerPairingRequest(
        code=code,
        pairing_token_hash=_hash_token(pairing_token),
        nombre=payload.nombre or "Local Playwright Worker",
        organizacion_id=payload.organizacion_id,
        tipo=payload.tipo or "LOCAL",
        capabilities=capabilities,
        estado="PENDING",
        expires_at=utc_now() + timedelta(minutes=ttl),
    )
    db.add(request)
    await db.commit()
    await db.refresh(request)
    return request, pairing_token

async def get_pending_automation_runner_pairing_requests(db: AsyncSession, organization_ids=None):
    query = (
        select(models.AutomationRunnerPairingRequest)
        .join(models.Organizacion, models.Organizacion.id == models.AutomationRunnerPairingRequest.organizacion_id)
        .filter(models.AutomationRunnerPairingRequest.estado == "PENDING")
        .filter(models.Organizacion.activo.is_(True))
        .order_by(models.AutomationRunnerPairingRequest.fecha_creacion.desc())
    )
    if organization_ids is not None:
        query = query.filter(models.AutomationRunnerPairingRequest.organizacion_id.in_(organization_ids))
    result = await db.execute(query)
    requests = result.scalars().all()
    changed = False
    approved_result = await db.execute(
        select(models.AutomationRunnerPairingRequest).filter(
            models.AutomationRunnerPairingRequest.estado == "APPROVED",
            models.AutomationRunnerPairingRequest.runner_token.is_not(None),
            *(
                [models.AutomationRunnerPairingRequest.organizacion_id.in_(organization_ids)]
                if organization_ids is not None
                else []
            ),
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
    visible = []
    seen_identities = set()
    for request in requests:
        if request.estado != "PENDING" or _is_expired(request.expires_at):
            continue
        capabilities = request.capabilities or {}
        identity = capabilities.get("worker_instance_id") if isinstance(capabilities, dict) else None
        if not identity:
            # Legacy 1.0.2 requests did not publish an instance id. Collapse
            # duplicate cards from the same legacy worker while it migrates.
            identity = f"legacy:{request.organizacion_id}:{request.nombre}"
        if identity:
            if identity in seen_identities:
                request.estado = "EXPIRED"
                changed = True
                continue
            seen_identities.add(identity)
        visible.append(request)
    if changed:
        await db.commit()
    return visible

async def poll_automation_runner_pairing_request(db: AsyncSession, code: str, pairing_token: str):
    result = await db.execute(
        select(models.AutomationRunnerPairingRequest).filter(
            models.AutomationRunnerPairingRequest.code == code.upper()
        ).with_for_update()
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
        ).with_for_update()
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
    raw_token = f"qar_{secrets.token_urlsafe(32)}"
    now = utc_now()
    capabilities = schemas.redact_automation_capabilities(request.capabilities or {})
    worker_instance_id = str(capabilities.get("worker_instance_id") or "").strip()

    # A revoked Worker returns through pairing with the same persistent
    # worker_instance_id. Reuse its row so update status, job ownership and
    # operational history remain attached to that installation; only rotate
    # the credential. Legacy Workers without a stable id still get a new row.
    runner = None
    if worker_instance_id:
        existing_result = await db.execute(
            select(models.AutomationRunner)
            .filter(models.AutomationRunner.organizacion_id == request.organizacion_id)
            .order_by(models.AutomationRunner.fecha_creacion.desc())
            .with_for_update()
        )
        matches = [
            candidate for candidate in existing_result.scalars().all()
            if str((candidate.capabilities or {}).get("worker_instance_id") or "").strip() == worker_instance_id
        ]
        if len(matches) > 1:
            raise ValueError("Hay varias identidades revocadas para este Worker; requiere resolucion administrativa")
        if matches:
            runner = matches[0]
            if runner.activo:
                raise ValueError(
                    "La identidad de este Worker ya esta vinculada a un runner activo; "
                    "revoca el registro anterior o usa un almacenamiento persistente distinto"
                )

    if runner is None:
        await _enforce_worker_limit_for_solution(db, request.organizacion_id)
        runner = models.AutomationRunner(
            nombre=request.nombre,
            organizacion_id=request.organizacion_id,
            tipo=request.tipo or "LOCAL",
            token_hash=_hash_token(raw_token),
            capabilities=capabilities,
            estado="ONLINE",
            ultimo_heartbeat=now,
        )
        db.add(runner)
    else:
        runner.nombre = request.nombre
        runner.tipo = request.tipo or "LOCAL"
        runner.token_hash = _hash_token(raw_token)
        runner.capabilities = capabilities
        runner.estado = "ONLINE"
        runner.activo = True
        runner.ultimo_heartbeat = now
        # Count after reactivation so the returning installation consumes a
        # slot just like a newly paired Worker.
        await _enforce_worker_limit_for_solution(db, request.organizacion_id)
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
        ).with_for_update()
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

async def get_automation_runners(db: AsyncSession, organization_ids=None):
    query = (
        select(models.AutomationRunner)
        .join(models.Organizacion, models.Organizacion.id == models.AutomationRunner.organizacion_id)
        .filter(
            models.Organizacion.activo.is_(True),
            models.AutomationRunner.activo.is_(True),
        )
        .order_by(models.AutomationRunner.fecha_creacion.desc())
    )
    if organization_ids is not None:
        query = query.filter(models.AutomationRunner.organizacion_id.in_(organization_ids))
    result = await db.execute(query)
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
    now = utc_now()
    if payload.current_job_id is not None:
        job = await db.get(models.AutomationJob, payload.current_job_id, with_for_update=True)
        if not job:
            raise ValueError("El job informado por el heartbeat no existe")
        if job.organizacion_id != runner.organizacion_id or job.runner_id != runner.id:
            raise ValueError("El runner no es propietario del job informado por el heartbeat")
        if job.estado not in {models.AutomationJobStatus.CLAIMED, models.AutomationJobStatus.RUNNING}:
            raise ValueError("El job informado por el heartbeat ya no está activo")
        if not payload.lease_token or payload.lease_token != job.lease_token:
            raise ValueError("El lease del job informado por el heartbeat no es válido")
        await validate_worker_job_scope(db, job)
        # Expiration makes the row eligible for recovery; it does not revoke
        # the current owner by itself.  The row lock serializes this renewal
        # with recovery: whichever transaction wins keeps or replaces the
        # owner/token, and the loser validates that authoritative state.
        job.lease_expires_at = now + timedelta(seconds=max(60, int(job.timeout_seconds or 300)))
        if job.estado == models.AutomationJobStatus.CLAIMED:
            job.estado = models.AutomationJobStatus.RUNNING
            job.fecha_inicio = job.fecha_inicio or now
    elif payload.lease_token is not None:
        raise ValueError("No se puede renovar un lease sin indicar current_job_id")
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
    runner.ultimo_heartbeat = now
    await db.commit()
    await db.refresh(runner)
    return runner

async def acquire_automation_runner_update_lock(db: AsyncSession, runner_id: UUID, lock_token: str):
    """Fence new claims for one runner and refuse a lock while a job is active.

    The row lock is shared with the claim path, so either an in-flight claim
    commits first and is observed here, or this lock commits first and the
    claim is rejected. The token makes acquisition resumable after a host
    process restart without allowing another runner identity to release it.
    """
    if not isinstance(lock_token, str) or len(lock_token) < 32 or len(lock_token) > 256:
        raise ValueError("worker_update_lock_token_invalid")
    result = await db.execute(
        select(models.AutomationRunner).filter(models.AutomationRunner.id == runner_id).with_for_update()
    )
    runner = result.scalar_one_or_none()
    if runner is None or runner.activo is not True:
        await db.rollback()
        raise ValueError("worker_unavailable")
    token_hash = hashlib.sha256(lock_token.encode("utf-8")).hexdigest()
    current_hash = runner.update_lock_token_hash
    if current_hash:
        if secrets.compare_digest(current_hash, token_hash):
            return runner, False
        await db.rollback()
        raise ValueError("worker_update_already_locked")
    active = await db.execute(
        select(models.AutomationJob.id).filter(
            models.AutomationJob.runner_id == runner.id,
            models.AutomationJob.estado.in_([
                models.AutomationJobStatus.CLAIMED,
                models.AutomationJobStatus.RUNNING,
            ]),
        ).limit(1)
    )
    if active.scalar_one_or_none() is not None:
        await db.rollback()
        raise ValueError("worker_update_busy")
    runner.update_lock_token_hash = token_hash
    runner.update_lock_acquired_at = utc_now()
    await db.commit()
    await db.refresh(runner)
    return runner, True

async def release_automation_runner_update_lock(db: AsyncSession, runner_id: UUID, lock_token: str):
    if not isinstance(lock_token, str) or len(lock_token) < 32 or len(lock_token) > 256:
        raise ValueError("worker_update_lock_token_invalid")
    result = await db.execute(
        select(models.AutomationRunner).filter(models.AutomationRunner.id == runner_id).with_for_update()
    )
    runner = result.scalar_one_or_none()
    if runner is None:
        await db.rollback()
        raise ValueError("worker_unavailable")
    token_hash = hashlib.sha256(lock_token.encode("utf-8")).hexdigest()
    if not runner.update_lock_token_hash:
        return runner, False
    if not secrets.compare_digest(runner.update_lock_token_hash, token_hash):
        await db.rollback()
        raise ValueError("worker_update_lock_token_mismatch")
    runner.update_lock_token_hash = None
    runner.update_lock_acquired_at = None
    await db.commit()
    await db.refresh(runner)
    return runner, True

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
