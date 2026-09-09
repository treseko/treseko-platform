# Guía Docker

El Compose separa frontend, backend, PostgreSQL, Redis, Engine y worker. También
declara un perfil de complementos, pero este snapshot público no incluye el
contexto `plugin-runner`. Usa compose.production.env y secretos por archivo.

## Secretos por archivo

| Variable | Contenido |
|---|---|
| TRESEKO_DB_PASSWORD_FILE | Contraseña PostgreSQL. |
| TRESEKO_DATABASE_URL_FILE | URL postgresql+asyncpg. |
| TRESEKO_SECRET_KEY_FILE | Clave de sesión/configuración. |
| TRESEKO_AI_CREDENTIALS_MASTER_KEY_FILE | Clave maestra IA. |
| TRESEKO_AI_ENGINE_INTERNAL_TOKEN_FILE | Token backend-Engine. |

Los instaladores crean esas rutas. La instalación manual está en
[INSTALLATION.md](INSTALLATION.md). No uses valores inline ni subas secretos.

## Servicios y profiles

Servicios base: db, redis, migrator, backend, engine y frontend.

| Profile | Servicio | Uso |
|---|---|---|
| automation | automation-worker | Automatización clásica y API declarativa. |
| plugins | plugin-runner declarado en Compose | No operativo en este snapshot: el paquete público no contiene su contexto de build. |

El worker debe registrarse y aprobar pairing en Automatización → Workers. Su
token persiste en treseko_worker_runtime.

## Arranque

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env config
docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d db redis
docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm migrator
docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d backend engine frontend
```

El frontend publica TRESEKO_HTTP_PORT, por defecto 9095.

## Worker unificado

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env --profile automation up -d automation-worker
```

El mismo worker procesa API_EXECUTION, usa treseko-api/declarative y
native-api-runtime.mjs, y devuelve native-fetch y treseko.api-result/v1. No hay
un worker API separado.

La API para runners externos es independiente:

```text
POST /external/executions/report
```

## Persistencia y diagnóstico

Antes de down -v respaldá los volúmenes.

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env ps
docker compose -f docker-compose.prod.yml --env-file compose.production.env logs backend
docker compose -f docker-compose.prod.yml --env-file compose.production.env logs automation-worker
```

Revisá migrator, backend y permisos de secretos antes de borrar datos. El
profile `plugins` está declarado en el Compose, pero no puede construirse desde
este paquete porque falta el contexto público de `plugin-runner`; no lo
habilites como si fuera operativo.
