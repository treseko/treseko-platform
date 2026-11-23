# Updating a remote Engine

<!-- Language: en -->

Treseko distributes the application, Engine, Automation Worker, and Plugin
Runner in one signed OTA package. You do not need a separate OTA download for
each component.

## Engine on the same host as the platform

For a single-host Docker installation, the platform updater applies the
components included in the package and runs its configured health checks. See
[Updating an existing installation](UPDATE_EXISTING_INSTALLATION_DOCKER.md) for
that flow's steps and requirements.

## Engine on another host

An Engine with the update agent checks with the backend using its installed
authentication configuration, downloads its component, stages a local release,
and activates it when no jobs are active. The Engine reports its version
through its health endpoint. Check each remote Engine separately; completing a
backend update does not prove that other hosts have converged.

### Linux systemd Engine that predates the agent

The OTA includes `scripts/bootstrap_remote_component_from_ota.sh` to install
the Engine from the same file during a maintenance window:

```bash
sudo bash scripts/bootstrap_remote_component_from_ota.sh \
  --ota /path/treseko-update-v1.0.8.tar.gz \
  --component engine \
  --runtime-root /path/to/current/engine \
  --service treseko-engine
```

### Engine in local Docker on Linux

Run the Docker bootstrap on the host that manages the container and persistent
volume:

```bash
sudo bash scripts/bootstrap_remote_docker_component_from_ota.sh \
  --ota /path/treseko-update-v1.0.8.tar.gz \
  --component engine \
  --container engine-container-name \
  --maintenance-window-confirmed
```

Use the arguments, requirements, and script version included in your OTA
package. Confirm the runtime path or container and persistent storage before
applying the change. In particular, the Docker bootstrap for older Engines
requires a maintenance window because it may stop the container while
activating the new release.

The bootstraps update the component on the existing host; they do not reinstall
the platform or require another OTA file. Do not assume they cover Docker
contexts, disconnected hosts, or other operating systems.

## Verification and recovery

1. Confirm the service or container is running.
2. Query the Engine's `/health` endpoint and verify the reported version.
3. Confirm in Treseko that the Engine is available for work again.
4. Review logs if the process does not start or report the expected version.

Do not consider the update complete merely because the backend was updated.
Keep the previous runtime and persistent data until the Engine on every remote
host has been verified.
