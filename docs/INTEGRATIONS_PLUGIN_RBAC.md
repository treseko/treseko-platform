# Integraciones, complementos y RBAC

Dependen de provider, capability, scope y entitlement. Que aparezcan en catálogo
no significa que estén habilitados.

## Integraciones

El catálogo contempla Redmine, Jira, GitHub Issues, GitLab, Azure DevOps, Slack,
Teams y CI/CD, con disponibilidad Community, Premium, legacy o planificada
según provider. Revisá el estado de la instalación.

Las vinculaciones de bugs son explícitas: Treseko no publica issues externos
automáticamente. Revisá el resumen y guardá vínculo/identificador. Usá cuentas
técnicas de menor alcance y nunca pegues tokens en casos o evidencia.

## plugin-runner

El perfil `plugins` agrega el Plugin Runner aislado. En Community 1.0.7 solo acepta la
invocación declarativa `junit_xml.import_results`; no ejecuta código arbitrario,
WASM ni plugins de terceros. Se mantiene en una red dedicada, sin DB, Redis,
secretos ni socket Docker.

Al habilitar el perfil manualmente, pasa `TRESEKO_RELEASE_VERSION` con la
versión de `VERSION` al comando `docker compose` para que la imagen registre
la release correcta. El actualizador atómico establece ese valor al reconstruir
servicios activos.

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
