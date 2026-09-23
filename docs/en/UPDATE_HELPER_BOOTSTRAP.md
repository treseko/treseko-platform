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
