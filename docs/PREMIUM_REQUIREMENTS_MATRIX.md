# Treseko Premium Requirements Matrix

## Estado General

Treseko ya tiene la base tecnica para vender una edicion Premium self-hosted sin romper
Community: licencias firmadas, keyrings publicos, feature gates, limites, downgrade seguro,
contrato privado de License/Update Server y abstraccion para SaaS.

El release comercial real sigue bloqueado hasta inyectar keyrings publicos oficiales de
licencias y updates generados en la ceremonia privada. Este bloqueo es intencional: evita
que un build self-hosted acepte licencias autofirmadas.

Comando de readiness:

```bash
PYTHONDONTWRITEBYTECODE=1 python backend/scripts/check_premium_release_readiness.py --json
```

## Matriz De Requisitos

| Requisito | Estado | Evidencia Principal | Verificacion |
| --- | --- | --- | --- |
| Licencias con firma asimetrica Ed25519 | Implementado | `backend/app/services/edition/license_manager.py` usa `Ed25519PublicKey` y `LICENSE_SIGNATURE_ALGORITHM = "ed25519"` | `backend/scripts/audit_premium_crypto_posture.py` |
| Sin HMAC/secreto simetrico runtime | Implementado | Auditoria bloquea `SIGNING_SECRET`, HMAC y helpers de firma en runtime | `backend/scripts/audit_premium_crypto_posture.py` |
| Self-hosted solo verifica con clave publica | Implementado | `EMBEDDED_LICENSE_PUBLIC_KEYS`, `EMBEDDED_UPDATE_PUBLIC_KEYS`, overrides dev deshabilitados para release | `backend/scripts/check_premium_release_readiness.py --json` |
| Self-hosted no puede firmar licencias Premium | Implementado | `premium_signing.py` queda fuera del paquete self-hosted y el runtime no importa helpers de firma | `backend/scripts/audit_self_hosted_package_boundary.py <paquete>` |
| `key_id` obligatorio para licencias Premium | Implementado | `normalize_license_payload` y `SystemLicenseInstallRequest` exigen `key_id` | `backend/test_edition_license_entitlements.py` |
| Fechas de lifecycle obligatorias y coherentes | Implementado | Runtime exige `issued_at`/`expires_at`; contrato privado exige `expires_at` posterior a `issued_at` | `backend/scripts/audit_private_servers_contract.py` |
| `key_id` obligatorio para manifests de update | Implementado | Schema `/system`, `verify_update_manifest_signature` y contrato privado rechazan manifests sin `key_id` | `backend/test_edition_license_entitlements.py` |
| License Server privado disenado | Implementado como contrato | `docs/PREMIUM_PRIVATE_SERVERS_OPENAPI.yaml` define clientes, licencias, renovacion, revocacion, features, limites, canal, firma y auditoria | `backend/scripts/audit_private_servers_contract.py` |
| Estado autoritativo de licencia para soporte/update | Implementado como contrato | `GET /licenses/{license_id}/status` expone estado vigente, version, canal, features, limites, revocacion y hash del ultimo documento firmado sin secretos | `backend/scripts/audit_private_servers_contract.py` |
| Update Server privado disenado | Implementado como contrato | OpenAPI define manifests firmados, canales Community/Premium, grants y descarga autorizada | `backend/scripts/audit_private_servers_contract.py` |
| Paquete self-hosted publica metadata verificable para Update Server | Implementado | Empaquetador genera `.sha256` y `.manifest.json` con artifact, tipo, tamano, cantidad de archivos y checksum; contrato privado exige esa metadata en `ReleaseCreate` | `backend/test_edition_license_entitlements.py` |
| Updates Premium bloqueados sin licencia | Implementado | `update_manager.py` valida licencia activa y `updates.premium`; Premium usa `download_grant_required` | `backend/test_edition_license_entitlements.py` |
| No URLs directas para paquetes Premium | Implementado | `validate_update_manifest` rechaza manifests Premium con URLs directas | `backend/test_edition_license_entitlements.py` |
| Errores Premium de update diagnosticables | Implementado como contrato | `PremiumErrorResponse` estandariza rechazos por licencia, cliente, canal, manifest o grant sin exponer secretos | `backend/scripts/audit_private_servers_contract.py` |
| Upgrade Community a Premium | Implementado | Instalacion de `license.treseko` activa entitlements Premium si firma/fechas/features son validas | `backend/test_edition_license_entitlements.py` |
| Downgrade Premium vencido/revocado/adulterado a Community | Implementado | `evaluate_license` cae a Community y conserva payload de licencia | `backend/test_edition_license_entitlements.py` |
| No borrar datos Premium al vencer | Implementado a nivel de licencia/entitlement | Tests verifican payload conservado y estado `expired`/`revoked` | `backend/test_edition_license_entitlements.py` |
| Lectura segura de historicos Premium tras downgrade | Implementado como politica central | `PREMIUM_HISTORICAL_READ_POLICY` permite leer snapshots/reportes/bugs/auditorias congeladas y mantiene creacion/administracion bajo Premium activo | `backend/test_edition_license_entitlements.py` |
| Bloquear funciones Premium con aviso | Implementado | `require_feature` y `ensure_feature_enabled` devuelven mensaje Premium controlado | `backend/scripts/audit_premium_feature_gates.py` |
| Motor IA completo como Premium | Implementado/gateado | Catalogo incluye `ai.engine`; auditoria exige gate | `backend/scripts/audit_premium_feature_gates.py` |
| Multi-worker como Premium | Implementado/gateado por limite | `max_workers` controla capacidad operativa | `backend/scripts/audit_premium_limits.py` |
| Scheduler avanzado como Premium | Implementado/gateado | Catalogo incluye `automation.scheduler`; auditoria exige gate | `backend/scripts/audit_premium_feature_gates.py` |
| Integraciones enterprise como Premium | Implementado/gateado | Catalogo y matriz Premium incluyen `integrations.enterprise` | `backend/scripts/audit_premium_feature_gates.py` |
| Reportes ejecutivos/desarrollo/snapshot como Premium | Implementado/gateado | Catalogo incluye `reports.advanced` y `reports.snapshots` | `backend/scripts/audit_premium_feature_gates.py` |
| Links compartidos avanzados como Premium | Implementado/gateado | Cubierto por `reports.snapshots` y matriz comercial | `backend/scripts/audit_premium_commercial_coverage.py` |
| Bug tracker enterprise como Premium | Implementado/gateado | Catalogo incluye `bugs.enterprise` | `backend/scripts/audit_premium_feature_gates.py` |
| AD/OIDC/SSO como Premium | Implementado/gateado | Catalogo incluye `auth.sso`; UI/backend de licencia lo exponen | `backend/scripts/audit_premium_feature_gates.py` |
| Auditoria avanzada y seguridad como Premium | Implementado/gateado | Catalogo incluye `audit.advanced` | `backend/scripts/audit_premium_feature_gates.py` |
| API externa avanzada como Premium | Implementado/gateado | Catalogo incluye `external_api.advanced` | `backend/scripts/audit_premium_feature_gates.py` |
| Notificaciones/email avanzadas como Premium | Implementado/gateado | Catalogo incluye `notifications.email` | `backend/scripts/audit_premium_feature_gates.py` |
| EntitlementProvider para SaaS | Implementado | `LicenseEntitlementProvider` y `TenantSubscriptionEntitlementProvider` | `backend/scripts/audit_premium_entitlement_boundaries.py` |
| SaaS falla cerrado ante tenant ausente o mismatch | Implementado | `TenantSubscriptionEntitlementProvider` no activa Premium si la respuesta remota no declara el tenant solicitado o pertenece a otro tenant | `backend/test_edition_license_entitlements.py` |
| Runtime desacoplado del origen del entitlement | Implementado | Servicios consultan helpers de entitlement, no detalles de licencia local | `backend/scripts/audit_premium_entitlement_boundaries.py` |
| Limites de usuarios/proyectos/workers/storage | Implementado | Catalogo Community/Premium, gates backend y mensajes con id tecnico, etiqueta, valor actual, solicitado y limite | `backend/scripts/audit_premium_limits.py` |
| Evidencia reproducible de release | Implementado | Reportes JSON/Markdown de readiness/cobertura/paquete | `backend/scripts/generate_premium_release_evidence.py` |
| Readiness dev sano salvo keyrings oficiales | Implementado | Auditor falla si aparece cualquier bloqueo distinto de las keyrings pendientes; con `--package-path` tambien audita el artefacto self-hosted | `backend/scripts/audit_premium_dev_readiness.py` |

## Bloqueos Intencionales Antes De Release Comercial

1. Generar claves oficiales Ed25519 para licencia y update en infraestructura privada.
2. Inyectar solo claves publicas en el build comercial con:

```bash
python backend/scripts/inject_premium_public_keyrings.py \
  --license-public-key "<PUBLIC_KEY_LICENSE_B64URL>" \
  --update-public-key "<PUBLIC_KEY_UPDATE_B64URL>" \
  --write
```

3. Ejecutar readiness sin `--allow-not-ready`.
4. Construir paquete self-hosted y auditar frontera del artefacto:

```bash
PYTHONDONTWRITEBYTECODE=1 python packaging/build_self_hosted_package.py \
  --output dist/treseko-self-hosted.tar.gz
```

El comando anterior debe generar tambien:

- `dist/treseko-self-hosted.tar.gz.sha256`
- `dist/treseko-self-hosted.tar.gz.manifest.json`

El Update Server privado usa esos sidecars para crear `ReleaseCreate` con
`artifact`, `artifact_type`, `package_size_bytes` y `checksum_sha256`.

```bash
PYTHONDONTWRITEBYTECODE=1 python backend/scripts/check_premium_release_readiness.py \
  --json \
  --package-path dist/treseko-self-hosted.tar.gz
```

## Comandos De Control Recomendados

```bash
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend python backend/test_edition_license_entitlements.py
PYTHONDONTWRITEBYTECODE=1 python backend/scripts/audit_premium_commercial_coverage.py
PYTHONDONTWRITEBYTECODE=1 python backend/scripts/audit_private_servers_contract.py
PYTHONDONTWRITEBYTECODE=1 python backend/scripts/audit_premium_feature_gates.py
PYTHONDONTWRITEBYTECODE=1 python backend/scripts/audit_premium_limits.py
PYTHONDONTWRITEBYTECODE=1 python backend/scripts/audit_premium_dev_readiness.py
# opcional con paquete:
PYTHONDONTWRITEBYTECODE=1 python backend/scripts/audit_premium_dev_readiness.py --package-path dist/treseko-self-hosted.tar.gz
PYTHONDONTWRITEBYTECODE=1 python backend/scripts/check_premium_release_readiness.py --json
```
