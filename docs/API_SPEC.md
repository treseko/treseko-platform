# API de automatización externa

La API documentada de Treseko está destinada exclusivamente a que un runner o
pipeline CI/CD informe el resultado de pruebas automatizadas. Requiere la
capacidad Premium de API externa; no se usa para iniciar sesión, administrar
usuarios ni operar el resto de la plataforma.

## Antes de integrar el runner

1. Ingresá a Treseko con el usuario que ejecutará las pruebas.
2. Abrí **Configuración → Preferencias → API keys de automatización externa**.
3. Generá una clave con un nombre que identifique al runner o pipeline.
4. Copiala al momento de crearla y guardala como secreto del CI. La clave no se
   debe incluir en código, archivos versionados ni logs.
5. Configurá el runner con la URL de Treseko y esa clave.

La clave hereda los permisos del usuario que la creó. Ese usuario necesita
permiso para ejecutar pruebas y acceso de edición al proyecto y a la build que
el runner reportará. Si la clave deja de usarse o se expone, revocala desde la
misma sección de Preferencias y creá una nueva.

## Operación disponible

| Método | Ruta | Uso |
|---|---|---|
| `POST` | `/api/external/executions/report` | Registra uno o varios resultados de casos automatizados en una build. |

El contrato, los campos y ejemplos de integración están en la
[guía de automatización externa](EXTERNAL_AUTOMATION_API.md).

## Autorización del runner

```http
Authorization: Bearer <API_KEY_DE_AUTOMATIZACION_EXTERNA>
```

También se admite el encabezado `X-QA-API-Key`. La API no requiere ni
documenta un login por API: la sesión web sirve solo para generar y administrar
la API key desde la interfaz.
