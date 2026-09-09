from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ... import access_control, auth, models, schemas
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


def instance_summary(
    instance: models.IntegrationInstance | None,
    kind: str,
    *,
    include_secret_metadata: bool = False,
    include_secret_presence: bool = False,
    include_audit_events: bool = False,
) -> schemas.ExtensionInstanceSummary | None:
    if not instance:
        return None
    return schemas.ExtensionInstanceSummary(
        id=instance.id,
        provider_id=instance.provider_id,
        kind=kind,
        scope_key=instance.scope_key,
        organizacion_id=instance.organizacion_id,
        proyecto_id=instance.proyecto_id,
        enabled=bool(instance.enabled),
        status=instance.status or "disabled",
        config_json=public_config(instance.config_json),
        secrets_configured=(
            (instance.secrets_configured or {})
            if include_secret_metadata
            else {
                str(key): {"configured": bool((value or {}).get("configured"))}
                for key, value in (instance.secrets_configured or {}).items()
                if isinstance(value, dict)
            }
            if include_secret_presence
            else {}
        ),
        last_check_at=isoformat_utc(instance.last_check_at) if instance.last_check_at else None,
        last_error=instance.last_error,
        audit_events=audit_events(instance.config_json) if include_audit_events else [],
    )


async def require_installation_scope_access(
    db: AsyncSession,
    current_user: models.Usuario,
    *,
    organizacion_id: UUID | None,
    proyecto_id: UUID | None,
    level: str = "edit",
) -> None:
    """Validate an extension target before its scope key is persisted."""
    if proyecto_id:
        project = await access_control.require_project_access(db, current_user, proyecto_id, level)
        if organizacion_id and project.organizacion_id != organizacion_id:
            raise HTTPException(
                status_code=422,
                detail="El proyecto no pertenece a la organizacion indicada",
            )
        return
    if organizacion_id:
        await access_control.require_organization_access(db, current_user, organizacion_id, level)
        return
    if not access_control.is_global_admin(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo un administrador global puede gestionar complementos globales",
        )


async def require_instance_scope_access(
    db: AsyncSession,
    current_user: models.Usuario,
    instance: models.IntegrationInstance,
    level: str = "read",
) -> None:
    """Apply tenant ownership checks to a persisted extension instance."""
    scope_key = str(instance.scope_key or "").strip().lower()
    if instance.proyecto_id and scope_key == f"project:{instance.proyecto_id}":
        project = await access_control.require_project_access(db, current_user, instance.proyecto_id, level)
        if instance.organizacion_id and project.organizacion_id != instance.organizacion_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="El alcance del complemento es invalido o no es accesible",
            )
    elif instance.proyecto_id is None and instance.organizacion_id and scope_key == f"organization:{instance.organizacion_id}":
        await access_control.require_organization_access(db, current_user, instance.organizacion_id, level)
    elif scope_key == "global" and access_control.is_global_admin(current_user):
        return
    else:
        # Fail closed for historical rows whose persisted scope cannot be
        # reconciled. They must be corrected by an administrator before use.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El alcance del complemento es invalido o no es accesible",
        )


async def instances_by_provider(
    db: AsyncSession,
    current_user: models.Usuario,
) -> dict[str, list[models.IntegrationInstance]]:
    result = await db.execute(select(models.IntegrationInstance).order_by(models.IntegrationInstance.created_at.desc()))
    instances: dict[str, list[models.IntegrationInstance]] = {}
    for instance in result.scalars().all():
        try:
            await require_instance_scope_access(db, current_user, instance, "read")
        except HTTPException as exc:
            if exc.status_code in {status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND}:
                continue
            raise
        instances.setdefault(instance.provider_id, []).append(instance)
    return instances


async def load_instance(
    db: AsyncSession,
    current_user: models.Usuario,
    instance_id: UUID,
    level: str = "read",
) -> models.IntegrationInstance:
    instance = await db.get(models.IntegrationInstance, instance_id)
    if not instance:
        raise HTTPException(status_code=404, detail="Complemento no encontrado")
    await require_instance_scope_access(db, current_user, instance, level)
    return instance


async def catalog_response(db: AsyncSession, current_user: models.Usuario, kind_filter: str | None = None) -> schemas.ExtensionCatalogResponse:
    instances = await instances_by_provider(db, current_user)
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
        provider_instances = instances.get(str(manifest.get("id")), [])
        include_secret_metadata = access_control.is_global_admin(current_user) and auth.has_capability_permission(
            current_user, required_capability(kind, "secrets"), "edit"
        )
        include_secret_presence = auth.has_capability_permission(
            current_user, required_capability(kind, "secrets"), "edit"
        )
        audit_capability = "integraciones.auditoria" if kind == "integration" else "plugins.auditoria"
        include_audit_events = auth.has_capability_permission(current_user, audit_capability, "read")
        summaries = [
            instance_summary(
                instance,
                kind,
                include_secret_metadata=include_secret_metadata,
                include_secret_presence=include_secret_presence,
                include_audit_events=include_audit_events,
            )
            for instance in provider_instances
        ]
        instance = summaries[0] if summaries else None
        builtin = bool(manifest.get("builtin"))
        items.append(schemas.ExtensionCatalogItem(id=str(manifest.get("id")), kind=kind, display_name=str(manifest.get("display_name")), description=manifest.get("description"), status=str(manifest.get("status") or "planned"), builtin=builtin, capabilities=manifest.get("capabilities") or [], premium_feature=feature_id, premium_required=bool(feature_id and feature_id not in enabled_features), installed=builtin or instance is not None, instance=instance, instances=summaries))
    return schemas.ExtensionCatalogResponse(items=items)
