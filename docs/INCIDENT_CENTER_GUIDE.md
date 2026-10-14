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
3. Usá búsqueda y filtros visibles; podés ordenar por fecha o prioridad y
   seleccionar un indicador para consultar sus incidencias.
4. Activá **Mis incidencias** para ver las asignadas a vos.
5. Seleccioná una fila para abrir el detalle.

Los filtros incluyen estado, tipo de contexto (`CLASICO`, `API` o
`CONVERSACIONAL`), solución, proyecto, componente, build, responsable,
severidad, prioridad y fechas. `PERFORMANCE` no se documenta como contexto
operativo soportado por este módulo. En móvil, **Más filtros** despliega los filtros avanzados. El resumen
se calcula sobre todo el resultado filtrado, no solo la página actual.
**Críticos y altos** incluye ambas severidades entre incidencias abiertas.

## Leer el detalle

Cuando existen, el detalle muestra código y título, versión/build, ambiente,
dataset, caso, componente, modo de ejecución, contexto, URL afectada,
navegador, sistema operativo, dispositivo, resolución de pantalla y reproducibilidad.
La descripción y la solución registrada se muestran por separado. Los accesos
**Ver caso** y **Ver ejecución** permiten abrir sus registros relacionados.

Los borradores de solución, notas para QA y comentarios se conservan entre
pestañas y al realizar otra acción. Guardar solución envía solo los campos
modificados. Cerrar o navegar desde el detalle pide confirmación si hay cambios
pendientes; recargar o cerrar la pestaña activa el aviso del navegador.

Una incidencia API puede conservar request, respuesta, status, headers,
aserciones y variables redactadas. Una conversacional puede conservar endpoint,
turnos, esperado/obtenido, latencia, evaluación y trazas. Los UUID son internos;
el resumen debe usar nombres y códigos legibles.

## Estados, acciones y permisos

Usá la ayuda de estados del módulo para interpretar transiciones. Según tus
permisos, podés editar, asignar, cambiar estado, comentar o adjuntar evidencia.
Una incidencia lista para retest necesita verificación posterior.

La bandeja requiere `incidencias.ver`; los detalles admiten también lectura de
Bug Tracker. Cada acción respeta sus permisos: resolver requiere `bugs.resolver`
y ser el responsable asignado; cerrar requiere `bugs.cerrar`; los demás estados
operativos requieren `bugs.triage`. La edición, asignación, comentarios y adjuntos
mantienen sus capacidades independientes. La corrección y la reapertura desde
cualquier estado cerrado requieren una build activa del proyecto.

**Marcar como duplicado** requiere `bugs.triage` y la función `bugs.enterprise`
habilitada por licencia; permite buscar y seleccionar el bug principal. El
servidor valida el vínculo y rechaza el cambio genérico de estado a duplicado.
Exportar requiere `bugs.exportar`. Si el módulo no aparece, pedí revisar tu rol.

El Centro no crea ni reabre bugs automáticamente a partir de fallos sin
clasificar: quedan pendientes de investigación hasta revisión humana.

## Exportar y relacionar

Cuando esté habilitado, exportá CSV o Markdown y revisá el contenido antes de
compartirlo porque puede incluir contexto técnico. Los enlaces de informes a
incidencias deben abrir este módulo o su detalle; los defectos generales deben
abrir Bug Tracker.

## Campos de solución y entorno

`resolucion_pantalla` contiene las dimensiones de pantalla y `resolucion` la
solución aplicada. La migración `20261010_0072` separa dimensiones históricas
completas sin alterar frases ambiguas. Para compatibilidad, crear o editar con
un valor como `1920x1080` en el campo histórico lo guarda como resolución de
pantalla. Las transiciones mantienen `resolucion` como explicación de la solución.

## Ayuda rápida

- Si no aparece una incidencia, revisá proyecto, build, filtros y permisos.
- Si falta contexto API o conversacional, confirmá que provenga de una
  ejecución persistida del formato correcto.
- Para crear un defecto desde una ejecución, empezá por [Bug Tracker](BUG_TRACKER.md).
