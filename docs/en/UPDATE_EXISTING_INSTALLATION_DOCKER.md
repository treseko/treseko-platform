# Docker-only CLI for an existing installation

<!-- Language: en -->

## 1.0.6 configuration compatibility

Settings → Updates replaces the runtime components and migrations declared by
the package; it does not overwrite the host's `docker-compose.prod.yml`. Runtime
1.0.7 remains compatible with the 1.0.6 Compose file for the internal MCP
resolver and persists its spool/evidence in volumes already present.

For a local installation that must also receive the complete Compose file from
the new release, run `scripts/install_local_treseko.sh --update` (or the
equivalent PowerShell installer) from that release's checkout. This flow
validates the candidate Compose model, stores an immutable release and volume
backups, stops the project, applies migrations, and starts all candidate
services. If it fails before the release is committed, it restores the previous
Compose/images and data backups. Do not copy the Compose file over a running
project by hand. Settings → Updates does not install the host Compose file.

This wrapper runs the fixed `app.services.update_existing_installation` module
in the trusted image. It does not use Python, `awk`, or `sed` from the host, does
not install a venv, and does not mount the workspace. The image, Docker CLI,
socket, and network are passed explicitly, and the private launcher must repeat
those exact values.

The example is parameterized and is not runnable until the image and paths are
replaced with existing, verified inputs:

```bash
scripts/update_existing_installation_docker.sh status \
  --launcher-config /var/lib/treseko-update/operator-launcher.json \
  --image sha256:REPLACE_WITH_INSPECTED_IMAGE_ID \
  --docker /usr/bin/docker \
  --socket /var/run/docker.sock \
  --network treseko-update \
  --config /var/lib/treseko-update/controller.json
```

The launcher has exactly `type`, `docker`, `image`, `socket`, `network`, and
`mounts`. Each mount declares `source`, `target`, `mode`, and `purpose`, with
`source == target`. It must explicitly include `launcher`, readonly
`controller`, `state`, `cache`, and `socket`; the socket is `rw`, `manifest` is
readonly for `plan/prepare/apply/resume`, and `package` is readonly only for
`prepare`. SSH configuration, known_hosts, and required keys are mounted as
separate readonly inputs. `/`, `/root`, `/home`, `/workspace`, mutable aliases,
and broad mounts are not accepted.

The preflight runs inside the trusted image with network `none` and a readonly
filesystem. It checks launcher binding, paths, modes, ownership, image digest,
and mounts before starting the CLI. The final execution uses
`/usr/local/bin/python`, `PYTHONDONTWRITEBYTECODE=1`, an explicit `DOCKER_HOST`,
and only the existing `plan`, `prepare`, `apply`, `resume`, and `status` actions.

The systemd templates for the host bridge remain parameterized. The installed
wrapper takes no arguments: it internally invokes `--once --spool` with fixed
configuration. Those flags must not be run as external wrapper arguments, and
the templates must not be considered ready until their placeholders have been
replaced and bindings/permissions have been validated.

## Complete Compose replacement and 1.0.6 compatibility

Signed `deployment.mode=complete-source` packages are staged and validated by the trusted host updater, then applied through the atomic Compose installer. The private `atomic_compose` binding includes a local project name, the existing `project_root`, an `env_file`, and the operator's `owner_uid`. The project root may be owned by that UID or by root, but group and other users must not be able to write it. The environment file may live outside the project root if it is a private regular file, readable by the helper, and mounted read-only as `atomic-env`. The helper's effective UID is not used to infer the installation owner because the helper normally runs as root.

The controller's `directory` is also the stable state root for the atomic updater. It must be a dedicated private directory mounted read-write. The updater stores its active-release pointer, transaction journal, and recovery state there; it must never derive this root from a temporary staging directory. The project root remains mounted read-only for inventory and rollback, the external environment file is mounted read-only when needed, and the Docker socket is available only to the trusted helper. Persistent volumes and environment configuration stay outside the code replacement. Only single-host Docker installations are supported by this adapter.

The private binding uses this shape:

```json
{
  "schema": 1,
  "project": "treseko",
  "project_root": "/opt/treseko",
  "env_file": "/opt/treseko/compose.production.env",
  "owner_uid": 1000
}
```

Installations that use a coordinated helper must prepare and verify a compatible
helper before applying a `complete-source` package. Bootstrap installs the
versioned helper without restarting Treseko services or replacing Compose.
Settings -> Updates then applies the complete package. Legacy installations
without a coordinator must migrate to the coordinator or use the local Compose
installer with `--update` / `-Update`.

Linux bootstrap QA uses the real helper-installation code with a temporary
prefix; it does not install host wrappers or simulate a UI session. Publication
validation also requires checking Settings -> Updates on an isolated
installation.

## Migrating a legacy installation to 1.0.8

The complete package includes a host-side migration tool and an adapter that
prepares its private Python environment. Linux and macOS require Python 3.11+,
`venv`, local Docker Compose, and PyPI access to install the pinned dependencies.
The script does not modify global Python. Windows support is limited to WSL 2
with Docker Desktop and WSL integration enabled; the adapter registers a
scheduled task to start the coordinator. Native Windows Docker and the
VMM/Hyper-V backend are not covered.

The selected WSL user must access `/var/run/docker.sock`, have a working
`systemctl --user` bus, and have linger enabled. On minimal Ubuntu WSL images,
install `dbus-user-session` once and restart the distro if the bus is missing;
the adapter reports this prerequisite but does not install OS packages or
change linger automatically.

Migration accepts only the signed 1.0.7 -> 1.0.8 upgrade and a single-host local
Compose installation. Before changing services, it verifies the signature,
checksum, internal manifest, and project identity. It then uses the
transactional Compose updater and installs the coordinator after confirming
the new version. Persistent volumes and private configuration are preserved.
If the application update committed but only coordinator installation failed,
the command can be run again with the same files.

The package builder produces `treseko-update-v1.0.8-single-file.tar` beside
the OTA `.tar.gz`. The bundle contains the OTA archive and its signed manifest.
Download only the bundle, extract its two layers into a temporary directory,
and run the included adapter with the bundle path; you no longer need a
separate manifest download or argument.

Linux/macOS:

```bash
bundle=/path/to/treseko-update-v1.0.8-single-file.tar
work="$(mktemp -d)"
tar -xf "$bundle" -C "$work"
mkdir "$work/release"
tar -xzf "$work/treseko-update-v1.0.8.tar.gz" -C "$work/release"
bash "$work/release/source-release/scripts/bootstrap_host_update_coordinator.sh" migrate \
  --install-root /path/to/treseko \
  --env-file /path/to/compose.production.env \
  --docker "$(command -v docker)" \
  --package "$bundle"
```

On macOS, use `bootstrap_host_update_coordinator_macos.sh` instead. On Windows,
extract both layers with `tar.exe` and run the included PowerShell adapter:

```powershell
$Bundle = 'C:\path\to\treseko-update-v1.0.8-single-file.tar'
$Work = Join-Path $env:TEMP 'treseko-update-1.0.8'
New-Item -ItemType Directory -Force -Path $Work | Out-Null
tar.exe -xf $Bundle -C $Work
$Release = Join-Path $Work 'release'
New-Item -ItemType Directory -Force -Path $Release | Out-Null
tar.exe -xzf (Join-Path $Work 'treseko-update-v1.0.8.tar.gz') -C $Release
& (Join-Path $Release 'source-release/scripts/bootstrap_host_update_coordinator.ps1') migrate `
  -InstallRoot 'C:\path\to\treseko' `
  -EnvFile 'C:\path\to\compose.production.env' `
  -Package $Bundle
```

The adapter validates the embedded manifest signature and OTA checksum before
applying changes. The optional `--manifest` / `-Manifest` argument remains
available for installations that already have both files. Download and
extract the bundle only from an official Treseko channel. A legacy 1.0.7
installation still needs this host-side adapter; its old in-app update button
cannot start the migration by itself.

If Treseko is installed inside the WSL Linux filesystem, pass Linux paths
directly to `-InstallRoot` and `-EnvFile` (for example, `/home/jose/treseko`
and `/home/jose/treseko/compose.production.env`). The adapter resolves them
inside the distribution and does not need access through `\\wsl.localhost`.
The downloaded bundle can remain at a Windows path.

Package inclusion is necessary, but 1.0.7 support should only be enabled after
testing a real installation and recovery on every declared platform. Unit and
static checks are not end-to-end evidence.
