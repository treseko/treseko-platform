# Datos, persistencia y respaldos

Treseko usa PostgreSQL y volúmenes persistentes para adjuntos, backups,
frontend, Engine y runtime del worker.

## Información conservada

| Área | Información |
|---|---|
| Organización y proyectos | Soluciones, proyectos, componentes, builds, equipos, ambientes y datasets. |
| Diseño | Suites, casos, versiones, pasos, requisitos, historias y vínculos. |
| Ejecución | Runs, resultados, snapshots, observaciones, duración y estados. |
| API y conversación | Contrato congelado, aserciones, turnos, transcripción y evaluación. |
| Calidad | Bugs, comentarios, estados, deduplicación, historial y métricas. |
| Administración | Usuarios, roles, capabilities, preferencias, licencia y auditoría. |
| Portabilidad | Lotes, hashes, referencias externas y rollback. |

Los adjuntos y evidencias binarias están fuera de PostgreSQL. Restaurar solo la
base no recupera esos archivos.

## Snapshots y evidencia

Una ejecución conserva la configuración, variables permitidas y resultado
usado. API y conversación pueden conservar contrato, aserciones, turnos,
respuestas, latencias y evaluación. El historial se lee desde snapshots, no
desde el caso actual.

La evidencia normal se sanitiza y limita. evidence_policy y public_test_data
indican el tratamiento aplicado. public_test_data solo se activa para datos
marcados explícitamente como públicos; nunca incluye tokens, cookies,
credenciales ni información personal real.

## Respaldos y migraciones

1. Respaldá PostgreSQL.
2. Respaldá adjuntos y evidencias.
3. Conservá secretos fuera del repositorio.
4. Probá restauración en una instancia aislada.

Base y adjuntos deben corresponder al mismo momento. Ejecutá migrator de la misma
versión antes del backend actualizado. No borres volúmenes para resolver una
migración sin backup probado.

| Situación | Revisión |
|---|---|
| Resultado distinto al caso actual | Consultá el snapshot. |
| Evidencia ausente | Restaurá también el volumen de adjuntos. |
| Reporte histórico no abre | Snapshot, permisos y almacenamiento. |
| Importación a revertir | Lote y ventana de una hora. |
