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
    "plugin_runner": "plugin-runner",
}
MANIFEST_COMPONENT_NAMES = {
    "backend": "backend", "frontend": "frontend", "engine": "engine",
    "automation-worker": "automation_worker", "plugin-runner": "plugin_runner",
}


def _validate_component_contract(payload: Path, manifest: dict) -> None:
    """Reject packages whose signed component inventory disagrees with payload plans.

    Older signed releases predate the embedded package metadata and remain
    installable. Once any of the three metadata files is present, however, all
    must be present and agree; silently accepting a partial inventory could
    leave an installation with components from different releases.
    """
    metadata_paths = ("manifest.json", "update-plan.json", "runtime-builds.json")
    present = [relative for relative in metadata_paths if (payload / relative).is_file()]
    if not present:
        return
    if len(present) != len(metadata_paths):
        missing = sorted(set(metadata_paths) - set(present))
        raise ValueError("Release component contract is incomplete: " + ", ".join(missing))

    try:
        embedded = json.loads((payload / "manifest.json").read_text(encoding="utf-8"))
        plan = json.loads((payload / "update-plan.json").read_text(encoding="utf-8"))
        builds = json.loads((payload / "runtime-builds.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("Release component contract metadata is invalid") from exc

    version = str(manifest.get("version") or "")
    if embedded.get("version") != version or plan.get("version") != version:
        raise ValueError("Release component contract version mismatch")
    source_versions = manifest.get("from_versions")
    if not isinstance(source_versions, list) or not source_versions:
        previous_version = str(manifest.get("previous_version") or "").strip()
        source_versions = [previous_version] if previous_version else None
    embedded_sources = embedded.get("from_versions")
    plan_sources = plan.get("previous_versions")
    if any(value is not None for value in (source_versions, embedded_sources, plan_sources)):
        normalized_sources = [
            sorted({str(item).strip() for item in value if str(item).strip()})
            if isinstance(value, list) else None
            for value in (source_versions, embedded_sources, plan_sources)
        ]
        if any(value is None for value in normalized_sources) or not (
            normalized_sources[0] == normalized_sources[1] == normalized_sources[2]
        ):
            raise ValueError("Release source-version chain disagrees across manifest and update plan")
        source_set = set(normalized_sources[0] or [])
        for source_manifest in (manifest, embedded):
            previous = str(source_manifest.get("previous_version") or "").strip()
            if previous and previous not in source_set:
                raise ValueError("Release previous_version is outside its declared source-version chain")

    signed_components = manifest.get("components")
    embedded_components = embedded.get("components")
    plan_components = plan.get("components")
    runtime_components = builds.get("components")
    if not all(isinstance(value, dict) for value in (
        signed_components, embedded_components, plan_components, runtime_components
    )):
        raise ValueError("Release component contract inventory is missing")

    def enabled_components(value: dict, names_map: dict[str, str]) -> set[str]:
        unknown = set(value) - set(names_map)
        if unknown:
            raise ValueError("Release declares unknown components: " + ", ".join(sorted(unknown)))
        return {names_map[key] for key, enabled in value.items() if enabled is True}

    signed = enabled_components(signed_components, MANIFEST_COMPONENT_NAMES)
    embedded_set = enabled_components(embedded_components, MANIFEST_COMPONENT_NAMES)
    allowed_runtime_names = set(MANIFEST_COMPONENT_NAMES.values())
    if set(plan_components) != allowed_runtime_names.intersection(plan_components):
        raise ValueError("Release update plan declares an unknown component")
    if any(operation not in ("replace", True) for operation in plan_components.values()):
        raise ValueError("Release update plan has an unsupported component operation")
    plan_set = set(plan_components)
    runtime_set = set(runtime_components)
    expected = set(signed)
    if embedded_set != expected or plan_set != expected or runtime_set != expected:
        raise ValueError("Release component inventory disagrees across manifest, plan and runtime builds")

    for component in expected:
        root = payload / COMPONENT_PATHS[component]
        if not root.is_dir():
            raise ValueError(f"Declared release component is missing: {component}")
        spec = runtime_components.get(component)
        if not isinstance(spec, dict):
            raise ValueError(f"Runtime build is missing for declared component: {component}")
        context = spec.get("context")
        dockerfile = spec.get("dockerfile")
        context_path = PurePosixPath(context) if isinstance(context, str) else PurePosixPath("/")
        dockerfile_path = PurePosixPath(dockerfile) if isinstance(dockerfile, str) else PurePosixPath("/")
        if (context_path.is_absolute() or ".." in context_path.parts
                or dockerfile_path.is_absolute() or ".." in dockerfile_path.parts):
            raise ValueError(f"Runtime build path escapes release package: {component}")
        if (not (payload / context_path).is_dir()
                or not (payload / dockerfile_path).is_file()):
            raise ValueError(f"Runtime Dockerfile is missing for declared component: {component}")
    if plan.get("rollback", {}).get("enabled") is not True:
        raise ValueError("Release component plan must enable rollback")


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
        _validate_component_contract(payload, manifest)
        # Plugin Runner was added after the original 1.0.3 package contract.
        # Validate it whenever the signed release declares it, while allowing
        # older signed manifests (which have no component map) to remain valid.
        declared = manifest.get("components")
        plugin_declared = isinstance(declared, dict) and declared.get("plugin-runner") is True
        if plugin_declared:
            root = payload / COMPONENT_PATHS["plugin_runner"]
            if not (root / "Dockerfile").is_file() or not (root / "src/server.mjs").is_file():
                raise ValueError("Release plugin_runner runtime is missing")
            package = json.loads((root / "package.json").read_text())
            if package.get("name") != "treseko-plugin-runner" or package.get("type") != "module":
                raise ValueError("Plugin Runner package metadata is invalid")
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
