# Configuración del Motor IA

El Motor IA ayuda a generar historias y casos, y a ejecutar pruebas asistidas.
Esta guía explica qué configura un administrador desde Treseko y qué revisar
antes de usarlo.

La generación de casos, la ejecución asistida clásica y la evaluación
conversacional son workflows distintos. Elegí el workflow según el formato del
caso; un workflow de generación no es un executor.

## Antes de configurar

Necesitás permisos de edición en **Configuración → Pruebas con IA** y un
proveedor compatible disponible para la instancia. En Community, el Motor IA
está incluido con cuotas semanales para ejecuciones y generación de casos.

La configuración de proveedores y la autoría asistida son superficies
separadas. Las credenciales nuevas se cifran mediante el vault de la
instalación, no vuelven a mostrarse y nunca deben copiarse en casos, workflows,
comentarios, capturas o archivos versionados.

## Configurar un proveedor y modelo

1. Abrí **Configuración → Pruebas con IA**.
2. Elegí el proveedor o endpoint compatible.
3. Indicá el modelo que se utilizará.
4. Ajustá el timeout, tamaño de viewport y temperatura cuando sea necesario.
5. Guardá los cambios y ejecutá una prueba controlada.

Las credenciales se almacenan protegidas. No las copies en casos, workflows,
comentarios, capturas ni archivos versionados.

## Elegir el modelo adecuado

- Usá un modelo con visión cuando necesitás auditoría visual o capturas.
- Mantené una temperatura baja para resultados más repetibles.
- Usá un timeout suficiente para el flujo real, especialmente si hay varios
  pasos o páginas externas.
- Empezá con una ejecución IA por vez y aumentá el paralelismo solo después de
  validar la capacidad del proveedor.

## Escanear modelos y workflows

La pantalla permite consultar los modelos que expone el proveedor y elegirlos
sin guardar una configuración accidental. Los workflows se seleccionan por su
uso: generación de historias, generación de casos o ejecución asistida.

Treseko mantiene tres selecciones independientes: `story_generation` para
historias desde requisitos, `test_case_generation` para casos desde historias y
criterios, y `test_execution` para ejecutar pruebas. Editar o publicar uno no
reemplaza los otros. Cada ejecución conserva el propósito, la versión y el
snapshot usados.

La autoría v2 añade alcance, fuera de alcance, dependencias y riesgos a las
historias, y una matriz criterio → escenario → caso para las propuestas. La
aplicación es idempotente, conserva huellas original/editada y exige revisión
humana; `scope` y `out_of_scope` son obligatorios para aplicar propuestas v2.

Un workflow marcado como **Experimental** puede depender de capacidades que no
están presentes en todos los proveedores. Probalo primero con datos no críticos
y revisá el resultado antes de usarlo en un flujo operativo.

El workflow `chatbot-evaluation` se aplica a casos `CONVERSACIONAL`: conserva
la configuración congelada, los turnos, la evaluación, las trazas y las
métricas disponibles. Su ejecución depende del catálogo, el proveedor y los
permisos de la instancia.

Los casos `API` pueden ejecutarse manualmente con el runner declarativo o de
forma automatizada mediante el worker unificado. La modalidad IA queda sujeta
a la ruta y evidencia certificadas por la instancia.

## Si el Motor IA no funciona

1. Revisá que el endpoint y las credenciales sean correctos.
2. Confirmá que el modelo exista y soporte las capacidades necesarias.
3. Verificá que haya cuota disponible y que el usuario tenga permisos.
4. Consultá Monitor y el detalle de ejecución para ver el mensaje de error.
5. Probá con un caso pequeño antes de repetir una ejecución extensa.

Para una investigación local de QA, las trazas del Engine pueden redirigirse
con `QA_TEST_TRACE_DIR`. Mantené la carpeta privada: las trazas redactan
secretos comunes, pero las solicitudes y respuestas aún pueden contener datos
sensibles de usuarios o de prueba.

Los dry-runs sirven para validar la preparación sin crear una ejecución,
evidencia ni historial del proyecto.

## Workflows universales y versionado

Además de seleccionar workflows para generación y ejecución, la instalación
puede exponer el editor gobernado de workflows universales. Según la edición y
las capabilities disponibles permite:

- consultar el manifiesto de runtime, agentes y capabilities universales;
- ejecutar preflight V2 o V3 (`workflow_format=universal_v3`) antes de guardar;
- crear, importar, duplicar, editar, validar, archivar y restaurar workflows;
- convertir un workflow a bloques o a un paquete universal;
- exportar e importar paquetes de workflow sin incluir credenciales;
- publicar versiones, activarlas, consultar el historial y hacer rollback.

Los borradores requieren `motor_ia.workflow_drafts:edit`; publicar requiere
`motor_ia.workflow_publish:edit`; activar o restaurar requiere
`motor_ia.workflow_activate:edit`; la consulta usa
`motor_ia.workflow_view:read`. La activación con ejecuciones en curso exige la
confirmación administrativa que solicita el backend. Un preflight fallido no
se debe saltar editando directamente la base de datos.

## Capacidades verificadas del proveedor

El botón Probar distingue disponibilidad de cumplimiento JSON. Una respuesta no vacía confirma disponibilidad; `structured_json` solo se confirma si la sonda devuelve el JSON solicitado `{"ok":true}`. Esto no certifica los esquemas de historias, casos o acciones: cada workflow conserva su validación y revisión. La visión requiere superar dos sondas de imágenes; un resultado inconcluyente mantiene `vision_status=unknown`. El nombre del modelo y el escaneo del catálogo no reemplazan esas comprobaciones.

La variable de despliegue `AI_DISABLE_THINKING` vale `false` por defecto. Si se activa, solicita deshabilitar el razonamiento a través del adaptador compatible. Requiere reiniciar el Engine y comprobar que el proveedor acepte esa opción; no cambia el modelo seleccionado ni certifica su calidad de generación.

### Reparación de propuestas de historias

Si el modelo incumple el contrato, el reintento conserva las instrucciones del usuario, el alcance y las reglas de la solicitud original. La reparación no confirma una propuesta por sí sola: mantiene la validación y revisión posterior. La aceptación automática de supuestos se limita a supuestos completos con riesgo explícito LOW; MEDIUM, valores desconocidos o campos incompletos no se aceptan mediante ese mecanismo.

### Contrato de salida de autoría

El análisis, la generación y la revisión de historias y casos solicitan únicamente su esquema de salida. El cliente usa un modo explícito `schema`, incluido en las reparaciones y la extracción de fuentes, para evitar añadir una segunda plantilla genérica de agente con `decision` vacío. Los agentes de ejecución conservan su contrato de contexto compartido. Este modo es interno; no requiere una opción nueva en la configuración de usuario.

Una respuesta HTTP200 o un indicador SUCCESS del modelo no aprueba una propuesta. Continúan la validación estructural, la comprobación de referencias y la revisión de contenido. Una respuesta incompleta se rechaza; corregir el contrato de la solicitud no demuestra que cualquier modelo pueda generar casos válidos.

Cada propuesta de caso debe conservar el `local_id` emitido por el autor: texto no vacío de hasta 80 caracteres. Si falta o es inválido, el Engine solicita una reparación y rechaza la respuesta si sigue incumpliendo el contrato, antes de la revisión semántica. No se inventan identificadores para completar respuestas del modelo.
