"""Global, audited-safe provider profiles for governed AI workflows."""
from __future__ import annotations

from uuid import UUID
import os

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models, schemas
from ..services.ai_credential_crypto import decrypt_ai_credential, encrypt_ai_credential
from ..services.error_contract import current_correlation_id
from .core_settings_ai_workflow_helpers import get_configured_ai_provider_api_key
from .repository_context import AI_ENGINE_CONFIG_KEY, DEFAULT_AI_ENGINE_CONFIG, engine_internal_headers, utc_now


PROVIDER_ADAPTERS = {
    "openai": "openai-responses",
    "anthropic": "anthropic-messages",
    "gemini": "gemini",
    "google": "gemini",
    "azure-openai": "azure-openai",
    "opencode": "openai-compatible",
}


def _credential_public(row: models.AiProviderCredential) -> dict:
    return {
        "id": row.id, "provider": row.provider, "label": row.label,
        "active": row.active, "configured": True, "key_id": row.key_id,
        "created_at": row.created_at, "updated_at": row.updated_at,
    }


def _profile_public(row: models.AiProviderProfile, *, active_runtime: bool = False) -> dict:
    return {
        "id": row.id, "name": row.name, "provider": row.provider,
        "adapter": row.adapter, "endpoint": row.endpoint, "model": row.model,
        "credential_id": row.credential_id,
        "credential_configured": bool(row.credential_id),
        "capabilities_json": row.capabilities_json or {}, "capability_status": row.capability_status,
        "enabled": row.enabled, "request_timeout_seconds": row.request_timeout_seconds,
        "max_retries": row.max_retries, "max_input_tokens": row.max_input_tokens,
        "max_output_tokens": row.max_output_tokens, "created_at": row.created_at,
        "updated_at": row.updated_at, "active_runtime": active_runtime,
    }


async def list_ai_provider_credentials(db: AsyncSession) -> list[dict]:
    rows = (await db.execute(select(models.AiProviderCredential).order_by(models.AiProviderCredential.provider, models.AiProviderCredential.label))).scalars().all()
    return [_credential_public(row) for row in rows]


async def create_ai_provider_credential(db: AsyncSession, payload: schemas.AiProviderCredentialCreate, user_id: UUID | None) -> dict:
    encrypted, key_id = encrypt_ai_credential(payload.secret)
    row = models.AiProviderCredential(provider=payload.provider.lower(), label=payload.label.strip(), secret_value_encrypted=encrypted, key_id=key_id, created_by=user_id)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    if row.provider == "opencode":
        await ensure_opencode_profile(db)
    return _credential_public(row)


async def replace_ai_provider_credential(db: AsyncSession, credential_id: UUID, payload: schemas.AiProviderCredentialReplace) -> dict:
    row = await db.get(models.AiProviderCredential, credential_id)
    if not row:
        raise ValueError("Credencial IA no encontrada")
    encrypted, key_id = encrypt_ai_credential(payload.secret)
    row.secret_value_encrypted, row.key_id, row.active = encrypted, key_id, True
    await db.commit()
    await db.refresh(row)
    return _credential_public(row)


async def update_ai_provider_credential(db: AsyncSession, credential_id: UUID, payload: schemas.AiProviderCredentialUpdate) -> dict:
    row = await db.get(models.AiProviderCredential, credential_id)
    if not row:
        raise ValueError("Credencial IA no encontrada")
    row.label = payload.label.strip()
    await db.commit()
    await db.refresh(row)
    return _credential_public(row)


async def disable_ai_provider_credential(db: AsyncSession, credential_id: UUID) -> dict:
    row = await db.get(models.AiProviderCredential, credential_id)
    if not row:
        raise ValueError("Credencial IA no encontrada")
    row.active = False
    await db.commit()
    await db.refresh(row)
    return _credential_public(row)


async def resolve_ai_provider_credential(db: AsyncSession, credential_id: UUID | None) -> str | None:
    if not credential_id:
        return None
    row = await db.get(models.AiProviderCredential, credential_id)
    if not row or not row.active:
        raise ValueError("La credencial IA no existe o esta deshabilitada")
    return decrypt_ai_credential(row.secret_value_encrypted, row.key_id)


def _validate_profile_adapter(provider: str, adapter: str) -> None:
    expected = PROVIDER_ADAPTERS.get(provider.lower())
    if expected and adapter != expected:
        raise ValueError(f"El proveedor {provider} requiere el adaptador {expected}")


async def list_ai_provider_profiles(db: AsyncSession) -> list[dict]:
    await ensure_opencode_profile(db)
    setting = (await db.execute(select(models.AppSetting).where(models.AppSetting.key == AI_ENGINE_CONFIG_KEY))).scalar_one_or_none()
    active_id = str(((setting.value or {}) if setting else {}).get("active_provider_profile_id") or "")
    rows = (await db.execute(select(models.AiProviderProfile).order_by(models.AiProviderProfile.name))).scalars().all()
    return [_profile_public(row, active_runtime=str(row.id) == active_id) for row in rows]


async def ensure_opencode_profile(db: AsyncSession) -> models.AiProviderProfile | None:
    existing = (await db.execute(select(models.AiProviderProfile).where(models.AiProviderProfile.provider == "opencode").order_by(models.AiProviderProfile.created_at))).scalars().first()
    if existing:
        return existing
    credential = (await db.execute(
        select(models.AiProviderCredential).where(
            models.AiProviderCredential.provider == "opencode",
            models.AiProviderCredential.active.is_(True),
        ).order_by(models.AiProviderCredential.updated_at.desc())
    )).scalars().first()
    if not credential:
        return None
    setting = (await db.execute(select(models.AppSetting).where(models.AppSetting.key == AI_ENGINE_CONFIG_KEY))).scalar_one_or_none()
    config = dict(setting.value or {}) if setting else {}
    model = str(config.get("model") or "opencode-go/qwen3.7-plus") if config.get("provider") == "opencode" else "opencode-go/qwen3.7-plus"
    row = models.AiProviderProfile(name="OpenCode", provider="opencode", adapter="openai-compatible", endpoint="http://127.0.0.1:4096", model=model, credential_id=credential.id, capability_status="unknown")
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def get_ai_provider_profile(db: AsyncSession, profile_id: UUID) -> models.AiProviderProfile:
    row = await db.get(models.AiProviderProfile, profile_id)
    if not row:
        raise ValueError("Perfil de proveedor IA no encontrado")
    return row


async def create_ai_provider_profile(db: AsyncSession, payload: schemas.AiProviderProfileCreate, user_id: UUID | None) -> dict:
    _validate_profile_adapter(payload.provider, payload.adapter)
    if payload.credential_id:
        credential = await db.get(models.AiProviderCredential, payload.credential_id)
        if not credential or not credential.active or credential.provider != payload.provider.lower():
            raise ValueError("La credencial no corresponde al proveedor del perfil")
    values = payload.model_dump()
    # Only Treseko's live probe can promote a profile to tested.
    values["capability_status"] = "unknown"
    row = models.AiProviderProfile(**values, created_by=user_id)
    db.add(row)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise ValueError("Ya existe un perfil IA con ese nombre")
    await db.refresh(row)
    return _profile_public(row)


async def update_ai_provider_profile(db: AsyncSession, profile_id: UUID, payload: schemas.AiProviderProfileUpdate) -> dict:
    row = await get_ai_provider_profile(db, profile_id)
    values = payload.model_dump(exclude_unset=True)
    if "capability_status" in values:
        raise ValueError("El estado de capacidades solo puede cambiar mediante la prueba del perfil")
    if "credential_id" in values and values["credential_id"]:
        credential = await db.get(models.AiProviderCredential, values["credential_id"])
        if not credential or not credential.active or credential.provider != row.provider:
            raise ValueError("La credencial no corresponde al proveedor del perfil")
    for key, value in values.items():
        setattr(row, key, value)
    await db.commit()
    await db.refresh(row)
    # Editing the model or credential of the selected profile takes effect
    # immediately; other profiles remain prepared but inactive.
    setting = (await db.execute(select(models.AppSetting).where(models.AppSetting.key == AI_ENGINE_CONFIG_KEY))).scalar_one_or_none()
    if setting and str((setting.value or {}).get("active_provider_profile_id") or "") == str(row.id):
        config = {**DEFAULT_AI_ENGINE_CONFIG, **dict(setting.value or {})}
        config.update({
            "model": row.model,
            "llm_endpoint": "http://127.0.0.1:4096" if row.provider == "opencode" else row.endpoint,
            "provider_api_key_configured": bool(row.credential_id),
            "provider_api_key_source": "vault" if row.credential_id else None,
        })
        setting.value = config
        await db.commit()
    return _profile_public(row)


async def activate_ai_provider_profile(db: AsyncSession, profile_id: UUID) -> dict:
    row = await get_ai_provider_profile(db, profile_id)
    if not row.enabled:
        raise ValueError("No se puede activar un perfil deshabilitado")
    if row.provider not in {"lm-studio", "ollama", "openai-compatible"} and not row.credential_id:
        raise ValueError("El perfil requiere una credencial activa antes de activarse")
    if row.credential_id:
        await resolve_ai_provider_credential(db, row.credential_id)
    setting = (await db.execute(select(models.AppSetting).where(models.AppSetting.key == AI_ENGINE_CONFIG_KEY))).scalar_one_or_none()
    value = {**DEFAULT_AI_ENGINE_CONFIG, **(dict(setting.value or {}) if setting else {})}
    value.update({
        "active_provider_profile_id": str(row.id), "provider": row.provider,
        "provider_label": row.name,
        "llm_endpoint": "http://127.0.0.1:4096" if row.provider == "opencode" else row.endpoint,
        "model": row.model,
        "ai_execution_driver": "opencode" if row.provider == "opencode" else "treseko_engine",
        "provider_api_key_configured": bool(row.credential_id),
        "provider_api_key_source": "vault" if row.credential_id else None,
    })
    if setting:
        setting.value = value
    else:
        db.add(models.AppSetting(key=AI_ENGINE_CONFIG_KEY, value=value))
    await db.commit()
    return {"profile": _profile_public(row, active_runtime=True), "config": value}


async def disable_ai_provider_profile(db: AsyncSession, profile_id: UUID) -> dict:
    row = await get_ai_provider_profile(db, profile_id)
    row.enabled = False
    await db.commit()
    await db.refresh(row)
    return _profile_public(row)


async def migrate_legacy_ai_provider_credentials(db: AsyncSession, user_id: UUID | None) -> dict:
    """Atomically encrypt legacy AppSetting keys and remove their plaintext copies."""
    setting = (await db.execute(
        select(models.AppSetting).where(models.AppSetting.key == AI_ENGINE_CONFIG_KEY)
    )).scalar_one_or_none()
    config = dict(setting.value or {}) if setting else {}
    legacy = config.get("provider_api_keys") if isinstance(config.get("provider_api_keys"), dict) else {}
    migrated: list[dict] = []
    active_provider = str(config.get("provider") or "").strip().lower()
    for raw_provider, entry in legacy.items():
        provider = str(raw_provider or "").strip().lower()
        secret = str((entry or {}).get("api_key") or "").strip() if isinstance(entry, dict) else ""
        if not provider or not secret or secret == "[redacted]":
            continue
        encrypted, key_id = encrypt_ai_credential(secret)
        label = f"Migrada desde configuración ({provider})"
        credential = models.AiProviderCredential(
            provider=provider, label=label, secret_value_encrypted=encrypted,
            key_id=key_id, created_by=user_id,
        )
        db.add(credential)
        await db.flush()
        profile_id = None
        endpoint = str(config.get("llm_endpoint") or "")
        endpoint_is_safe = False
        if endpoint:
            try:
                schemas.validate_ai_provider_endpoint(endpoint)
                endpoint_is_safe = True
            except ValueError:
                endpoint_is_safe = False
        if provider == active_provider and endpoint_is_safe and config.get("model"):
            base_name = f"{provider} migrado"
            name = base_name
            suffix = 2
            while (await db.execute(select(models.AiProviderProfile.id).where(models.AiProviderProfile.name == name))).scalar_one_or_none():
                name, suffix = f"{base_name} {suffix}", suffix + 1
            profile = models.AiProviderProfile(
                name=name, provider=provider,
                adapter=PROVIDER_ADAPTERS.get(provider, "openai-compatible"),
                endpoint=endpoint, model=str(config["model"]),
                credential_id=credential.id, capability_status="unknown",
                created_by=user_id,
            )
            db.add(profile)
            await db.flush()
            profile_id = profile.id
        migrated.append({"provider": provider, "credential_id": credential.id, "profile_id": profile_id})
    config["provider_api_keys"] = {}
    if setting:
        setting.value = config
    elif migrated:
        db.add(models.AppSetting(key=AI_ENGINE_CONFIG_KEY, value=config))
    await db.commit()
    return {"migrated_count": len(migrated), "items": migrated}


async def resolved_ai_provider_profile(db: AsyncSession, profile_id: UUID) -> dict:
    row = await get_ai_provider_profile(db, profile_id)
    if not row.enabled:
        raise ValueError("El perfil IA esta deshabilitado")
    return {**_profile_public(row), "api_key": await resolve_ai_provider_credential(db, row.credential_id)}


async def test_ai_provider_profile(db: AsyncSession, profile_id: UUID) -> dict:
    row = await get_ai_provider_profile(db, profile_id)
    resolved = await resolved_ai_provider_profile(db, profile_id)
    headers = engine_internal_headers(current_correlation_id())
    if "X-Engine-Internal-Token" not in headers:
        raise RuntimeError("El token interno del Motor IA no está configurado")
    payload = {
        "provider": resolved["provider"], "llm_endpoint": resolved["endpoint"],
        "model": resolved["model"], "provider_api_key": resolved["api_key"],
        "max_retries": resolved["max_retries"],
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(row.request_timeout_seconds, connect=10.0)) as client:
            response = await client.post(
                f"{os.getenv('ENGINE_URL', 'http://127.0.0.1:3010').rstrip('/')}/provider-health",
                json=payload,
                headers=headers,
            )
    except httpx.HTTPError as exc:
        raise ValueError("No se pudo conectar con el Motor IA para probar el perfil") from exc
    if response.status_code >= 400:
        detail = ""
        try:
            body = response.json()
            if isinstance(body, dict):
                detail = str(body.get("error") or body.get("detail") or body.get("message") or body)
            else:
                detail = str(body)
        except Exception:
            detail = (response.text or "").strip()
        if detail:
            detail = f"{detail[:400]}"
            raise ValueError(f"El proveedor rechazó la prueba o no respondió correctamente (HTTP {response.status_code}): {detail}")
        raise ValueError(f"El proveedor rechazó la prueba o no respondió correctamente (HTTP {response.status_code})")
    row.capability_status = "tested"
    row.capabilities_json = {
        **(row.capabilities_json or {}),
        "text": True,
        "structured_json": True,
        "verified_at": utc_now().isoformat(),
        "verification_source": "treseko-provider-health/v1",
    }
    await db.commit()
    await db.refresh(row)
    return {"status": "ok", "profile": _profile_public(row)}


async def workflow_provider_payload(db: AsyncSession, workflow: models.AiWorkflow, legacy_config: dict) -> dict:
    """Resolve one workflow provider plus its explicit technical fallbacks."""
    if not workflow.provider_profile_id:
        return {
            "provider": legacy_config.get("provider"), "llm_endpoint": legacy_config.get("llm_endpoint"),
            "model": legacy_config.get("model"),
            "provider_api_key": get_configured_ai_provider_api_key(legacy_config, legacy_config.get("provider")),
            "provider_fallbacks": [],
        }
    primary = await resolved_ai_provider_profile(db, workflow.provider_profile_id)
    fallbacks, seen = [], {str(workflow.provider_profile_id)}
    for raw_id in workflow.fallback_profile_ids or []:
        if str(raw_id) in seen:
            continue
        seen.add(str(raw_id))
        fallback = await resolved_ai_provider_profile(db, UUID(str(raw_id)))
        fallbacks.append({
            "profile_id": str(fallback["id"]), "provider": fallback["provider"],
            "llm_endpoint": fallback["endpoint"], "model": fallback["model"],
            "provider_api_key": fallback["api_key"], "max_retries": fallback["max_retries"],
        })
    return {
        "provider_profile_id": str(primary["id"]), "provider": primary["provider"],
        "llm_endpoint": primary["endpoint"], "model": primary["model"],
        "provider_api_key": primary["api_key"], "provider_fallbacks": fallbacks,
        "provider_max_retries": primary["max_retries"],
    }


async def provider_payload_for_definition(db: AsyncSession, definition: dict | None, legacy_config: dict) -> dict:
    # The provider selected as active in "Pruebas con IA" is the runtime
    # choice for new executions. A workflow-specific profile is retained as a
    # fallback for installations that have not selected any active profile.
    active_profile_id = str(legacy_config.get("active_provider_profile_id") or "").strip()
    if active_profile_id:
        try:
            active = await resolved_ai_provider_profile(db, UUID(active_profile_id))
            return {
                "provider_profile_id": str(active["id"]), "provider": active["provider"],
                "llm_endpoint": active["endpoint"], "model": active["model"],
                "provider_api_key": active["api_key"], "provider_fallbacks": [],
                "provider_max_retries": active["max_retries"],
            }
        except (ValueError, TypeError):
            # A legacy or removed profile must not make existing workflows
            # unusable; resolve their saved provider below in that case.
            pass
    workflow_id = ((definition or {}).get("workflow") or {}).get("id") if isinstance(definition, dict) else None
    if not workflow_id:
        return await workflow_provider_payload(db, models.AiWorkflow(provider_profile_id=None), legacy_config)
    workflow = await db.get(models.AiWorkflow, UUID(str(workflow_id)))
    if not workflow:
        return await workflow_provider_payload(db, models.AiWorkflow(provider_profile_id=None), legacy_config)
    return await workflow_provider_payload(db, workflow, legacy_config)
