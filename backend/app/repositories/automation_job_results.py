from .repository_context import *
from ..evidence_url_security import sanitize_evidence_url
import copy
import hashlib
import json
import math

from ..services.api_evidence_policy import public_test_data_evidence_enabled
from ..services.api_test_runner import sanitize_api_config
from ..services.api_dynamic_variables import DynamicVariableContext, safe_dynamic_values
from .api_automation_jobs import decrypt_api_worker_payload


def _api_execution_status(result_status: str) -> models.EstadoResultado:
    return {
        "PASSED": models.EstadoResultado.PASO,
        "PASSED_WITH_WARNINGS": models.EstadoResultado.PASO,
        "FAILED": models.EstadoResultado.FALLO,
        "BLOCKED": models.EstadoResultado.BLOQUEADO,
        "TIMEOUT": models.EstadoResultado.FALLO,
        "ERROR": models.EstadoResultado.FALLO,
    }[result_status]


def _api_job_status(results: list[dict[str, Any]]) -> models.AutomationJobStatus:
    # This ranking is part of the worker contract.  In particular,
    # BLOCKED outranks FAILED, and TIMEOUT is a terminal job state of its own.
    rank = {"PASSED": 0, "PASSED_WITH_WARNINGS": 1, "FAILED": 2, "BLOCKED": 3, "TIMEOUT": 4, "ERROR": 5}
    worst = max((str(item.get("status") or "").upper() for item in results), key=lambda value: rank.get(value, -1), default="PASSED")
    return models.AutomationJobStatus.PASSED if worst == "PASSED_WITH_WARNINGS" else models.AutomationJobStatus(worst)


def _api_state_updates(result: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Read clear state from the worker-only channel, never evidence fields.

    ``api_variables`` and ``persistent_variables`` are evidence-facing and
    may already contain redaction markers.  They must never drive shared or
    persistent state because that would corrupt the next case.
    """
    state = result.get("state_updates") or {}
    if not isinstance(state, dict):
        raise ValueError("El canal state_updates del resultado API no es válido")
    shared = state.get("shared_variables") or {}
    persistent = state.get("persistent_variables") or {}
    if not isinstance(shared, dict) or not isinstance(persistent, dict):
        raise ValueError("El canal state_updates del resultado API no es válido")
    for values in (shared, persistent):
        for key, value in values.items():
            if not str(key).startswith("api."):
                raise ValueError("El estado API solo admite variables con prefijo api.")
            if value == "[REDACTED]" or value == "[redacted]":
                raise ValueError("El canal state_updates no puede contener valores redactados")
    return copy.deepcopy(shared), copy.deepcopy(persistent)


def _validate_api_worker_result_for_persistence(
    result: dict[str, Any],
    state_updates: dict[str, Any],
) -> None:
    """Reject shapes that could fail halfway through the persistence loop."""
    duration = result.get("duration_ms", 0)
    if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(float(duration)) or duration < 0:
        raise ValueError("La duración del resultado API no es válida")
    steps = result.get("steps") or []
    if not isinstance(steps, list):
        raise ValueError("Los pasos del resultado API no son válidos")
    seen_numbers: set[int] = set()
    for position, step in enumerate(steps, start=1):
        if not isinstance(step, dict):
            raise ValueError("Un paso del resultado API no es un objeto")
        raw_number = step.get("index") or step.get("number") or position
        if isinstance(raw_number, bool) or not isinstance(raw_number, int) or not 1 <= raw_number <= 1000:
            raise ValueError("El número de paso del resultado API no es válido")
        if raw_number in seen_numbers:
            raise ValueError("El resultado API contiene pasos duplicados")
        seen_numbers.add(raw_number)
        if "request" in step and not isinstance(step.get("request"), dict):
            raise ValueError("La solicitud de un paso API no es válida")

    # Validate every state channel before changing any ORM object.  This also
    # prevents a later malformed case from leaving in-memory partial writes.
    _api_state_updates({"state_updates": state_updates})


def _dynamic_values_for_evidence(
    frozen_case: dict[str, Any],
    execution: models.EjecucionCaso,
    *,
    public_evidence: bool,
) -> dict[str, Any]:
    values = frozen_case.get("dynamic_values") or {}
    if not isinstance(values, dict):
        raise ValueError("El mapa dynamic_values del caso API no es válido")
    context = DynamicVariableContext(getattr(execution, "dynamic_seed", None))
    context.values = copy.deepcopy(values)
    return copy.deepcopy(values) if public_evidence else safe_dynamic_values(context)


def _api_result_for_storage(result: dict[str, Any], *, redact: bool) -> dict[str, Any]:
    if not redact:
        return copy.deepcopy(result)
    # Keep API evidence explicit and large-response capable.  The automation
    # serializer redacts sensitive keys/text without applying the small AI
    # report truncation policy to response bodies.
    return schemas.redact_automation_sensitive_value(copy.deepcopy(result))


async def _persist_api_state_from_worker(
    db: AsyncSession,
    *,
    project_id: UUID,
    environment_id: UUID,
    run: models.TestRun,
    case: models.CasoPrueba,
    user_id: UUID,
    values: dict[str, Any],
) -> None:
    for key, value in (values or {}).items():
        key = str(key)
        if not key.startswith("api."):
            raise ValueError("El Estado API solo admite variables con prefijo api.")
        row = (await db.execute(select(models.ApiPersistentState).where(
            models.ApiPersistentState.proyecto_id == project_id,
            models.ApiPersistentState.entorno_id == environment_id,
            models.ApiPersistentState.key == key,
        ).with_for_update())).scalar_one_or_none()
        if row:
            row.value = value
            row.version = int(row.version or 0) + 1
            row.last_run_id = run.id
            row.last_case_id = case.id
            row.updated_by = user_id
        else:
            db.add(models.ApiPersistentState(
                proyecto_id=project_id,
                entorno_id=environment_id,
                key=key,
                value=value,
                version=1,
                last_run_id=run.id,
                last_case_id=case.id,
                updated_by=user_id,
            ))


async def _complete_api_execution_job(
    db: AsyncSession,
    job: models.AutomationJob,
    payload: schemas.AutomationJobResult,
    now,
):
    frozen = decrypt_api_worker_payload(job)
    context = frozen.get("context") if isinstance(frozen.get("context"), dict) else {}
    if str(context.get("test_run_id")) != str(job.test_run_id):
        raise ValueError("El contexto del job API no coincide con el run")
    if str(context.get("build_id")) != str(job.build_id):
        raise ValueError("La build del job API no coincide con el run")
    frozen_cases = frozen.get("cases") or []
    if not isinstance(frozen_cases, list) or not frozen_cases or len(payload.api_results) != len(frozen_cases):
        raise ValueError("El worker no devolvió todos los resultados de la suite API")

    result_items = [
        {
            "case_id": str(item.case_id),
            "execution_id": str(item.execution_id),
            "result": item.result,
            "state_updates": item.state_updates,
        }
        for item in payload.api_results
    ]
    expected_pairs = [
        (str(item.get("case_id")), str(item.get("execution_id")))
        for item in frozen_cases
    ]
    received_pairs = [(item["case_id"], item["execution_id"]) for item in result_items]
    if (
        not all(item.get("case_id") and item.get("execution_id") for item in frozen_cases)
        or len(set(expected_pairs)) != len(expected_pairs)
        or received_pairs != expected_pairs
        or len(set(received_pairs)) != len(received_pairs)
    ):
        raise ValueError("La correlación caso/ejecución del resultado API no coincide con el job")

    aggregate_status = _api_job_status([item["result"] for item in result_items])
    if payload.status != aggregate_status:
        raise ValueError("El estado agregado del job API no coincide con sus resultados")
    for item in result_items:
        _validate_api_worker_result_for_persistence(item["result"], item["state_updates"])

    run = await db.get(models.TestRun, job.test_run_id)
    if not run:
        raise ValueError("Run no encontrado para el job API")
    environment_id = context.get("environment_id")
    environment = await db.get(models.Entorno, environment_id) if environment_id else None
    if (
        not environment
        or str(environment.proyecto_id) != str(run.proyecto_id)
        or str(context.get("project_id")) != str(run.proyecto_id)
        or str(context.get("environment_id")) != str(run.entorno_id)
    ):
        raise ValueError("El ambiente del job API no pertenece al proyecto")

    executions_result = await db.execute(
        select(models.EjecucionCaso).where(models.EjecucionCaso.test_run_id == run.id)
    )
    executions = {str(item.id): item for item in executions_result.scalars().all()}
    cases_result = await db.execute(
        select(models.CasoPrueba).where(models.CasoPrueba.id.in_([item["case_id"] for item in result_items]))
    )
    cases = {str(item.id): item for item in cases_result.scalars().all()}
    shared_variables = dict(frozen.get("shared_variables") or {})

    for frozen_case, result_item in zip(frozen_cases, result_items):
        case_id = result_item["case_id"]
        execution_id = result_item["execution_id"]
        execution = executions.get(execution_id)
        case = cases.get(case_id)
        if not execution or not case or str(execution.caso_id) != case_id:
            raise ValueError("El caso o ejecución API no pertenece al run del job")
        result = result_item["result"]
        result_status = str(result.get("status") or "").upper()
        final_status = _api_execution_status(result_status)
        shared_updates, persistent_updates = _api_state_updates(result_item)
        public_evidence = public_test_data_evidence_enabled(
            environment=environment,
            execution=execution,
            config=frozen_case.get("configuracion_api") or {},
            result=result,
        )
        dynamic_values = _dynamic_values_for_evidence(
            frozen_case,
            execution,
            public_evidence=public_evidence,
        )
        stored_result = _api_result_for_storage(result, redact=not public_evidence)
        # State is an execution channel, not user-visible evidence.  Keep the
        # result/report payload free of even redacted state-update structures.
        stored_result.pop("state_updates", None)
        dynamic_result = stored_result.get("dynamic_variables") if isinstance(stored_result.get("dynamic_variables"), dict) else {}
        stored_result["dynamic_variables"] = {
            **dynamic_result,
            "seed": execution.dynamic_seed,
            "values": dynamic_values,
        }
        definition = frozen_case.get("configuracion_api") or {}
        execution.api_config_snapshot = sanitize_api_config(definition, redact=not public_evidence)
        execution.api_resultado = stored_result
        execution.dynamic_variables = dynamic_values
        execution.estado_resultado = final_status
        execution.duracion_segundos = max(0, round(float(result.get("duration_ms") or 0) / 1000))
        execution.observaciones = result.get("observations") or result.get("message") or result_status
        execution.fecha_ejecucion = now

        if result_status in {"PASSED", "PASSED_WITH_WARNINGS"}:
            shared_variables.update(shared_updates)
            run.variables_resueltas = {**(run.variables_resueltas or {}), **shared_updates}
            await _persist_api_state_from_worker(
                db,
                project_id=run.proyecto_id,
                environment_id=environment.id,
                run=run,
                case=case,
                user_id=execution.ejecutado_por,
                values=persistent_updates,
            )
        case.ultimo_resultado = final_status.value
        case.ultima_ejecucion_por = execution.ejecutado_por
        case.ultima_ejecucion_fecha = now

        snapshots_result = await db.execute(
            select(models.SnapshotPaso)
            .where(models.SnapshotPaso.ejecucion_caso_id == execution.id)
            .order_by(models.SnapshotPaso.numero_paso)
        )
        snapshots = snapshots_result.scalars().all()
        snapshots_by_number = {item.numero_paso: item for item in snapshots}
        for position, step in enumerate(result.get("steps") or [], start=1):
            number = int(step.get("index") or step.get("number") or position)
            request = step.get("request") if isinstance(step.get("request"), dict) else {}
            step_status = str(step.get("status") or "").upper()
            snapshot = snapshots_by_number.get(number)
            if not snapshot:
                snapshot = models.SnapshotPaso(
                    ejecucion_caso_id=execution.id,
                    numero_paso=number,
                    accion_congelada=f"{request.get('method', 'GET')} {request.get('url', '')}".strip(),
                    resultado_esperado_congelado=json.dumps(step.get("assertions") or [], ensure_ascii=False, default=str),
                )
                db.add(snapshot)
                await db.flush()
                snapshots_by_number[number] = snapshot
            snapshot.accion_congelada = f"{request.get('method', 'GET')} {request.get('url', '')}".strip()
            snapshot.datos_congelados = json.dumps(request, ensure_ascii=False, default=str)
            snapshot.datos_resueltos = json.dumps(request, ensure_ascii=False, default=str)
            snapshot.resultado_esperado_congelado = json.dumps(step.get("assertions") or [], ensure_ascii=False, default=str)
            snapshot.estado_paso = _api_execution_status(step_status) if step_status in {"PASSED", "PASSED_WITH_WARNINGS", "FAILED", "BLOCKED", "TIMEOUT", "ERROR"} else final_status
            snapshot.comentarios = step.get("observations") or step_status
            snapshot.error_log = json.dumps(step.get("errors") or [], ensure_ascii=False, default=str) if step.get("errors") else None
        if not snapshots and not (result.get("steps") or []):
            db.add(models.SnapshotPaso(
                ejecucion_caso_id=execution.id,
                numero_paso=1,
                accion_congelada="Ejecución API",
                resultado_esperado_congelado="Resultado reportado por worker API",
                estado_paso=final_status,
                comentarios=execution.observaciones,
                error_log=json.dumps(result.get("errors") or [], ensure_ascii=False, default=str) if result.get("errors") else None,
            ))

    job.estado = aggregate_status
    job.logs = payload.logs
    job.error_message = payload.error_message
    job.metadata_resultado = {
        **(payload.metadata or {}),
        "api_execution": True,
        "api_result_count": len(result_items),
        "api_result_statuses": [item["result"].get("status") for item in result_items],
    }
    job.fecha_fin = now
    job.lease_token = None
    job.lease_expires_at = None
    run.estado_run = models.EstadoRun.CERRADO
    run.fecha_cierre = now
    if job.runner:
        job.runner.estado = "ONLINE"
        job.runner.ultimo_heartbeat = now
    await db.commit()
    await db.refresh(job)
    return job


def _automation_result_fingerprint(payload: schemas.AutomationJobResult) -> str:
    data = payload.model_dump(mode="json", exclude={"lease_token"})
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")).hexdigest()


async def complete_automation_job(
    db: AsyncSession,
    job: models.AutomationJob,
    payload: schemas.AutomationJobResult,
    *,
    runner: models.AutomationRunner | None = None,
):
    now = utc_now()
    fingerprint = _automation_result_fingerprint(payload)
    current = await db.get(models.AutomationJob, job.id, with_for_update=True)
    if not current:
        raise ValueError("Job no encontrado")
    if runner and current.organizacion_id != runner.organizacion_id:
        raise ValueError("El runner no tiene acceso a la solucion de este job")
    if runner and current.runner_id != runner.id:
        raise ValueError("Este job fue tomado por otro runner")

    # Delivery retries are safe only when they identify the exact same event
    # and payload.  This branch intentionally runs before lease validation so
    # a committed terminal result can be acknowledged after the lease is
    # cleared, while a different/old event is still rejected below.
    if current.estado not in {models.AutomationJobStatus.PENDING, models.AutomationJobStatus.CLAIMED, models.AutomationJobStatus.RUNNING}:
        if current.result_event_id == payload.result_event_id and current.result_fingerprint == fingerprint:
            return current
        raise ValueError("El job ya tiene un resultado distinto y no admite otra entrega")
    if not current.lease_token or payload.lease_token != current.lease_token:
        raise ValueError("El lease_token no es válido o ya fue reemplazado")
    # A nominally expired lease is still valid while this runner/token remains
    # the persisted owner. Recovery and completion lock the same row, so a
    # reassigned job is rejected by owner/token checks without discarding a
    # result merely because the backend was unavailable past the deadline.
    if not current.organizacion_id or not current.proyecto_id:
        raise ValueError("El job no tiene un alcance de solucion/proyecto válido")
    job = current
    job.result_event_id = payload.result_event_id
    job.result_fingerprint = fingerprint
    if (job.job_type or "EXECUTION") == "API_EXECUTION":
        if job.estado not in {models.AutomationJobStatus.CLAIMED, models.AutomationJobStatus.RUNNING}:
            raise ValueError("El job API ya está en estado terminal y no admite otro resultado")
        try:
            return await _complete_api_execution_job(db, job, payload, now)
        except Exception:
            await db.rollback()
            raise

    job.estado = payload.status
    job.logs = payload.logs
    job.error_message = payload.error_message
    metadata_resultado = dict(payload.metadata or {})
    if payload.steps:
        metadata_resultado["steps"] = [step.model_dump(mode="json") for step in payload.steps]
    if payload.observations:
        metadata_resultado["observations"] = payload.observations
    job.metadata_resultado = metadata_resultado
    job.fecha_fin = now

    if (job.job_type or "EXECUTION") == "DRY_RUN":
        persisted_artifacts = await _persist_automation_artifacts(db, job, payload.artifacts)
        if persisted_artifacts:
            metadata_resultado = {**metadata_resultado, "artifacts": persisted_artifacts}
            job.metadata_resultado = metadata_resultado
        if job.runner:
            job.runner.estado = "ONLINE"
            job.runner.ultimo_heartbeat = now
        job.lease_token = None
        job.lease_expires_at = None
        await db.commit()
        await db.refresh(job)
        return job

    execution_result = await db.execute(
        select(models.EjecucionCaso).filter(models.EjecucionCaso.id == job.ejecucion_id)
    )
    execution = execution_result.scalar_one_or_none()
    if not execution:
        raise ValueError("Ejecucion no encontrada para el job")
    run_result = await db.execute(select(models.TestRun).filter(models.TestRun.id == execution.test_run_id))
    run = run_result.scalar_one_or_none()
    if run and run.build_id:
        build = await db.get(models.Build, run.build_id)
        if not access_control.is_build_active(build):
            raise ValueError("La build está inactiva. No se pueden registrar resultados de automatización sobre una build cerrada.")

    status_map = {
        models.AutomationJobStatus.PASSED: models.EstadoResultado.PASO,
        models.AutomationJobStatus.FAILED: models.EstadoResultado.FALLO,
        models.AutomationJobStatus.BLOCKED: models.EstadoResultado.BLOQUEADO,
        models.AutomationJobStatus.ERROR: models.EstadoResultado.FALLO,
        models.AutomationJobStatus.TIMEOUT: models.EstadoResultado.FALLO,
        models.AutomationJobStatus.CANCELLED: models.EstadoResultado.BLOQUEADO,
    }
    final_status = status_map.get(payload.status)
    if final_status:
        execution.estado_resultado = final_status
        execution.duracion_segundos = max(0, payload.duration_seconds or 0)
        execution.observaciones = payload.observations or payload.error_message
        execution.fecha_ejecucion = now

        snapshots_result = await db.execute(
            select(models.SnapshotPaso)
            .filter(models.SnapshotPaso.ejecucion_caso_id == execution.id)
            .order_by(models.SnapshotPaso.numero_paso)
        )
        snapshots = snapshots_result.scalars().all()
        snapshots_by_number = {snapshot.numero_paso: snapshot for snapshot in snapshots}
        reported_numbers = set()
        for step in payload.steps:
            reported_numbers.add(step.number)
            snapshot = snapshots_by_number.get(step.number)
            if not snapshot:
                snapshot = models.SnapshotPaso(
                    ejecucion_caso_id=execution.id,
                    numero_paso=step.number,
                    accion_congelada=f"Paso automatizado {step.number}",
                    resultado_esperado_congelado="Reportado por worker automatizado",
                )
                db.add(snapshot)
                await db.flush()
                snapshots.append(snapshot)
                snapshots_by_number[snapshot.numero_paso] = snapshot
            snapshot.estado_paso = step.status
            snapshot.comentarios = step.observations
            snapshot.evidencia_url = sanitize_evidence_url(step.evidence_url)
            snapshot.error_log = step.error_log

        payload_evidence_url = sanitize_evidence_url(payload.evidence_url)
        if snapshots and not payload.steps:
            for index, snapshot in enumerate(snapshots):
                if final_status == models.EstadoResultado.PASO:
                    snapshot.estado_paso = models.EstadoResultado.PASO
                elif index == 0:
                    snapshot.estado_paso = final_status
                    snapshot.comentarios = payload.observations or payload.error_message
                    snapshot.evidencia_url = payload_evidence_url
                else:
                    snapshot.estado_paso = models.EstadoResultado.SIN_CORRER
        elif not snapshots and not payload.steps:
            snapshot = models.SnapshotPaso(
                ejecucion_caso_id=execution.id,
                numero_paso=0,
                accion_congelada="Ejecucion automatizada",
                resultado_esperado_congelado="Resultado reportado por worker automatizado",
                estado_paso=final_status,
                comentarios=payload.observations or payload.error_message,
                evidencia_url=payload_evidence_url,
                error_log=payload.error_message,
            )
            db.add(snapshot)
            await db.flush()
            snapshots.append(snapshot)
            snapshots_by_number[snapshot.numero_paso] = snapshot

        default_artifact_snapshot = next(
            (
                snapshot for snapshot in snapshots
                if snapshot.estado_paso in {models.EstadoResultado.FALLO, models.EstadoResultado.BLOQUEADO}
            ),
            snapshots[0] if snapshots else None,
        )
        persisted_artifacts = await _persist_automation_artifacts(
            db,
            job,
            payload.artifacts,
            snapshots_by_number=snapshots_by_number,
            default_snapshot=default_artifact_snapshot,
        )
        if persisted_artifacts:
            metadata_resultado = {**metadata_resultado, "artifacts": persisted_artifacts}
            job.metadata_resultado = metadata_resultado

        case_result = await db.execute(select(models.CasoPrueba).filter(models.CasoPrueba.id == execution.caso_id))
        case = case_result.scalar_one_or_none()
        if case:
            case.ultimo_resultado = final_status.value
            case.ultima_ejecucion_por = execution.ejecutado_por
            case.ultima_ejecucion_fecha = now

        pending_result = await db.execute(
            select(models.EjecucionCaso.id)
            .filter(
                models.EjecucionCaso.test_run_id == execution.test_run_id,
                models.EjecucionCaso.estado_resultado == models.EstadoResultado.SIN_CORRER,
            )
            .limit(1)
        )
        if run and pending_result.scalar_one_or_none() is None:
            run.estado_run = models.EstadoRun.CERRADO
            run.fecha_cierre = now

    if job.runner:
        job.runner.estado = "ONLINE"
        job.runner.ultimo_heartbeat = now
    job.lease_token = None
    job.lease_expires_at = None

    await db.commit()
    await db.refresh(job)
    return job
