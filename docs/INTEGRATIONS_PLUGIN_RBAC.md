# Integraciones, complementos y RBAC

El acceso depende del proveedor, los permisos, el alcance y la licencia. Que un
elemento aparezca en el catálogo no significa que esté habilitado.

## Integraciones y funciones del catálogo

El catálogo muestra lo registrado y accesible en esa instalación; una mención,
una fila histórica o un provider planificado no garantizan que exista un
conector listo para configurar. En esta versión, Email/SMTP es la integración
nativa; su gestión está sujeta a Premium. Bug Tracker, Motor LLM, Portabilidad
de Casos y Generación de casos con IA son funciones nativas que aparecen como
complementos del catálogo, no
conectores de terceros. La API externa de reporte es otro flujo distinto y
está descrita en [su guía](API_USAGE_GUIDE.md).

No asumas que Jira, GitHub Issues, GitLab, Azure DevOps, Slack, Teams o Redmine
están conectados por el hecho de que la aplicación tenga campos o referencias
históricas para ellos. La disponibilidad real se confirma en **Complementos**
y depende del provider registrado, la edición y los permisos. Las vinculaciones
de bugs son explícitas: Treseko no publica issues externos automáticamente.
Revisá el resumen antes de guardar un vínculo o identificador. Usá cuentas
técnicas de menor alcance y nunca pegues tokens en casos o evidencia.

## plugin-runner

El perfil `plugins` agrega el Plugin Runner aislado. En Community 1.0.8 solo acepta la
invocación declarativa `junit_xml.import_results`; no ejecuta código arbitrario,
WASM ni plugins de terceros. Se mantiene en una red dedicada, sin DB, Redis,
secretos ni socket Docker.

Al habilitar el perfil manualmente, pasa `TRESEKO_RELEASE_VERSION` con la
versión de `VERSION` al comando `docker compose` para que la imagen registre
la versión correcta.

## Portabilidad

Usa capabilities de provider y perfiles. Revisá [CASE_PORTABILITY.md](CASE_PORTABILITY.md).
Los importadores no ejecutan scripts como código libre; Postman conserva
diagnósticos y usa el runtime declarativo admitido.

## MCP

No es la API externa de reportes. Está deshabilitado por defecto, usa
`X-MCP-API-Key` y no acepta JWT de navegador. La superficie pública combina
consultas de proyecto, builds, casos, ejecuciones, resultados, bugs, calidad,
evidencia, ambientes, datasets, versiones y tendencias con mutaciones
confirmadas e importaciones gobernadas cuando la capability y el scope lo
permiten. La lista efectiva se descubre en `/mcp/tools`; no se debe asumir un
catálogo estático.

Cada llamada requiere capability, organización y proyecto mediante project_id,
validación, límites, rate limit y auditoría. No hay shell, filesystem, secretos,
DB ni red genérica.
