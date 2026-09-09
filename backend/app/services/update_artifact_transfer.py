"""Bounded signed-package transfer into an operator-selected content-addressed cache."""
import hashlib
import json
import os
from pathlib import Path
import stat
import shutil
import tempfile

from .edition.update_manager import verify_update_manifest_signature
from .update_journal import exclusive_lock
from .update_transport import IDENTIFIER


MAX_PACKAGE_BYTES = 2 * 1024**3


def validate_header(request):
    if (not isinstance(request, dict)
            or set(request) != {"schema", "participant", "transaction", "operation", "release"}
            or request["schema"] != 1 or request["operation"] != "receive"
            or not all(isinstance(request[key], str) and IDENTIFIER.fullmatch(request[key])
                       for key in ("participant", "transaction"))
            or not isinstance(request["release"], dict)):
        raise ValueError("Invalid artifact transfer envelope")
    manifest = request["release"]
    valid, _ = verify_update_manifest_signature(manifest)
    size, digest = manifest.get("package_size_bytes"), manifest.get("checksum_sha256")
    if (not valid or type(size) is not int or not 0 < size <= MAX_PACKAGE_BYTES
            or not isinstance(digest, str) or len(digest) != 64
            or any(c not in "0123456789abcdef" for c in digest)):
        raise ValueError("Invalid signed artifact identity or size")
    return size, digest


def read_header(stream):
    line = stream.readline(1024 * 1024 + 1)
    if len(line) > 1024 * 1024 or not line.endswith(b"\n"):
        raise ValueError("Artifact header exceeds limit or is incomplete")
    return json.loads(line)


def receive_artifact(stream, request, cache: Path):
    size, digest = validate_header(request)
    with exclusive_lock(cache / ".artifact-transfer.lock"):
        if shutil.disk_usage(cache).free < size + 64 * 1024**2:
            raise ValueError("Insufficient space to receive artifact safely")
        descriptor, temporary = tempfile.mkstemp(prefix=".incoming-", dir=cache)
        try:
            with os.fdopen(descriptor, "wb") as output:
                remaining, checksum = size, hashlib.sha256()
                while remaining:
                    chunk = stream.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError("Artifact stream ended early")
                    remaining -= len(chunk)
                    checksum.update(chunk)
                    output.write(chunk)
                if stream.read(1) or checksum.hexdigest() != digest:
                    raise ValueError("Artifact stream size or checksum mismatch")
                output.flush()
                os.fsync(output.fileno())
            target = cache / (digest + ".tar.gz")
            if target.exists() or target.is_symlink():
                descriptor = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                with os.fdopen(descriptor, "rb") as existing:
                    metadata = os.fstat(existing.fileno())
                    if (not stat.S_ISREG(metadata.st_mode) or metadata.st_size != size
                            or hashlib.file_digest(existing, "sha256").hexdigest() != digest):
                        raise ValueError("Existing cache entry is not the expected artifact")
            else:
                # Publish only completely verified bytes, without replacing a
                # cache entry created concurrently by another process.
                os.link(temporary, target)
            descriptor = os.open(cache, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        finally:
            os.unlink(temporary)
    return {"schema": 1, "ok": True, "operation": "receive",
            "participant": request["participant"], "transaction": request["transaction"],
            "checksum_sha256": digest, "package_size_bytes": size}
