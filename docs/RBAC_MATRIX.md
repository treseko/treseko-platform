# Matriz de permisos por rol

Esta matriz sirve como referencia al crear o revisar roles. Los permisos reales
pueden ajustarse con roles personalizados desde **Configuración → Roles**.

| Acción | ADMIN | QA LEAD | TESTER | VIEWER |
|---|---:|---:|---:|---:|
| Consultar proyectos, casos, historial y reportes | Sí | Sí | Sí | Sí |
| Crear y editar suites y casos | Sí | Sí | Sí | No |
| Administrar proyectos, componentes, builds y ambientes | Sí | Sí | No | No |
| Ejecutar pruebas manuales | Sí | Sí | Sí | No |
| Adjuntar evidencias y reportar bugs | Sí | Sí | Sí | No |
| Ejecutar automatización e IA autorizada | Sí | Sí | Según rol personalizado | No |
| Configurar integraciones del proyecto | Sí | Sí | Según permiso | No |
| Administrar usuarios, roles y preferencias globales | Sí | Según permiso | No | No |

## Cómo usar esta matriz

1. Identificá las tareas reales de la persona o equipo.
2. Elegí el rol base más cercano.
3. Creá un rol personalizado si necesitás limitar o ampliar módulos.
4. Probá el rol con una cuenta de prueba antes de asignarlo de forma masiva.

Los niveles **Sin acceso**, **Lector** y **Editor** determinan qué puede ver o
modificar un rol en cada módulo. Consultá [Acceso, usuarios y permisos]
(AUTH_RBAC_GUIDE.md) para el paso a paso de creación y asignación.
