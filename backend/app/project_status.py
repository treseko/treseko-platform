PROJECT_STATUS_BY_LABEL = {
    "planificacion": "Planificacion",
    "activo": "Activo",
    "en qa": "En QA",
    "bloqueado": "Bloqueado",
    "mantenimiento": "Mantenimiento",
    "en pausa": "En Pausa",
    "cerrado": "Cerrado",
    "archivado": "Archivado",
}

PROJECT_ACTIVE_STATUSES = {"Activo", "En QA"}


def normalize_project_status(value: str | None, activo: bool | None = None) -> str:
    raw = str(value or "").strip()
    if raw:
        normalized = PROJECT_STATUS_BY_LABEL.get(raw.lower())
        if not normalized:
            raise ValueError("Estado de proyecto invalido")
        return normalized
    return "Activo" if activo is not False else "En Pausa"


def is_project_active_status(value: str | None) -> bool:
    return normalize_project_status(value) in PROJECT_ACTIVE_STATUSES
