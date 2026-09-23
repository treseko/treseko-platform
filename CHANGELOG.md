# Treseko 1.0.4 — Cambios principales

## Mejoras

- Catálogo RBAC y controles de configuración alineados con las capacidades
  efectivas del backend.
- Mejoras en la localización de la aplicación y en la generación HTML localizada
  de la landing pública.
- Sincronización verificable entre el árbol fuente y el paquete Community
  publicable.

## Nueva funcionalidad

- Contratos de actualización con mantenimiento, reintentos, evidencia RC y
  rollback de startup más explícitos.
- Validaciones adicionales para licencias, entitlements, límites y estados de
  actualización.

## Correcciones

- Corrección del estado Premium cacheado para evitar reactivaciones después de
  expiración, revocación o downgrade.
- Estados desconocidos del worker dejan de convertirse en resultados aprobados.
- Redacción de secretos en artefactos y aislamiento del entorno de procesos
  hijos.
- Correcciones de callbacks/webhooks, deep links, controles MCP y drawer móvil.
- El pipeline de paquetes de actualización conserva la versión y la ruta de
  salida solicitadas.

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
