# Treseko autonomous QA plan — bounded block: manual execution/evidence

Fecha: 2026-09-21

Cobertura agregada

- Robot Framework: 1 suite, 3 casos declarados (`qa/robot/manual_execution.robot`).
  - 1 caso clásico: selección contextual e inicio de run manual.
  - 1 caso de persistencia: snapshots y estado terminal `PASO`.
  - 1 caso negativo: no autenticado e input inválido sin `build_id`.
- Playwright: 1 spec, 3 casos declarados (`frontend/e2e/manual-execution.spec.ts`).
  - 1 flujo UI clásico de selección/inicio.
  - 1 flujo HTTP negativo no autenticado/estado inválido.
  - 1 flujo HTTP de snapshots y estado terminal.
- Conversacional/API: no se inventó un endpoint conversacional. El contrato actual expone API manual declarativa y consola conversacional separada; esta etapa mantiene el caso clásico como camino principal y deja conversacional fuera de esta evidencia.

Contratos verificados antes de escribir las pruebas

- `POST /test-runs/` exige `build_id`, acceso `ejecutar.manual`, build activa y casos del componente.
- `GET /test-runs/{run_id}/ejecuciones/` y `GET /ejecuciones/{execution_id}/snapshots/` son las rutas actuales de lectura.
- `PATCH /ejecuciones/{execution_id}/snapshots/` persiste estados/observaciones.
- `PATCH /ejecuciones/{execution_id}/` persiste el estado terminal y aplica documentación de fallo/bloqueo según configuración.
- No existe una ruta pública de borrado de test runs/ejecuciones. Por seguridad, las pruebas requieren IDs QA existentes y no inventan un endpoint de cleanup.

Gaps y bloqueos explícitos

- Bloqueado en este workspace: `backend/.venv/bin/robot` no existe; no se pudo ejecutar Robot Framework.
- Playwright local requiere `TRESEKO_EPHEMERAL_TOKEN`, `TRESEKO_QA_PROJECT_ID`, `TRESEKO_QA_BUILD_ID` y `TRESEKO_QA_CASE_ID`; no se expusieron ni se inventaron tokens. Sin esos valores los casos quedan skipped por diseño.
- El contrato actual no permite limpiar por HTTP los runs creados por una prueba. Las pruebas no deben crear datos temporales en un entorno compartido sin una fixture/rollback de backend o endpoint administrativo autorizado. Esto impide declarar ejecución end-to-end PASS de la creación hasta que exista una estrategia de teardown soportada.
- No se agregó cobertura conversacional porque la existencia de la consola específica no autoriza a inventar el contrato de creación/limpieza ni a mezclar formatos clásicos y conversacionales.

Resultado de ejecución de este bloque

- Robot: BLOQUEADO por binario ausente (exit no disponible).
- Playwright: NO EJECUTADO; faltan prerequisitos de sesión/IDs y no se exponen secretos.
- No se declara PASS de campaña. Los archivos son cobertura preparada contra contratos observados, con los gaps anteriores pendientes.
