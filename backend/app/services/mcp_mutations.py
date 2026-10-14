"""Governed MCP mutation and execution handlers."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select

from .. import crud, models, schemas, access_control
from ..repositories import bug_issue_management, bug_integrations, bug_issue_interactions, suites_cases, test_runs_automation_runners, cases_datasets, projects_components_builds
from . import mcp_execution_queue
from .mcp_mutation_support import (
    _assert_supported, _bug_transition_payload, _bug_update_payload, _confirm,
    _serialize_bug, _serialize_case, _serialize_run, _uuid,
    _validate_case_automation, _value,
)
from .mcp_case_mutations import (
    _replace_case_traceability, archive_case, create_case, update_case,
)














async def create_test_run(db, user, project, arguments):
    case_ids = [_uuid(x, "case_id") for x in arguments.get("case_ids", [])]
    if not case_ids:
        raise ValueError("case_ids es obligatorio")
    cases = (await db.execute(select(models.CasoPrueba).where(models.CasoPrueba.id.in_(case_ids), models.CasoPrueba.proyecto_id == project.id))).scalars().all()
    if len(cases) != len(case_ids):
        raise LookupError("case not found")
    for case in cases:
        _assert_supported(case)
    payload = schemas.TestRunCreate(proyecto_id=project.id, nombre=arguments["name"], entorno=arguments["environment"], build_id=_uuid(arguments["build_id"], "build_id"), entorno_id=_uuid(arguments["environment_id"], "environment_id") if arguments.get("environment_id") else None, dataset_id=_uuid(arguments["dataset_id"], "dataset_id") if arguments.get("dataset_id") else None, caso_ids=case_ids, origen=arguments.get("origin", "MANUAL"))
    run = await test_runs_automation_runners.create_test_run(db, payload, user.id)
    return _serialize_run(run)

async def execute_test_run(db, user, project, arguments):
    run = await db.scalar(select(models.TestRun).where(models.TestRun.id == _uuid(arguments["run_id"], "run_id"), models.TestRun.proyecto_id == project.id))
    if not run:
        raise LookupError("run not found")
    cases = (await db.execute(select(models.CasoPrueba).join(models.EjecucionCaso, models.EjecucionCaso.caso_id == models.CasoPrueba.id).where(models.EjecucionCaso.test_run_id == run.id))).scalars().unique().all()
    for case in cases:
        _assert_supported(case)
    if str(run.origen or "").upper() not in {"AUTOMATIZADA", "MANUAL"}:
        raise ValueError("origen de ejecución no soportado")
    if not cases:
        raise ValueError("La ejecución no contiene casos")
    if run.estado_run == models.EstadoRun.CERRADO:
        raise ValueError("La ejecución está cerrada; crea otra ejecución para repetir la prueba")
    formats = {str(_value(case.formato_prueba)).upper() for case in cases}
    if formats == {"API"}:
        job = await mcp_execution_queue.enqueue(db, run, user, [c.id for c in cases])
        return {"project_id": str(project.id), "run_id": str(run.id), "accepted": True, "status": _value(run.estado_run), "dispatch_status": job.state, "runner": "api"}
    if formats != {"CLASICA"}:
        raise ValueError("Una ejecución MCP debe contener casos de un solo formato compatible")
    if str(run.origen or "").upper() != "AUTOMATIZADA":
        raise ValueError("La ejecución clásica por MCP requiere origen AUTOMATIZADA y un worker Playwright disponible")
    if any(str(_value(case.tipo_prueba)).upper() != "AUTOMATIZADA" or not (case.script_automatizado or "").strip() for case in cases):
        raise ValueError("Cada caso clásico requiere tipo AUTOMATIZADA y un script automatizado")
    from ..repositories.automation_jobs import create_automation_job_for_execution
    from .edition.usage_limits import enforce_weekly_automated_execution_limit
    await enforce_weekly_automated_execution_limit(db, solution_id=project.organizacion_id, increment=len(cases))
    executions = (await db.execute(
        select(models.EjecucionCaso, models.CasoPrueba)
        .join(models.CasoPrueba, models.CasoPrueba.id == models.EjecucionCaso.caso_id)
        .where(models.EjecucionCaso.test_run_id == run.id)
        .order_by(models.CasoPrueba.codigo, models.CasoPrueba.id)
    )).all()
    jobs = []
    for execution, case in executions:
        job = await create_automation_job_for_execution(
            db, execution.id, user.id, commit=False, quota_checked=True
        )
        jobs.append({"job_id": str(job.id), "execution_id": str(execution.id), "case_id": str(case.id), "status": _value(job.estado)})
    return {"project_id": str(project.id), "run_id": str(run.id), "accepted": True, "status": _value(run.estado_run), "dispatch_status": "PENDING" if any(job["status"] == "PENDING" for job in jobs) else "RUNNING", "runner": "playwright_worker", "jobs": jobs}


async def record_manual_result(db, user, project, arguments):
    _confirm(arguments, "RECORD_MANUAL_RESULT")
    execution_id = _uuid(arguments["execution_id"], "execution_id")
    run = await db.scalar(select(models.TestRun).join(
        models.EjecucionCaso, models.EjecucionCaso.test_run_id == models.TestRun.id,
    ).where(models.EjecucionCaso.id == execution_id,
             models.TestRun.proyecto_id == project.id).with_for_update())
    if not run:
        raise LookupError("execution not found")
    if str(run.origen or "").upper() != "MANUAL" or run.estado_run == models.EstadoRun.CERRADO:
        raise ValueError("El resultado solo puede registrarse en una ejecución MANUAL abierta")
    if run.build_id:
        build = await db.get(models.Build, run.build_id)
        if not access_control.is_build_active(build):
            raise ValueError("La build está inactiva; no se pueden modificar resultados")
    execution = await db.scalar(select(models.EjecucionCaso).where(
        models.EjecucionCaso.id == execution_id,
        models.EjecucionCaso.test_run_id == run.id,
    ).with_for_update())
    case = await db.get(models.CasoPrueba, execution.caso_id) if execution else None
    if not case or case.proyecto_id != project.id:
        raise LookupError("execution case not found")
    if case.formato_prueba != models.FormatoPrueba.CLASICA or case.tipo_prueba != models.TipoPrueba.MANUAL:
        raise ValueError("Esta operación solo admite casos CLASICA de tipo MANUAL")
    if execution.execution_mode != models.ExecutionMode.MANUAL:
        raise ValueError("El resultado no pertenece a una ejecución MANUAL")
    if execution.estado_resultado != models.EstadoResultado.SIN_CORRER:
        raise ValueError("El resultado ya está concluido; crea otra ejecución para repetir el caso")

    final_status = models.EstadoResultado(arguments["status"])
    notes = str(arguments.get("notes") or "").strip()
    step_inputs = arguments.get("steps", [])
    snapshots = (await db.execute(select(models.SnapshotPaso).where(
        models.SnapshotPaso.ejecucion_caso_id == execution.id,
    ).order_by(models.SnapshotPaso.numero_paso).with_for_update())).scalars().all()
    by_number = {snapshot.numero_paso: snapshot for snapshot in snapshots}
    supplied = {int(item["number"]): item for item in step_inputs}
    if len(supplied) != len(step_inputs) or set(supplied) != set(by_number):
        raise ValueError("Debes informar una sola vez el resultado de cada paso de la ejecución")
    step_statuses = []
    from ..evidence_url_security import sanitize_evidence_url
    for number, snapshot in by_number.items():
        item = supplied[number]
        status = models.EstadoResultado(item["status"])
        snapshot.estado_paso = status
        snapshot.comentarios = str(item.get("comments") or "").strip() or None
        evidence_url = str(item.get("evidence_url") or "").strip()
        snapshot.evidencia_url = sanitize_evidence_url(evidence_url) if evidence_url else None
        step_statuses.append(status)
    if final_status == models.EstadoResultado.PASO and any(status != models.EstadoResultado.PASO for status in step_statuses):
        raise ValueError("Un caso solo puede quedar PASO si todos sus pasos quedaron PASO")
    if final_status in {models.EstadoResultado.FALLO, models.EstadoResultado.BLOQUEADO} and not notes:
        raise ValueError("Agrega una observación concreta para registrar un fallo o bloqueo")
    if final_status == models.EstadoResultado.FALLO and models.EstadoResultado.BLOQUEADO in step_statuses:
        raise ValueError("El caso no puede quedar FALLO si tiene un paso BLOQUEADO")
    if final_status == models.EstadoResultado.BLOQUEADO and models.EstadoResultado.FALLO in step_statuses:
        raise ValueError("El caso no puede quedar BLOQUEADO si tiene un paso FALLO")

    now = datetime.now(timezone.utc)
    execution.estado_resultado = final_status
    execution.execution_mode = models.ExecutionMode.MANUAL
    execution.observaciones = notes or None
    execution.duracion_segundos = int(arguments.get("duration_seconds", 0))
    execution.fecha_ejecucion = now
    case.ultimo_resultado = final_status.value
    case.ultima_ejecucion_por = user.id
    case.ultima_ejecucion_fecha = now
    remaining = await db.scalar(select(models.EjecucionCaso.id).where(
        models.EjecucionCaso.test_run_id == run.id,
        models.EjecucionCaso.estado_resultado == models.EstadoResultado.SIN_CORRER,
        models.EjecucionCaso.id != execution.id,
    ).limit(1))
    if remaining is None:
        run.estado_run = models.EstadoRun.CERRADO
        run.fecha_cierre = now
    await db.flush()
    return {"project_id": str(project.id), "run_id": str(run.id), "execution_id": str(execution.id),
            "case_id": str(case.id), "status": final_status.value,
            "steps_recorded": len(snapshots), "run_status": _value(run.estado_run)}

async def status_test_run(db, user, project, arguments):
    run = await db.scalar(select(models.TestRun).where(models.TestRun.id == _uuid(arguments["run_id"], "run_id"), models.TestRun.proyecto_id == project.id))
    if not run:
        raise LookupError("run not found")
    result = _serialize_run(run)
    job = await db.get(models.McpApiRunJob, run.id)
    result["dispatch_status"] = job.state if job else None
    result["retry_guidance"] = "Create a new run after reviewing persisted results; interrupted requests are not automatically replayed." if job and job.state == "INTERRUPTED" else None
    if not job:
        worker_jobs = (await db.execute(
            select(models.AutomationJob)
            .where(models.AutomationJob.test_run_id == run.id)
            .order_by(models.AutomationJob.fecha_creacion, models.AutomationJob.id)
        )).scalars().all()
        if worker_jobs:
            active = {models.AutomationJobStatus.PENDING, models.AutomationJobStatus.CLAIMED, models.AutomationJobStatus.RUNNING}
            result["dispatch_status"] = "RUNNING" if any(item.estado in {models.AutomationJobStatus.CLAIMED, models.AutomationJobStatus.RUNNING} for item in worker_jobs) else "PENDING" if any(item.estado in active for item in worker_jobs) else "CANCELLED" if all(item.estado == models.AutomationJobStatus.CANCELLED for item in worker_jobs) else "COMPLETED"
            result["runner"] = "playwright_worker"
            result["jobs"] = [{"job_id": str(item.id), "execution_id": str(item.ejecucion_id), "case_id": str(item.caso_id), "status": _value(item.estado)} for item in worker_jobs]
    return result

async def cancel_test_run(db, user, project, arguments):
    _confirm(arguments, "CANCEL_TEST_RUN")
    run = await db.scalar(select(models.TestRun).where(models.TestRun.id == _uuid(arguments["run_id"], "run_id"), models.TestRun.proyecto_id == project.id).with_for_update())
    if not run:
        raise LookupError("run not found")
    await mcp_execution_queue.cancel(db, run.id)
    pending_jobs = (await db.execute(select(models.AutomationJob).where(
        models.AutomationJob.test_run_id == run.id,
        models.AutomationJob.job_type == "EXECUTION",
        models.AutomationJob.estado == models.AutomationJobStatus.PENDING,
    ).with_for_update(skip_locked=True))).scalars().all()
    for job in pending_jobs:
        job.estado = models.AutomationJobStatus.CANCELLED
        job.fecha_fin = datetime.now(timezone.utc)
        job.error_message = "Cancelado antes de que el worker iniciara la ejecución"
    run.estado_run = models.EstadoRun.CERRADO
    run.fecha_cierre = datetime.now(timezone.utc)
    await db.commit()
    return _serialize_run(run)






async def _bug_case(db, bug):
    case = await db.get(models.CasoPrueba, bug.caso_id) if bug.caso_id else None
    if case:
        _assert_supported(case)

async def create_bug_from_result(db, user, project, arguments):
    _confirm(arguments, "CREATE_BUG_FROM_RESULT")
    execution_id = _uuid(arguments["execution_id"], "execution_id")
    row = await db.scalar(select(models.EjecucionCaso).join(models.TestRun).where(models.EjecucionCaso.id == execution_id, models.TestRun.proyecto_id == project.id))
    if not row:
        raise LookupError("result not found")
    case = await db.get(models.CasoPrueba, row.caso_id); _assert_supported(case)
    bug = await bug_integrations.create_bug_from_execution(db, execution_id, schemas.BugIssueUpdate(**_bug_update_payload(arguments)), user.id)
    if not bug: raise LookupError("result not found")
    return _serialize_bug(bug)

async def create_bug_from_snapshot(db, user, project, arguments):
    _confirm(arguments, "CREATE_BUG_FROM_SNAPSHOT")
    snapshot_id = _uuid(arguments["snapshot_id"], "snapshot_id")
    row = await db.scalar(select(models.SnapshotPaso).join(models.EjecucionCaso).join(models.TestRun).where(models.SnapshotPaso.id == snapshot_id, models.TestRun.proyecto_id == project.id))
    if not row: raise LookupError("snapshot not found")
    case = await db.get(models.CasoPrueba, (await db.get(models.EjecucionCaso, row.ejecucion_caso_id)).caso_id); _assert_supported(case)
    bug = await bug_issue_interactions.create_bug_from_snapshot(db, snapshot_id, schemas.BugIssueUpdate(**_bug_update_payload(arguments)), user.id)
    if not bug: raise LookupError("snapshot not found")
    return _serialize_bug(bug)

async def update_bug(db, user, project, arguments):
    _confirm(arguments, "UPDATE_BUG")
    bug = await db.scalar(select(models.BugIssue).where(models.BugIssue.id == _uuid(arguments["bug_id"], "bug_id"), models.BugIssue.proyecto_id == project.id))
    if not bug: raise LookupError("bug not found")
    await _bug_case(db, bug)
    updated = await bug_issue_management.update_bug_issue(db, bug.id, schemas.BugIssueUpdate(**_bug_update_payload(arguments)))
    return _serialize_bug(updated)

async def transition_bug(db, user, project, arguments):
    _confirm(arguments, "TRANSITION_BUG")
    bug = await db.scalar(select(models.BugIssue).where(models.BugIssue.id == _uuid(arguments["bug_id"], "bug_id"), models.BugIssue.proyecto_id == project.id))
    if not bug: raise LookupError("bug not found")
    await _bug_case(db, bug)
    payload = schemas.BugTransitionRequest(**_bug_transition_payload(arguments))
    updated = await bug_issue_management.transition_bug_issue(db, bug.id, payload, user.id, source="mcp")
    return _serialize_bug(updated)

async def close_bug(db, user, project, arguments):
    _confirm(arguments, "CLOSE_BUG")
    if str(arguments.get("transition", {}).get("status", "")).upper() not in bug_issue_management.BUG_CLOSED_STATES:
        raise ValueError("close requiere un estado de cierre válido")
    return await transition_bug(db, user, project, {**arguments, "confirmation": "TRANSITION_BUG"})


async def create_component(db, user, project, arguments):
    _confirm(arguments, "CREATE_COMPONENT")
    name = str(arguments.get("name", "")).strip()
    if not name:
        raise ValueError("El nombre del componente es obligatorio")
    existing = await db.scalar(select(models.Componente).where(
        models.Componente.proyecto_id == project.id,
        models.Componente.nombre == name,
    ))
    if existing:
        raise ValueError("Ya existe un componente con ese nombre en el proyecto")
    payload = schemas.ComponenteCreate(
        proyecto_id=project.id,
        nombre=name,
        descripcion=arguments.get("description"),
        tech_stack=arguments.get("tech_stack"),
        variables={},
    )
    component = await projects_components_builds.create_componente(db, payload, commit=False)
    return {"id": str(component.id), "project_id": str(component.proyecto_id),
            "code": component.codigo, "name": component.nombre,
            "description": component.descripcion, "tech_stack": component.tech_stack}


async def create_build(db, user, project, arguments):
    _confirm(arguments, "CREATE_BUILD")
    name = str(arguments.get("name", "")).strip()
    if not name:
        raise ValueError("El nombre del build es obligatorio")
    component_id = _uuid(arguments["component_id"], "component_id")
    component = await db.scalar(select(models.Componente).where(
        models.Componente.id == component_id,
        models.Componente.proyecto_id == project.id,
    ))
    if not component:
        raise ValueError("El componente no pertenece al proyecto seleccionado")
    existing = await db.scalar(select(models.Build).where(
        models.Build.componente_id == component_id,
        models.Build.nombre == name,
    ))
    if existing:
        raise ValueError("Ya existe un build con ese nombre en el componente")
    state = str(arguments.get("status", "PREPARACION")).strip().upper()
    if state not in {"PREPARACION", "ACTIVA"}:
        raise ValueError("Un build nuevo debe quedar en PREPARACION o ACTIVA")
    payload = schemas.BuildCreate(
        proyecto_id=project.id,
        componente_id=component.id,
        nombre=name,
        contexto_cambio=arguments.get("change_context"),
        estado=state,
        activo=state == "ACTIVA",
    )
    build = await projects_components_builds.create_build(db, payload, commit=False)
    return {"id": str(build.id), "project_id": str(build.proyecto_id),
            "component_id": str(build.componente_id), "code": build.codigo,
            "name": build.nombre, "status": _value(build.estado),
            "active": bool(build.activo)}


HANDLERS = {"test-runs.create": create_test_run, "test-runs.execute": execute_test_run, "test-runs.status": status_test_run, "test-runs.cancel": cancel_test_run, "test-results.record-manual": record_manual_result, "cases.create": create_case, "cases.update": update_case, "cases.archive": archive_case, "components.create": create_component, "builds.create": create_build, "bugs.create-from-result": create_bug_from_result, "bugs.create-from-snapshot": create_bug_from_snapshot, "bugs.update": update_bug, "bugs.transition": transition_bug, "bugs.close": close_bug}
