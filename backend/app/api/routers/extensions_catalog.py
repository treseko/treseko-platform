from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ... import auth, models, schemas
from ...services.edition.entitlement_provider import get_entitlement_provider
from ...services.integrations.registry import get_registered_integrations
from ...services.plugins.registry import get_registered_plugins
from ...time_utils import isoformat_utc, utc_now

EXTENSION_PREMIUM_FEATURES = {"integration": "integrations.enterprise"}
AUDIT_CONFIG_KEY = "_treseko_audit"


def manifest_by_id(provider_id: str) -> dict[str, Any] | None:
    for manifest in [*get_registered_integrations(), *get_registered_plugins()]:
        if manifest.get("id") == provider_id:
            return manifest
    if provider_id == "com.treseko.junit-importer":
        return {"id": provider_id, "kind": "plugin", "display_name": "Importador JUnit/XML", "status": "active", "builtin": False, "capabilities": [{"id": "plugins.provider.junit_importer.importar_resultados", "label": "Importar resultados JUnit/XML", "level": "edit"}]}
    return None


def required_capability(kind: str, action: str) -> str:
    if kind == "integration":
        return {"catalog": "integraciones.catalogo", "install": "integraciones.configurar", "configure": "integraciones.configurar", "secrets": "integraciones.secretos", "enable": "integraciones.configurar", "test": "integraciones.test_conexion"}[action]
    return {"catalog": "plugins.catalogo", "install": "plugins.instalar", "configure": "plugins.configurar", "secrets": "plugins.gestionar_secretos", "enable": "plugins.habilitar", "test": "plugins.configurar"}[action]


def assert_capability(user: models.Usuario, capability_id: str, level: str = "read") -> None:
    if not auth.has_capability_permission(user, capability_id, level):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tienes permisos para gestionar este complemento")


async def assert_feature(db: AsyncSession, kind: str) -> None:
    feature_id = EXTENSION_PREMIUM_FEATURES.get(kind)
    if not feature_id:
        return
    state = await get_entitlement_provider().get_state(db)
    if feature_id not in set(state.get("enabled_features") or []):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Esta funcion esta disponible en Treseko Premium.")


def public_config(config_json: dict[str, Any] | None) -> dict[str, Any]:
    return {key: value for key, value in (config_json or {}).items() if not str(key).startswith("_treseko")}


def audit_events(config_json: dict[str, Any] | None) -> list[dict[str, Any]]:
    events = (config_json or {}).get(AUDIT_CONFIG_KEY)
    return events if isinstance(events, list) else []


def append_audit(instance: models.IntegrationInstance, user: models.Usuario, action: str) -> None:
    config = dict(instance.config_json or {})
    events = list(audit_events(config))
    events.insert(0, {"action": action, "actor_id": str(user.id), "actor": user.email, "at": isoformat_utc(utc_now())})
    config[AUDIT_CONFIG_KEY] = events[:20]
    instance.config_json = config


def instance_summary(instance: models.IntegrationInstance | None, kind: str) -> schemas.ExtensionInstanceSummary | None:
    if not instance:
        return None
    return schemas.ExtensionInstanceSummary(id=instance.id, provider_id=instance.provider_id, kind=kind, enabled=bool(instance.enabled), status=instance.status or "disabled", config_json=public_config(instance.config_json), secrets_configured=instance.secrets_configured or {}, last_check_at=isoformat_utc(instance.last_check_at) if instance.last_check_at else None, last_error=instance.last_error, audit_events=audit_events(instance.config_json))


async def instances_by_provider(db: AsyncSession) -> dict[str, models.IntegrationInstance]:
    result = await db.execute(select(models.IntegrationInstance).order_by(models.IntegrationInstance.created_at.desc()))
    instances: dict[str, models.IntegrationInstance] = {}
    for instance in result.scalars().all():
        instances.setdefault(instance.provider_id, instance)
    return instances


async def load_instance(db: AsyncSession, instance_id: UUID) -> models.IntegrationInstance:
    instance = await db.get(models.IntegrationInstance, instance_id)
    if not instance:
        raise HTTPException(status_code=404, detail="Complemento no encontrado")
    return instance


async def catalog_response(db: AsyncSession, current_user: models.Usuario, kind_filter: str | None = None) -> schemas.ExtensionCatalogResponse:
    instances = await instances_by_provider(db)
    manifests = [*get_registered_integrations(), *get_registered_plugins()]
    known_ids = {str(manifest.get("id")) for manifest in manifests}
    for provider_id in instances:
        if provider_id not in known_ids:
            store_manifest = manifest_by_id(provider_id)
            if store_manifest:
                manifests.append(store_manifest)
    state = await get_entitlement_provider().get_state(db)
    enabled_features = set(state.get("enabled_features") or [])
    items: list[schemas.ExtensionCatalogItem] = []
    for manifest in manifests:
        kind = str(manifest.get("kind") or "")
        if kind_filter and kind != kind_filter:
            continue
        if not auth.has_capability_permission(current_user, required_capability(kind, "catalog"), "read"):
            continue
        feature_id = EXTENSION_PREMIUM_FEATURES.get(kind)
        instance = instances.get(str(manifest.get("id")))
        builtin = bool(manifest.get("builtin"))
        items.append(schemas.ExtensionCatalogItem(id=str(manifest.get("id")), kind=kind, display_name=str(manifest.get("display_name")), description=manifest.get("description"), status=str(manifest.get("status") or "planned"), builtin=builtin, capabilities=manifest.get("capabilities") or [], premium_feature=feature_id, premium_required=bool(feature_id and feature_id not in enabled_features), installed=builtin or instance is not None, instance=instance_summary(instance, kind)))
    return schemas.ExtensionCatalogResponse(items=items)
