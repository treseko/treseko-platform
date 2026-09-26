# Treseko 1.0.4 — Cambios principales

## Mejoras

- Catálogo RBAC y controles de configuración alineados con las capacidades
  efectivas del backend.
- Mejoras en la localización de la aplicación y en la generación HTML localizada
  de la landing pública.
- Sincronización verificable entre el árbol fuente y el paquete Community
  publicable.
- La versión de la plataforma, frontend, Engine y Automation Worker queda
  alineada en `1.0.4`, con comprobaciones de consistencia en el empaquetado.
- La administración incorpora controles más precisos para organizaciones,
  membresías, roles, capacidades y límites por edición.
- Casos y suites conservan mejor el orden, clonación, movimiento, versiones y
  relaciones de trazabilidad entre requisitos, historias y criterios.

## Nueva funcionalidad

- Contratos de actualización con mantenimiento, reintentos, evidencia RC y
  rollback de startup más explícitos.
- Validaciones adicionales para licencias, entitlements, límites y estados de
  actualización.
- Superficie MCP gobernada con descubrimiento de herramientas, consultas de
  contexto QA, mutaciones confirmadas e importaciones con preview/commit/
  rollback, protegida por scopes, allowlist e idempotencia.
- Authoring asistido por IA para requisitos, historias y casos, con alcance,
  exclusiones, criterios versionados, fingerprints e idempotencia documentados.
- Ejecución API declarativa con variables dinámicas, sandbox de scripts,
  snapshots y evidencia redactada mediante el worker unificado.
- El authoring de historias y casos incluye estimación, supuestos, reanálisis,
  planificación de cobertura y aplicación transaccional con revisión humana.
- Se incorporan perfiles de proveedor IA, pruebas de conexión/visión, catálogo
  de modelos, agentes universales, presets, contratos runtime y selección de
  workflows por propósito.
- El sistema de automatización incorpora registro y pairing de workers,
  heartbeat, capacidades, leases, dry-runs, reconciliación y límite que ignora
  workers revocados o inactivos.
- La plataforma añade endpoints y UI para Wiki con historial, inventario de
  dispositivos/activos/endpoints, organizaciones y membresías, stakeholders y
  schedules cuando la capability está habilitada.

## Correcciones

- Corrección del estado Premium cacheado para evitar reactivaciones después de
  expiración, revocación o downgrade.
- Estados desconocidos del worker dejan de convertirse en resultados aprobados.
- Redacción de secretos en artefactos y aislamiento del entorno de procesos
  hijos.
- Correcciones de callbacks/webhooks, deep links, controles MCP y drawer móvil.
- El empaquetado del instalador corrige la selección de Python en Windows y la
  categoría de escritorio del AppImage Linux.
- La migración de Automation Worker evita recrear una restricción ya presente
  en el esquema de instalaciones limpias.
- El pipeline de paquetes de actualización conserva la versión y la ruta de
  salida solicitadas.
- Las API keys y credenciales MCP tienen ciclo de estado `ACTIVE`, `PAUSED` y
  `REVOKED`, con cambios auditados y migración de esquema correspondiente.
- Los informes compartidos conservan snapshots, expiración, revocación y
  respuestas seguras para enlaces públicos HTML/Markdown/CSV/PDF.
- La UI incorpora mejoras de evidencia y adjuntos, navegación de casos/bugs,
  configuración, login, mantenimiento de updates, reportes, responsive e
  internacionalización ES/EN/PT.

## Seguridad

- QA Guard y rutas de callbacks/webhooks aplican comportamiento fail-closed.
- Validación contra SSRF, DNS rebinding, IPv4-mapped IPv6 y redirecciones no
  autorizadas.
- La firma comercial de licencias continúa usando Ed25519 y se mantiene
  separada del HMAC efímero de importación MCP.
- Se actualizan dependencias del panel privado de licencias y se mantiene el
  binding nativo Linux como dependencia opcional para permitir builds locales
  en macOS/ARM64.

> La aprobación operativa de producción requiere todavía los gates externos
> documentados: smoke autenticado contra `verify/updates`, ceremonia oficial
> de claves y auditoría Linux/Nginx en el entorno de despliegue.
