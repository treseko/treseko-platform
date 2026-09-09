# Documentación de Treseko Community

> English: [English documentation](en/README.md)

Esta documentación te ayuda a instalar Treseko, organizar el trabajo de QA y
administrar la plataforma. Cada guía indica qué función está disponible, cómo
usarla y qué revisar si algo no sale como esperás.

## Contacto

- Mantenedor: [José Manuel Zúñiga](https://www.linkedin.com/in/jose-manuel-zuniga/)
- Sitio: [biuler.com](https://www.biuler.com)
- Email: [jose@treseko.com](mailto:jose@treseko.com)

## Empezar

1. [Instalación rápida](INSTALLATION.md): instalá Treseko con Docker o desde tu equipo por SSH.
2. [Guía Docker](DOCKER_GUIDE.md): configurá una instalación persistente.
3. [Acceso, usuarios y permisos](AUTH_RBAC_GUIDE.md): creá los primeros usuarios y roles.
4. [Portabilidad de suites y casos](CASE_PORTABILITY.md): importá o exportá tus casos.
5. [Instalación en Linux](LINUX_SETUP.md): prepará una instalación Linux paso a paso.

## Usar Treseko

- [Crear y mantener casos de prueba](TEST_CASES_GUIDE.md)
- [Ejecutar pruebas](TEST_EXECUTION_GUIDE.md)
- [Tipos y modalidades de pruebas](TEST_TYPES_AND_EXECUTION.md)
- [Pruebas API](API_TESTING_GUIDE.md)
- [Pruebas conversacionales](CONVERSATIONAL_TESTING_GUIDE.md)
- [Compatibilidad de importación](CASE_IMPORT_COMPATIBILITY.md)

## Automatización e IA

- [Automatización](AUTOMATION_GUIDE.md)
- [Automatización externa: generar API key y reportar ejecuciones](API_USAGE_GUIDE.md)
- [Contrato de la API de automatización externa](EXTERNAL_AUTOMATION_API.md)
- [API externa de reporte de automatización](API_SPEC.md)
- [Worker de automatización](AUTOMATION_WORKER_V1.md)
- [Operación del Motor IA](AI_ENGINE_GUIDE.md)
- [Configuración del Motor IA](AI_ENGINE_CONFIG.md)
- [MCP gobernado](MCP_GUIDE.md)

## Bugs, incidentes e informes

- [Bug Tracker](BUG_TRACKER.md)
- [Centro de Incidencias](INCIDENT_CENTER_GUIDE.md)
- [Adjuntos y evidencia](ATTACHMENTS_EVIDENCE.md)
- [Reportes y métricas](REPORTING_GUIDE.md)
- [Historial de runs](RUN_HISTORY_GUIDE.md)
- [Trazabilidad](TRACEABILITY.md)

## Administración y referencia

- [Ediciones Community y Premium](EDITION_STRATEGY.md)
- [Integraciones y complementos](INTEGRATIONS_PLUGIN_RBAC.md)
- [Matriz de permisos por rol](RBAC_MATRIX.md)
- [Matriz de capacidades](RBAC_CAPABILITY_MATRIX.md)
- [Arquitectura](ARCHITECTURE.md)
- [Despliegue distribuido recomendado](DISTRIBUTED_DEPLOYMENT_GUIDE.md)
- [Base de datos](DATABASE.md)

## Alcance de los formatos

El formato define la estructura del caso y la modalidad define cómo se
ejecuta. No son categorías intercambiables:

| Formato | Uso | Modalidades documentadas |
| --- | --- | --- |
| `CLASICA` | Pasos, datos y resultado esperado por paso. | Manual, automatizada o asistida por IA, según la configuración disponible. |
| `API` | Contrato HTTP declarativo, variables y aserciones. | Manual o automatizada con el worker existente. API + IA solo debe considerarse disponible si la instalación certifica esa ruta de extremo a extremo. |
| `CONVERSACIONAL` | Endpoint, turnos, memoria, herramientas y evaluación. | Manual, automatizada o asistida por IA. |
| `PERFORMANCE` | Formato reservado/extensible. | Sin ejecutor público documentado en esta versión. |

Para crear y ejecutar casos, empezá por [Crear y mantener casos de prueba](TEST_CASES_GUIDE.md), [Ejecutar pruebas](TEST_EXECUTION_GUIDE.md) y [Automatización externa](API_USAGE_GUIDE.md).

## Versión distribuida

La versión estable distribuida es `1.0.3`. Incluye formatos API y
conversacional, ejecución unificada mediante worker, evidencia por formato,
bugs, snapshots de reportes, trazabilidad, automatización, IA y administración.

Consultá el [changelog](../CHANGELOG.md) para conocer las novedades incluidas.

## Enlaces oficiales

- Sitio web: [treseko.com](https://treseko.com)
- [Términos y condiciones](https://treseko.com/terminos-y-condiciones)
