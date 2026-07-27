# Estados de ejecución

Los estados muestran el resultado de una prueba, de cada paso y de una
ejecución completa. Usalos para decidir qué revisar, repetir o reportar.

## Estados de un caso o paso

| Estado | Qué significa | Qué hacer |
|---|---|---|
| Sin correr | Todavía no hay un resultado registrado. | Ejecutá la prueba cuando esté lista. |
| Pasó | El resultado observado coincide con lo esperado. | Guardá el resultado y continuá. |
| Falló | El comportamiento no coincide con lo esperado. | Agregá observaciones y evidencia; reportá un bug si corresponde. |
| Bloqueado | No fue posible validar el caso por una dependencia o impedimento. | Indicá el motivo y vinculá o creá un bug cuando aplique. |
| Pendiente | El paso está abierto durante una ejecución manual. | Seleccioná el resultado antes de finalizar. |

Un caso solo queda en **Pasó** cuando todos sus pasos requeridos fueron
validados correctamente. Un fallo o bloqueo deja el resultado visible en el
historial y en los reportes.

## Estados de un run

| Estado | Uso |
|---|---|
| Abierto | La ejecución está en curso y admite resultados. |
| Cerrado | Se guardaron los resultados y el run quedó finalizado. |
| Cancelado | La ejecución se detuvo sin completarse. |

## Registrar un resultado manual

1. Abrí **Ejecutar Pruebas** y seleccioná el caso.
2. Revisá la acción, los datos y el resultado esperado de cada paso.
3. Elegí el veredicto y agregá una observación si ayuda a entender el resultado.
4. Adjuntá evidencia cuando sea necesaria.
5. Finalizá y guardá el resultado.

## Ayuda rápida

- Usá **Falló** cuando el sistema respondió de forma incorrecta.
- Usá **Bloqueado** cuando una condición externa impide probarlo, por ejemplo
  un ambiente caído o una credencial no disponible.
- No reemplaces un fallo por un bloqueo para ocultarlo: los reportes distinguen
  ambos casos.
- Si necesitás investigar un resultado anterior, abrí **Historial Runs** o el
  historial del caso.
