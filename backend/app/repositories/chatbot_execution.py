from copy import deepcopy

from .repository_context import *
from .ai_workflow_serialization import _load_workflow, _workflow_definition
from .ai_workflow_versions import get_ai_workflow_version
from ..services.chatbot_config import (
    SYSTEM_CHATBOT_PROFILES,
    chatbot_config_errors,
    chatbot_required_variables,
    merge_chatbot_config,
    normalize_chatbot_config,
    resolve_chatbot_profile,
)
from ..services.api_dynamic_variables import DynamicVariableContext, safe_dynamic_values
from ..services.chatbot_http import interpolate_chatbot


def _has_profile_generated_turn(config: dict) -> bool:
    conversation = config.get("conversation") if isinstance(config, dict) else {}
    turns = conversation.get("turns") if isinstance(conversation, dict) else []
    return any(
        isinstance(turn, dict)
        and isinstance(turn.get("input"), dict)
        and str(turn["input"].get("mode") or "fixed") == "profile_generated"
        for turn in (turns if isinstance(turns, list) else [])
    )


def _resolve_chatbot_dynamic_inputs(
    config: dict,
    variables: dict,
    dynamic_variables: DynamicVariableContext | None,
) -> dict:
    """Resolve dynamic values only in executable inputs, never expectations."""
    if dynamic_variables is None:
        return config
    resolved = deepcopy(config)
    connection = resolved.get("connection") if isinstance(resolved.get("connection"), dict) else {}
    for key in ("endpoint", "url", "base_url", "headers", "request_template", "request_body"):
        if key in connection:
            connection[key] = interpolate_chatbot(
                connection[key], variables, dynamic_variables=dynamic_variables, source=f"chatbot.connection.{key}"
            )
    resolved["connection"] = connection
    for key in ("endpoint", "url", "base_url", "headers", "request_template", "request_body"):
        if key in resolved:
            resolved[key] = interpolate_chatbot(
                resolved[key], variables, dynamic_variables=dynamic_variables, source=f"chatbot.{key}"
            )
    conversation = resolved.get("conversation") if isinstance(resolved.get("conversation"), dict) else {}
    opening = conversation.get("opening_message") if isinstance(conversation.get("opening_message"), dict) else {}
    if "text" in opening:
        opening["text"] = interpolate_chatbot(
            opening["text"], variables, dynamic_variables=dynamic_variables, source="chatbot.opening_message"
        )
    conversation["opening_message"] = opening
    turns = conversation.get("turns") if isinstance(conversation.get("turns"), list) else []
    for index, turn in enumerate(turns, start=1):
        if not isinstance(turn, dict) or not isinstance(turn.get("input"), dict):
            continue
        input_payload = turn["input"]
        if "text" in input_payload:
            input_payload["text"] = interpolate_chatbot(
                input_payload["text"], variables, dynamic_variables=dynamic_variables, source=f"chatbot.turn.{index}"
            )
    conversation["turns"] = turns
    resolved["conversation"] = conversation
    return resolved


async def resolve_chatbot_workflow(db: AsyncSession, case: models.CasoPrueba, default_definition: dict | None) -> dict | None:
    """Resolve and freeze an optional case workflow/version override."""
    config = case.configuracion_chatbot if isinstance(case.configuracion_chatbot, dict) else {}
    override = config.get("workflow_override") or config.get("workflow") or {}
    if not isinstance(override, dict):
        override = {}
    requested_id = override.get("id") or override.get("workflow_id") or config.get("workflow_id")
    requested_version = override.get("version") or override.get("workflow_version") or config.get("workflow_version")
    if not requested_id and requested_version is None:
        return default_definition
    fallback_meta = (default_definition or {}).get("workflow") if isinstance(default_definition, dict) else {}
    workflow_id = requested_id or (fallback_meta or {}).get("id")
    workflow = await _load_workflow(db, UUID(str(workflow_id))) if workflow_id else None
    if not workflow or workflow.status != "ACTIVE" or workflow.workflow_purpose != "chatbot_evaluation":
        raise ValueError("El workflow override del caso no existe, no está activo o no es de tipo chatbot_evaluation.")
    if requested_version is None:
        return _workflow_definition(workflow)
    version = await get_ai_workflow_version(db, workflow.id, int(requested_version))
    snapshot = version.snapshot_json if isinstance(version.snapshot_json, dict) else {}
    meta = snapshot.get("workflow") if isinstance(snapshot, dict) else {}
    if not isinstance(meta, dict) or meta.get("workflow_purpose") != "chatbot_evaluation":
        raise ValueError("La versión seleccionada no pertenece a un workflow chatbot_evaluation.")
    return snapshot


def build_chatbot_context(
    case: models.CasoPrueba,
    run: Any,
    variables: dict,
    dataset: list,
    base_url: str,
    environment_config: dict | None = None,
    dynamic_variables: DynamicVariableContext | None = None,
) -> dict:
    config = merge_chatbot_config(environment_config or {}, case.configuracion_chatbot or {})
    config = _resolve_chatbot_dynamic_inputs(config, variables, dynamic_variables)
    if _has_profile_generated_turn(config) and not config.get("profiles"):
        config["profiles"] = deepcopy(SYSTEM_CHATBOT_PROFILES)
        config["default_profile"] = config["profiles"][0]["id"]
    profile, profile_missing = resolve_chatbot_profile(config, variables)
    config["profile"] = profile
    missing_variables = chatbot_required_variables(config, variables)
    return {
        "config": config,
        "variables": variables,
        "dataset": dataset,
        "environment": run.entorno if run else None,
        "baseUrl": variables.get("ENV.BASE_URL") or variables.get("ENV.URL") or base_url,
        "missing_variables": missing_variables,
        "missing_profile_variables": profile_missing,
        "profile_sources": config.get("profile_bindings") or {},
        "dynamic_seed": dynamic_variables.seed if dynamic_variables is not None else None,
        "dynamic_variables": safe_dynamic_values(dynamic_variables) if dynamic_variables is not None else {},
    }


def validate_chatbot_execution_config(case: models.CasoPrueba, environment_config: dict | None = None, variables: dict | None = None) -> list[str]:
    config = merge_chatbot_config(environment_config or {}, case.configuracion_chatbot or {})
    turns = (config.get("conversation") or {}).get("turns") or []
    has_generated_turn = any(
        isinstance(turn, dict) and isinstance(turn.get("input"), dict)
        and str(turn["input"].get("mode") or "fixed") == "profile_generated"
        for turn in turns
    )
    if has_generated_turn and not config.get("profiles"):
        config["profiles"] = deepcopy(SYSTEM_CHATBOT_PROFILES)
        config["default_profile"] = config["profiles"][0]["id"]
    errors = chatbot_config_errors(config)
    if variables is not None:
        missing = chatbot_required_variables(config, variables)
        if missing:
            errors.append("Faltan variables requeridas: " + ", ".join(missing))
    return errors
