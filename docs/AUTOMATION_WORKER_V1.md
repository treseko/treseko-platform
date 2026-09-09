# Worker de automatización

Un worker ejecuta pruebas automatizadas que Treseko prepara y registra sus
resultados, evidencias e historial. Treseko mantiene la fuente de verdad de
casos, builds y ejecuciones; el mismo worker ejecuta trabajos clásicos de
navegador y suites API automatizadas.

## Antes de empezar

- Contá con permiso de edición en **Automatización**.
- Prepará una máquina que tenga el framework y los navegadores requeridos.
- Confirmá que el worker puede conectarse a la URL de Treseko.
- Usá un nombre identificable, por ejemplo `QA Windows - Playwright`.

## Vincular un worker local

1. Iniciá el worker en la máquina que ejecutará las pruebas.
2. El worker mostrará un código temporal de vinculación.
3. En Treseko abrí **Automatización → Workers**.
4. Buscá la solicitud pendiente, revisá sus capacidades y aprobala.
5. Confirmá que el worker aparezca como disponible antes de iniciar una
   ejecución automatizada.

El token de trabajo se guarda localmente en el worker y no se muestra de nuevo
en la interfaz. Si sospechás que se expuso, revocá o volvé a vincular el worker.

## Ejecutar una prueba

1. Seleccioná uno o más casos en **Ejecutar Pruebas**.
2. Elegí **Ejecución automatizada**.
3. Seleccioná el ambiente, dataset y worker compatible cuando corresponda.
4. Iniciá la ejecución.
5. Revisá el resultado y las evidencias en la ejecución o en **Historial Runs**.

El worker recibe un trabajo congelado: script o definición API, framework,
build, caso, ambiente, dataset y variables. Los cambios posteriores al caso no
alteran ese trabajo.

La cola está aislada por solución y proyecto. Cada trabajo reclamado usa un
lease renovado por heartbeat, por lo que dos workers no pueden confirmar el
mismo trabajo. Si el backend no responde, el resultado queda en un spool local
y el worker mantiene el lease mientras reintenta. El archivo se elimina solo
después de que Treseko confirma la recepción; tras un reinicio se reutiliza el
mismo identificador de evento para evitar resultados duplicados.

Las suites API automatizadas no requieren instalar otro worker. El worker
existente anuncia la capacidad `treseko-api/declarative`, ejecuta los casos en
orden y conserva las variables `api.*` que comparten. Las ejecuciones API
manuales se realizan directamente desde Treseko. No declares disponible API +
IA sin verificar una ruta certificada, el workflow, los permisos y la
evidencia de la instalación concreta.

El job API usa `treseko.api-worker-job/v1` y devuelve
`treseko.api-result/v1`. El runtime declarativo aplica la allowlist del
ambiente, límites de tiempo y tamaño, y redacta evidencia antes de persistirla.
Un caso API importado desde Postman no cambia automáticamente de executor: el
camino normal sigue siendo el contrato declarativo de Treseko.

Esto no debe confundirse con la API externa de reporte. Un runner externo usa
`POST /external/executions/report`; no reclama jobs del worker ni recibe el
snapshot de Treseko.

## Evidencias y resultados

El worker puede devolver logs, capturas y otros artifacts. Treseko los asocia a
la ejecución y a sus pasos para que estén disponibles al analizar un fallo o al
crear un bug interno.

En API, el payload sensible permanece cifrado hasta que el worker autenticado
reclama el trabajo. Las variables de estado viajan separadas de la evidencia
visible y no se incorporan a informes.

## Resolver problemas

| Situación | Qué revisar |
|---|---|
| El worker no aparece | La conectividad, el código de vinculación y los permisos en Automatización. |
| El worker figura sin conexión | Que el proceso siga activo y pueda llegar a Treseko. |
| No toma trabajos | Que sus frameworks y navegadores sean compatibles con el caso. |
| Resultado pendiente de reenvío | La conectividad con Treseko; no borres el spool local mientras el worker reintenta. |
| La prueba falla antes de iniciar | La versión del framework, dependencias, variables y datos del caso. |
| No hay evidencias | La configuración del worker y los permisos de adjuntos. |

Community permite un worker local básico. La administración distribuida de
varios workers y el scheduler avanzado requieren las capacidades Premium
correspondientes.
