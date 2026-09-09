# Guía de Inventario

Inventario registra activos y endpoints que ayudan a describir o reproducir un
entorno. No reemplaza Ambientes, Datasets ni la configuración ejecutable del
caso.

## Qué podés registrar

Un activo puede ser servidor, computadora, navegador, dispositivo, servicio,
API, base de datos, contenedor, nodo de ejecución u otro recurso. Según el
tipo, podés completar naturaleza, estado, criticidad, responsable, ubicación,
sistema operativo, fabricante, modelo, serie, asset tag, activo padre,
endpoints y metadatos personalizados.

## Crear o actualizar un activo

1. Abrí **Inventario** con el proyecto correcto.
2. Elegí una categoría.
3. Seleccioná **Nuevo activo** o abrí uno existente.
4. Completá nombre, tipo, estado y datos útiles.
5. Agregá endpoints con tipo, valor, puerto, protocolo y principal cuando
   corresponda.
6. Guardá y verificá categoría y relación padre-hijo.

Un endpoint documentado no habilita por sí mismo una conexión. Los casos `API`
y `CONVERSACIONAL` resuelven su contrato desde ambiente, dataset y caso.

## Inventario, ambientes y datasets

| Elemento | Responde a | Uso |
|---|---|---|
| Inventario | ¿Qué recurso existe? | Identificar activos y endpoints. |
| Ambiente | ¿Dónde se ejecuta? | Resolver destino y configuración. |
| Dataset | ¿Con qué datos? | Proveer valores preparados. |

No guardes contraseñas, tokens ni secretos reales en notas, metadatos o
endpoints.

## Buenas prácticas y permisos

- Usá nombres estables, como `QA Chrome Windows` o `API staging`.
- Mantené estado, responsable y endpoint principal actualizados.
- No borres activos con referencias activas o valor histórico.
- La edición y eliminación dependen de tus permisos y relaciones existentes.
- `PERFORMANCE` es reservado; no uses Inventario para simular un ejecutor de
  carga no documentado.

Para preparar el contexto, consultá [Guía de proyectos](PROJECTS_GUIDE.md).
