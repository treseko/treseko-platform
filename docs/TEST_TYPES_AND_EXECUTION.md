# Tipos de prueba y modalidades de ejecución

Treseko separa dos decisiones que no deben confundirse:

- el **formato** define la estructura y el propósito del caso;
- la **modalidad** define cómo se ejecuta.

## Formatos

| Formato | Configuración | Evidencia principal |
|---|---|---|
| `CLASICA` | Pasos con acción, datos y resultado esperado. | Pasos, observaciones, capturas y adjuntos. |
| `API` | Request declarativo, variables y aserciones. | Request, response, aserciones y variables permitidas. |
| `CONVERSACIONAL` | Flujo específico de UI/API; no disponible para MCP. | Transcripción, evaluación, métricas y trazas disponibles. |
| `PERFORMANCE` | Formato reservado. | No tiene un ejecutor de carga disponible en esta versión. |

## MCP

MCP permite descubrir herramientas y operar proyectos, requisitos, historias,
casos, ejecuciones y resultados según los scopes y permisos de la credencial.
También permite explorar sitios web autorizados y registrar resultados
manuales observados. La importación de casos requiere preview y confirmación.
Los casos creados o importados por MCP admiten los formatos `CLASICA` y `API`;
`CONVERSACIONAL` y `PERFORMANCE` no tienen ejecución MCP. `PERFORMANCE`
permanece reservado porque no existe un ejecutor de carga seguro.

## Modalidades

| Modalidad | Cómo se ejecuta |
|---|---|
| `MANUAL` | Una persona opera la consola y registra el veredicto. |
| `AUTOMATIZADA` | Un runner compatible ejecuta el caso y devuelve resultados. |
| `AUTOMATIZADA_AI` | El Engine coordina el workflow disponible y conserva su evaluación. |

Un caso conversacional no es automáticamente una ejecución con IA. Del mismo
modo, un caso API no necesita un worker diferente: cuando es automatizado usa
el Automation Worker existente con la capacidad `treseko-api/declarative`.

## Matriz operativa de Community 1.0.7 (candidata)

| Combinación | Alcance público |
|---|---|
| Clásica + Manual | Consola por pasos. |
| Clásica + Automatizada | Automation Worker. |
| Clásica + IA | Engine y workflow configurado. |
| API + Manual | Runner declarativo del backend y evaluación humana. |
| API + Automatizada | Automation Worker unificado. |
| API + IA | No declararla disponible sin verificar el flujo de la instalación. |
| Conversacional + Manual | Consola por turnos. |
| Conversacional + Automatizada/IA | Workflow conversacional cuando esté habilitado. |
| Performance | Reservado; no simularlo con otro formato. |

## Reglas que protegen la evidencia

- No mezcles formatos incompatibles dentro de un mismo lote.
- El primer mensaje conversacional es el Turno 1; no agregues un mensaje
  histórico como turno adicional.
- La ejecución conserva un snapshot de la definición, el ambiente, el dataset
  y las variables utilizadas.
- Los datos sensibles se redactan por defecto. La conservación completa de
  datos sintéticos requiere una política explícita del ambiente.
- Los bugs se construyen desde la ejecución persistida y no desde datos
  reemplazados por el navegador.
- Los nombres, códigos y datos técnicos permanecen intactos aunque cambie el
  idioma de la interfaz.

## Capacidades de pruebas API

- El runner declarativo admite variables dinámicas compatibles con Postman,
  incluidas `{{$randomUUID}}`, `{{$timestamp}}`, `{{$randomEmail}}` y
  `{{$randomInt}}`. Las variables se generan con una semilla por ejecución y
  los placeholders desconocidos se rechazan.
- El catálogo público contiene 118 variables oficiales y 3 extensiones de
  Treseko. Los scripts de Postman se ejecutan dentro de un sandbox; no se
  permiten scripts arbitrarios, credenciales inline ni requests fuera de la
  allowlist o de los límites configurados.
- La política `public_test_data=true` del ambiente permite conservar datos
  sintéticos para evidencia; queda congelada en la ejecución y nunca habilita
  conservar secretos reales.
- Los jobs API automatizados usan la capacidad `treseko-api/declarative` del
  worker unificado. La ejecución manual/IA usa el runner declarativo del
  backend y conserva snapshots, aserciones, scopes y logs redactados.
- La deduplicación de bugs y su contexto se calcula desde la ejecución
  persistida, no desde el estado reemplazable del frontend.

## API externa y Automation Worker

`POST /external/executions/report` registra resultados producidos por un runner
externo. No inicia jobs y no reemplaza al Automation Worker.

Para configurar cada formato consultá:

- [Guía de casos de prueba](TEST_CASES_GUIDE.md)
- [Guía de ejecución](TEST_EXECUTION_GUIDE.md)
- [Pruebas API](API_TESTING_GUIDE.md)
- [Pruebas conversacionales](CONVERSATIONAL_TESTING_GUIDE.md)
