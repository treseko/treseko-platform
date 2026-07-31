from __future__ import annotations

import base64
import hashlib
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ... import auth, models, schemas
from ...database import get_db
from ...services.secret_crypto import encrypt_secret_value
from ...services.plugins.installation import install_official_plugin
from ...services.plugins.manifest import PluginManifestError, audit_manifest_snapshot, installation_scope_key
from ...services.plugins.runner import PluginRunnerError, invoke_declarative_junit
from ...services.plugins.store_client import PluginStoreClientError, fetch_official_catalog
from ...services.plugins.pairing import download_paired_release, pair_installation, pairing_status
from ...services.edition.entitlement_provider import get_entitlement_provider
from ...repositories.scheduled_runs_audit import create_audit_log
from ...time_utils import isoformat_utc, utc_now
from .extensions_catalog import (
    AUDIT_CONFIG_KEY, append_audit as _append_audit, assert_capability as _assert_capability,
    assert_feature as _assert_feature, audit_events as _audit_events, catalog_response as _catalog_response,
    instance_summary as _instance_summary, load_instance as _load_instance, manifest_by_id as _manifest_by_id,
    public_config as _public_config, required_capability as _required_capability,
)


router = APIRouter(tags=["extensions"])



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
        select(models.IntegrationInstance).filter(
            models.IntegrationInstance.provider_id == provider_id,
            models.IntegrationInstance.scope_key == installation_scope_key(
                organizacion_id=payload.organizacion_id, proyecto_id=payload.proyecto_id,
            ),
        )
        .order_by(models.IntegrationInstance.created_at.desc())
    )
    instance = result.scalars().first()
    if not instance:
        instance = models.IntegrationInstance(
            provider_id=provider_id,
            scope_key=installation_scope_key(organizacion_id=payload.organizacion_id, proyecto_id=payload.proyecto_id),
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


@router.post("/plugins/store/releases/{release_id}/install", response_model=schemas.ExtensionInstanceSummary)
async def install_paired_official_store_release(
    release_id: str,
    payload: schemas.ExtensionInstallTargetRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_active_user),
):
    _assert_capability(current_user, "plugins.instalar", "edit")
    state = await get_entitlement_provider().get_state(db)
    try:
        manifest, artifact = await download_paired_release(
            db, release_id=release_id, enabled_features=set(state.get("enabled_features") or []),
        )
        instance = await install_official_plugin(
            db,
            manifest=manifest,
            artifact_b64=base64.b64encode(artifact).decode("ascii"),
            user=current_user,
            organizacion_id=payload.organizacion_id,
            proyecto_id=payload.proyecto_id,
        )
    except (PluginManifestError, PluginStoreClientError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _instance_summary(instance, "plugin")


@router.get("/plugins/store/catalog")
async def read_official_plugin_store_catalog(
    current_user: models.Usuario = Depends(auth.get_current_active_user),
):
    _assert_capability(current_user, "plugins.catalogo", "read")
    try:
        return {"items": await fetch_official_catalog()}
    except PluginStoreClientError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/plugins/store/register")
async def register_official_plugin_store(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_active_user),
):
    _assert_capability(current_user, "plugins.configurar", "edit")
    try:
        result = await pair_installation(db)
    except PluginStoreClientError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    await create_audit_log(db, current_user.id, "plugin_store.paired", "plugin_store", detalles={"installation_id": result["installation_id"]})
    return result


@router.get("/plugins/store/connection")
async def read_official_plugin_store_connection(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_active_user),
):
    _assert_capability(current_user, "plugins.configurar", "edit")
    return await pairing_status(db)


@router.post("/plugins/store/{instance_id}/invoke")
async def invoke_official_store_plugin(
    instance_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_active_user),
):
    _assert_capability(current_user, "plugins.habilitar", "edit")
    instance = await _load_instance(db, instance_id)
    manifest = ((instance.config_json or {}).get("_treseko_store") or {}).get("manifest") or {}
    if not instance.enabled or manifest.get("plugin_id") != "com.treseko.junit-importer":
        raise HTTPException(status_code=409, detail="El plugin oficial no está habilitado para invocarse")
    release_id = str(manifest.get("release_id") or "")
    try:
        catalog = await fetch_official_catalog()
        release_available = any(str(item.get("release_id") or "") == release_id and item.get("status") == "published" for item in catalog)
    except PluginStoreClientError as exc:
        # Fail closed: a runner must never execute a release whose revocation
        # state cannot be checked.
        raise HTTPException(status_code=503, detail="No se puede verificar el estado de revocación del plugin") from exc
    if not release_available:
        instance.enabled = False
        instance.status = "revoked"
        instance.last_error = "El release oficial fue revocado o dejó de estar disponible"
        await db.commit()
        await create_audit_log(db, current_user.id, "plugin.revocation_blocked", "plugin_installation", instance.id, {"plugin_id": manifest.get("plugin_id"), "release_id": release_id})
        raise HTTPException(status_code=409, detail="El release oficial está revocado y su ejecución fue bloqueada")
    try:
        result = await invoke_declarative_junit()
    except PluginRunnerError as exc:
        instance.status = "error"
        instance.last_error = str(exc)
        await db.commit()
        await create_audit_log(db, current_user.id, "plugin.invocation_failed", "plugin_installation", instance.id, {"plugin_id": manifest.get("plugin_id")})
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    await create_audit_log(db, current_user.id, "plugin.invoked", "plugin_installation", instance.id, {"plugin_id": manifest.get("plugin_id"), "invocation_id": result.get("invocation_id")})
    return {"status": "accepted", "invocation_id": result.get("invocation_id")}


@router.delete("/plugins/store/{instance_id}", status_code=status.HTTP_204_NO_CONTENT)
async def uninstall_official_store_plugin(
    instance_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_active_user),
):
    """Remove a locally installed official plugin without erasing its audit trail."""
    _assert_capability(current_user, "plugins.instalar", "edit")
    instance = await _load_instance(db, instance_id)
    if not ((instance.config_json or {}).get("_treseko_store") or {}):
        raise HTTPException(status_code=409, detail="Solo los plugins instalados desde la tienda oficial se desinstalan por esta ruta")
    store_manifest = ((instance.config_json or {}).get("_treseko_store") or {}).get("manifest") or {}
    details = {
        "plugin_id": store_manifest.get("plugin_id"), "release_id": store_manifest.get("release_id"),
        "version": store_manifest.get("version"), "manifest": audit_manifest_snapshot(store_manifest),
    }
    await db.delete(instance)
    await db.commit()
    await create_audit_log(db, current_user.id, "plugin.uninstalled", "plugin_installation", instance_id, details)


@router.get("/plugins/store/{instance_id}/audit", response_model=list[schemas.AuditLog])
async def read_official_store_plugin_audit(
    instance_id: UUID,
    limit: int = Query(default=100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_active_user),
):
    _assert_capability(current_user, "plugins.auditoria", "read")
    rows = (await db.execute(
        select(models.AuditLog).where(
            models.AuditLog.recurso == "plugin_installation",
            models.AuditLog.recurso_id == instance_id,
        ).order_by(models.AuditLog.fecha.desc()).limit(limit)
    )).scalars().all()
    user_ids = {row.usuario_id for row in rows if row.usuario_id}
    users_by_id: dict[Any, models.Usuario] = {}
    if user_ids:
        users_by_id = {user.id: user for user in (await db.execute(select(models.Usuario).where(models.Usuario.id.in_(user_ids)))).scalars().all()}
    return [schemas.AuditLog(
        id=row.id, usuario_id=row.usuario_id,
        usuario_email=users_by_id[row.usuario_id].email if row.usuario_id in users_by_id else None,
        usuario_nombre=(users_by_id[row.usuario_id].display_name or users_by_id[row.usuario_id].nombre_completo) if row.usuario_id in users_by_id else None,
        accion=row.accion, recurso=row.recurso, recurso_id=row.recurso_id,
        detalles=row.detalles, ip_address=row.ip_address, origen=row.origen, fecha=row.fecha,
    ) for row in rows]


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
    previous_config = dict(instance.config_json or {})
    internal_config = {key: value for key, value in previous_config.items() if str(key).startswith("_treseko")}
    audit = previous_config.get(AUDIT_CONFIG_KEY)
    config = dict(payload.config_json or {})
    config.update(internal_config)
    if audit:
        config[AUDIT_CONFIG_KEY] = audit
    instance.config_json = config
    instance.status = "configured" if not instance.enabled else "active"
    _append_audit(instance, current_user, "configured")
    await db.commit()
    await db.refresh(instance)
    if (instance.config_json or {}).get("_treseko_store"):
        await create_audit_log(db, current_user.id, "plugin.configured", "plugin_installation", instance.id, {"plugin_id": instance.provider_id, "manifest": audit_manifest_snapshot(((instance.config_json or {}).get("_treseko_store") or {}).get("manifest") or {})})
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
    if (instance.config_json or {}).get("_treseko_store"):
        await create_audit_log(db, current_user.id, "plugin.secrets_configured", "plugin_installation", instance.id, {"plugin_id": instance.provider_id, "manifest": audit_manifest_snapshot(((instance.config_json or {}).get("_treseko_store") or {}).get("manifest") or {})})
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
    store_manifest = ((instance.config_json or {}).get("_treseko_store") or {}).get("manifest") or {}
    if enabled and store_manifest:
        release_id = str(store_manifest.get("release_id") or "")
        try:
            catalog = await fetch_official_catalog()
            release_available = any(str(item.get("release_id") or "") == release_id and item.get("status") == "published" for item in catalog)
        except PluginStoreClientError as exc:
            raise HTTPException(status_code=503, detail="No se puede verificar el estado de revocación del plugin") from exc
        if not release_available:
            instance.enabled = False
            instance.status = "revoked"
            instance.last_error = "El release oficial fue revocado o dejó de estar disponible"
            await db.commit()
            await create_audit_log(db, current_user.id, "plugin.revocation_blocked", "plugin_installation", instance.id, {"plugin_id": store_manifest.get("plugin_id"), "release_id": release_id})
            raise HTTPException(status_code=409, detail="El release oficial está revocado y no se puede habilitar")
    instance.enabled = enabled
    instance.status = "active" if enabled else "disabled"
    instance.last_error = None
    _append_audit(instance, current_user, "enabled" if enabled else "disabled")
    await db.commit()
    await db.refresh(instance)
    if (instance.config_json or {}).get("_treseko_store"):
        await create_audit_log(db, current_user.id, "plugin.enabled" if enabled else "plugin.disabled", "plugin_installation", instance.id, {"plugin_id": instance.provider_id, "manifest": audit_manifest_snapshot(store_manifest)})
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
