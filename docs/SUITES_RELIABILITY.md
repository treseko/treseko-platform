# Organización y estados de suites

Las suites son carpetas compartidas del proyecto para organizar casos de los
cuatro formatos. El formato y la modalidad de ejecución pertenecen al caso.
Mover una carpeta dentro de su componente conserva sus identificadores y
relaciones; copiar crea nuevas carpetas y nuevas identidades de casos.

## Destinos y permisos

Crear, editar, mover o copiar exige una carpeta disponible y ancestros activos
sin archivar. Padre e hijo mantienen el mismo componente. La edición general
no cambia el componente de una suite ni migra sus casos a otro componente.
Las operaciones que afectan casos requieren permiso de edición de casos,
además del de suites. La API permite copiar solo la estructura con
`include_cases: false`.

## Archivado y restauración

Los archivados nuevos conservan los estados propios anteriores de las carpetas
y versiones de casos afectadas. Restaurar esa rama recupera esos estados:
un caso deprecado o una subsuite archivada previamente no se activa por accidente.
Repetir el mismo estado no vuelve a modificar los casos.

Los archivados antiguos no guardaron esos estados. Al restaurarlos se recupera
la carpeta seleccionada y se muestra un aviso para revisar y restaurar sus
subsuites y casos individualmente; el sistema no inventa estados anteriores.

El archivado bloquea casos asignados a builds activas o con ejecuciones/trabajos
pendientes o en curso. La eliminación conserva su carácter lógico y bloquea
referencias a builds activas y ejecuciones de los casos afectados. La copia
normal omite ramas archivadas y casos archivados; no copia ejecuciones.

## Guardado y orden

Las mutaciones de suites y su auditoría se confirman juntas. Crear/copiar
admite un `request_id` opcional: repetir una petición confirmada con el mismo
contenido devuelve la copia o carpeta existente. Cambiar el contenido requiere
otro identificador. Las escrituras de estructura se coordinan por proyecto
en PostgreSQL. El menú permite subir o bajar carpetas entre sus hermanas.

## Actualización

La migración `20261010_0074` agrega el registro interno de estados anteriores
(`suites.archive_snapshot`). Actualizar backend, frontend y migraciones juntos
mediante el procedimiento habitual de la instalación. Este registro no se
expone como configuración editable del usuario.
