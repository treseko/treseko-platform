# Contrato Para Preparar Paquetes De Actualizacion

Este documento es obligatorio para cualquier IA o agente que prepare una
actualizacion de Treseko. El paquete debe ser ejecutable por el actualizador
instalado, reproducible, verificable y reversible.

## Objetivo Operativo

Una actualizacion debe poder pasar de una version instalada a otra sin que el
usuario tenga que reconstruir contenedores, copiar carpetas o editar archivos.
El paquete debe contener los artefactos y las instrucciones para preparar,
aplicar, validar y revertir el cambio.

El flujo principal es:

```text
validar -> descargar -> verificar -> backup -> pre-update -> mantenimiento
-> aplicar componentes -> migrar -> reiniciar -> health checks -> activar
-> limpiar o rollback
```

## Regla De Compatibilidad

El paquete no puede depender exclusivamente de la logica de la version que se
esta actualizando. La instalacion debe conservar un `updater-bootstrap` estable
capaz de leer el paquete y ejecutar su plan.

El bootstrap debe procesar `manifest.json`, `VERSION`, `update-plan.json`,
actualizaciones consecutivas, migraciones y rollback. Si cambia el formato del
bootstrap, primero debe publicarse una version compatible o un puente de
migracion. No se debe asumir que `1.0.0` conoce el formato de una version futura.

## Estructura Del Paquete

```text
treseko-update-v<VERSION>.tar.gz
├── manifest.json
├── VERSION
├── CHANGELOG.md
├── update-plan.json
├── updater/
│   ├── update.py                 # opcional: logica especial validada
│   ├── pre-update.sh             # opcional: preparacion previa
│   ├── post-update.sh            # opcional: tareas posteriores
│   └── rollback.sh               # opcional: rollback especifico
├── backend/
├── frontend/dist/
├── engine/
├── automation-worker/
├── plugin-runner/             # cuando el manifest de componentes lo declara
└── source-release/            # opcional: release pública completa para Compose atómico
```

Los tres metadatos del contrato de componentes — `manifest.json`,
`update-plan.json` y `runtime-builds.json` — viajan juntos. Si el paquete
incluye alguno, los tres son obligatorios y sus inventarios, versiones y
orígenes deben coincidir entre sí y con el manifest firmado. Un payload
incompleto se rechaza en el staging, antes de preparar cualquier componente, y
los payloads sintéticos de las pruebas quedan sujetos a la misma regla.

Si el manifest declara `deployment.mode=complete-source`, también son
obligatorios `source-release/`, su `VERSION`, el Compose, todos los
Dockerfiles/build contexts y los scripts del instalador atómico. Ese árbol se
toma únicamente de `public-release/treseko-platform` y excluye caches,
dependencias instaladas, configuración `.env` local (conserva los archivos
versionados `.env*.example`), datos estáticos persistentes, adjuntos, evidencias
y archivos de identidad local. El descriptor debe coincidir en el
manifest firmado, el manifest interno y `update-plan.json`; el publicador y el
stager verifican esas rutas antes de aceptar o extraer el paquete.

En este modo, `SOURCE_DIR` y `TRESEKO_UPDATE_SOURCE_RELEASE_DIR` deben apuntar
al mismo checkout público. El constructor lo comprueba antes de compilar o
crear archivos de salida y rechaza checkouts distintos; así el runtime por
componentes, el changelog y el árbol Compose completo no pueden representar
revisiones diferentes.

El manifest externo firmado incluye `components.source-release=true` cuando
declara `deployment.mode=complete-source`. Ese marcador queda fuera del
`manifest.json` interno para mantener compatible el paquete con el bootstrap
legado. El stager actual exige el marcador y activa el árbol completo; un
helper 1.0.6 lo rechaza como componente desconocido antes de tocar servicios,
evitando que instale solo los cinco runtimes y deje Compose viejo. El
constructor conserva además `packages/<version>/bootstrap/` con un segundo
paquete por componentes y su manifest firmado. Ese paquete tiene su propio
checksum, no incluye `source-release` ni plantillas `.env*.example`, y sirve
únicamente para instalar el bridge 1.0.7 con el helper 1.0.6. Así el helper
antiguo no ve rutas que su validador clasifica como estado local. Después del
bootstrap se usa el paquete y manifest principal desde Configuración →
Actualizaciones.

**Contenido no equivale a activación:** el coordinador valida, prepara y enruta
`complete-source` al instalador Compose atómico. Este instala el árbol público
versionado completo, incluidas aplicación, Dockerfiles, Compose, scripts y
documentación. Excluye datos/configuración local (`.env`, `backend/app/static`,
volúmenes, adjuntos, evidencias e identidad) y caches/dependencias generadas.
El instalador local 1.0.6 -> 1.0.7 se probó en Linux con rollback inducido,
reintento exitoso, migración, dato centinela persistido, servicios, versiones,
Plugin Runner y login. Esto valida el instalador Compose, no Configuración →
Actualizaciones.

**Compatibilidad 1.0.6:** su bridge instalado reconoce actualizaciones por
componentes, pero no `deployment.mode=complete-source`. La instalación de
helpers de 1.0.6 sí puede validar el paquete firmado y copiar su backend a una
nueva versión aislada. El paquete completo 1.0.7 contiene el bridge compatible,
por lo que la transición soportada para instalaciones coordinadas es:

1. Preparar el artefacto y manifest de bootstrap desde
   `packages/1.0.7/bootstrap/` en las rutas privadas
   `cache/<checksum_sha256>.tar.gz` y `manifest` declaradas por la configuración
   existente de HelperInstallation. El paquete principal conserva por separado
   el árbol completo y su manifest para la aplicación posterior desde la UI.
2. Ejecutar `scripts/bootstrap_update_helpers_docker.sh` con la imagen
   inmutable del helper 1.0.6, el Docker/socket/network ya configurados y el
   mismo archivo privado de configuración. El instalador 1.0.6 verifica la
   firma/checksum y publica los wrappers y el backend helper 1.0.7 mediante su
   journal y rollback; no detiene servicios ni aplica el Compose.
3. Comprobar el receipt de instalación `version=1.0.7`, que incluya
   `treseko-update-host-bridge`, y validar los mounts del proyecto y del estado
   privado con la configuración `atomic_compose`.
4. Aplicar el manifest principal (con `components.source-release=true`) desde
   Configuración → Actualizaciones. El backend
   1.0.6 ya delega la transacción coordinada al helper; el bridge 1.0.7
   prepara y aplica el árbol completo con el instalador Compose atómico.

La QA Linux ejecuta el instalador helper real 1.0.6 con el artefacto de
bootstrap por componentes: confirma que instala el bridge 1.0.7 en un prefijo
temporal sin iniciar servicios. Por separado, el smoke del constructor compara
SHA-256 de cada archivo del árbol `source-release` con los 2.022 archivos
elegibles del checkout, incluidos los seis ejemplos de configuración. Estas
comprobaciones no ejecutan un rollout real desde la UI ni habilitan por sí
solas la publicación. La actualización Compose
local 1.0.6 → 1.0.7 también pasó con rollback inducido, reintento, migración,
centinela de base de datos, servicios, Plugin Runner y login.

Esta secuencia aplica a instalaciones que ya operan en modo coordinado
y tienen el helper host configurado. Una instalación legacy sin coordinador no
puede reemplazar su Compose desde el updater embebido; para ella se requiere
migración administrada al coordinador o ejecutar el instalador Compose local
con `--update` / `-Update`. No ofrecer `complete-source` desde Configuración
hasta completar el bootstrap en cada instalación objetivo.

El constructor exige `TRESEKO_COMPLETE_SOURCE_ENABLED=true` y
`TRESEKO_BRIDGE_BOOTSTRAP_VERIFIED=true` para incluir 1.0.6 como origen; el
manifest firmado registra esa atestación. El publicador vuelve a comprobarla y
rechaza los artefactos por componentes o sin dicha marca. La prueba del
instalador Compose por sí sola no basta: validar por separado el bootstrap del
helper 1.0.6 y el flujo Configuración → Actualizaciones con el bridge instalado
en una instalación aislada, y comprobar que quedó activo el árbol
completo.

Los hooks son opcionales. Si no existen, el bootstrap usa las operaciones
estandar del producto.

## Construir La Actualizacion Community 1.0.2 -> 1.0.3

Desde la raiz del repositorio, el paquete de esta version se prepara con el
constructor reproducible. `PREVIOUS_VERSION` y `FROM_VERSIONS` deben declarar
explicitamente el origen soportado para que el manifest y `update-plan.json`
no queden ambiguos:

```bash
VERSION_VALUE=1.0.3 \
PREVIOUS_VERSION=1.0.2 \
FROM_VERSIONS=1.0.2 \
OUTPUT_ROOT="$PWD/.treseko/updates" \
TRESEKO_UPDATE_SKIP_BUILD=false \
bash scripts/build_update_package.sh
```

El artefacto queda en
`.treseko/updates/packages/1.0.3/treseko-update-v1.0.3.tar.gz`, junto con su
manifest e indice de canal. El constructor calcula SHA-256 y tamano con
Python para funcionar igual en macOS y Linux, y agrega el plan declarativo al
paquete. `COPYFILE_DISABLE=1` solo desactiva metadata AppleDouble del productor
macOS; es inocuo para el tar de Linux y no cambia el contenido consumido por
Docker. Antes de distribuirlo se deben ejecutar las pruebas de paquete,
upgrade/rollback y los gates de release; la preparacion del archivo no
equivale por si sola a una publicacion.

El constructor valida el arbol staged antes de crear el tar: rechaza directorios
`__MACOSX`, archivos AppleDouble `._*`, bytes nulos y sintaxis Python invalida.
La validacion previa a publicacion vuelve a inspeccionar todos los miembros del
`.tar.gz`, por lo que un archivo contaminado no puede pasar al Update Server.
El artefacto puede ser instalado por los flujos soportados en macOS, Linux y
Windows, incluidos sus destinos Docker; esto no declara soporte para ejecutar
`build_update_package.sh` nativamente en Windows. El productor requiere Bash,
Python y las herramientas de empaquetado disponibles en su entorno.

## Plan Declarativo

`update-plan.json` debe describir las operaciones especiales:

```json
{
  "version": "1.0.1",
  "previous_versions": ["1.0.0", "1.0.0-rc.1"],
  "components": {
    "backend": "replace",
    "frontend": "replace",
    "engine": "replace",
    "automation_worker": "replace",
    "plugin_runner": "replace"
  },
  "migrations": true,
  "restart": true,
  "health_checks": ["backend", "frontend", "engine", "worker", "database"],
  "rollback": {
    "enabled": true,
    "restore_database_on_migration_failure": true
  },
  "cleanup": {
    "keep_backups": 3,
    "delete_temporary_files_after_success": true
  }
}
```

`plugin_runner` es un componente de runtime opcional desde la topología de cada
instalación: el paquete lo incluye y valida cuando el manifest firmado lo declara,
pero una instalación 1.0.3 sin el perfil `plugins` no debe crearlo por accidente.
Cuando está declarado, el artefacto debe contener su `Dockerfile`, `package.json`
y `src/`; su receta debe estar incluida en `runtime-builds.json` y se construye,
activa y valida junto con los demás componentes versionados.
Si está activo, debe estar presente en el inventario, la preparación de imagen,
el participante de actualización y la verificación/rollback; si falta cualquiera
de esos enlaces, la operación debe bloquearse antes de detener servicios.

El plan no debe incluir secretos, tokens, passwords, claves privadas ni rutas
dependientes de una maquina concreta.

## Orden De Aplicacion Y Confirmacion De Version

La confirmacion de una actualizacion es lo ultimo que ocurre, nunca lo
primero. Mientras un componente no este en la release destino, la instalacion
no puede comunicar esa release ni dar la tarea por aplicada.

La ruta legacy (`backend/entrypoint.sh`) ejecuta en este orden:

```text
reemplazar componentes -> backup de BD -> migrar
-> convergencia de componentes -> confirmar VERSION instalada
-> escribir update-applied -> bajar mantenimiento -> arrancar backend
```

Invariantes obligatorios:

1. El `VERSION` instalado (`$APP_DIR/VERSION` y, si existe,
   `TRESEKO_VERSION_FILE`) se escribe recien despues de migrar y de converger.
   Si algo falla antes, el rollback restaura el `VERSION` anterior sin haberlo
   cambiado nunca.
2. `update-applied` y la baja de mantenimiento ocurren despues de confirmar
   `VERSION`; una actualizacion que no converge nunca llega a `update-applied`.
3. La convergencia es total para todo componente que el payload reescribio:
   Frontend (`VERSION` + `version.json` + marca de reinicio consumida), Engine
   (health en la version destino + marca consumida) y Automation Worker
   (`VERSION` del runtime siempre que el payload lo incluya; ademas la marca de
   reinicio consumida cuando existe `.runner-token`).
4. Si no converge en `TRESEKO_UPDATE_COMPONENT_CONVERGENCE_TIMEOUT_SECONDS`
   (180 s por defecto) el arranque falla, corre el rollback de codigo y deja
   `update-failed`.

Esto no convierte a la ruta legacy en una actualizacion atomica: conserva una
ventana con servicios reiniciandose de forma diferida. La atomicidad la
aportan `scripts/atomic_local_update.py` (ruta `--update` del instalador) y el
coordinador transaccional (`update_transaction.py`); el alcance de esta regla
es que la ruta legacy no publique nunca una release incompleta.

## Hooks Permitidos

### `pre-update`

Se ejecuta antes de reemplazar componentes. Puede crear directorios,
transformar configuraciones antiguas, preparar datos, comprobar dependencias,
preparar una compilacion excepcional o detener procesos controladamente.

Debe ser idempotente. Si falla, no se reemplaza ningun componente.

### `post-update`

Se ejecuta despues de copiar componentes y ejecutar migraciones. Puede regenerar
indices o assets, comprobar datos, limpiar temporales y registrar diagnosticos.
Los health checks del bootstrap tienen la decision final.

### `rollback`

Solo se usa para operaciones especiales que no pueda resolver el rollback
estandar. Debe restaurar unicamente los recursos que modifico el hook.

## Pantalla De Mantenimiento

Antes de una preparacion larga o compilacion, el bootstrap debe crear el
marcador de mantenimiento y conservar una pagina accesible. Los estados visibles
deben ser simples:

1. `Preparando la actualizacion...`
2. `Guardando una copia de seguridad...`
3. `Instalando componentes...`
4. `Verificando servicios...`
5. `Actualizacion completada.`

Los detalles tecnicos deben quedar en logs.

## Backups Y Limpieza

Antes de modificar la instalacion se deben crear backups de codigo, frontend,
Engine, Worker, migraciones y base de datos cuando corresponda. Los adjuntos,
evidencias y branding persistentes no deben eliminarse durante el reemplazo del
codigo.

Los temporales solo se eliminan despues de que los health checks pasen. Se
conservan los ultimos backups configurados para rollback y diagnostico.

Durante un rollback automatico, el backend debe bloquear temporalmente los
volumenes persistentes del Engine y del Worker antes de restaurarlos. Esto
evita que un reinicio diferido ejecute `npm ci` o vuelva a crear `node_modules`
mientras se copia el backup. El bloqueo debe quitarse unicamente cuando la
restauracion de codigo haya terminado; si la restauracion falla, debe quedar
registrado el fallo y conservarse el estado para diagnostico.

## Validaciones Obligatorias

```bash
python3 scripts/check_frontend_version_json.py
python3 scripts/test_frontend_entrypoint_version_guard.py
python3 scripts/test_update_upgrade_rollback.py
python3 scripts/check_update_system_readiness.py --skip-public-domains
scripts/validate_change.sh
```

Para la transaccion Docker completa tambien son obligatorias dos pruebas con
imagenes reales: una cadena de al menos dos releases consecutivas que confirme
Backend, Frontend, Engine, Automation Worker, `plugin_runner` cuando este
instalado y PostgreSQL; y un segundo salto fallido despues de un primer salto
confirmado, que debe restaurar exactamente las cinco imagenes del ultimo
release confirmado y conservar la revision de PostgreSQL. No alcanza con
probar solo el salto desde la version inicial ni con comprobar que las imagenes
se construyen.

Todos estos valores deben coincidir:

```text
manifest.version
VERSION
frontend/dist/VERSION
frontend/dist/version.json.version
engine/VERSION
engine/package.json.version
automation-worker/VERSION
automation-worker/package.json.version
```

El participante debe validar el paquete completo antes de alterar servicios:
el inventario de componentes firmado tiene que coincidir con el manifiesto
interno, `update-plan.json`, `runtime-builds.json` y las rutas reales del
archivo. Para cada componente declarado debe existir su runtime y Dockerfile;
si se declara Plugin Runner, también debe incluirse y entrar en el mismo
inventario. Las versiones origen (`from_versions` / `previous_versions`) deben
coincidir entre la firma, el manifiesto interno y el plan. Una diferencia debe
bloquear staging, aunque cada archivo individual sea válido. Los paquetes
históricos sin estos tres metadatos internos pueden seguir el camino de
compatibilidad legacy; un paquete nuevo no puede omitir parcialmente el
contrato.

Esta comprobación es independiente de probar la cadena completa: cada release
debe poder aplicarse desde sus orígenes declarados y el rollback debe restaurar
el último estado confirmado de todos los participantes, incluidos PostgreSQL
y Plugin Runner cuando esté activo. Así el mismo protocolo cubre, por ejemplo,
1.0.3 → 1.0.4 y después 1.0.4 → 1.0.5, sin asumir que el Frontend representa
por sí solo la versión instalada.

## Reglas Para Otra IA

Antes de construir un paquete, la IA debe:

1. Leer este documento y los contextos `docs/AI_*.md`.
2. Identificar version origen y destino.
3. Revisar cambios de esquema, archivos, configuracion y runtime.
4. Crear o actualizar `update-plan.json`.
5. Agregar hooks solo si el flujo estandar no alcanza.
6. Hacer cada hook idempotente y reversible.
7. No incluir secretos ni modificar infraestructura privada.
8. Construir con `scripts/build_update_package.sh`.
9. Validar paquete, rollback y release publico.
10. Documentar operaciones especiales en `CHANGELOG.md`.

No se debe afirmar que una actualizacion esta lista solo porque se creo el
`.tar.gz`; debe existir evidencia de validacion, health checks y rollback.
