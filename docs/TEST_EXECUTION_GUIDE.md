# Guía para ejecutar pruebas

Esta sección permite seleccionar casos de la build activa y ejecutarlos de forma manual, automatizada o con el motor IA disponible.

## 1. Preparar el contexto

1. Elegí proyecto, componente y build en la barra superior.
2. Abrí **Ejecutar Pruebas**.
3. Filtrá por suite, estado, prioridad, responsable o bugs cuando necesites reducir la lista.
4. Marcá los casos que vas a ejecutar y elegí **Iniciar ejecución**.

## 2. Elegir el modo

- **Manual:** documentás el resultado de cada paso en la consola de ejecución.
- **Automatizada:** envía el caso a un worker compatible. Requiere que exista un script válido y un worker disponible.
- **IA Agent Engine:** usa la capacidad IA habilitada en la instancia. Revisá su resultado antes de usarlo como decisión de calidad.

Podés elegir ambiente y dataset cuando el caso los necesite. Verificá la URL, las credenciales y los datos antes de comenzar.

## 3. Ejecutar manualmente

1. Seleccioná el caso del lote.
2. Leé acción, datos y resultado esperado del paso.
3. Elegí el veredicto y registrá una observación cuando aporte contexto.
4. Adjuntá evidencia si corresponde.
5. Repetí con los pasos restantes y usá **Finalizar y guardar resultado**.

Un fallo puede bloquear los pasos siguientes según la regla del caso. Si detectás un defecto, podés reportarlo sin abandonar el contexto de ejecución.

## Después de la ejecución

El resultado queda disponible en el caso, en **Historial Runs**, en reportes y en la trazabilidad de bugs. Consultá [Historial de ejecuciones](RUN_HISTORY_GUIDE.md) para revisar una corrida ya finalizada.
