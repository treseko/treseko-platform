# Bug Tracker

Bug Tracker registra defectos y conserva el vínculo con caso, ejecución, build,
componente y evidencia. El Centro de Incidencias es una vista operativa
separada; consultá [su guía](INCIDENT_CENTER_GUIDE.md).

## Crear un bug desde una ejecución

1. Marcá el resultado como **Falló** o **Bloqueado**.
2. Guardá obtenido, observaciones y evidencia.
3. Elegí **Preparar bug interno** o **Reportar bug interno**.
4. Revisá título, prioridad, severidad y contexto.
5. Guardá y confirmá el vínculo de origen.

El contexto respeta el formato: clásica conserva pasos; API conserva request,
status, headers, cuerpo, aserciones y variables permitidas; conversacional
conserva endpoint, turnos, esperado/obtenido, latencia, evaluación y trazas.
`PERFORMANCE` es reservado y no debe transformarse en otra clase de bug.

## Gestión diaria

El listado permite recorrer todos los bugs en páginas de 25, 50 o 100, con
orden por fecha reciente, antigüedad o prioridad. Los filtros se aplican con
**Filtrar**, se muestran como etiquetas removibles y pueden limpiarse juntos.
Los indicadores corresponden al conjunto filtrado completo, no solo a la
página visible; **Críticos y altos** agrupa ambas severidades. Cada indicador
permite consultar sus bugs. En móvil, los filtros avanzados se despliegan con
**Más filtros** y las filas presentan los datos y acciones en vertical.

El detalle conserva el borrador al agregar comentarios, evidencias o cambiar
el estado. Guardar envía solamente los campos modificados. Cerrar, cancelar la
edición o navegar desde el detalle con cambios pendientes pide confirmación;
recargar o cerrar la pestaña activa el aviso del navegador. Los diálogos
secundarios ocultan el detalle mientras están abiertos y preservan su contexto.

**Historial** muestra los cambios de estado con autor, fecha, build y motivo.
**Marcar como duplicado** requiere `bugs.triage` y la función habilitada por licencia
`bugs.enterprise`: propone coincidencias y permite buscar el bug principal por
código o título. El vínculo se valida en el servidor: no acepta referencias al
mismo bug, a otro proyecto ni cadenas de duplicados. Reintentar la misma
vinculación no agrega comentarios ni cambios de estado repetidos.

Las acciones de estado respetan capacidades independientes: resolver requiere
`bugs.resolver` y ser el responsable asignado; los cierres administrativos
requieren `bugs.cerrar`; las demás transiciones usan `bugs.triage`. La reapertura
de cualquier estado cerrado pide la build donde reapareció el defecto.

El listado API acepta `sort=newest|oldest|priority`,
`attention=open|critical|unassigned|retest|no_evidence|linked` e
`include_summary=true`. La respuesta conserva `items`, `total`, `skip` y
`limit`, y agrega `summary` cuando se solicita. El endpoint independiente de
resumen continúa disponible con su alcance por proyecto/build.

## Crear y gestionar manualmente

Desde **Bug Tracker → Añadir nuevo bug**, completá título, problema, esperado,
prioridad, severidad y contexto. Según tus permisos podés asignar responsable,
comentar, adjuntar evidencia, cambiar estado, registrar build de corrección,
abrir contexto API/conversacional y generar un resumen externo.

Dos defectos distintos sobre el mismo caso siguen siendo registros distintos.
Buscá el existente antes de crear otro.

## Estados, retest y herramientas externas

Usá **Listo para retest** y luego **En retest** cuando una corrección necesite
verificación. Registrá build de detección, build de corrección y resolución.

Treseko no crea tickets externos automáticamente. Podés copiar un resumen para
Jira, Redmine o GitHub Issues y guardar su URL o identificador explícitamente.

## Ayuda rápida

- Adjuntá evidencia antes de reportar si ayuda a reproducir.
- Preferí código, nombres y contexto legibles; no uses UUID como resumen.
- Si no podés crear o editar, pedí permisos de Bug Tracker o Incidencias.
