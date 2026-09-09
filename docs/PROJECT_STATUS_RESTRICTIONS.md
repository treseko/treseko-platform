# Estados de proyecto

El estado comunica y conserva la etapa operativa del proyecto. No garantiza por
sí solo un bloqueo de edición o ejecución, ni borra casos, runs, bugs o
evidencias; las acciones efectivas dependen también del rol, las capacidades,
la build y el contexto de ejecución.

| Estado | Cuándo usarlo | Orientación |
|---|---|---|
| Planificación | El proyecto se prepara. | Configurá equipo, ambientes y casos. |
| Activo | Trabajo normal. | Usá el flujo habitual según permisos. |
| En QA | Validación de una entrega. | Concentrá ejecución y revisión. |
| Bloqueado | Hay un impedimento. | Investigá antes de continuar dependencias. |
| Mantenimiento | Cambios controlados. | Limitá la operación habitual. |
| En pausa | Trabajo detenido temporalmente. | Conservá y retomá después. |
| Cerrado | Trabajo finalizado. | Consultá resultados, no lo trates como activo. |
| Archivado | Retirado del flujo habitual. | Conservá la consulta histórica. |

## Cambiar el estado

1. Abrí **Proyectos** y elegí el proyecto.
2. Entrá a **Configuración y equipo**.
3. Seleccioná el estado.
4. Guardá y comunicá el impacto.

Antes de cerrar, pausar o archivar, verificá ejecuciones activas, jobs
pendientes y evidencia que debas conservar. El estado del proyecto no reemplaza
el estado de un run, job, caso o bug.

## Qué cambia y qué no

- No convierte una build histórica en activa.
- No elimina ni reescribe snapshots, ejecuciones, bugs o evidencias.
- La disponibilidad o visibilidad puede variar según la instalación; verificá
  siempre el rol, las capacidades, la build, el ambiente y el dataset.
- **Bloqueado** comunica un impedimento del proyecto, no reemplaza un bug.

Si una ejecución no arranca, revisá también build, ambiente, dataset y estado
del caso.
