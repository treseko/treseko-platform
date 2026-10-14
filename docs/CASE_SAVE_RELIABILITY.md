# Guardado y organización de casos

## Guardar y reintentar

El guardado del caso y su registro de auditoría se confirman juntos. Si esa
operación falla, no se conservan cambios parciales del caso. Un fallo posterior
de notificaciones no convierte el guardado confirmado en un error.

La vinculación de historias y referencias se completa después. Si falla, el
editor conserva el contenido e identifica la prueba ya creada. Reintentar
completa el guardado sobre esa misma prueba. Si se modifica la definición antes
de reintentar, se actualiza la prueba existente.

Las referencias de cada paso se reemplazan en una sola transacción. Se validan
los permisos, los adjuntos y el límite antes de reemplazar vínculos. Se conservan
las otras evidencias del paso; un fallo de escritura conserva sus referencias
anteriores. El conjunto de pasos puede requerir un reintento si se interrumpe
la sincronización entre pasos.

## Versiones y copias

Copiar una suite crea una prueba nueva por cada caso vigente. No convierte las
versiones antiguas del mismo caso en pruebas adicionales y excluye casos
archivados o inactivos. Las nuevas pruebas conservan definición, configuración,
pasos, referencias y trazabilidad, sin historial de ejecución ni asignación
automática a builds.

Editar metadatos desde una versión antigua devuelve un conflicto que indica
recargar la prueba. Las escrituras de una misma prueba se serializan para
asignar versiones sin repetir su número.

## Archivado

No se puede archivar una prueba asignada a una build activa. La regla se aplica
al cambio de estado, al guardado completo y al archivado de una suite con sus
sub-suites. Primero retira las pruebas de la build activa. El archivado y la
restauración mantienen un estado consistente para las versiones del caso.

## Integraciones que crean casos

`POST /casos/` admite `request_id`, un UUID opcional generado por el cliente para
un intento de creación. Repetir una petición con el mismo identificador y el
mismo usuario devuelve la prueba existente. Reutilizarlo con una definición o
proyecto diferente devuelve `409`; una creación distinta necesita otro UUID.
La identidad se conserva en la base de datos y no depende del navegador ni de
un caché de notificaciones. El editor genera y reutiliza este identificador
cuando reintenta una creación cuya respuesta no llegó.
