"""Governed MCP mutation and execution handlers."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select

from .. import crud, models, schemas
from ..repositories import bug_issue_management, bug_integrations, bug_issue_interactions, suites_cases, test_runs_automation_runners
from ..api.routers.api_tests import _execute_api_suite_background
def _serialize_run(run):
    return {"id": str(run.id), "project_id": str(run.proyecto_id), "build_id": str(run.build_id) if run.build_id else None, "name": str(run.nombre or "")[:256], "status": _value(run.estado_run)}

def _serialize_case(case):
    return {"id": str(case.id), "master_id": str(case.master_id), "title": str(case.titulo or "")[:4096], "version": case.version, "format": _value(case.formato_prueba), "test_type": _value(case.tipo_prueba), "active": bool(case.activo)}

def _serialize_bug(bug):
    return {"id": str(bug.id), "project_id": str(bug.proyecto_id), "title": str(bug.titulo or "")[:1024], "status": _value(bug.estado), "severity": _value(bug.severidad)}

SUPPORTED_FORMATS = {"CLASICA", "API"}

def _value(value):
    return getattr(value, "value", value)

def _assert_supported(case):
    fmt = str(_value(case.formato_prueba) or "").upper()
    if fmt not in SUPPORTED_FORMATS:
        raise ValueError("MCP solo admite casos CLASICA o API; el formato solicitado no está soportado")

def _confirm(arguments, expected):
    if arguments.get("confirmation") != expected:
        raise ValueError("confirmación explícita requerida")


def _bug_update_payload(arguments) -> dict[str, Any]:
    source = arguments.get("bug") or {}
    names = {
        "title": "titulo", "description": "descripcion", "severity": "severidad",
        "priority": "prioridad", "status": "estado", "expected_result": "resultado_esperado",
        "actual_result": "resultado_obtenido", "test_data": "datos_prueba", "comment": "comentario",
    }
    return {str(names.get(key, key)): value for key, value in source.items()}


def _bug_transition_payload(arguments) -> dict[str, Any]:
    source = arguments.get("transition") or {}
    names = {"status": "estado", "resolution": "resolucion", "close_reason": "motivo_cierre"}
    return {str(names.get(key, key)): value for key, value in source.items()}

def _uuid(value, name):
    try:
        return UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        raise ValueError(f"{name} debe ser UUID") from None

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
    if not any(str(_value(c.formato_prueba)).upper() == "API" for c in cases):
        raise ValueError("La ejecución MCP solo está soportada para suites API; la ejecución clásica requiere el flujo de pasos existente")
    asyncio.create_task(_execute_api_suite_background(run.id, user.id, [c.id for c in cases], run.dynamic_seed))
    return {"project_id": str(project.id), "run_id": str(run.id), "accepted": True, "status": _value(run.estado_run)}

async def status_test_run(db, user, project, arguments):
    run = await db.scalar(select(models.TestRun).where(models.TestRun.id == _uuid(arguments["run_id"], "run_id"), models.TestRun.proyecto_id == project.id))
    if not run:
        raise LookupError("run not found")
    return _serialize_run(run)

async def cancel_test_run(db, user, project, arguments):
    _confirm(arguments, "CANCEL_TEST_RUN")
    run = await db.scalar(select(models.TestRun).where(models.TestRun.id == _uuid(arguments["run_id"], "run_id"), models.TestRun.proyecto_id == project.id))
    if not run:
        raise LookupError("run not found")
    run.estado_run = models.EstadoRun.CERRADO
    run.fecha_cierre = datetime.now(timezone.utc)
    await db.commit()
    return _serialize_run(run)

async def create_case(db, user, project, arguments):
    _confirm(arguments, "CREATE_CASE")
    fmt = str(arguments.get("format", "CLASICA")).upper()
    if fmt not in SUPPORTED_FORMATS:
        raise ValueError("MCP solo admite casos CLASICA o API")
    steps = [schemas.PasoCreate(numero_paso=item.get("number", index), accion=item.get("action", ""), datos=item.get("data"), resultado_esperado=item.get("expected_result", ""))
             for index, item in enumerate(arguments.get("steps", []), start=1)]
    payload = schemas.CasoPruebaCreate(proyecto_id=project.id, titulo=arguments["title"], descripcion=arguments.get("description", ""), prioridad=arguments.get("priority", "MEDIA"), criticidad=arguments.get("criticality", "MEDIA"), formato_prueba=fmt, tipo_prueba=arguments.get("test_type", "MANUAL"), dataset=arguments.get("dataset", []), configuracion_api=arguments.get("api_configuration", {}), pasos=steps, creado_por=user.id)
    case = await suites_cases.create_caso_prueba(db, payload)
    return _serialize_case(case)

async def update_case(db, user, project, arguments):
    _confirm(arguments, "UPDATE_CASE")
    case = await db.scalar(select(models.CasoPrueba).where(models.CasoPrueba.id == _uuid(arguments["case_id"], "case_id"), models.CasoPrueba.proyecto_id == project.id))
    if not case:
        raise LookupError("case not found")
    _assert_supported(case)
    data = {"titulo": arguments.get("title", case.titulo), "descripcion": arguments.get("description", case.descripcion), "prioridad": arguments.get("priority", _value(case.prioridad)), "criticidad": arguments.get("criticality", _value(case.criticidad)), "formato_prueba": arguments.get("format", _value(case.formato_prueba)), "tipo_prueba": arguments.get("test_type", _value(case.tipo_prueba)), "dataset": arguments.get("dataset", case.dataset or []), "configuracion_api": arguments.get("api_configuration", case.configuracion_api or {}), "suite_id": arguments.get("suite_id", case.suite_id), "componente_id": arguments.get("component_id", case.componente_id)}
    data["proyecto_id"] = project.id
    if "steps" in arguments:
        data["pasos"] = [schemas.PasoCreate(numero_paso=item.get("number", index), accion=item.get("action", ""), datos=item.get("data"), resultado_esperado=item.get("expected_result", ""))
                         for index, item in enumerate(arguments["steps"], start=1)]
    else:
        current_steps = await db.execute(
            select(models.PasoPrueba)
            .where(models.PasoPrueba.caso_id == case.id)
            .order_by(models.PasoPrueba.numero_paso)
        )
        data["pasos"] = [
            schemas.PasoCreate(
                numero_paso=step.numero_paso,
                accion=step.accion,
                datos=step.datos,
                resultado_esperado=step.resultado_esperado,
            )
            for step in current_steps.scalars().all()
        ]
    payload = schemas.CasoPruebaCreate(**data)
    result = await suites_cases.update_caso_prueba(db, case.master_id, payload)
    return _serialize_case(result)

async def archive_case(db, user, project, arguments):
    _confirm(arguments, "ARCHIVE_CASE")
    case = await db.scalar(select(models.CasoPrueba).where(models.CasoPrueba.id == _uuid(arguments["case_id"], "case_id"), models.CasoPrueba.proyecto_id == project.id))
    if not case:
        raise LookupError("case not found")
    _assert_supported(case)
    case.estado_caso = models.EstadoCaso.ARCHIVADO
    case.activo = False
    await db.commit()
    return _serialize_case(case)

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

HANDLERS = {"test-runs.create": create_test_run, "test-runs.execute": execute_test_run, "test-runs.status": status_test_run, "test-runs.cancel": cancel_test_run, "cases.create": create_case, "cases.update": update_case, "cases.archive": archive_case, "bugs.create-from-result": create_bug_from_result, "bugs.create-from-snapshot": create_bug_from_snapshot, "bugs.update": update_bug, "bugs.transition": transition_bug, "bugs.close": transition_bug}
