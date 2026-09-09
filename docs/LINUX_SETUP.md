# Configuración en Linux

Cubre instalación self-hosted y un worker ejecutado fuera del host de la
aplicación. Para comenzar, leé [INSTALLATION.md](INSTALLATION.md).

## Dependencias

- Docker Engine y Docker Compose v2.
- Node.js si ejecutarás el worker fuera de Docker.
- Python y Selenium si usarás su runtime.
- Red privada entre backend, Engine, worker y sistemas bajo prueba.

```bash
docker --version
docker compose version
```

## Plataforma

```bash
scripts/install_local_treseko.sh --http-port 9095
```

El instalador crea compose.production.env y secretos en .treseko-local/secrets.
No copies passwords a .env, Markdown ni logs.

## Worker

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env --profile automation up -d automation-worker
```

Fuera de Docker:

```bash
cd automation-worker
npm ci
npm start
```

Configurá backend, organización autorizada e intervalo de polling. El worker
conserva su token en .runner-token. Al iniciar muestra WK-xxxxxx o pairing
equivalente; aprobalo en Automatización → Workers. Sin aprobación no ejecuta.

No hay worker API separado: el mismo procesa API_EXECUTION, treseko-api/declarative,
native-fetch y treseko.api-result/v1. POST /external/executions/report sirve a
runners externos y no reemplaza pairing ni polling.

## Verificación

1. Confirmá worker visible y aprobado.
2. Ejecutá un caso clásico.
3. Ejecutá un caso API declarativo.
4. Verificá run, evidencia y estado separados.
5. Revisá logs si queda pendiente.

No borres .runner-token para resolver un fallo: inicia otro pairing. Mantené
runtime, navegadores y worker fuera de Internet cuando sea posible.
