# Bug Tracker / Seguimiento de Bugs

## Resumen
El modulo Bug Tracker registra defectos internos con trazabilidad QA completa. Un bug puede nacer de carga manual o de un snapshot fallido/bloqueado, y queda preparado para vincularse despues con Redmine, Jira, GitHub Issues u otro tracker externo sin crear tickets externos automaticamente.

## Trazabilidad
`BugIssue` vincula proyecto, componente, build, caso, test run, ejecucion, snapshot, entorno, dataset, usuario reportante y asignado. Tambien conserva codigo de caso/build, paso afectado, modo de ejecucion, datos congelados, esperado/obtenido, logs, error tecnico, notas QA, impacto, bloqueos, dedupe hash y metadata.

## Flujo Desde Prueba Fallida
1. La ejecucion queda en `FALLO` o `BLOQUEADO`.
2. El usuario revisa snapshot, comentarios y evidencias.
3. El sistema permite crear un bug interno desde `/snapshots/{snapshot_id}/bugs/`.
4. El payload se precarga con build, caso, run, ejecucion, snapshot, paso, datos congelados, esperado y comentario/error.
5. El usuario puede editar titulo, obtenido, severidad, prioridad, asignado y notas antes de guardar.
6. El bug interno puede vincularse despues a un issue externo mediante `ExternalIssueLink`.

## API Principal
- `GET /proyectos/{proyecto_id}/bugs/`: listado paginado con filtros.
- `GET /bugs/{bug_id}/`: detalle.
- `POST /bugs/`: creacion manual validada.
- `POST /snapshots/{snapshot_id}/bugs/`: creacion desde snapshot fallido/bloqueado.
- `PATCH /bugs/{bug_id}` y `POST /bugs/{bug_id}/transition/`: edicion y workflow.
- `GET/POST /bugs/{bug_id}/comments/`: comentarios.
- `GET/POST/DELETE /bugs/{bug_id}/attachments/`: evidencias.
- `GET/POST/DELETE /bugs/{bug_id}/external-links/`: vinculos externos genericos.
- `POST /bugs/{bug_id}/external-preview/`: markdown copiable para trackers externos.
- `GET /proyectos/{proyecto_id}/bugs/summary/`: KPIs.
- `GET /proyectos/{proyecto_id}/bugs/dedupe-suggestions/` y `POST /bugs/{bug_id}/mark-duplicate/`: deduplicacion.

## RBAC
Capacidades: `bugs.ver`, `bugs.crear`, `bugs.editar`, `bugs.triage`, `bugs.asignar`, `bugs.comentar`, `bugs.adjuntos`, `bugs.vincular_externo`, `bugs.exportar`, `bugs.admin`.

ADMIN y QA_LEAD tienen edicion. TESTER puede ver/crear/comentar/adjuntar/editar segun permiso de modulo. VIEWER solo lectura.

## Restricciones
El modulo no envia issues a Redmine/Jira/GitHub automaticamente. El preview genera markdown y los vinculos externos se registran solo por accion explicita del usuario.
