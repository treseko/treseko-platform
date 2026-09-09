# Acceso, usuarios y permisos

Treseko combina autenticación, roles RBAC, capabilities, scope y edición. El
backend evalúa capability, nivel, organización/proyecto y entitlement; el rol
nominal no autoriza por sí solo.

## Autenticación y roles

Admite email/contraseña y, según configuración y edición, Active Directory,
LDAP u OIDC. La identidad corporativa no decide el rol interno.

| Rol | Uso |
|---|---|
| ADMIN | Administración global. |
| QA_LEAD | Proyectos, pruebas, ejecuciones y reportes autorizados. |
| TESTER | Diseño y ejecución según capabilities y scope. |
| VIEWER | Consulta sin modificación. |

Los roles personalizados ajustan módulos y acciones. Editor incluye lectura.

## Capability y scope

```text
identidad → rol/capability → nivel → organización/proyecto → entitlement → acción
```

Ejemplos: ejecutar.manual, ejecutar.automatizada, ejecutar.ia, reportes,
bugs, incidencias, historial, plugins, API keys y sanitización de evidencia.
MCP exige lectura en organización y proyecto. Pairing y organización del worker
no reemplazan autorización del job.

## Licencia y downgrade

Community tiene límites; Premium puede habilitar RBAC granular, SSO,
multi-worker, snapshots, reportes avanzados, integraciones, auditoría y
métricas históricas. Al vencer Premium no se borran datos: se restringen nuevas
escrituras o funciones Premium y puede conservarse lectura histórica. Leer no
implica editar ni regenerar.

En Configuración podés crear usuarios, roles y revisar auditoría. Inactivar
conserva trazabilidad. No compartas passwords ni API keys.

| Problema | Revisá |
|---|---|
| No aparece un módulo | Rol, capability, edición y scope. |
| Puede ver pero no editar | Nivel y permiso de escritura. |
| Worker sin resultados | Pairing, organización, build, key y red. |
| MCP 403 | Capability y acceso a organización/proyecto. |
| Función tras downgrade | Entitlement y política histórica. |
