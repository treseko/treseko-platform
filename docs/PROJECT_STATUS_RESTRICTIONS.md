# Estados de Proyecto y Restricciones Operativas

Treseko usa `estado` como estado visible del proyecto y mantiene `activo` como flag derivado de compatibilidad.

## Estados

| Estado | Activo | Restriccion prevista |
| --- | --- | --- |
| Planificacion | No | Configuracion permitida; ejecuciones bloqueadas. |
| Activo | Si | Operacion normal. |
| En QA | Si | Operacion normal enfocada en ejecucion QA. |
| Bloqueado | No | Bloquear ejecuciones, bugs operativos y cambios sensibles. |
| Mantenimiento | No | Bloquear ejecuciones y cambios operativos sensibles. |
| En Pausa | No | Bloquear ejecuciones y cambios operativos sensibles. |
| Cerrado | No | Solo lectura. |
| Archivado | No | Solo lectura y ocultable del flujo principal. |

## Regla actual

En esta etapa solo se persiste el estado y se deriva `activo`.

- `activo = true`: `Activo`, `En QA`.
- `activo = false`: `Planificacion`, `Bloqueado`, `Mantenimiento`, `En Pausa`, `Cerrado`, `Archivado`.

Las restricciones operativas por estado se implementaran en una pasada posterior.
