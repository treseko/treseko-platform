# Premium Runtime Backend

Esta carpeta agrupa la logica runtime Premium que vive dentro del backend self-hosted.

Responsabilidades permitidas:

- Cliente para `verification_server`.
- Cliente para `update_server`.
- Heartbeat de licencia.
- Estados `active`, `past_due`, `offline_grace`, `expired`, `revoked`, `invalid`.
- Grace period y downgrade seguro.
- Validacion de manifests firmados.
- Preparacion de download grants.

Responsabilidades prohibidas:

- Guardar claves privadas oficiales.
- Firmar licencias Premium oficiales.
- Firmar manifests Premium oficiales.
- Emitir, renovar o revocar licencias como autoridad comercial.

La verificacion criptografica local y el catalogo de features/limites siguen viviendo en `backend/app/services/edition`.
