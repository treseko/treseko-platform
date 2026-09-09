"""Bounded RPC client for the fixed host runtime-preparation helper."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import tempfile
from typing import Any

from .update_transaction import TransactionFailure
from .update_transport import IDENTIFIER, MAX_RESPONSE_BYTES, ProcessParticipant, _bounded_response

FIXED_HELPER = "/usr/local/libexec/treseko-update-runtime-preparation"
MAX_TIMEOUT = 3600


def configuration_identity(config: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(config, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def binding_identity(config_identity: str, transaction: str, release: dict[str, Any],
                    images: dict[str, Any], receipts: dict[str, Any]) -> str:
    value = {"config_identity": config_identity, "transaction": transaction,
             "version": release.get("version"), "checksum_sha256": release.get("checksum_sha256"),
             "images": images, "receipts": receipts}
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class ProcessRuntimePreparation:
    def __init__(self, preparation_id: str, command: tuple[str, ...] | list[str],
                 helper_identity: str, timeout: float = 300):
        if (not IDENTIFIER.fullmatch(preparation_id) or not isinstance(helper_identity, str)
                or not _hex64(helper_identity) or not command
                or not all(isinstance(arg, str) and arg and "\0" not in arg for arg in command)
                or not Path(command[0]).is_absolute() or command[-1] != FIXED_HELPER
                or isinstance(timeout, bool) or not isinstance(timeout, (int, float))
                or not math.isfinite(timeout) or not 0 < timeout <= MAX_TIMEOUT):
            raise ValueError("Fixed helper, private identity and bounded timeout required")
        self.name, self.command = preparation_id, tuple(command)
        self.identity, self.timeout = helper_identity, timeout

    @classmethod
    def ssh(cls, preparation_id: str, alias: str, helper_identity: str, timeout: float = 300):
        base = ProcessParticipant.ssh(preparation_id, alias, timeout)
        executable = shutil.which("ssh")
        if not executable:
            raise ValueError("SSH executable unavailable")
        resolved = subprocess.run([executable, "-G", *base.command[1:-1]], capture_output=True,
                                   timeout=15, check=False)
        if resolved.returncode or len(resolved.stdout) > 1024 * 1024:
            raise ValueError("Unable to resolve SSH endpoint configuration")
        command = (executable, *base.command[1:-1], FIXED_HELPER)
        return cls(preparation_id, command, helper_identity, timeout), {
            "ssh_executable": executable,
            "ssh_config_digest": hashlib.sha256(resolved.stdout).hexdigest(),
        }

    def prepare(self, transaction: str, release: dict[str, Any]) -> dict[str, Any]:
        if not IDENTIFIER.fullmatch(transaction) or not isinstance(release, dict):
            raise ValueError("Invalid preparation transaction or release")
        request = {"schema": 1, "transaction": transaction, "release": release,
                   "helper_identity": self.identity}
        encoded = json.dumps(request, sort_keys=True, separators=(",", ":")).encode()
        if len(encoded) > 1024 * 1024:
            raise ValueError("Preparation request exceeds limit")
        try:
            with tempfile.TemporaryFile() as source:
                source.write(encoded)
                source.seek(0)
                response = _bounded_response(self.command, source, self.timeout)
            result = json.loads(response)
        except (OSError, subprocess.TimeoutExpired, ValueError, TypeError, RecursionError, TransactionFailure) as exc:
            raise TransactionFailure("Runtime preparation response unavailable; reconcile with the same helper") from exc
        try:
            validate_response(result, self.identity, transaction, release)
        except (TypeError, ValueError, KeyError) as exc:
            raise TransactionFailure("Runtime preparation receipt does not match request; reconcile required") from exc
        return result


def _hex64(value: str) -> bool:
    return len(value) == 64 and all(char in "0123456789abcdef" for char in value)


def validate_receipt_maps(images: Any, receipts: Any, release: dict[str, Any],
                          *, expected_components: set[str] | None = None,
                          expected_platform: str | None = None) -> None:
    if not isinstance(images, dict) or not images or not isinstance(receipts, dict) or not receipts:
        raise ValueError("Non-empty image and receipt maps required")
    if set(images) != set(receipts) or any(not isinstance(key, str) or not IDENTIFIER.fullmatch(key) for key in images):
        raise ValueError("Image and receipt component sets differ")
    if expected_components is not None and set(images) != expected_components:
        raise ValueError("Prepared components differ from host inventory")
    checksum = release.get("checksum_sha256")
    for component, image in images.items():
        if not isinstance(image, str) or not image.startswith("sha256:") or not _hex64(image[7:]):
            raise ValueError("Invalid prepared image identity")
        receipt = receipts[component]
        if not isinstance(receipt, dict) or set(receipt) not in ({"image", "component", "platform", "checksum"},
                                                                  {"image", "component", "platform", "checksum", "version"}):
            raise ValueError("Invalid image receipt fields")
        if (receipt.get("image") != image or receipt.get("component") != component
                or receipt.get("checksum") != checksum or receipt.get("platform") not in {"linux/amd64", "linux/arm64"}
                or (expected_platform is not None and receipt.get("platform") != expected_platform)
                or ("version" in receipt and receipt["version"] != release.get("version"))):
            raise ValueError("Image receipt identity differs from release")


def validate_response(result: Any, identity: str, transaction: str, release: dict[str, Any]) -> None:
    expected = {"schema", "ok", "transaction", "helper_identity", "version",
                "checksum_sha256", "images", "receipts", "binding_sha256"}
    if (not isinstance(result, dict) or set(result) != expected or type(result.get("schema")) is not int
            or result.get("schema") != 1 or result.get("ok") is not True
            or result.get("transaction") != transaction or result.get("helper_identity") != identity
            or result.get("version") != release.get("version")
            or result.get("checksum_sha256") != release.get("checksum_sha256")):
        raise ValueError("Response envelope differs from request")
    validate_receipt_maps(result["images"], result["receipts"], release)
    if result["binding_sha256"] != binding_identity(identity, transaction, release, result["images"], result["receipts"]):
        raise ValueError("Response binding differs from request")
