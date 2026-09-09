# Adjuntos y evidencias

Los adjuntos ayudan a definir un caso y a demostrar qué ocurrió. La evidencia
queda asociada al paso, snapshot o resultado para consultarla desde historial,
bug e informes.

## Dos usos distintos

| Uso | Cuándo | Ejemplos |
|---|---|---|
| Referencia del caso | Al diseñar o versionar. | Imagen esperada o documento de apoyo. |
| Evidencia de ejecución | Al ejecutar o investigar. | Screenshot, PDF, foto, log o respuesta. |

Una referencia explica cómo probar; una evidencia demuestra qué ocurrió.

## Adjuntar una referencia

1. Abrí **Añadir Pruebas** y editá el caso.
2. Elegí paso o sección.
3. Adjuntá el archivo.
4. Guardá la versión.

## Adjuntar evidencia durante una ejecución

1. Completá el resultado en la consola correspondiente.
2. Elegí **Adjuntar evidencia**.
3. Seleccioná el archivo y esperá confirmación.
4. Guardá el resultado o finalizá.

En API o conversacional puede haber snapshots de configuración, respuestas,
aserciones, turnos, trazas y variables. Esos datos pertenecen al formato y no
se reemplazan con pasos clásicos.

## Política y problemas

Si tu instalación lo ofrece, **Configuración → Preferencias → Adjuntos y
evidencias** permite definir tipos, tamaño máximo, cantidad, portapapeles y
obligatoriedad ante fallos. La carga requiere el permiso correspondiente.

Las evidencias se consultan desde resultado, Historial Runs, Bug Tracker,
Centro de Incidencias y reportes. Si falla una carga, verificá tipo, tamaño,
permisos y almacenamiento. No incluyas secretos ni datos personales
innecesarios.
