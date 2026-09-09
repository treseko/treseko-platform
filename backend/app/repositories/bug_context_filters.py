from .repository_context import *
from sqlalchemy import exists


def apply_bug_context_filter(query, context_type: str):
    legacy_case = exists().where(
        models.CasoPrueba.id == models.BugIssue.caso_id,
        models.CasoPrueba.formato_prueba == models.FormatoPrueba.CONVERSACIONAL,
    )
    legacy_execution = exists().where(
        models.EjecucionCaso.id == models.BugIssue.ejecucion_id,
        models.EjecucionCaso.caso_id == models.CasoPrueba.id,
        models.CasoPrueba.formato_prueba == models.FormatoPrueba.CONVERSACIONAL,
    )
    legacy_chatbot = or_(legacy_case, legacy_execution)
    normalized = str(context_type).strip().upper()
    if normalized == "CONVERSACIONAL":
        return query.filter(or_(models.BugIssue.tipo_contexto == normalized, legacy_chatbot))
    if normalized == "CLASICO":
        return query.filter(
            or_(models.BugIssue.tipo_contexto.is_(None), models.BugIssue.tipo_contexto != "CONVERSACIONAL"),
            ~legacy_chatbot,
        )
    return query.filter(models.BugIssue.tipo_contexto == normalized)


async def mark_legacy_chatbot_items(db, items):
    candidates = [item for item in items if str(getattr(item, "tipo_contexto", "CLASICO") or "CLASICO").upper() not in {"CONVERSACIONAL", "API"}]
    if not candidates:
        return items
    case_ids = {item.caso_id for item in candidates if item.caso_id}
    chatbot_ids = set((await db.execute(select(models.CasoPrueba.id).filter(models.CasoPrueba.id.in_(case_ids), models.CasoPrueba.formato_prueba == models.FormatoPrueba.CONVERSACIONAL))).scalars().all()) if case_ids else set()
    execution_ids = {item.ejecucion_id for item in candidates if item.ejecucion_id}
    chatbot_execution_ids = set((await db.execute(select(models.EjecucionCaso.id).join(models.CasoPrueba, models.CasoPrueba.id == models.EjecucionCaso.caso_id).filter(models.EjecucionCaso.id.in_(execution_ids), models.CasoPrueba.formato_prueba == models.FormatoPrueba.CONVERSACIONAL))).scalars().all()) if execution_ids else set()
    for item in items:
        if item.caso_id in chatbot_ids or item.ejecucion_id in chatbot_execution_ids:
            item.tipo_contexto = "CONVERSACIONAL"
    remaining = [item for item in candidates if item.caso_id not in chatbot_ids and item.ejecucion_id not in chatbot_execution_ids]
    if remaining:
        api_case_ids = set((await db.execute(
            select(models.CasoPrueba.id).filter(
                models.CasoPrueba.id.in_({item.caso_id for item in remaining if item.caso_id}),
                models.CasoPrueba.formato_prueba == models.FormatoPrueba.API,
            )
        )).scalars().all()) if any(item.caso_id for item in remaining) else set()
        api_execution_ids = set((await db.execute(
            select(models.EjecucionCaso.id).join(
                models.CasoPrueba, models.CasoPrueba.id == models.EjecucionCaso.caso_id,
            ).filter(
                models.EjecucionCaso.id.in_({item.ejecucion_id for item in remaining if item.ejecucion_id}),
                models.CasoPrueba.formato_prueba == models.FormatoPrueba.API,
            )
        )).scalars().all()) if any(item.ejecucion_id for item in remaining) else set()
        for item in remaining:
            metadata = item.metadata_json if isinstance(getattr(item, "metadata_json", None), dict) else {}
            if item.caso_id in api_case_ids or item.ejecucion_id in api_execution_ids or str(metadata.get("format") or "").upper() == "API":
                item.tipo_contexto = "API"
    return items
