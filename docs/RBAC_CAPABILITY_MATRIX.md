# Matriz de capabilities

Se evalúan junto con rol, nivel, alcance y licencia; no se editan manualmente
como texto técnico.

| Área | Capabilities a revisar | Alcance |
|---|---|---|
| Proyectos | Portfolio, componentes, builds, ambientes, datasets, historias | Organización/proyecto. |
| Casos | Suites, casos, pasos, adjuntos, scripts, trazabilidad | Proyecto autorizado. |
| Ejecución | ejecutar.manual, ejecutar.automatizada, ejecutar.ia | Formato y modalidad independientes. |
| Automatización | Workers, jobs, validación, API declarativa | Worker aprobado y scope válido. |
| Reportes | Lectura, exportación, snapshots, compartir, métricas | Algunas requieren Premium. |
| Bugs/incidencias | Crear, editar, asignar, comentar, adjuntar, triage | Evidencia elegible. |
| Historial | Runs, snapshots y auditoría histórica | Downgrade puede conservar lectura. |
| IA | Perfiles, credenciales, workflows y revisión | No equivale a ejecutar todos los formatos. |
| Integraciones | Provider, vínculos, notificaciones | Scope y capability del proyecto. |
| Plugins | Catálogo, instalar, habilitar, configurar, portabilidad | Runner y entitlement. |
| Configuración | Usuarios, roles, licencia, updates, API keys | Administración restringida. |

Premium puede habilitar RBAC granular, SSO, multi-worker, scheduler, API externa
avanzada, reportes/snapshots avanzados, bugs enterprise, integraciones,
auditoría, métricas históricas, branding y updates.

## MCP

Está deshabilitado por defecto, usa API key separada del JWT y expone solo
herramientas de lectura habilitadas por allowlist, con scope simultáneo de
organización y proyecto.
