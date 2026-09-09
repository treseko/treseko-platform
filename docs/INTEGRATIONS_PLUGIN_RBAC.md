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

El profile `plugins` está declarado en el Compose, pero el snapshot público
actual no contiene el contexto de build de `plugin-runner`. Por eso no está
operativo ni debe iniciarse desde este paquete. La existencia del perfil no
implica soporte disponible para complementos de terceros.

## Portabilidad

Usa capabilities de provider y perfiles. Revisá [CASE_PORTABILITY.md](CASE_PORTABILITY.md).
Los importadores no ejecutan scripts como código libre; Postman conserva
diagnósticos y usa el runtime declarativo admitido.

## MCP

No es la API externa de reportes. Está deshabilitado por defecto, usa
X-MCP-API-Key y no acepta JWT de navegador. La allowlist actual expone
treseko.project.get y treseko.builds.list, de lectura.

Cada llamada requiere capability, organización y proyecto mediante project_id,
validación, límites, rate limit y auditoría. No hay shell, filesystem, secretos,
DB ni red genérica.
