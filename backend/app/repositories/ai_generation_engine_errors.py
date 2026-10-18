"""Safe, actionable error details returned by the AI Engine generation APIs."""

from __future__ import annotations


_ENGINE_ERROR_MESSAGES = {
    "AI_PROVIDER_TIMEOUT": "El proveedor IA superó el tiempo límite del workflow. Aumenta el timeout del nodo o del perfil, o usa un modelo más rápido.",
    "AI_PROVIDER_RATE_LIMITED": "El proveedor IA limitó las solicitudes. Espera un momento y vuelve a intentarlo.",
    "AI_PROVIDER_UNAUTHORIZED": "Las credenciales del proveedor IA no son válidas. Revisa el perfil seleccionado.",
    "AI_PROVIDER_FORBIDDEN": "El proveedor IA rechazó el acceso. Revisa los permisos y el perfil seleccionado.",
    "AI_PROVIDER_PAYMENT_REQUIRED": "El proveedor IA requiere una cuenta o cuota activa.",
    "AI_PROVIDER_INVALID_RESPONSE": "El proveedor IA respondió con un formato no válido. Revisa el modelo y su compatibilidad con salida estructurada.",
    "AI_PROVIDER_UNAVAILABLE": "El proveedor IA no está disponible. Revisa la conexión y vuelve a intentarlo.",
    "STORY_ANALYSIS_AUDIT_INVALID": "No se pudo comprobar si las dudas y supuestos del análisis están respaldados por las fuentes. Revisa el workflow y vuelve a analizar; no se habilitó la generación.",
    "STORY_ANALYSIS_AUDIT_TIMEOUT": "La revisión de dudas y supuestos agotó el tiempo del nodo. Aumenta su timeout o usa un modelo más rápido; no se habilitó la generación.",
}

_ANALYSIS_AUDIT_ISSUES = {
    "AUDIT_RESPONSE_SHAPE_INVALID": "El revisor no devolvió el formato de decisiones requerido.",
    "AUDIT_QUESTION_COUNT_MISMATCH": "El revisor no evaluó todas las preguntas.",
    "AUDIT_ASSUMPTION_COUNT_MISMATCH": "El revisor no evaluó todos los supuestos.",
    "AUDIT_QUESTION_MISMATCH": "El revisor cambió el orden o el texto de una pregunta.",
    "AUDIT_QUESTION_STATUS_INVALID": "El revisor devolvió un estado de pregunta no válido.",
    "AUDIT_QUESTION_EVIDENCE_INVALID": "El revisor citó texto que no aparece en las fuentes.",
    "AUDIT_ANSWER_EVIDENCE_MISSING": "El revisor marcó una pregunta como respondida sin cita literal.",
    "AUDIT_UNRESOLVED_ANSWER_PRESENT": "El revisor agregó una respuesta a una pregunta que dejó abierta.",
    "AUDIT_ASSUMPTION_MISMATCH": "El revisor cambió el orden o el identificador de un supuesto.",
    "AUDIT_ASSUMPTION_STATUS_INVALID": "El revisor devolvió un estado de supuesto no válido.",
    "AUDIT_ASSUMPTION_EVIDENCE_INVALID": "El revisor citó texto que no aparece en las fuentes.",
    "AUDIT_EXPLICIT_ASSUMPTION_EVIDENCE_MISSING": "El revisor marcó un supuesto como explícito sin cita literal.",
}


def engine_error_code(payload: object) -> str:
    if not isinstance(payload, dict):
        return ""
    error = payload.get("error")
    nested = error if isinstance(error, dict) else {}
    return str(
        payload.get("code")
        or payload.get("error_code")
        or nested.get("error_code")
        or nested.get("code")
        or ""
    ).strip()


def engine_generation_error_message(payload: object) -> str | None:
    code = engine_error_code(payload)
    message = _ENGINE_ERROR_MESSAGES.get(code)
    if not message or code not in {"STORY_ANALYSIS_AUDIT_INVALID", "STORY_ANALYSIS_AUDIT_TIMEOUT"}:
        return message
    error = payload.get("error") if isinstance(payload, dict) else None
    details = error.get("details") if isinstance(error, dict) and isinstance(error.get("details"), dict) else {}
    issue = _ANALYSIS_AUDIT_ISSUES.get(str(details.get("validation_issue") or ""))
    return f"{message} {issue}" if issue else message


def engine_contract_issues(payload: object) -> list[str]:
    if not isinstance(payload, dict):
        return []
    error = payload.get("error")
    nested = error if isinstance(error, dict) else {}
    details = nested.get("details") if isinstance(nested.get("details"), dict) else {}
    issues = payload.get("contract_issues") or details.get("contract_issues") or []
    return [str(item).strip() for item in issues if str(item).strip()] if isinstance(issues, list) else []
