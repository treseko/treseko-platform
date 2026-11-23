# Actualizar Automation Workers remotos

Esta guía explica cómo mantener un Automation Worker instalado en otro host en
la misma versión de Treseko. La aplicación, el Engine, el Automation Worker y el
Plugin Runner se distribuyen juntos en el paquete OTA de la plataforma; no hay
un paquete de descarga independiente para cada componente.

## Cómo funciona

Los Workers que incluyen el cliente de actualización consultan al backend antes
de pedir nuevos trabajos. Si el servidor requiere una versión o build distinta,
el Worker espera a que termine el trabajo activo y se resuelvan los resultados
pendientes. Después descarga el paquete de componente mediante la API
autenticada, verifica los datos de integridad disponibles, prepara una release
versionada y cambia a ella. El Worker informa su versión en el siguiente
heartbeat. Mientras un Worker reporte una versión incompatible, el backend no
le asigna nuevos trabajos.

Cada Worker remoto se actualiza por separado. El estado actualizado del backend
no confirma que otros hosts hayan terminado; revisa la versión y el heartbeat
de cada Worker en Treseko.

## Workers anteriores al actualizador

Un Worker antiguo no puede iniciar su propia actualización. Para hosts Linux
con systemd o Docker local, el OTA incluye herramientas de bootstrap que
instalan el componente desde el mismo archivo. Ejecuta el bootstrap en el host
donde corre el Worker y durante una ventana de mantenimiento:

```bash
sudo bash scripts/bootstrap_remote_component_from_ota.sh \
  --ota /ruta/treseko-update-v1.0.8.tar.gz \
  --component automation-worker \
  --runtime-root /ruta/actual/del/worker \
  --service treseko-worker \
  --api-base https://treseko.example/api \
  --runner-token-file /ruta/persistente/.runner-token
```

Para un Worker dentro de Docker en Linux, utiliza el bootstrap Docker desde el
host que administra el contenedor y su volumen persistente:

```bash
sudo bash scripts/bootstrap_remote_docker_component_from_ota.sh \
  --ota /ruta/treseko-update-v1.0.8.tar.gz \
  --component automation-worker \
  --container nombre-del-contenedor-worker \
  --api-base https://treseko.example/api \
  --runner-token-file /ruta/persistente/.runner-token
```

Usa la versión y los argumentos que correspondan al OTA y a tu instalación.
Antes de ejecutarlo, confirma la documentación de ayuda del script incluido en
ese paquete, la ruta real del runtime, el nombre del servicio/contenedor y que
la organización y el token configurados sean los correctos. El host necesita
acceso al backend y al registry de paquetes, además de los requisitos indicados
por el script. El bootstrap de systemd y Docker local cubre Linux; no presupone
que el servidor pueda administrar remotamente un host desconectado.

Los bootstraps preparan una release versionada y conservan los datos persistentes
del Worker, incluidos su identidad y credencial. La actualización de código no
es un nuevo vínculo. Si un token fue revocado, completa primero el pairing
aprobado desde Treseko; el vínculo por sí solo no instala código.

## Casos que requieren atención

- **Worker desconectado:** no puede consultar ni descargar una actualización.
  Al volver a conectarse, comprueba su heartbeat y versión antes de asignarle
  trabajo.
- **Varios Workers o hosts:** valida cada identidad por separado. La plataforma
  no declara una flota convergida hasta que todos los Workers esperados reporten
  la versión objetivo.
- **Instalación ocupada:** espera a que terminen los trabajos y entregas
  pendientes antes de cambiar de release.
- **Error de descarga, integridad, dependencias o reinicio:** revisa los logs del
  Worker y del servicio supervisor. No consideres completada la actualización
  hasta observar un heartbeat válido con la versión esperada.
- **Docker remoto o sistemas distintos de Linux:** esta guía no garantiza su
  actualización automática. Usa el mecanismo de administración de ese host y
  valida el resultado antes de reanudar ejecuciones.

## Comprobación posterior

1. Comprueba que el proceso y el servicio/contenedor estén activos.
2. Confirma en Treseko el heartbeat reciente, la versión del producto y el
   estado del Worker.
3. Ejecuta un caso de verificación apropiado para ese Worker.
4. Repite la comprobación en cada host y Worker independiente.

No borres el runtime anterior ni sus datos persistentes hasta confirmar que el
Worker nuevo acepta trabajos y que no quedan resultados por entregar.
