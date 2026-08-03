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

MCP usa una API key separada de la sesión del navegador. Creala desde
**Configuración → Preferencias → API keys de automatización externa**. La key
queda asociada al usuario que la creó, por lo que ese usuario debe tener acceso
de lectura al proyecto y a su organización.

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
- El límite es de 30 llamadas por minuto.
- Cada solicitud admite hasta 64 KiB y cada respuesta hasta 256 KiB.
- Las llamadas exitosas quedan auditadas con actor, herramienta, argumentos saneados,
  resultado y `correlation_id`.
- Revocar la API key o deshabilitar MCP bloquea las llamadas siguientes.

## Problemas frecuentes

| Respuesta | Causa probable |
|---|---|
| `404 MCP no está habilitado` | Falta `TRESEKO_MCP_ENABLED=true` o no se reinició el backend. |
| `401 Credencial MCP inválida` | La key está ausente, fue revocada o no corresponde a un usuario válido. |
| `403` por capability o proyecto | El usuario no tiene permiso de lectura sobre la herramienta, organización o proyecto. |
| `404 Herramienta MCP no autorizada` | La herramienta no está en `TRESEKO_MCP_TOOLS` o no existe en el catálogo. |
| `429` | Se superó el límite de llamadas. |

Para una integración externa, verificá primero `/mcp/tools`, ejecutá una
llamada de lectura con un proyecto de prueba y revisá el registro de auditoría.
