"""Native read-only MCP handlers.

Handlers receive only already-authorized context; they never inspect credentials or
raw requests and are deliberately not a general-purpose adapter registry.
"""

from __future__ import annotations

import re
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from .. import models
from .mcp_import import preview_import_handler, commit_import_handler, rollback_import_handler
from .mcp_extended import HANDLERS as EXTENDED_HANDLERS
from .mcp_mutations import HANDLERS as MUTATION_HANDLERS

MCP_MAX_BUILD_ITEMS = 1000
MCP_BUILD_NAME_MAX_CHARS = 256
MCP_CASE_MAX_ITEMS = 100
MCP_CASE_TEXT_MAX_CHARS = 4096
MCP_RUN_TEXT_MAX_CHARS = 256
MCP_OBSERVATIONS_MAX_CHARS = 2000
MCP_RESULT_MAX_ITEMS = 100
MCP_BUG_MAX_ITEMS = 100
MCP_BUG_TEXT_MAX_CHARS = 1024
_SECRET_KEYS = {"password", "passwd", "secret", "token", "api_key", "apikey", "authorization", "cookie", "credential", "private_key", "client_secret", "access_key"}


def _value(value):
    return getattr(value, "value", value)


def _safe_text(value, limit=MCP_CASE_TEXT_MAX_CHARS):
    from .mcp_redaction import redact
    return redact(str(value or ""))


def _safe_report(value, depth=0):
    from .mcp_redaction import redact
    return redact(value)


def _serialize_run(run):
    return {"id": str(run.id), "project_id": str(run.proyecto_id), "build_id": str(run.build_id) if run.build_id else None,
            "name": str(run.nombre or ""), "environment": str(run.entorno or ""),
            "origin": str(run.origen or ""), "external_run_id": str(run.external_run_id) if run.external_run_id else None,
            "status": _value(run.estado_run), "created_at": run.fecha_creacion.isoformat() if run.fecha_creacion else None,
            "closed_at": run.fecha_cierre.isoformat() if run.fecha_cierre else None}


def _serialize_result(execution, case=None, snapshots=None, *, detail=False):
    result = {"id": str(execution.id), "run_id": str(execution.test_run_id), "case": {"id": str(case.id), "codigo": case.codigo, "title": str(case.titulo or "")} if case else {"id": str(execution.caso_id)},
            "version": execution.version_ejecutada, "status": _value(execution.estado_resultado), "execution_mode": _value(execution.execution_mode),
            "attempt": execution.intento_numero, "duration_seconds": execution.duracion_segundos,
            "observations": str(execution.observaciones or ""),
            "api_result": _safe_report(execution.api_resultado if isinstance(execution.api_resultado, dict) else {}),
            "ai_report": _safe_report(execution.ai_report if isinstance(execution.ai_report, dict) else {}),
            "executed_at": execution.fecha_ejecucion.isoformat() if execution.fecha_ejecucion else None}
    if detail:
        result.update({
            "api_config_snapshot": _safe_report(getattr(execution, "api_config_snapshot", {}) or {}),
            "chatbot_config_snapshot": _safe_report(getattr(execution, "chatbot_config_snapshot", {}) or {}),
            "chatbot_result": _safe_report(getattr(execution, "chatbot_resultado", {}) or {}),
            "dynamic_variables": _safe_report(getattr(execution, "dynamic_variables", {}) or {}),
            "dynamic_seed": getattr(execution, "dynamic_seed", None),
            "snapshots": [{
                "id": str(snapshot.id), "step_number": snapshot.numero_paso,
                "action": _safe_text(snapshot.accion_congelada),
                "data": _safe_text(snapshot.datos_congelados),
                "resolved_data": _safe_text(snapshot.datos_resueltos),
                "expected_result": _safe_text(snapshot.resultado_esperado_congelado),
                "status": _value(snapshot.estado_paso),
                "comments": _safe_text(snapshot.comentarios),
                "error_log": _safe_text(snapshot.error_log),
                "evidence_url": _safe_text(snapshot.evidencia_url),
            } for snapshot in (snapshots or [])],
        })
    return result


def _serialize_case(case, *, steps=None):
    result = {"id": str(case.id), "codigo": case.codigo,
              "title": str(case.titulo or ""),
              "description": str(case.descripcion or ""),
              "preconditions": str(case.precondiciones or ""),
              "postconditions": str(case.postcondiciones or ""),
              "version": case.version, "priority": _value(case.prioridad),
              "criticality": _value(case.criticidad), "test_type": _value(case.tipo_prueba),
              "format": _value(case.formato_prueba), "status": _value(case.estado_caso),
              "active": case.activo,
              "component_id": str(case.componente_id) if case.componente_id else None,
              "suite_id": str(case.suite_id) if case.suite_id else None}
    result.update({
        "dataset": _safe_report(getattr(case, "dataset", []) or []),
        "api_configuration": _safe_report(getattr(case, "configuracion_api", {}) or {}),
        "chatbot_configuration": _safe_report(getattr(case, "configuracion_chatbot", {}) or {}),
        "tags": _safe_report(getattr(case, "etiquetas", []) or []),
        "automation_framework": getattr(case, "framework", None),
        "automation_script": _safe_text(getattr(case, "script_automatizado", ""), 16000),
    })
    if steps is not None:
        result["steps"] = [{"number": number, "action": _safe_text(action),
                            "data": _safe_text(data),
                            "expected_result": _safe_text(expected)}
                           for number, action, data, expected in steps]
    return result


def _serialize_bug(bug):
    """Return only bounded, non-evidence bug data and safe associations."""
    def ref(value, name=None):
        if value is None:
            return None
        result = {"id": str(value.id)}
        if name:
            result["name"] = str(getattr(value, name, "") or "")
        return result
    return {"id": str(bug.id), "codigo": str(getattr(bug, "codigo", "") or ""), "project_id": str(getattr(bug, "proyecto_id", "")),
            "title": str(getattr(bug, "titulo", "") or ""), "description": str(getattr(bug, "descripcion", "") or ""),
            "estado": _value(getattr(bug, "estado", None)), "severidad": _value(getattr(bug, "severidad", None)), "prioridad": _value(getattr(bug, "prioridad", None)),
            "criticidad": _value(getattr(bug, "criticidad", None)), "bloquea_release": bool(getattr(bug, "bloquea_release", False)), "origen": str(getattr(bug, "origen", "") or ""),
            "build": ref(getattr(bug, "build", None), "nombre"), "resolved_build": ref(getattr(bug, "resolved_build", None), "nombre"),
            "case": ref(getattr(bug, "caso", None), "titulo"), "test_run": ref(getattr(bug, "test_run", None), "nombre"),
            "execution_id": str(getattr(bug, "ejecucion_id", None)) if getattr(bug, "ejecucion_id", None) else None, "component": ref(getattr(bug, "componente", None), "nombre"),
            "created_at": getattr(bug, "created_at", None).isoformat() if getattr(bug, "created_at", None) else None, "updated_at": getattr(bug, "updated_at", None).isoformat() if getattr(bug, "updated_at", None) else None}


async def list_project_bugs(db, user, project, arguments):
    del user
    limit, offset = arguments.get("limit", MCP_BUG_MAX_ITEMS), arguments.get("offset", 0)
    query = select(models.BugIssue).options(*(selectinload(getattr(models.BugIssue, field)) for field in ("build", "resolved_build", "caso", "test_run", "componente"))).filter(models.BugIssue.proyecto_id == project.id)
    for field in ("build_id", "estado", "severidad", "prioridad"):
        if arguments.get(field) is not None:
            query = query.filter(getattr(models.BugIssue, field) == arguments[field])
    rows = (await db.execute(query.order_by(models.BugIssue.created_at.desc(), models.BugIssue.id).offset(offset).limit(limit + 1))).scalars().unique().all()
    return {"project_id": str(project.id), "items": [_serialize_bug(bug) for bug in rows[:limit]], "truncated": len(rows) > limit}


async def get_project_bug(db, user, project, arguments):
    del user
    bug = await db.scalar(select(models.BugIssue).options(*(selectinload(getattr(models.BugIssue, field)) for field in ("build", "resolved_build", "caso", "test_run", "componente"))).filter(models.BugIssue.id == UUID(arguments["bug_id"]), models.BugIssue.proyecto_id == project.id))
    if bug is None:
        raise LookupError("bug not found")
    return _serialize_bug(bug)


async def quality_summary(db, user, project, arguments):
    del user
    build_id = UUID(arguments["build_id"])
    from .mcp_metrics import build_counts, grouped
    counts = await build_counts(db, project.id, build_id)
    assigned = await db.scalar(select(func.count()).select_from(models.BuildCaso).join(models.Build).where(models.BuildCaso.build_id == build_id, models.Build.proyecto_id == project.id))
    conditions = (models.BugIssue.proyecto_id == project.id, models.BugIssue.build_id == build_id)
    statuses = await grouped(db, models.BugIssue.estado, *conditions)
    severities = await grouped(db, models.BugIssue.severidad, *conditions)
    return {"project_id": str(project.id), "build_id": str(build_id), "cases_assigned": assigned,
            **counts, "bugs": {"total": sum(statuses.values()), "by_status": statuses, "by_severity": severities}}


async def list_project_cases(db, user, project, arguments):
    del user
    limit, offset = arguments.get("limit", MCP_CASE_MAX_ITEMS), arguments.get("offset", 0)
    rows = (await db.execute(select(models.CasoPrueba.id, models.CasoPrueba.codigo, models.CasoPrueba.titulo,
                                    models.CasoPrueba.prioridad, models.CasoPrueba.estado_caso,
                                    models.CasoPrueba.tipo_prueba, models.CasoPrueba.formato_prueba,
                                    models.CasoPrueba.activo, models.CasoPrueba.componente_id,
                                    models.CasoPrueba.suite_id)
             .filter(models.CasoPrueba.proyecto_id == project.id)
             .order_by(models.CasoPrueba.codigo, models.CasoPrueba.id)
             .offset(offset).limit(limit + 1))).all()
    return {"project_id": str(project.id), "items": [
        {"id": str(row[0]), "codigo": row[1], "title": str(row[2] or ""),
         "priority": _value(row[3]), "status": _value(row[4]), "test_type": _value(row[5]),
         "format": _value(row[6]), "active": row[7],
         "component_id": str(row[8]) if row[8] else None,
         "suite_id": str(row[9]) if row[9] else None} for row in rows[:limit]
    ], "truncated": len(rows) > limit}


async def list_project_suites(db, user, project, arguments):
    del user
    limit, offset = arguments.get("limit", 100), arguments.get("offset", 0)
    query = (select(models.Suite, func.count(models.CasoPrueba.id))
             .outerjoin(models.CasoPrueba, models.CasoPrueba.suite_id == models.Suite.id)
             .where(models.Suite.proyecto_id == project.id))
    if not arguments.get("include_archived", False):
        query = query.where(models.Suite.activo.is_(True), models.Suite.archivado.is_(False))
    if arguments.get("component_id"):
        query = query.where(models.Suite.componente_id == UUID(arguments["component_id"]))
    rows = (await db.execute(query.group_by(models.Suite.id)
                              .order_by(models.Suite.parent_id, models.Suite.orden, models.Suite.nombre, models.Suite.id)
                              .offset(offset).limit(limit + 1))).all()
    truncated = len(rows) > limit
    return {"project_id": str(project.id), "items": [{
        "id": str(suite.id), "name": str(suite.nombre or ""),
        "description": str(suite.descripcion or ""), "parent_id": str(suite.parent_id) if suite.parent_id else None,
        "component_id": str(suite.componente_id) if suite.componente_id else None,
        "order": int(suite.orden or 0), "active": bool(suite.activo),
        "archived": bool(suite.archivado), "case_count": int(count),
    } for suite, count in rows[:limit]], "truncated": truncated,
        "next_offset": offset + limit if truncated else None}


async def get_project_case(db, user, project, arguments):
    del user
    case_id = UUID(arguments["case_id"])
    result = await db.execute(select(models.CasoPrueba).filter(models.CasoPrueba.id == case_id,
                                                                 models.CasoPrueba.proyecto_id == project.id))
    case = result.scalar_one_or_none()
    if case is None:
        raise LookupError("case not found")
    steps_result = await db.execute(select(models.PasoPrueba.numero_paso, models.PasoPrueba.accion,
                                           models.PasoPrueba.datos, models.PasoPrueba.resultado_esperado)
                                    .filter(models.PasoPrueba.caso_id == case.id)
                                    .order_by(models.PasoPrueba.numero_paso))
    result = _serialize_case(case, steps=steps_result.all())
    result["build_ids"] = [str(value) for value in (await db.execute(
        select(models.BuildCaso.build_id).where(models.BuildCaso.caso_id == case.id)
    )).scalars().all()]
    result["acceptance_criteria_ids"] = [str(value) for value in (await db.execute(
        select(models.AcceptanceCriterionCase.acceptance_criterion_id).where(
            models.AcceptanceCriterionCase.caso_master_id == case.master_id
        )
    )).scalars().all()]
    result["story_ids"] = [str(value) for value in (await db.execute(
        select(models.CasoHistoria.historia_id).where(models.CasoHistoria.caso_master_id == case.master_id)
    )).scalars().all()]
    return result


async def list_project_runs(db, user, project, arguments):
    del user
    limit, offset = arguments.get("limit", 100), arguments.get("offset", 0)
    rows = (await db.execute(select(models.TestRun).filter(models.TestRun.proyecto_id == project.id)
             .order_by(models.TestRun.fecha_creacion.desc(), models.TestRun.id).offset(offset).limit(limit + 1))).scalars().all()
    return {"project_id": str(project.id), "items": [_serialize_run(row) for row in rows[:limit]], "truncated": len(rows) > limit}


async def get_project_run(db, user, project, arguments):
    del user
    run = await db.scalar(select(models.TestRun).filter(models.TestRun.id == UUID(arguments["run_id"]), models.TestRun.proyecto_id == project.id))
    if run is None:
        raise LookupError("run not found")
    return _serialize_run(run)


async def list_project_results(db, user, project, arguments):
    del user
    run_id = UUID(arguments["run_id"])
    run = await db.scalar(select(models.TestRun).filter(models.TestRun.id == run_id, models.TestRun.proyecto_id == project.id))
    if run is None:
        raise LookupError("run not found")
    limit, offset = arguments.get("limit", 100), arguments.get("offset", 0)
    rows = (await db.execute(select(models.EjecucionCaso).filter(models.EjecucionCaso.test_run_id == run_id)
             .order_by(models.EjecucionCaso.fecha_ejecucion, models.EjecucionCaso.id).offset(offset).limit(limit + 1))).scalars().all()
    return {"project_id": str(project.id), "run_id": str(run_id), "items": [_serialize_result(row) for row in rows[:limit]], "truncated": len(rows) > limit}


async def get_project_result(db, user, project, arguments):
    del user
    execution = await db.scalar(select(models.EjecucionCaso).join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
                                .filter(models.EjecucionCaso.id == UUID(arguments["execution_id"]), models.TestRun.proyecto_id == project.id))
    if execution is None:
        raise LookupError("result not found")
    case = await db.scalar(select(models.CasoPrueba).filter(models.CasoPrueba.id == execution.caso_id, models.CasoPrueba.proyecto_id == project.id))
    snapshots = (await db.execute(select(models.SnapshotPaso).filter(models.SnapshotPaso.ejecucion_caso_id == execution.id).order_by(models.SnapshotPaso.numero_paso))).scalars().all()
    return _serialize_result(execution, case, snapshots, detail=True)


async def get_project_metadata(db, user, project):
    del db, user
    return {
        "id": str(project.id),
        "name": str(project.nombre or ""),
        "organization_id": str(project.organizacion_id),
    }


async def list_project_builds(db, user, project, arguments=None):
    del user
    arguments = arguments or {}
    limit, offset = arguments.get("limit", MCP_MAX_BUILD_ITEMS), arguments.get("offset", 0)
    rows = (
        await db.execute(
            select(
                models.Build.id,
                models.Build.nombre,
                models.Build.estado,
                models.Build.activo,
            )
            .filter(models.Build.proyecto_id == project.id)
            .order_by(models.Build.nombre, models.Build.id)
            .offset(offset).limit(limit + 1)
        )
    ).all()
    truncated = len(rows) > limit
    return {
        "project_id": str(project.id),
        "items": [
            {
                "id": str(build_id),
                "name": str(name or ""),
                "estado": estado,
                "activo": active,
            }
            for build_id, name, estado, active in rows[:limit]
        ],
        "truncated": truncated,
        "next_offset": offset + limit if truncated else None,
    }


async def list_build_cases(db, user, project, arguments):
    del user
    build_id = UUID(arguments["build_id"])
    build = await db.scalar(select(models.Build.id).where(
        models.Build.id == build_id, models.Build.proyecto_id == project.id,
    ))
    if build is None:
        raise LookupError("build not found in project")
    conditions = [models.BuildCaso.build_id == build_id, models.CasoPrueba.proyecto_id == project.id]
    if not arguments.get("include_inactive", False):
        conditions.extend((models.CasoPrueba.activo.is_(True), models.CasoPrueba.estado_caso != models.EstadoCaso.ARCHIVADO))
    total = await db.scalar(select(func.count()).select_from(models.BuildCaso)
                            .join(models.CasoPrueba, models.CasoPrueba.id == models.BuildCaso.caso_id)
                            .where(*conditions))
    limit, offset = arguments.get("limit", MCP_CASE_MAX_ITEMS), arguments.get("offset", 0)
    rows = (await db.execute(select(models.CasoPrueba)
        .join(models.BuildCaso, models.BuildCaso.caso_id == models.CasoPrueba.id)
        .where(*conditions)
        .order_by(models.CasoPrueba.codigo, models.CasoPrueba.version, models.CasoPrueba.id)
        .offset(offset).limit(limit + 1))).scalars().all()
    truncated = len(rows) > limit
    steps_by_case = {}
    if arguments.get("include_steps") and rows:
        step_rows = (await db.execute(
            select(models.PasoPrueba.caso_id, models.PasoPrueba.numero_paso,
                   models.PasoPrueba.accion, models.PasoPrueba.datos,
                   models.PasoPrueba.resultado_esperado)
            .where(models.PasoPrueba.caso_id.in_([case.id for case in rows[:limit]]))
            .order_by(models.PasoPrueba.caso_id, models.PasoPrueba.numero_paso)
        )).all()
        for case_id, number, action, data, expected in step_rows:
            steps_by_case.setdefault(str(case_id), []).append({
                "number": int(number), "action": _safe_text(action),
                "data": _safe_text(data), "expected_result": _safe_text(expected),
            })
    return {"project_id": str(project.id), "build_id": str(build_id), "total": int(total or 0),
        "items": [{"id": str(case.id), "codigo": case.codigo, "title": str(case.titulo or ""),
            "version": int(case.version or 1), "priority": _value(case.prioridad),
            "criticality": _value(case.criticidad), "test_type": _value(case.tipo_prueba),
            "format": _value(case.formato_prueba), "status": _value(case.estado_caso),
            "active": bool(case.activo), "component_id": str(case.componente_id) if case.componente_id else None,
            "suite_id": str(case.suite_id) if case.suite_id else None,
            "automation_framework": str(case.framework or "") or None,
            "has_automation_script": bool((case.script_automatizado or "").strip()),
            **({"steps": steps_by_case.get(str(case.id), [])} if arguments.get("include_steps") else {})}
            for case in rows[:limit]], "truncated": truncated,
        "next_offset": offset + limit if truncated else None}


HANDLERS = {
    "project.get": get_project_metadata,
    "builds.list": list_project_builds,
    "builds.cases.list": list_build_cases,
    "cases.list": list_project_cases,
    "suites.list": list_project_suites,
    "cases.get": get_project_case,
    "test-runs.list": list_project_runs,
    "test-runs.get": get_project_run,
    "test-results.list": list_project_results,
    "test-results.get": get_project_result,
    "bugs.list": list_project_bugs,
    "bugs.get": get_project_bug,
    "quality.summary": quality_summary,
    "cases.import.preview": preview_import_handler,
    "cases.import.commit": commit_import_handler,
    "cases.import.rollback": rollback_import_handler,
}
HANDLERS.update(EXTENDED_HANDLERS)
HANDLERS.update(MUTATION_HANDLERS)
