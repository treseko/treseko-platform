# Guía de Reportes y Métricas

Esta sección convierte las ejecuciones, bugs, evidencias y trazabilidad de la build activa en una vista de seguimiento de calidad.

## Leer el reporte

1. Seleccioná proyecto, componente y build.
2. Abrí **Reportes y Métricas**.
3. Revisá primero cobertura de trazabilidad, salud de la build y resumen de resultados.
4. Aplicá filtros para limitar el análisis por suite, prioridad, estado, responsable, modo o evidencia.

Los filtros afectan las tablas y métricas de detalle visibles. Si un dato no aparece, verificá el contexto seleccionado antes de concluir que falta.

## Configurar la vista

Usá **Configurar vista** para ordenar, mostrar u ocultar bloques. Las cards pueden adaptarse al espacio disponible; al cambiar su tamaño, revisá que las tablas y métricas queden legibles.

## Quality Intelligence

Cuando el bloque está habilitado para el proyecto, resume señales calculadas a
partir de ejecuciones ya registradas:

- salud y estabilidad de cada caso, incluida una señal de comportamiento
  *flaky* cuando alterna entre resultados comparables;
- fallos agrupados por una huella técnica, para investigar el mismo problema
  sin abrir diagnósticos duplicados;
- diagnósticos asistidos que separan hechos, hipótesis, evidencia y puntos
  desconocidos; son borradores, se editan creando una nueva versión auditable
  y requieren revisión humana antes de crear un bug; y
- un snapshot de riesgo de release explicable, que no cambia el estado de la
  build ni la aprueba automáticamente.

Podés recalcular las señales cuando haya nuevas ejecuciones. Si hay ejecuciones
o evidencia nuevas, el análisis queda desactualizado: reconstruílo antes de
generar diagnósticos, evaluar o aceptar riesgo. La flakiness del riesgo usa
solo observaciones de la build elegida y, cuando existe, compara con la última
build aceptada como contexto. Aceptar un riesgo requiere un motivo y queda
auditado. Si faltan ejecuciones, cobertura o evidencia, el resultado correcto
puede ser **Revisión humana**. La selección de regresión por impacto no
sustituye a la suite completa mientras no exista una fuente trazable de cambios.

## Acciones habituales

- Actualizar datos después de una ejecución.
- Abrir un caso, un bug o una ejecución desde una tabla para investigar.
- Usar la cobertura de trazabilidad para detectar requisitos o historias sin casos asociados.
- Exportar o compartir informes solo cuando la capacidad esté habilitada.

La guía de [Trazabilidad](TRACEABILITY.md) explica cómo corregir vínculos incompletos entre requisitos, historias y casos.
