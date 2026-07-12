# Instalacion de Treseko Community

Esta guia resume el camino recomendado para instalar Treseko Community en un servidor propio.
Para produccion se recomienda Docker Compose, PostgreSQL y Nginx.

## Requisitos

- Docker 24+ y Docker Compose v2.
- 2 CPU y 4 GB de RAM como base para una instalacion pequena.
- Un dominio o IP local para acceder al frontend.
- Un `SECRET_KEY` fuerte de 64 caracteres o mas.
- Una password propia para PostgreSQL.

## Instalacion rapida con Docker

### Opcion A: probar en local

Para probar Treseko en tu propia maquina con Docker:

Desde Linux/macOS:

```bash
scripts/install_local_treseko.sh --http-port 9095
```

Desde Windows PowerShell:

```powershell
.\scripts\install_local_treseko.ps1 -HttpPort 9095
```

Con datos demo:

```bash
scripts/install_local_treseko.sh --with-demo
```

Para recrear el entorno local desde cero:

```bash
scripts/install_local_treseko.sh --reset --with-demo
```

El instalador local:

- genera secretos fuertes en `.treseko-local/secrets`;
- crea `compose.production.env`;
- levanta PostgreSQL, Redis, backend, engine y frontend;
- ejecuta migraciones;
- crea el usuario inicial `admin@qa.local`;
- devuelve una contraseña temporal para el primer login.

### Opcion B: instalacion automatica por SSH

Si tienes un servidor Linux accesible por SSH, puedes instalar Treseko desde tu equipo sin ejecutar cada paso manualmente.

Desde Linux:

```bash
scripts/install_remote_treseko.sh usuario@servidor --http-port 9095
```

Desde Windows PowerShell:

```powershell
.\scripts\install_remote_treseko.ps1 usuario@servidor -HttpPort 9095
```

El instalador:

- sube este repositorio al servidor;
- instala Docker si falta y el servidor usa Ubuntu/Debian con `apt`;
- genera secretos fuertes para base de datos y backend;
- ejecuta migraciones;
- crea el usuario inicial `admin@qa.local`;
- devuelve una contraseña temporal para el primer login.

Al finalizar veras algo similar a:

```text
URL:
  http://servidor:9095

Usuario inicial:
  admin@qa.local

Contraseña temporal:
  ********
```

Guarda esa contraseña en el momento. Treseko pedira cambiarla en el primer login.

> Nota: Windows se usa como equipo cliente para lanzar la instalacion por SSH. El servidor destino debe ser Linux.

### Opcion C: instalacion manual con Docker

```bash
cp .env.production.example compose.production.env
```

Edita `compose.production.env` y completa las rutas a archivos de secretos:

```dotenv
APP_ENV=production
TRESEKO_HTTP_PORT=9095
TRESEKO_DB_PASSWORD_FILE=/ruta/segura/db-password
TRESEKO_DATABASE_URL_FILE=/ruta/segura/database-url
TRESEKO_SECRET_KEY_FILE=/ruta/segura/secret-key
DB_USER=treseko
DB_NAME=treseko
```

Los archivos deben contener:

- `db-password`: password de PostgreSQL.
- `database-url`: `postgresql+asyncpg://treseko:<DB_PASSWORD>@db:5432/treseko`.
- `secret-key`: clave aleatoria fuerte de 64 caracteres o mas.

Valida la configuracion:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env config
```

Levanta la base y Redis:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d db redis
```

Ejecuta migraciones:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm migrator
```

Crea el primer administrador:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm --entrypoint python backend /app/seed_admin.py
```

Levanta la aplicacion:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d backend engine frontend
```

Abre Treseko desde el navegador en el puerto configurado para el frontend.

## Instalacion limpia

Una instalacion productiva limpia no crea soluciones, proyectos, builds ni datos demo.
Despues del primer login, el administrador debe crear la primera solucion desde la interfaz.

## Datos demo

Los datos demo solo son para desarrollo o presentaciones:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm --entrypoint python backend /app/seed_demo_showcase.py
```

No ejecutes el seed demo en un ambiente productivo real.

## Guias extendidas

- Docker detallado: `docs/DOCKER_GUIDE.md`
- Linux bare-metal: `docs/LINUX_SETUP.md`
- Seguridad: `SECURITY.md`
- Arquitectura: `docs/ARCHITECTURE.md`
