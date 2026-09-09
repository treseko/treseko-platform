"""Ephemeral Chatbot connection checks used by the conversational editor."""

from __future__ import annotations

from copy import deepcopy
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ... import access_control, auth, models, schemas
from ...database import get_db
from ...services.api_dynamic_variables import DynamicVariableContext
from ...services.chatbot_config import chatbot_config_errors, merge_chatbot_config
from ...services.chatbot_http import ApiTestRunnerError, redact_chatbot_exchange, send_chatbot_turn


router = APIRouter(tags=["Chatbot"])


@router.post("/proyectos/{proyecto_id}/chatbot/test-connection")
async def test_chatbot_connection(
    proyecto_id: UUID,
    payload: schemas.ChatbotConnectionTestRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.casos", "edit")),
):
    """Send one preview message without creating a TestRun or evidence row."""
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    environment = await db.get(models.Entorno, payload.entorno_id)
    if not environment or environment.proyecto_id != proyecto_id or not environment.activo:
        raise HTTPException(status_code=404, detail="Ambiente Chatbot no encontrado")

    # Environment configuration is the policy-bound source of connection
    # defaults. The request may contain a resolved case preview, but it cannot
    # escape the selected project/environment context.
    config = merge_chatbot_config(environment.configuracion_chatbot or {}, payload.configuration)
    validation_config = deepcopy(config)
    conversation = validation_config.setdefault("conversation", {})
    turns = conversation.get("turns") if isinstance(conversation.get("turns"), list) else []
    if not turns:
        conversation["turns"] = [{"input": {"mode": "fixed", "text": payload.message}}]
    errors = chatbot_config_errors(validation_config)
    if errors:
        raise HTTPException(status_code=422, detail="No se puede probar la conexión Chatbot: " + " ".join(errors))

    # Preview values may fill missing samples, but cannot replace values stored
    # in the selected environment.
    variables = {**(payload.variables or {}), **(getattr(environment, "variables", None) or {})}
    dynamic_context = DynamicVariableContext(payload.dynamic_seed or "chatbot-connection-test")
    try:
        result = await send_chatbot_turn(
            config=config,
            variables=variables,
            message=payload.message,
            session_id=payload.session_id,
            history=[],
            turn_index=1,
            base_url=environment.url,
            dynamic_variables=dynamic_context,
            environment=environment,
        )
    except ApiTestRunnerError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    safe_result = redact_chatbot_exchange(result)
    return {
        "status": result.get("status"),
        "ok": result.get("status") == "PASSED",
        "http_status": result.get("statusCode") or None,
        "latency_ms": result.get("latencyMs"),
        "message": result.get("responseText") or None,
        "session_id": result.get("session_id"),
        "session_detected": result.get("session_id_extracted") is True,
        "response_type": result.get("response_type"),
        "response_format": result.get("response_format"),
        "adapter": (config.get("connection") or {}).get("adapter"),
        "request": safe_result.get("request"),
        "response": safe_result.get("response"),
        "response_headers": safe_result.get("response_headers"),
        "extraction_error": result.get("extraction_error"),
        "error": result.get("error"),
        "response_truncated": result.get("response_truncated", False),
    }
