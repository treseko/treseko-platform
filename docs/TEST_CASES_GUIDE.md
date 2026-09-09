# Guía para crear y mantener casos de prueba

Usá **Añadir Pruebas** para organizar suites y crear casos dentro de un
proyecto. El formato del caso y la modalidad de ejecución son dimensiones
separadas: primero elegí qué se prueba y después cómo se ejecutará.

| Formato | Para qué sirve | Configuración principal |
|---|---|---|
| `CLASICA` | Flujos de interfaz o negocio por pasos. | Acción, datos y resultado esperado por paso. |
| `API` | Requests HTTP declarativas y sus aserciones. | Método, URL, headers, cuerpo, variables y aserciones. |
| `CONVERSACIONAL` | Chatbots y servicios multi-turno. | Endpoint, sesión, turnos, expectativas, memoria y evaluación. |
| `PERFORMANCE` | Formato reservado para una futura ejecución de carga. | No tiene executor reportable en esta versión. |

Las modalidades disponibles son `MANUAL`, `AUTOMATIZADA` y
`AUTOMATIZADA_AI`. Un caso conversacional no es automáticamente una prueba IA:
puede ejecutarse manualmente, de forma automatizada o mediante IA según la
modalidad elegida.

## 1. Crear una suite

1. Abrí **Añadir Pruebas**.
2. Elegí **Nueva Suite Raíz** o seleccioná una suite existente para crear una sub-suite.
3. Indicá un nombre claro y guardá.

Las suites agrupan casos; no cambian su código ni sus resultados históricos.

## 2. Crear un caso

1. Seleccioná la suite de destino y creá un caso.
2. Escribí un título que describa el comportamiento esperado.
3. Completá objetivo, precondiciones, prioridad, criticidad y etiquetas cuando apliquen.
4. Asociá componente, ambiente y dataset si el caso los requiere.
5. Completá la configuración propia del formato elegido:
   - `CLASICA`: añadí pasos con **acción**, **datos** y **resultado esperado**.
   - `API`: completá la configuración declarativa: request, variables y
     aserciones; no uses pasos clásicos como sustituto.
   - `CONVERSACIONAL`: configurá endpoint, contrato, sesión, turnos,
     expectativas, memoria y evaluación; el primer mensaje configurado es el
     Turno 1.
6. Guardá el caso.

El código `TC-...` se asigna automáticamente y no debe reutilizarse ni editarse manualmente.

## 3. Mantener pasos y versiones

Podés reordenar, duplicar o quitar pasos antes de guardar. Al modificar un caso ya usado, revisá su versión y los resultados previos: la ejecución histórica conserva el contexto con el que fue registrada.

## 4. Validar automatización

Si un caso `CLASICA` usa un framework automatizado, elegí framework y lenguaje,
agregá el script y usá la validación de sintaxis/contexto antes de guardarlo.
El dry-run requiere un worker compatible y no reemplaza una ejecución
registrada. API automatizada usa la definición declarativa y el worker
unificado; no requiere convertirla en script clásico. La modalidad IA depende
del formato y de las capacidades habilitadas en la instancia.

Para importar casos existentes, consultá [Compatibilidad de importación](CASE_IMPORT_COMPATIBILITY.md).

## 5. Reglas de configuración por formato

- Los pasos clásicos pertenecen a `CLASICA`; no los uses para representar un
  caso `API` ni `CONVERSACIONAL`.
- En `API`, completá `configuracion_api` con la definición declarativa. En
  `CONVERSACIONAL`, completá `configuracion_chatbot` con endpoint y turnos.
- En `CONVERSACIONAL`, el primer mensaje configurado es el Turno 1; no agregues
  un mensaje inicial histórico como turno adicional.
- `PERFORMANCE` queda reservado: no lo conviertas en API, Chatbot o clásica para
  simular un runner de carga.
- Guardá expectativas y variables en la configuración del caso o en el
  ambiente/dataset correspondiente. No incluyas credenciales en el caso.
