# Requisitos, historias y generación gobernada con IA

Treseko conecta requisitos, historias, criterios de aceptación y casos para que
la cobertura pueda explicarse desde una necesidad hasta su último resultado de
ejecución.

## Modelo de trazabilidad

La relación principal es:

```text
Proyecto -> Requisito -> Historia -> Caso -> Ejecución -> Evidencia
```

Un requisito y una historia conservan historial de cambios. Cuando una historia
cambia, los vínculos con casos pueden quedar pendientes de revisión hasta que
una persona confirme que el caso continúa cubriendo el criterio esperado.

La matriz de cobertura muestra requisitos, historias, casos vinculados y último
resultado conocido. No interpreta ausencia de evidencia como aprobación.

## Crear historias con IA

1. Abrir la trazabilidad del proyecto y crear o seleccionar un requisito.
2. Completar descripción, alcance y criterios disponibles.
3. Solicitar una estimación de generación.
4. Revisar supuestos o información faltante.
5. Ejecutar el workflow configurado para **Generación de historias**.
6. Editar y seleccionar propuestas.
7. Aplicarlas mediante confirmación humana.

La IA propone; el backend crea los registros dentro de una transacción después
de la selección. Una propuesta no se publica automáticamente como historia.

## Crear casos desde una historia

1. Abrir una historia con criterios de aceptación estructurados.
2. Solicitar una estimación de casos y revisar cuota y cobertura.
3. Confirmar supuestos cuando el sistema lo solicite.
4. Ejecutar el workflow de **Generación de casos de prueba**.
5. Revisar título, prioridad, precondiciones, pasos, datos y resultados
   esperados de cada propuesta.
6. Seleccionar las propuestas que deben persistirse.

Los casos creados quedan vinculados con la historia y sus criterios. La
generación no crea scripts ni ejecuta código arbitrario.

## Tres workflows independientes

Configuración permite elegir y editar por separado:

- Generación de historias.
- Generación de casos de prueba.
- Ejecución de pruebas.

Cada uso conserva workflow activo, versión publicada, validación, snapshot de
ejecución y auditoría propios. Editar un uso no debe reemplazar los otros dos.

## Gobierno y seguridad

- Los permisos de proyecto y las capacidades Premium se validan en backend.
- Las cuotas se consultan antes de generar y se consumen sólo según el contrato
  vigente.
- Un workflow inválido, sin capability o sin proveedor disponible se bloquea
  con un motivo visible.
- Las salidas malformadas no se convierten silenciosamente en historias o
  casos.
- Los prompts y agentes no pueden incorporar secretos inline.
- La revisión humana es obligatoria antes de persistir propuestas.

Para el formato portable de agentes y workflows consulta
[Configuración del Motor IA](AI_ENGINE_CONFIG.md).
