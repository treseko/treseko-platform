# RBAC Matrix

Fecha de revision: 2026-06-14.

Esta matriz inicial define permisos sugeridos para la plataforma. Puede ajustarse cuando se implemente autenticacion real.

## Roles

| Rol | Descripción |
|---|---|
| `ADMIN` | Administra plataforma, usuarios, integraciones y configuracion global. |
| `QA_LEAD` | Gestiona proyectos QA, casos, ejecuciones, reportes e integraciones de proyecto. |
| `TESTER` | Crea/ejecuta casos y registra resultados. |
| `VIEWER` | Consulta informacion sin modificar datos. |

## Roles personalizados

Un `ADMIN` puede crear roles personalizados desde `Configuracion > Roles`.

Reglas actuales:

- Un rol personalizado tiene nombre, descripción, estado y módulos asignados.
- Cada módulo puede quedar sin acceso, como `Lector` o como `Editor`.
- Un usuario puede tener un rol base técnico y opcionalmente un rol personalizado.
- Cuando se asigna rol personalizado, el usuario hereda los permisos por módulo de ese rol.
- Los roles base siguen existiendo para reglas internas y permisos de backend.
- Un usuario no puede inactivar su propia cuenta.

Niveles:

| Nivel | Significado |
|---|---|
| Sin acceso | El módulo no aparece/no deberia poder consultarse. |
| Lector | Puede ver datos del módulo. |
| Editor | Puede crear/editar/inactivar datos del módulo cuando la ruta backend tenga esa regla aplicada. |

## Permisos por módulo

| Accion | ADMIN | QA_LEAD | TESTER | VIEWER |
|---|---:|---:|---:|---:|
| Ver dashboard | Si | Si | Si | Si |
| Ver proyectos | Si | Si | Si | Si |
| Crear proyecto | Si | No | No | No |
| Editar proyecto | Si | Si | No | No |
| Archivar/desactivar proyecto | Si | Si | No | No |
| Crear componentes/builds | Si | Si | No | No |
| Ver suites/casos | Si | Si | Si | Si |
| Crear suites | Si | Si | Si | No |
| Editar suites | Si | Si | Si | No |
| Eliminar suites | Si | Si | No | No |
| Crear casos | Si | Si | Si | No |
| Editar casos/versionar | Si | Si | Si | No |
| Eliminar/deprecar casos | Si | Si | No | No |
| Ejecutar prueba manual | Si | Si | Si | No |
| Marcar paso `PASO` | Si | Si | Si | No |
| Marcar paso `FALLO` | Si | Si | Si | No |
| Marcar paso `BLOQUEADO` | Si | Si | Si | No |
| Adjuntar evidencia | Si | Si | Si | No |
| Lanzar ejecucion IA | Si | Si | Opcional | No |
| Abortar ejecucion IA | Si | Si | No | No |
| Ver historial | Si | Si | Si | Si |
| Ver reportes | Si | Si | Si | Si |
| Gestionar inventario | Si | Si | No | Ver |
| Gestionar wiki | Si | Si | Si | Ver |
| Configurar Redmine | Si | Si | No | No |
| Enviar bug a Redmine | Si | Si | Si | No |
| Gestionar usuarios | Si | No | No | No |
| Configurar autenticacion | Si | No | No | No |
| Configurar tokens/modelos IA | Si | Si | No | No |

## Módulos visibles por rol inicial

| Módulo | ADMIN | QA_LEAD | TESTER | VIEWER |
|---|---:|---:|---:|---:|
| Dashboard | Si | Si | Si | Si |
| Ejecutar Pruebas | Si | Si | Si | No |
| Anadir Pruebas | Si | Si | Si | No |
| Proyectos | Si | Si | Si | Si |
| Inventario | Si | Si | No | No |
| Reportes y Métricas | Si | Si | No | Si |
| Motor IA | Si | Si | No | No |
| Integracion Redmine | Si | Si | No | No |
| Historial Runs | Si | Si | Si | Si |
| Configuracion | Si | No | No | No |

Nota: la visibilidad de módulos en frontend mejora experiencia, pero la seguridad real debe aplicarse tambien en backend.

## Reglas especiales

- Acciones destructivas deberian preferir soft delete/deprecado.
- La configuracion global queda reservada a `ADMIN`.
- Integraciones por proyecto pueden ser administradas por `QA_LEAD`.

## Pendientes de definicion

- Si `TESTER` puede lanzar IA o solo QA Lead/Admin.
- Si `Developer` sera un rol propio o una variante de viewer/tester.
- Si Active Directory mapeara grupos externos a roles internos.
