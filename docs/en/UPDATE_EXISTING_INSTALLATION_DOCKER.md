# Docker-only CLI for an existing installation

<!-- Language: en -->

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
