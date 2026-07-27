# Worker de automatización

Un worker ejecuta pruebas automatizadas que Treseko prepara y registra sus
resultados, evidencias e historial. Treseko mantiene la fuente de verdad de
casos, builds y ejecuciones; el worker solo ejecuta el trabajo asignado.

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

El worker recibe un trabajo congelado: script, framework, build, caso, ambiente,
dataset y variables. Los cambios posteriores al caso no alteran ese trabajo.

## Evidencias y resultados

El worker puede devolver logs, capturas y otros artifacts. Treseko los asocia a
la ejecución y a sus pasos para que estén disponibles al analizar un fallo o al
crear un bug interno.

## Resolver problemas

| Situación | Qué revisar |
|---|---|
| El worker no aparece | La conectividad, el código de vinculación y los permisos en Automatización. |
| El worker figura sin conexión | Que el proceso siga activo y pueda llegar a Treseko. |
| No toma trabajos | Que sus frameworks y navegadores sean compatibles con el caso. |
| La prueba falla antes de iniciar | La versión del framework, dependencias, variables y datos del caso. |
| No hay evidencias | La configuración del worker y los permisos de adjuntos. |

Community permite un worker local básico. La administración distribuida de
varios workers y el scheduler avanzado requieren las capacidades Premium
correspondientes.
