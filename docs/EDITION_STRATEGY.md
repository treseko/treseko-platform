# Ediciones Community y Premium

La edición habilita entitlements y límites; el rol y las capabilities deciden
qué usuario puede ejecutar cada acción.

## Community

Límites de referencia:

- 1 organización, 5 usuarios, 3 proyectos y 1 worker.
- 50 ejecuciones automatizadas por semana.
- 10 ejecuciones IA por semana.
- 20 generaciones de casos con IA por semana.
- 1024 MB de almacenamiento.

Incluye gestión QA, ejecución manual, automatización local, API declarativa por
el worker unificado, reporte de resultados desde runners externos, IA dentro de
cuotas, Bug Tracker, reportes básicos e importación/exportación. El reporte
externo consume el mismo límite de **50 ejecuciones automatizadas por ventana
móvil de siete días** que los workers.

## Premium

El runtime público reconoce la edición `premium` y habilita capacidades o
límites según los entitlements firmados en la licencia. El catálogo contempla,
entre otras, RBAC granular, multi-worker, scheduler, automatización avanzada,
una cuota ampliada para ejecuciones automatizadas y reportes externos, reportes
avanzados, snapshots, integraciones, notificaciones, auditoría, métricas
históricas y branding. La cantidad de ejecuciones disponible es la establecida
por los límites firmados en la licencia; Premium no implica una cuota ilimitada.

Los nombres y paquetes comerciales específicos se definen fuera de este
repositorio y no deben inferirse solo por la presencia de una función en el
catálogo.

La presencia en catálogo no prueba habilitación. Revisá plan y entitlements en
Configuración → Licencia.

## Licencia

1. Abrí Configuración → Licencia.
2. Seleccioná el archivo recibido por canal confiable.
3. Confirmá.
4. Revisá edición, expiración, límites y capabilities.

Se valida firma, vigencia y entitlement. No hace falta reinstalar. No compartas
el contenido de la licencia.

## Downgrade o vencimiento

- Los datos no se eliminan automáticamente.
- Se restringen operaciones Premium nuevas.
- Se aplican límites Community.
- La política histórica puede conservar lectura de snapshots, reportes, bugs y
  auditoría existentes.
- Para volver a Premium instalá una licencia vigente y revisá RBAC.

Lectura histórica no implica edición.
