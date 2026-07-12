from __future__ import annotations

import hashlib
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ... import auth, models, schemas
from ...database import get_db
from ...services.edition.entitlement_provider import get_entitlement_provider
from ...services.integrations.registry import get_registered_integrations
from ...services.plugins.registry import get_registered_plugins
from ...services.secret_crypto import encrypt_secret_value
from ...time_utils import isoformat_utc, utc_now


router = APIRouter(tags=["extensions"])

EXTENSION_PREMIUM_FEATURES = {
    "integration": "integrations.enterprise",
}

AUDIT_CONFIG_KEY = "_treseko_audit"


def _manifest_by_id(provider_id: str) -> dict[str, Any] | None:
    for manifest in [*get_registered_integrations(), *get_registered_plugins()]:
        if manifest.get("id") == provider_id:
            return manifest
    return None


def _required_capability(kind: str, action: str) -> str:
    if kind == "integration":
        return {
            "catalog": "integraciones.catalogo",
            "install": "integraciones.configurar",
            "configure": "integraciones.configurar",
            "secrets": "integraciones.secretos",
            "enable": "integraciones.configurar",
            "test": "integraciones.test_conexion",
        }[action]
    return {
        "catalog": "plugins.catalogo",
        "install": "plugins.instalar",
        "configure": "plugins.configurar",
        "secrets": "plugins.gestionar_secretos",
        "enable": "plugins.habilitar",
        "test": "plugins.configurar",
    }[action]


def _assert_capability(user: models.Usuario, capability_id: str, level: str = "read") -> None:
    if not auth.has_capability_permission(user, capability_id, level):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para gestionar este complemento",
        )


async def _assert_feature(db: AsyncSession, kind: str) -> None:
    feature_id = EXTENSION_PREMIUM_FEATURES.get(kind)
    if not feature_id:
        return
    state = await get_entitlement_provider().get_state(db)
    if feature_id not in set(state.get("enabled_features") or []):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Esta funcion esta disponible en Treseko Premium.")


def _public_config(config_json: dict[str, Any] | None) -> dict[str, Any]:
    return {key: value for key, value in (config_json or {}).items() if not str(key).startswith("_treseko")}


def _audit_events(config_json: dict[str, Any] | None) -> list[dict[str, Any]]:
    events = (config_json or {}).get(AUDIT_CONFIG_KEY)
    return events if isinstance(events, list) else []


def _append_audit(instance: models.IntegrationInstance, user: models.Usuario, action: str) -> None:
    config = dict(instance.config_json or {})
    events = list(_audit_events(config))
    events.insert(0, {
        "action": action,
        "actor_id": str(user.id),
        "actor": user.email,
        "at": isoformat_utc(utc_now()),
    })
    config[AUDIT_CONFIG_KEY] = events[:20]
    instance.config_json = config


def _instance_summary(instance: models.IntegrationInstance | None, kind: str) -> schemas.ExtensionInstanceSummary | None:
    if not instance:
        return None
    return schemas.ExtensionInstanceSummary(
        id=instance.id,
        provider_id=instance.provider_id,
        kind=kind,
        enabled=bool(instance.enabled),
        status=instance.status or "disabled",
        config_json=_public_config(instance.config_json),
        secrets_configured=instance.secrets_configured or {},
        last_check_at=isoformat_utc(instance.last_check_at) if instance.last_check_at else None,
        last_error=instance.last_error,
        audit_events=_audit_events(instance.config_json),
    )


async def _instances_by_provider(db: AsyncSession) -> dict[str, models.IntegrationInstance]:
    result = await db.execute(
        select(models.IntegrationInstance)
        .order_by(models.IntegrationInstance.created_at.desc())
    )
    instances: dict[str, models.IntegrationInstance] = {}
    for instance in result.scalars().all():
        instances.setdefault(instance.provider_id, instance)
    return instances


async def _load_instance(db: AsyncSession, instance_id: UUID) -> models.IntegrationInstance:
    instance = await db.get(models.IntegrationInstance, instance_id)
    if not instance:
        raise HTTPException(status_code=404, detail="Complemento no encontrado")
    return instance


@router.get("/integrations/catalog", response_model=schemas.ExtensionCatalogResponse)
async def read_integrations_catalog(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_active_user),
):
    return await _catalog_response(db, current_user, kind_filter="integration")


@router.get("/plugins/catalog", response_model=schemas.ExtensionCatalogResponse)
async def read_plugins_catalog(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_active_user),
):
    return await _catalog_response(db, current_user, kind_filter="plugin")


@router.get("/extensions/catalog", response_model=schemas.ExtensionCatalogResponse)
async def read_extensions_catalog(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_active_user),
):
    return await _catalog_response(db, current_user)


async def _catalog_response(
    db: AsyncSession,
    current_user: models.Usuario,
    kind_filter: str | None = None,
) -> schemas.ExtensionCatalogResponse:
    manifests = [*get_registered_integrations(), *get_registered_plugins()]
    instances = await _instances_by_provider(db)
    state = await get_entitlement_provider().get_state(db)
    enabled_features = set(state.get("enabled_features") or [])
    items: list[schemas.ExtensionCatalogItem] = []
    for manifest in manifests:
        kind = str(manifest.get("kind") or "")
        if kind_filter and kind != kind_filter:
            continue
        catalog_capability = _required_capability(kind, "catalog")
        if not auth.has_capability_permission(current_user, catalog_capability, "read"):
            continue
        feature_id = EXTENSION_PREMIUM_FEATURES.get(kind)
        instance = instances.get(str(manifest.get("id")))
        builtin = bool(manifest.get("builtin"))
        items.append(schemas.ExtensionCatalogItem(
            id=str(manifest.get("id")),
            kind=kind,
            display_name=str(manifest.get("display_name")),
            description=manifest.get("description"),
            status=str(manifest.get("status") or "planned"),
            builtin=builtin,
            capabilities=manifest.get("capabilities") or [],
            premium_feature=feature_id,
            premium_required=bool(feature_id and feature_id not in enabled_features),
            installed=builtin or instance is not None,
            instance=_instance_summary(instance, kind),
        ))
    return schemas.ExtensionCatalogResponse(items=items)


@router.post("/extensions/{provider_id}/install", response_model=schemas.ExtensionInstanceSummary)
async def install_extension(
    provider_id: str,
    payload: schemas.ExtensionInstallRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_active_user),
):
    manifest = _manifest_by_id(provider_id)
    if not manifest:
        raise HTTPException(status_code=404, detail="Complemento no registrado")
    kind = str(manifest.get("kind"))
    _assert_capability(current_user, _required_capability(kind, "install"), "edit")
    await _assert_feature(db, kind)
    result = await db.execute(
        select(models.IntegrationInstance)
        .filter(models.IntegrationInstance.provider_id == provider_id)
        .order_by(models.IntegrationInstance.created_at.desc())
    )
    instance = result.scalars().first()
    if not instance:
        instance = models.IntegrationInstance(
            provider_id=provider_id,
            organizacion_id=payload.organizacion_id,
            proyecto_id=payload.proyecto_id,
            enabled=False,
            status="installed",
            config_json={},
            secrets_configured={},
            created_by=current_user.id,
        )
        db.add(instance)
        await db.flush()
    _append_audit(instance, current_user, "installed")
    await db.commit()
    await db.refresh(instance)
    return _instance_summary(instance, kind)


@router.patch("/extensions/{instance_id}", response_model=schemas.ExtensionInstanceSummary)
async def update_extension(
    instance_id: UUID,
    payload: schemas.ExtensionUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_active_user),
):
    instance = await _load_instance(db, instance_id)
    manifest = _manifest_by_id(instance.provider_id)
    if not manifest:
        raise HTTPException(status_code=404, detail="Complemento no registrado")
    kind = str(manifest.get("kind"))
    _assert_capability(current_user, _required_capability(kind, "configure"), "edit")
    await _assert_feature(db, kind)
    config = dict(instance.config_json or {})
    audit = config.get(AUDIT_CONFIG_KEY)
    config = dict(payload.config_json or {})
    if audit:
        config[AUDIT_CONFIG_KEY] = audit
    instance.config_json = config
    instance.status = "configured" if not instance.enabled else "active"
    _append_audit(instance, current_user, "configured")
    await db.commit()
    await db.refresh(instance)
    return _instance_summary(instance, kind)


@router.post("/extensions/{instance_id}/secrets", response_model=schemas.ExtensionInstanceSummary)
async def configure_extension_secrets(
    instance_id: UUID,
    payload: schemas.ExtensionSecretsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_active_user),
):
    instance = await _load_instance(db, instance_id)
    manifest = _manifest_by_id(instance.provider_id)
    if not manifest:
        raise HTTPException(status_code=404, detail="Complemento no registrado")
    kind = str(manifest.get("kind"))
    _assert_capability(current_user, _required_capability(kind, "secrets"), "edit")
    await _assert_feature(db, kind)
    configured = dict(instance.secrets_configured or {})
    for key, value in (payload.secrets or {}).items():
        normalized_key = str(key).strip()
        if not normalized_key or value is None or str(value) == "":
            continue
        secret_value = str(value)
        digest = hashlib.sha256(secret_value.encode("utf-8")).hexdigest()
        existing_result = await db.execute(
            select(models.IntegrationSecret).filter(
                models.IntegrationSecret.integration_instance_id == instance.id,
                models.IntegrationSecret.secret_key == normalized_key,
            )
        )
        secret_row = existing_result.scalar_one_or_none()
        encrypted_value = encrypt_secret_value(secret_value)
        if secret_row:
            secret_row.secret_value_encrypted = encrypted_value
            secret_row.updated_at = utc_now()
        else:
            db.add(models.IntegrationSecret(
                integration_instance_id=instance.id,
                secret_key=normalized_key,
                secret_value_encrypted=encrypted_value,
            ))
        configured[normalized_key] = {"configured": True, "fingerprint": digest[:12], "updated_at": isoformat_utc(utc_now())}
    instance.secrets_configured = configured
    instance.status = "configured" if not instance.enabled else "active"
    _append_audit(instance, current_user, "secrets_configured")
    await db.commit()
    await db.refresh(instance)
    return _instance_summary(instance, kind)


@router.post("/extensions/{instance_id}/enable", response_model=schemas.ExtensionInstanceSummary)
async def enable_extension(
    instance_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_active_user),
):
    return await _set_extension_enabled(db, current_user, instance_id, True)


@router.post("/extensions/{instance_id}/disable", response_model=schemas.ExtensionInstanceSummary)
async def disable_extension(
    instance_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_active_user),
):
    return await _set_extension_enabled(db, current_user, instance_id, False)


async def _set_extension_enabled(
    db: AsyncSession,
    current_user: models.Usuario,
    instance_id: UUID,
    enabled: bool,
) -> schemas.ExtensionInstanceSummary:
    instance = await _load_instance(db, instance_id)
    manifest = _manifest_by_id(instance.provider_id)
    if not manifest:
        raise HTTPException(status_code=404, detail="Complemento no registrado")
    kind = str(manifest.get("kind"))
    _assert_capability(current_user, _required_capability(kind, "enable"), "edit")
    await _assert_feature(db, kind)
    instance.enabled = enabled
    instance.status = "active" if enabled else "disabled"
    instance.last_error = None
    _append_audit(instance, current_user, "enabled" if enabled else "disabled")
    await db.commit()
    await db.refresh(instance)
    return _instance_summary(instance, kind)


@router.post("/extensions/{instance_id}/test", response_model=schemas.ExtensionTestResponse)
async def test_extension(
    instance_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_active_user),
):
    instance = await _load_instance(db, instance_id)
    manifest = _manifest_by_id(instance.provider_id)
    if not manifest:
        raise HTTPException(status_code=404, detail="Complemento no registrado")
    kind = str(manifest.get("kind"))
    _assert_capability(current_user, _required_capability(kind, "test"), "read")
    await _assert_feature(db, kind)
    config = _public_config(instance.config_json)
    if instance.provider_id in {"redmine", "jira", "github_issues"} and not config.get("url"):
        instance.status = "error"
        instance.last_error = "Configura la URL del servicio antes de probar la conexion."
        ok = False
        message = instance.last_error
    else:
        instance.status = "active" if instance.enabled else "configured"
        instance.last_error = None
        ok = True
        message = "Configuracion validada. La ejecucion externa queda reservada para acciones seguras de Treseko."
    instance.last_check_at = utc_now()
    _append_audit(instance, current_user, "connection_tested")
    await db.commit()
    await db.refresh(instance)
    return schemas.ExtensionTestResponse(
        ok=ok,
        status=instance.status,
        message=message,
        instance=_instance_summary(instance, kind),
    )
