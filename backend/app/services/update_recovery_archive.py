"""Build a private Docker-load archive from a stopped-container filesystem export.

Offline building block only. Caller must pin/recheck the container around export,
drain all writers and back up volumes separately. Never publish this image: its
configuration and filesystem may contain installation secrets.
"""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import tarfile

from .update_transaction import TransactionFailure

IMAGE_FIELDS = ('User', 'ExposedPorts', 'Env', 'Entrypoint', 'Cmd', 'Volumes',
                'WorkingDir', 'Labels', 'StopSignal', 'Healthcheck', 'OnBuild',
                'Shell', 'ArgsEscaped', 'StopTimeout')
MAX_EXPORT_BYTES = 32 * 1024 ** 3
RECOVERY_FREE_RESERVE = 256 * 1024 ** 2


def _require_space(fd, additional):
    space = os.fstatvfs(fd)
    if space.f_bavail * space.f_frsize < additional + RECOVERY_FREE_RESERVE:
        raise TransactionFailure('Insufficient free space for private recovery archive')


class _SpaceCheckedWriter:
    """Check the actual open filesystem, including space consumed by other writers."""
    def __init__(self, output):
        self.output = output

    def write(self, data):
        _require_space(self.output.fileno(), len(data))
        return self.output.write(data)

    def tell(self):
        return self.output.tell()


def _digest(stream):
    digest = hashlib.sha256()
    while block := stream.read(1024 * 1024):
        digest.update(block)
    return digest.hexdigest()


class _HashingReader:
    def __init__(self, source):
        self.source, self.digest = source, hashlib.sha256()

    def read(self, size):
        block = self.source.read(size)
        self.digest.update(block)
        return block


def build_recovery_archive(export: Path, container: dict, destination: Path, owner: str):
    """No Docker invocation or host extraction; existing output is never replaced."""
    state = container.get('State', {})
    platform = (container.get('ImageManifestDescriptor') or {}).get('platform') or {}
    if (state.get('Running') is not False or state.get('Paused') or state.get('Restarting')
            or platform.get('os') != 'linux' or platform.get('architecture') not in {'amd64', 'arm64'}):
        raise TransactionFailure('Stopped container and recorded Linux image platform required')
    if not isinstance(owner, str) or len(owner) != 64 or any(c not in '0123456789abcdef' for c in owner):
        raise ValueError('Private recovery ownership digest required')
    if not export.is_absolute() or not destination.is_absolute():
        raise ValueError('Absolute private recovery paths required')
    parent = destination.parent.lstat()
    if (not stat.S_ISDIR(parent.st_mode) or parent.st_uid not in {0, os.geteuid()}
            or parent.st_mode & 0o077):
        raise ValueError('Recovery output directory must be private')
    source_config = container.get('Config')
    if not isinstance(source_config, dict):
        raise ValueError('Captured container configuration required')
    config = {key: copy.deepcopy(source_config[key]) for key in IMAGE_FIELDS if key in source_config}
    config['Labels'] = {**(config.get('Labels') or {}), 'io.treseko.recovery-image': owner}
    source_fd = os.open(export, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(source_fd, 'rb') as source:
        info = os.fstat(source.fileno())
        if (not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= MAX_EXPORT_BYTES
                or info.st_uid not in {0, os.geteuid()} or info.st_mode & 0o077):
            raise ValueError('Bounded private filesystem export required')
        layer_digest = _digest(source)
        source.seek(0)
        image_config = {'architecture': platform['architecture'], 'os': platform['os'],
                        'config': config, 'rootfs': {'type': 'layers', 'diff_ids': ['sha256:' + layer_digest]}}
        if platform.get('variant'):
            image_config['variant'] = platform['variant']
        raw_config = json.dumps(image_config, sort_keys=True, separators=(',', ':')).encode()
        image_id = hashlib.sha256(raw_config).hexdigest()
        layer_name, config_name = layer_digest + '/layer.tar', image_id + '.json'
        # A scoped local reference also makes containerd-backed Docker retain
        # the imported image. The loader must refuse an unrelated existing tag.
        local_tag = 'treseko-recovery:' + owner
        manifest = json.dumps([{'Config': config_name, 'RepoTags': [local_tag], 'Layers': [layer_name]}]).encode()
        output_fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(output_fd, 'wb', buffering=0) as output:
                # Allow tar headers, padding and config, in addition to the layer.
                _require_space(output.fileno(), info.st_size + len(raw_config) + len(manifest) + 32768)
                with tarfile.open(fileobj=_SpaceCheckedWriter(output), mode='w') as archive:
                    for name, data in ((config_name, raw_config), ('manifest.json', manifest)):
                        member = tarfile.TarInfo(name)
                        member.size, member.mode = len(data), 0o600
                        archive.addfile(member, io.BytesIO(data))
                    member = tarfile.TarInfo(layer_name)
                    member.size, member.mode = info.st_size, 0o600
                    reader = _HashingReader(source)
                    archive.addfile(member, reader)
                    if reader.digest.hexdigest() != layer_digest:
                        raise TransactionFailure('Filesystem export changed while building recovery image')
                output.flush()
                os.fsync(output.fileno())
            with destination.open('rb') as output:
                archive_digest = _digest(output)
            directory_fd = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except BaseException:
            destination.unlink(missing_ok=True)  # Only our newly created, incomplete output.
            raise
    # Docker's legacy-archive importer may expose an OCI manifest/index ID
    # instead of this config digest. Loading must resolve and verify its own ID.
    return {'config_sha256': image_id, 'rootfs_sha256': layer_digest, 'local_tag': local_tag,
            'archive_sha256': archive_digest, 'owner': owner, 'platform': platform}
