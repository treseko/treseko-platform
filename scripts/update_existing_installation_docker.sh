#!/usr/bin/env bash
set -euo pipefail

usage() {
    echo "usage: $0 ACTION --launcher-config PATH --image IMMUTABLE --docker PATH --socket PATH --network NAME --config PATH [--manifest PATH] [--package PATH] [--transaction ID]" >&2
    exit 2
}

[[ $# -ge 1 ]] || usage
action=$1
case "$action" in plan|prepare|apply|resume|status) ;; *) usage ;; esac
shift
launcher_config= image= docker= socket= network= controller_config= manifest= package= transaction=
while [[ $# -gt 0 ]]; do
    case "$1" in
        --launcher-config) [[ $# -ge 2 ]] || usage; launcher_config=$2; shift 2 ;;
        --image) [[ $# -ge 2 ]] || usage; image=$2; shift 2 ;;
        --docker) [[ $# -ge 2 ]] || usage; docker=$2; shift 2 ;;
        --socket) [[ $# -ge 2 ]] || usage; socket=$2; shift 2 ;;
        --network) [[ $# -ge 2 ]] || usage; network=$2; shift 2 ;;
        --config) [[ $# -ge 2 ]] || usage; controller_config=$2; shift 2 ;;
        --manifest) [[ $# -ge 2 ]] || usage; manifest=$2; shift 2 ;;
        --package) [[ $# -ge 2 ]] || usage; package=$2; shift 2 ;;
        --transaction) [[ $# -ge 2 ]] || usage; transaction=$2; shift 2 ;;
        *) usage ;;
    esac
done

[[ -n "$launcher_config" && -n "$image" && -n "$docker" && -n "$socket" &&
   -n "$network" && -n "$controller_config" ]] || usage
if [[ "$action" == status ]]; then
    [[ -z "$manifest" && -z "$package" && -z "$transaction" ]] || usage
else
    [[ -n "$manifest" && -n "$transaction" ]] || usage
    if [[ "$action" == prepare ]]; then [[ -n "$package" ]] || usage
    else [[ -z "$package" ]] || usage
    fi
fi

for value in "$launcher_config" "$docker" "$socket" "$controller_config" "$manifest" "$package"; do
    [[ -z "$value" || ("$value" = /* && "$value" != *$'\n'* && "$value" != *$'\r'* && "$value" != *$'\t'* && "$value" != *,*) ]] || {
        echo "invalid operator path" >&2; exit 2;
    }
done
[[ "$image" == sha256:* || "$image" == *@sha256:* ]] || { echo "immutable image required" >&2; exit 2; }
[[ "$network" != host && "$network" != none && "$network" != *[^A-Za-z0-9_.-]* ]] || {
    echo "dedicated Docker network required" >&2; exit 2;
}
[[ -f "$launcher_config" && ! -L "$launcher_config" && -x "$docker" && -S "$socket" ]] || {
    echo "launcher paths unavailable" >&2; exit 2;
}

launcher_config=$(CDPATH= cd -- "$(dirname -- "$launcher_config")" && pwd)/$(basename -- "$launcher_config")
controller_config=$(CDPATH= cd -- "$(dirname -- "$controller_config")" && pwd)/$(basename -- "$controller_config")
[[ -z "$manifest" ]] || manifest=$(CDPATH= cd -- "$(dirname -- "$manifest")" && pwd)/$(basename -- "$manifest")
[[ -z "$package" ]] || package=$(CDPATH= cd -- "$(dirname -- "$package")" && pwd)/$(basename -- "$package")

tmp_root=$(mktemp -d "${TMPDIR:-/tmp}/treseko-existing-docker.XXXXXX")
cleanup() { rm -rf "$tmp_root"; }
trap cleanup EXIT HUP INT TERM

DOCKER_HOST="unix://$socket" "$docker" image inspect --format '{{.Id}}' "$image" > "$tmp_root/image-id"
image_id=$(<"$tmp_root/image-id")
[[ "$image_id" == sha256:* ]] || { echo "image inspection did not return an ID" >&2; exit 2; }

preflight=(run --rm --network none --read-only --entrypoint /usr/local/bin/python)
preflight+=(--mount "type=bind,src=$launcher_config,dst=$launcher_config,readonly")
preflight+=("$image_id" -m app.services.update_existing_installation_docker_preflight)
preflight+=(--launcher-config "$launcher_config" --image "$image" --docker "$docker"
            --socket "$socket" --network "$network" --action "$action"
            --config "$controller_config" --manifest "${manifest:-}" --package "${package:-}")
DOCKER_HOST="unix://$socket" "$docker" "${preflight[@]}" > "$tmp_root/mounts"

mount_args=()
while IFS=$'\t' read -r source target mode purpose; do
    [[ -n "$source" && "$source" == "$target" && ( "$mode" == ro || "$mode" == rw ) ]] || {
        echo "invalid validated mount" >&2; exit 2;
    }
    [[ -e "$source" && ! -L "$source" ]] || { echo "mount source unavailable: $source" >&2; exit 2; }
    resolved=$(realpath "$source")
    [[ "$resolved" == "$source" ]] || { echo "mount source has symlink components" >&2; exit 2; }
    option="type=bind,src=$source,dst=$target"
    [[ "$mode" == ro ]] && option+=",readonly"
    mount_args+=(--mount "$option")
done < "$tmp_root/mounts"

[[ -s "$tmp_root/mounts" ]] || { echo "launcher has no mounts" >&2; exit 2; }

# Re-run the trusted preflight with every declared source mounted. This checks
# private ownership/modes and rejects symlinked files inside the image before
# the real CLI is started. Writable state/cache mounts stay readonly here.
preflight=(run --rm --network none --read-only --entrypoint /usr/local/bin/python)
while IFS=$'\t' read -r source target mode purpose; do
    preflight+=(--mount "type=bind,src=$source,dst=$target,readonly")
done < "$tmp_root/mounts"
preflight+=("$image_id" -m app.services.update_existing_installation_docker_preflight)
preflight+=(--launcher-config "$launcher_config" --image "$image" --docker "$docker"
            --socket "$socket" --network "$network" --action "$action"
            --config "$controller_config" --manifest "${manifest:-}" --package "${package:-}" --strict)
DOCKER_HOST="unix://$socket" "$docker" "${preflight[@]}" >/dev/null

cli_args=("$action" --config "$controller_config")
[[ -z "$manifest" ]] || cli_args+=(--manifest "$manifest")
[[ -z "$package" ]] || cli_args+=(--package "$package")
[[ -z "$transaction" ]] || cli_args+=(--transaction "$transaction")

DOCKER_HOST="unix://$socket" exec "$docker" run --rm -i --network "$network" \
    --read-only --entrypoint /usr/local/bin/python \
    --env PYTHONDONTWRITEBYTECODE=1 --env "DOCKER_HOST=unix://$socket" \
    "${mount_args[@]}" "$image_id" -m app.services.update_existing_installation \
    "${cli_args[@]}"
