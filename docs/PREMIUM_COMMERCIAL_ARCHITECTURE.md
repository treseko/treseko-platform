# Treseko Premium Commercial Architecture

## Objetivo

Treseko Community puede instalarse self-hosted sin secretos comerciales. Treseko Premium
se activa con un archivo `license.treseko` firmado por un License Server privado. La
instancia self-hosted solo verifica firmas con clave publica y nunca puede emitir sus
propias licencias Premium.

El procedimiento operativo para generar claves, emitir licencias, renovar, revocar y
publicar updates vive en [Premium Operations Runbook](PREMIUM_OPERATIONS_RUNBOOK.md).
El contrato de APIs privadas para License Server y Update Server vive en
[Premium Private Servers OpenAPI](PREMIUM_PRIVATE_SERVERS_OPENAPI.yaml).
La trazabilidad requisito-por-evidencia vive en
[Premium Requirements Matrix](PREMIUM_REQUIREMENTS_MATRIX.md).

## Firma De Licencias

- Algoritmo elegido: Ed25519.
- Formato de firma: `ed25519:<base64url(signature)>`.
- Payload canonico: JSON sin el campo `signature`, ordenado por clave y sin espacios.
- License Server privado:
  - guarda la clave privada Ed25519;
  - crea, renueva y revoca licencias;
  - firma `license.treseko`;
  - registra auditoria de emision, renovacion, revocacion, cliente, usuario y timestamp.
- Treseko self-hosted:
  - conserva solo el keyring publico oficial embebido en el build;
  - instala licencias desde Configuracion > Licencia;
  - valida firma, `key_id`, expiracion, features y limites;
  - vuelve a Community si la licencia vence, se adultera o no verifica.

`TRESEKO_LICENSE_PUBLIC_KEY` queda reservado para desarrollo/tests y solo se usa si
`TRESEKO_ALLOW_DEV_LICENSE_PUBLIC_KEY=true`. En un release comercial no debe habilitarse:
permitir una clave publica arbitraria haria posible validar licencias autofirmadas por una
instancia self-hosted.

## License Server Privado

Debe ser un servicio separado de la distribucion self-hosted. Capacidades:

- CRUD de clientes y licencias.
- Crear licencia Premium con:
  - `license_id`
  - `customer_id`
  - `key_id`
  - `issued_at`
  - `expires_at`
  - `enabled_features`
  - `max_organizations`
  - `max_users`
  - `max_projects`
  - `max_workers`
  - `max_storage_mb`
  - `update_channel`
- Renovar licencia preservando historial.
- Revocar licencia y publicar estado de revocacion.
- Mantener catalogo privado de features Premium licenciables. Cambiar el catalogo no
  modifica licencias ya firmadas; requiere renovar o reemitir `license.treseko`.
- Firmar y descargar `license.treseko`.
- Auditar cada accion administrativa.

Para revocacion offline, el License Server emite un nuevo `license.treseko` firmado con
`revoked_at`. Al instalarlo, Treseko marca la licencia como `revoked`, vuelve a Community,
conserva el payload para auditoria y bloquea features Premium.

### Modelo Operativo Del License Server

El License Server no forma parte del binario self-hosted. Debe vivir en infraestructura
privada de Treseko y exponer solo endpoints administrativos protegidos por MFA/RBAC.

Entidades minimas:

- `Customer`: datos comerciales, contacto, estado y metadata fiscal.
- `License`: `license_id`, `customer_id`, `key_id`, estado, fechas, features, limites,
  canal, version de contrato y fingerprint del archivo firmado.
- `LicenseEvent`: auditoria inmutable de creacion, renovacion, revocacion, descarga,
  rotacion de claves y cambios de features/limites.
- `SigningKey`: referencia de clave privada en KMS/HSM, version, `key_id`, estado y
  periodo de vigencia. La clave privada no se persiste en base de datos.

Endpoints privados sugeridos:

- `POST /customers`
- `GET /customers/{customer_id}`
- `POST /licenses`
- `GET /licenses/{license_id}`
- `GET /licenses/{license_id}/status`
- `POST /licenses/{license_id}/renew`
- `POST /licenses/{license_id}/revoke`
- `PATCH /licenses/{license_id}/features`
- `PATCH /licenses/{license_id}/limits`
- `PATCH /licenses/{license_id}/update-channel`
- `POST /licenses/{license_id}/sign`
- `GET /licenses/{license_id}/download`
- `GET /licenses/{license_id}/events`

La especificacion OpenAPI privada define estos endpoints como contrato operativo, no como
parte del backend self-hosted.

`GET /licenses/{license_id}/status` es la fuente autoritativa para soporte y para el
Update Server antes de emitir grants Premium. Debe devolver estado vigente, version,
`customer_id`, `key_id`, canal de update, features, limites, `revoked_at` cuando aplique
y el hash canonico del ultimo documento firmado, sin exponer material privado.

Invariantes:

- Solo el License Server puede firmar licencias con clave privada.
- La emision comercial debe usar `sign_license_document` desde el License Server privado
  o desde la herramienta operativa `backend/scripts/premium_signing.py`, no agregar
  `key_id` ni otros campos despues de firmar.
- `key_id` es obligatorio en cada `license.treseko` Premium y debe coincidir con un
  fingerprint del keyring publico embebido en el build comercial.
- La clave privada debe salir de KMS/HSM solo como operacion de firma, no como material
  exportable.
- Cada firma debe registrar `actor`, `reason`, `source_ip`, `key_id`, hash canonico del
  payload y hash del archivo final.
- Renovar o revocar no edita historicos: crea una nueva version firmada.
- El cliente self-hosted nunca recibe secretos ni endpoints de firma.
- El runtime `backend/app` no debe contener helpers de firma ni referencias a claves
  privadas; solo verifica licencias con el keyring publico oficial.

La postura criptografica self-hosted se audita con:

```bash
PYTHONDONTWRITEBYTECODE=1 python backend/scripts/audit_premium_crypto_posture.py
```

El auditor falla si reaparecen HMAC/`SIGNING_SECRET`, claves privadas o helpers de firma
en el runtime self-hosted.

## Update Server

Debe publicar manifests firmados por canal y edicion:

- `community-stable`
- `community-beta`
- `premium-stable`
- `premium-beta`

Reglas:

- Community consulta solo manifests Community.
- Premium consulta manifests Premium si la licencia esta activa.
- Los manifests deben incluir `key_id`, version, canal, checksums, fecha, notas y localizador de paquete.
- Los manifests Community pueden usar URL descargable. Los manifests Premium solo deben usar
  una referencia opaca; la URL real se entrega con `DownloadGrant`.
- Los manifests Premium tambien deben requerir licencia activa.
- Los paquetes Premium no se descargan sin licencia valida.
- El manifest debe estar firmado por el Update Server con clave separada de licencias.

Treseko self-hosted valida manifests con un keyring publico de updates embebido, separado
del keyring de licencias. `TRESEKO_UPDATE_PUBLIC_KEY` queda reservado para desarrollo/tests
y solo se usa si `TRESEKO_ALLOW_DEV_UPDATE_PUBLIC_KEY=true`. El backend expone:

- `GET /system/updates/channels`: muestra canales Community y Premium disponibles para la licencia actual.
- `POST /system/updates/check`: valida firma del manifest, edicion, canal, checksum y entitlement.
  Para canales Premium devuelve `download_grant_required=true` y no promueve una URL
  directa de paquete en la respuesta validada.
- `POST /system/updates/download-grant-request`: prepara el request firmado que debe
  enviarse al Update Server privado para obtener un `DownloadGrant` Premium.

Estos endpoints no descargan paquetes. La descarga debe ocurrir solo despues de que el
Update Server privado emita un `DownloadGrant`; para canales Premium se exige una licencia
activa con `updates.premium`.

### Modelo Operativo Del Update Server

El Update Server debe separar discovery, autorizacion y descarga:

- `Release`: version, edicion, canal, notas, checksums, compatibilidad minima y estado.
- `Package`: artefacto por plataforma/arquitectura, checksum SHA-256, tamano y URL interna.
- `UpdateManifest`: manifest publico firmado, sin secretos ni URLs Premium directas.
- `DownloadGrant`: token corto de descarga emitido solo despues de validar licencia activa.
- `UpdateAuditEvent`: consulta de update, decision, licencia, cliente, version y canal.

Endpoints sugeridos:

- `GET /updates/{edition}/{channel}/latest`
- `POST /updates/check`
- `POST /updates/download-grant`
- `GET /updates/download/{grant_token}`
- `POST /admin/releases`
- `POST /admin/releases/{release_id}/publish`
- `POST /admin/releases/{release_id}/sign-manifest`

La especificacion OpenAPI privada tambien define discovery de manifests, grants de descarga
y descarga autorizada. Los endpoints `/system/updates/check` y
`/system/updates/download-grant-request` del self-hosted solo validan y preparan contexto;
no descargan paquetes Premium.

Reglas de seguridad:

- Los manifests Community pueden ser publicos, pero siempre firmados.
- Los manifests Premium pueden ser visibles, pero sus paquetes no deben descargarse sin
  `DownloadGrant` emitido por licencia activa.
- La publicacion comercial debe usar `sign_update_manifest_document` desde el Update
  Server privado o desde la herramienta operativa `backend/scripts/premium_signing.py`,
  no agregar `key_id` ni otros campos despues de firmar.
- El grant debe ser de corta duracion, single-use y atado a `license_id`, `customer_id`,
  `release_id`, version, canal, checksum y artefacto publicado.
- Los rechazos del Update Server deben responder con un error estructurado
  `PremiumErrorResponse` para soporte y auditoria. Codigos esperados incluyen
  `license_missing`, `license_invalid`, `license_expired`, `license_revoked`,
  `customer_mismatch`, `channel_not_allowed`, `feature_not_entitled`,
  `manifest_invalid`, `manifest_mismatch`, `grant_invalid`, `grant_expired`
  y `grant_reused`.
- El paquete descargado debe validarse localmente contra el `checksum_sha256` del manifest
  firmado antes de instalar.
- Community nunca puede usar canales `premium-stable` o `premium-beta`.

## Upgrade Y Downgrade

- Community pasa a Premium instalando `license.treseko`.
- Premium vencido, revocado, adulterado o sin clave publica vuelve a Community.
- El downgrade no borra datos Premium.
- Funciones Premium quedan bloqueadas por entitlements.
- Los datos historicos Premium siguen disponibles en lectura segura cuando corresponda.
- Al renovar licencia, las features y limites se recalculan sin migraciones destructivas.

La politica central `PREMIUM_HISTORICAL_READ_POLICY` define que se puede leer despues
del downgrade y que sigue requiriendo Premium activo. Ejemplos:

- `reports.snapshots`: links publicos compartidos, payloads congelados e historial de
  bundles ya creados siguen legibles; crear, configurar, revocar o administrar nuevos
  paquetes compartidos requiere Premium activo.
- `reports.advanced`: exportes y metricas congeladas ya generadas siguen legibles;
  generar nuevos informes ejecutivo/desarrollo o cambiar configuracion avanzada requiere
  Premium activo.
- `bugs.enterprise`: historial de bugs, comentarios de ocurrencias y metadata de links
  externos existentes siguen legibles; deduplicar, vincular nuevas ocurrencias o sincronizar
  integraciones enterprise requiere Premium activo.
- `audit.advanced`: observaciones e informes ya generados siguen legibles; ejecutar nuevas
  auditorias completas o generar nueva evidencia de seguridad requiere Premium activo.

## Entitlements

La aplicacion no debe depender directamente de licencias locales. Debe consultar un
`EntitlementProvider`:

- `LicenseEntitlementProvider`: self-hosted con licencia instalada.
- `TenantSubscriptionEntitlementProvider`: futuro SaaS por tenant/suscripcion.

Los routers y servicios usan `require_feature`, `check_limit` y `enforce_limit`; no deben
saber si el permiso viene de `license.treseko` o de una suscripcion SaaS.

Cuando un limite comercial bloquea una operacion, la respuesta debe incluir informacion
diagnosticable para soporte y frontend: id tecnico (`max_users`, `max_projects`, etc.),
etiqueta legible, valor actual, valor solicitado y limite contratado. Esto evita errores
genericos y permite indicar al cliente si debe limpiar uso o ampliar licencia.

`TenantSubscriptionEntitlementProvider` se activa con `TRESEKO_ENTITLEMENT_PROVIDER=saas`
y consulta `TRESEKO_SAAS_ENTITLEMENT_URL` con `TRESEKO_SAAS_ENTITLEMENT_TOKEN` opcional.
Si el servicio SaaS no esta configurado o no responde, falla cerrado a Community para no
habilitar Premium por error. El timeout se controla con
`TRESEKO_SAAS_ENTITLEMENT_TIMEOUT_SECONDS`. La respuesta remota se normaliza contra el
catalogo local: features desconocidas se ignoran y limites no numericos o negativos no
se aceptan. El canal de updates SaaS se restringe a `premium-stable` o `premium-beta`;
cualquier canal Community, desconocido o vacio vuelve a `premium-stable` para fallar de
forma conservadora sin habilitar rutas de update no contratadas.
Si se solicita un `tenant_id`, la respuesta remota debe declarar el mismo valor en
`tenant_id` o `tenant`; si falta o no coincide, el provider falla cerrado a Community.

La frontera se audita con `audit_premium_entitlement_boundaries.py`: fuera de
`services/edition` y del router `/system`, los modulos de negocio no deben importar
`license_manager`, llamar `get_license_state`/`evaluate_license`/`install_license`, leer
`TRESEKO_ENTITLEMENT_PROVIDER` ni instanciar proveedores concretos. Esa regla mantiene el
runtime preparado para SaaS sin bifurcar routers ni servicios.

## Features Premium Iniciales

- Motor IA completo.
- Multi-worker.
- Scheduler avanzado.
- Integraciones enterprise.
- Reportes ejecutivos/desarrollo/snapshot.
- Links compartidos avanzados.
- Bug tracker enterprise.
- AD/OIDC/SSO.
- Auditoria avanzada y seguridad.
- API externa avanzada.
- Notificaciones/email avanzadas.

## Gates Backend Implementados

- `ai.engine`: router de Motor IA.
- `auth.sso`: router Active Directory/OIDC/SSO.
- `automation.multi_worker`: limite comercial `max_workers` en alta/activacion de workers.
- `automation.scheduler`: scheduler avanzado.
- `integrations.enterprise`: integracion Redmine y futuras integraciones enterprise.
- `external_api.advanced`: `POST /external/executions/report`.
- `reports.advanced`: configuracion avanzada de informes por proyecto.
- `reports.snapshots`: creacion, historial, estado y revocacion de paquetes compartidos.
- `bugs.enterprise`: deduplicacion, bugs relacionados por caso logico, seguimiento de ejecuciones,
  links externos y marcado de duplicados.
- `notifications.email`: SMTP, reglas, plantillas, inbox, auditoria y procesamiento de notificaciones.
- `audit.advanced`: auditoria global y logs internos usados por auditorias avanzadas.

Los links publicos de snapshots ya creados siguen siendo legibles para preservar historicos congelados
cuando una licencia vence; crear o administrar nuevos snapshots requiere Premium activo.

La consistencia entre catalogo Premium y gates backend se audita con:

```bash
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend python backend/scripts/audit_premium_feature_gates.py
```

El auditor falla si existe un `require_feature(...)` con un ID ausente del catalogo o si
alguna feature Premium requerida no esta declarada. Las features conceptuales o cubiertas
por limites, como `automation.multi_worker`, se reportan como contrato/limite en lugar de
gate directo.

## Pruebas Minimas

- Sin licencia: Community.
- Licencia Premium valida: activa features y limites.
- Licencia vencida: vuelve a Community sin borrar payload.
- Licencia adulterada: vuelve a Community.
- Sin clave publica: no activa Premium.
- Feature Premium bloqueada: devuelve 403 controlado.
- Limites de usuarios/proyectos/workers: bloquean con mensaje claro.
- Update Premium sin licencia: bloqueado por Update Server.
