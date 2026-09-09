from .repository_context import *

def _normalize_bug_text(value: Optional[str]) -> str:
    # Versiones y otros campos de contexto pueden llegar como enteros desde
    # snapshots antiguos; la normalización debe ser total y no romper el
    # cálculo de deduplicación.
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def _bug_payload_dict(payload: schemas.BugIssueCreate | schemas.BugIssueUpdate) -> Dict[str, Any]:
    return payload.model_dump(exclude_unset=isinstance(payload, schemas.BugIssueUpdate))


def normalize_chatbot_finding_type(value: Optional[str]) -> str:
    normalized = str(value or "OTHER").strip().upper()
    return normalized if normalized in schemas.CHATBOT_BUG_FINDING_TYPES else "OTHER"


def compute_bug_dedupe_hash(data: Dict[str, Any]) -> str:
    base = "|".join([
        str(data.get("proyecto_id") or ""),
        str(data.get("componente_id") or ""),
        str(data.get("build_id") or ""),
        str(data.get("caso_id") or ""),
        str(data.get("numero_paso") or ""),
        str(data.get("chatbot_turn_index") if data.get("chatbot_turn_index") is not None else "execution"),
        _normalize_bug_text(data.get("chatbot_finding_type")),
        _normalize_bug_text(data.get("titulo")),
        _normalize_bug_text(data.get("error_tecnico")),
        _normalize_bug_text(data.get("resultado_obtenido") or data.get("descripcion")),
    ])
    return hashlib.sha256(base.encode("utf-8")).hexdigest()


def compute_conversational_bug_dedupe_hash(data: Dict[str, Any]) -> str:
    base = "|".join([
        str(data.get("proyecto_id") or ""),
        str(data.get("case_master_id") or data.get("caso_id") or ""),
        _normalize_bug_text(data.get("case_version") or data.get("version_app")),
        _normalize_bug_text(data.get("chatbot_finding_type")),
        str(data.get("chatbot_turn_index") if data.get("chatbot_turn_index") is not None else "execution"),
        _normalize_bug_text(data.get("error_tecnico")),
        _normalize_bug_text(data.get("resultado_esperado")),
        _normalize_bug_text(data.get("resultado_obtenido") or data.get("descripcion")),
    ])
    return hashlib.sha256(base.encode("utf-8")).hexdigest()


def _validate_bug_payload(data: Dict[str, Any], from_failure: bool = False) -> None:
    if not _normalize_bug_text(data.get("titulo")):
        raise ValueError("El bug debe tener titulo.")
    if not data.get("proyecto_id"):
        raise ValueError("El bug debe estar asociado a un proyecto.")
    if not data.get("build_id") and not _normalize_bug_text(data.get("build_code")) and not _normalize_bug_text(data.get("version_app")):
        raise ValueError("El bug debe tener build o contexto de version.")
    if not _normalize_bug_text(data.get("resultado_esperado")):
        raise ValueError("El bug debe incluir resultado esperado.")
    if not _normalize_bug_text(data.get("resultado_obtenido") or data.get("descripcion") or data.get("error_tecnico")):
        raise ValueError("El bug debe incluir resultado obtenido, descripcion del fallo o error tecnico.")
    if not _normalize_bug_text(data.get("pasos_reproduccion")) and not data.get("snapshot_id") and not data.get("caso_id"):
        raise ValueError("El bug debe incluir pasos de reproduccion o trazabilidad a caso/snapshot.")
    if str(data.get("severidad") or "").upper() not in BUG_ALLOWED_SEVERITIES:
        raise ValueError("Severidad invalida.")
    if str(data.get("prioridad") or "").upper() not in BUG_ALLOWED_PRIORITIES:
        raise ValueError("Prioridad invalida.")
    if from_failure and not (
        _normalize_bug_text(data.get("notas_qa"))
        or _normalize_bug_text(data.get("logs_relevantes"))
        or _normalize_bug_text(data.get("error_tecnico"))
        or _normalize_bug_text(data.get("descripcion"))
        or data.get("snapshot_id")
    ):
        raise ValueError("Un bug creado desde un fallo requiere evidencia, comentario o contexto del snapshot.")


def _bug_options():
    return (
        selectinload(models.BugIssue.build),
        selectinload(models.BugIssue.resolved_build),
        selectinload(models.BugIssue.caso),
        selectinload(models.BugIssue.componente),
        selectinload(models.BugIssue.comments).selectinload(models.BugComment.autor),
        selectinload(models.BugIssue.comments).selectinload(models.BugComment.attachments).selectinload(models.BugAttachment.attachment),
        selectinload(models.BugIssue.attachments).selectinload(models.BugAttachment.attachment),
        selectinload(models.BugIssue.external_links),
        selectinload(models.BugIssue.conversational_context),
    )
