# Recuperar avances de ejecución manual

La consola clásica conserva veredictos y observaciones parciales con **Guardar avance**. Este guardado no finaliza el caso ni lo cuenta como aprobado, fallido o bloqueado. Antes de cambiar de caso, volver al listado o cambiar de contexto, la consola guarda los cambios pendientes. Si el guardado falla, conserva el caso y sus cambios para reintentar. El navegador también avisa si se intenta cerrar o recargar con cambios sin guardar.

Al retomar un caso se restauran los estados y observaciones persistidos de cada paso, aunque el resultado general continúe pendiente. **Finalizar y guardar** conserva su función de registrar el resultado definitivo.

El historial distingue ausencia de resultados de un error de carga. Ante un error muestra un aviso, conserva los últimos datos disponibles y ofrece reintentar.

## Conversaciones manuales

Al preparar el run se congelan la definición, las variables y la conexión seleccionada. El contexto ejecutable se almacena cifrado; la evidencia visible conserva la política de redacción elegida. Editar el ambiente después no reemplaza la conexión ni los turnos de ese run.

Para aprobar una conversación deben enviarse todos sus turnos. Puede finalizarse antes con fallo o bloqueo si se escribe el motivo. Las métricas distinguen errores HTTP de fallos de expectativas y calculan P95 por rango más próximo.

La migración `20261010_0073` añade el contexto privado cifrado. Una ejecución histórica que solo conserve credenciales redactadas no puede reconstruirlas: la API indica que debe iniciarse una nueva ejecución. No se sustituyen por credenciales actuales silenciosamente.

## Progreso automatizado API

Las consultas de progreso se realizan secuencialmente. Al alcanzar un estado terminal se detienen. Si se pierde la conexión, el monitor indica que muestra el último estado conocido y permite reintentar; no inventa un resultado final.
