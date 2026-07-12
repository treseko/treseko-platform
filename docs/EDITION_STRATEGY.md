# Treseko Community y Premium

Treseko queda preparado como un producto **Open Core**: la base Community conserva el flujo QA operativo y la edicion Premium se habilita por licencia y entitlements desde backend.

## Principios

- No se copia el repo ni se crean dos productos divergentes.
- Community debe seguir siendo usable, no una demo vacia.
- Premium se activa por licencia instalada, no por flags inseguros en frontend.
- El backend es la fuente de verdad para features, limites y bloqueo de rutas.
- Si una licencia vence, no se borran datos Premium: se bloquean funciones Premium y se aplican limites Community.

## Estado Git

- Tag de resguardo: `pre-edition-split-v1.0.0`.
- Rama de preparacion: `edition-split/foundation`.
- No se publica Community todavia.

## Features

| Area | Community | Premium |
| --- | --- | --- |
| Autenticacion | Local | AD/OIDC/SSO |
| Usuarios | Hasta 5 | Segun licencia |
| Organizaciones | 1 | Segun licencia / SaaS preparado |
| Proyectos | Hasta 3 | Segun licencia |
| QA core | Suites, casos, pasos, ejecucion manual | Automatizacion avanzada, API externa avanzada |
| Evidencias | Basicas con limite | Avanzadas y trazabilidad enterprise |
| Bugs | Tracker interno simple | Seguimiento, reincidencias, SLA e integraciones |
| Reportes | Basicos y exportacion simple | Ejecutivos/desarrollo/internos, snapshots, links compartidos |
| IA | Ejecucion IA basica con cuota semanal | Motor IA completo: configuracion avanzada, workflows, presets y trazas |
| Workers | 1 worker local/basico | Multi-worker y scheduler avanzado |
| Integraciones | Minimas | GitHub, GitLab, Jira, Redmine, Azure DevOps |
| Updates | `community-stable` | `premium-stable` / `premium-beta` |
| Branding | Base Treseko visible; configuracion bloqueada como Premium | Nombre e icono/logo personalizable con `branding.custom` |

## Limites Community

| Limite | Valor |
| --- | ---: |
| Organizaciones | 1 |
| Usuarios | 5 |
| Proyectos | 3 |
| Workers | 1 |
| Storage de evidencias | 1024 MB |

## Licencia

Premium requiere un archivo local `license.treseko` con envelope firmado:

- `payload`: producto, cliente, edicion, servidores, token de activacion, features, limites, fechas y `key_id`.
- `signature`: firma Ed25519 del `payload` canonico.

Treseko valida primero la firma local. Si falta el archivo, se adultera el payload, cambia `verification_server`, cambian features/limites o el `key_id` no esta en el keyring, queda en Community y no llama al servidor remoto.

El License Server privado firma `license.treseko` con clave privada; Treseko self-hosted solo conserva keyrings publicos para verificar licencia local y respuesta remota. `TRESEKO_LICENSE_PUBLIC_KEY` y `TRESEKO_LICENSE_SERVER_PUBLIC_KEY` solo se aceptan con flags `TRESEKO_ALLOW_DEV_*` para desarrollo/tests; no deben habilitarse en produccion. Una instancia self-hosted no puede firmar sus propias licencias Premium.

El servidor remoto solo confirma vigencia con respuestas firmadas, nonce anti-replay e `instance_id` estable. No se aceptan features, limites ni status Premium desde JSON remoto sin firma.

## Endpoints

- `GET /system/edition`
- `GET /system/features`
- `GET /system/branding/public`
- `GET /system/branding`
- `PATCH /system/branding`
- `GET /system/license`
- `POST /system/license/install`

La pantalla `Configuracion > Licencia` consume los endpoints de licencia y muestra edicion, estado, limites, features y canal de updates. `Configuracion > Preferencias` consume los endpoints de branding: Community muestra una card Premium bloqueada y Premium permite guardar `brand_name`, `logo_url` y `enabled`.

## Bloqueo Backend

Las rutas premium deben bloquearse en backend con entitlements. La base inicial gatea features Community y Premium:

- `ai.basic_execution`
- `ai.engine`
- `auth.sso`
- `automation.scheduler`
- `branding.custom`

El helper `require_feature(feature_id)` debe aplicarse progresivamente al resto de rutas Premium mientras se clasifica cada modulo.

## Separacion De Codigo

### Community

- Core QA
- Auth local
- Proyectos basicos
- Suites, casos y pasos
- Ejecucion manual
- Bug tracker simple
- Reportes basicos
- Evidencia basica
- Pantalla de licencia para upgrade a Premium
- Branding base Treseko y card informativa Premium en Preferencias

### Premium

- IA avanzada
- Workers multiples
- Scheduler
- SSO/AD/OIDC
- Integraciones enterprise
- Reportes compartidos y snapshots avanzados
- Auditoria avanzada y seguridad
- API externa avanzada
- Metricas historicas avanzadas
- Branding personalizado de nombre e icono/logo

### Shared

- Modelos base
- Seguridad comun
- Auditoria comun
- Persistencia
- Utilidades de fecha, sanitizacion y archivos
- Catalogos de features y limites

## Flujo De Upgrade

1. El usuario abre `Configuracion > Licencia`.
2. Instala un JSON de licencia Premium firmado. Community no usa ni acepta archivo de licencia propio.
3. Backend valida firma, vencimiento, features y limites.
4. Frontend refresca `/system/features`.
5. Las pantallas Premium quedan visibles o habilitadas segun permisos RBAC y entitlements.

No requiere reinstalar Treseko.

## Vencimiento

Si Premium vence:

- Treseko vuelve a operar como Community.
- No se eliminan datos generados con Premium.
- Las rutas Premium devuelven `403`.
- Se aplican limites Community para nuevas operaciones.

## Pendientes Antes De Publicar Community

- Separar codigo sensible Premium antes de publicar un repo Community.
- Auditar paquetes, assets, documentos y scripts para no exponer secretos o propiedad Premium.
- Crear pipeline que construya Community desde el core sin copiar carpetas manualmente.
