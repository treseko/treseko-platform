# Generación revisada de historias y casos

Treseko parte de un requisito, analiza su contexto y propone historias con
criterios de aceptación. Después propone casos manuales vinculados a esos
criterios. Los registros se crean cuando el usuario revisa y confirma.

## Aclaraciones y supuestos

- Las preguntas funcionales no se descartan por palabras como API o seguridad.
- Confirmar requiere responder todas las preguntas del análisis actual, sin
  preguntas ajenas, respuestas vacías ni respuestas repetidas.
- Las respuestas se conservan y vuelven al análisis antes de continuar. Si
  quedan dudas, la interfaz mantiene la etapa de aclaraciones.
- En casos, cada supuesto se selecciona por separado. Los críticos requieren
  aceptación manual. Si el nuevo análisis cambia el texto o riesgo de un
  supuesto, su aceptación anterior no se reutiliza.
- Historias conserva sus defaults de bajo riesgo existentes; la continuación
  por temporizador no puede omitir preguntas pendientes.

## Fuente vigente

Antes de generar o aplicar se comprueba que el requisito, la historia, sus
criterios y las fuentes seleccionadas siguen disponibles y coinciden con la
captura usada. Las generaciones nuevas registran la revisión del requisito y
la historia; las anteriores comparan los campos disponibles de su captura.
Una fuente modificada requiere un nuevo análisis. El asistente de casos ofrece
reiniciarlo conservando las instrucciones y ubicación elegidas.

Una edición del texto de criterios de una historia deja su estructuración
pendiente: no se generan casos usando las filas estructuradas anteriores como
si reflejaran el texto nuevo. La historia debe volver a disponer de criterios
estructurados vigentes antes de generar casos.

## Revisión y persistencia

- Una historia aplicada debe tener criterios de aceptación y referencias a
  fuentes conocidas o supuestos aceptados. Cada historia conserva su propia
  evaluación y decisión, incluso cuando se aplican varias juntas.
- Los casos se validan nuevamente en backend. Cambiar el campo de calidad a
  `PASS` no elimina un `FAIL` de la propuesta original. Objetivos ausentes
  requieren revisión justificada; acciones y resultados vacíos se rechazan.
- Los criterios referenciados deben pertenecer a la historia. Los criterios
  obligatorios requieren cobertura o una exclusión con motivo no vacío.
- La categoría de un caso debe cumplir el contrato. El motor pide una reparación
  si no lo cumple, sin adivinarla mediante palabras de su título.
- La creación/edición de requisitos e historias y la aplicación de propuestas
  guardan datos y auditoría en una transacción. Una notificación fallida después
  del guardado no transforma el resultado en un error.
- La generación se bloquea durante sus cambios de estado. Repetir la aplicación
  devuelve los registros ya creados sin duplicarlos, auditar otra creación ni
  enviar otra notificación de creación. La interfaz también impide doble envío.

## Respaldo y cobertura del contenido

El motor revisa cada propuesta después de generarla. La revisión de calidad
busca contradicciones, reglas nuevas y resultados no observables. La revisión
de trazabilidad pide fragmentos literales para respaldar cada criterio; el
motor comprueba que existan en las fuentes recibidas. Una fuente seleccionada
no se agrega automáticamente como respaldo de una regla.

En los casos, la revisión identifica los pasos que verifican cada criterio y
distingue cobertura completa, parcial o ausente. Podés abrir **Respaldo y
cobertura del contenido** para consultar citas, inferencias y pasos relacionados.
Estos estados son una opinión de la IA, no una certificación.

Antes de crear registros, una propuesta editada se revisa nuevamente. Si surgen
hallazgos críticos, primero se muestran para corregirlos o aceptar y justificar
la decisión. La auditoría conserva el informe y el proveedor/modelo efectivo
por llamada, incluidos los fallbacks. Una respuesta de un motor antiguo sin
esa información queda sin atribución confirmada.

## Contexto y presupuesto

Las generaciones nuevas conservan el contenido completo de las fuentes Wiki
seleccionadas. El motor ya no corta silenciosamente el input de estos
asistentes a 12.000 caracteres ni fuerza todas las historias a dos–seis
criterios. El plan se organiza por capacidades y genera una historia por llamada.
El presupuesto de salida respeta la configuración del modelo.

Hay un límite conservador de caracteres basado en la ventana y el presupuesto
configurados, que no reemplaza el conteo de tokens del proveedor. Si el input
no cabe, el asistente informa el problema: seleccioná menos fuentes o aumentá
la ventana usando un modelo compatible. No se continúa como si el contexto
omitido hubiera sido analizado. Las fuentes grandes se procesan por fragmentos con solapamiento. Cada regla
extraída necesita una cita literal verificable y todos los fragmentos deben
completar la extracción. El inventario se conserva con su hash de fuentes y
se reutiliza mientras estas coincidan. Si el inventario tampoco cabe, se
informa el límite. La interfaz muestra cuántas fuentes y fragmentos se
procesaron; esa lectura no certifica ausencia de omisiones semánticas.

## Alcance

La validación estructural y la trazabilidad no prueban que una afirmación sea
verdadera ni que un caso cubra semánticamente un criterio. La revisión humana
sigue siendo necesaria. La calidad del modelo debe medirse con requisitos
representativos y sus resultados esperados. No se generan scripts ni se ejecutan
las pruebas en este flujo; los casos resultantes son manuales clásicos.

Para revisar criterios, abre **Editar historia**. El editor permite modificar
su estructura manteniendo los identificadores existentes y marcando los casos
vinculados para revisión cuando cambia la definición. Si había texto pendiente,
se muestra como referencia. Guardar una edición basada en una revisión anterior
se rechaza para evitar sobrescribir cambios de otro usuario.

El analizador distingue entre información necesaria que falta y capacidades expresamente fuera de alcance. Los hechos confirmados se conservan como hechos, no como supuestos. Esta instrucción orienta al modelo; no elimina automáticamente preguntas ni demuestra que el análisis sea correcto. Las dudas funcionales necesarias siguen requiriendo respuesta.

La continuación automática solo acepta un conjunto completo de supuestos de riesgo LOW, con identificadores únicos y textos válidos, sin preguntas pendientes. Un estado READY del modelo no omite esta comprobación. Los riesgos MEDIUM, HIGH, CRITICAL o desconocidos requieren decisión manual.

Si un workflow de generación no fija un perfil propio, usa el perfil activo y conserva su límite de reintentos y espera. Si se cierra la solicitud del backend, el motor cancela la conexión al proveedor y no reintenta esa solicitud cancelada. La cancelación local no garantiza que todos los proveedores externos detengan inmediatamente su cómputo.

Los reintentos de reparación del análisis y de la autoría de casos conservan las instrucciones adicionales, el alcance y las reglas originales para tratar fuentes y secretos. Una reparación de formato no autoriza cambiar el comportamiento solicitado.

El análisis de casos conserva hasta 20 escenarios cuando todavía no se eligió una cantidad. El límite de generación se aplica al generar; no se recorta el plan a cinco escenarios por defecto.

La espera total de generación respeta timeout_seconds entre 30 y 7200 segundos, igual que la configuración de la pantalla/API. Ese presupuesto es distinto de request_timeout_seconds del perfil, que limita cada llamada al proveedor a un máximo de 900 segundos. Aumentar la espera no garantiza calidad ni evita límites de los proxies del despliegue.

La autoría de casos divide los escenarios en lotes según el presupuesto de
salida configurado. Antes de aceptar una respuesta, comprueba si el proveedor
indicó que alcanzó el límite de salida; en ese caso vuelve a dividir el lote y
lo procesa otra vez. Nunca conserva propuestas cortadas. Si la respuesta de un
solo escenario también alcanza el límite, devuelve un diagnóstico para aumentar
el presupuesto o reducir el detalle de salida.

Cada caso generado conserva la asignación al escenario que recibió. Antes de
revisarlo, el motor comprueba que sus referencias coincidan exactamente con las
del escenario; el revisor recibe ese escenario y evalúa el objetivo de esa unidad
de prueba y el conjunto completo de escenarios hermanos. No exige que un caso aislado cubra todos los resultados del criterio
padre. El informe distingue `coverage` del criterio padre, que puede ser parcial
en un caso atómico, de `scenario_coverage`, que debe confirmar que ese caso
verifica su escenario asignado. Los fallos del caso se determinan con este
segundo alcance; la cobertura obligatoria global se valida sobre el conjunto de
casos antes de aplicar la generación. La vinculación persistida con criterios
sigue vigente. Las observaciones del revisor indican su alcance:
`PARENT_CRITERION` se muestra como información y no bloquea un caso atómico;
las observaciones del escenario asignado o de calidad del caso siguen siendo
accionables.
Si el revisor marca un hallazgo `SCENARIO` como fallo pero declara ese mismo
escenario `COVERED`, el motor conserva la observación como advertencia de
inconsistencia y exige revisión humana; no elige silenciosamente una de las dos
conclusiones. Los hallazgos idénticos emitidos por etapas de revisión distintas
se muestran una sola vez. El estado final de testabilidad refleja esta revisión
estructurada; la autoevaluación del modelo generador no puede dejar un fallo
obsoleto después de que la revisión haya resuelto la contradicción. Una cita
literal inválida o un supuesto no aceptado provoca un único reintento del
contrato de trazabilidad; si vuelve a fallar, el hallazgo permanece como fallo
y la evidencia inválida no se conserva.

Los fallos de espera muestran un diagnóstico legible. Una excepción sin mensaje no debe dejar vacíos el detalle persistido ni la respuesta de error del flujo de casos.
