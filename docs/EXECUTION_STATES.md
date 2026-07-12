# Estados de ejecucion

Fecha de revision: 2026-06-14.

Este documento define los estados oficiales que deben usarse en backend, frontend, reportes, filtros, métricas y tooltips.

## Resumen

| Estado canonico | Label sugerido | Color sugerido | Significado corto |
|---|---|---|---|
| `SIN_CORRER` | Sin correr | Gris | Todavia no fue ejecutado. |
| `EJECUTANDO_AI` | Ejecutando IA | Azul/celeste | El engine IA esta procesando la prueba. |
| `PASO` | Pass / OK | Verde | Cumplio el resultado esperado. |
| `FALLO` | Fail / Fallido | Rojo | No cumplio el resultado esperado. |
| `BLOQUEADO` | Bloqueado | Azul | No pudo ejecutarse por impedimento externo o técnico. |

## Definiciones para tooltip

### SIN_CORRER

La prueba o paso todavía no fue ejecutado. No debe contar como exito, fallo ni bloqueo.

Tooltip sugerido:

> Pendiente de ejecucion. Aun no hay resultado registrado para este paso o caso.

### EJECUTANDO_AI

La ejecucion esta siendo procesada por el motor de IA. Es un estado transitorio.

Tooltip sugerido:

> El motor de IA esta ejecutando la prueba y aun no emitio resultado final.

### PASO

El paso o caso cumplio el resultado esperado.

Tooltip sugerido:

> Resultado correcto. El comportamiento observado coincide con lo esperado.

### FALLO

El resultado esperado no se cumplio. Debe quedar evidencia y comentario cuando sea posible.

Tooltip sugerido:

> Resultado fallido. El comportamiento observado no coincide con lo esperado.

### BLOQUEADO

La prueba no pudo ejecutarse por una condicion externa o técnica. No significa que la funcionalidad haya fallado.

Ejemplos:

- Ambiente caido.
- Credenciales invalidas o faltantes.
- Datos de prueba inexistentes.
- Servicio externo no disponible.
- Error de configuracion.

Tooltip sugerido:

> Ejecucion bloqueada. No se pudo validar por una condicion externa o técnica.



No debe interpretarse como pass. Tampoco debe tratarse como fail critico automático. Es una desviacion aceptada temporalmente que debe quedar visible.

Ejemplos:

- El texto esperado difiere levemente, pero no bloquea el flujo.
- Falta una validación secundaria y se decide seguir.
- Un componente visual no esta perfecto, pero el proceso principal continua.
- El tester acepta continuar para no perder la ejecucion completa.

Tooltip sugerido:

> Continuado con observacion. Algo no se cumplio completamente, pero se decidio seguir y dejarlo registrado.

## Reglas de uso

- `PASO` suma a exitos.
- `FALLO` suma a fallos.
- `BLOQUEADO` suma a bloqueos.
- `SIN_CORRER` no debe afectar métricas de calidad.
- `EJECUTANDO_AI` solo debe existir mientras una ejecucion esta activa.

## Reglas para estado final de una ejecucion

Propuesta inicial:

1. Si algun paso esta `FALLO`, la ejecucion final es `FALLO`.
2. Si no hay fallos pero algun paso esta `BLOQUEADO`, la ejecucion final es `BLOQUEADO`.
4. Si todos los pasos estan `PASO`, la ejecucion final es `PASO`.
5. Si queda algun paso `SIN_CORRER`, la ejecucion sigue incompleta.
6. Si esta corriendo el engine, usar `EJECUTANDO_AI` hasta recibir resultados.

Esta regla puede ajustarse cuando se disene la pantalla final de ejecucion.
