# Configuración del Motor IA

El Motor IA ayuda a generar historias y casos, y a ejecutar pruebas asistidas.
Esta guía explica qué configura un administrador desde Treseko y qué revisar
antes de usarlo.

## Antes de configurar

Necesitás permisos de edición en **Configuración → Pruebas con IA** y un
proveedor compatible disponible para la instancia. En Community, el Motor IA
está incluido con cuotas semanales para ejecuciones y generación de casos.

## Configurar un proveedor y modelo

1. Abrí **Configuración → Pruebas con IA**.
2. Elegí el proveedor o endpoint compatible.
3. Indicá el modelo que se utilizará.
4. Ajustá el timeout, tamaño de viewport y temperatura cuando sea necesario.
5. Guardá los cambios y ejecutá una prueba controlada.

Las credenciales se almacenan protegidas. No las copies en casos, workflows,
comentarios, capturas ni archivos versionados.

## Elegir el modelo adecuado

- Usá un modelo con visión cuando necesitás auditoría visual o capturas.
- Mantené una temperatura baja para resultados más repetibles.
- Usá un timeout suficiente para el flujo real, especialmente si hay varios
  pasos o páginas externas.
- Empezá con una ejecución IA por vez y aumentá el paralelismo solo después de
  validar la capacidad del proveedor.

## Escanear modelos y workflows

La pantalla permite consultar los modelos que expone el proveedor y elegirlos
sin guardar una configuración accidental. Los workflows se seleccionan por su
uso: generación de historias, generación de casos o ejecución asistida.

Un workflow marcado como **Experimental** puede depender de capacidades que no
están presentes en todos los proveedores. Probalo primero con datos no críticos
y revisá el resultado antes de usarlo en un flujo operativo.

## Si el Motor IA no funciona

1. Revisá que el endpoint y las credenciales sean correctos.
2. Confirmá que el modelo exista y soporte las capacidades necesarias.
3. Verificá que haya cuota disponible y que el usuario tenga permisos.
4. Consultá Monitor y el detalle de ejecución para ver el mensaje de error.
5. Probá con un caso pequeño antes de repetir una ejecución extensa.

Los dry-runs sirven para validar la preparación sin crear una ejecución,
evidencia ni historial del proyecto.
