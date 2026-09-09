# Matriz de permisos por rol

Es orientativa. La autorización real también depende de capability, nivel,
scope de organización/proyecto y entitlement.

| Acción | ADMIN | QA LEAD | TESTER | VIEWER |
|---|---:|---:|---:|---:|
| Consultar proyectos, casos, runs y reportes permitidos | Sí | Sí | Sí | Sí |
| Crear/editar suites y casos | Sí | Sí | Según capability | No |
| Administrar proyectos, builds y ambientes | Sí | Sí | No | No |
| Ejecutar pruebas manuales | Sí | Sí | Según capability | No |
| Ejecutar automatización/API con worker aprobado | Sí | Sí | Según capability y scope | No |
| Ejecutar evaluación IA/conversacional | Sí | Sí | Según capability y entitlement | No |
| Adjuntar evidencia y reportar bugs | Sí | Sí | Según capability | No |
| Triage y asignación de bugs/incidencias | Sí | Sí | Según capability | No |
| Compartir reportes y crear snapshots | Sí | Según entitlement | Según permiso | No |
| Configurar integraciones/plugins | Sí | Según permiso y entitlement | No por defecto | No |
| Administrar usuarios, roles y licencia | Sí | Según permiso | No | No |

## Aplicación

1. Definí tarea.
2. Elegí rol base.
3. Ajustá capability, nivel y scope.
4. Confirmá edición.
5. Probá con cuenta de prueba.

Un Sí no autoriza fuera del proyecto u organización ni habilita Premium en
Community. Consultá [AUTH_RBAC_GUIDE.md](AUTH_RBAC_GUIDE.md).
