# Centro de Incidencias

El Centro de Incidencias es el módulo operativo para consultar y seguir
incidencias de QA. Es distinto de **Bug Tracker**: comparte registros, pero
ofrece una bandeja central con filtros, indicadores, detalle, acciones y
exportaciones.

## Cuándo usarlo

Usá **Bug Tracker** para crear o revisar el defecto con su contexto técnico.
Usá **Centro de Incidencias** para ver abiertas, críticas, bloqueadas o listas
para retest; filtrar por contexto, proyecto, build, responsable, severidad,
prioridad y fechas; abrir el caso o ejecución relacionada; y seguir comentarios,
evidencias, estado y resolución.

## Abrir y filtrar

1. Seleccioná solución, proyecto y componente si corresponde.
2. Abrí **Centro de Incidencias**.
3. Usá búsqueda y filtros visibles.
4. Activá **Mis incidencias** para ver las asignadas a vos.
5. Seleccioná una fila para abrir el detalle.

Los filtros incluyen estado, tipo de contexto (`CLASICO`, `API` o
`CONVERSACIONAL`), solución, proyecto, componente, build, responsable,
severidad, prioridad y fechas. `PERFORMANCE` no se documenta como contexto
operativo soportado por este módulo.

## Leer el detalle

Cuando existen, el detalle muestra código y título, versión/build, ambiente,
dataset, caso, componente, modo de ejecución, contexto, URL afectada,
navegador, sistema operativo, dispositivo, resolución y reproducibilidad.

Una incidencia API puede conservar request, respuesta, status, headers,
aserciones y variables redactadas. Una conversacional puede conservar endpoint,
turnos, esperado/obtenido, latencia, evaluación y trazas. Los UUID son internos;
el resumen debe usar nombres y códigos legibles.

## Estados, acciones y permisos

Usá la ayuda de estados del módulo para interpretar transiciones. Según tus
permisos, podés editar, asignar, cambiar estado, comentar o adjuntar evidencia.
Una incidencia lista para retest necesita verificación posterior.

La consulta requiere permiso del Centro o compatibilidad de lectura de Bug
Tracker. Para editar se validan también editar, asignar, triage, comentar o
adjuntar. Exportar depende de la capacidad correspondiente. Si el módulo no
aparece, pedí que revisen tu rol.

El Centro no crea ni reabre bugs automáticamente a partir de fallos sin
clasificar: quedan pendientes de investigación hasta revisión humana.

## Exportar y relacionar

Cuando esté habilitado, exportá CSV o Markdown y revisá el contenido antes de
compartirlo porque puede incluir contexto técnico. Los enlaces de informes a
incidencias deben abrir este módulo o su detalle; los defectos generales deben
abrir Bug Tracker.

## Ayuda rápida

- Si no aparece una incidencia, revisá proyecto, build, filtros y permisos.
- Si falta contexto API o conversacional, confirmá que provenga de una
  ejecución persistida del formato correcto.
- Para crear un defecto desde una ejecución, empezá por [Bug Tracker](BUG_TRACKER.md).
