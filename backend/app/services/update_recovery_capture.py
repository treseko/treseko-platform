"""Bounded read-only export of an explicitly pinned, already stopped service.

Caller owns admission, draining, host locking and separate volume backups.
Never stops a service or removes a pre-existing export after an interrupted run.
"""
import copy
import hashlib
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import subprocess
import time

from .update_recovery_archive import MAX_EXPORT_BYTES, _require_space
from .update_transaction import TransactionFailure


def _pin(service, container_id):
    current = service._current()
    state = (current or {}).get('State', {})
    platform = ((current or {}).get('ImageManifestDescriptor') or {}).get('platform', {})
    if (not current or current.get('Id') != container_id or state.get('Running') is not False
            or state.get('Paused') or state.get('Restarting') or state.get('Dead')
            or platform.get('os') != 'linux' or platform.get('architecture') not in {'amd64', 'arm64'}):
        raise TransactionFailure('Recovery requires the pinned stopped Linux container')
    fields = ('Id', 'Image', 'Config', 'HostConfig', 'Mounts', 'State', 'ImageManifestDescriptor')
    return current, copy.deepcopy({key: current.get(key) for key in fields})


def _stream_export(command, output, limit, timeout):
    deadline = time.monotonic() + timeout
    digest, size = hashlib.sha256(), 0
    process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TransactionFailure('Recovery export deadline exceeded')
                for key, _ in selector.select(min(remaining, 0.25)):
                    data = os.read(key.fd, min(1024 * 1024, limit - size + 1))
                    if not data:
                        selector.unregister(key.fileobj)
                        continue
                    size += len(data)
                    if size > limit:
                        raise TransactionFailure('Recovery export size limit exceeded')
                    _require_space(output.fileno(), len(data))
                    output.write(data)
                    digest.update(data)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TransactionFailure('Recovery export deadline exceeded')
        if process.wait(timeout=remaining) or not size:
            raise TransactionFailure('Recovery export failed or returned no data')
        return size, digest.hexdigest()
    except subprocess.TimeoutExpired as exc:
        raise TransactionFailure('Recovery export deadline exceeded') from exc
    finally:
        # Only our local CLI process group. A daemon-side read may outlive it;
        # this operation does not change Docker state or publish an image.
        # A CLI wrapper can exit while a descendant still holds stdout open.
        # Clean its session group even if the direct child has already exited.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
        process.stdout.close()


def capture_recovery_export(service, container_id: str, destination: Path,
                            *, max_bytes=MAX_EXPORT_BYTES, timeout=900):
    """Return private captured metadata and checksum only after post-export pinning.

    Existing output is never adopted or overwritten. After controller death it
    requires operator reconciliation, not an assumption of successful capture.
    """
    if (not re.fullmatch(r'[a-f0-9]{64}', container_id)
            or not destination.is_absolute() or not Path(service.docker).is_absolute()
            or type(max_bytes) is not int or not 1 <= max_bytes <= MAX_EXPORT_BYTES
            or type(timeout) is not int or not 1 <= timeout <= 1800):
        raise ValueError('Explicit recovery identity, paths and bounded limits required')
    parent = destination.parent.lstat()
    if (not stat.S_ISDIR(parent.st_mode) or parent.st_mode & 0o077
            or parent.st_uid not in {0, os.geteuid()}):
        raise ValueError('Private operator-owned capture directory required')
    metadata, identity = _pin(service, container_id)
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, 'wb', buffering=0) as output:
            _require_space(output.fileno(), 1)
            size, checksum = _stream_export([service.docker, 'export', container_id],
                                            output, max_bytes, timeout)
            _, after = _pin(service, container_id)
            if after != identity:
                raise TransactionFailure('Container changed during recovery export')
            output.flush()
            os.fsync(output.fileno())
        parent_fd = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
    except BaseException:
        destination.unlink(missing_ok=True)  # This invocation created it exclusively.
        raise
    return {'container': metadata, 'size_bytes': size, 'sha256': checksum}
