"""Durable private baseline recovery; caller still owns coordinated admission.

Interrupted local captures/builds get new exclusive paths, never overwrite old
artifacts. Docker imports are reconciled by the loader, never blindly repeated.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import uuid

from .update_journal import exclusive_lock, save_json
from .update_recovery_archive import build_recovery_archive, _digest, MAX_EXPORT_BYTES
from .update_recovery_capture import capture_recovery_export, _pin
from .update_recovery_loader import DockerRecoveryLoader
from .update_transaction import TransactionFailure


def _read_private(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077
                or info.st_uid not in {0, os.geteuid()} or info.st_size > 4 * 1024 ** 2):
            raise TransactionFailure('Unsafe recovery pipeline journal')
        return json.load(stream)


def _identity(record):
    return hashlib.sha256(json.dumps(record, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def recover_stopped_baseline(service, container_id: str, directory: Path, owner: str):
    """No stopping, replacement or volume operations. Return a verified image ID."""
    if (not directory.is_absolute() or not re.fullmatch(r'[a-f0-9]{64}', owner)
            or not re.fullmatch(r'[a-f0-9]{64}', container_id)):
        raise ValueError('Private recovery directory, container ID and transaction owner required')
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = directory.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077
            or info.st_uid not in {0, os.geteuid()}):
        raise ValueError('Private operator-owned recovery directory required')
    binding = {'docker': service.docker, 'project': service.project, 'service': service.service,
               'container_id': container_id, 'owner': owner}
    with exclusive_lock(directory / '.pipeline.lock'):
        journal = directory / 'pipeline.json'
        state = _read_private(journal) if journal.exists() else None
        if state is not None and (not isinstance(state, dict) or type(state.get('schema')) is not int
                or state.get('schema') != 1
                or state.get('binding') != binding or state.get('phase') not in {
                    'capturing', 'captured', 'building', 'built', 'loaded'}):
            raise TransactionFailure('Recovery pipeline inventory or journal differs')
        if state is None or state['phase'] not in {'built', 'loaded'}:
            _, pinned = _pin(service, container_id)
            identity = _identity(pinned)
            if state is not None and state.get('identity') != identity:
                raise TransactionFailure('Recovery source changed since pipeline began')
            if state is None:
                state = {'schema': 1, 'binding': binding, 'phase': 'capturing', 'identity': identity}
        if state['phase'] == 'capturing':
            state['export'] = 'export-' + uuid.uuid4().hex + '.tar'
            save_json(journal, state)
            captured = capture_recovery_export(service, container_id, directory / state['export'])
            _, after = _pin(service, container_id)
            if _identity(after) != state['identity']:
                raise TransactionFailure('Recovery source changed before capture confirmation')
            state.update(phase='captured', captured=captured)
            save_json(journal, state)
        if state['phase'] in {'captured', 'building'}:
            name = state.get('export', '')
            if not re.fullmatch(r'export-[a-f0-9]{32}\.tar', name):
                raise TransactionFailure('Invalid private recovery export path')
            source = directory / name
            fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, 'rb') as stream:
                metadata = os.fstat(stream.fileno())
                if (not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o077
                        or metadata.st_uid not in {0, os.geteuid()}
                        or not 0 < metadata.st_size <= MAX_EXPORT_BYTES
                        or metadata.st_size != state['captured']['size_bytes']
                        or _digest(stream) != state['captured']['sha256']):
                    raise TransactionFailure('Confirmed recovery export changed')
            state.update(phase='building', archive='archive-' + uuid.uuid4().hex + '.tar')
            save_json(journal, state)
            receipt = build_recovery_archive(source, state['captured']['container'],
                                             directory / state['archive'], owner)
            if receipt['rootfs_sha256'] != state['captured']['sha256']:
                raise TransactionFailure('Recovery archive differs from confirmed export')
            state.update(phase='built', receipt=receipt)
            save_json(journal, state)
        if not re.fullmatch(r'archive-[a-f0-9]{32}\.tar', state.get('archive', '')):
            raise TransactionFailure('Invalid private recovery archive path')
        loaded = DockerRecoveryLoader(service.docker, directory / 'loader').load(
            directory / state['archive'], state['receipt'])
        if state.get('image_id') is not None and state['image_id'] != loaded['image_id']:
            raise TransactionFailure('Recovery pipeline image changed')
        state.update(phase='loaded', image_id=loaded['image_id'])
        save_json(journal, state)
        return loaded
