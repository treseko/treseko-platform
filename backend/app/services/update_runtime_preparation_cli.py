"""Fixed host helper for signed runtime-image preparation."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from .update_participant_commands import load_private_json
from .update_runtime_preparation import RuntimeImagePreparation
from .update_runtime_preparation_rpc import (MAX_RESPONSE_BYTES, binding_identity,
                                              configuration_identity, validate_receipt_maps)
from .update_transport import IDENTIFIER


def handle(config: dict, request: dict) -> dict:
    expected_config = {"schema", "docker", "cache", "directory", "platform", "components"}
    expected_request = {"schema", "transaction", "release", "helper_identity"}
    if (not isinstance(config, dict) or set(config) != expected_config
            or not isinstance(request, dict) or set(request) != expected_request
            or type(request.get("schema")) is not int or request["schema"] != 1
            or not isinstance(request.get("transaction"), str) or not IDENTIFIER.fullmatch(request["transaction"])
            or not isinstance(request.get("release"), dict)
            or request["helper_identity"] != configuration_identity(config)):
        raise ValueError("Runtime preparation request differs from private host inventory")
    result = RuntimeImagePreparation(config, request["release"], request["transaction"]).prepare()
    images, receipts = result["images"], result["receipts"]
    validate_receipt_maps(images, receipts, request["release"],
                          expected_components=set(config["components"]),
                          expected_platform=config["platform"])
    return {"schema": 1, "ok": True, "transaction": request["transaction"],
            "helper_identity": request["helper_identity"], "version": request["release"].get("version"),
            "checksum_sha256": request["release"].get("checksum_sha256"), "images": images,
            "receipts": receipts,
            "binding_sha256": binding_identity(request["helper_identity"], request["transaction"],
                                                request["release"], images, receipts)}


def _error_code(exc: Exception) -> str:
    message = str(exc).lower()
    if "package is unavailable" in message:
        return "release_package_missing"
    if "checksum" in message or "size mismatch" in message:
        return "release_package_invalid"
    return "runtime_preparation_failed"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Fixed Treseko runtime preparation helper")
    parser.add_argument("--config", type=Path, default=Path("/etc/treseko/update-runtime-preparation.json"))
    args = parser.parse_args(argv)
    try:
        config = load_private_json(args.config)
        raw = sys.stdin.buffer.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError("request exceeds limit")
        result = handle(config, json.loads(raw))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": _error_code(exc)}, sort_keys=True))
        return 1
    encoded = json.dumps(result, sort_keys=True).encode()
    if len(encoded) > MAX_RESPONSE_BYTES:
        print(json.dumps({"ok": False, "error": "response_too_large"}))
        return 1
    print(encoded.decode())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
