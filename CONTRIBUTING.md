# Contribuir a Treseko

Gracias por ayudar a mejorar Treseko.

Project maintainer: [José Manuel Zúñiga](https://www.linkedin.com/in/jose-manuel-zuniga/).
For project contact, visit [treseko.com](https://treseko.com) or write to
[jose@treseko.com](mailto:jose@treseko.com).

Al contribuir aceptás que tu aporte se distribuye bajo la misma licencia del
proyecto: AGPL-3.0-or-later.

## Flujo de desarrollo

Para preparar una instalación local de desarrollo o evaluación, usá el
instalador incluido:

```bash
scripts/install_local_treseko.sh --with-demo
```

La publicación incluye ejemplos `.env.production.example` sin secretos; el
instalador genera `compose.production.env` y los secretos locales. Consultá la
[guía de instalación](docs/INSTALLATION.md) para el procedimiento manual.

Usá ramas enfocadas y mantené cada cambio limitado a una función o corrección.

## Antes de abrir un pull request

Ejecutá las verificaciones relacionadas con los archivos modificados:

```bash
npm --prefix frontend run build
npm --prefix engine run smoke
python -m py_compile backend/seed_admin.py backend/reset_user_password.py
```

Para cambios de backend, ejecutá también las pruebas específicas disponibles.

## Límite del repositorio público

No incorpores infraestructura comercial privada en este repositorio:

- servicios de generación de licencias;
- firma privada de actualizaciones;
- claves privadas;
- backends de telemetría de clientes;
- evidencias de auditorías internas;
- credenciales privadas de despliegue.

El código puede incluir gates Community/Premium, pero los servicios que actúan
como autoridad comercial están separados intencionalmente.

## Licencia y marca

- Los aportes de código se licencian bajo AGPL-3.0-or-later.
- No agregues dependencias ni recursos incompatibles con esa distribución.
- No agregues recursos de marca que no estén destinados al uso público.
- El nombre y la identidad visual de Treseko se rigen por `TRADEMARKS.md`.

## Documentación

Los cambios visibles para usuarios deben actualizar `docs/` cuando modifican
el comportamiento, la instalación o la operación. Las guías españolas son la
fuente de verdad y deben conservar un espejo equivalente en `docs/en/`.

Para conocer más sobre el mantenedor, visitá [biuler.com](https://www.biuler.com).
