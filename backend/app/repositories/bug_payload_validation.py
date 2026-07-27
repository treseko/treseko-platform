from .repository_context import *

def _normalize_bug_text(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def _bug_payload_dict(payload: schemas.BugIssueCreate | schemas.BugIssueUpdate) -> Dict[str, Any]:
    return payload.model_dump(exclude_unset=isinstance(payload, schemas.BugIssueUpdate))


def compute_bug_dedupe_hash(data: Dict[str, Any]) -> str:
    base = "|".join([
        str(data.get("proyecto_id") or ""),
        str(data.get("componente_id") or ""),
        str(data.get("build_id") or ""),
        str(data.get("caso_id") or ""),
        str(data.get("numero_paso") or ""),
        _normalize_bug_text(data.get("titulo")),
        _normalize_bug_text(data.get("error_tecnico")),
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
        selectinload(models.BugIssue.comments).selectinload(models.BugComment.attachments).selectinload(models.BugAttachment.attachment),
        selectinload(models.BugIssue.attachments).selectinload(models.BugAttachment.attachment),
        selectinload(models.BugIssue.external_links),
    )
