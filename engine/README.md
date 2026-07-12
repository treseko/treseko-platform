# Treseko Engine

Motor de ejecucion IA/Playwright de Treseko. Recibe tareas desde el backend, ejecuta pasos automatizados o asistidos por IA, emite progreso por WebSocket y devuelve resultados, capturas y `ai_report` al proyecto principal.

## Conexion con Treseko

- HTTP: `POST /run-task` y `POST /run-task-sync`.
- Health: `GET /health`, expone `version` y estado del motor.
- Progreso: `BACKEND_WS_URL`, por defecto `ws://localhost:8000/ws/engine-sync`.
- Resultado final: el backend pasa `callback_url`; el engine responde con estado, pasos, logs, capturas base64 y reporte IA compacto.

## Diferencia Con Automation Worker

El engine no se registra como worker ni decide alcance por solucion. Es un servicio interno llamado por el backend para ejecuciones IA/asistidas.

El proceso que se vincula desde `Automatizacion > Workers` es `automation-worker/`. En V1 ese worker se asocia a una solucion mediante `QA_ORGANIZACION_ID`; no es global para toda la instancia.

## Version

La version del componente se lee desde `VERSION`, `TRESEKO_VERSION` o `package.json`. Debe mantenerse alineada con la version del producto Treseko, por ejemplo `0.9.0-rc.1`.

## Evidencia local

Por defecto el engine no guarda reportes HTML ni screenshots locales. La evidencia operativa se envia al backend y queda asociada al run/caso dentro de Treseko.

Para diagnostico local se puede activar:

```bash
ENGINE_LOCAL_EVIDENCE_ENABLED=true
```

Con esa bandera se escriben reportes en `ENGINE_REPORTS_DIR` (`reports` por defecto). No usarlo como almacenamiento productivo de evidencia.

## Logs

Los logs operativos se escriben en `ENGINE_LOG_DIR` (`logs` por defecto) y tambien salen por stdout. Las trazas HTTP completas estan apagadas salvo que se active:

```bash
QA_TEST_TRACE_ENABLED=true
```

Ese modo puede contener datos sensibles y debe usarse solo para diagnostico controlado.
