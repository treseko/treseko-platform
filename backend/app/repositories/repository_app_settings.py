from .repository_context import *
from .ai_provider_catalog import AI_PROVIDER_KEY_ENV
from .repository_metrics_attachment_helpers import _json_safe

async def get_attachment_config(db: AsyncSession):
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == ATTACHMENT_CONFIG_KEY))
    setting = result.scalar_one_or_none()
    value = setting.value if setting else {}
    return {**DEFAULT_ATTACHMENT_CONFIG, **(value or {})}


async def update_attachment_config(db: AsyncSession, config: schemas.AttachmentConfig):
    value = {**DEFAULT_ATTACHMENT_CONFIG, **config.model_dump()}
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == ATTACHMENT_CONFIG_KEY))
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = value
    else:
        setting = models.AppSetting(key=ATTACHMENT_CONFIG_KEY, value=value)
        db.add(setting)
    await db.commit()
    return value


async def get_auth_session_config(db: AsyncSession):
    return await config_service.get_auth_session_config(db)


async def update_auth_session_config(db: AsyncSession, config: schemas.AuthSessionConfig):
    return await config_service.update_auth_session_config(db, config)


async def get_ai_engine_config(db: AsyncSession):
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == AI_ENGINE_CONFIG_KEY))
    setting = result.scalar_one_or_none()
    value = setting.value if setting else {}
    merged = {**DEFAULT_AI_ENGINE_CONFIG, **(value or {})}
    merged.pop("engine_url", None)
    key_status = ai_provider_api_key_status(merged, merged.get("provider"))
    merged["provider_api_key_configured"] = key_status["configured"]
    merged["provider_api_key_source"] = key_status["source"]
    return merged


REDACTED_AI_CONFIG_SECRET = "[redacted]"
AI_CONFIG_SECRET_KEYS = {
    "access_token",
    "api_key",
    "apikey",
    "authorization",
    "bearer",
    "client_secret",
    "credential",
    "credentials",
    "password",
    "refresh_token",
    "secret",
    "token",
}
AI_CONFIG_SECRET_KEY_SUFFIXES = (
    "_api_key",
    "_apikey",
    "_password",
    "_secret",
    "_token",
)
AI_CONFIG_PUBLIC_KEY_METADATA = {
    "api_key_configured",
    "last_model_scan_api_key_configured",
    "last_model_scan_requires_api_key",
    "provider_api_key_configured",
    "requires_api_key",
}


def _is_sensitive_ai_config_key(key: Any) -> bool:
    normalized = str(key or "").lower().replace("-", "_").replace(" ", "_")
    if normalized in AI_CONFIG_PUBLIC_KEY_METADATA:
        return False
    return normalized in AI_CONFIG_SECRET_KEYS or normalized.endswith(AI_CONFIG_SECRET_KEY_SUFFIXES)


def redact_ai_engine_config_secrets(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: REDACTED_AI_CONFIG_SECRET if _is_sensitive_ai_config_key(key) else redact_ai_engine_config_secrets(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_ai_engine_config_secrets(item) for item in value]
    return value


def _restore_redacted_ai_config_secrets(incoming: Any, current: Any) -> Any:
    if incoming == REDACTED_AI_CONFIG_SECRET:
        return current
    if isinstance(incoming, dict):
        current_dict = current if isinstance(current, dict) else {}
        return {
            key: _restore_redacted_ai_config_secrets(item, current_dict.get(key))
            for key, item in incoming.items()
        }
    if isinstance(incoming, list):
        current_list = current if isinstance(current, list) else []
        return [
            _restore_redacted_ai_config_secrets(item, current_list[index] if index < len(current_list) else None)
            for index, item in enumerate(incoming)
        ]
    return incoming


def normalize_ai_provider(value: Any) -> str:
    normalized = str(value or "openai-compatible").strip().lower().replace("_", "-")
    aliases = {
        "google": "gemini",
        "lmstudio": "lm-studio",
        "lm-studio-local": "lm-studio",
        "custom-http": "openai-compatible",
    }
    return aliases.get(normalized, normalized)


def _stored_provider_api_key(config: Dict[str, Any], provider: Any) -> Optional[str]:
    provider_key = normalize_ai_provider(provider)
    all_keys = config.get("provider_api_keys") if isinstance(config.get("provider_api_keys"), dict) else {}
    entry = all_keys.get(provider_key)
    if not isinstance(entry, dict):
        entry = all_keys.get(str(provider or ""))
    if not isinstance(entry, dict):
        return None
    raw_value = entry.get("api_key")
    value = str(raw_value or "").strip()
    if not value or value == REDACTED_AI_CONFIG_SECRET:
        return None
    return value


def get_configured_ai_provider_api_key(config: Dict[str, Any], provider: Any = None) -> Optional[str]:
    provider_key = normalize_ai_provider(provider or config.get("provider"))
    stored = _stored_provider_api_key(config, provider_key)
    if stored:
        return stored
    env_name = AI_PROVIDER_KEY_ENV.get(provider_key)
    if not env_name:
        return None
    value = os.getenv(env_name)
    return value.strip() if value else None


def ai_provider_api_key_status(config: Dict[str, Any], provider: Any = None) -> Dict[str, Optional[str] | bool]:
    provider_key = normalize_ai_provider(provider or config.get("provider"))
    if _stored_provider_api_key(config, provider_key):
        return {"configured": True, "source": "stored"}
    env_name = AI_PROVIDER_KEY_ENV.get(provider_key)
    if env_name and os.getenv(env_name):
        return {"configured": True, "source": "env"}
    return {"configured": False, "source": None}


async def get_ai_engine_public_config(db: AsyncSession):
    public = redact_ai_engine_config_secrets(await get_ai_engine_config(db))
    # Provider secrets are managed by the encrypted credential vault. Do not
    # expose the legacy per-provider map, even in redacted form.
    public["provider_api_keys"] = {}
    return public


async def update_ai_engine_config(db: AsyncSession, config: schemas.AiEngineConfig):
    for purpose, workflow_id in config.active_workflow_ids.items():
        workflow = (await db.execute(select(models.AiWorkflow).filter(models.AiWorkflow.id == workflow_id))).scalar_one_or_none()
        if not workflow or workflow.status != "ACTIVE" or workflow.workflow_purpose != purpose:
            raise ValueError("El workflow seleccionado debe estar activo y corresponder al uso configurado")
    current = await get_ai_engine_config(db)
    submitted_keys = config.model_dump().get("provider_api_keys") or {}
    if any(_stored_provider_api_key({"provider_api_keys": submitted_keys}, provider) for provider in submitted_keys):
        raise ValueError("Las API keys deben guardarse en el vault de credenciales IA, no en la configuración general")
    if current.get("provider_api_keys") and any(
        _stored_provider_api_key(current, provider) for provider in current["provider_api_keys"]
    ):
        raise ValueError("Hay claves legacy pendientes: migralas al vault antes de guardar la configuración")
    incoming = _restore_redacted_ai_config_secrets(config.model_dump(), current)
    value = _json_safe({**DEFAULT_AI_ENGINE_CONFIG, **incoming})
    value["provider_api_keys"] = {}
    value.pop("engine_url", None)
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == AI_ENGINE_CONFIG_KEY))
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = value
    else:
        setting = models.AppSetting(key=AI_ENGINE_CONFIG_KEY, value=value)
        db.add(setting)
    await db.commit()
    return redact_ai_engine_config_secrets(await get_ai_engine_config(db))
