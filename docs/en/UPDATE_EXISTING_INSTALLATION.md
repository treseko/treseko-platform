# CLI for updating an existing installation

<!-- Language: en -->

Status: **local orchestration deliverable; it is not rollout certification or
production readiness**.

## Flow

It uses the controller's combined private configuration (`participants`,
`runtime_hosts`, orders, gates, and `installation_topology`) and a signed manifest.
The helper installer already exists as a
separate component; this wrapper does not run it, configure SSH, or automatically
create the complete legacy 1.0.2 bootstrap/protocol.

A complete example, deliberately not plug-and-play, is available at
[`docs/examples/update-installation-controller.example.json`](../examples/update-installation-controller.example.json).
It contains the five required components and three remote participants
(Engine, Worker, and PostgreSQL): Engine and Worker use the runtime SSH alias, and
PostgreSQL uses a separate SSH alias. It includes placeholders for identities,
checksum, and private paths, and contains no secrets. The example is consumed by
`update_existing_installation`; it is not JSON intended directly for the generic CLI
because `installation_topology` is a wrapper section that is validated before
projecting the controller configuration.
Its `quiesce_order` is explicitly `worker -> engine -> backend -> frontend
-> postgres`: PostgreSQL is drained last because the PG participant requires
Worker and Engine to already be quiesced.

```text
plan    -> read-only validation of participants, gates, and runtime_hosts
prepare -> plan -> distribute the signed local file -> prepare-runtimes
apply   -> only with prepare complete and matching identities -> run
resume  -> only a journal with apply attempted -> reconciliation run
status  -> read local journals
```

Example:

```bash
scripts/update_existing_installation.sh plan \
  --config /etc/treseko/update/controller.json \
  --manifest /var/lib/treseko/update/manifest.json \
  --transaction tx-1

scripts/update_existing_installation.sh prepare \
  --config /etc/treseko/update/controller.json \
  --manifest /var/lib/treseko/update/manifest.json \
  --package /var/lib/treseko/update/release.tar.gz \
  --transaction tx-1

scripts/update_existing_installation.sh apply \
  --config /etc/treseko/update/controller.json \
  --manifest /var/lib/treseko/update/manifest.json \
  --transaction tx-1

scripts/update_existing_installation.sh resume \
  --config /etc/treseko/update/controller.json \
  --manifest /var/lib/treseko/update/manifest.json \
  --transaction tx-1

scripts/update_existing_installation.sh status \
  --config /etc/treseko/update/controller.json \
  --transaction tx-1
```

`apply` and `resume` do not accept a package. `status` only reads the namespaced
journal in `<controller-directory>/existing-installation/`.

For a host without operator-side Python, `scripts/update_existing_installation_docker.sh`
is available. It runs the same CLI module in the trusted image, with a private
launcher and explicit mounts; it does not install a virtualenv or mount the
workspace. The parameterized example is in
`docs/UPDATE_EXISTING_INSTALLATION_DOCKER.md` and is not runnable until its
placeholders are replaced.

When the ingress gate uses `callback_drain: true`, the authenticated flow is:

```text
acquire -> authenticated callback drain -> workers/Engine quiesced
        -> seal/assert_sealed -> backups/snapshot -> apply/verify
        -> global activate -> gate release
```

The example's `control` bind (`/var/lib/treseko-update/gates/ingress`) must
already exist on the Docker host and correspond to the actual HTML bind of the
independent Nginx proxy, with `frontend/nginx.conf` and the callback routes
already installed. The controller does not create the directory, bind,
proxy, or that configuration file; nor should a local controller path be assumed
to be the filesystem of a remote host. `callback_drain`
preserves the authenticated POST routes during draining, and `seal` must
be confirmed before taking the backup. The gate is released only after
all participants complete `activate` and the global decision has been made.

## Preconditions and security

- The local package must be signed and match the manifest; `distribute`
  validates checksum/size through the controller.
- The runtime cache must have been distributed or preinstalled beforehand where
  each helper requires it. The wrapper does not invent an additional transfer.
- `prepare` does not perform quiesce, apply, start, or activate.
- `apply` validates the plan, gates, and inventory again before persisting the
  apply intent. If a matching host, component, gate, or identity is missing,
  it does not call `run`.
- The journal pins configuration, release, and transaction hashes, and persists
  intent before every mutating call. JSON errors are generic and do not
  store secrets or remote diagnostics.
- A lost ACK during `apply` leaves `apply_uncertain`; `resume` calls only
  `run` with the same transaction. It does not redistribute, rebuild, or restart the
  process from scratch.
- If a phase fails after the transaction begins, the controller preserves
  the evidence and runs automatic rollback before reopening admission when
  appropriate. There is no manual rollback command in this CLI. A
  `recovery_pending` state requires correcting the operational cause and running `resume`
  with the same transaction; a different transaction must not be started, nor should a
  manual restoration be performed.

## Operator prerequisites

The example is not a plug-and-play configuration. Before using it, the operator
must replace the placeholders and have:

- helpers installed at the configured absolute paths;
- executable, permissions, and private directories for the controller and each host;
- operator SSH configuration with strict `known_hosts`, valid aliases, and
  access tested outside this CLI;
- actual SSH connectivity to the three remote participants (Engine, Worker, and
  PostgreSQL), with both declared aliases and fixed helpers installed;
- the real SHA-256 `helper_identity` for each runtime host;
- existing gates, private paths, runtime cache, and configuration files;
- for `ai-queue-local`, a private, operator-owned `database_url_file`
  with a valid `postgresql+asyncpg://...` URL and actual TCP connectivity from
  the controller to the specified PostgreSQL database. The DB host's SSH alias does
  not by itself prove that connectivity or replace the PostgreSQL network;
- for `docker-host-bind`, an independent container/proxy already running,
  with verified labels/project/service/ID, the exact HTML bind, and a private
  control directory without group/other write permissions;
- a signed manifest and local package that match exactly.

Credentials are never written inline in JSON, commands, or documentation. The
`ai-queue-local` gate pauses the internal scheduler through the PostgreSQL database and
remains closed until all participants complete `activate`; this ensures
the backend cannot issue jobs before Engine and Worker are available.

The documented flow does not contact hosts during `plan` except for local
SSH configuration resolution (`ssh -G`); it does not run `apply` as part of
validating the example. It remains a private, non-plug-and-play example: it requires
bootstrap, proxy/bind, helpers, SSH configuration, and PostgreSQL connectivity
prepared by the operator.

## Current limitations

The complete legacy bootstrap/protocol for 1.0.2 installations, actual
multihost deployment, and production rollout remain outside this deliverable. The
preparation configuration is generated through `runtime_preparation_config`;
this CLI does not manually edit SHA values or PostgreSQL adapter parameters.

The internal PostgreSQL, backend-admission, and coordination contracts are
enforced by the runtime, but they do not turn this flow into a certified rollout.
Environment review and testing are required before any operational use.
