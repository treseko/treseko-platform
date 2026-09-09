"""Copy explicitly inventoried mutable directories from a pinned container image.

Both containers stay stopped. Runtime-volume contents need a separate volume
copy; this handles data in the writable layer, including the worker result spool.
"""
import hashlib
import json
from pathlib import PurePosixPath
import subprocess
import tarfile
import tempfile

from .update_transaction import TransactionFailure


def preserve_mutable_directory(docker, snapshot_image, candidate, directory, *, max_bytes=1024**3):
    path = PurePosixPath(directory)
    if (not path.is_absolute() or len(path.parts) < 3 or ".." in path.parts
            or str(path) != directory or path.parts[1] in {"bin", "sbin", "lib", "lib64", "usr", "etc", "proc", "sys", "dev"}):
        raise ValueError("An explicit dedicated mutable directory is required")

    def run(args, **kwargs):
        result = subprocess.run([docker, *args], stderr=subprocess.DEVNULL, timeout=120, **kwargs)
        if result.returncode:
            raise TransactionFailure("Mutable data copy failed; retain maintenance and snapshot")
        return result

    info = json.loads(run(["inspect", "--type", "container", candidate], stdout=subprocess.PIPE).stdout)[0]
    if info["State"]["Running"]:
        raise TransactionFailure("Mutable data target must remain stopped")
    # Do not overwrite mounted production data through docker cp.
    for mount in info["Mounts"]:
        target = PurePosixPath(mount["Destination"])
        if path == target or path.is_relative_to(target) or target.is_relative_to(path):
            raise TransactionFailure("Mounted mutable data needs coordinated volume preservation")
    identity = hashlib.sha256((snapshot_image + candidate + directory).encode()).hexdigest()
    helper_name = "treseko-data-" + identity
    label = "io.treseko.mutable-copy=" + identity
    existing = run(["ps", "--all", "--quiet", "--filter", "name=^/" + helper_name + "$"], stdout=subprocess.PIPE).stdout
    if not existing.strip():
        run(["create", "--name", helper_name, "--network=none", "--label", label,
             "--label", "com.docker.compose.project=", "--label", "com.docker.compose.service=",
             "--label", "com.docker.compose.oneoff=True", "--entrypoint", "/bin/false", snapshot_image],
            stdout=subprocess.DEVNULL)
    helper = json.loads(run(["inspect", "--type", "container", helper_name], stdout=subprocess.PIPE).stdout)[0]
    if ((helper["Config"].get("Labels") or {}).get("io.treseko.mutable-copy") != identity
            or helper["Image"] != snapshot_image or helper["State"]["Running"]):
        raise TransactionFailure("Mutable data helper identity mismatch")
    # Snapshot images do not include mounted runtime data. Reject paths hidden
    # by an image-declared VOLUME rather than copying a newly seeded volume.
    for mount in helper["Mounts"]:
        target = PurePosixPath(mount["Destination"])
        if path == target or path.is_relative_to(target) or target.is_relative_to(path):
            raise TransactionFailure("Snapshot mutable source is hidden by a volume")
    with tempfile.TemporaryFile() as archive, tempfile.TemporaryFile() as validated:
        run(["cp", "--archive", helper_name + ":" + directory, "-"], stdout=archive)
        if archive.tell() > max_bytes:
            raise TransactionFailure("Mutable data archive exceeds configured limit")
        archive.seek(0)
        names = set()
        total = 0
        with tarfile.open(fileobj=archive, mode="r:") as source, tarfile.open(fileobj=validated, mode="w") as output:
            for member in source:
                name = PurePosixPath(member.name)
                if (not name.parts or name.parts[0] != path.name or name.is_absolute()
                        or ".." in name.parts or "\\" in member.name or str(name) in names
                        or (str(name) == path.name and not member.isdir())
                        or not (member.isdir() or member.isfile())):
                    raise TransactionFailure("Mutable data contains unsupported paths or links")
                total += member.size
                if total > max_bytes or len(names) >= 100000:
                    raise TransactionFailure("Mutable data exceeds configured limit")
                names.add(str(name))
                # Preserve data/owner/mode, but not arbitrary extended tar headers.
                clean = tarfile.TarInfo(str(name))
                clean.type, clean.size = member.type, member.size
                clean.mode, clean.uid, clean.gid, clean.mtime = member.mode, member.uid, member.gid, member.mtime
                output.addfile(clean, source.extractfile(member) if member.isfile() else None)
        if path.name not in names:
            raise TransactionFailure("Mutable directory root is missing")
        validated.seek(0)
        current = json.loads(run(["inspect", "--type", "container", candidate], stdout=subprocess.PIPE).stdout)[0]
        if current["State"]["Running"]:
            raise TransactionFailure("Mutable target started before data preservation completed")
        run(["cp", "--archive", "-", candidate + ":" + str(path.parent)], stdin=validated, stdout=subprocess.DEVNULL)
    # Only this positively identified, never-started helper is removed.
    run(["rm", "--volumes", helper["Id"]], stdout=subprocess.DEVNULL)
