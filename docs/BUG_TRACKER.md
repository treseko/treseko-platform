# Bug Tracker

Bug Tracker registra defectos y conserva el vínculo con caso, ejecución, build,
componente y evidencia. El Centro de Incidencias es una vista operativa
separada; consultá [su guía](INCIDENT_CENTER_GUIDE.md).

## Crear un bug desde una ejecución

1. Marcá el resultado como **Falló** o **Bloqueado**.
2. Guardá obtenido, observaciones y evidencia.
3. Elegí **Preparar bug interno** o **Reportar bug interno**.
4. Revisá título, prioridad, severidad y contexto.
5. Guardá y confirmá el vínculo de origen.

El contexto respeta el formato: clásica conserva pasos; API conserva request,
status, headers, cuerpo, aserciones y variables permitidas; conversacional
conserva endpoint, turnos, esperado/obtenido, latencia, evaluación y trazas.
`PERFORMANCE` es reservado y no debe transformarse en otra clase de bug.

## Crear y gestionar manualmente

Desde **Bug Tracker → Añadir nuevo bug**, completá título, problema, esperado,
prioridad, severidad y contexto. Según tus permisos podés asignar responsable,
comentar, adjuntar evidencia, cambiar estado, registrar build de corrección,
abrir contexto API/conversacional y generar un resumen externo.

Dos defectos distintos sobre el mismo caso siguen siendo registros distintos.
Buscá el existente antes de crear otro.

## Estados, retest y herramientas externas

Usá **Listo para retest** y luego **En retest** cuando una corrección necesite
verificación. Registrá build de detección, build de corrección y resolución.

Treseko no crea tickets externos automáticamente. Podés copiar un resumen para
Jira, Redmine o GitHub Issues y guardar su URL o identificador explícitamente.

## Ayuda rápida

- Adjuntá evidencia antes de reportar si ayuda a reproducir.
- Preferí código, nombres y contexto legibles; no uses UUID como resumen.
- Si no podés crear o editar, pedí permisos de Bug Tracker o Incidencias.
