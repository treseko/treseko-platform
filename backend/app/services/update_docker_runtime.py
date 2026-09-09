"""Seed a new runtime volume from a caller-verified immutable local image.

Never executes the application entrypoint or changes the original volume.
The enclosing transaction drains all consumers and verifies vendor provenance.
Retained helper/volume identities allow recovery after a lost Docker response.
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
expected="$2"
test -d "$root"
test ! -L "$root/VERSION"
test "$(cat "$root/VERSION")" = "$expected"
test ! -e "$root/.runner-token" && test ! -L "$root/.runner-token"
test ! -e "$root/.env" && test ! -L "$root/.env"
test -z "$(ls -A /prepared)"
cp -a "$root/." /prepared/
for item in .runner-token .env; do
    test ! -L "/previous/$item"
    if test -e "/previous/$item"; then
        test -f "/previous/$item"
        cp -p "/previous/$item" "/prepared/$item"
    fi
done
if test "$root" = /usr/share/nginx/html; then
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

    def _run(self, arguments):
        try:
            result = subprocess.run([self.docker, *arguments], capture_output=True, timeout=120)
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
                           "--entrypoint", "/bin/sh", image, "-c", SEED_SCRIPT, "seed", root, version])
            helper = json.loads(self._run(["inspect", "--type", "container", state["helper"]]))[0]
            if (helper["Config"].get("Labels") or {}).get("io.treseko.runtime-preparation") != identity or helper["Image"] != image:
                raise TransactionFailure("Runtime helper belongs to another operation")
            if helper["State"]["Status"] == "created":
                if self._run(["ps", "--quiet", "--filter", "volume=" + source_volume]).strip():
                    raise TransactionFailure("All source runtime consumers must remain stopped")
                self._run(["volume", "inspect", source_volume])
                self._run(["start", "--attach", state["helper"]])
                helper = json.loads(self._run(["inspect", "--type", "container", state["helper"]]))[0]
            if helper["State"]["Status"] != "exited" or helper["State"]["ExitCode"] != 0:
                raise TransactionFailure("Runtime helper is unfinished or failed; do not reuse partial output")
            state["complete"] = True
            save_json(journal, state)
            return state["volume"]
