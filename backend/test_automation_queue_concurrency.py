from __future__ import annotations

import asyncio
import hashlib
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import selectinload

from app import crud, models, schemas
from app.database import AsyncSessionLocal, engine
from app.repositories import test_runs_automation_runners as runner_repository
from app.time_utils import utc_now


def _runner(name: str, organization_id):
    return models.AutomationRunner(
        nombre=name,
        organizacion_id=organization_id,
        token_hash=hashlib.sha256(f"{name}-{uuid4()}".encode()).hexdigest(),
        estado="ONLINE",
        activo=True,
        capabilities={
            "frameworks": ["playwright"],
            "framework_languages": {"playwright": ["javascript"]},
        },
    )


async def _add_job(db, *, project, user_id, index: int):
    component = models.Componente(nombre=f'Queue component {index}', proyecto_id=project.id)
    db.add(component)
    await db.flush()
    build = models.Build(nombre=f'Queue build {index}', proyecto_id=project.id, componente_id=component.id, activo=True, estado='ACTIVA')
    db.add(build)
    await db.flush()
    case = models.CasoPrueba(
        master_id=uuid4(),
        codigo=f"QUEUE-{index}-{uuid4().hex[:6]}",
        proyecto_id=project.id,
        titulo=f"Queue concurrency {index}",
        componente_id=component.id,
        prioridad=models.Prioridad.MEDIA,
        criticidad=models.Criticidad.MEDIA,
        tipo_prueba=models.TipoPrueba.AUTOMATIZADA,
        formato_prueba=models.FormatoPrueba.CLASICA,
        script_automatizado="async () => true",
        framework="playwright:javascript",
        creado_por=user_id,
    )
    db.add(case)
    await db.flush()
    db.add(models.BuildCaso(build_id=build.id, caso_id=case.id))
    run = models.TestRun(
        proyecto_id=project.id,
        origen="AUTOMATIZADA_WORKER",
        build_id=build.id,
        nombre=f"Queue run {index} {uuid4().hex[:6]}",
        entorno="test",
        creado_por=user_id,
        estado_run=models.EstadoRun.EN_PROGRESO,
    )
    db.add(run)
    await db.flush()
    execution = models.EjecucionCaso(
        test_run_id=run.id,
        caso_id=case.id,
        version_ejecutada=1,
        execution_mode=models.ExecutionMode.AUTOMATIZADA,
        ejecutado_por=user_id,
    )
    db.add(execution)
    await db.flush()
    db.add(models.SnapshotPaso(
        ejecucion_caso_id=execution.id,
        numero_paso=1,
        accion_congelada="Ejecutar prueba concurrente",
        resultado_esperado_congelado="La evidencia conserva su alcance",
    ))
    job = models.AutomationJob(
        organizacion_id=project.organizacion_id,
        proyecto_id=project.id,
        test_run_id=run.id,
        ejecucion_id=execution.id,
        caso_id=case.id,
        build_id=build.id,
        required_framework="playwright",
        required_language="javascript",
        timeout_seconds=120,
        payload_congelado={"marker": f"queue-payload-{index}"},
        creado_por=user_id,
    )
    db.add(job)
    await db.flush()
    return {"job": job.id, "run": run.id, "execution": execution.id, "case": case.id}


async def _load_job(db, job_id):
    return (await db.execute(
        select(models.AutomationJob)
        .options(selectinload(models.AutomationJob.runner))
        .where(models.AutomationJob.id == job_id)
    )).scalar_one()


@pytest.mark.asyncio
async def test_solution_scoped_queue_is_atomic_recoverable_and_idempotent():
    user_id = uuid4()
    async with AsyncSessionLocal() as db:
        db.add(models.Usuario(id=user_id, email=f"queue-{user_id}@example.invalid", rol=models.Rol.ADMIN, activo=True))
        org_a = models.Organizacion(nombre=f"Queue solution A {uuid4()}")
        org_b = models.Organizacion(nombre=f"Queue solution B {uuid4()}")
        db.add_all([org_a, org_b])
        await db.flush()
        projects = [
            models.Proyecto(nombre=f"Queue project {name} {uuid4()}", organizacion_id=org.id)
            for org, name in ((org_a, "A1"), (org_a, "A2"), (org_b, "B1"), (org_b, "B2"))
        ]
        db.add_all(projects)
        await db.flush()
        runners = [
            _runner("queue-a-1", org_a.id),
            _runner("queue-a-2", org_a.id),
            _runner("queue-b-1", org_b.id),
            _runner("queue-b-2", org_b.id),
        ]
        db.add_all(runners)
        await db.flush()
        records = [
            await _add_job(db, project=project, user_id=user_id, index=index)
            for index, project in enumerate((projects[2], projects[0], projects[3], projects[1], projects[0]))
        ]
        org_ids = [org_a.id, org_b.id]
        project_ids = [project.id for project in projects]
        runner_ids = [runner.id for runner in runners]
        await db.commit()

    try:
        # Even though B's job was inserted first, A only sees A and vice versa.
        async with AsyncSessionLocal() as db:
            for runner_id, expected_org in ((runner_ids[0], org_ids[0]), (runner_ids[2], org_ids[1])):
                runner = await db.get(models.AutomationRunner, runner_id)
                selected = await crud.get_next_automation_job(db, runner)
                assert selected is not None
                assert selected.organizacion_id == expected_org

        # Two workers in the same solution race on one PENDING row. Exactly
        # one UPDATE ... WHERE PENDING is allowed to win.
        target_id = records[1]["job"]
        gate = asyncio.Event()
        lock = asyncio.Lock()
        ready = 0

        async def contend(runner_id):
            nonlocal ready
            async with AsyncSessionLocal() as db:
                job = await db.get(models.AutomationJob, target_id)
                runner = await db.get(models.AutomationRunner, runner_id)
                async with lock:
                    ready += 1
                    if ready == 2:
                        gate.set()
                await gate.wait()
                try:
                    claimed = await crud.claim_automation_job(db, job, runner)
                    return ("won", runner_id, claimed.lease_token)
                except ValueError as exc:
                    return ("lost", runner_id, str(exc))

        race = await asyncio.gather(contend(runner_ids[0]), contend(runner_ids[1]))
        assert [item[0] for item in race].count("won") == 1
        assert [item[0] for item in race].count("lost") == 1
        winner = next(item for item in race if item[0] == "won")
        assert "reclamado" in next(item[2] for item in race if item[0] == "lost")

        async with AsyncSessionLocal() as db:
            claimed = await db.get(models.AutomationJob, target_id)
            original_expiry = claimed.lease_expires_at
            runner = await db.get(models.AutomationRunner, winner[1])
            await crud.update_runner_heartbeat(db, runner, schemas.AutomationRunnerHeartbeat(
                estado="BUSY", active_jobs=1, current_job_id=target_id, lease_token=winner[2]
            ))
            await db.refresh(claimed)
            assert claimed.estado == models.AutomationJobStatus.RUNNING
            assert claimed.lease_expires_at >= original_expiry

        event_id = str(uuid4())
        payload = schemas.AutomationJobResult(
            lease_token=winner[2],
            result_event_id=event_id,
            status=models.AutomationJobStatus.PASSED,
            observations="resultado-atómico",
            metadata={"routing_marker": "resultado-atómico"},
            steps=[{"number": 1, "status": "PASO", "observations": "resultado-atómico"}],
        )
        async with AsyncSessionLocal() as db:
            job = await _load_job(db, target_id)
            runner = await db.get(models.AutomationRunner, winner[1])
            completed = await crud.complete_automation_job(db, job, payload, runner=runner)
            assert completed.estado == models.AutomationJobStatus.PASSED
        async with AsyncSessionLocal() as db:
            job = await _load_job(db, target_id)
            runner = await db.get(models.AutomationRunner, winner[1])
            repeated = await crud.complete_automation_job(db, job, payload, runner=runner)
            assert repeated.result_event_id == event_id
            conflicting = payload.model_copy(update={"observations": "resultado diferente"})
            with pytest.raises(ValueError, match="resultado distinto"):
                await crud.complete_automation_job(db, job, conflicting, runner=runner)

        # A runner from another solution cannot claim an explicitly addressed job.
        async with AsyncSessionLocal() as db:
            foreign_job = await db.get(models.AutomationJob, records[3]["job"])
            foreign_runner = await db.get(models.AutomationRunner, runner_ids[2])
            with pytest.raises(ValueError, match="solucion"):
                await crud.claim_automation_job(db, foreign_job, foreign_runner)

        # Expired lease is requeued, receives a new token/owner, and rejects
        # the old worker's late callback.
        recover_id = records[3]["job"]
        async with AsyncSessionLocal() as db:
            job = await db.get(models.AutomationJob, recover_id)
            first_runner = await db.get(models.AutomationRunner, runner_ids[0])
            first_claim = await crud.claim_automation_job(db, job, first_runner)
            old_token = first_claim.lease_token
        # Expiry only makes a claim recoverable. If no recovery won the row
        # lock yet, the original owner may reconnect and renew after an outage.
        async with AsyncSessionLocal() as db:
            job = await db.get(models.AutomationJob, recover_id)
            job.lease_expires_at = utc_now() - timedelta(seconds=1)
            await db.commit()
            first_runner = await db.get(models.AutomationRunner, runner_ids[0])
            await crud.update_runner_heartbeat(db, first_runner, schemas.AutomationRunnerHeartbeat(
                estado="BUSY", active_jobs=1, current_job_id=recover_id, lease_token=old_token
            ))
            await db.refresh(job)
            assert job.lease_expires_at > utc_now()
        async with AsyncSessionLocal() as db:
            job = await db.get(models.AutomationJob, recover_id)
            job.lease_expires_at = utc_now() - timedelta(seconds=1)
            await db.commit()
            assert await crud.recover_stale_automation_jobs(db) == 1
            await db.refresh(job)
            assert job.estado == models.AutomationJobStatus.PENDING
            assert job.runner_id is None
        async with AsyncSessionLocal() as db:
            job = await db.get(models.AutomationJob, recover_id)
            second_runner = await db.get(models.AutomationRunner, runner_ids[1])
            second_claim = await crud.claim_automation_job(db, job, second_runner)
            assert second_claim.lease_token != old_token
            recovered_token = second_claim.lease_token
            recovered_runner_id = second_runner.id
            late = schemas.AutomationJobResult(
                lease_token=old_token,
                result_event_id=str(uuid4()),
                status=models.AutomationJobStatus.PASSED,
            )
            with pytest.raises(ValueError, match="lease_token"):
                await crud.complete_automation_job(db, second_claim, late, runner=second_runner)

        # Exhaustion closes the job and its execution with an explicit timeout.
        exhausted_id = records[4]["job"]
        async with AsyncSessionLocal() as db:
            job = await db.get(models.AutomationJob, exhausted_id)
            runner = await db.get(models.AutomationRunner, runner_ids[0])
            await crud.claim_automation_job(db, job, runner)
        async with AsyncSessionLocal() as db:
            job = await db.get(models.AutomationJob, exhausted_id)
            job.attempt_count = job.max_attempts
            job.lease_expires_at = utc_now() - timedelta(seconds=1)
            await db.commit()
            assert await crud.recover_stale_automation_jobs(db) == 1
            await db.refresh(job)
            execution = await db.get(models.EjecucionCaso, records[4]["execution"])
            run = await db.get(models.TestRun, records[4]["run"])
            assert job.estado == models.AutomationJobStatus.TIMEOUT
            assert execution.estado_resultado == models.EstadoResultado.FALLO
            assert "timeout" in (execution.observaciones or "").lower()
            assert run.estado_run == models.EstadoRun.CERRADO

        # Complete every remaining executable job across both solutions and
        # verify each marker lands only on its own persisted execution.
        deliveries = {
            records[0]["job"]: (runner_ids[2], None, "resultado-proyecto-b1"),
            records[2]["job"]: (runner_ids[3], None, "resultado-proyecto-b2"),
            records[3]["job"]: (recovered_runner_id, recovered_token, "resultado-proyecto-a2"),
        }
        for job_id, (runner_id, known_token, marker) in deliveries.items():
            async with AsyncSessionLocal() as db:
                job = await _load_job(db, job_id)
                runner = await db.get(models.AutomationRunner, runner_id)
                token = known_token
                if job.estado == models.AutomationJobStatus.PENDING:
                    job = await crud.claim_automation_job(db, job, runner)
                    token = job.lease_token
                if marker == "resultado-proyecto-b1":
                    job.lease_expires_at = utc_now() - timedelta(seconds=1)
                    await db.commit()
                result = schemas.AutomationJobResult(
                    lease_token=token,
                    result_event_id=str(uuid4()),
                    status=models.AutomationJobStatus.PASSED,
                    observations=marker,
                    metadata={"routing_marker": marker},
                    steps=[{"number": 1, "status": "PASO", "observations": marker}],
                )
                await crud.complete_automation_job(db, job, result, runner=runner)

        expected_markers = {
            records[0]["execution"]: "resultado-proyecto-b1",
            records[1]["execution"]: "resultado-atómico",
            records[2]["execution"]: "resultado-proyecto-b2",
            records[3]["execution"]: "resultado-proyecto-a2",
        }
        async with AsyncSessionLocal() as db:
            executions = (await db.execute(
                select(models.EjecucionCaso).where(models.EjecucionCaso.id.in_(expected_markers))
            )).scalars().all()
            assert {item.id: item.observaciones for item in executions} == expected_markers
            jobs = (await db.execute(
                select(models.AutomationJob).where(models.AutomationJob.id.in_(deliveries))
            )).scalars().all()
            assert {item.proyecto_id for item in jobs} == {projects[1].id, projects[2].id, projects[3].id}
            assert all(item.estado == models.AutomationJobStatus.PASSED for item in jobs)
    finally:
        # Remove only rows created by this test, in FK-safe order.
        async with AsyncSessionLocal() as db:
            await db.execute(delete(models.AutomationJob).where(models.AutomationJob.organizacion_id.in_(org_ids)))
            await db.execute(delete(models.AutomationRunner).where(models.AutomationRunner.id.in_(runner_ids)))
            await db.execute(delete(models.TestRun).where(models.TestRun.proyecto_id.in_(project_ids)))
            await db.execute(delete(models.BuildCaso).where(models.BuildCaso.caso_id.in_([record["case"] for record in records])))
            await db.execute(delete(models.CasoPrueba).where(models.CasoPrueba.proyecto_id.in_(project_ids)))
            await db.execute(delete(models.Build).where(models.Build.proyecto_id.in_(project_ids)))
            await db.execute(delete(models.Componente).where(models.Componente.proyecto_id.in_(project_ids)))
            await db.execute(delete(models.Proyecto).where(models.Proyecto.id.in_(project_ids)))
            await db.execute(delete(models.Organizacion).where(models.Organizacion.id.in_(org_ids)))
            await db.execute(delete(models.Usuario).where(models.Usuario.id == user_id))
            await db.commit()


@pytest.mark.asyncio
async def test_registration_and_pairing_credentials_are_single_use_under_race(monkeypatch):
    # pytest creates a fresh loop per async test; replace connections left by
    # the preceding PostgreSQL race without closing them from the wrong loop.
    await engine.dispose(close=False)
    async def allow_worker_limit(*_args, **_kwargs):
        return None

    monkeypatch.setattr(runner_repository, "_enforce_worker_limit_for_solution", allow_worker_limit)
    user_id = uuid4()
    async with AsyncSessionLocal() as db:
        organization = models.Organizacion(nombre=f"Pairing race {uuid4()}")
        db.add(organization)
        await db.commit()
        await db.refresh(organization)
        organization_id = organization.id
        registration, registration_token = await runner_repository.create_automation_runner_registration_token(
            db,
            schemas.AutomationRunnerRegistrationTokenCreate(
                nombre="registration-race",
                organizacion_id=organization_id,
            ),
            user_id,
        )
        registration_id = registration.id
        pairing, _ = await runner_repository.create_automation_runner_pairing_request(
            db,
            schemas.AutomationRunnerPairingRequestCreate(
                nombre="pairing-race",
                organizacion_id=organization_id,
            ),
        )
        pairing_id, pairing_code = pairing.id, pairing.code

    async def consume_registration():
        async with AsyncSessionLocal() as db:
            try:
                runner, _ = await runner_repository.create_automation_runner(
                    db,
                    schemas.AutomationRunnerRegister(
                        registration_token=registration_token,
                        capabilities={"frameworks": ["playwright"]},
                    ),
                )
                return "created", runner.id
            except ValueError as exc:
                return "rejected", str(exc)

    registration_race = await asyncio.gather(consume_registration(), consume_registration())
    assert [item[0] for item in registration_race].count("created") == 1
    assert [item[0] for item in registration_race].count("rejected") == 1

    async def approve_pairing():
        async with AsyncSessionLocal() as db:
            try:
                _request, runner, _token = await runner_repository.approve_automation_runner_pairing_request(
                    db, pairing_code, user_id
                )
                return "approved", runner.id
            except ValueError as exc:
                return "rejected", str(exc)

    pairing_race = await asyncio.gather(approve_pairing(), approve_pairing())
    assert [item[0] for item in pairing_race].count("approved") == 1
    assert [item[0] for item in pairing_race].count("rejected") == 1

    try:
        async with AsyncSessionLocal() as db:
            runner_ids = list((await db.execute(
                select(models.AutomationRunner.id).where(models.AutomationRunner.organizacion_id == organization_id)
            )).scalars().all())
            assert len(runner_ids) == 2
    finally:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(models.AutomationRunnerPairingRequest).where(models.AutomationRunnerPairingRequest.id == pairing_id))
            await db.execute(delete(models.AutomationRunnerRegistrationToken).where(models.AutomationRunnerRegistrationToken.id == registration_id))
            await db.execute(delete(models.AutomationRunner).where(models.AutomationRunner.organizacion_id == organization_id))
            await db.execute(delete(models.Organizacion).where(models.Organizacion.id == organization_id))
            await db.commit()
