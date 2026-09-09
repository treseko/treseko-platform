# Guía de Reportes y Métricas

Reportes y Métricas resume ejecuciones, bugs, evidencias y trazabilidad del
contexto seleccionado. Ayuda a decidir y comunicar resultados sin reemplazar
el historial técnico.

## Leer el reporte

1. Seleccioná solución, proyecto, componente y build.
2. Abrí **Reportes y Métricas**.
3. Revisá cobertura, salud, resultados y riesgos.
4. Filtrá por suite, prioridad, estado, responsable, modo, formato o evidencia.
5. Abrí el caso, bug o run desde la tabla para investigar.

`formato_prueba` distingue `CLASICA`, `API`, `CONVERSACIONAL` y el formato
reservado `PERFORMANCE`; la modalidad de ejecución se informa por separado.
Una métrica vacía puede indicar falta de alcance o evidencia.

## Vista, actualización y compartir

Usá **Configurar vista** si tenés permiso. El preset de Desarrollo prioriza
fallos, bloqueos, bugs y acciones; el detalle completo permanece disponible.

Después de nuevas ejecuciones, actualizá antes de analizar. Al **Compartir**,
Treseko genera un snapshot nuevo cuando detecta datos nuevos. El enlace apunta
a ese snapshot y no a una consulta histórica mutable; los snapshots existentes
no se reescriben.

## Tipos de informe

- **Ejecutivo:** KPIs, riesgos, tendencias y hallazgos principales.
- **Desarrollo:** fallos, bloqueos, bugs nuevos, históricos pendientes, fichas
  de reproducción y acciones recomendadas.
- **Interno:** inventario técnico completo del snapshot.

Los enlaces de defectos apuntan a **Bug Tracker** o **Centro de Incidencias**
según el destino. Los nombres de proyecto, build, ambiente, dataset, casos y
códigos BUG/TC son la referencia principal; los UUID quedan como relación
interna.

## Quality Intelligence

Cuando está habilitado, resume estabilidad, flakiness, huellas técnicas,
diagnósticos asistidos y un snapshot explicable de riesgo. Los diagnósticos son
borradores revisables: no confirman causa raíz, no cambian ejecuciones ni crean
bugs automáticamente. Con datos nuevos, reconstruí señales antes de evaluar
riesgo; una decisión asistida requiere revisión humana y motivo auditado.

Consultá [Trazabilidad](TRACEABILITY.md), [Historial Runs](RUN_HISTORY_GUIDE.md)
y [Adjuntos y evidencias](ATTACHMENTS_EVIDENCE.md).
