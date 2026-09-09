"""Prepare a pinned local image from an ALREADY signature-verified private stage.

Call before quiescing any service. The caller owns the immutable stage and must
not admit unverified sources. No stop/start/compose/cleanup operation is issued.
An uncertain build is never repeated automatically: adopt its uniquely tagged
image when available, otherwise retain the pending receipt for reconciliation.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

from .update_journal import exclusive_lock, save_json
from .update_transaction import TransactionFailure


class DockerImagePreparation:
    def __init__(self, docker: str, stage: Path, component: str, checksum: str, platform: str):
        if (not Path(docker).is_absolute() or not stage.is_absolute()
                or component not in {"backend", "frontend", "engine", "automation_worker"}
                or not re.fullmatch(r"[a-f0-9]{64}", checksum)
                or platform not in {"linux/amd64", "linux/arm64"}):
            raise ValueError("Explicit verified stage, component, checksum and platform required")
        self.docker, self.stage = docker, stage
        self.component, self.checksum, self.platform = component, checksum, platform

    def _scope(self):
        if self.stage.is_symlink():
            raise ValueError("Image stage must not be a symlink")
        plan = json.loads((self.stage / "runtime-builds.json").read_text())
        if plan.get("schema") != 1:
            raise ValueError("Unsupported image build plan")
        spec = plan["components"][self.component]
        root = self.stage.resolve()
        context, recipe = (root / spec[key] for key in ("context", "dockerfile"))
        if (not context.resolve().is_relative_to(root) or not recipe.resolve().is_relative_to(root)
                or not context.is_dir() or not recipe.is_file()):
            raise ValueError("Image recipe or context leaves verified stage")
        digest = hashlib.sha256()
        # Package staging prohibits links/special files. Recheck before handing
        # it to Docker, and bind retries to the same complete staged contents.
        for path in sorted(root.rglob("*")):
            if path.is_symlink() or not (path.is_file() or path.is_dir()):
                raise ValueError("Image stage contains links or special files")
            metadata = path.stat()
            digest.update(json.dumps([str(path.relative_to(root)), metadata.st_mode,
                                      metadata.st_size if path.is_file() else 0]).encode())
            if path.is_file():
                with path.open("rb") as source:
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        digest.update(chunk)
        return context, recipe, {"stage": str(root), "component": self.component,
                                 "checksum": self.checksum, "platform": self.platform,
                                 "contents": digest.hexdigest()}

    def _inspect(self, reference, owner):
        result = subprocess.run([self.docker, "image", "inspect", reference],
                                capture_output=True, timeout=30)
        if result.returncode:
            raise TransactionFailure("Prepared image unavailable; build may still be running")
        records = json.loads(result.stdout)
        if len(records) != 1:
            raise TransactionFailure("Ambiguous prepared image")
        record = records[0]
        if (record.get("Config", {}).get("Labels", {}).get("io.treseko.prepared-image") != owner
                or f'{record.get("Os")}/{record.get("Architecture")}' != self.platform
                or not re.fullmatch(r"sha256:[a-f0-9]{64}", record.get("Id", ""))):
            raise TransactionFailure("Prepared image identity or architecture mismatch")
        return record["Id"]

    def prepare(self, directory: Path):
        with exclusive_lock(directory / ".image-build.lock"):
            context, recipe, scope = self._scope()
            owner = hashlib.sha256(json.dumps([str(directory.resolve()), scope], sort_keys=True).encode()).hexdigest()
            tag = "treseko-update-prepared:" + owner
            receipt = directory / "image-build.json"
            if receipt.exists():
                state = json.loads(receipt.read_text())
                if state["scope"] != scope or state["owner"] != owner:
                    raise TransactionFailure("Prepared image inputs changed")
                image = self._inspect(state.get("image") or tag, owner)
            else:
                state = {"schema": 1, "scope": scope, "owner": owner, "tag": tag,
                         "status": "pending", "image": None}
                save_json(receipt, state)
                descriptor = os.open(directory / "image-build.log", os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                with os.fdopen(descriptor, "wb") as log:
                    try:
                        result = subprocess.run([self.docker, "build", "--platform", self.platform,
                                                 "--tag", tag, "--label", "io.treseko.prepared-image=" + owner,
                                                 "--file", str(recipe), str(context)],
                                                stdout=log, stderr=subprocess.STDOUT, timeout=1800)
                    except (OSError, subprocess.TimeoutExpired) as exc:
                        raise TransactionFailure("Image build uncertain; retain preparation receipt") from exc
                    if result.returncode:
                        raise TransactionFailure("Image build failed; private log retained, no services stopped")
                image = self._inspect(tag, owner)
            state.update(status="prepared", image=image)
            save_json(receipt, state)
            return {"image": image, "platform": self.platform, "component": self.component,
                    "checksum": self.checksum}
