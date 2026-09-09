# Guía del Dashboard

El Dashboard resume la salud del proyecto y de la build seleccionada. Sirve
para decidir qué investigar primero; no reemplaza el detalle de una ejecución,
un bug ni un informe compartido.

## Antes de empezar

Seleccioná solución, proyecto, componente y build en la barra superior. La
build activa define el alcance principal de resultados, bugs y métricas. Si no
hay build o ejecuciones, algunos bloques pueden mostrar `Sin datos`.

## Cómo leer la vista

1. Abrí **Dashboard** y confirmá el contexto visible.
2. Revisá **Resumen de calidad** y **Pruebas en build**.
3. Continuá con **Fallos recientes**, **Bugs abiertos** y la **Ventana
   de build** para priorizar trabajo.
4. Usá **Actualizar** después de una ejecución o cuando necesites datos nuevos.

La vista puede incluir salud de calidad, pruebas del día, ejecuciones recientes,
ventana y tendencia por build, bugs abiertos, casos fallidos, duración promedio
y distribución por modo de ejecución. La distribución por modo no cambia el
formato del caso: un caso `API` o `CONVERSACIONAL` puede ejecutarse con otra
modalidad. Consultá [Casos de prueba](TEST_CASES_GUIDE.md) y [Estados de
ejecución](EXECUTION_STATES.md).

## Vistas personalizadas

Cuando tengas permiso, usá **Editar dashboard** para elegir, ordenar y guardar
los bloques. La personalización afecta tu vista y no elimina datos. Si solo
podés consultar, verás la disposición sin controles de edición.

El Dashboard usa una caché breve. Actualizar vuelve a consultar el resumen,
pero no crea un informe compartido ni un snapshot histórico.

## Qué revisar primero

- casos **Fallidos**, **Bloqueados** o **Sin correr**;
- bugs abiertos sin responsable, evidencia o con prioridad alta;
- diferencias entre builds;
- cobertura incompleta entre requisitos, historias y casos;
- ejecuciones con evidencia incompleta.

Un dato vacío puede significar que no hay alcance, ejecuciones o permisos; no
demuestra por sí solo que todo esté correcto. Para investigar, abrí
[Historial Runs](RUN_HISTORY_GUIDE.md), [Reportes y Métricas](REPORTING_GUIDE.md)
o [Bug Tracker](BUG_TRACKER.md).
