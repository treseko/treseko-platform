# Bug Tracker

Bug Tracker permite registrar, seguir y cerrar defectos sin perder el vínculo
con el caso, la ejecución, el paso y la evidencia donde se detectaron.

## Crear un bug desde una ejecución

Esta es la forma recomendada cuando un paso falla o queda bloqueado:

1. Durante la ejecución, marcá el paso como **Falló** o **Bloqueado**.
2. Registrá el resultado obtenido y adjuntá la evidencia disponible.
3. Seleccioná **Preparar bug interno** o **Reportar bug interno**.
4. Revisá el título, severidad, prioridad, descripción y contexto precargado.
5. Guardá el bug.

El bug conserva el caso, build, componente, ejecución y paso de origen. No
necesitás copiar esos datos manualmente.

## Crear y gestionar un bug manualmente

Abrí **Bug Tracker** y seleccioná **Añadir nuevo bug** si el defecto no proviene
de una ejecución registrada. Completá un título claro, el problema observado,
el resultado esperado, la prioridad y la severidad.

Desde el detalle del bug podés:

- asignar una persona responsable;
- agregar comentarios y evidencias;
- cambiar el estado según avance la corrección;
- indicar la build donde se corrigió;
- preparar un resumen para un tracker externo;
- registrar un vínculo externo de forma explícita.

## Estados y retest

Al cerrar un bug, Treseko solicita la build de corrección y una resolución. Si
la corrección debe verificarse, usá **Listo para retest** y luego **En retest**.
Así se conserva tanto la build donde se detectó el problema como la build donde
se corrigió.

## Vincular herramientas externas

Treseko no crea tickets externos automáticamente. Podés generar un resumen
para copiar y pegar en Redmine, Jira, GitHub Issues u otra herramienta y
guardar el identificador o enlace externo en el bug. Cada vínculo se registra
de forma independiente para evitar que dos bugs compartan un ticket por error.

## Ayuda rápida

- Reportá un bug nuevo para un defecto distinto, aunque ocurra en el mismo caso.
- Si el defecto ya existe, actualizá ese bug en lugar de crear un duplicado.
- Adjuntá evidencia antes de reportar cuando ayude a reproducir el problema.
- Si no podés crear o editar un bug, pedí permisos para Bug Tracker a un
  administrador.
