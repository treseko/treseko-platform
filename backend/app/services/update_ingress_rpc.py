"""Bounded ingress RPC; executable and SSH target come only from private inventory."""
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

from .update_transport import IDENTIFIER, ProcessParticipant, _bounded_response
from .update_transaction import TransactionFailure

REMOTE_INGRESS_HELPER = '/usr/local/libexec/treseko-update-ingress'
ACTIONS = {'acquire', 'assert_closed', 'seal', 'assert_sealed', 'release'}


class ProcessIngressGate:
    def __init__(self, gate_id, command, helper_identity, timeout=120, callback_drain=False):
        if (not isinstance(gate_id, str) or not IDENTIFIER.fullmatch(gate_id)
                or not isinstance(helper_identity, str) or not re.fullmatch(r'[a-f0-9]{64}', helper_identity)
                or not command or not all(isinstance(arg, str) and arg and '\0' not in arg for arg in command)
                or not Path(command[0]).is_absolute()
                or type(timeout) not in {int, float} or not math.isfinite(timeout) or not 0 < timeout <= 1800):
            raise ValueError('Explicit ingress RPC identity, executable and bounded timeout required')
        if type(callback_drain) is not bool:
            raise ValueError('callback_drain must be an explicit boolean')
        self.name, self.command = gate_id, tuple(command)
        self.identity, self.timeout, self.callback_drain = helper_identity, timeout, callback_drain

    @classmethod
    def ssh(cls, gate_id, alias, helper_identity, timeout=120, callback_drain=False):
        command = ProcessParticipant.ssh(gate_id, alias, timeout).command
        executable = shutil.which('ssh')
        if not executable:
            raise ValueError('SSH executable unavailable')
        command = (executable, *command[1:-1], REMOTE_INGRESS_HELPER)
        # SSH -G resolves operator config without opening a connection.
        resolved = subprocess.run([executable, '-G', *command[1:-1]], capture_output=True, timeout=15)
        if resolved.returncode or len(resolved.stdout) > 1024 * 1024:
            raise ValueError('Unable to bind ingress SSH configuration')
        gate = cls(gate_id, command, helper_identity, timeout, callback_drain)
        return gate, {'ssh_executable': executable,
                      'ssh_config_digest': hashlib.sha256(resolved.stdout).hexdigest()}

    def _call(self, action, transaction):
        if action not in ACTIONS or not isinstance(transaction, str) or not IDENTIFIER.fullmatch(transaction):
            raise ValueError('Invalid ingress operation')
        request = {'schema': 1, 'gate': self.name, 'action': action,
                   'transaction': transaction, 'helper_identity': self.identity}
        try:
            with tempfile.TemporaryFile() as source:
                source.write(json.dumps(request).encode())
                source.seek(0)
                response = _bounded_response(self.command, source, self.timeout)
            receipt = json.loads(response)
        except (OSError, subprocess.TimeoutExpired, ValueError, RecursionError) as exc:
            raise TransactionFailure('Ingress RPC response unavailable or invalid; outcome uncertain') from exc
        if receipt != {**request, 'ok': True} or type(receipt.get('schema')) is not int or receipt.get('ok') is not True:
            raise TransactionFailure('Ingress RPC receipt does not match request')

    def acquire(self, transaction):
        self._call('acquire', transaction)

    def assert_closed(self, transaction):
        self._call('assert_closed', transaction)

    def seal(self, transaction):
        if not self.callback_drain:
            # The coordinator may call the seal hook for every configured gate.
            # Legacy RPC helpers have no seal action: their already-hard fence
            # is the sealed state, so re-assert it locally without a new RPC.
            self.assert_closed(transaction)
            return
        self._call('seal', transaction)

    def assert_sealed(self, transaction):
        if not self.callback_drain:
            self.assert_closed(transaction)
            return
        self._call('assert_sealed', transaction)

    def release(self, transaction):
        self._call('release', transaction)
