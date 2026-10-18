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

Signed `deployment.mode=complete-source` packages are staged and validated by the trusted host updater, then applied through the atomic Compose installer. The configuration requires a private `atomic_compose` binding with a local project name, the existing `project_root`, and an `env_file` inside that root. The project root is mounted read-only for inventory and rollback; controller state is writable; the Docker socket is available only to the trusted helper. Persistent volumes and environment configuration stay outside the code replacement. Only single-host Docker installations are supported by this adapter.

The private binding uses this shape:

```json
{
  "schema": 1,
  "project": "treseko",
  "project_root": "/opt/treseko",
  "env_file": "<project-root>/.env"
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
