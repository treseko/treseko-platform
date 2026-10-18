#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKER_BIN="${DOCKER_BIN:-docker}"
BASE_IMAGE="${BASE_IMAGE:-python:3.12-slim-bookworm}"
COMPOSE_IMAGE="${COMPOSE_IMAGE:-docker/compose-bin:v5.4.0}"
IMAGE_TAG="${1:-}"

if [[ -z "${IMAGE_TAG}" || "${IMAGE_TAG}" == *[[:space:]]* ]]; then
  echo "usage: $0 LOCAL_IMAGE_TAG" >&2
  exit 2
fi
for image in "${BASE_IMAGE}" "${COMPOSE_IMAGE}"; do
  if [[ "${image}" == *:latest || "${image}" != *@sha256:* && "${image}" != *:* ]]; then
    echo "BASE_IMAGE and COMPOSE_IMAGE must use explicit non-latest tags or digests" >&2
    exit 2
  fi
done
command -v "${DOCKER_BIN}" >/dev/null 2>&1 || {
  echo "Docker CLI is unavailable" >&2
  exit 1
}

context="$(mktemp -d "${TMPDIR:-/tmp}/treseko-helper-image.XXXXXX")"
trap 'rm -rf "${context}"' EXIT HUP INT TERM
while IFS= read -r relative || [[ -n "${relative}" ]]; do
  [[ -n "${relative}" && "${relative}" != \#* ]] || continue
  [[ "${relative}" != /* && "${relative}" != *..* ]] || {
    echo "unsafe helper allowlist entry" >&2
    exit 1
  }
  source="${ROOT}/${relative}"
  [[ -f "${source}" && ! -L "${source}" ]] || {
    echo "allowlisted helper source is missing or symlinked" >&2
    exit 1
  }
  mkdir -p "${context}/$(dirname "${relative}")"
  cp -p "${source}" "${context}/${relative}"
done < "${ROOT}/scripts/update-runtime/bootstrap/helper-modules.txt"
cp -p "${ROOT}/scripts/update-runtime/bootstrap/Dockerfile" "${context}/Dockerfile"

"${DOCKER_BIN}" build \
  --build-arg "BASE_IMAGE=${BASE_IMAGE}" \
  --build-arg "COMPOSE_IMAGE=${COMPOSE_IMAGE}" \
  --tag "${IMAGE_TAG}" \
  --file "${context}/Dockerfile" \
  "${context}"
"${DOCKER_BIN}" image inspect --format '{{.Id}}' "${IMAGE_TAG}"
