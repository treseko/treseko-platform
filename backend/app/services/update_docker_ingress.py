"""Nginx admission gate controlled from the host, independent of backend startup.

This controls ingress through the inventoried frontend only. Direct backend
ports, existing connections and autonomous workers still require their own drain.
"""
import json
from pathlib import Path
import re
import subprocess

from .update_transaction import TransactionFailure
from .update_transport import IDENTIFIER


ACQUIRE = r'''
set -eu
marker=/usr/share/nginx/html/.treseko-update-fence
if [ -e "$marker" ]; then
  [ ! -L "$marker" ] && [ "$(cat "$marker")" = "$1" ]
else
  [ ! -e /usr/share/nginx/html/.maintenance ]
  set -C
  printf '%s\n' "$1" > "$marker"
fi
sync
'''
RELEASE = r'''
set -eu
marker=/usr/share/nginx/html/.treseko-update-fence
if [ -e "$marker" ]; then
  [ ! -L "$marker" ] && [ "$(cat "$marker")" = "$1" ]
  rm "$marker"
fi
sync
'''


class DockerIngressGate:
    def __init__(self, docker: str, container: str, project: str, service: str = "frontend"):
        if (not Path(docker).is_absolute() or not re.fullmatch(r"[a-f0-9]{64}", container)
                or not project or not service):
            raise ValueError("Explicit Docker executable, container ID and Compose scope required")
        self.docker, self.container = docker, container
        self.project, self.service = project, service

    def _run(self, args, *, input=None, check=True):
        try:
            result = subprocess.run([self.docker, *args], input=input, capture_output=True,
                                    timeout=15, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise TransactionFailure("Ingress gate outcome is uncertain") from exc
        if check and result.returncode:
            raise TransactionFailure("Ingress gate operation failed")
        return result

    def _check_target(self):
        records = json.loads(self._run(["inspect", "--type", "container", self.container]).stdout)
        if len(records) != 1:
            raise TransactionFailure("Ambiguous ingress container")
        record = records[0]
        labels = record.get("Config", {}).get("Labels") or {}
        if (record.get("Id") != self.container or not record.get("State", {}).get("Running")
                or labels.get("com.docker.compose.project") != self.project
                or labels.get("com.docker.compose.service") != self.service):
            raise TransactionFailure("Ingress container differs from authorized inventory")
        configuration = self._run(["exec", self.container, "nginx", "-T"]).stdout
        if b".treseko-update-fence" not in configuration or b"/__treseko_update_gate_probe__" not in configuration:
            raise TransactionFailure("Legacy Nginx requires the update admission bridge")

    def _probe(self):
        # A full HTTP client waits for the response instead of racing stdin EOF
        # against an upstream reply as a raw netcat pipe can do.
        response = self._run(["exec", self.container, "curl", "--silent", "--show-error",
                              "--max-time", "5", "--noproxy", "*", "--output", "/dev/null",
                              "--write-out", "%{http_code}",
                              "http://127.0.0.1/__treseko_update_gate_probe__"]).stdout.strip()
        return int(response) if re.fullmatch(rb"[0-9]{3}", response) else None

    def acquire(self, transaction: str):
        if not IDENTIFIER.fullmatch(transaction):
            raise ValueError("Invalid gate transaction")
        self._check_target()
        self._run(["exec", self.container, "sh", "-c", ACQUIRE, "treseko-gate", transaction])
        if self._probe() != 503:
            raise TransactionFailure("Ingress is not fenced; do not modify the installation")

    def release(self, transaction: str):
        if not IDENTIFIER.fullmatch(transaction):
            raise ValueError("Invalid gate transaction")
        self._check_target()
        self._run(["exec", self.container, "sh", "-c", RELEASE, "treseko-gate", transaction])
        if self._probe() != 204:
            raise TransactionFailure("Ingress has not reopened; activation remains pending")

    def assert_closed(self, transaction: str):
        """Read-only ownership and live enforcement check; never acquires silently."""
        if not IDENTIFIER.fullmatch(transaction):
            raise ValueError('Invalid gate transaction')
        self._check_target()
        script = ('marker=/usr/share/nginx/html/.treseko-update-fence; '
                  '[ ! -L "$marker" ] && [ -f "$marker" ] && [ "$(cat "$marker")" = "$1" ]')
        self._run(['exec', self.container, 'sh', '-c', script, 'treseko-gate', transaction])
        if self._probe() != 503:
            raise TransactionFailure('Owned ingress fence is not enforced')
