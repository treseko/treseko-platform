"""Prepare all declared runtime images before any service is stopped.

This is a host-side, read-only-to-services preparation phase.  It stages a
signed package, builds pinned images, and returns receipts for a later driver;
it never starts/stops containers, migrates databases, or declares installation
readiness.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import stat
import uuid
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from .edition.update_manager import verify_update_manifest_signature
from .update_docker_build import DockerImagePreparation
from .update_journal import exclusive_lock, save_json
from .update_participant_commands import load_private_json
from .update_participant_package import stage_verified_package
from .update_transaction import TransactionFailure

SCHEMA = 1
COMPONENTS = {"backend", "frontend", "engine", "automation_worker"}
PLATFORMS = {"linux/amd64", "linux/arm64"}
_TX = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
_STAGE = Callable[[Path, dict[str, Any], Path], Path]
_FACTORY = Callable[[str, Path, str, str, str], Any]


class RuntimePreparationError(TransactionFailure):
    """Preparation cannot safely continue or replay."""


class RuntimeImagePreparation:
    def __init__(self, config: Mapping[str, Any], manifest: Mapping[str, Any], transaction: str,
                 *, stage: _STAGE = stage_verified_package,
                 factory: _FACTORY = DockerImagePreparation):
        _validate_config(config)
        if not isinstance(manifest, Mapping) or not _TX.fullmatch(transaction):
            raise ValueError("Explicit release manifest and transaction required")
        self.config, self.manifest, self.transaction = dict(config), dict(manifest), transaction
        self.stage = stage
        self.factory = factory

    def prepare(self) -> dict[str, Any]:
        directory = Path(self.config["directory"])
        cache = Path(self.config["cache"])
        journal = directory / f"{self.transaction}.json"
        binding = _binding(self.config, self.manifest, self.transaction)
        with exclusive_lock(directory / f"{self.transaction}.lock"):
            _verify_manifest(self.manifest)
            archive = cache / (str(self.manifest["checksum_sha256"]) + ".tar.gz")
            _validate_archive(archive, self.manifest)
            state = _read_journal(journal)
            if state is not None:
                if state.get("binding") != binding:
                    raise RuntimePreparationError("Runtime preparation configuration or release changed")
                if state.get("status") in {"staging", "stage_failed"}:
                    orphan = state.get("stage")
                    stage_dir = directory / self.transaction / f"stage-{uuid.uuid4().hex}"
                    state.setdefault("orphaned_stages", []).append(orphan)
                    state.update(stage=str(stage_dir), status="staging", receipts={},
                                 attempted_components=[], current_component=None)
                    save_json(journal, state)
                    _stage_package(self.stage, archive, self.manifest, stage_dir, state, journal)
                elif state.get("status") not in {"failed", "preparing", "prepared"}:
                    raise RuntimePreparationError("Invalid runtime preparation state")
                else:
                    stage_dir = Path(state["stage"])
            else:
                stage_dir = directory / self.transaction / f"stage-{uuid.uuid4().hex}"
                state = {"schema": SCHEMA, "binding": binding, "stage": str(stage_dir),
                         "status": "staging", "receipts": {}, "attempted_components": [],
                         "orphaned_stages": [], "current_component": None}
                save_json(journal, state)
                _stage_package(self.stage, archive, self.manifest, stage_dir, state, journal)
            if not stage_dir.is_dir():
                raise RuntimePreparationError("Prepared package stage is unavailable")
            _validate_build_plan(stage_dir, self.config["components"])
            try:
                receipts = dict(state.get("receipts") or {})
                attempted = list(state.get("attempted_components") or [])
                if (len(set(attempted)) != len(attempted)
                        or any(component not in self.config["components"] for component in attempted)):
                    raise RuntimePreparationError("Invalid attempted component journal")
                # This is a preflight over the original attempted set.  It must
                # run before any factory call, so a lost receipt cannot be
                # hidden by a later successful component.
                for component in attempted:
                    receipt_path = directory / self.transaction / "images" / component / "image-build.json"
                    if not receipt_path.is_file():
                        raise RuntimePreparationError("Attempted component receipt is missing; reconcile is blocked")
                for component in self.config["components"]:
                    image_dir = directory / self.transaction / "images" / component
                    receipt_exists = (image_dir / "image-build.json").is_file()
                    if component in attempted and not receipt_exists:
                        raise RuntimePreparationError("Attempted component receipt is missing; reconcile is blocked")
                    if component not in attempted:
                        attempted.append(component)
                        state["attempted_components"] = attempted
                    state["current_component"] = component
                    save_json(journal, state)
                    prepared = self.factory(str(self.config["docker"]), stage_dir, component,
                                             str(self.manifest["checksum_sha256"]), str(self.config["platform"]))
                    receipts[component] = prepared.prepare(image_dir)
                    state.update(status="preparing", receipts=receipts, current_component=None)
                    save_json(journal, state)
                if set(receipts) != set(self.config["components"]) or any(not item.get("image") for item in receipts.values()):
                    raise RuntimePreparationError("Runtime image preparation is incomplete")
                state.update(status="prepared", receipts=receipts)
                save_json(journal, state)
                return {"schema": SCHEMA, "status": "prepared", "controller_ready": False,
                        "transaction": self.transaction, "platform": self.config["platform"],
                        "images": {name: receipts[name]["image"] for name in self.config["components"]},
                        "receipts": receipts}
            except Exception as exc:
                state["status"] = "failed"
                save_json(journal, state)
                if isinstance(exc, RuntimePreparationError):
                    raise
                raise RuntimePreparationError("Runtime image preparation failed; journal retained") from exc


def prepare_runtime_images(config: Mapping[str, Any], manifest: Mapping[str, Any], transaction: str,
                           **kwargs: Any) -> dict[str, Any]:
    return RuntimeImagePreparation(config, manifest, transaction, **kwargs).prepare()


def _validate_config(config: Mapping[str, Any]) -> None:
    allowed = {"schema", "docker", "cache", "directory", "platform", "components"}
    if not isinstance(config, Mapping) or set(config) != allowed or type(config.get("schema")) is not int or config["schema"] != SCHEMA:
        raise ValueError("Runtime preparation config schema or keys invalid")
    for key in ("docker", "cache", "directory"):
        if not isinstance(config[key], str) or not Path(config[key]).is_absolute() or ".." in Path(config[key]).parts:
            raise ValueError("Runtime preparation paths must be absolute and dedicated")
    if config["platform"] not in PLATFORMS:
        raise ValueError("Unsupported explicit runtime platform")
    components = config["components"]
    if not isinstance(components, list) or not components or len(set(components)) != len(components) or any(item not in COMPONENTS for item in components):
        raise ValueError("Runtime components must be an explicit non-empty allowed list")


def _verify_manifest(manifest: Mapping[str, Any]) -> None:
    valid, error = verify_update_manifest_signature(dict(manifest))
    if not valid:
        raise RuntimePreparationError(error or "Invalid release signature")
    if not isinstance(manifest.get("version"), str) or not manifest.get("version"):
        raise RuntimePreparationError("Release version is required")
    if not isinstance(manifest.get("checksum_sha256"), str) or not re.fullmatch(r"[a-f0-9]{64}", manifest["checksum_sha256"]):
        raise RuntimePreparationError("Release checksum is invalid")
    if type(manifest.get("package_size_bytes")) is not int or manifest["package_size_bytes"] <= 0:
        raise RuntimePreparationError("Release package size is invalid")


def _stage_package(stage_fn: _STAGE, archive: Path, manifest: Mapping[str, Any],
                   stage_dir: Path, state: dict[str, Any], journal: Path) -> None:
    try:
        staged = stage_fn(archive, dict(manifest), stage_dir)
        if Path(staged) != stage_dir:
            raise RuntimePreparationError("Package stage path changed")
        _validate_build_plan(Path(staged), state["binding"]["components"])
    except Exception as exc:
        state["status"] = "stage_failed"
        save_json(journal, state)
        if isinstance(exc, RuntimePreparationError):
            raise
        raise RuntimePreparationError("Signed package staging failed; journal retained") from exc
    state["status"] = "preparing"
    save_json(journal, state)


def _validate_archive(archive: Path, manifest: Mapping[str, Any]) -> None:
    try:
        metadata = archive.lstat()
        if not stat.S_ISREG(metadata.st_mode) or archive.is_symlink() or metadata.st_size != manifest["package_size_bytes"]:
            raise RuntimePreparationError("Release cache checksum or size mismatch")
        digest = hashlib.sha256()
        with archive.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise RuntimePreparationError("Release package is unavailable") from exc
    if digest.hexdigest() != manifest["checksum_sha256"]:
        raise RuntimePreparationError("Release cache checksum or size mismatch")


def _binding(config: Mapping[str, Any], manifest: Mapping[str, Any], transaction: str) -> dict[str, Any]:
    config_bytes = json.dumps(dict(config), sort_keys=True, separators=(",", ":")).encode()
    release = {key: manifest.get(key) for key in ("version", "checksum_sha256", "package_size_bytes", "signature", "key_id")}
    return {"config_sha256": hashlib.sha256(config_bytes).hexdigest(), "release": release,
            "components": list(config["components"]), "platform": config["platform"], "transaction": transaction}


def _read_journal(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        state = json.loads(path.read_text())
    except (OSError, ValueError) as exc:
        raise RuntimePreparationError("Invalid runtime preparation journal") from exc
    if not isinstance(state, dict) or state.get("schema") != SCHEMA:
        raise RuntimePreparationError("Invalid runtime preparation journal")
    return state


def _validate_build_plan(stage: Path, components: Sequence[str]) -> None:
    try:
        plan = json.loads((stage / "runtime-builds.json").read_text())
        declared = plan["components"]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise RuntimePreparationError("Runtime image build plan is unavailable") from exc
    if plan.get("schema") != 1 or not isinstance(declared, Mapping) or any(item not in declared for item in components):
        raise RuntimePreparationError("Runtime image build plan omits a declared component")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Prepare signed runtime images without changing services")
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--transaction", required=True)
    args = parser.parse_args(argv)
    try:
        config = load_private_json(args.config)
        raw = args.manifest.read_bytes()
        if len(raw) > 1024 * 1024:
            raise ValueError("manifest too large")
        manifest = json.loads(raw)
        result = prepare_runtime_images(config, manifest, args.transaction)
    except Exception:
        print(json.dumps({"schema": SCHEMA, "status": "blocked", "error": "runtime_preparation_failed"}, sort_keys=True))
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
