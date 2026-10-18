# Local update helper bootstrap

<!-- Language: en -->

This bootstrap explicitly installs three fixed entrypoints locally and accepts
a fourth optional one when the host bridge is declared:

- `treseko-update-participant`
- `treseko-update-ingress`
- `treseko-update-runtime-preparation`
- `treseko-update-host-bridge` (optional; requires private spool/controller)

It is not a complete production installer and does not enable a legacy 1.0.2
installation. It does not contact Docker, PostgreSQL, services, SSH, or a VPS.
The temporary prerequisite is that the operator already has a working Python
environment and its dependencies; the bootstrap does not run `pip`, `apt`,
images, or service managers.

## Private configuration

The operator must provide a private JSON file with this contract:

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

`configs` must contain exactly the three legacy names, or those three plus
`host_bridge`. The set of Docker mounts must match exactly the same set. The
fourth wrapper uses the same Linux image and runs only `--once --spool`; it
does not receive request arguments.

`python` is an absolute executable path in the operator environment. `cache`,
`manifest`, `bin_dir`, `state_dir`, and the configurations are resolved within
`--root-prefix`. Tests use a dedicated temporary prefix; for the operational
paths shown above, the explicit prefix is `/`. `bin_dir` is public and directly
contains the fixed entrypoints; `state_dir` is private (0700) and contains the
journal, locks, backups, and versioned backend. The prefix may not contain
symlink components. Configurations are read-only, must be private regular
files, and are never copied or printed.

### Docker Compose participant configuration

With `launcher.type: "docker"`, `configs.participant` may be a private router
with the exact schema `{"schema": 1, "participants": {"backend":
"/etc/treseko/participants/backend.json", ...}}`. Each path points to a
separate private configuration and must be declared as a `ro` mount for the
`participant` helper. Do not put secrets in the router.

Each Compose runtime declares its own `runtime.active_compose_file`, for example
`/var/lib/treseko-update/active-compose/backend.json`. Never share that file
between Backend, Frontend, Engine, Automation Worker, or Plugin Runner. In
`launcher.mounts.participant`, mount the exact file `rw` if it already exists,
or its dedicated parent directory if it does not. That directory must already
exist, be root-owned, and have mode `0700`; mounting a broad ancestor is not
accepted. Existing Compose files must be regular, private, and declare the
configured service. PostgreSQL uses `runtime.type: "docker-postgres"` and does
not declare `active_compose_file`.

On the first `prepare`, before stopping the service, the driver captures the
effective original Compose model, requires its hash to match the live container,
checks that the JSON can be replayed, and atomically saves the model with mode
`0600`. The next update uses that model as its source; after activating a
verified version it persists the new Compose model and current volume
identities. A chain such as 1.0.4→1.0.5→1.0.6 therefore does not depend on
rebuilding only Frontend or on the old Compose file. Each signed package must
allow the currently installed source version in its compatibility policy. The
installer validates these paths and mounts, but it does not create the
operator's private configurations.

The package is located as:

```text
<cache>/<manifest.checksum_sha256>.tar.gz
```

Before creating the versioned backend or copying a wrapper, the signature,
checksum, size, and structure are validated through `stage_verified_package`.
The configured Python dependencies are then checked, and the three helper
modules are imported from staging with the operator's Python. That validation
does execute imports from the signed package; it does not run services, Docker,
SQL, hooks, or package managers.

## Docker-only bootstrap (optional)

When the host does not have Python, the operator can run the installer inside
a previously verified and pinned image. The script does not build, pull, or
select tags: `--image` must be a digest (`sha256:...` or
`repository@sha256:...`) that is already present and validated by
`docker image inspect`. The image must contain the trusted
`app.services.update_helper_installation` code and its actual dependencies;
the script never copies or executes a file from an incoming package before
`stage_verified_package` validates its signature.

Example operational contract (all values are private to the operator):

```bash
scripts/bootstrap_update_helpers_docker.sh \
  --image registry.example/treseko-helper-bootstrap@sha256:<digest> \
  --docker /usr/local/bin/docker \
  --socket /var/run/docker.sock \
  --network treseko-update \
  --config /var/lib/treseko-update/helper-installation.json \
  --root-prefix /var/lib/treseko-update/root
```

The JSON retains the `HelperInstallation` contract. Its `cache`, `manifest`,
`bin_dir`, `state_dir`, and the three `configs` paths are mounted in the
container at the exact destinations calculated under `root-prefix`; cache,
state, and bin are `rw`, while the manifest and configurations are `ro`. The
`launcher` configuration must match exactly the supplied image, Docker,
socket, and network. Its per-helper mounts are validated inside the image and
are mounted only at the same `source=target`, without `/`, `/root`, `/home`,
symlinks, or unsafe overlaps. The private configuration must be a regular file,
owned by root, with mode 0600 (the root container's `load_private_json` rejects
a volume owned by UID 1000). The prefix and its parents must also be real
directories, without symlink aliases; the operator must explicitly resolve
system aliases before invoking the script.

The socket is mounted explicitly because the installer validates the Docker
configuration and subsequent wrappers run Docker. This grants the container
the capabilities of the operator's socket; it must be an authorized local
socket, never a VPS or a socket shared by inference. The script does not print
the JSON or its contents; only the trusted installer produces its receipt/hash.
The image is the operator's responsibility, and no digest is published or
invented here.

The operation reuses `HelperInstallation` journal, replay, and rollback; it
does not create another installer. The host only needs the Docker CLI and
authorized access to the socket, not Python. The Docker test is opt-in and uses
its own ephemeral image; it is not equivalent to a production installation and
does not certify legacy services.

## Modes

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

`--plan` does not create staging, directories, or wrappers. `install` publishes
the backend to `<state_dir>/<version>/` and the fixed wrappers directly to
`<bin_dir>/`. Each publication first has a durable intent; if the ACK is lost
after publishing, the next run reconciles the journal without rebuilding or
overwriting unrelated files. An existing wrapper can only be replaced if it
matches the previous receipt; an unrelated file or a symlink blocks the
installation. Previous versions are retained as immutable private backups with
a recorded and validated hash.

The durable journal contains only the version, hashes of the package,
configuration, wrappers, and Python binding (path, hash, mode, and size). The
CLI output returns receipts and hashes, never the contents of configurations.

A failure before the intent publishes nothing; a subsequent failure leaves the
intent for reconciliation. `rollback` also records its phase before mutating
and preserves the restored receipt, so a lost ACK can be retried safely.
Rollback uses only the previously installed private receipt, backups, and
binding; it does not need the incoming package in `cache`. The wrappers
explicitly receive their private configuration and validate actual imports of
the three modules with the operator's Python. This delivery covers the local
bootstrap and an actual installation of the indicated tree, but it does not
certify legacy services or production.

## Migrate the host updater before upgrading app 1.0.6

The 1.0.6 host bridge is a separately installed, versioned helper. Updating the
application backend volume does not replace it, and the 1.0.6 bridge ignores
the complete-source deployment descriptor. An operator must install the 1.0.7
helper first, before allowing that installation to apply the 1.0.7 application
package. This is a host-level prerequisite; the 1.0.6 in-app updater cannot
perform it by itself.

1. Obtain the signed 1.0.7 package and manifest through the approved operator
   release process. Preserve their signature and checksum. Place the manifest
   at the path configured in `helper-installation.json` and the archive at
   `<configured-cache>/<checksum_sha256>.tar.gz`. Keep both files private and
   root-owned.
2. From the reviewed 1.0.7 public source checkout, build the trusted image with
   `scripts/build_trusted_update_helper_image.sh`. It stages a temporary context
   containing only allowlisted sources and prints the immutable local image ID.
   Review and record the base-image IDs and resulting image ID in the operator's
   private deployment record.
3. Confirm there is no pending bridge transaction. Run
   `scripts/bootstrap_update_helpers_docker.sh` with that image ID, the current
   private helper-installation config, Docker CLI, socket, dedicated network,
   and configured root prefix. The installer verifies the package signature,
   transactionally installs the versioned backend and wrappers, records a
   receipt, and retains rollback data.
4. Verify the receipt reports version `1.0.7`. While idle, restart the
   operator's host-bridge service so it loads the new versioned helper. If
   installation fails, run the same bootstrap command with `--rollback` and
   the saved private config.
5. Only then run the normal application update. The compatible helper can now
   validate and transactionally replace the complete Compose project.

Do not enable the package for 1.0.6 origins until this procedure passes on a
Linux staging host with Docker, including helper rollback and full Compose
rollback. The builder rejects that origin unless `complete-source` mode and
bootstrap verification are both explicitly enabled. That variable is a
release attestation; it does not run this migration on customer hosts.
