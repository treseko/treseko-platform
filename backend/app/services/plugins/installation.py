"""Safe local installation of official declarative plugins.

Artifacts are validated as bytes and deliberately never imported, extracted or
executed in the API process. WASM remains unavailable until the isolated runner
is deployed.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ... import models
from ...repositories.scheduled_runs_audit import create_audit_log
from ...time_utils import utc_now
from .manifest import PluginManifestError, audit_manifest_snapshot, installation_scope_key, validate_plugin_manifest


DECLARATIVE_JUNIT_ARTIFACT = b'{"contract":"treseko.declarative-plugin/v1","entrypoint":"junit_xml.import_results"}\n'
DECLARATIVE_CASE_PORTABILITY_ARTIFACT = b'{"contract":"treseko.declarative-plugin/v1","entrypoint":"case_portability.brokered"}\n'


async def install_official_plugin(
    db: AsyncSession,
    *,
    manifest: dict[str, Any],
    artifact_b64: str,
    user: models.Usuario,
    organizacion_id=None,
    proyecto_id=None,
) -> models.IntegrationInstance:
    try:
        artifact = base64.b64decode(artifact_b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise PluginManifestError("El artefacto descargado no está codificado correctamente") from exc
    verified = validate_plugin_manifest(manifest)
    if hashlib.sha256(artifact).hexdigest() != verified["checksum_sha256"] or len(artifact) != verified["size_bytes"]:
        raise PluginManifestError("El artefacto descargado no coincide con el manifest firmado")
    allowed_artifacts = {DECLARATIVE_JUNIT_ARTIFACT, DECLARATIVE_CASE_PORTABILITY_ARTIFACT}
    if verified["kind"] != "declarative" or artifact not in allowed_artifacts:
        raise PluginManifestError("Este plugin requiere un runner aislado que aún no está disponible")
    provider_id = verified["plugin_id"]
    scope_key = installation_scope_key(organizacion_id=organizacion_id, proyecto_id=proyecto_id)
    existing = (await db.execute(select(models.IntegrationInstance).where(
        models.IntegrationInstance.provider_id == provider_id,
        models.IntegrationInstance.scope_key == scope_key,
    ).order_by(models.IntegrationInstance.created_at.desc()))).scalars().first()
    config = {
        "_treseko_store": {
            "release_id": verified["release_id"],
            "version": str(manifest.get("version") or ""),
            "manifest": manifest,
            "artifact_sha256": verified["checksum_sha256"],
            "installed_at": utc_now().isoformat(),
        }
    }
    if existing:
        existing.enabled = False
        existing.status = "installed"
        existing.config_json = config
        existing.last_error = None
        instance = existing
        action = "plugin.updated"
    else:
        instance = models.IntegrationInstance(
            provider_id=provider_id,
            scope_key=scope_key,
            organizacion_id=organizacion_id,
            proyecto_id=proyecto_id,
            enabled=False,
            status="installed",
            config_json=config,
            secrets_configured={},
            created_by=user.id,
        )
        db.add(instance)
        await db.flush()
        action = "plugin.installed"
    await db.commit()
    await db.refresh(instance)
    await create_audit_log(
        db,
        user.id,
        action,
        "plugin_installation",
        instance.id,
        {"plugin_id": provider_id, "release_id": verified["release_id"], "version": manifest.get("version"), "enabled": False, "manifest": audit_manifest_snapshot(manifest)},
    )
    return instance
