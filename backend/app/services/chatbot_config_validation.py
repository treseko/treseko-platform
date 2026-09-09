"""Validation rules for normalized conversational test configuration."""

from __future__ import annotations

from typing import Any


def chatbot_config_errors(value: dict[str, Any] | None) -> list[str]:
    # Import lazily through the public configuration module so normalization
    # stays the single source of truth without creating an import cycle.
    from .chatbot_config import (
        SUPPORTED_CHATBOT_ADAPTERS,
        SUPPORTED_HTTP_METHODS,
        SUPPORTED_RESPONSE_FORMATS,
        SUPPORTED_SESSION_MODES,
        SUPPORTED_TOOL_OBSERVATION_MODES,
        _normalize_reusable_profiles,
        normalize_chatbot_config,
    )
    from .api_dynamic_variables import extract_unsupported_dynamic_variable_names

    config = normalize_chatbot_config(value)
    if not config:
        return ["La configuración Chatbot está vacía."]
    unsupported_dynamic = extract_unsupported_dynamic_variable_names(config)
    if unsupported_dynamic:
        return [
            "Variables dinámicas no soportadas en el caso Chatbot: "
            + ", ".join(sorted(unsupported_dynamic))
            + ". Usá el selector de variables dinámicas disponible en los campos de entrada."
        ]
    connection = config.get("connection") or {}
    adapter = str(connection.get("adapter") or "http").strip().lower().replace("-", "_")
    if adapter == "generic":
        adapter = "generic_http"
    if adapter not in SUPPORTED_CHATBOT_ADAPTERS:
        return [f"Adapter Chatbot no soportado: {adapter}."]
    endpoint = str(connection.get("endpoint") or "").strip()
    if not endpoint and not str(connection.get("base_url") or "").strip():
        return ["Falta el endpoint HTTP del chatbot."]
    selected_id = config.get("profile_id") or config.get("default_profile")
    if selected_id and not any(item.get("id") == selected_id for item in _normalize_reusable_profiles(config.get("profiles"))):
        return [f"El perfil Chatbot seleccionado no existe: {selected_id}. Configurá un perfil válido o ejecutá manualmente con mensajes fijos."]
    method = str(connection.get("method") or "POST").upper()
    if method not in SUPPORTED_HTTP_METHODS:
        return [f"Método HTTP no soportado: {method}."]
    if adapter == "openai_compatible" and method != "POST":
        return ["El adapter openai_compatible requiere método POST."]
    if adapter == "openai_compatible" and not str(
        connection.get("model") or config.get("model") or (config.get("profile") or {}).get("model") or ""
    ).strip():
        return ["El adapter openai_compatible requiere indicar el model."]
    mapping = connection.get("response_mapping") if isinstance(connection.get("response_mapping"), dict) else {}
    response_format = str(mapping.get("response_format") or "auto").strip().lower()
    if response_format not in SUPPORTED_RESPONSE_FORMATS:
        return [f"Formato de respuesta no soportado: {response_format}. Usá auto, json o text."]
    session_mode = str((config.get("conversation") or {}).get("session_mode") or "reuse").strip().lower()
    if session_mode not in SUPPORTED_SESSION_MODES:
        return [f"Modo de sesión no soportado: {session_mode}. Usá reuse o new_each_turn."]
    conversation = config.get("conversation") or {}
    opening = conversation.get("opening_message") or {}
    turns = conversation.get("turns") or []
    if not opening.get("text") and not turns:
        return ["El caso Chatbot debe tener al menos un turno."]
    for index, turn in enumerate(turns, start=1):
        payload = turn.get("input") if isinstance(turn, dict) else {}
        if not isinstance(payload, dict):
            return [f"El turno {index} tiene una entrada inválida."]
        if payload.get("mode", "fixed") == "fixed" and not str(payload.get("text") or "").strip():
            return [f"El turno {index} no tiene mensaje."]
        if payload.get("mode", "fixed") not in {"fixed", "profile_generated"}:
            return [f"Modo de entrada no soportado en el turno {index}."]
    for index, tool in enumerate(config.get("tools") or [], start=1):
        observation = tool.get("observation") if isinstance(tool.get("observation"), dict) else {}
        mode = str(observation.get("mode") or "black_box").lower()
        if mode not in SUPPORTED_TOOL_OBSERVATION_MODES:
            return [f"Modo de observación no soportado para la herramienta {index}: {mode}."]
        if mode == "external_trace":
            return [f"La trazabilidad externa de la herramienta {index} todavía no está disponible."]
        if mode == "response_payload" and observation.get("required"):
            calls_path = str(observation.get("tool_calls_path") or mapping.get("tool_calls_path") or "").strip()
            result_path = str(observation.get("tool_result_path") or mapping.get("tool_result_path") or "").strip()
            if not calls_path:
                return [f"La herramienta {index} requiere una ruta de tool calls para poder observarla."]
            if tool.get("expected_result") is not None and not result_path:
                return [f"La herramienta {index} requiere una ruta de resultado para poder comparar su fixture."]
    return []
