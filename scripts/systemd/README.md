# Host spool systemd adapter

Estas plantillas son una fase de integración, no un instalador. El instalador
futuro debe sustituir los placeholders y copiar el wrapper como un archivo
root-owned `0755` en una ruta host fija. Debe validar previamente que:

- `@TRESEKO_UPDATE_BRIDGE_HELPER@` es un helper fijo root-owned `0755`;
- el helper contiene o referencia de forma privada la configuración spool
  root-owned `0600`;
- sus ancestros, spool, receipts y state son root-owned y no escribibles por
  grupo/otros;
- el inbox de requests y reports tienen el owner/group público ya acordado;
- el wrapper, el intérprete o el helper Docker y la imagen son identidades
  verificadas. El wrapper puede delegar en el helper Docker inmutable de Bohr;
  no se presupone Python host ni se monta el socket en el backend;
- la unidad sólo se instala después de validar todos esos bindings.

El wrapper no acepta argumentos del usuario: ejecuta siempre el helper instalado
sin `-m`, `--config` ni otros argumentos. El helper usa internamente el CLI
existente con `--once --spool` y una configuración fija. `process_once()` usa el lock
durable del spool, reconcilia primero receipts `pending/running/uncertain` y
devuelve `idle` si no hay trabajo.

La configuración del installer conserva el esquema legacy exacto de tres claves
`participant`, `ingress` y `runtime_preparation`. Sólo el modo coordinado puede
usar el conjunto exacto de cuatro:

```json
{
  "configs": {
    "participant": "/etc/treseko/update/participant.json",
    "ingress": "/etc/treseko/update/ingress.json",
    "runtime_preparation": "/etc/treseko/update/runtime-preparation.json",
    "host_bridge": "/etc/treseko/update/host-bridge.json"
  },
  "launcher": {
    "type": "docker",
    "image": "registry.invalid/treseko-update@sha256:<64-hex>",
    "docker": "/usr/bin/docker",
    "socket": "/var/run/docker.sock",
    "network": "treseko-update",
    "mounts": {
      "participant": [],
      "ingress": [],
      "runtime_preparation": [],
      "host_bridge": []
    }
  }
}
```

`<64-hex>` es un placeholder, no una imagen utilizable. El instalador debe
rechazar claves extra, validar todos los paths y mounts, y escapar valores por
separado para shell y systemd; nunca interpolar una request en una unidad.
`host_bridge` requiere launcher Docker explícito. Su wrapper instalado ejecuta
la misma imagen bootstrap/helper con `--entrypoint /usr/local/bin/python`,
`-m app.services.update_host_bridge_cli`, `--config` fijo, `--once --spool` y
la configuración montada readonly; no hornea secretos. El journal conserva los cuatro
wrappers, sus hashes, config hashes, launcher binding y backups; unidades systemd
no se registran ni instalan en esta fase.

El timer es obligatorio. No se usa `systemd.path` ni `DirectoryNotEmpty`: las
requests se conservan para identidad/replay y observar un directorio no vacío
provocaría un hot loop. Usa `OnUnitInactiveSec=30s`, por lo que el siguiente
intento se cuenta después de finalizar el servicio; `Persistent=true` sólo
recupera una activación perdida al arrancar systemd y no altera ese intervalo
monotónico a tiempo de pared. Cada tick puede reintentar la reconciliación de
un receipt sin crear otra migración/build ni depender de que el backend esté vivo.

Esta fase no modifica `install_treseko.sh`, no habilita unidades, no crea el
binding legacy/coordinated y no cambia la exclusión del entrypoint. La
instalación del adapter y la exclusión legacy pertenecen a la fase siguiente.
