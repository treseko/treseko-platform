# Trazabilidad y generación asistida

Treseko relaciona el origen funcional con la ejecución para responder qué
requisito se cubre, qué caso lo valida y qué evidencia existe.

```text
Proyecto → Requisito → Historia → Caso → Ejecución → Evidencia → Bug/Informe
```

## Trabajar con requisitos e historias

1. Abrí **Proyectos → Requisitos e Historias**.
2. Registrá requisito, historia y criterios de aceptación.
3. Vinculá los casos.
4. Consultá cobertura y vínculos.
5. Cuando cambie una historia, revisá y confirmá los vínculos afectados.

La cobertura son relaciones registradas: no garantiza que el caso haya pasado
ni que su evidencia esté completa. Las acciones de crear, editar, archivar,
vincular y confirmar revisión se auditan cuando corresponde.

## Formatos

La trazabilidad no cambia el formato. Clásica mantiene pasos; API mantiene
contrato y aserciones; conversacional mantiene endpoint, turnos y evaluación.
`PERFORMANCE` es reservado y no debe rellenarse con otra estructura para forzar
cobertura.

## Generar propuestas con IA

La IA puede proponer historias desde requisitos y casos desde historias:

1. seleccioná el origen;
2. estimá alcance y revisá supuestos;
3. ejecutá si tenés permiso, cuota y proveedor;
4. revisá cada propuesta;
5. confirmá solo lo que quieras guardar.

La generación no publica automáticamente, no crea scripts ni ejecuta código
arbitrario. Conserva fuente, supuestos, versión, trazas y auditoría.

Consultá [Historial Runs](RUN_HISTORY_GUIDE.md), [Reportes](REPORTING_GUIDE.md)
y [Configuración del Motor IA](AI_ENGINE_CONFIG.md).
