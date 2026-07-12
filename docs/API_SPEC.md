# API Specification - Estado Real

Este documento describe las rutas que existen actualmente en `backend/app/main.py`.

> Nota: la API real no usa prefijo `/api/v1`. Si se decide versionar la API, hay que cambiar el backend o actualizar clientes y documentacion al mismo tiempo.

## Autenticacion y usuarios

| Metodo | Endpoint | Auth | Estado | Descripción |
|---|---|---|---|---|
| POST | `/auth/register/` | No | Implementado | Registra usuario local público como `TESTER`; no permite autoasignar rol, rol custom, proveedor ni permisos. |
| POST | `/auth/login/` | No | Implementado | Devuelve JWT bearer. Usa `OAuth2PasswordRequestForm`. |
| GET | `/users/me/` | Bearer | Implementado | Perfil del usuario activo, incluyendo `auth_provider` y `módulos`. |
| GET | `/usuarios/` | Admin/QA Lead | Implementado | Lista usuarios para asignaciones y administracion inicial. |
| POST | `/usuarios/` | `configuracion:edit` | Implementado | Crea usuario local o AD con rol global/custom y permisos asignados. |
| PATCH | `/usuarios/{usuario_id}` | `configuracion:edit` | Implementado | Actualiza email, nombre, rol, proveedor, estado, password, módulos y permisos. |
| DELETE | `/usuarios/{usuario_id}` | `configuracion:edit` | Implementado | Inactiva usuario sin borrarlo fisicamente. Bloquea auto-inactivacion. |

Campos relevantes de usuario:

- `auth_provider`: `local` o `ad`.
- `módulos`: lista de ids de módulo visibles/permitidos para el usuario.
- `permisos`: mapa `{ módulo: "read" | "edit" }`.
- `rol`: `ADMIN`, `QA_LEAD`, `TESTER` o `VIEWER`.
- `rol_custom_id`: rol personalizado opcional. Si se envia, el usuario hereda los módulos del rol personalizado.

## Roles personalizados

| Metodo | Endpoint | Auth | Estado | Descripción |
|---|---|---|---|---|
| GET | `/roles/` | `configuracion:read` | Implementado | Lista roles personalizados activos. Acepta `include_inactive=true`. |
| POST | `/roles/` | `configuracion:edit` | Implementado | Crea rol personalizado con nombre, descripción, permisos/módulos y estado. |
| PATCH | `/roles/{role_id}` | `configuracion:edit` | Implementado | Actualiza rol personalizado. |
| DELETE | `/roles/{role_id}` | `configuracion:edit` | Implementado | Inactiva rol personalizado sin borrarlo fisicamente. |

Reglas:

- `read`: permite ver/acceder al módulo.
- `edit`: permite modificar cuando la ruta backend implemente esa validación.
- `edit` incluye lectura.
- Un usuario no puede inactivar su propia cuenta.

## Organizaciones y proyectos

| Metodo | Endpoint | Auth | Estado | Descripción |
|---|---|---|---|---|
| POST | `/organizaciones/` | Admin | Implementado | Crea organizacion. |
| GET | `/organizaciones/` | No obligatorio hoy | Implementado | Lista organizaciones. |
| POST | `/proyectos/` | Admin | Implementado | Crea proyecto. |
| GET | `/proyectos/` | Bearer | Implementado | Lista proyectos. |
| GET | `/proyectos/{proyecto_id}` | No obligatorio hoy | Implementado | Obtiene proyecto. |
| PATCH | `/proyectos/{proyecto_id}` | Admin | Implementado | Actualiza nombre, descripción, activo y organizacion. |
| GET | `/proyectos/{proyecto_id}/miembros/` | No obligatorio hoy | Implementado | Lista miembros asignados al proyecto. |
| POST | `/proyectos/{proyecto_id}/miembros/` | Admin | Implementado | Asigna o actualiza rol de un usuario en el proyecto. |
| DELETE | `/proyectos/{proyecto_id}/miembros/{usuario_id}` | Admin | Implementado | Quita usuario del equipo del proyecto. |
| GET | `/proyectos/{proyecto_id}/metrics/` | No obligatorio hoy | Implementado | Devuelve métricas reales calculadas desde ejecuciones y build scope. Acepta `build_id` opcional para filtrar por build especifica; si no se envia, usa la build activa del proyecto. |

Respuesta de métricas:

```json
{
  "build_id": "uuid",
  "build_name": "Build v1.0",
  "total_casos_asignados": 100,
  "total_ejecutados": 85,
  "cobertura_porcentaje": 85.0,
  "stats": {
    "pasados": 70,
    "fallados": 10,
    "bloqueados": 5,
    "pendientes": 15
  },
  "por_tipo_ejecucion": {
    "manual": 60,
    "automatizada_ia": 25
  },
  "por_prioridad": {
    "alta": { "total": 30, "pasados": 25, "fallados": 3, "bloqueados": 2 },
    "media": { "total": 50, "pasados": 35, "fallados": 5, "bloqueados": 2 },
    "baja": { "total": 20, "pasados": 10, "fallados": 2, "bloqueados": 1 }
  },
  "historico_versions": [
    { "build_id": "uuid", "build_name": "v1.0", "pasados": 60, "fallados": 8, "bloqueados": 2, "fecha": "2026-06-01" },
    { "build_id": "uuid", "build_name": "v1.1", "pasados": 70, "fallados": 10, "bloqueados": 5, "fecha": "2026-06-15" }
  ]
}
```

Notas:

- Si no se especifica `build_id`, usa la build activa del componente activo.
- `total_casos_asignados` viene de `build_casos`.
- `total_ejecutados` cuenta casos con al menos un snapshot con estado != `SIN_CORRER`.
- `cobertura_porcentaje` = `(total_ejecutados / total_casos_asignados) * 100`.
- `historico_versions` incluye las ultimas 10 builds del componente ordenadas por fecha descendente.
- El frontend usa el selector global de build en el header; al cambiar la build, las métricas se recalculan.
- La seccion de reportes incluye comparacion automatica con la build anterior (delta de tasa de exito, pasados, fallados, bloqueados).

## Componentes

| Metodo | Endpoint | Auth | Estado | Descripción |
|---|---|---|---|---|
| POST | `/componentes/` | No obligatorio hoy | Implementado | Crea componente con `nombre`, `descripcion` y `tech_stack`. |
| GET | `/proyectos/{proyecto_id}/componentes/` | No obligatorio hoy | Implementado | Lista componentes por proyecto. |
| PATCH | `/componentes/{componente_id}` | No obligatorio hoy | Implementado | Actualiza `nombre`, `descripcion` y `tech_stack` de componente. |
| DELETE | `/componentes/{componente_id}` | No obligatorio hoy | Implementado | Elimina componente. |

## Builds

| Metodo | Endpoint | Auth | Estado | Descripción |
|---|---|---|---|---|
| GET | `/proyectos/{proyecto_id}/builds/` | No obligatorio hoy | Implementado | Lista builds/versiones del proyecto, incluyendo `componente_id`. |
| GET | `/componentes/{componente_id}/builds/` | No obligatorio hoy | Implementado | Lista builds/versiones de un componente. |
| POST | `/builds/` | No obligatorio hoy | Implementado | Crea build para `proyecto_id` + `componente_id`. Si se envia `activo=true`, desactiva las demas builds del componente. |
| PATCH | `/builds/{build_id}` | No obligatorio hoy | Implementado | Actualiza nombre, activo, componente u oculto de build. La build activa es unica por componente. |
| DELETE | `/builds/{build_id}` | No obligatorio hoy | Implementado | Elimina build. |

Contrato actual:

- Una build pertenece a un componente (`componente_id`) y a su proyecto (`proyecto_id`).
- El backend valida que el componente pertenezca al proyecto al crear la build.
- La build activa se calcula por componente, no por proyecto completo.
- Una build inactiva queda disponible como historico, pero no permite crear nuevas ejecuciones.
- `oculto=true` conserva la build en el proyecto, pero la oculta del selector global del header. Se administra desde Proyectos > Componentes y Builds.
- Pendiente: extender el modelo de build con referencias Redmine:
  - ticket de entrega evaluada,
  - ticket/epica destino para reporte de bugs.

## Suites y casos

| Metodo | Endpoint | Auth | Estado | Descripción |
|---|---|---|---|---|
| POST | `/suites/` | No obligatorio hoy | Implementado | Crea suite. |
| GET | `/proyectos/{proyecto_id}/suites/` | No obligatorio hoy | Implementado | Devuelve arbol de suites raíz con hijos. |
| POST | `/casos/` | No obligatorio hoy | Implementado | Crea caso con pasos y `master_id`. |
| PUT | `/casos/{master_id}` | No obligatorio hoy | Implementado | Crea nueva version del caso. |
| GET | `/proyectos/{proyecto_id}/casos/` | No obligatorio hoy | Implementado | Lista ultima version por `master_id`. |

Notas de casos:

- Cada caso tiene `id` UUID técnico y `codigo` corto tipo `TC-001` para identificacion visual.
- Las versiones de un mismo caso comparten `master_id` y `codigo`.
- `PUT /casos/{master_id}` no sobrescribe la version anterior; crea una nueva version.
- La busqueda de casos acepta coincidencias por título, descripción o `codigo`.
- Si el proyecto tiene componentes, `POST /casos/` y `PUT /casos/{master_id}` requieren `componente_id` de ese mismo proyecto.

## Test runs, ejecuciones y snapshots

| Metodo | Endpoint | Auth | Estado | Descripción |
|---|---|---|---|---|
| POST | `/test-runs/` | Bearer | Implementado | Crea run y snapshots congelados. Requiere `build_id` activo; los casos deben pertenecer al componente de esa build. |
| GET | `/proyectos/{proyecto_id}/test-runs/` | No obligatorio hoy | Implementado | Lista runs del proyecto. |
| GET | `/test-runs/{run_id}/ejecuciones/` | No obligatorio hoy | Implementado | Lista ejecuciones de un run. |
| GET | `/ejecuciones/{ejecucion_id}/snapshots/` | No obligatorio hoy | Implementado | Lista snapshots de una ejecucion. |
| PATCH | `/snapshots/{snapshot_id}/` | Bearer | Implementado | Actualiza estado, comentario y evidencia de un paso. |
| PATCH | `/ejecuciones/{ejecucion_id}/` | Bearer | Implementado | Actualiza estado global de ejecucion y observacion general opcional (`comentarios`). |
| POST | `/ejecuciones/{ejecucion_id}/automatizar/` | Bearer | Parcial | Llama al engine por HTTP. Requiere `ENGINE_URL`. |

## Alcance de build

Decision funcional:

- La build define el alcance ejecutable y reportable.
- Un caso activo puede existir en el repositorio sin pertenecer a una build.
- Solo los casos asignados a la build activa aparecen en `Ejecutar pruebas`.
- Los reportes de una build deben calcularse sobre los casos asignados a esa build.
- `DEPRECADO` es ciclo de vida del caso: no debe asignarse a builds nuevas, pero conserva historial viejo.

| Metodo | Endpoint | Auth | Estado | Descripción |
|---|---|---|---|---|
| GET | `/builds/{build_id}/casos/` | No obligatorio hoy | Implementado | Lista casos asignados a la build. |
| PUT | `/builds/{build_id}/casos/` | No obligatorio hoy | Implementado | Reemplaza el alcance de casos de la build con `caso_ids`. |


Pendiente técnico: validar migración/actualizacion de base si hay PostgreSQL existente. Ver `docs/EXECUTION_STATES.md`.

## Redmine

| Metodo | Endpoint | Auth | Estado | Descripción |
|---|---|---|---|---|
| POST | `/proyectos/{proyecto_id}/redmine/` | Admin | Implementado | Guarda configuracion Redmine del proyecto. |
| GET | `/proyectos/{proyecto_id}/redmine/` | No obligatorio hoy | Implementado | Obtiene configuracion Redmine. |

El fallo de un snapshot no debe crear automaticamente un issue Redmine. Primero se persiste la ejecucion y luego el usuario decide si reporta ahora, reporta despues o evita duplicar un ticket existente. Se calcula un hash, pero la busqueda real de duplicados en Redmine esta pendiente.

Pendiente funcional: al reportar un bug desde una ejecucion, el sistema debe tomar la build activa del `TestRun` y usar su ticket/epica Redmine de reporte como destino por defecto. La misma build debe conservar el ticket Redmine de entrega para mantener trazabilidad entre version evaluada, ejecucion y defecto reportado. El modelo debe tratar esto como integracion con tracker externo de defectos: Redmine primero, Jira u otra herramienta despues.

## WebSockets

| Endpoint | Cliente | Estado | Descripción |
|---|---|---|---|
| `/ws/client-sync/{ejecucion_id}` | Frontend | Implementado parcial | Recibe eventos retransmitidos por grupo. |
| `/ws/engine-sync/{ejecucion_id}` | Engine | Implementado parcial | Recibe eventos del engine y actualiza snapshots. |

Eventos esperados hoy:

- `STREAM_DOM_LOG`
- `STEP_RESULT`

Para `STEP_RESULT`, el backend espera `snapshot_id`, `status` y opcionalmente `screenshot` y `error_log`.

## Entornos e infraestructura

| Metodo | Endpoint | Auth | Estado | Descripción |
|---|---|---|---|---|
| GET | `/proyectos/{proyecto_id}/entornos/` | No obligatorio hoy | Implementado | Lista entornos. |
| POST | `/entornos/` | No obligatorio hoy | Implementado | Crea entorno. |
| PATCH | `/entornos/{entorno_id}` | No obligatorio hoy | Implementado | Actualiza nombre, URL, estado y version de entorno. |
| DELETE | `/entornos/{entorno_id}` | No obligatorio hoy | Implementado | Elimina entorno. |
| GET | `/infraestructura/dispositivos/` | No obligatorio hoy | Implementado | Lista dispositivos. |
| POST | `/infraestructura/dispositivos/` | No obligatorio hoy | Implementado | Crea dispositivo. |
| GET | `/infraestructura/nodos/` | No obligatorio hoy | Implementado | Lista nodos. |

## Wiki

| Metodo | Endpoint | Auth | Estado | Descripción |
|---|---|---|---|---|
| GET | `/proyectos/{proyecto_id}/wiki/` | No obligatorio hoy | Implementado | Lista paginas wiki. |
| GET | `/wiki/{page_id}` | No obligatorio hoy | Implementado | Obtiene pagina wiki. |
| POST | `/wiki/` | Bearer | Implementado | Crea pagina wiki e historial inicial. |
| PATCH | `/wiki/{page_id}` | Bearer | Implementado | Actualiza título/contenido y agrega historial. |
| GET | `/wiki/{page_id}/history/` | No obligatorio hoy | Implementado | Lista historial de cambios. |
| DELETE | `/wiki/{page_id}` | No obligatorio hoy | Implementado | Elimina pagina wiki. |

## Scheduler

| Metodo | Endpoint | Auth | Estado | Descripción |
|---|---|---|---|---|
| GET | `/proyectos/{proyecto_id}/schedules/` | No obligatorio hoy | Implementado | Lista schedules. |
| POST | `/schedules/` | Bearer | Implementado | Crea schedule. No hay runner cron real documentado. |

## Portabilidad

| Metodo | Endpoint | Auth | Estado | Descripción |
|---|---|---|---|---|
| GET | `/proyectos/{proyecto_id}/export/` | No obligatorio hoy | Implementado | Exporta paquete `.QAP` en JSON. |
| POST | `/proyectos/import/` | No obligatorio hoy | Implementado parcial | Importa paquete. Bug `uuid4()` corregido; falta prueba end-to-end. |

## Pruebas Automatizadas

Ver diseño completo en `docs/PRODUCT_BACKLOG.md` Epica 11 y `docs/DATABASE.md` sección "Pruebas Automatizadas".

### Funciones automatizadas

| Metodo | Endpoint | Auth | Estado | Descripción |
|---|---|---|---|---|
| GET | `/proyectos/{proyecto_id}/funciones/` | Bearer | Implementado | Lista funciones reutilizables del proyecto. Acepta `suite_id` y `include_herencia` como query params. |
| POST | `/funciones/` | Bearer | Implementado | Crea funcion reutilizable con nombre, código, parametros. |
| GET | `/funciones/{master_id}/` | Bearer | Implementado | Obtiene ultima version de funcion. |
| GET | `/funciones/{master_id}/versions/` | Bearer | Implementado | Lista todas las versiones de funcion. |
| PUT | `/funciones/{master_id}/` | Bearer | Implementado | Crea nueva version de funcion (no sobrescribe). |
| DELETE | `/funciones/{master_id}/` | Bearer | Implementado | Elimina todas las versiones de la funcion. |

### Variables legacy de ejecucion

Los endpoints `/variables/` y `/proyectos/{proyecto_id}/variables/*` fueron retirados. La fuente oficial para automatizacion es `Ambientes y Datasets`, variables técnicas del componente y datos específicos del caso.

### Ejecucion automatizada

| Metodo | Endpoint | Auth | Estado | Descripción |
|---|---|---|---|---|
| POST | `/ejecuciones/{id}/automatizar/` | Bearer | Pendiente | Dispara ejecucion automatizada del script del caso. Worker inyecta funciones + variables. |
| GET | `/proyectos/{proyecto_id}/automatizadas/status/` | Bearer | Pendiente | Estado de ejecuciones automatizadas en cola/progreso. |
| POST | `/scripts/validate/` | Bearer | Implementado | Valida sintaxis de script (Python para Selenium, JavaScript para Playwright/Cypress/Puppeteer). |

### Herramientas soportadas

| Framework | Estado | Notas |
|---|---|---|
| **Playwright** | Implementado | Framework principal. Campo `framework` = "playwright". |
| **Selenium** | Pendiente | Soporte futuro. Campo `framework` = "selenium". |
| **Cypress** | Pendiente | Soporte futuro. Campo `framework` = "cypress". |
| **Puppeteer** | Pendiente | Soporte futuro. Campo `framework` = "puppeteer". |

### IDE de scripts

- **Monaco Editor** integrado en el frontend (mismo motor que VS Code).
- Resaltado de sintaxis para JavaScript/TypeScript y Python segun framework.
- Autocompletado de variables `{{VARIABLE}}` y funciones reutilizables.
- Placeholders con ejemplos específicos para cada framework.
- Tema oscuro para mejor legibilidad.

### Prioridad de resolucion de variables

Cuando el script usa `{{URL_BASE}}`, el worker resuelve en este orden:

1. Variable con `build_id` = build actual (scope "build")
2. Variable con `proyecto_id` = proyecto actual y `build_id` = NULL (scope "proyecto")
3. Variable con `scope` = "global" (proyecto_id = NULL)

## Rutas planeadas pero no implementadas

- `POST /ejecuciones/{id}/retry`
- endpoints publicos para buscar issues Redmine y deduplicar antes de crear.
- prefijo `/api/v1`.
- Campo `ticket_url` en CasoPrueba para trazabilidad requisito-caso (ver Epica 5.1 en PRODUCT_BACKLOG.md).
- Worker de ejecucion automatizada (Playwright/Selenium/Cypress/Puppeteer).

## Notificaciones / Email V1

| Metodo | Endpoint | Auth | Estado | Descripcion |
|---|---|---|---|---|
| GET | `/notifications/email/config/` | `notificaciones.configuracion` | Implementado | Devuelve configuracion SMTP sin secretos; indica `password_configured`. |
| PATCH | `/notifications/email/config/` | `notificaciones.configuracion:edit` | Implementado | Actualiza configuracion SMTP no sensible. |
| POST | `/notifications/email/test/` | `notificaciones.configuracion:edit` | Implementado | Envia correo de prueba con `smtplib` y registra delivery. |
| GET/POST/PATCH/DELETE | `/notifications/rules/` | `notificaciones.reglas` | Implementado | CRUD basico de reglas event-driven. |
| GET/POST/PATCH | `/notifications/templates/` | `notificaciones.plantillas` | Implementado | Gestion de plantillas `string.Template`. |
| POST | `/notifications/templates/{template_id}/preview/` | `notificaciones.plantillas` | Implementado | Renderiza subject/text/html con contexto de ejemplo. |
| GET | `/notifications/inbox/` | Usuario autenticado | Implementado | Bandeja personal. |
| POST | `/notifications/inbox/{item_id}/read/` | Usuario autenticado | Implementado | Marca item propio como leido. |
| POST | `/notifications/inbox/read-all/` | Usuario autenticado | Implementado | Marca todas como leidas. |
| GET | `/notifications/inbox/unread-count/` | Usuario autenticado | Implementado | Contador para campana UI. |
| GET/PATCH | `/users/me/notification-preferences/` | Usuario autenticado | Implementado | Preferencias por usuario/canal/evento. |
| GET | `/notifications/events/` | `notificaciones.auditoria` | Implementado | Auditoria de eventos. |
| GET | `/notifications/deliveries/` | `notificaciones.auditoria` | Implementado | Auditoria de entregas/outbox. |
| POST | `/notifications/deliveries/{delivery_id}/retry/` | `notificaciones.admin:edit` | Implementado | Reencola delivery fallido/cancelado. |
| POST | `/notifications/process/` | `notificaciones.admin:edit` | Implementado | Procesa outbox manualmente. |

Eventos de dominio V1 incluyen bugs, ejecuciones/snapshots, automation jobs, `ai.execution.*`, `ai.engine.unavailable`, reportes compartidos/generados, `report.quality_gate_failed`, usuarios/roles, seguridad y cambios de proyecto/build.

## Active Directory / OIDC V1

| Metodo | Endpoint | Auth | Estado | Descripcion |
|---|---|---|---|---|
| GET | `/auth/ad/config/public/` | Publico | Implementado | Config publica para mostrar boton AD. |
| GET | `/auth/ad/login/` | Publico | Implementado | Genera state/nonce y redirige al proveedor OIDC. |
| GET | `/auth/ad/callback/` | Publico con state | Implementado | Valida callback, id_token y crea exchange code. |
| POST | `/auth/ad/exchange/` | Publico con code one-time | Implementado | Intercambia code por token local normal. |
| GET/PATCH | `/auth/ad/config/` | `configuracion.sesion` | Implementado | Config admin no sensible OIDC. |
| POST | `/auth/ad/test-config/` | `configuracion.sesion:edit` | Implementado | Prueba discovery OIDC. |

## Bug Tracker / Seguimiento de Bugs

| Metodo | Endpoint | Auth | Estado | Descripcion |
|---|---|---|---|---|
| GET | `/proyectos/{proyecto_id}/bugs/` | `bugs.ver` | Implementado | Listado paginado con filtros por texto, estado, severidad, prioridad, contexto QA, asignacion, origen y proveedor externo. |
| GET | `/proyectos/{proyecto_id}/bugs/summary/` | `bugs.ver` | Implementado | KPIs de bugs abiertos, criticos, bloqueantes, listos para retest, sin evidencia y vinculados. |
| GET | `/bugs/{bug_id}/` | `bugs.ver` | Implementado | Detalle completo con comentarios, adjuntos y vinculos externos. |
| POST | `/bugs/` | `bugs.crear` | Implementado | Crea bug manual validado con esperado, obtenido, version/build, reproduccion y severidad/prioridad. |
| POST | `/snapshots/{snapshot_id}/bugs/` | `bugs.crear` | Implementado | Crea o devuelve bug existente desde snapshot fallido/bloqueado precargando run, caso, build, paso, esperado, obtenido y metadata congelada. |
| POST | `/ejecuciones/{ejecucion_id}/bugs/` | `bugs.crear` | Implementado | Crea o devuelve bug existente desde una ejecucion fallida/bloqueada guardada; usa el primer snapshot fallido/bloqueado si existe. |
| PATCH | `/bugs/{bug_id}` | `bugs.editar` | Implementado | Actualiza campos editables del bug interno. |
| POST | `/bugs/{bug_id}/transition/` | `bugs.triage` | Implementado | Cambia estado, resolucion, cierre, reapertura y retest. |
| GET/POST | `/bugs/{bug_id}/comments/` | `bugs.ver` / `bugs.comentar` | Implementado | Lista y agrega comentarios; `POST` acepta `attachment_ids` para adjuntar evidencia al comentario. |
| GET/POST/DELETE | `/bugs/{bug_id}/attachments/` | `bugs.ver` / `bugs.adjuntos` | Implementado | Vincula evidencias generales del bug desde `Attachment`; no guarda binarios en base. |
| GET/POST/DELETE | `/bugs/{bug_id}/external-links/` | `bugs.ver` / `bugs.vincular_externo` | Implementado | Registra vinculos externos genericos usando `ExternalIssueLink`. |
| POST | `/bugs/{bug_id}/external-preview/` | `bugs.exportar` | Implementado | Genera Markdown copiable para Redmine/Jira/GitHub Issues; no envia tickets externos. |
| GET | `/proyectos/{proyecto_id}/bugs/dedupe-suggestions/` | `bugs.ver` | Implementado | Sugiere bugs similares por `dedupe_hash` o texto. |
| POST | `/bugs/{bug_id}/mark-duplicate/` | `bugs.triage` | Implementado | Marca un bug como duplicado de otro bug interno. |
