"""Verify and stage a release locally before a participant may replace code."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import tarfile
import tempfile

from .edition.update_manager import verify_update_manifest_signature


COMPONENT_PATHS = {
    "backend": "backend", "frontend": "frontend/dist",
    "engine": "engine", "automation_worker": "automation-worker",
}


def stage_verified_package(archive: Path, manifest: dict, destination: Path,
                           *, max_bytes: int = 2 * 1024**3, max_files: int = 100000) -> Path:
    """The manifest is the vendor-signed object; transport envelopes are excluded.

    A private staging directory is renamed into place only after full validation.
    No hook or other package code is executed by this function.
    """
    valid, error = verify_update_manifest_signature(manifest)
    if not valid:
        raise ValueError(error or "Invalid release signature")
    if destination.exists():
        raise FileExistsError("Staging destination already exists")
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".release-", dir=destination.parent))
    try:
        # Hash and extract the same private copy, eliminating source replacement races.
        private_archive = stage / "package.tar.gz"
        digest = hashlib.sha256()
        size = 0
        with archive.open("rb") as source, private_archive.open("xb") as output:
            while chunk := source.read(1024 * 1024):
                size += len(chunk)
                if size > max_bytes:
                    raise ValueError("Compressed release exceeds limit")
                digest.update(chunk)
                output.write(chunk)
        if digest.hexdigest() != manifest.get("checksum_sha256"):
            raise ValueError("Release checksum mismatch")
        if size != manifest.get("package_size_bytes"):
            raise ValueError("Release size mismatch")
        payload = stage / "payload"
        payload.mkdir()
        names = set()
        total = 0
        with tarfile.open(private_archive, "r:gz") as tar:
            for member in tar:
                path = PurePosixPath(member.name)
                if path.is_absolute() or ".." in path.parts or "\\" in member.name:
                    raise ValueError("Release contains unsafe path")
                if any(part in {".maintenance", ".runner-token", ".env"}
                       or part.startswith((".treseko-update-", ".env.")) for part in path.parts):
                    raise ValueError("Release cannot contain local identity or update control files")
                if not (member.isdir() or member.isfile()):
                    raise ValueError("Release contains link or special file")
                name = str(path)
                if name in names:
                    raise ValueError("Release contains duplicate path")
                names.add(name)
                total += member.size
                if len(names) > max_files or total > max_bytes:
                    raise ValueError("Expanded release exceeds limit")
                target = payload.joinpath(*path.parts)
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    source = tar.extractfile(member)
                    if source is None:
                        raise ValueError("Missing release file data")
                    with source, target.open("xb") as output:
                        shutil.copyfileobj(source, output)
                        output.flush()
                        os.fsync(output.fileno())
                    target.chmod(0o755 if member.mode & 0o111 else 0o644)
        version = str(manifest.get("version") or "")
        if not version or (payload / "VERSION").read_text().strip() != version:
            raise ValueError("Release version mismatch")
        if not (payload / "backend/app/version.py").is_file() or not (payload / "backend/entrypoint.sh").is_file():
            raise ValueError("Release backend runtime is missing")
        for component in ("frontend", "engine", "automation_worker"):
            root = payload / COMPONENT_PATHS[component]
            if (root / "VERSION").read_text().strip() != version:
                raise ValueError(f"Component version mismatch: {component}")
        frontend = json.loads((payload / "frontend/dist/version.json").read_text())
        if frontend.get("version") != version:
            raise ValueError("Frontend metadata version mismatch")
        for component in ("engine", "automation_worker"):
            package = json.loads((payload / COMPONENT_PATHS[component] / "package.json").read_text())
            if package.get("version") != version:
                raise ValueError(f"Component package version mismatch: {component}")
        # A durable journal may refer to this tree immediately after return.
        # Persist directory entries before publishing that reference.
        for directory, _, _ in os.walk(payload, topdown=False):
            descriptor = os.open(directory, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        payload.rename(destination)
        descriptor = os.open(destination.parent, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        return destination
    finally:
        shutil.rmtree(stage)
