#!/bin/sh
set -eu

usage() {
    echo "usage: $0 --image IMAGE --docker PATH --socket PATH --network NAME --config PATH --root-prefix PATH" >&2
    exit 2
}

image= docker= socket= network= config= root_prefix= action=install
while [ "$#" -gt 0 ]; do
    case "$1" in
        --image) image=${2-}; shift 2 ;;
        --docker) docker=${2-}; shift 2 ;;
        --socket) socket=${2-}; shift 2 ;;
        --network) network=${2-}; shift 2 ;;
        --config) config=${2-}; shift 2 ;;
        --root-prefix) root_prefix=${2-}; shift 2 ;;
        --rollback) action=rollback; shift ;;
        *) usage ;;
    esac
done

printf '%s' "$image" | grep -Eq '^(sha256:[0-9a-f]{64}|[^@[:space:]]+@sha256:[0-9a-f]{64})$' || usage

safe_path() {
    case "$1" in
        /*) ;;
        *) echo "path must be absolute" >&2; exit 2 ;;
    esac
    case "$1" in
        /|/root|/home|/Users|/workspace|/workspaces|*"/../"*|*/..|*","*|*"|"*)
            echo "unsafe path" >&2; exit 2 ;;
    esac
    current=$1
    while [ "$current" != "/" ]; do
        [ ! -L "$current" ] || { echo "symlink path component is not accepted" >&2; exit 2; }
        parent=${current%/*}
        current=${parent:-/}
    done
}

safe_path "$docker"
safe_path "$socket"
safe_path "$config"
safe_path "$root_prefix"
case "$network" in ""|*[!A-Za-z0-9_.-]*) echo "invalid network" >&2; exit 2 ;; esac
[ -x "$docker" ] && [ -S "$socket" ] && [ -f "$config" ] && [ -d "$root_prefix" ] || {
    echo "Docker paths or private config are unavailable" >&2; exit 2;
}

image_id=$(DOCKER_HOST="unix://$socket" "$docker" image inspect --format '{{.Id}}' "$image") || {
    echo "immutable operator image is not present" >&2; exit 2;
}
case "$image_id" in sha256:*) ;; *) echo "Docker inspect returned no image ID" >&2; exit 2 ;; esac

mounts_file=$(mktemp "${TMPDIR:-/tmp}/treseko-bootstrap.XXXXXX")
trap 'rm -f "$mounts_file"' EXIT HUP INT TERM

DOCKER_HOST="unix://$socket" "$docker" run --rm --network none --read-only \
    --entrypoint /usr/local/bin/python "$image" -c \
    'import sys; assert sys.version_info >= (3, 8)' >/dev/null

set -- run --rm --network none --read-only --entrypoint /usr/local/bin/python
set -- "$@" --mount "type=bind,src=$config,dst=$config,readonly"
set -- "$@" "$image" -c 'import sys
from pathlib import Path
from app.services.update_participant_commands import load_private_json
cfg=load_private_json(Path(sys.argv[1]))
root=Path(sys.argv[2])
def mapped(value):
    if (not isinstance(value,str) or not value.startswith("/") or ".." in Path(value).parts
            or value in {"/","/root","/home","/Users","/workspace","/workspaces"}
            or any(char in value for char in (",","\n","\r","|"))): raise SystemExit(10)
    return str(root / value.lstrip("/"))
keys=("cache","manifest","bin_dir","state_dir")
if any(not isinstance(cfg.get(k),str) for k in keys): raise SystemExit(11)
legacy={"participant","ingress","runtime_preparation"}
config_names=set(cfg["configs"]) if isinstance(cfg.get("configs"),dict) else set()
if config_names not in (legacy, legacy|{"host_bridge"}): raise SystemExit(12)
for key in keys: print("CORE|%s|%s"%(key,mapped(cfg[key])))
for key in sorted(config_names): print("CORE|config:%s|%s"%(key,mapped(cfg["configs"][key])))
launch=cfg.get("launcher")
if not isinstance(launch,dict) or launch.get("type") != "docker": raise SystemExit(13)
for key,arg in (("docker",sys.argv[3]),("socket",sys.argv[4]),("network",sys.argv[5]),("image",sys.argv[6])):
    if launch.get(key) != arg: raise SystemExit(14)
mounts=launch.get("mounts")
if not isinstance(mounts,dict) or set(mounts) != config_names: raise SystemExit(15)
seen=set()
for entries in mounts.values():
    if not isinstance(entries,list): raise SystemExit(16)
    for entry in entries:
        if set(entry) != {"source","target","mode"} or entry["source"] != entry["target"] or entry["mode"] not in {"ro","rw"}: raise SystemExit(17)
        source=entry["source"]
        if not isinstance(source,str) or not source.startswith("/") or source in {"/","/root","/home","/Users","/workspace","/workspaces"} or ".." in Path(source).parts or any(char in source for char in (",","\n","\r","|")): raise SystemExit(18)
        item=(source,entry["target"],entry["mode"])
        if item not in seen: print("MOUNT|%s|%s|%s"%item); seen.add(item)
' "$config" "$root_prefix" "$docker" "$socket" "$network" "$image"
DOCKER_HOST="unix://$socket" "$docker" "$@" >"$mounts_file"

set -- run --rm -i --network "$network" --entrypoint /usr/local/bin/python
set -- "$@" --mount "type=bind,src=$config,dst=$config,readonly"
set -- "$@" --mount "type=bind,src=$docker,dst=$docker,readonly"
set -- "$@" --mount "type=bind,src=$socket,dst=$socket"
set -- "$@" --env "DOCKER_HOST=unix://$socket"

while IFS='|' read -r kind first second third; do
    case "$kind" in
        MOUNT)
            safe_path "$first"
            [ "$first" = "$second" ] || { echo "mount target differs from source" >&2; exit 2; }
            option="type=bind,src=$first,dst=$second"
            [ "$third" = ro ] && option="$option,readonly"
            set -- "$@" --mount "$option"
            ;;
        CORE)
            safe_path "$second"
            case "$first" in
                cache|bin_dir|state_dir) mode=rw ;;
                manifest|config:*) mode=ro ;;
                *) echo "invalid bootstrap core path" >&2; exit 2 ;;
            esac
            option="type=bind,src=$second,dst=$second"
            [ "$mode" = ro ] && option="$option,readonly"
            set -- "$@" --mount "$option"
            ;;
        *) echo "invalid bootstrap preflight output" >&2; exit 2 ;;
    esac
done <"$mounts_file"

set -- "$@" "$image"
set -- "$@" -m app.services.update_helper_installation --config "$config" --root-prefix "$root_prefix"
[ "$action" = rollback ] && set -- "$@" --rollback
rm -f "$mounts_file"
trap - EXIT HUP INT TERM
DOCKER_HOST="unix://$socket" exec "$docker" "$@"
