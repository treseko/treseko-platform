# Estados de ejecución

Treseko usa estados distintos para el caso o paso, el `run` completo y los
jobs del worker. No los mezcles al interpretar un historial o informe.

## Formato y modalidad

`formato_prueba` describe la estructura: `CLASICA`, `API`, `CONVERSACIONAL` o
`PERFORMANCE`. `tipo_prueba` describe la modalidad: `MANUAL`, `AUTOMATIZADA` o
`AUTOMATIZADA_AI`. Además, cada ejecución registra un modo operativo:
`MANUAL`, `IA`, `AUTOMATIZADA` o `EXTERNA`.

Un caso conversacional no es automáticamente una prueba con IA. `PERFORMANCE`
es reservado y no tiene un ejecutor de carga documentado.

## Estados de un caso o paso

| Estado | Qué significa | Qué hacer |
|---|---|---|
| Sin correr | Todavía no hay resultado. | Ejecutá cuando el contexto esté listo. |
| Pasó | Coincide con lo esperado. | Conservá evidencia y continuá. |
| Falló | No coincide con lo esperado. | Registrá obtenido, observaciones y evidencia. |
| Bloqueado | Una dependencia impidió validar. | Explicá el bloqueo y dejá seguimiento. |
| Ejecutando IA | Hay evaluación IA en curso. | Esperá el cierre o revisá su estado. |

En API se evalúan status, headers, cuerpo y aserciones. En conversacional se
conservan turnos, respuestas, expectativas y evaluación.

## Estados de un run

| Estado | Uso |
|---|---|
| Abierto | Fue creado y admite resultados. |
| En progreso | Hay casos o pasos en ejecución. |
| Cerrado | Quedó finalizado y persistido. |

## Estados de jobs automatizados

Los jobs del worker pueden estar `PENDING`, `CLAIMED`, `RUNNING`, `PASSED`,
`FAILED`, `BLOCKED`, `ERROR`, `TIMEOUT`, `CANCELLED` o
`BLOCKED_BY_RUNNER`. Son estados técnicos de cola y no sustituyen el resultado
funcional. El worker unificado también ejecuta API declarativa; no existe un
worker API separado.

## Revisión IA y resultado manual

Una ejecución IA puede requerir revisión humana. Revisá confianza, consenso,
informe y estado de revisión antes de decidir. Un diagnóstico no confirma causa
raíz ni crea un bug automáticamente.

Para registrar manualmente:

1. Abrí **Ejecutar Pruebas** y seleccioná el caso.
2. Confirmá build, ambiente y dataset.
3. Usá la consola propia del formato.
4. Elegí resultado, observación y evidencia.
5. Finalizá y verificá en [Historial Runs](RUN_HISTORY_GUIDE.md).

Usá **Bloqueado** para una dependencia real, no para ocultar un fallo. Consultá
[Adjuntos y evidencias](ATTACHMENTS_EVIDENCE.md).
