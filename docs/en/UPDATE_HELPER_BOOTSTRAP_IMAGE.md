<!-- Language: en -->

# Trusted local image for helper bootstrap

This recipe builds a local operator image to run the Docker-only installer
without relying on the host's Python. It is not a published image and does not
certify a legacy installation or Treseko services. The installer continues to
validate the signature, checksum, size, and structure of the incoming package
before creating a versioned backend or wrappers; the Dockerfile contains only
trusted bootstrap code and its dependencies.

## Reproducible local build

Use explicit base tags, never `latest`, and a unique local tag:

```bash
BASE_TAG=python:3.12-slim-bookworm
COMPOSE_TAG=docker/compose-bin:v5.4.0
LOCAL_TAG=treseko-helper-bootstrap:local-$(uuidgen | tr '[:upper:]' '[:lower:]')
BASE_IMAGE="$BASE_TAG" COMPOSE_IMAGE="$COMPOSE_TAG" \
  scripts/build_trusted_update_helper_image.sh "$LOCAL_TAG"
```

The builder creates a temporary context containing only allowlisted `COPY`
files; it does not send the rest of the checkout to Docker. Before using the
image, inspect and record the resolved ID locally:

```bash
docker image inspect --format '{{.Id}}' "$LOCAL_TAG" | tee .treseko-helper-bootstrap-image-id
docker image inspect --format '{{.Id}}' "$BASE_TAG"
docker image inspect --format '{{.Id}}' "$COMPOSE_TAG"
docker image inspect --format '{{json .RepoDigests}}' "$LOCAL_TAG"
docker run --rm --entrypoint /usr/local/bin/python "$LOCAL_TAG" -c \
  'import sys; print(sys.version); import docker, cryptography, sqlalchemy'
docker run --rm --entrypoint /bin/sh "$LOCAL_TAG" -c \
  'command -v docker; docker --version; docker compose version; command -v ssh; ssh -V'
docker run --rm --entrypoint /usr/local/bin/python "$LOCAL_TAG" -c \
  'import asyncio; from sqlalchemy.ext.asyncio import create_async_engine; exec("async def f():\n e=create_async_engine(\"postgresql+asyncpg://bootstrap_user@127.0.0.1/bootstrap_db\")\n await e.dispose()") ; asyncio.run(f())'
```

The ID file and any `inspect` output are local build evidence, not a published
digest. An operator must pass the bootstrap an already inspected immutable
reference (`repo@sha256:...` or `sha256:...`) and the explicitly authorized
Docker CLI and socket. The included Linux CLI is the one used by the helpers
inside the image; the external CLI only controls the container.

The Python allowlist is located at
`scripts/update-runtime/bootstrap/helper-modules.txt` and is reflected in the
explicit `COPY` instructions. It includes the coordinator, helper installer,
and `host_bridge` modules with complete Compose support. The
`scripts/build_trusted_update_helper_image.sh` builder creates a temporary
context containing only those files and the Dockerfile.

## Dependencies and boundaries

The image pins Python 3.12, installs `cryptography`, `SQLAlchemy`, and `asyncpg`
from the helpers' environment, obtains the Docker CLI and `openssh-client` from
the base distribution repositories, and adds Compose v2 from the explicit
Linux image `docker/compose-bin:v5.4.0`. The SQLAlchemy smoke test only creates
and disposes of a `postgresql+asyncpg` engine against a dummy URL; it does not
open a connection. The build may use `pip`/`apt` to create the image, but it
does not run them during package validation or install anything on the host. It
does not mount the Docker socket or start PostgreSQL or services during
validation. The socket and network are granted only during the final bootstrap
execution when the private configuration declares them and the operator
authorizes them.

The Docker test uses an ephemeral Ed25519 key only in a temporary test context
to sign the fixture. It replaces the trust anchor only in that generated
context, preserves the recipe, and verifies its real imports/dependencies; it
does not represent the embedded production key or publish an image.
