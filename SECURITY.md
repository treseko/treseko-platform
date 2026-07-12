# Politica de Seguridad

Treseko esta pensado para operaciones QA self-hosted y puede procesar datos sensibles de proyectos, evidencias de prueba, credenciales de integraciones e informacion interna de bugs.

## Versiones Soportadas

Este repositorio publica release candidates de Community. Las correcciones de seguridad apuntan primero al release candidate mas reciente.

## Reportar Una Vulnerabilidad

No abras issues publicos para vulnerabilidades de seguridad.

Envia un reporte privado a los mantenedores con:

- version afectada;
- componente afectado;
- pasos de reproduccion;
- impacto esperado;
- logs o capturas con secretos removidos.

## Secretos

Nunca subas al repositorio:

- archivos `.env`;
- dumps de base de datos;
- llaves privadas;
- credenciales de servicios;
- tokens de API;
- datos de clientes;
- capturas o evidencias con credenciales.

## Base Productiva

Para despliegues productivos o similares:

- usa `APP_ENV=production`;
- configura un `SECRET_KEY` fuerte;
- usa PostgreSQL, no SQLite;
- ejecuta migraciones Alembic antes de iniciar;
- publica la aplicacion por HTTPS;
- manten cualquier material sensible fuera del repositorio;
- cambia las contraseñas temporales despues del primer login.
