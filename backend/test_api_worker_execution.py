from __future__ import annotations

import asyncio
import copy
import json
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app import models, schemas
from app.api.routers import automation as automation_router
from app.repositories import api_automation_jobs, automation_job_results
from app.repositories.automation_preparation import _runner_supports_job


LEASE_TOKEN = "lease-" + ("x" * 48)


def _delivery_fields() -> dict:
    return {"lease_token": LEASE_TOKEN, "result_event_id": str(uuid4())}


def _api_result(status: str = "PASSED") -> dict:
    return {
        "schema_version": "treseko.api-result/v1",
        "status": status,
        "duration_ms": 125,
        "observations": "worker result",
        "steps": [{
            "index": 1,
            "status": status,
            "request": {"method": "GET", "url": "https://api.example.test/health"},
            "assertions": [{"name": "HTTP 200", "status": "PASSED"}],
            "response": {"status": 200, "body": {"ok": True}},
        }],
        "api_variables": {"api.customer_id": "42"},
        "persistent_variables": {},
        "dynamic_variables": {"values": {"$uuid": "fixture-uuid"}},
    }


def test_api_result_preserves_large_complete_evidence():
    case_id, execution_id = uuid4(), uuid4()
    valid = schemas.AutomationJobResult(
        **_delivery_fields(),
        status=models.AutomationJobStatus.PASSED,
        metadata={"worker": "api"},
        api_results=[{
            "case_id": case_id,
            "execution_id": execution_id,
            "result": {
                "schema_version": "treseko.api-result/v1",
                "status": "PASSED",
                "steps": [{"index": 1, "response": {"body": "x" * (2 * 1024 * 1024)}}],
            },
        }],
    )
    assert valid.api_results[0].result["steps"][0]["response"]["body"]

    oversized = [{
        "case_id": uuid4(),
        "execution_id": uuid4(),
        "result": {
            "schema_version": "treseko.api-result/v1",
            "status": "PASSED",
            "steps": [{"index": 1, "response": {"body": "x" * (2 * 1024 * 1024)}}],
        },
    } for _ in range(9)]
    preserved=schemas.AutomationJobResult(**_delivery_fields(), status=models.AutomationJobStatus.PASSED, api_results=oversized)
    assert len(preserved.api_results)==9
    assert all(len(item.result["steps"][0]["response"]["body"])==2*1024*1024 for item in preserved.api_results)


def test_api_job_envelope_encrypts_full_payload_and_normal_serializer_redacts_ciphertext():
    payload = {
        "schema_version": api_automation_jobs.API_WORKER_JOB_SCHEMA,
        "job_type": "API_EXECUTION",
        "context": {"test_run_id": str(uuid4()), "project_id": str(uuid4())},
        "cases": [{"case_id": str(uuid4()), "configuracion_api": {"token": "secret-value"}}],
    }
    envelope = api_automation_jobs._api_worker_payload_envelope(payload)
    job = SimpleNamespace(payload_congelado=envelope)

    assert envelope[api_automation_jobs.API_WORKER_PAYLOAD_SECRET_KEY] != json.dumps(payload, sort_keys=True)
    assert api_automation_jobs.decrypt_api_worker_payload(job) == payload
    visible = schemas.AutomationJob.model_validate({
        "id": uuid4(),
        "estado": models.AutomationJobStatus.PENDING,
        "required_framework": "treseko-api",
        "required_language": "declarative",
        "timeout_seconds": 300,
        "payload_congelado": envelope,
    }).model_dump()
    assert visible["payload_congelado"] == payload


def test_api_worker_capability_is_opt_in_and_legacy_worker_does_not_match():
    job = SimpleNamespace(
        required_framework="treseko-api",
        required_language="declarative",
        required_runtime=None,
        payload_congelado={"language": "declarative"},
    )
    legacy = SimpleNamespace(capabilities={"frameworks": ["playwright"], "framework_languages": {"playwright": ["javascript"]}})
    api_worker = SimpleNamespace(capabilities={"frameworks": ["treseko-api"], "framework_languages": {"treseko-api": ["declarative"]}})
    assert _runner_supports_job(legacy, job) is False
    assert _runner_supports_job(api_worker, job) is True


@pytest.mark.parametrize(
    ("statuses", "expected"),
    [
        (["PASSED", "PASSED_WITH_WARNINGS"], models.AutomationJobStatus.PASSED),
        (["FAILED", "BLOCKED"], models.AutomationJobStatus.BLOCKED),
        (["BLOCKED", "TIMEOUT"], models.AutomationJobStatus.TIMEOUT),
        (["TIMEOUT", "ERROR"], models.AutomationJobStatus.ERROR),
    ],
)
def test_api_aggregate_status_matches_worker_ranking(statuses, expected):
    assert automation_job_results._api_job_status([{"status": value} for value in statuses]) == expected


def test_api_result_accepts_timeout_and_rejects_state_outside_api_scope():
    timeout = schemas.AutomationJobResult(
        **_delivery_fields(),
        status=models.AutomationJobStatus.TIMEOUT,
        api_results=[{
            "case_id": uuid4(), "execution_id": uuid4(),
            "result": _api_result("TIMEOUT"), "state_updates": {},
        }],
    )
    assert timeout.api_results[0].result["status"] == "TIMEOUT"
    with pytest.raises(ValidationError, match="prefijo api"):
        schemas.AutomationJobResult(
            **_delivery_fields(),
            status=models.AutomationJobStatus.PASSED,
            api_results=[{
                "case_id": uuid4(), "execution_id": uuid4(),
                "result": _api_result(),
                "state_updates": {"shared_variables": {"token": "secret"}},
            }],
        )
    original = schemas.AutomationJobResult(
        **_delivery_fields(), status=models.AutomationJobStatus.PASSED,
        api_results=[{"case_id":uuid4(), "execution_id":uuid4(), "result":_api_result(),
        "state_updates":{"shared_variables":{"api.token":{"value":"[REDACTED]"}}}}])
    assert original.api_results[0].state_updates["shared_variables"]["api.token"]["value"] == "[REDACTED]"


class _FakeScalars:
    def __init__(self, values):
        self.values = values

    def all(self):
        return list(self.values)

    def first(self):
        return self.values[0] if self.values else None


class _FakeResult:
    def __init__(self, values):
        self.values = values

    def scalars(self):
        return _FakeScalars(self.values)

    def scalar_one_or_none(self):
        return self.values[0] if self.values else None


class _FakeDb:
    def __init__(self, run, environment, executions, cases, organization_id=None):
        self.run = run
        self.environment = environment
        self.executions = executions
        self.cases = cases
        self.organization_id = organization_id or uuid4()
        self.added = []

    async def get(self, model, identifier, **_kwargs):
        if model is models.AutomationJob:
            return getattr(self, "job", None)
        if model is models.TestRun:
            return self.run
        if model is models.Entorno:
            return self.environment
        return None

    async def execute(self, statement):
        entity = getattr(statement, "column_descriptions", [{}])[0].get("entity")
        if entity is models.EjecucionCaso:
            return _FakeResult(self.executions)
        if entity is models.CasoPrueba:
            return _FakeResult(self.cases)
        if entity is models.Proyecto:
            return _FakeResult([self.organization_id])
        return _FakeResult([])

    def add(self, value):
        self.added.append(value)

    async def flush(self):
        for item in self.added:
            if isinstance(item, models.SnapshotPaso) and item.id is None:
                item.id = uuid4()

    async def commit(self):
        return None

    async def rollback(self):
        return None

    async def refresh(self, value):
        return None


@pytest.mark.asyncio
async def test_api_worker_result_persists_evidence_variables_snapshot_and_closes_run():
    project_id, run_id, environment_id = uuid4(), uuid4(), uuid4()
    case_id, execution_id = uuid4(), uuid4()
    user_id = uuid4()
    run = SimpleNamespace(
        id=run_id,
        proyecto_id=project_id,
        build_id=uuid4(),
        entorno_id=environment_id,
        estado_run=models.EstadoRun.EN_PROGRESO,
        fecha_cierre=None,
        variables_resueltas={},
    )
    environment = SimpleNamespace(id=environment_id, proyecto_id=project_id, nombre="QA", url="https://api.example.test")
    case = SimpleNamespace(id=case_id, proyecto_id=project_id, codigo="API-001", titulo="Health", configuracion_api={"request": {"method": "GET"}})
    execution = SimpleNamespace(
        id=execution_id,
        caso_id=case_id,
        test_run_id=run_id,
        ejecutado_por=user_id,
        evidence_policy={"public_test_data": True},
        api_config_snapshot={},
        api_resultado={},
            dynamic_variables={},
            dynamic_seed="seed",
        estado_resultado=models.EstadoResultado.SIN_CORRER,
        duracion_segundos=0,
        observaciones=None,
        fecha_ejecucion=None,
    )
    full_payload = {
        "schema_version": api_automation_jobs.API_WORKER_JOB_SCHEMA,
        "job_type": "API_EXECUTION",
        "context": {
            "project_id": str(project_id), "test_run_id": str(run_id),
            "build_id": str(run.build_id), "environment_id": str(environment_id),
        },
        "shared_variables": {},
        "cases": [{
            "case_id": str(case_id), "execution_id": str(execution_id),
            "code": "API-001", "title": "Health",
            "configuracion_api": {"request": {"url": "{{$uuid}}"}}, "dynamic_seed": "seed",
            "dynamic_values": {"$uuid": "fixture-uuid"},
        }],
    }
    job = SimpleNamespace(
        id=uuid4(), job_type="API_EXECUTION", test_run_id=run_id,
        build_id=run.build_id, runner=None, runner_id=uuid4(),
        organizacion_id=uuid4(), proyecto_id=project_id,
        payload_congelado=api_automation_jobs._api_worker_payload_envelope(full_payload),
        estado=models.AutomationJobStatus.CLAIMED,
        logs=None, error_message=None, metadata_resultado={}, fecha_fin=None,
        lease_token=LEASE_TOKEN, lease_expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        result_event_id=None, result_fingerprint=None,
    )
    db = _FakeDb(run, environment, [execution], [case])
    db.job = job
    payload = schemas.AutomationJobResult(
        **_delivery_fields(),
        status=models.AutomationJobStatus.PASSED,
        api_results=[{
            "case_id": case_id,
            "execution_id": execution_id,
            "result": _api_result(),
            "state_updates": {
                "shared_variables": {"api.customer_id": "42"},
                "persistent_variables": {},
            },
        }],
    )

    await automation_job_results.complete_automation_job(db, job, payload)

    assert execution.estado_resultado == models.EstadoResultado.PASO
    assert execution.api_resultado["schema_version"] == "treseko.api-result/v1"
    assert execution.dynamic_variables == {"$uuid": "fixture-uuid"}
    assert run.estado_run == models.EstadoRun.CERRADO
    assert job.estado == models.AutomationJobStatus.PASSED
    assert run.variables_resueltas == {"api.customer_id": "42"}
    assert "state_updates" not in execution.api_resultado
    assert any(isinstance(item, models.SnapshotPaso) for item in db.added)


@pytest.mark.asyncio
async def test_api_automation_job_enforces_automated_quota_for_project_organization(monkeypatch):
    project_id, organization_id, run_id, environment_id = uuid4(), uuid4(), uuid4(), uuid4()
    case_id, execution_id = uuid4(), uuid4()
    user_id = uuid4()
    run = SimpleNamespace(
        id=run_id, proyecto_id=project_id, build_id=uuid4(), entorno_id=environment_id,
        dataset_id=None, origen="AUTOMATIZADA", variables_resueltas={"base_url": "https://api.example.test"},
        datasets_resueltos={str(case_id): [{"key": "customer_id", "value": "42"}]},
    )
    environment = SimpleNamespace(id=environment_id, proyecto_id=project_id, nombre="QA", url="https://api.example.test", variables={}, configuracion_api={})
    case = SimpleNamespace(id=case_id, codigo="API-QUOTA", titulo="Quota", configuracion_api={"request": {"method": "GET", "url": "/{{$uuid}}"}})
    execution = SimpleNamespace(id=execution_id, caso_id=case_id, dynamic_seed="case-seed", execution_mode=None)
    db = _FakeDb(run, environment, [execution], [case], organization_id=organization_id)
    calls = []

    async def fake_quota(_db, *, solution_id, increment=1):
        calls.append((solution_id, increment))

    async def fake_compatible(_db, _job):
        return SimpleNamespace(id=uuid4())

    monkeypatch.setattr(api_automation_jobs, "enforce_weekly_automated_execution_limit", fake_quota)
    monkeypatch.setattr(api_automation_jobs, "_find_compatible_runner_for_job", fake_compatible)

    job = await api_automation_jobs.create_api_automation_job_for_suite(
        db,
        run=run,
        case_ids=[case_id],
        cases_by_id={case_id: case},
        environment=environment,
        shared_variables={},
        user_id=user_id,
    )

    assert job.job_type == "API_EXECUTION"
    assert calls == [(organization_id, 1)]
    frozen = api_automation_jobs.decrypt_api_worker_payload(job)
    assert frozen["dataset_variables"] == {"base_url": "https://api.example.test"}
    assert frozen["cases"][0]["dataset_variables"] == {"customer_id": "42"}
    assert frozen["cases"][0]["dynamic_values"]["$uuid"]


@pytest.mark.asyncio
async def test_claim_response_uses_worker_schema_only_after_claim(monkeypatch):
    job_id, runner_id = uuid4(), uuid4()
    job = SimpleNamespace(
        id=job_id, job_type="API_EXECUTION", test_run_id=uuid4(), ejecucion_id=None,
        caso_id=None, build_id=uuid4(), runner_id=runner_id,
        estado=models.AutomationJobStatus.CLAIMED, required_framework="treseko-api",
        required_language="declarative", required_runtime=None, timeout_seconds=300,
        payload_congelado={"payload_secret": "cipher"}, logs=None, error_message=None,
        metadata_resultado={}, fecha_creacion=datetime.now(timezone.utc), fecha_claim=datetime.now(timezone.utc),
        fecha_inicio=None, fecha_fin=None, lease_token=LEASE_TOKEN,
        lease_expires_at=datetime.now(timezone.utc) + timedelta(minutes=5), attempt_count=1, max_attempts=3,
    )
    runner = SimpleNamespace(id=runner_id)

    async def fake_get(_db, requested_id):
        assert requested_id == job_id
        return job

    async def fake_claim(_db, current_job, current_runner):
        assert current_job is job and current_runner is runner
        return job

    async def fake_publish(*_args, **_kwargs):
        return None

    async def fake_recover(_db):
        return 0

    monkeypatch.setattr(automation_router.crud, "get_automation_job", fake_get)
    monkeypatch.setattr(automation_router.crud, "claim_automation_job", fake_claim)
    monkeypatch.setattr(automation_router.crud, "recover_stale_automation_jobs", fake_recover)
    monkeypatch.setattr(automation_router, "worker_payload", lambda _job: {"secret": "clear"})
    monkeypatch.setattr(automation_router, "_publish_automation_job_event", fake_publish)

    response = await automation_router.claim_automation_job(job_id, db=None, runner=runner, x_claim_intent=None)
    assert isinstance(response, schemas.AutomationWorkerJobClaim)
    assert response.payload_congelado == {"secret": "clear"}


@pytest.mark.asyncio
async def test_inactive_build_result_releases_lease_and_runner(monkeypatch):
    job_id, runner_id, organization_id = uuid4(), uuid4(), uuid4()
    runner = SimpleNamespace(id=runner_id, organizacion_id=organization_id, estado="BUSY", ultimo_heartbeat=None)
    job = SimpleNamespace(
        id=job_id,
        runner_id=runner_id,
        organizacion_id=organization_id,
        runner=runner,
        estado=models.AutomationJobStatus.RUNNING,
        error_message=None,
        fecha_fin=None,
        lease_token=LEASE_TOKEN,
        lease_expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
    )

    class FakeDb:
        async def commit(self):
            return None

        async def refresh(self, _value):
            return None

    async def fake_get(_db, requested_id):
        assert requested_id == job_id
        return job

    async def fake_complete(*_args, **_kwargs):
        raise ValueError("La build está inactiva")

    async def fake_publish(*_args, **_kwargs):
        return None

    monkeypatch.setattr(automation_router.crud, "get_automation_job", fake_get)
    monkeypatch.setattr(automation_router.crud, "complete_automation_job", fake_complete)
    monkeypatch.setattr(automation_router, "_publish_automation_job_event", fake_publish)

    payload = schemas.AutomationJobResult(
        **_delivery_fields(),
        status=models.AutomationJobStatus.PASSED,
    )
    with pytest.raises(HTTPException) as exc_info:
        await automation_router.report_automation_job_result(job_id, payload, db=FakeDb(), runner=runner)

    assert exc_info.value.status_code == 409
    assert job.estado == models.AutomationJobStatus.ERROR
    assert job.lease_token is None
    assert job.lease_expires_at is None
    assert runner.estado == "ONLINE"
