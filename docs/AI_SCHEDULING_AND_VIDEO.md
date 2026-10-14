# Programación IA y evidencia de video

## Ejecución desde el servidor

El botón de ejecución IA envía el lote completo mediante `POST /ai-missions/`.
La creación del run, sus snapshots y todos los jobs IA se guarda en una misma
transacción. El navegador puede cerrarse después de recibir la confirmación.

El botón **Programar** usa `POST /ai-schedules/`. Guarda proyecto, build, IDs de
casos, usuario y fecha UTC en `ai_scheduled_missions`. La fecha debe ser futura
e incluir zona horaria. Esta interfaz programa una ejecución única, no CRON.

El backend consulta programaciones vencidas cada dos segundos y las convierte
en runs y jobs persistentes. Tras un reinicio recupera las pendientes, incluyendo
las fechas vencidas durante la interrupción, sin necesitar una sesión del
navegador. PostgreSQL coordina los consumidores para evitar duplicar el lote.
El servidor y el Engine deben estar disponibles para ejecutar, o recuperarse.

Antes de iniciar se vuelven a comprobar usuario activo, permisos, acceso al
proyecto, plan/cuota, build activa y casos asignados. Una selección no válida
queda bloqueada; no se cambia automáticamente a otra build o versión de caso.
La pausa de actualizaciones también pausa la admisión de programaciones.

Se consultan con `GET /proyectos/{id}/ai-schedules/`; se cancelan con
`DELETE /ai-schedules/{id}` mientras sigan pendientes. La ventana de programación
muestra estas filas persistentes después de recargar la aplicación.

Aplicar las migraciones hasta `20261009_0069` antes de iniciar el backend actualizado.

## Video de las ejecuciones IA con navegador

El Engine graba las páginas del contexto Playwright en WebM a 960 × 540.
Finaliza los archivos al cerrar el contexto tanto en éxito como en error.
Las ventanas secundarias tienen videos separados dentro de la misma ejecución.
El reporte guarda referencias y ofrece reproducción; no almacena video base64
en la base de datos ni en el reporte JSON.

El endpoint `/ai-videos/{id}/` requiere autenticación, permiso de Motor IA y
acceso al proyecto. El backend consulta al Engine mediante su token interno.
Admite rangos HTTP y responde con `Cache-Control: private, no-store`.
Los archivos no se publican en un directorio estático abierto.

La opción **Grabar video como evidencia** está en la ventana previa a ejecutar,
en la programación IA y en el editor de dry run. Está activada inicialmente;
se puede desactivar por lote. La elección de la programación queda persistida.
El Automation Worker graba Playwright Test y su función Playwright en éxito y
error. Los videos normales usan los adjuntos protegidos existentes. El worker
conserva archivos completos de más de 10 MiB. Sus videos temporales se guardan
en el backend, en `AUTOMATION_RESULT_UPLOAD_DIR/temporary-videos`, con caducidad
de 24 horas y borrado autenticado. Los dry runs IA mantienen su almacenamiento
y política de cuotas del Engine.

El resultado de dry run muestra un reproductor con **Eliminar video**. Cerrar
el resultado conserva el archivo hasta su caducidad. Eliminar requiere permiso
de edición de scripts y proyecto, borra todos los videos de esa referencia en
el servidor y luego elimina su registro; si falla permite reintentar.

API, Chatbot y ejecuciones manuales no pasan por este grabador: conservan sus
contratos de evidencia existentes. Los runners externos y frameworks distintos de Playwright
no adquieren grabación automática con este cambio.

## Conservación y espacio

| Variable del Engine | Predeterminado | Uso |
|---|---:|---|
| `AI_VIDEO_DIR` | `videos` | Directorio privado; Docker usa `/engine/videos` en el volumen persistente. |
| `AI_DRY_RUN_VIDEO_TTL_HOURS` | 24 | Caducidad de videos de dry run desde la finalización. |
| `AI_DRY_RUN_VIDEO_MAX_MB` | 512 | Cuota total de videos temporales finalizados. |
| `AI_VIDEO_REGULAR_MAX_MB` | 10240 | Límite de admisión de nuevas grabaciones normales. |
| `AI_VIDEO_DISK_RESERVE_MB` | 512 | Reserva de disco antes de comenzar una grabación. |

La limpieza corre cada minuto y al comenzar/finalizar grabaciones. Elimina
temporales vencidos y, si exceden su cuota, los más antiguos. Las grabaciones
activas quedan excluidas. Los archivos incompletos abandonados tras un reinicio
se limpian después de una hora.

Los videos normales no caducan con la política de dry run. Al alcanzar su cuota
o faltar espacio se omite una nueva grabación; la ejecución sigue funcionando.
La referencia solo se conserva si los archivos finalizados suman como máximo
128 MiB. `recording_status=UNAVAILABLE` indica que no se pudo conservar video.
Las cuotas de archivos finalizados no constituyen una cuota del filesystem:
durante una grabación puede haber uso transitorio adicional. Para un límite
físico estricto usar una cuota de almacenamiento del volumen.

La caducidad o eliminación por cuota puede hacer que un video temporal deje de
estar disponible antes de volver a abrir su reporte. No se restaura desde el
JSON. El borrado automático conserva las evidencias normales y los datos QA.

## Validación

Las pruebas incluyen API y PostgreSQL desechable, recuperación desde nuevos
procesos con el cliente cerrado, consumidores concurrentes, cancelación,
permisos, fechas, build cerrada y proxy de video con autenticación/caducidad.
El smoke de Chromium genera WebM y verifica su carga en un reproductor.

[Grabación oficial de Playwright](https://playwright.dev/docs/videos).

## Lotes desde el selector de ejecución

El selector de pruebas clásicas y conversacionales envía una sola solicitud a
`POST /execution-batches/`. La creación del run, sus snapshots y todos sus jobs
se confirma en una única transacción. Si falla la preparación de un caso, no
se conserva un run parcial ni sus jobs. Se conservan el ambiente, dataset y
`record_video`; la modalidad conversacional AUTOMATIZADA usa su evaluación
fija y la modalidad IA conserva su estrategia IA.

Después de la confirmación, el navegador solo consulta el estado. El scheduler
IA o los workers dedicados ejecutan la cola persistida sin depender de esa
sesión. Las pruebas API mantienen su runner declarativo; PERFORMANCE no se
admite en este endpoint. El lote admite hasta 500 casos.

## Datos completos de automatización

Los nuevos trabajos conservan los valores originales de variables, datasets,
solicitudes, respuestas, logs y evidencias. Los payloads del worker se cifran
al persistirlos y se descifran al reclamar el trabajo o consultar una vista
con autorización. La política congelada `complete_data` conserva también
los informes de IA sin reemplazar datos de prueba.

Los resultados mayores de 768 KiB se entregan por fragmentos con checksum y
reanudación. El backend ofrece una descarga autenticada del resultado completo
y excluye el token interno del lease. El worker conserva su resultado pendiente
en `/worker/.state/result-spool` hasta recibir confirmación. Las actualizaciones
y recreaciones del contenedor preservan ese estado.

Si no hay espacio para guardar toda la evidencia, la entrega falla y se conserva
para reintentar; no se recorta para aparentar éxito. Los valores ya reemplazados
en ejecuciones históricas no pueden reconstruirse desde el texto redactado.
