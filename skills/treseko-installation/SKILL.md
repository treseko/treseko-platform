---
name: treseko-installation
description: Install or smoke-test a fresh Treseko Community deployment from the official public GitHub repository with Docker. Use for local Linux, macOS, Windows Docker Desktop, or an authorized Linux host. Do not use this workflow to update or replace an existing installation.
---

# Instalar Treseko Community

Usá esta skill cuando el usuario pida instalar o comprobar una instalación
nueva de Treseko Community. Para una actualización, seguí
[`docs/INSTALLATION.md`](../../docs/INSTALLATION.md) y el contrato de
actualizaciones correspondiente. No conviertas una instalación nueva en una
actualización ni ejecutes una purga para resolver errores.

## 1. Confirmar el origen y el commit

- El repositorio público oficial es `https://github.com/treseko/treseko-platform`.
- Si el usuario pide la última versión, consultá el `HEAD` de `main` en GitHub
  desde el equipo donde se instalará. Registrá el SHA completo y descargá ese
  commit; no supongas que una copia local o el árbol `public-release/` está al
  día.
- Ejemplo para una carpeta nueva en Linux:

  ```bash
  git clone --branch main --single-branch https://github.com/treseko/treseko-platform.git ~/treseko-install-test
  git -C ~/treseko-install-test rev-parse HEAD
  ```

  Si la carpeta existe, no la reutilices hasta comprobar que no contiene una
  instalación ni cambios del usuario; elegí un nombre nuevo para la prueba.
- Si el usuario especifica un tag o commit, respetalo. Usá un checkout separado
  y detached para que la prueba sea reproducible.
- No mezcles cambios locales del repositorio fuente con el checkout de GitHub.

## 2. Leer la guía y revisar el equipo

Leé [`docs/INSTALLATION.md`](../../docs/INSTALLATION.md) y, si corresponde,
[`docs/DOCKER_GUIDE.md`](../../docs/DOCKER_GUIDE.md). Antes de instalar, hacé
un relevamiento de solo lectura:

- sistema operativo, arquitectura, CPU, memoria y espacio disponible;
- Docker 24 o superior y Docker Compose v2;
- puerto HTTP elegido libre;
- contenedores y proyectos Compose activos;
- existencia de una instalación Treseko, su `compose.production.env`, sus
  volúmenes y su directorio de secretos.

Si ya hay una instalación o el estado no es claro, detenete antes de ejecutar
el instalador. Identificá si corresponde una instalación nueva o la ruta de
actualización documentada y preservá sus volúmenes y secretos.

## 3. Preparar una prueba aislada

- Cloná el repositorio oficial en un directorio nuevo, fuera de cualquier
  instalación existente. Guardá el SHA descargado junto al registro de prueba.
- Usá un puerto libre, por defecto `9095`. Conservá el bind local
  `127.0.0.1`; no abras el servicio a la red ni a Internet para una prueba
  local.
- No uses `--with-demo` salvo que el usuario pida esos datos.
- No ejecutes `--update`, `--reset`, `--uninstall --purge-data`, `docker
  compose down -v` ni borres volúmenes durante la prueba.
- En Linux/macOS, comprobá la sintaxis y ejecutá el instalador incluido:

  ```bash
  bash -n scripts/install_local_treseko.sh
  set -o pipefail
  scripts/install_local_treseko.sh --http-port 9095 2>&1 | awk '/^Contraseña temporal:$/ { print; if (getline > 0) print "  [oculta]"; next } { print }'
  ```

  El instalador imprime la contraseña temporal al final. Mantené el filtro
  activo en cualquier registro o salida visible; si cambia el formato, revisá
  primero el script y adapta el filtro antes de ejecutar.

- En Windows, usá `scripts/install_local_treseko.ps1` en PowerShell. Leé
  primero la sección de instalación de Windows para adaptar el puerto y los
  requisitos del host.
- La versión PowerShell también imprime la contraseña temporal. Capturá y
  filtrá esa línea antes de mostrar la salida a una persona o guardarla en un
  log; no ejecutes el instalador con salida sin filtrar en un transcript.
- El instalador remoto Bash/PowerShell transporta secretos durante la conexión
  SSH y la guía no lo recomienda para producción. Para servidores, aplicá el
  flujo manual de secretos por archivo documentado en
  [`docs/INSTALLATION.md`](../../docs/INSTALLATION.md).

## 4. Proteger las credenciales

El instalador local crea una contraseña temporal de administrador y la guarda
en `.treseko-local/secrets/admin-password` con permisos restringidos. No
imprimas ese archivo, no lo incluyas en logs, capturas, reportes o mensajes, y
no pases la contraseña como argumento de comandos. Si hace falta iniciar
sesión, cargala directamente desde el archivo en el navegador o en un gestor
seguro y completá el cambio obligatorio de contraseña.

Los secretos quedan dentro del directorio de la prueba. No los copies al
repositorio, a GitHub, al chat ni a otro equipo. No actives el ping opcional de
instalación durante una prueba salvo instrucción expresa del usuario.

## 5. Verificar el resultado real

No declares éxito solo porque `docker compose up` termine. Comprobá todo lo
siguiente:

1. El instalador termina sin error y la migración de base de datos termina con
   código cero.
2. `docker compose -f docker-compose.prod.yml --env-file compose.production.env ps`
   muestra `db`, `redis`, `backend`, `engine` y `frontend` saludables. El
   `automation-worker` no declara healthcheck en este Compose: confirmá que
   permanece `Up`, sin reinicios repetidos ni errores de arranque.
3. La página en `http://127.0.0.1:<puerto>/` responde y carga la aplicación.
4. Los healthchecks internos de Backend y Engine responden; verificá
   `/health` dentro de sus contenedores o los checks equivalentes definidos en
   `docker-compose.prod.yml`.
5. Iniciá sesión con el administrador temporal, completá el cambio obligatorio
   de contraseña y confirma que se abre el espacio de trabajo.
6. Revisá los logs de arranque y registra cualquier advertencia que afecte una
   función. Redactá contraseñas, tokens, URLs con credenciales y datos
   personales antes de guardar evidencia.

Informá el SHA probado, sistema operativo, servicios saludables, respuesta HTTP,
inicio de sesión y limitaciones encontradas. Diferenciá checks de contenedores
de una sesión real de la aplicación.

## 6. Cerrar una prueba temporal

Si el usuario pidió solo validar, podés detener de forma conservadora esa
instalación aislada con su propio instalador:

```bash
scripts/install_local_treseko.sh --uninstall
```

Esto detiene contenedores y redes sin borrar volúmenes, configuración ni
secretos. Informá qué queda en el directorio de prueba. La eliminación total
requiere autorización explícita y una revisión del backup; nunca uses la purga
como limpieza automática.

## 7. Diagnosticar sin alterar datos

Ante un fallo, conservá la evidencia y consultá logs de un servicio concreto:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env ps
docker compose -f docker-compose.prod.yml --env-file compose.production.env logs --tail=100 backend
```

Comprobá primero el error raíz, disco, memoria, puerto y salud de PostgreSQL.
No repitas el seed de administrador, no reinicies una base compartida y no
elimines volúmenes para ocultar un fallo.
