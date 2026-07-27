# Guía de Inventario

Inventario registra los activos y endpoints que intervienen en las pruebas: equipos, navegadores, dispositivos, servicios, cuentas de prueba u otros recursos del proyecto.

## Organizar el inventario

1. Abrí **Inventario** con el proyecto correcto seleccionado.
2. Creá las carpetas o categorías que representen tu entorno.
3. Agregá cada activo con un nombre identificable, tipo y estado.
4. Completá los datos técnicos y endpoints solo cuando sean útiles para ejecutar o reproducir una prueba.
5. Guardá y revisá que el activo quede en la categoría correcta.

## Buenas prácticas

- No guardes secretos ni contraseñas reales en notas o endpoints.
- Usá nombres estables, por ejemplo `QA Chrome Windows` o `API staging`.
- Actualizá el estado de un activo cuando ya no esté disponible.
- Eliminá solo los activos que no tengan valor histórico ni referencias activas.

El inventario complementa ambientes y datasets del proyecto. Usá [Guía de proyectos](PROJECTS_GUIDE.md) para definir esos elementos antes de asociarlos a los casos.
