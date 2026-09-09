"""Read-only live HTTP probe for backend/Engine, executed inside the pinned container.

Checks process identity before/after HTTP. This is not a drain/fence check or
proof of LLM/worker functionality. Missing support fails closed.
"""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

from .update_transaction import TransactionFailure


INSPECT = ('{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},'
           '"started":{{json .State.StartedAt}},'
           '"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
           '"service":{{json (index .Config.Labels "com.docker.compose.service")}}}')


class DockerContainerProbe:
    def __init__(self, docker):
        if not Path(docker).is_absolute():
            raise ValueError("Explicit Docker path required")
        self.docker = docker

    def _run(self, args):
        try:
            with tempfile.TemporaryFile() as output:
                result = subprocess.run([self.docker, *args], stdout=output, stderr=subprocess.DEVNULL, timeout=10)
                output.seek(0)
                raw = output.read(65537)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise TransactionFailure("Live component probe unavailable") from exc
        if result.returncode or len(raw) > 65536:
            raise TransactionFailure("Live component probe failed")
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise TransactionFailure("Invalid live component response")
        return value

    def _identity(self, context):
        current = self._run(["inspect", "--type", "container", "--format", INSPECT, context["container_id"]])
        if (current.get("id") != context["container_id"] or current.get("image") != context["image_id"]
                or current.get("project") != context["project"] or current.get("service") != context["service"]
                or current.get("running") is not True or not current.get("started")):
            raise TransactionFailure("Component container does not match inventory")
        return current

class DockerHttpComponentProbe(DockerContainerProbe):
    def __init__(self, docker, component, port):
        super().__init__(docker)
        if component not in {"backend", "engine"} or type(port) is not int or not 1 <= port <= 65535:
            raise ValueError("Supported component and port required")
        self.component, self.port = component, port

    def probe(self, context):
        if (context.get("component") != self.component
                or not re.fullmatch(r"[a-f0-9]{64}", context.get("container_id", ""))
                or not re.fullmatch(r"sha256:[a-f0-9]{64}", context.get("image_id", ""))):
            raise ValueError("Pinned container identity required")
        before = self._identity(context)
        def get(path):
            return self._run(["exec", context["container_id"], "curl", "--fail", "--silent", "--show-error",
                              "--noproxy", "*", "--proto", "=http", "--connect-timeout", "2",
                              "--max-time", "5", "--max-filesize", "65536",
                              f"http://127.0.0.1:{self.port}{path}"])
        health = get("/health")
        version = health.get("version")
        expected_service = "backend" if self.component == "backend" else "treseko-engine"
        if (health.get("status") != "ok" or health.get("service") != expected_service
                or not isinstance(version, str)
                or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.-]+)?", version)):
            raise TransactionFailure("Live health or version invalid")
        if self.component == "backend":
            system = get("/system/version")
            if system.get("version") != version or not isinstance(system.get("database_revision"), str) or not system["database_revision"].strip():
                raise TransactionFailure("Backend version or database revision unavailable")
        if self._identity(context) != before:
            raise TransactionFailure("Component restarted during live verification")
        return version


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--docker", required=True)
    parser.add_argument("--component", choices=["backend", "engine"], required=True)
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    try:
        raw = sys.stdin.buffer.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError("Probe input too large")
        request = json.loads(raw)
        context = request["context"]
        if request.get("schema") != 1 or request.get("operation") != "verify" or context.get("check") != "probe":
            raise ValueError("Read-only probe request required")
        version = DockerHttpComponentProbe(args.docker, args.component, args.port).probe(context)
        print(json.dumps({"schema": 1, "ok": True, "operation": "verify", "version": version,
                          "transaction": context["transaction"], "participant": context["participant"]}))
        return 0
    except Exception:
        print(json.dumps({"ok": False, "error": "component_probe_failed"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
