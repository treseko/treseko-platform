# Actualizar un Engine remoto

Treseko distribuye la aplicación, el Engine, Automation Worker y Plugin Runner
en un único paquete OTA firmado. No necesitas descargar un OTA separado para
cada componente.

## Engine en el mismo host que la plataforma

En una instalación Docker de un solo host, el actualizador de la plataforma
aplica los componentes incluidos en el paquete y ejecuta las comprobaciones de
salud configuradas. Consulta [Actualizar una instalación existente](UPDATE_EXISTING_INSTALLATION_DOCKER.md)
para los pasos y requisitos de ese flujo.

## Engine en otro host

Un Engine con el agente de actualización consulta al backend usando la
configuración de autenticación instalada, descarga su componente, prepara una
release local y la activa cuando no hay trabajos activos. El Engine informa su
versión mediante su endpoint de salud. Cada Engine remoto debe comprobarse por
separado; completar la actualización del backend no prueba que otros hosts hayan
convergido.

### Engine Linux con systemd anterior al agente

El OTA incluye `scripts/bootstrap_remote_component_from_ota.sh` para instalar
el Engine desde el mismo archivo durante una ventana de mantenimiento:

```bash
sudo bash scripts/bootstrap_remote_component_from_ota.sh \
  --ota /ruta/treseko-update-v1.0.8.tar.gz \
  --component engine \
  --runtime-root /ruta/actual/del/engine \
  --service treseko-engine
```

### Engine en Docker local sobre Linux

Ejecuta el bootstrap Docker en el host que administra el contenedor y el
volumen persistente:

```bash
sudo bash scripts/bootstrap_remote_docker_component_from_ota.sh \
  --ota /ruta/treseko-update-v1.0.8.tar.gz \
  --component engine \
  --container nombre-del-contenedor-engine \
  --maintenance-window-confirmed
```

Usa los argumentos, requisitos y versión de script incluidos en tu paquete OTA.
Confirma la ruta del runtime o el contenedor y el almacenamiento persistente
antes de aplicar el cambio. En particular, el bootstrap Docker para Engines
antiguos requiere una ventana de mantenimiento porque puede detener el
contenedor mientras activa la nueva release.

Los bootstraps actualizan el componente en el host existente; no reinstalan la
plataforma ni requieren otro archivo OTA. No asumas que cubren Docker remoto vía
context, hosts desconectados u otros sistemas operativos.

## Verificación y recuperación

1. Comprueba que el servicio o contenedor esté activo.
2. Consulta `/health` en el Engine y verifica la versión informada.
3. Comprueba en Treseko que el Engine volvió a estar disponible para trabajos.
4. Revisa logs si el proceso no arranca o no informa la versión esperada.

No consideres terminada la actualización solo porque el backend se actualizó.
Conserva el runtime anterior y los datos persistentes hasta verificar el Engine
en cada host remoto.
