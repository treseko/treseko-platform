# Guia Docker Self-Hosted Community

Esta guia describe una instalacion self-hosted de Treseko Community con
`docker-compose.prod.yml`. El paquete distribuible no incluye archivos ni
comandos de desarrollo; todo lo sensible debe vivir fuera del repositorio y
referenciarse mediante archivos de secreto.

## Requisitos

- Docker Engine con soporte para `docker compose`.
- Acceso de shell al servidor.
- Puerto HTTP libre, por defecto `8080`.
- Un directorio externo para secretos, por ejemplo `/opt/treseko/secrets`.

Docker es el camino recomendado si el host es Windows, macOS, Ubuntu 20.04,
Debian 11 o una distribucion Linux antigua. El instalador bare-metal soportado
requiere Linux con systemd, nginx, PostgreSQL/Redis administrados por el host y
Python 3.10 o superior.

## Preparar secretos

Crear secretos fuera del directorio de Treseko:

```bash
sudo install -d -m 0700 /opt/treseko/secrets
sudo sh -c 'openssl rand -hex 32 > /opt/treseko/secrets/db-password'
sudo sh -c 'openssl rand -hex 48 > /opt/treseko/secrets/secret-key'
sudo sh -c 'printf "%s" "postgresql+asyncpg://treseko:$(cat /opt/treseko/secrets/db-password)@db:5432/treseko" > /opt/treseko/secrets/database-url'
sudo chmod 0600 /opt/treseko/secrets/db-password /opt/treseko/secrets/database-url /opt/treseko/secrets/secret-key
```

No guardes passwords, `SECRET_KEY`, tokens de worker ni licencias privadas en
`compose.production.env`. Ese archivo solo debe contener configuracion y rutas a
secretos.

## Crear `compose.production.env`

`compose.production.env` es un archivo de configuracion de Compose, no una caja de
secretos. Debe guardar rutas, puertos y flags operativos. Las contraseñas,
tokens, `SECRET_KEY` y URLs con credenciales viven en archivos separados con
permisos `0600`, y Compose solo recibe la ruta mediante variables `*_FILE`.

Copiar el ejemplo:

```bash
cp .env.production.example compose.production.env
```

Editar como minimo:

```env
TRESEKO_DB_PASSWORD_FILE=/opt/treseko/secrets/db-password
TRESEKO_DATABASE_URL_FILE=/opt/treseko/secrets/database-url
TRESEKO_SECRET_KEY_FILE=/opt/treseko/secrets/secret-key
TRESEKO_HTTP_PORT=8080
```

Ejemplo correcto:

```env
TRESEKO_SECRET_KEY_FILE=/opt/treseko/secrets/secret-key
```

Ejemplo incorrecto:

guardar `SECRET_KEY` o cualquier password directamente dentro de
`compose.production.env`.

Si el puerto `8080` esta ocupado, usar otro puerto libre:

```env
TRESEKO_HTTP_PORT=8090
```

Validar la configuracion sin imprimir secretos:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env config
```

## Construir imagenes

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env build
```

## Inicializar servicios base

Levantar PostgreSQL y Redis:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d db redis
```

Ejecutar migraciones:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm migrator
```

Crear o asegurar el primer administrador:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm backend \
  seed-admin
```

El comando imprime una contraseña temporal una sola vez para
`admin@qa.local`. El primer login obliga a cambiarla.
Internamente el modo `seed-admin` del entrypoint ejecuta `/app/seed_admin.py`
despues de aplicar las migraciones.

Si una automatizacion necesita definir una contraseña inicial, usar un archivo
de secreto con permisos `0600`:

```bash
sudo install -m 600 /dev/null /opt/treseko/secrets/initial-admin-password
sudoedit /opt/treseko/secrets/initial-admin-password
docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm -T backend \
  seed-admin --password-stdin < /opt/treseko/secrets/initial-admin-password
```

## Levantar Treseko

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d backend engine frontend
```

Abrir:

- `http://localhost:8080` si `TRESEKO_HTTP_PORT=8080`
- `http://localhost:8090` si se uso `TRESEKO_HTTP_PORT=8090`

Validar:

```bash
curl http://localhost:8080/api/health
curl http://localhost:8080/api/system/version
docker compose -f docker-compose.prod.yml --env-file compose.production.env ps
```

Una instalacion Community limpia no crea soluciones ni proyectos demo. El
administrador debe crear la primera solucion desde la UI.

## Demo showcase para desarrollo

El producto self-hosted productivo arranca en blanco. Para un entorno de
desarrollo o una demo comercial controlada, Treseko incluye un seed opcional que
crea una solucion demo, dos proyectos, builds, ambientes, casos, ejecuciones,
bugs, evidencia sintetica y complementos internos configurados sin secretos
reales.

Reset dev con Docker local:

```bash
docker compose down -v
docker compose up -d db redis
cd backend
DATABASE_URL=postgresql+asyncpg://postgres:<db-password-dev>@localhost:5432/treseko_db \
  SECRET_KEY=dev-secret-key-dev-secret-key-32chars \
  alembic upgrade head
DATABASE_URL=postgresql+asyncpg://postgres:<db-password-dev>@localhost:5432/treseko_db \
  SECRET_KEY=dev-secret-key-dev-secret-key-32chars \
  python seed_admin.py
DATABASE_URL=postgresql+asyncpg://postgres:<db-password-dev>@localhost:5432/treseko_db \
  SECRET_KEY=dev-secret-key-dev-secret-key-32chars \
  python seed_demo_showcase.py --reset-demo
```

Reset dev con PostgreSQL local:

```bash
dropdb --if-exists treseko_db
createdb treseko_db
cd backend
DATABASE_URL=postgresql+asyncpg://postgres:treseko_dev@localhost:5432/treseko_db \
  SECRET_KEY=dev-secret-key-dev-secret-key-32chars \
  alembic upgrade head
DATABASE_URL=postgresql+asyncpg://postgres:treseko_dev@localhost:5432/treseko_db \
  SECRET_KEY=dev-secret-key-dev-secret-key-32chars \
  python seed_admin.py
DATABASE_URL=postgresql+asyncpg://postgres:treseko_dev@localhost:5432/treseko_db \
  SECRET_KEY=dev-secret-key-dev-secret-key-32chars \
  python seed_demo_showcase.py --reset-demo
```

`seed_demo_showcase.py` es idempotente para la solucion `Inmser Demo Lab`. El
flag `--reset-demo` elimina solo esa solucion y sus datos asociados antes de
recrearla; no borra otros clientes ni usuarios. No usar este seed para una
instalacion productiva limpia.

## Recuperar contraseña de administrador

No existe reset publico desde la web. La recuperacion requiere acceso al
servidor:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm backend \
  python /app/reset_user_password.py --email admin@qa.local
```

El comando genera una contraseña temporal nueva, registra auditoria
`PASSWORD_RESET` y obliga a cambiarla en el siguiente login. Las sesiones JWT
ya emitidas expiran según la duración configurada.

Para recuperación automatizada, usar `--password-file` o `--password-stdin`.
Los archivos pasados a `--password-file` deben tener permisos `0600` o más
restrictivos.

## Actualizaciones del sistema

Treseko consulta `updates.treseko.com` desde `Configuracion > Actualizaciones`.
El compose productivo crea volumenes compartidos para preparar updates:

- `treseko_update_data`: paquetes descargados, extraccion y flag `update-ready`.
- `treseko_backend_backups`: backups pre-update de base y codigo.
- `treseko_frontend_html`: archivos estaticos servidos por nginx.
- `treseko_engine_runtime` y `treseko_worker_runtime`: runtime actualizable de
  engine y worker.

Flujo recomendado:

1. El administrador busca updates desde la UI.
2. Treseko descarga el paquete, verifica SHA-256, genera backups y deja
   `update-ready`.
3. Reiniciar servicios para que `entrypoint.sh` aplique el paquete y ejecute
   Alembic:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d backend engine frontend
```

`TRESEKO_ENABLE_SELF_UPDATE_APPLY=true` solo debe habilitarse cuando exista un
proceso operativo de updates validado para tu instalacion. Sin esa flag, la UI
prepara el paquete pero no fuerza reinicio automatico.

## Worker automatizado opcional

El servicio `automation-worker` queda bajo el profile `automation`. Una
instalacion limpia no lo arranca por defecto.

Flujo recomendado:

1. Iniciar la aplicacion base.
2. Entrar como administrador.
3. Crear o emparejar el worker desde la pantalla de automatizacion.
4. Guardar el token generado en un secreto operativo fuera del repo.
5. Levantar el worker con el profile `automation`:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env --profile automation up -d automation-worker
```

## Instalacion alternativa sin Docker

Para servidores Linux con PostgreSQL, Redis y nginx gestionados por el
administrador, existe un instalador base:

```bash
sudo DATABASE_URL_FILE=/root/treseko-secrets/database-url \
  SECRET_KEY_FILE=/root/treseko-secrets/secret-key \
  scripts/install_treseko.sh
```

El script instala backend en `/opt/treseko`, crea el servicio
`treseko-backend`, configura nginx, corre migraciones iniciales, asegura el
admin local y usa el mismo `entrypoint.sh` para updates preparados. Solo acepta
`DATABASE_URL_FILE` y `SECRET_KEY_FILE`; no recibe secretos crudos por variables
de ambiente.

Compatibilidad bare-metal validada para RC:

- Ubuntu 22.04+.
- Ubuntu 24.04+.
- Debian 12+.

No soportado para bare-metal:

- Ubuntu 20.04, porque trae Python 3.8.
- Debian 11 o anterior.
- Windows/macOS; usar Docker.

## Reglas de produccion

- No habilitar variables `TRESEKO_ALLOW_DEV_*`.
- No guardar secretos en `compose.production.env`.
- No agregar `RUNNER_TOKEN` al archivo productivo base.
- No copiar llaves privadas ni material sensible al runtime.
- El backend productivo requiere migraciones Alembic aplicadas.
- Si Alembic falla por schema drift, corregir la migracion o recrear la base
  antes de publicar; no usar `stamp head` como solucion silenciosa.
