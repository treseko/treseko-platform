# Guía para ejecutar pruebas

Esta sección permite seleccionar casos de la build activa y ejecutarlos de
forma manual, automatizada o con IA. El executor se decide por el
`formato_prueba` persistido y la modalidad elegida; no se deben mezclar casos
conversacionales con otros formatos en el mismo lote.

## 1. Preparar el contexto

1. Elegí proyecto, componente y build en la barra superior.
2. Abrí **Ejecutar Pruebas**.
3. Filtrá por suite, estado, prioridad, responsable o bugs cuando necesites reducir la lista.
4. Marcá los casos que vas a ejecutar y elegí **Iniciar ejecución**.

## 2. Elegir el modo

- **Manual:** usás la consola correspondiente al formato; la consola por pasos
  aplica a `CLASICA`, la consola declarativa a `API` y la consola multi-turno a
  `CONVERSACIONAL`.
- **Automatizada:** envía el caso al executor compatible. `CLASICA` puede
  requerir un script; `API` usa la definición declarativa del worker unificado
  y `CONVERSACIONAL` usa su workflow de chatbot.
- **IA Agent Engine:** usa la capacidad IA habilitada en la instancia. Revisá su resultado antes de usarlo como decisión de calidad.

| Formato | Manual | Automatizada | Automatizada con IA |
|---|---|---|---|
| `CLASICA` | Consola por pasos. | Automation Worker compatible. | Engine IA/asistido, sujeto a configuración y permisos. |
| `API` | Runner declarativo desde Treseko. | El Automation Worker unificado con `treseko-api/declarative`. | El contrato general contempla IA, pero no se debe prometer una ruta end-to-end no certificada en la instancia. |
| `CONVERSACIONAL` | Consola multi-turno y evaluación humana. | Workflow Chatbot con snapshot y evidencia persistida. | `chatbot-evaluation`, si la instancia tiene el workflow, proveedor y permisos necesarios. |
| `PERFORMANCE` | No disponible como executor reportable. | No disponible. | No disponible. |

La API externa de reportes es distinta del worker: recibe resultados de un
runner externo en `POST /external/executions/report`; no inicia trabajos ni
reemplaza al Automation Worker.

Podés elegir ambiente y dataset cuando el caso los necesite. Verificá la URL, las credenciales y los datos antes de comenzar.

## 3. Configurar una prueba conversacional

Una prueba conversacional no se conecta a un puerto aislado: necesita una URL
HTTP completa y un contrato que indique cómo enviar el mensaje y cómo leer la
respuesta.

1. En **Añadir Pruebas**, elegí el formato **Conversacional**.
2. Seleccioná uno de los contratos iniciales:
   - **HTTP JSON genérico** para una API propia.
   - **Compatible con OpenAI** para endpoints `chat/completions`.
   - **HTTP con respuesta en texto** cuando el request es JSON pero la respuesta
     es texto plano.
3. Indicá la URL o heredala del ambiente. Para servicios instalados en otro
   host o contenedor, usá una dirección alcanzable desde Treseko; `localhost`
   siempre representa el proceso que ejecuta Treseko.
4. Configurá el método, los headers y la plantilla del request. Las claves y
   URLs privadas deben vivir en el ambiente, no escritas en cada caso.
5. Definí el formato de respuesta y, si es JSON, la ruta del mensaje. La ruta
   de sesión es opcional y sólo se usa cuando la API devuelve un identificador
   que debe conservarse entre turnos.
6. Usá **Probar conexión**. Esta comprobación envía únicamente el mensaje de
   muestra, muestra estado HTTP, latencia, formato y texto extraído, y no agrega
   un turno ni crea una ejecución.
7. Agregá los turnos y sus expectativas. **Reutilizar sesión** conserva el
   contexto; **Nueva por turno** prueba conversaciones independientes.

Las respuestas pueden evaluarse por texto esperado, expresiones, reglas de
seguridad, memoria y resultado final. Si declarás una herramienta interna, la
llamada sólo se considera comprobada cuando el endpoint expone evidencia
observable; de otro modo Treseko evalúa únicamente la respuesta final.

## 4. Ejecutar manualmente

1. Seleccioná el caso del lote.
2. Para `CLASICA`, leé acción, datos y resultado esperado de cada paso.
3. Para `API`, revisá el request, las aserciones y la respuesta del runner.
4. Para `CONVERSACIONAL`, revisá cada turno, su respuesta y sus
   comprobaciones.
5. Elegí el veredicto, registrá una observación cuando aporte contexto y usá
   **Finalizar y guardar resultado**.

Un fallo puede bloquear los pasos siguientes según la regla del caso. Si detectás un defecto, podés reportarlo sin abandonar el contexto de ejecución.

## Después de la ejecución

El resultado queda disponible en el caso, en **Historial Runs**, en reportes y en la trazabilidad de bugs. Consultá [Historial de ejecuciones](RUN_HISTORY_GUIDE.md) para revisar una corrida ya finalizada.
