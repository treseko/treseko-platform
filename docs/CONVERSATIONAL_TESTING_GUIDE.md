# Guía de pruebas conversacionales

Una prueba conversacional valida un chatbot o servicio multi-turno. Su formato
es `CONVERSACIONAL`, pero su modalidad puede ser manual, automatizada o con IA.

## Antes de empezar

Necesitás un ambiente con el endpoint permitido, un dataset cuando el escenario
use variables y, para evaluación con IA, un perfil y workflow habilitados.

## Configurar la conexión

1. Definí el endpoint HTTP y el contrato de request/response.
2. Seleccioná método, headers y mapeo de la respuesta.
3. Configurá la ruta de sesión solo si el servicio devuelve un identificador
   reutilizable real.
4. Elegí ambiente, dataset y perfil.
5. Usá **Probar conexión** para una comprobación efímera. Esta acción no crea
   una ejecución ni modifica los turnos.

Las credenciales deben provenir del ambiente o de un perfil protegido, nunca de
un ejemplo público o de texto pegado en la documentación.

## Definir la conversación

1. Agregá los turnos en orden. El primer mensaje configurado es el Turno 1.
2. Definí qué respuesta esperás y qué elementos debe incluir.
3. Configurá memoria y herramientas solo cuando puedan comprobarse.
4. Elegí si la sesión se reutiliza o se reinicia en cada turno.

Una expectativa no demuestra que una herramienta fue utilizada. Treseko solo
puede afirmarlo cuando la respuesta o una traza disponible aporta evidencia.

## Ejecutar y evaluar

- **Manual:** la consola envía cada turno y una persona registra el resultado.
- **Automatizada/IA:** el workflow `chatbot-evaluation` conserva snapshot,
  transcripción, métricas y evaluación cuando la instalación lo tiene activo.

La ejecución congela la conexión, los turnos, el dataset, las variables, el
perfil y las reglas de evaluación. El bug conversacional se construye desde esa
ejecución y puede incluir esperado/obtenido, latencia, HTTP, aserciones y trazas
con la redacción correspondiente.

## Evitá estas confusiones

- No uses pasos clásicos como sustituto de turnos.
- No uses la API externa de resultados para iniciar una conversación.
- No conviertas `PERFORMANCE` en conversacional para simular carga.
- No agregues `opening_message` histórico como un turno extra.

## Checklist

- [ ] Endpoint, método y contrato están completos.
- [ ] Ambiente, dataset y perfil corresponden al escenario.
- [ ] Existe al menos un turno con una expectativa verificable.
- [ ] La prueba de conexión no alteró la definición.
- [ ] La modalidad elegida tiene permisos y workflow disponibles.
- [ ] Revisaste snapshot, transcripción, evaluación y evidencia.
- [ ] El bug quedó asociado a una ejecución persistida y elegible.

Consultá también [Tipos de prueba y modalidades](TEST_TYPES_AND_EXECUTION.md),
[Guía de ejecución](TEST_EXECUTION_GUIDE.md) y
[Centro de Incidencias](INCIDENT_CENTER_GUIDE.md).
