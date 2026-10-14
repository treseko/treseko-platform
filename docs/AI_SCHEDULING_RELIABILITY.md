# Programación de ejecuciones IA

La programación de fecha y hora es una misión de una sola ejecución. La UI
convierte la fecha local a un instante UTC y la envía inmediatamente a
`POST /ai-schedules/`. La base de datos conserva proyecto, build, casos,
usuario, fecha y estado. Cerrar el navegador no cancela ni dispara la misión.

El bucle del backend consulta las misiones vencidas y crea el TestRun y sus
trabajos en una transacción. El bloqueo PostgreSQL y los bloqueos de filas
impiden que dos procesos creen ejecuciones duplicadas de la misma misión.
Una misión vencida durante una interrupción se recupera cuando el backend
vuelve a funcionar. La hora programada indica cuándo puede entrar a la cola;
la ejecución efectiva depende de la disponibilidad y capacidad del motor.

## Validaciones y recuperación

- Fecha futura con zona horaria, nombre no vacío y al menos un caso.
- Usuario activo, permisos de ejecución/programación y acceso al proyecto.
- Build activa, casos activos y asignados a esa build. Los conversacionales
  no se mezclan con otros formatos.
- Permisos, build, casos y cuotas se vuelven a comprobar al lanzar la misión.
- Un rechazo de permisos, plan o selección deja la misión `BLOCKED`.
- HTTP 408, 429 y 5xx dejan la misión `PENDING` para reintento; el error temporal
  se muestra y se limpia cuando la misión entra correctamente en cola.
- Los errores inesperados de base o infraestructura revierten la transacción:
  no conservan una ejecución parcial ni consumen definitivamente la misión.
- La limpieza de videos, las misiones vencidas y la cola tienen manejo de
  errores independiente. Un fallo de limpieza no interrumpe la programación.
- Una build con programaciones registradas no se elimina, porque eso borraría
  las misiones por cascada. Se puede ocultar para conservar su historial.

## Interfaz

Los botones de envío se deshabilitan mientras la solicitud está pendiente y
un bloqueo compartido evita el doble envío durante los rerenders. Si programar
falla, el formulario conserva selección, nombre y fecha para corregir o reintentar.

La lista se consulta nuevamente en el servidor. Las respuestas antiguas no
restauran una misión cancelada ni muestran programaciones de otro proyecto.
Solo las misiones `PENDING` pueden cancelarse. Si el backend ya la puso en cola,
la cancelación de la programación devuelve conflicto y no elimina la ejecución.

La prevención de doble clic no es una clave de idempotencia persistente:
si se pierde la respuesta tras guardar una misión, conviene comprobar la lista
antes de crear otra. Este flujo no incorpora recurrencia cron.
