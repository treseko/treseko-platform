# Bootstrap local de helpers de actualización

Este bootstrap instala, de forma explícita y local, tres entrypoints fijos y
acepta un cuarto opcional cuando se declara el puente host:

- `treseko-update-participant`
- `treseko-update-ingress`
- `treseko-update-runtime-preparation`
- `treseko-update-host-bridge` (opcional; requiere spool/controller privados)

No es un instalador productivo completo ni habilita una instalación legacy
1.0.2. No contacta Docker, PostgreSQL, servicios, SSH ni VPS. El prerrequisito
temporal es que el operador ya tenga un Python funcional y sus dependencias;
el bootstrap no ejecuta `pip`, `apt`, imágenes ni gestores de servicios.

## Configuración privada

El operador debe proporcionar un JSON privado con este contrato:

```json
{
  "schema": 1,
  "python": "/usr/bin/python3",
  "cache": "/var/lib/treseko-update/packages",
  "manifest": "/var/lib/treseko-update/manifest.json",
  "bin_dir": "/usr/local/libexec",
  "state_dir": "/var/lib/treseko-update",
  "configs": {
    "participant": "/etc/treseko/update-participant.json",
    "ingress": "/etc/treseko/update-ingress.json",
    "runtime_preparation": "/etc/treseko/update-runtime-preparation.json"
  },
  "dependencies": ["cryptography"]
}
```

`configs` debe contener exactamente los tres nombres legacy o esos tres más
`host_bridge`. El conjunto de mounts Docker debe coincidir exactamente con el
mismo conjunto. El cuarto wrapper usa la misma imagen Linux y ejecuta sólo
`--once --spool`; no recibe argumentos de la solicitud.

`python` es una ruta absoluta ejecutable del entorno operador. `cache`,
`manifest`, `bin_dir`, `state_dir` y las configuraciones se resuelven dentro del
`--root-prefix`. En pruebas se usa un prefijo temporal dedicado; para las rutas
operativas mostradas arriba el prefijo explícito es `/`. `bin_dir` es público y
contiene directamente los entrypoints fijos; `state_dir` es privado (0700) y
contiene journal, locks, backups y backend versionado. El prefijo no puede
contener componentes symlink. Las configuraciones sólo se leen, deben ser
ficheros regulares privados y nunca se copian ni se imprimen.

### Configuración de participantes Docker Compose

Con `launcher.type: "docker"`, `configs.participant` puede ser un router
privado con el esquema exacto `{"schema": 1, "participants": {"backend":
"/etc/treseko/participants/backend.json", ...}}`. Cada ruta apunta a una
configuración privada separada y debe declararse como mount `ro` del helper
`participant`. No se deben incluir secretos en el router.

Cada runtime Compose declara su propio `runtime.active_compose_file`; por
ejemplo `/var/lib/treseko-update/active-compose/backend.json`. Nunca compartir
ese archivo entre Backend, Frontend, Engine, Automation Worker o Plugin Runner.
En `launcher.mounts.participant` se monta `rw` el archivo exacto si ya existe o
su directorio padre dedicado si todavía no existe. Ese directorio debe existir,
ser propiedad de root y tener modo `0700`; no se acepta montar un ancestro
amplio. Los archivos Compose ya existentes deben ser regulares, privados y
declarar el servicio configurado. PostgreSQL usa `runtime.type:
"docker-postgres"` y no declara `active_compose_file`.

En el primer `prepare`, antes de detener el servicio, el driver captura el
Compose efectivo original, exige que su hash corresponda al contenedor vivo,
comprueba que el JSON pueda reproducirse y guarda el modelo atómicamente con
modo `0600`. La actualización siguiente usa ese modelo como origen; al activar
una versión verificada persiste el Compose nuevo y las identidades actuales de
sus volúmenes. Así una cadena como 1.0.4→1.0.5→1.0.6 no depende de reconstruir
solo Frontend ni del Compose antiguo. Cada paquete firmado debe admitir la
versión activa de origen en su política de compatibilidad. El instalador valida
estas rutas y mounts, pero no crea las configuraciones privadas del operador.

El paquete se busca como:

```text
<cache>/<manifest.checksum_sha256>.tar.gz
```

Antes de crear el backend versionado o copiar un wrapper se valida la firma,
checksum, tamaño y estructura mediante `stage_verified_package`. Después se
comprueban las dependencias Python configuradas y se importan los tres módulos
helper desde el staging con el Python operador. Esa validación sí ejecuta
imports del paquete firmado; no ejecuta servicios, Docker, SQL, hooks ni
gestores de paquetes.

## Bootstrap Docker-only (opcional)

Cuando el host no tiene Python, el operador puede ejecutar el instalador dentro
de una imagen previamente verificada y fijada. El script no construye, hace
pull ni selecciona tags: `--image` debe ser un digest (`sha256:...` o
`repositorio@sha256:...`) ya presente y validado por `docker image inspect`.
La imagen debe contener el código confiable de `app.services.update_helper_installation`
y sus dependencias reales; el script nunca copia ni ejecuta el archivo de un
paquete entrante antes de que `stage_verified_package` valide su firma.

Ejemplo de contrato operativo (todos los valores son privados del operador):

```bash
scripts/bootstrap_update_helpers_docker.sh \
  --image registry.example/treseko-helper-bootstrap@sha256:<digest> \
  --docker /usr/local/bin/docker \
  --socket /var/run/docker.sock \
  --network treseko-update \
  --config /var/lib/treseko-update/helper-installation.json \
  --root-prefix /var/lib/treseko-update/root
```

El JSON conserva el contrato de `HelperInstallation`. Sus `cache`, `manifest`,
`bin_dir`, `state_dir` y las tres rutas `configs` se montan en el contenedor en
los destinos exactos calculados bajo `root-prefix`; cache, estado y bin son
`rw`, manifest y configuraciones son `ro`. La configuración `launcher` debe
coincidir exactamente con imagen, Docker, socket y network suministrados. Sus
mounts por helper se validan dentro de la imagen y se montan sólo en su mismo
`source=target`, sin `/`, `/root`, `/home`, symlinks ni solapamientos inseguros.
La configuración privada debe ser un fichero regular, propiedad de root y con
modo 0600 (el `load_private_json` del contenedor root rechaza un volumen
propiedad de UID 1000). El prefijo y sus padres también deben ser directorios
reales, sin alias symlink; el operador debe resolver explícitamente los alias
del sistema antes de invocar el script.

El socket se monta explícitamente porque el instalador valida la configuración
Docker y los wrappers posteriores ejecutan Docker. Eso otorga al contenedor la
capacidad del socket del operador; debe ser un socket local autorizado, nunca
un VPS o un socket compartido por inferencia. El script no imprime el JSON ni
su contenido; sólo el instalador confiable produce su receipt/hash. La imagen
es responsabilidad del operador y no se publica ni se inventa aquí un digest.

La operación reutiliza journal, replay y rollback de `HelperInstallation`; no
crea otro instalador. El host sólo necesita Docker CLI y acceso autorizado al
socket, no Python. El test Docker es opt-in y usa una imagen efímera propia;
no equivale a una instalación productiva ni certifica servicios legacy.

## Modos

```bash
python -m app.services.update_helper_installation \
  --config /etc/treseko/helper-installation.json \
  --root-prefix /tmp/treseko-helper-root --plan

python -m app.services.update_helper_installation \
  --config /etc/treseko/helper-installation.json \
  --root-prefix /tmp/treseko-helper-root

python -m app.services.update_helper_installation \
  --config /etc/treseko/helper-installation.json \
  --root-prefix /tmp/treseko-helper-root --rollback
```

`--plan` no crea staging, directorios ni wrappers. `install` publica el
backend en `<state_dir>/<version>/` y los wrappers fijos directamente en
`<bin_dir>/`. Cada
publicación tiene primero un intent durable; si se pierde el ACK después de
publicar, la siguiente ejecución reconcilia el journal sin reconstruir ni
sobrescribir archivos ajenos. Un wrapper existente sólo puede reemplazarse si
coincide con el receipt anterior; un fichero ajeno o un symlink bloquea la
instalación. Las versiones anteriores se conservan como backups privados
inmutables con hash registrado y validado.

El journal durable contiene únicamente versión, hashes del paquete,
configuración, wrappers y binding del Python (ruta, hash, modo y tamaño). La
salida CLI devuelve receipts y hashes, nunca el contenido de configuraciones.

Un fallo antes del intent no publica nada; un fallo posterior deja la intención
para reconciliación. `rollback` también registra su fase antes de mutar y
conserva la receipt restaurada, por lo que un ACK perdido puede reintentarse de
forma segura. Rollback usa únicamente receipt, backups y binding privados ya
instalados; no necesita el paquete entrante en `cache`. Los wrappers reciben
explícitamente su configuración privada y
validan imports reales de los tres módulos con el Python operador. Esta entrega
cubre el bootstrap local y una instalación real del árbol indicado, pero no
certifica servicios legacy ni producción.

## Migrar el actualizador host antes de subir la app 1.0.6

El bridge host 1.0.6 es un helper versionado instalado por separado. Actualizar
el volumen backend de la aplicación no lo reemplaza, y el bridge 1.0.6 ignora
el descriptor de despliegue completo. Por eso un operador debe instalar
primero el helper 1.0.7, antes de permitir que esa instalación aplique el
paquete de la aplicación 1.0.7. Es un requisito del host; el actualizador
integrado en 1.0.6 no puede realizarlo por sí mismo.

1. Obtener el paquete firmado 1.0.7 y su manifest mediante el proceso aprobado
   para operadores. Conservar su firma y checksum. Colocar el manifest en la
   ruta configurada en `helper-installation.json` y el archivo en
   `<cache-configurado>/<checksum_sha256>.tar.gz`. Ambos deben seguir siendo
   privados y propiedad de root.
2. Desde el checkout público 1.0.7 revisado, construir la imagen confiable con
   `scripts/build_trusted_update_helper_image.sh`. El script prepara un contexto
   temporal con solo las fuentes permitidas e imprime el ID inmutable local de
   la imagen. Revisar y registrar en el entorno privado del operador los IDs de
   las imágenes base y de la imagen resultante.
3. Confirmar que no haya una transacción del bridge pendiente. Ejecutar
   `scripts/bootstrap_update_helpers_docker.sh` con ese ID, la configuración
   privada actual de instalación de helpers, Docker CLI, socket, red dedicada y
   root prefix configurado. El instalador verifica la firma del paquete,
   instala de forma transaccional el backend versionado y los wrappers,
   registra el receipt y conserva los datos para rollback.
4. Confirmar que el receipt informa versión `1.0.7`. Cuando esté inactivo,
   reiniciar el servicio host bridge del operador para que cargue el helper
   nuevo. Si la instalación falla, ejecutar el mismo bootstrap con
   `--rollback` y la configuración privada guardada.
5. Recién entonces ejecutar la actualización normal de la aplicación. El
   helper compatible podrá validar y reemplazar transaccionalmente el proyecto
   Compose completo.

No habilitar el paquete para instalaciones origen 1.0.6 hasta pasar este
procedimiento en un host Linux de staging con Docker, incluyendo rollback del
helper y del Compose completo. El constructor rechaza ese origen salvo que el
modo `complete-source` y la verificación del bootstrap estén activados
explícitamente. Esa variable es una atestación del release; no ejecuta esta
migración en los hosts de los clientes.
