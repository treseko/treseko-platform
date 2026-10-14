# Historial de Ejecuciones

El historial permite revisar runs sin iniciar nuevas pruebas. Los filtros se
aplican con **Buscar** o Enter y se conservan al actualizar. La URL conserva
los filtros, la página y el detalle seleccionado para volver al mismo contexto.
**Limpiar filtros** vuelve a la primera página.

Elegí 25, 50 o 100 resultados por página; el total corresponde a los filtros
aplicados. Si falla la carga, se informa el error, se conservan los resultados
anteriores y **Reintentar** vuelve a cargar la misma búsqueda.

En el detalle se muestran las observaciones generales, los pasos clásicos,
las solicitudes, respuestas y validaciones API o los turnos y la evaluación
conversacional, según el formato persistido del caso. Una conversación manual
también conserva su evidencia. Estos datos y configuraciones son de solo lectura.
La política congelada de evidencia controla la redacción de datos sensibles.

La lista muestra hasta tres evidencias de vista previa y el número restante abre
el detalle. El filtro **Sin evidencia** exige que el run completo carezca de
capturas, adjuntos y resultados estructurados API o conversacionales.

El acceso usa `historial.ver`, `historial.detalle` y `historial.evidencias`, además
de la membresía del proyecto. Poder leer el historial no concede permiso para
ejecutar pruebas. En móvil se muestran tarjetas con el resultado y el detalle.

Ejemplo: filtrá **FALLO**, buscá, abrí el detalle y cerralo. Una actualización
mantiene la búsqueda. Cambiar el tamaño de página vuelve al inicio de esos
resultados; una respuesta tardía de una búsqueda anterior no los reemplaza.


**Estado del caso** busca runs que contienen al menos un caso con ese estado.
**Resultado del run** filtra el resultado global: mientras haya casos IA
ejecutándose indica **En curso**; después prioriza fallos, bloqueos, aprobados
y sin correr. Ambos filtros pueden combinarse. Un run con un caso aprobado y
otro fallido coincide con Estado del caso PASO, pero no con Resultado del run
PASO. El contador de casos en ejecución se muestra separado de Sin correr.

Los filtros aplicados se muestran como etiquetas y pueden quitarse de a uno.
Contraer los avanzados no oculta esas etiquetas; al restaurar la URL con filtros
avanzados se abre el panel. Las capturas guardadas como URL también aparecen
en el detalle, sin duplicarse con adjuntos. El detalle API muestra el tiempo de
cada solicitud y el total de la ejecución por separado. Crear bugs desde un
informe Chatbot requiere permisos de lectura/creación de bugs y edición del
proyecto; el servidor mantiene la validación al enviar la acción.
