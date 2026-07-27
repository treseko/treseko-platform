# Adjuntos y evidencias

Los adjuntos ayudan a definir un caso y a demostrar qué ocurrió durante una
ejecución. Treseko los conserva junto al paso o resultado correspondiente para
que sigan disponibles en el historial y los reportes.

## Dos usos distintos

| Uso | Cuándo adjuntarlo | Ejemplos |
|---|---|---|
| Referencia del paso | Al diseñar un caso. | Captura de la acción, imagen esperada, documento de apoyo. |
| Evidencia de ejecución | Al ejecutar o analizar un resultado. | Screenshot, foto, PDF o log. |

## Adjuntar una referencia a un caso

1. Abrí **Añadir Pruebas** y editá el caso.
2. Elegí el paso correspondiente.
3. Adjuntá la referencia de acción o de resultado esperado.
4. Guardá el caso.

La referencia queda disponible para quienes ejecuten el caso. Usá nombres de
archivo claros y evitá subir información sensible que no sea necesaria.

## Adjuntar evidencia durante una ejecución

1. En la consola de ejecución, completá el resultado del paso.
2. Seleccioná **Adjuntar evidencia**.
3. Elegí el archivo y esperá la confirmación de carga.
4. Guardá el resultado del paso o finalizá la ejecución.

Una evidencia puede acompañar un fallo, un bloqueo o un resultado exitoso. Si
vas a reportar un bug, adjuntala antes de crear el reporte para que el contexto
se copie correctamente.

## Configuración para administradores

Abrí **Configuración → Preferencias → Adjuntos y evidencias** para definir:

- tipos de archivo permitidos;
- tamaño máximo por archivo;
- cantidad máxima por paso y por evidencia;
- pegado desde el portapapeles;
- obligatoriedad de evidencia ante fallos.

Aplicá límites acordes al almacenamiento disponible y a las políticas de tu
organización. Los archivos se guardan fuera de la base de datos y Treseko usa
su huella para evitar duplicados físicos.

## Consultar y resolver problemas

Las referencias se ven al editar o ejecutar un caso. Las evidencias de
ejecución se consultan desde el resultado, Historial Runs, Bug Tracker y los
reportes relacionados.

Si una carga falla, verificá que el archivo cumpla los tipos y tamaños
permitidos, que tu rol permita adjuntar evidencia y que haya espacio de
almacenamiento disponible. No incluyas secretos, contraseñas o datos personales
innecesarios en capturas y logs.
