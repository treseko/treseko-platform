# Guía de Historial Runs

**Historial Runs** conserva ejecuciones y datos congelados para comparar
resultados, revisar evidencia y reconstruir una investigación.

## Buscar una ejecución

1. Abrí **Historial Runs**.
2. Filtrá por caso, fecha, resultado, origen, build, formato o modo.
3. Abrí **Ver detalle**.
4. Confirmá proyecto, build y componente.

## Qué muestra el detalle

Puede incluir run, build, componente, ambiente, dataset, origen, ejecutor,
formato, modo, casos, pasos, veredictos, observaciones, evidencia y bugs.
También puede mostrar variables dinámicas y configuración congeladas, resultado
API o transcripción/configuración conversacional, e informe IA con confianza y
revisión humana.

La configuración congelada explica qué se ejecutó; no equivale a la
configuración actual del caso.

## Cómo investigar

1. Compará con la ejecución anterior.
2. Identificá si el resultado es clásico, API o conversacional.
3. Confirmá que evidencia y variables pertenezcan al caso y build.
4. Abrí o prepará el bug relacionado.
5. En IA, revisá trazas, confianza y decisión humana.

El historial es de consulta. Para editar usá [Casos](TEST_CASES_GUIDE.md); para
defectos, [Bug Tracker](BUG_TRACKER.md). Preferí nombres, códigos y contexto
legibles sobre UUID, payloads o variables resueltas.
