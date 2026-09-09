"""Host-owned persistent gate, safe for delayed requests to a remote helper.

Marker writes are local under the host lock, never asynchronous docker-exec
mutations. Requires an explicit bind mount on the independent ingress proxy.
"""
import json
import os
from pathlib import Path
import stat

from .update_docker_ingress import DockerIngressGate
from .update_journal import exclusive_lock, save_json
from .update_transport import IDENTIFIER
from .update_transaction import TransactionFailure


class DurableDockerIngressGate(DockerIngressGate):
    def __init__(self, docker, container, project, service, control: Path, callback_drain=False):
        super().__init__(docker, container, project, service)
        if not control.is_absolute() or '..' in control.parts:
            raise ValueError('Explicit host control bind directory required')
        if type(callback_drain) is not bool:
            raise ValueError('callback_drain must be an explicit boolean')
        self.control = control
        self.callback_drain = callback_drain

    def _target(self):
        self._check_target()
        info = self.control.lstat()
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid not in {0, os.geteuid()}
                or info.st_mode & 0o022 or info.st_mode & 0o005 != 0o005):
            raise TransactionFailure('Control directory must be owned, non-writable by others and traversable by Nginx')
        record = json.loads(self._run(['inspect', '--type', 'container', self.container]).stdout)[0]
        matches = [m for m in record.get('Mounts', []) if m.get('Destination') == '/usr/share/nginx/html']
        if (len(matches) != 1 or matches[0].get('Type') != 'bind'
                or Path(matches[0].get('Source', '')).resolve() != self.control.resolve()):
            raise TransactionFailure('Ingress control bind differs from host inventory')

    def _read(self, path):
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as stream:
            info = os.fstat(stream.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_uid not in {0, os.geteuid()}
                    or info.st_mode & 0o022 or info.st_size > 65536):
                raise TransactionFailure('Unsafe ingress ownership record')
            return stream.read()

    def _change(self, action, transaction):
        if not IDENTIFIER.fullmatch(transaction):
            raise ValueError('Invalid gate transaction')
        self._target()
        with exclusive_lock(self.control / '.ingress.lock'):
            self._target()
            path = self.control / '.ingress-state.json'
            marker = self.control / '.treseko-update-fence'
            draining_marker = self.control / '.treseko-update-draining'
            binding = [self.docker, self.container, self.project, self.service, str(self.control)]
            if self.callback_drain:
                binding.append(True)
            terminal = self.control / ('.ingress-released-' + transaction + '.json')
            state = json.loads(self._read(path)) if path.exists() else None
            if state is not None and (not isinstance(state, dict) or set(state) != {'schema', 'binding', 'transaction', 'phase'}
                    or type(state['schema']) is not int or state['schema'] != 1 or state['binding'] != binding
                    or state['phase'] not in {'closing', 'draining', 'closed', 'sealing', 'sealed', 'releasing', 'released'}
                    or not isinstance(state['transaction'], str) or not IDENTIFIER.fullmatch(state['transaction'])):
                raise TransactionFailure('Ingress journal differs from inventory')
            owner = self._read(marker).decode().strip() if marker.exists() else None
            draining_owner = self._read(draining_marker).decode().strip() if draining_marker.exists() else None
            if owner not in {None, transaction} or draining_owner not in {None, transaction}:
                raise TransactionFailure('Ingress marker belongs to another transaction')
            if action == 'acquire':
                if terminal.exists():
                    raise TransactionFailure('Released transaction cannot reacquire ingress')
                if state and (state['transaction'] != transaction and state['phase'] != 'released'
                              or state['transaction'] == transaction and state['phase'] in {'releasing', 'released'}):
                    raise TransactionFailure('Stale or concurrent ingress acquisition rejected')
                if (self.control / '.maintenance').exists():
                    raise TransactionFailure('Operator maintenance cannot be taken over')
                if state and state['transaction'] == transaction and state['phase'] in {'sealed', 'sealing'}:
                    if not owner == transaction or self._probe() != 503:
                        raise TransactionFailure('Sealed ingress fence is not enforced')
                    return
                if state and state['transaction'] == transaction and state['phase'] == 'draining':
                    if not self.callback_drain or draining_owner != transaction or self._probe() != 503:
                        raise TransactionFailure('Owned ingress drain is not enforced')
                    return
                phase = 'draining' if self.callback_drain else 'closing'
                state = {'schema': 1, 'binding': binding, 'transaction': transaction, 'phase': phase}
                save_json(path, state)
                target_marker = draining_marker if self.callback_drain else marker
                target_owner = draining_owner if self.callback_drain else owner
                if target_owner is None:
                    self._publish_marker(target_marker, transaction)
                if self._probe() != 503:
                    raise TransactionFailure('Ingress closure unconfirmed')
                if not self.callback_drain:
                    state['phase'] = 'closed'
                    save_json(path, state)
            elif action == 'assert_closed':
                expected_phase = 'draining' if self.callback_drain else 'closed'
                active_owner = draining_owner if self.callback_drain else owner
                if (state and state['transaction'] == transaction and state['phase'] == 'sealed'
                        and owner == transaction and draining_owner is None and self._probe() == 503):
                    return
                if (not state or state['transaction'] != transaction or state['phase'] != expected_phase
                        or active_owner != transaction or self._probe() != 503):
                    raise TransactionFailure('Owned ingress closure unconfirmed')
            elif action == 'seal':
                if not state or state['transaction'] != transaction:
                    raise TransactionFailure('Unknown ingress seal rejected')
                if state['phase'] == 'sealed':
                    if owner != transaction or draining_owner is not None or self._probe() != 503:
                        raise TransactionFailure('Sealed ingress fence is not enforced')
                    return
                if state['phase'] not in {'closed', 'draining', 'sealing'}:
                    raise TransactionFailure('Ingress seal requires an acquired gate')
                state['phase'] = 'sealing'
                save_json(path, state)
                if owner is None:
                    self._publish_marker(marker, transaction)
                elif owner != transaction:
                    raise TransactionFailure('Ingress marker belongs to another transaction')
                if draining_owner is not None:
                    if draining_owner != transaction:
                        raise TransactionFailure('Ingress draining marker belongs to another transaction')
                    draining_marker.unlink()
                    self._fsync_directory()
                if self._probe() != 503:
                    raise TransactionFailure('Ingress seal unconfirmed')
                state['phase'] = 'sealed'
                save_json(path, state)
            elif action == 'assert_sealed':
                if (not state or state['transaction'] != transaction or state['phase'] != 'sealed'
                        or owner != transaction or draining_owner is not None or self._probe() != 503):
                    raise TransactionFailure('Owned ingress seal is not enforced')
            else:
                if not state or state['transaction'] != transaction:
                    raise TransactionFailure('Unknown ingress release rejected')
                if self.callback_drain and state['phase'] not in {'sealed', 'releasing'}:
                    raise TransactionFailure('Callback-drain ingress must be sealed before release')
                state['phase'] = 'releasing'
                save_json(path, state)  # Reject delayed acquisition before reopening.
                save_json(terminal, {'transaction': transaction, 'binding': binding})
                if owner is not None:
                    marker.unlink()
                self._fsync_directory()
                if self._probe() != 204:
                    raise TransactionFailure('Ingress reopening unconfirmed')
                state['phase'] = 'released'
                save_json(path, state)

    def acquire(self, transaction):
        self._change('acquire', transaction)

    def assert_closed(self, transaction):
        self._change('assert_closed', transaction)

    def seal(self, transaction):
        self._change('seal', transaction)

    def assert_sealed(self, transaction):
        self._change('assert_sealed', transaction)

    def release(self, transaction):
        self._change('release', transaction)

    def _publish_marker(self, path, transaction):
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
        try:
            with os.fdopen(fd, 'w') as output:
                output.write(transaction + '\n')
                output.flush()
                os.fsync(output.fileno())
        except Exception:
            raise
        self._fsync_directory()

    def _fsync_directory(self):
        directory = os.open(self.control, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
