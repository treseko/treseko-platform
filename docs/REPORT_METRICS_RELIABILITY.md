# Cálculo y actualización de reportes

Los reportes calculan casos únicos por su identidad lógica, dentro de la build
seleccionada. Repetir una prueba no aumenta el número de casos asignados.

## Resultados y cobertura

Se toma el último intento iniciado de cada caso. Solo `PASO`, `FALLO` y
`BLOQUEADO` cuentan como resultados finales. Un intento `EJECUTANDO_AI` permanece
pendiente para cobertura y porcentajes, aunque exista un resultado anterior.
Un intento que aún está `SIN_CORRER` no reemplaza el resultado de uno iniciado.
La tendencia entre builds aplica la misma regla.

La matriz de formato y modo cuenta intentos terminados; el resumen cuenta casos
únicos. Sus totales pueden diferir cuando se repite un caso. La telemetría API
incluye todos los intentos terminados de la build, conservando las versiones
ejecutadas aunque una versión posterior esté asignada actualmente.

## Latencias

El P95 usa rango más próximo: ordenar las muestras válidas y tomar la posición
`ceil(0.95 * n)`, comenzando en 1. No se calcula como máximo ni promedio de
percentiles individuales. API reúne las respuestas de todos los intentos
terminados; Chatbot reúne los turnos del último intento por caso si terminó.
Se conservan latencias de cero; valores ausentes, negativos o no finitos se
excluyen. Sin muestras, el campo devuelve cero y no demuestra una medición.

## Refresco y exportaciones

Una respuesta anterior no puede reemplazar una búsqueda más reciente ni las
métricas de otro proyecto o build. Los errores de solicitudes obsoletas también
se descartan. Un fallo muestra un aviso con reintento; si hay datos anteriores,
la pantalla los identifica como tales. El reintento correcto recupera el reporte.

Las exportaciones locales PDF y XLS comparten una tabla HTML de casos con una
única fila por caso. XLS es un documento HTML compatible con hojas de cálculo,
no un libro XLSX. La descarga requiere el permiso de exportación vigente.

## Detalle, historial compartido y contexto

El detalle permite recorrer todos los bugs, fallos y evidencias con “Mostrar más” y un contador de registros visibles. Los filtros de suite, prioridad, estado, responsable y modo usan el contexto persistido de cada evidencia. El filtro de bugs distingue abiertos, cerrados, con vínculos y sin vínculos; una evidencia hereda los vínculos de su caso. El estado de la evidencia (completa/faltante) se filtra por separado del resultado del caso.

El historial compartido conserva datos del mismo contexto si falla, muestra un aviso y permite reintentar. Cambiar proyecto, build o permisos invalida respuestas anteriores y limpia enlaces/modal/decisión. Compartir, revocar y las acciones de riesgo también verifican el contexto al terminar. La comparación elige un predecesor cronológico real del componente, incluso para builds fuera de las diez más recientes.

## Métricas conversacionales y tiempos

Los errores HTTP se calculan desde los códigos observados de los turnos; una expectativa fallida con HTTP 200 no cuenta como error de transporte. Las aserciones por turno manuales y el resumen automatizado representan una misma fuente y no se suman dos veces. Las expectativas estructuradas se conservan como JSON legible y escapado en PDF/XLS.

latency_sample_count distingue una latencia medida en cero de la ausencia de muestras; la UI muestra “Sin medición” cuando no existen muestras. El esfuerzo acumulado suma todos los intentos; el promedio por caso conserva ese esfuerzo por caso único. El promedio por intento considera solo intentos terminados y es la base de la estimación restante. Sin intentos terminados, no hay estimación. PDF/XLS exportan el reporte completo de la build, como indica el control de exportación; los filtros de detalle no se aplican.
