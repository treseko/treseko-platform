# Trazabilidad y generación asistida

Treseko relaciona el origen funcional de una prueba con su resultado para que
el equipo pueda responder qué requisito se cubre, qué caso lo valida y cuál fue
la última evidencia disponible.

```text
Proyecto → Requisito → Historia → Caso → Ejecución → Evidencia
```

## Trabajar con requisitos e historias

1. Abrí **Proyectos → Requisitos e Historias**.
2. Registrá o actualizá el requisito y sus historias.
3. Vinculá los casos que cubren cada historia.
4. Consultá el historial cuando necesites revisar un cambio.

Cuando una historia cambia, Treseko puede marcar sus vínculos con casos para
revisión. Confirmá que el caso sigue cubriendo el criterio esperado antes de
considerar la cobertura como válida.

## Generar propuestas con IA

La IA puede proponer historias desde requisitos y casos desde historias.

1. Seleccioná el requisito o historia de origen.
2. Definí el alcance y revisá los supuestos mostrados.
3. Ejecutá la generación.
4. Revisá cada propuesta y elegí cuáles guardar.

La generación no publica historias automáticamente, no crea scripts y no
ejecuta código arbitrario. Cada uso conserva su propio historial, versión y
auditoría. Las cuotas y permisos se validan antes de iniciar el proceso.

## Ayuda rápida

- Si no podés generar propuestas, revisá que tengas permiso, cuota disponible y
  un proveedor de IA configurado.
- Si un vínculo requiere revisión, no lo ignores: actualizá o confirmá el caso
  asociado.
- La falta de evidencia no equivale a cobertura aprobada.

Consultá [Configuración del Motor IA](AI_ENGINE_CONFIG.md) para preparar el
proveedor y los workflows disponibles.
