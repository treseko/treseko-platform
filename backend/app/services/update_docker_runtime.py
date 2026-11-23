"""Seed a new runtime volume from a caller-verified immutable local image.

Never executes the application entrypoint or changes the original volume.
The enclosing transaction drains all consumers and verifies vendor provenance.
Explicit mutable data is copied from the old volume, while code comes only
from the prepared image. Retained helper/volume identities allow recovery
after a lost Docker response.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess

from .update_journal import exclusive_lock, save_json
from .update_transaction import TransactionFailure


SEED_SCRIPT = r"""
set -eu
root="$1"
component="$2"
expected="$3"
case "$component" in
    engine|worker|frontend) ;;
    *) echo "Unsupported runtime component root" >&2; exit 32 ;;
esac
test -d "$root"
test ! -L "$root/VERSION"
test "$(cat "$root/VERSION")" = "$expected"
for item in .runner-token .runner-token.pairing .worker-instance-id .env; do
    test ! -e "$root/$item" && test ! -L "$root/$item"
done
test -z "$(ls -A /prepared)"
cp -a "$root/." /prepared/
preserved_items=".env"
if test "$component" = worker; then
    preserved_items=".runner-token .runner-token.pairing .worker-instance-id .env"
fi
for item in $preserved_items; do
    test ! -L "/previous/$item"
    if test -e "/previous/$item"; then
        test -f "/previous/$item"
        cp -p "/previous/$item" "/prepared/$item"
    fi
done
copy_mutable_directory() {
    name="$1"
    source="/previous/$name"
    target="/prepared/$name"
    test ! -L "$source"
    if test -e "$source"; then
        test -d "$source"
        # Runtime data is copied as data, never as links or special files.
        # This also prevents a persisted link from escaping the prepared root.
        if find "$source" -xdev ! -type d ! -type f -print -quit | grep -q .; then
            echo "Unsupported entry in mutable runtime directory: $name" >&2
            exit 31
        fi
        test ! -L "$target"
        if test -e "$target"; then test -d "$target"; rm -rf "$target"; fi
        mkdir -p "$(dirname "$target")"
        cp -a "$source" "$target"
    fi
}
if test "$component" = engine; then
    copy_mutable_directory videos
    copy_mutable_directory reports
    copy_mutable_directory logs
elif test "$component" = worker; then
    copy_mutable_directory .state
    copy_mutable_directory logs
fi
if test "$component" = frontend; then
    for item in .treseko-update-fence .maintenance; do
        test ! -L "/previous/$item"
        if test -e "/previous/$item"; then
            test -f "/previous/$item"
            cp -p "/previous/$item" "/prepared/$item"
        fi
    done
fi
test "$(cat /prepared/VERSION)" = "$expected"
sync
"""


class DockerRuntimeVolume:
    def __init__(self, docker: str):
        if not Path(docker).is_absolute():
            raise ValueError("An absolute Docker executable is required")
        self.docker = docker

    def _run(self, arguments, *, timeout=120):
        try:
            result = subprocess.run([self.docker, *arguments], capture_output=True, timeout=timeout)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise TransactionFailure("Runtime preparation outcome uncertain; retain helper and maintenance") from exc
        if result.returncode:
            raise TransactionFailure("Runtime preparation failed; retain original volume and maintenance")
        return result.stdout

    def prepare(self, directory: Path, image: str, source_volume: str, root: str, version: str):
        if (not re.fullmatch(r"sha256:[a-f0-9]{64}", image)
                or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]+", source_volume)
                or root not in {"/engine", "/worker", "/usr/share/nginx/html"}
                or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.-]+)?", version)):
            raise ValueError("Explicit image, named volume, component root and version are required")
        with exclusive_lock(directory / ".runtime.lock"):
            identity = hashlib.sha256(str(directory.resolve()).encode()).hexdigest()
            intent = {"image": image, "source": source_volume, "root": root, "version": version}
            journal = directory / "runtime.json"
            if journal.exists():
                state = json.loads(journal.read_text())
                if state["intent"] != intent:
                    raise TransactionFailure("Prepared runtime identity is immutable")
            else:
                # A shared runtime must have every consumer drained, not just
                # the service whose image is about to change.
                active = self._run(["ps", "--quiet", "--filter", "volume=" + source_volume])
                if active.strip():
                    raise TransactionFailure("All source runtime consumers must be stopped")
                self._run(["volume", "inspect", source_volume])
                self._run(["image", "inspect", image])
                state = {"intent": intent, "volume": "treseko-runtime-" + identity,
                         "helper": "treseko-seed-" + identity, "complete": False}
                save_json(journal, state)
            label = "io.treseko.runtime-preparation=" + identity
            found = self._run(["volume", "ls", "--quiet", "--filter", "name=^" + state["volume"] + "$"])
            if not found.strip():
                helper_exists = self._run(["ps", "--all", "--quiet", "--filter", "name=^/" + state["helper"] + "$"])
                if state["complete"] or helper_exists.strip():
                    raise TransactionFailure("Prepared runtime volume was lost")
                self._run(["volume", "create", "--label", label, state["volume"]])
            volume = json.loads(self._run(["volume", "inspect", state["volume"]]))[0]
            if (volume.get("Labels") or {}).get("io.treseko.runtime-preparation") != identity:
                raise TransactionFailure("Runtime volume belongs to another operation")
            if state["complete"]:
                return state["volume"]
            found = self._run(["ps", "--all", "--quiet", "--filter", "name=^/" + state["helper"] + "$"])
            if not found.strip():
                self._run(["volume", "inspect", source_volume])
                self._run(["create", "--name", state["helper"], "--label", label,
                           "--label", "com.docker.compose.project=",
                           "--label", "com.docker.compose.service=",
                           "--label", "com.docker.compose.oneoff=True",
                           "--network=none", "--read-only", "--user", "0:0",
                           "--mount", "type=volume,source=" + source_volume + ",target=/previous,readonly,volume-nocopy",
                           "--mount", "type=volume,source=" + state["volume"] + ",target=/prepared,volume-nocopy",
                           "--entrypoint", "/bin/sh", image, "-c", SEED_SCRIPT, "seed",
                           root, {"/engine": "engine", "/worker": "worker",
                                  "/usr/share/nginx/html": "frontend"}[root], version])
            helper = json.loads(self._run(["inspect", "--type", "container", state["helper"]]))[0]
            if (helper["Config"].get("Labels") or {}).get("io.treseko.runtime-preparation") != identity or helper["Image"] != image:
                raise TransactionFailure("Runtime helper belongs to another operation")
            if helper["State"]["Status"] == "created":
                if self._run(["ps", "--quiet", "--filter", "volume=" + source_volume]).strip():
                    raise TransactionFailure("All source runtime consumers must remain stopped")
                self._run(["volume", "inspect", source_volume])
                # Video recordings and worker result spools can be large. Keep
                # the source volume untouched and allow a bounded, resumable
                # copy window instead of timing out after a short CLI default.
                self._run(["start", "--attach", state["helper"]], timeout=3600)
                helper = json.loads(self._run(["inspect", "--type", "container", state["helper"]]))[0]
            if helper["State"]["Status"] != "exited" or helper["State"]["ExitCode"] != 0:
                raise TransactionFailure("Runtime helper is unfinished or failed; do not reuse partial output")
            state["complete"] = True
            save_json(journal, state)
            return state["volume"]
