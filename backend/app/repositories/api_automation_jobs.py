from .repository_context import *
from .automation_preparation import _find_compatible_runner_for_job
import copy

from ..services.edition.usage_limits import enforce_weekly_automated_execution_limit
from ..services.secret_crypto import encrypt_secret_value, decrypt_secret_value
from ..services.api_dynamic_variables import DynamicVariableContext, extract_dynamic_variable_names


API_WORKER_JOB_SCHEMA = "treseko.api-worker-job/v1"
API_WORKER_PAYLOAD_SECRET_KEY = "payload_secret"


def _api_worker_payload_envelope(payload: dict[str, Any]) -> dict[str, Any]:
    """Keep only safe routing metadata and an encrypted execution payload."""
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return {
        "schema_version": API_WORKER_JOB_SCHEMA,
        "job_type": "API_EXECUTION",
        "test_run_id": payload["context"]["test_run_id"],
        "project_id": payload["context"]["project_id"],
        "build_id": payload["context"].get("build_id"),
        "environment_id": payload["context"].get("environment_id"),
        "case_count": len(payload.get("cases") or []),
        "case_ids": [item["case_id"] for item in payload.get("cases") or []],
        "case_codes": [item.get("code") for item in payload.get("cases") or []],
        # Original data is encrypted at rest; authenticated job views and
        # worker claims decode it without changing business values.
        API_WORKER_PAYLOAD_SECRET_KEY: encrypt_secret_value(encoded),
    }


def decrypt_api_worker_payload(job: models.AutomationJob) -> dict[str, Any]:
    envelope = job.payload_congelado if isinstance(job.payload_congelado, dict) else {}
    ciphertext = envelope.get(API_WORKER_PAYLOAD_SECRET_KEY)
    if not isinstance(ciphertext, str) or not ciphertext:
        raise ValueError("El job API no tiene un payload cifrado válido")
    try:
        payload = json.loads(decrypt_secret_value(ciphertext))
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ValueError("El payload cifrado del job API no es válido") from exc
    if not isinstance(payload, dict) or payload.get("schema_version") != API_WORKER_JOB_SCHEMA:
        raise ValueError("El payload del worker API no usa un contrato compatible")
    return payload


async def create_api_automation_job_for_suite(
    db: AsyncSession,
    *,
    run: models.TestRun,
    case_ids: list[UUID],
    cases_by_id: dict[UUID, models.CasoPrueba],
    environment: models.Entorno,
    shared_variables: dict[str, Any],
    user_id: UUID,
    timeout_seconds: int = 300,
):
    """Freeze one ordered API suite for the existing Automation Worker.

    The database stores a non-sensitive routing summary plus a Fernet payload.
    Only the authenticated claim route decrypts it. Keeping the suite in one
    job is important: API variables and persistent state are order-dependent.
    """
    if not case_ids:
        raise ValueError("La suite API no tiene casos seleccionados")
    if str(run.origen or "").upper() != "AUTOMATIZADA":
        raise ValueError("El job API del worker requiere origen AUTOMATIZADA")

    existing_result = await db.execute(
        select(models.AutomationJob)
        .filter(
            models.AutomationJob.test_run_id == run.id,
            models.AutomationJob.job_type == "API_EXECUTION",
            models.AutomationJob.estado.in_([
                models.AutomationJobStatus.PENDING,
                models.AutomationJobStatus.CLAIMED,
                models.AutomationJobStatus.RUNNING,
            ]),
        )
        .order_by(models.AutomationJob.fecha_creacion.desc())
    )
    existing = existing_result.scalars().first()
    if existing:
        return existing

    organization_id = (await db.execute(
        select(models.Proyecto.organizacion_id).where(models.Proyecto.id == run.proyecto_id)
    )).scalar_one_or_none()
    if not organization_id:
        raise ValueError("El proyecto no tiene una solucion/organizacion valida")
    await enforce_weekly_automated_execution_limit(db, solution_id=organization_id)

    execution_result = await db.execute(
        select(models.EjecucionCaso).filter(models.EjecucionCaso.test_run_id == run.id)
    )
    executions_by_case = {item.caso_id: item for item in execution_result.scalars().all()}
    missing = [case_id for case_id in case_ids if case_id not in executions_by_case]
    if missing:
        raise ValueError("El run API no contiene todas las ejecuciones de la suite")
    if any(case_id not in cases_by_id for case_id in case_ids):
        raise ValueError("El run API no contiene todos los casos seleccionados")

    ordered_cases = []
    for case_id in case_ids:
        case = cases_by_id[case_id]
        execution = executions_by_case[case_id]
        execution.execution_mode = models.ExecutionMode.AUTOMATIZADA
        definition = copy.deepcopy(case.configuracion_api or {})
        dynamic_context = DynamicVariableContext(execution.dynamic_seed)
        for dynamic_name in extract_dynamic_variable_names(definition):
            dynamic_context.ensure(dynamic_name)
        case_dataset = copy.deepcopy((run.datasets_resueltos or {}).get(str(case.id), []))
        case_dataset_variables = {
            str(item.get("key")): item.get("value")
            for item in case_dataset
            if isinstance(item, dict) and item.get("key") is not None
        }
        ordered_cases.append({
            "case_id": str(case.id),
            "execution_id": str(execution.id),
            "code": case.codigo,
            "title": case.titulo,
            "configuracion_api": definition,
            "dynamic_seed": execution.dynamic_seed,
            # ``dataset`` is retained for older workers.  New API workers use
            # the explicit map so case-specific values cannot be lost.
            "dataset": case_dataset,
            "dataset_variables": case_dataset_variables,
            # The map is encrypted at rest and is intentionally separate from
            # evidence.  It is the compatibility bridge for Python's seeded
            # dynamic-variable generator; a worker must consume it instead of
            # regenerating values from the seed.
            "dynamic_values": copy.deepcopy(dynamic_context.values),
        })

    full_payload = {
        "schema_version": API_WORKER_JOB_SCHEMA,
        "job_type": "API_EXECUTION",
        "context": {
            "project_id": str(run.proyecto_id),
            "test_run_id": str(run.id),
            "build_id": str(run.build_id) if run.build_id else None,
            "environment_id": str(environment.id),
            "dataset_id": str(run.dataset_id) if run.dataset_id else None,
            "created_by": str(user_id),
        },
        "environment": {
            "id": str(environment.id),
            "name": environment.nombre,
            "url": environment.url,
            "variables": copy.deepcopy(environment.variables or {}),
            "configuracion_api": copy.deepcopy(environment.configuracion_api or {}),
        },
        # Keep this top-level name as the worker contract.  Case maps above
        # override it when a case has its own dataset resolution.
        "dataset_variables": copy.deepcopy(run.variables_resueltas or {}),
        "dataset": {
            "id": str(run.dataset_id) if run.dataset_id else None,
            "variables": copy.deepcopy(run.variables_resueltas or {}),
            "shared_variables": copy.deepcopy(shared_variables or {}),
            "cases": copy.deepcopy(run.datasets_resueltos or {}),
        },
        "shared_variables": copy.deepcopy(shared_variables or {}),
        "cases": ordered_cases,
    }
    job = models.AutomationJob(
        job_type="API_EXECUTION",
        organizacion_id=organization_id,
        proyecto_id=run.proyecto_id,
        test_run_id=run.id,
        build_id=run.build_id,
        required_framework="treseko-api",
        required_language="declarative",
        required_runtime=None,
        timeout_seconds=max(10, min(int(timeout_seconds or 300), 1800)),
        payload_congelado=_api_worker_payload_envelope(full_payload),
        creado_por=user_id,
    )
    db.add(job)
    await db.flush()
    compatible_runner = await _find_compatible_runner_for_job(db, job)
    if not compatible_runner:
        job.estado = models.AutomationJobStatus.PENDING
        job.metadata_resultado = {'waiting_for_runner': True}
    run.estado_run = models.EstadoRun.EN_PROGRESO
    await db.commit()
    await db.refresh(job)
    return job
