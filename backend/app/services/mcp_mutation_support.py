"""Shared validation and serialization for governed MCP mutations."""
from typing import Any
from uuid import UUID

SUPPORTED_FORMATS = {'CLASICA', 'API'}

def _assert_supported(case):
    fmt = str(_value(case.formato_prueba) or "").upper()
    if fmt not in SUPPORTED_FORMATS:
        raise ValueError("MCP solo admite casos CLASICA o API; el formato solicitado no está soportado")

def _bug_transition_payload(arguments) -> dict[str, Any]:
    source = arguments.get("transition") or {}
    names = {"status": "estado", "resolution": "resolucion", "close_reason": "motivo_cierre"}
    return {str(names.get(key, key)): value for key, value in source.items()}

def _bug_update_payload(arguments) -> dict[str, Any]:
    source = arguments.get("bug") or {}
    names = {
        "title": "titulo", "description": "descripcion", "severity": "severidad",
        "priority": "prioridad", "status": "estado", "expected_result": "resultado_esperado",
        "actual_result": "resultado_obtenido", "test_data": "datos_prueba", "comment": "comentario",
    }
    return {str(names.get(key, key)): value for key, value in source.items()}

def _confirm(arguments, expected):
    if arguments.get("confirmation") != expected:
        raise ValueError("confirmación explícita requerida")

def _serialize_bug(bug):
    return {"id": str(bug.id), "project_id": str(bug.proyecto_id), "title": str(bug.titulo or "")[:1024], "status": _value(bug.estado), "severity": _value(bug.severidad)}

def _serialize_case(case):
    return {"id": str(case.id), "master_id": str(case.master_id), "title": str(case.titulo or "")[:4096], "version": case.version, "format": _value(case.formato_prueba), "test_type": _value(case.tipo_prueba), "active": bool(case.activo)}

def _serialize_run(run):
    return {"id": str(run.id), "project_id": str(run.proyecto_id), "build_id": str(run.build_id) if run.build_id else None, "name": str(run.nombre or "")[:256], "status": _value(run.estado_run)}

def _uuid(value, name):
    try:
        return UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        raise ValueError(f"{name} debe ser UUID") from None

def _validate_case_automation(fmt, test_type, automation_script, automation_framework, api_configuration=None):
    fmt = str(fmt or "CLASICA").upper()
    test_type = str(test_type or "MANUAL").upper()
    if fmt == "API" and (automation_script or automation_framework):
        raise ValueError("Los casos API usan api_configuration, no scripts de navegador")
    if bool(automation_script) != bool(automation_framework):
        raise ValueError("automation_script y automation_framework deben enviarse juntos")
    if automation_script and (fmt != "CLASICA" or test_type != "AUTOMATIZADA"):
        raise ValueError("Los scripts Playwright solo corresponden a casos CLASICA AUTOMATIZADA")
    if fmt == "CLASICA" and test_type == "AUTOMATIZADA" and (not automation_script or not automation_framework):
        raise ValueError("Un caso clásico AUTOMATIZADA requiere automation_script y automation_framework")
    if automation_script or automation_framework:
        from .mcp_import import _validate_ai_package
        _validate_ai_package({"cases": [{"formato_prueba": fmt, "tipo_prueba": test_type,
                                          "script_automatizado": automation_script,
                                          "framework": automation_framework,
                                          "configuracion_api": api_configuration or {}}]})

def _value(value):
    return getattr(value, "value", value)
