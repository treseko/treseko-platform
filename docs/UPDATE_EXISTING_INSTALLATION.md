# CLI de actualización de una instalación existente

Estado: **entregable de orquestación local; no es certificación de rollout ni
readiness de producción**.

Las releases cuyo manifest firmado declara `deployment.mode=complete-source`
se rechazan antes del plan de componentes mientras el host bridge no tenga
activada la transacción `atomic-compose`. No se debe interpretar una preparación
de runtimes por componentes como instalación del Compose completo. Esta
protección evita dejar la aplicación con versiones mezcladas. Las instalaciones
Compose locales sin ese coordinador deben actualizarse con el instalador atómico
de la release destino; la pantalla del updater no tiene acceso al Compose del
host. Este documento describe el contrato y no certifica un rollout de
producción.

## Flujo

Usa la configuración privada combinada del controller (`participants`,
`runtime_hosts`, órdenes, gates e `installation_topology`) y un manifest firmado.
El instalador de helpers ya existe como
componente separado; este wrapper no lo ejecuta, no configura SSH y no crea
automáticamente el bootstrap/protocolo legacy completo de 1.0.2.

Un ejemplo completo, deliberadamente no plug-and-play, está en
[`docs/examples/update-installation-controller.example.json`](examples/update-installation-controller.example.json).
Contiene los cinco componentes obligatorios y tres participantes remotos
(Engine, Worker y PostgreSQL): Engine y Worker usan el alias SSH de runtime y
PostgreSQL usa un alias SSH separado. Incluye placeholders de identidades,
checksum y rutas privadas, y no contiene secretos. El ejemplo se consume por
`update_existing_installation`; no es un JSON directo para el CLI genérico
porque `installation_topology` es una sección wrapper que se valida antes de
proyectar la configuración del controller.
Su `quiesce_order` es explícitamente `worker -> engine -> backend -> frontend
-> postgres`: PostgreSQL se drena al final porque el participante PG requiere
que Worker y Engine ya estén quiesced.

La topología obliga a cubrir Backend, Frontend, Engine, Automation Worker y
PostgreSQL; `plugin_runner` se declara y actualiza cuando está instalado. El
paquete no es una actualización exclusiva de la UI: cada participante se
prepara, aplica, verifica y activa dentro de la misma transacción coordinada.
Las versiones futuras siguen el mismo flujo por salto (por ejemplo,
1.0.4→1.0.5→1.0.6). Al construir cada paquete, `FROM_VERSIONS` debe declarar
explícitamente las versiones de origen que ese paquete firmado admite; el
controller no convierte una versión arbitraria en una actualización válida.

```text
plan    -> validación readonly de participantes, gates y runtime_hosts
prepare -> plan -> distribute del archivo local firmado -> prepare-runtimes
apply   -> sólo con prepare completa y mismas identidades -> run
resume  -> sólo journal con apply intentado -> run de reconciliación
status  -> lectura de journals locales
```

Ejemplo:

```bash
scripts/update_existing_installation.sh plan \
  --config /etc/treseko/update/controller.json \
  --manifest /var/lib/treseko/update/manifest.json \
  --transaction tx-1

scripts/update_existing_installation.sh prepare \
  --config /etc/treseko/update/controller.json \
  --manifest /var/lib/treseko/update/manifest.json \
  --package /var/lib/treseko/update/release.tar.gz \
  --transaction tx-1

scripts/update_existing_installation.sh apply \
  --config /etc/treseko/update/controller.json \
  --manifest /var/lib/treseko/update/manifest.json \
  --transaction tx-1

scripts/update_existing_installation.sh resume \
  --config /etc/treseko/update/controller.json \
  --manifest /var/lib/treseko/update/manifest.json \
  --transaction tx-1

scripts/update_existing_installation.sh status \
  --config /etc/treseko/update/controller.json \
  --transaction tx-1
```

`apply` y `resume` no aceptan paquete. `status` sólo lee el journal namespaced
en `<controller-directory>/existing-installation/`.

Para un host sin Python operador existe `scripts/update_existing_installation_docker.sh`.
Ejecuta el mismo módulo CLI en la imagen trusted, con launcher privado y mounts
explícitos; no instala un virtualenv ni monta el workspace. El ejemplo
parametrizado está en `docs/UPDATE_EXISTING_INSTALLATION_DOCKER.md` y no es
runnable hasta sustituir sus placeholders.

Cuando el gate de ingress usa `callback_drain: true`, el flujo autenticado es:

```text
acquire -> callback drain autenticado -> workers/Engine quiesced
        -> seal/assert_sealed -> backups/snapshot -> apply/verify
        -> activate global -> release del gate
```

El bind `control` del ejemplo (`/var/lib/treseko-update/gates/ingress`) debe
existir previamente en el host Docker y corresponder al bind real de HTML del
proxy Nginx independiente, con el `frontend/nginx.conf` y las rutas de
callback ya instalados. El controller no crea el directorio, el bind, el
proxy ni ese archivo de configuración; tampoco debe asumirse que una ruta
local del controller es el filesystem de un host remoto. `callback_drain`
conserva las rutas POST autenticadas durante el drenaje, y `seal` debe
confirmarse antes de tomar el backup. El gate sólo se libera después de que
todos los participantes completan `activate` y la decisión global está tomada.

## Precondiciones y seguridad

- El package local debe estar firmado y coincidir con el manifest; `distribute`
  valida checksum/tamaño mediante el controller.
- El cache runtime debe estar previamente distribuido o preinstalado donde lo
  requiera cada helper. El wrapper no inventa transferencia adicional.
- `prepare` no hace quiesce, apply, start ni activate.
- `apply` valida nuevamente plan, gates e inventario antes de persistir la
  intención de aplicación. Si falta un host, componente, gate o identidad
  coincidente, no llama `run`.
- El journal fija hashes de configuración, release y transaction, y persiste
  intención antes de cada llamada mutante. Los errores JSON son genéricos y no
  guardan secretos ni diagnósticos remotos.
- Un ACK perdido durante `apply` deja `apply_uncertain`; `resume` llama sólo
  `run` con la misma transacción. No redistribuye, reconstruye ni reinicia el
  proceso desde cero.
- Si una fase falla después de comenzar la transacción, el controller conserva
  la evidencia y ejecuta rollback automático antes de reabrir la admisión cuando
  corresponde. No existe un comando de rollback manual en este CLI. Un estado
  `recovery_pending` requiere corregir la causa operativa y ejecutar `resume`
  con el mismo transaction; no se debe iniciar otra transacción ni restaurar a
  mano.

## Prerrequisitos del operador

El ejemplo no es una configuración plug-and-play. Antes de usarlo, el operador
debe sustituir los placeholders y disponer de:

- helpers instalados en las rutas absolutas configuradas;
- ejecutable, permisos y directorios privados del controller y de cada host;
- configuración SSH del operador con `known_hosts` estricto, alias válidos y
  acceso probado fuera de este CLI;
- conectividad SSH real a los tres participantes remotos (Engine, Worker y
  PostgreSQL), con los dos alias declarados y helpers fijos instalados;
- `helper_identity` SHA-256 real para cada runtime host;
- gates, rutas privadas, cache runtime y archivos de configuración existentes;
- para `ai-queue-local`, un `database_url_file` privado, propiedad del operador,
  con una URL `postgresql+asyncpg://...` válida y conectividad TCP real desde
  el controlador hacia la base PostgreSQL indicada. El alias SSH del host DB no
  demuestra por sí mismo esa conectividad ni sustituye la red PostgreSQL;
- para `docker-host-bind`, un contenedor/proxy independiente ya ejecutándose,
  con labels/proyecto/servicio/ID verificados, bind HTML exacto y directorio de
  control privado sin escritura de grupo/otros;
- manifest firmado y paquete local que coincidan exactamente.

Nunca se escriben credenciales inline en JSON, comandos o documentación. El
gate `ai-queue-local` pausa el scheduler interno mediante la base PostgreSQL y
permanece cerrado hasta que todos los participantes completan `activate`; así
el backend no puede emitir jobs antes de que Engine y Worker estén disponibles.

El flujo documentado no contacta hosts durante `plan` salvo la resolución local
de configuración SSH (`ssh -G`); no ejecuta `apply` como parte de la validación
del ejemplo. Sigue siendo un ejemplo privado no plug-and-play: requiere
bootstrap, proxy/bind, helpers, configuración SSH y conectividad PostgreSQL
preparados por el operador.

## Límites actuales

El bootstrap/protocolo legacy completo de instalaciones 1.0.2, el despliegue
multihost real y el rollout productivo siguen fuera de este entregable. La
configuración de preparación se genera mediante `runtime_preparation_config`;
este CLI no edita manualmente SHA ni parámetros del adapter PostgreSQL.

Los contratos internos de PostgreSQL, admisión backend y coordinación se
aplican en el runtime, pero no convierten este flujo en un rollout certificado.
Se requiere revisión y pruebas de entorno antes de cualquier uso operativo.
