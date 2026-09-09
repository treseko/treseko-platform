# MCP gobernado

Treseko incluye un endpoint MCP (Model Context Protocol) de solo lectura para
que un asistente autorizado consulte el contexto QA de una instalación. Está
deshabilitado por defecto y no otorga acceso a shell, filesystem, secretos,
base de datos ni red privada.

## Estado y alcance

La implementación inicial expone estas herramientas:

- `treseko.project.get`: consulta los metadatos no sensibles de un proyecto.
- `treseko.builds.list`: lista las builds de un proyecto.

Ambas herramientas requieren `project_id` y respetan el acceso del usuario a la
organización y al proyecto. Las mutaciones y la ejecución arbitraria no forman
parte de este contrato.

## 1. Habilitar MCP

Configurá estas variables en el entorno del backend:

```text
TRESEKO_MCP_ENABLED=true
TRESEKO_MCP_TOOLS=treseko.project.get,treseko.builds.list
```

Reiniciá el backend después de cambiar la configuración. Si
`TRESEKO_MCP_ENABLED` no está definido como `true`, `/mcp` y `/mcp/tools`
responden que MCP no está habilitado.

## 2. Crear la credencial

MCP usa una credencial dedicada (`X-MCP-API-Key`), separada de la sesión del
navegador y de la API key para reportar ejecuciones externas. La creación y
gobernanza de esa credencial dependen de la edición y configuración de la
instancia; no reutilices una key de `/external/executions/report`.

La identidad técnica necesita capability de lectura y alcance simultáneo sobre
la organización y el `project_id`. Si la interfaz de tu instalación no ofrece
la gestión de una credencial MCP, solicitá al administrador que la cree por el
mecanismo operativo de la instancia; no la reemplaces por un JWT de navegador.

Guardá la key en el almacén de secretos del cliente MCP. No la incluyas en
repositorios, capturas, prompts, archivos `.env` versionados ni logs.

## 3. Descubrir herramientas

```text
GET https://TU_TRESEKO/mcp/tools
X-MCP-API-Key: <MCP_API_KEY>
```

También podés usar JSON-RPC sobre `POST /mcp`:

```bash
curl -sS https://TU_TRESEKO/mcp \
  -H 'Content-Type: application/json' \
  -H "X-MCP-API-Key: ${TRESEKO_MCP_API_KEY}" \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

La respuesta sólo incluye las herramientas habilitadas por la allowlist y
permitidas por el RBAC del usuario técnico.

## 4. Invocar una herramienta

```bash
curl -sS https://TU_TRESEKO/mcp \
  -H 'Content-Type: application/json' \
  -H "X-MCP-API-Key: ${TRESEKO_MCP_API_KEY}" \
  --data '{
    "jsonrpc":"2.0",
    "id":2,
    "method":"tools/call",
    "params":{
      "name":"treseko.project.get",
      "arguments":{"project_id":"00000000-0000-0000-0000-000000000000"}
    }
  }'
```

Reemplazá el UUID de ejemplo por un proyecto al que la identidad técnica
tenga acceso. Para listar builds, cambiá `name` por `treseko.builds.list`.

## Seguridad y límites

- La autenticación usa únicamente `X-MCP-API-Key`; no se aceptan JWT del navegador.
- MCP permanece deshabilitado por defecto.
- La allowlist no puede habilitar herramientas desconocidas o prohibidas.
- La allowlist inicial sólo incluye `treseko.project.get` y
  `treseko.builds.list`; no hay shell, filesystem, secretos, base de datos ni
  red genérica.
- Solo las invocaciones de herramientas que llegan a ejecutarse correctamente
  quedan auditadas con actor, herramienta, argumentos saneados, estado
  `success` y `correlation_id`. Los rechazos de autenticación, RBAC,
  validación, allowlist o límite ocurren antes de crear ese registro.
- El límite es de 30 llamadas por minuto.
- Cada solicitud admite hasta 64 KiB y cada respuesta hasta 256 KiB.
- El resultado completo no se guarda en el audit log; la respuesta se entrega
  al cliente MCP y el registro conserva el estado `success`.
- Revocar la API key o deshabilitar MCP bloquea las llamadas siguientes.

## Problemas frecuentes

Las respuestas de la tabla son mensajes literales emitidos por el backend
actual y se conservan para facilitar el diagnóstico.

| Respuesta | Causa probable |
|---|---|
| `404 MCP no está habilitado` | Falta `TRESEKO_MCP_ENABLED=true` o no se reinició el backend. |
| `401 Credencial MCP inválida` | La key está ausente, fue revocada o no corresponde a un usuario válido. |
| `403` por capability o proyecto | El usuario no tiene permiso de lectura sobre la herramienta, organización o proyecto. |
| `404 Herramienta MCP no autorizada` | La herramienta no está en `TRESEKO_MCP_TOOLS` o no existe en el catálogo. |
| `429` | Se superó el límite de llamadas. |

Para una integración externa, verificá primero `/mcp/tools`, ejecutá una
llamada de lectura con un proyecto de prueba y revisá el registro de auditoría.
