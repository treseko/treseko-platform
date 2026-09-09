# Guía de operación del Motor IA

El **Motor IA** concentra las tareas asistidas por IA y su seguimiento. La disponibilidad depende de la configuración de la instancia, los permisos y las capacidades habilitadas.

## Qué puede hacer y qué no se debe asumir

El motor puede participar en generación de historias/casos, ejecución asistida
y evaluación conversacional. Cada tarea tiene un workflow, un snapshot y una
salida propios. Que un modelo esté disponible no certifica por sí solo una
ejecución API, conversacional o clásica completa.

## Antes de usarlo

1. Confirmá que el proveedor, modelo o workflow requerido esté configurado en **Configuración → Pruebas con IA**.
2. Seleccioná el proyecto y la build sobre los que querés trabajar.
3. Verificá que los datos enviados no incluyan secretos ni información que no deba procesarse por el proveedor elegido.

## Uso responsable

La IA puede asistir en generación, análisis o ejecución, pero no reemplaza la revisión de QA. Antes de guardar una sugerencia o usar un resultado en una decisión de calidad:

- verificá el caso, los datos y el resultado esperado;
- confirmá la evidencia y los pasos reportados;
- revisá errores, límites o estado de la tarea en el monitor;
- documentá la decisión humana cuando el flujo lo requiera.

## Si una tarea falla

Revisá el mensaje mostrado, la configuración del proveedor y los límites de la instancia. Si la tarea corresponde a una ejecución, consultá también [Historial Runs](RUN_HISTORY_GUIDE.md). No repitas en masa una operación hasta entender la causa.

Para la configuración técnica, consultá [Configuración del Motor IA](AI_ENGINE_CONFIG.md).

Los resultados IA requieren revisión humana antes de crear un bug o aprobar
una build. En Chatbot, completá primero la conexión, los turnos y las
expectativas; la evaluación no debe inventar evidencia que el endpoint no haya
devuelto.
