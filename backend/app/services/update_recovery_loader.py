"""Journaled private recovery-image loading; no service/container replacement.

An unacknowledged load can be adopted only from verified Docker state. Missing
state is not permission to repeat a potentially still-running daemon import.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tarfile
import tempfile

from .update_journal import exclusive_lock, save_json
from .update_recovery_archive import IMAGE_FIELDS, MAX_EXPORT_BYTES, _digest
from .update_transaction import TransactionFailure


class DockerRecoveryLoader:
    def __init__(self, docker, directory, *, timeout=300):
        if not Path(docker).is_absolute() or not directory.is_absolute() or type(timeout) is not int or not 1 <= timeout <= 1800:
            raise ValueError('Explicit Docker path, private journal directory and timeout required')
        self.docker, self.directory, self.timeout = docker, directory, timeout

    def _command(self, arguments, source=None):
        try:
            with tempfile.TemporaryFile() as output:
                result = subprocess.run([self.docker, *arguments], stdin=source, stdout=output,
                                        stderr=subprocess.DEVNULL, timeout=self.timeout)
                output.seek(0)
                data = output.read(1024 * 1024 + 1)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise TransactionFailure('Recovery image operation uncertain; retain journal') from exc
        if result.returncode or len(data) > 1024 * 1024:
            raise TransactionFailure('Recovery image operation failed; retain journal')
        return data

    def _find(self, tag):
        ids = self._command(['image', 'ls', '--quiet', '--no-trunc', '--filter', 'reference=' + tag]).decode().split()
        if not ids:
            return None
        if len(set(ids)) != 1 or not re.fullmatch(r'sha256:[0-9a-f]{64}', ids[0]):
            raise TransactionFailure('Recovery image reference is ambiguous')
        records = json.loads(self._command(['image', 'inspect', tag]))
        if len(records) != 1 or records[0].get('Id') != ids[0]:
            raise TransactionFailure('Recovery image reference changed during inspection')
        return records[0]

    @staticmethod
    def _config(source, receipt):
        if _digest(source) != receipt['archive_sha256']:
            raise TransactionFailure('Recovery archive checksum differs')
        source.seek(0)
        config_name = receipt['config_sha256'] + '.json'
        layer_name = receipt['rootfs_sha256'] + '/layer.tar'
        with tarfile.open(fileobj=source, mode='r:') as archive:
            members = archive.getmembers()
            if (len(members) != 3 or {m.name for m in members} != {config_name, layer_name, 'manifest.json'}
                    or not all(m.isfile() for m in members)
                    or archive.getmember(config_name).size > 1024 * 1024
                    or archive.getmember('manifest.json').size > 8192
                    or not 0 < archive.getmember(layer_name).size <= MAX_EXPORT_BYTES):
                raise TransactionFailure('Invalid recovery archive layout')
            raw = archive.extractfile(config_name).read()
            manifest = json.load(archive.extractfile('manifest.json'))
        if (hashlib.sha256(raw).hexdigest() != receipt['config_sha256']
                or manifest != [{'Config': config_name, 'RepoTags': [receipt['local_tag']], 'Layers': [layer_name]}]):
            raise TransactionFailure('Recovery image metadata differs from receipt')
        config = json.loads(raw)
        if (config.get('rootfs') != {'type': 'layers', 'diff_ids': ['sha256:' + receipt['rootfs_sha256']]}
                or config.get('architecture') != receipt['platform']['architecture']
                or config.get('os') != receipt['platform']['os']
                or config.get('config', {}).get('Labels', {}).get('io.treseko.recovery-image') != receipt['owner']):
            raise TransactionFailure('Recovery image identity differs from receipt')
        source.seek(0)
        return config

    @staticmethod
    def _verify(info, receipt, config):
        if (info.get('Architecture') != config['architecture'] or info.get('Os') != config['os']
                or (info.get('Variant') or '') != (config.get('variant') or '')
                or info.get('RootFS', {}).get('Layers') != config['rootfs']['diff_ids']):
            raise TransactionFailure('Loaded recovery image content or platform differs')
        actual = info.get('Config', {})
        for field in IMAGE_FIELDS:
            expected, observed = config['config'].get(field), actual.get(field)
            if observed is None and expected in (None, '', [], {}):
                continue
            if observed != expected:
                raise TransactionFailure('Loaded recovery image configuration differs')

    def load(self, archive, receipt):
        fields = {'config_sha256', 'rootfs_sha256', 'archive_sha256', 'owner', 'local_tag', 'platform'}
        if (not isinstance(receipt, dict) or set(receipt) != fields
                or any(not isinstance(receipt[k], str) or not re.fullmatch(r'[0-9a-f]{64}', receipt[k])
                       for k in fields - {'local_tag', 'platform'})
                or receipt['local_tag'] != 'treseko-recovery:' + receipt['owner']
                or not isinstance(receipt['platform'], dict)
                or receipt['platform'].get('os') != 'linux'
                or receipt['platform'].get('architecture') not in {'amd64', 'arm64'}
                or not archive.is_absolute()):
            raise ValueError('Private recovery archive receipt required')
        with exclusive_lock(self.directory / '.recovery-load.lock'):
            path = self.directory / 'recovery-load.json'
            binding = {'docker': self.docker, 'archive': str(archive), 'receipt': receipt}
            state = json.loads(path.read_text()) if path.exists() else None
            if state is not None and not isinstance(state, dict):
                raise TransactionFailure('Invalid recovery load journal')
            if state is not None and state.get('binding') != binding:
                raise TransactionFailure('Recovery load inventory changed')
            if state is not None and (set(state) != {'schema', 'binding', 'phase', 'image_id'}
                    or type(state['schema']) is not int or state['schema'] != 1
                    or state['phase'] not in {'loading', 'loaded'}
                    or (state['phase'] == 'loading' and state['image_id'] is not None)
                    or (state['phase'] == 'loaded' and (not isinstance(state['image_id'], str)
                        or not re.fullmatch(r'sha256:[0-9a-f]{64}', state['image_id'])))):
                raise TransactionFailure('Invalid recovery load journal')
            fd = os.open(archive, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, 'rb') as source:
                metadata = os.fstat(source.fileno())
                if (not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o077
                        or metadata.st_uid not in {0, os.geteuid()} or metadata.st_size > MAX_EXPORT_BYTES + 2 * 1024 * 1024):
                    raise ValueError('Bounded private recovery archive required')
                config = self._config(source, receipt)
                info = self._find(receipt['local_tag'])
                if state is None:
                    if info is not None:
                        raise TransactionFailure('Recovery tag already exists; no overwrite allowed')
                    state = {'schema': 1, 'binding': binding, 'phase': 'loading', 'image_id': None}
                    save_json(path, state)
                    self._command(['load'], source)
                    info = self._find(receipt['local_tag'])
                if info is None:
                    raise TransactionFailure('Recovery import unconfirmed; observe again without reloading')
                self._verify(info, receipt, config)
                if state['image_id'] is not None and state['image_id'] != info['Id']:
                    raise TransactionFailure('Pinned recovery image changed')
                state.update(phase='loaded', image_id=info['Id'])
                save_json(path, state)
                return {'ok': True, 'image_id': info['Id'], 'archive_sha256': receipt['archive_sha256']}
