# Guía de pruebas API

Treseko admite pruebas API declarativas y separa dos integraciones que suelen
confundirse.

## Ejecutar dentro de Treseko

El caso usa el formato `API` y una configuración declarativa. El runner resuelve
variables desde el ambiente y el dataset, aplica la allowlist, ejecuta la
solicitud y evalúa sus aserciones.

- **Manual:** la solicitud y el veredicto se gestionan desde la consola API.
- **Automatizada:** el Automation Worker unificado reclama el trabajo,
  anuncia `treseko-api/declarative` y devuelve `treseko.api-result/v1`.
- **IA:** no la declares disponible hasta verificar la ruta y la evidencia de
  la instalación concreta.

No existe un worker API separado.

## Reportar desde un runner externo

Un runner externo ejecuta la prueba y solamente informa el resultado:

```http
POST /external/executions/report
Authorization: Bearer <API_KEY_DE_AUTOMATIZACION_EXTERNA>
Content-Type: application/json
```

Esta API no inicia jobs ni recibe el snapshot de un caso interno. La API key
debe guardarse como secreto del CI y tener el alcance mínimo necesario.
El contrato es atómico: un lote inválido completo devuelve error y no guarda
solo los casos válidos. Para los payloads de `steps`, `api` y `chatbot`, sus
límites y ejemplos exactos están en [API externa de automatización](EXTERNAL_AUTOMATION_API.md).

## Evidencia y seguridad

- El ambiente define los destinos permitidos.
- La respuesta tiene límites de tiempo y tamaño.
- Los valores sensibles se redactan antes de persistir o compartir.
- Las variables de estado permitidas usan el namespace `api.*` y no se
  comparten entre ejecuciones independientes.
- Un destino bloqueado o no resoluble debe quedar documentado como problema
  técnico, no como un fallo inventado del sistema bajo prueba.

## Checklist

- [ ] El caso tiene formato `API` y una configuración válida.
- [ ] El destino está permitido por el ambiente.
- [ ] Las credenciales provienen de configuración protegida.
- [ ] Las aserciones expresan resultados esperados comprensibles.
- [ ] Elegiste Automation Worker o API externa según el flujo real.
- [ ] Revisaste el snapshot y la evidencia antes de crear un bug.
- [ ] Los reintentos externos usan un identificador estable.
- [ ] El payload usa `steps` solo para `CLASICA`, `api` solo para `API` y
      `chatbot` solo para `CONVERSACIONAL`.

Consultá también [Tipos de prueba y modalidades](TEST_TYPES_AND_EXECUTION.md),
[Automation Worker](AUTOMATION_WORKER_V1.md) y
[Bug Tracker](BUG_TRACKER.md).
