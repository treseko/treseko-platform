# MCP gobernado

El servidor MCP de Treseko está deshabilitado por defecto. Para habilitarlo se
requiere `TRESEKO_MCP_ENABLED=true`, una allowlist explícita y una topología
segura: `TRESEKO_MCP_DEPLOYMENT_TOPOLOGY=single_process` para un único proceso,
o `shared_redis` con `REDIS_URL` (o `TRESEKO_MCP_RATE_LIMIT_REDIS_URL`) para
workers o réplicas múltiples. Una declaración ausente o ambigua deshabilita MCP.

La autenticación usa exclusivamente `X-MCP-API-Key`, una API key revocable. El
endpoint no acepta JWT de navegador y comprueba membresía de proyecto y
organización en cada llamada.

El resolvedor interno de credenciales del Engine comparte la misma admisión:
permanece cerrado si MCP está deshabilitado o la topología no es válida, antes
de evaluar el token técnico. Sus errores siguen siendo genéricos.

La superficie combina lecturas y operaciones gobernadas de escritura. La
allowlist se intersecta con la capability RBAC y scopes declarados por cada
herramienta. El catálogo no incluye shell,
filesystem, secretos, base de datos, red privada ni ejecución arbitraria.

El límite es de 30 llamadas por minuto, 64 KiB por solicitud y 256 KiB por
respuesta. Redis compartido se verifica con timeout corto y caché segura; si no
responde, todas las rutas MCP, incluido `initialize`, discovery y autenticación,
fallan cerradas. Los handlers deben devolver resultados JSON seguros y acotados;
las cadenas, listas, profundidad y bytes se truncan o rechazan antes de construir
el sobre JSON-RPC.

Las llamadas y rechazos se auditan con detalles saneados y acotados. No se
persisten prompts, credenciales ni resultados completos. No se publica MCP
abierto a Internet ni se agregan mutaciones sin una capability específica,
allowlist, schema y pruebas de auditoría correspondientes.
