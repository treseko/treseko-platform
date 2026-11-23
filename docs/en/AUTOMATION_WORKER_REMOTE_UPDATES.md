# Updating remote Automation Workers

<!-- Language: en -->

This guide explains how to keep an Automation Worker installed on another host
on the same Treseko version. The application, Engine, Automation Worker, and
Plugin Runner are distributed together in the platform OTA package; there is no
separate download package for each component.

## How it works

Workers that include the update client check with the backend before requesting
new jobs. If the server requires a different version or build, the Worker waits
for active work to finish and pending results to be resolved. It then downloads
the component package through the authenticated API, checks the available
integrity data, stages a versioned release, and switches to it. The Worker
reports its version in its next heartbeat. While a Worker reports an
incompatible version, the backend does not assign it new work.

Each remote Worker updates independently. An updated backend does not confirm
that other hosts have finished; check each Worker's version and heartbeat in
Treseko.

## Workers that predate the updater

An older Worker cannot start its own update. For Linux hosts using systemd or
local Docker, the OTA includes bootstrap tools that install the component from
the same file. Run the bootstrap on the host where the Worker runs, during a
maintenance window:

```bash
sudo bash scripts/bootstrap_remote_component_from_ota.sh \
  --ota /path/treseko-update-v1.0.8.tar.gz \
  --component automation-worker \
  --runtime-root /path/to/current/worker \
  --service treseko-worker \
  --api-base https://treseko.example/api \
  --runner-token-file /path/to/persistent/.runner-token
```

For a Worker running in Docker on Linux, use the Docker bootstrap from the host
that manages the container and its persistent volume:

```bash
sudo bash scripts/bootstrap_remote_docker_component_from_ota.sh \
  --ota /path/treseko-update-v1.0.8.tar.gz \
  --component automation-worker \
  --container worker-container-name \
  --api-base https://treseko.example/api \
  --runner-token-file /path/to/persistent/.runner-token
```

Use the version and arguments that match your OTA and installation. Before
running it, check the help for the script included in that package, the actual
runtime path, service/container name, and the configured organization and token.
The host needs access to the backend and package registry, along with the
requirements listed by the script. The systemd and local Docker bootstraps
cover Linux; they do not imply that the server can administer a disconnected
remote host.

The bootstraps stage a versioned release and preserve the Worker's persistent
data, including its identity and credential. A code update is not a new pairing.
If a token was revoked, complete the approved pairing flow in Treseko first;
pairing alone does not install code.

## Situations that need attention

- **Disconnected Worker:** it cannot check for or download an update. When it
  reconnects, check its heartbeat and version before assigning work.
- **Multiple Workers or hosts:** validate each identity separately. The
  platform does not declare a fleet converged until every expected Worker
  reports the target version.
- **Busy installation:** wait for active jobs and pending deliveries to finish
  before switching releases.
- **Download, integrity, dependency, or restart error:** review the Worker and
  supervisor logs. Do not consider the update complete until a valid heartbeat
  reports the expected version.
- **Remote Docker or non-Linux systems:** this guide does not guarantee an
  automatic update. Use that host's management mechanism and validate the
  result before resuming executions.

## Post-update checks

1. Confirm that the process and service/container are running.
2. Confirm the recent heartbeat, product version, and Worker status in Treseko.
3. Run an appropriate verification case for that Worker.
4. Repeat the checks for every independent host and Worker.

Do not remove the previous runtime or persistent data until the new Worker has
accepted work and no results remain to be delivered.
