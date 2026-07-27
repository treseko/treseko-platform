# Guía para crear y mantener casos de prueba

Usá **Añadir Pruebas** para organizar suites y crear los casos que se ejecutarán dentro de un proyecto.

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
5. Añadí los pasos con **acción**, **datos** y **resultado esperado**.
6. Guardá el caso.

El código `TC-...` se asigna automáticamente y no debe reutilizarse ni editarse manualmente.

## 3. Mantener pasos y versiones

Podés reordenar, duplicar o quitar pasos antes de guardar. Al modificar un caso ya usado, revisá su versión y los resultados previos: la ejecución histórica conserva el contexto con el que fue registrada.

## 4. Validar automatización

Si el caso usa un framework automatizado, elegí framework y lenguaje, agregá el script y usá la validación de sintaxis/contexto antes de guardarlo. El dry-run requiere un worker compatible y no reemplaza una ejecución registrada.

Para importar casos existentes, consultá [Compatibilidad de importación](CASE_IMPORT_COMPATIBILITY.md).
