"""Native read-only MCP handlers.

Handlers receive only already-authorized context; they never inspect credentials or
raw requests and are deliberately not a general-purpose adapter registry.
"""

from __future__ import annotations

import re
from uuid import UUID

from sqlalchemy import func, select

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
    text = str(value or "")
    text = re.sub(r"(?i)(bearer\s+)[^\s,;]+", r"\1[REDACTED]", text)
    text = re.sub(r"(?i)(password|passwd|secret|token|api[_-]?key|client[_-]?secret)\s*[:=]\s*([^\s,;]+)", r"\1=[REDACTED]", text)
    return text[:limit]


def _safe_report(value, depth=0):
    """Preserve test evidence while removing credential material only."""
    if depth > 8:
        return "[max-depth]"
    if isinstance(value, dict):
        out = {}
        for key, item in list(value.items())[:100]:
            name = str(key)
            if any(part in name.lower() for part in _SECRET_KEYS):
                out[name[:80]] = "[REDACTED]"
            else:
                out[name[:120]] = _safe_report(item, depth + 1)
        return out
    if isinstance(value, list):
        return [_safe_report(item, depth + 1) for item in value[:100]]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value if not isinstance(value, str) else value[:16000]
    return str(value)[:200]


def _serialize_run(run):
    return {"id": str(run.id), "project_id": str(run.proyecto_id), "build_id": str(run.build_id) if run.build_id else None,
            "name": str(run.nombre or "")[:MCP_RUN_TEXT_MAX_CHARS], "environment": str(run.entorno or "")[:MCP_RUN_TEXT_MAX_CHARS],
            "origin": str(run.origen or "")[:80], "external_run_id": str(run.external_run_id)[:MCP_RUN_TEXT_MAX_CHARS] if run.external_run_id else None,
            "status": _value(run.estado_run), "created_at": run.fecha_creacion.isoformat() if run.fecha_creacion else None,
            "closed_at": run.fecha_cierre.isoformat() if run.fecha_cierre else None}


def _serialize_result(execution, case=None, snapshots=None, *, detail=False):
    result = {"id": str(execution.id), "run_id": str(execution.test_run_id), "case": {"id": str(case.id), "codigo": case.codigo, "title": str(case.titulo or "")[:MCP_RUN_TEXT_MAX_CHARS]} if case else {"id": str(execution.caso_id)},
            "version": execution.version_ejecutada, "status": _value(execution.estado_resultado), "execution_mode": _value(execution.execution_mode),
            "attempt": execution.intento_numero, "duration_seconds": execution.duracion_segundos,
            "observations": str(execution.observaciones or "")[:MCP_OBSERVATIONS_MAX_CHARS],
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
              "title": str(case.titulo or "")[:MCP_CASE_TEXT_MAX_CHARS],
              "description": str(case.descripcion or "")[:MCP_CASE_TEXT_MAX_CHARS],
              "preconditions": str(case.precondiciones or "")[:MCP_CASE_TEXT_MAX_CHARS],
              "postconditions": str(case.postcondiciones or "")[:MCP_CASE_TEXT_MAX_CHARS],
              "version": case.version, "priority": _value(case.prioridad),
              "criticality": _value(case.criticidad), "test_type": _value(case.tipo_prueba),
              "format": _value(case.formato_prueba), "status": _value(case.estado_caso),
              "active": case.activo}
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
            result["name"] = str(getattr(value, name, "") or "")[:MCP_RUN_TEXT_MAX_CHARS]
        return result
    return {"id": str(bug.id), "codigo": str(getattr(bug, "codigo", "") or "")[:80], "project_id": str(getattr(bug, "proyecto_id", "")),
            "title": str(getattr(bug, "titulo", "") or "")[:MCP_BUG_TEXT_MAX_CHARS], "description": str(getattr(bug, "descripcion", "") or "")[:MCP_BUG_TEXT_MAX_CHARS],
            "estado": _value(getattr(bug, "estado", None)), "severidad": _value(getattr(bug, "severidad", None)), "prioridad": _value(getattr(bug, "prioridad", None)),
            "criticidad": _value(getattr(bug, "criticidad", None)), "bloquea_release": bool(getattr(bug, "bloquea_release", False)), "origen": str(getattr(bug, "origen", "") or "")[:80],
            "build": ref(getattr(bug, "build", None), "nombre"), "resolved_build": ref(getattr(bug, "resolved_build", None), "nombre"),
            "case": ref(getattr(bug, "caso", None), "titulo"), "test_run": ref(getattr(bug, "test_run", None), "nombre"),
            "execution_id": str(getattr(bug, "ejecucion_id", None)) if getattr(bug, "ejecucion_id", None) else None, "component": ref(getattr(bug, "componente", None), "nombre"),
            "created_at": getattr(bug, "created_at", None).isoformat() if getattr(bug, "created_at", None) else None, "updated_at": getattr(bug, "updated_at", None).isoformat() if getattr(bug, "updated_at", None) else None}


async def list_project_bugs(db, user, project, arguments):
    del user
    limit, offset = arguments.get("limit", MCP_BUG_MAX_ITEMS), arguments.get("offset", 0)
    query = select(models.BugIssue).filter(models.BugIssue.proyecto_id == project.id)
    for field in ("build_id", "estado", "severidad", "prioridad"):
        if arguments.get(field) is not None:
            query = query.filter(getattr(models.BugIssue, field) == arguments[field])
    rows = (await db.execute(query.order_by(models.BugIssue.created_at.desc(), models.BugIssue.id).offset(offset).limit(limit + 1))).scalars().unique().all()
    return {"project_id": str(project.id), "items": [_serialize_bug(bug) for bug in rows[:limit]], "truncated": len(rows) > limit}


async def get_project_bug(db, user, project, arguments):
    del user
    bug = await db.scalar(select(models.BugIssue).filter(models.BugIssue.id == UUID(arguments["bug_id"]), models.BugIssue.proyecto_id == project.id))
    if bug is None:
        raise LookupError("bug not found")
    return _serialize_bug(bug)


async def quality_summary(db, user, project, arguments):
    del user
    build_id = UUID(arguments["build_id"])
    assigned = (await db.execute(select(models.BuildCaso.caso_id).join(models.Build, models.Build.id == models.BuildCaso.build_id).filter(models.BuildCaso.build_id == build_id, models.Build.proyecto_id == project.id))).scalars().all()
    runs = (await db.execute(select(models.TestRun).filter(models.TestRun.proyecto_id == project.id, models.TestRun.build_id == build_id))).scalars().all()
    run_ids = [run.id for run in runs]
    results = (await db.execute(select(models.EjecucionCaso).filter(models.EjecucionCaso.test_run_id.in_(run_ids)))).scalars().all() if run_ids else []
    bugs = (await db.execute(select(models.BugIssue).filter(models.BugIssue.proyecto_id == project.id, models.BugIssue.build_id == build_id))).scalars().all()
    def counts(items, field):
        out = {}
        for item in items:
            key = str(_value(getattr(item, field, None)) or "N/D")
            out[key] = out.get(key, 0) + 1
        return out
    return {"project_id": str(project.id), "build_id": str(build_id), "cases_assigned": len(assigned),
            "runs": {"total": len(runs), "by_status": counts(runs, "estado_run")},
            "results": {"total": len(results), "by_status": counts(results, "estado_resultado")},
            "bugs": {"total": len(bugs), "by_status": counts(bugs, "estado"), "by_severity": counts(bugs, "severidad")}}


async def list_project_cases(db, user, project, arguments):
    del user
    limit, offset = arguments.get("limit", MCP_CASE_MAX_ITEMS), arguments.get("offset", 0)
    rows = (await db.execute(select(models.CasoPrueba.id, models.CasoPrueba.codigo, models.CasoPrueba.titulo,
                                    models.CasoPrueba.prioridad, models.CasoPrueba.estado_caso,
                                    models.CasoPrueba.tipo_prueba, models.CasoPrueba.formato_prueba,
                                    models.CasoPrueba.activo)
             .filter(models.CasoPrueba.proyecto_id == project.id)
             .order_by(models.CasoPrueba.codigo, models.CasoPrueba.id)
             .offset(offset).limit(limit + 1))).all()
    return {"project_id": str(project.id), "items": [
        {"id": str(row[0]), "codigo": row[1], "title": str(row[2] or "")[:MCP_CASE_TEXT_MAX_CHARS],
         "priority": _value(row[3]), "status": _value(row[4]), "test_type": _value(row[5]),
         "format": _value(row[6]), "active": row[7]} for row in rows[:limit]
    ], "truncated": len(rows) > limit}


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
    return _serialize_case(case, steps=steps_result.all())


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
        "name": str(project.nombre or "")[:MCP_BUILD_NAME_MAX_CHARS],
        "organization_id": str(project.organizacion_id),
    }


async def list_project_builds(db, user, project):
    del user
    rows = (
        await db.execute(
            select(
                models.Build.id,
                func.substr(models.Build.nombre, 1, MCP_BUILD_NAME_MAX_CHARS),
                models.Build.estado,
                models.Build.activo,
            )
            .filter(models.Build.proyecto_id == project.id)
            .order_by(models.Build.nombre)
            .limit(MCP_MAX_BUILD_ITEMS + 1)
        )
    ).all()
    truncated = len(rows) > MCP_MAX_BUILD_ITEMS
    return {
        "project_id": str(project.id),
        "items": [
            {
                "id": str(build_id),
                "name": str(name or "")[:MCP_BUILD_NAME_MAX_CHARS],
                "estado": estado,
                "activo": active,
            }
            for build_id, name, estado, active in rows[:MCP_MAX_BUILD_ITEMS]
        ],
        "truncated": truncated,
    }


HANDLERS = {
    "project.get": get_project_metadata,
    "builds.list": list_project_builds,
    "cases.list": list_project_cases,
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
