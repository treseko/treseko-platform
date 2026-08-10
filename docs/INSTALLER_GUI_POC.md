# Instalador gráfico experimental para Windows

`scripts/install_local_treseko_assisted.ps1` es una prueba de concepto para
evaluar una instalación guiada de Treseko Community.

La ventana permite:

- verificar Docker Desktop, Docker Compose, WSL2, el puerto elegido y el
  espacio disponible;
- detectar contenedores o instalaciones Treseko existentes, informar su
  proyecto/puertos/estado y version leyendo `/VERSION` del backend;
- agrupar los contenedores por proyecto, seleccionar una instalacion existente
  y actualizarla conservando `compose.production.env`, secretos y volumenes;
- crear un backup local de la configuracion antes de copiar archivos y ejecutar
  build, migraciones y health checks;
- solicitar confirmación antes de intentar instalar Docker Desktop mediante
  `winget`;
- solicitar la instalación de WSL cuando Windows todavía no lo tiene;
- mostrar los logs del proceso;
- ejecutar el instalador estable `install_local_treseko.ps1`;
- iniciar Docker Desktop cuando esté instalado pero detenido;
- reiniciar los servicios de Treseko desde la misma ventana;
- instalar con datos demo o recrear el entorno usando los parámetros recibidos.
- mostrar avisos visuales diferenciados para información, éxito, advertencia
  y error, incluidos permisos UAC, puertos ocupados y pasos críticos.

## Ejecución

Desde PowerShell en la raíz del repositorio:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install_local_treseko_assisted.ps1
```

Con datos demo:

```powershell
.\scripts\install_local_treseko_assisted.ps1 -WithDemo
```

Con otro puerto:

```powershell
.\scripts\install_local_treseko_assisted.ps1 -HttpPort 9096
```

## Alcance de esta prueba

Es una capa de evaluación y no reemplaza todavía al instalador estable. La
instalación real continúa siendo responsabilidad de
`install_local_treseko.ps1`, para evitar mantener dos implementaciones de la
lógica de secretos, Compose, migraciones y creación del administrador.

La instalación de Docker Desktop y WSL puede requerir UAC, aceptar licencias y
reiniciar Windows. El script no debe usarse para ocultar esos pasos: siempre
solicita confirmación y muestra el resultado.

El botón **Reiniciar Treseko** reinicia los servicios del `docker-compose` local
sin eliminar volúmenes ni regenerar secretos. Si WSL2 o una actualización de
Docker requiere reiniciar Windows, la aplicación debe pedir confirmación al
usuario; ese reinicio no se ejecuta silenciosamente.

Los mensajes críticos aparecen en una banda destacada sobre los botones y no
solo en el registro técnico. El registro conserva el detalle para diagnóstico,
mientras que la banda resume la acción que el usuario debe realizar.

## Próxima evaluación

1. Ejecutar la ventana en una máquina Windows limpia.
2. Probar Docker ya instalado y Docker ausente.
3. Probar WSL ausente y el escenario posterior al reinicio.
4. Probar un puerto ocupado por una instancia Treseko vieja y confirmar que se
   informa la instalación, se muestra su versión, se propone otro puerto y no
   se detiene nada solo.
5. Confirmar que la contraseña temporal se muestra una sola vez y queda fuera
   de los logs persistentes.
6. Seleccionar una instalación existente, comprobar que se informa la versión
   origen y actualizarla sin `down -v`, sin regenerar secretos y conservando
   los volúmenes.
7. Validar instalación limpia, instalación con demo y recuperación ante fallo.

## Actualizar una instalación existente

Después de **Verificar requisitos**, el selector muestra una entrada por cada
proyecto Compose Treseko detectado. La versión se obtiene del archivo
`/VERSION` del contenedor `backend`; si el contenedor no está disponible se
indica `N/D` y la actualización no debe considerarse validada hasta revisar
manualmente el proyecto.

El botón **Actualizar existente** requiere confirmación y:

1. guarda una copia de `compose.production.env` y de los secretos en
   `.treseko-local/installer-backups/<fecha>/`;
2. copia el paquete actual sin sobrescribir el archivo de entorno ni la carpeta
   de secretos;
3. ejecuta `build`, levanta `db` y `redis`, ejecuta el migrador y levanta
   `backend`, `engine` y `frontend`;
4. comprueba la versión del backend y muestra la ubicación del backup.

No ejecuta `down -v`, no borra volúmenes, no detiene otra instalación y no
regenera credenciales. Si una etapa falla, deja el backup informado para la
recuperación manual y no presenta la actualización como completada.
