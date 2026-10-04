#!/usr/bin/env python3
"""Create the GitHub release index consumed by platform installers."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import tempfile


VERSION_RE = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")
TARGET_RE = re.compile(r"^(windows-x64|linux-x64|macos-arm64|macos-x64|community-package)$")


def build_index(product_version: str, installer_version: str, artifacts: dict[str, Path]) -> dict:
    if not VERSION_RE.fullmatch(product_version) or not VERSION_RE.fullmatch(installer_version):
        raise ValueError("Las versiones del producto y del instalador deben ser SemVer válidas.")
    if not artifacts:
        raise ValueError("No se puede publicar un índice sin artefactos.")
    rows = {}
    for target, path in sorted(artifacts.items()):
        path = Path(path)
        if not TARGET_RE.fullmatch(target):
            raise ValueError(f"Destino de artefacto no reconocido: {target}")
        if path.is_symlink() or not path.is_file() or path.stat().st_size <= 0:
            raise ValueError(f"Artefacto ausente, vacío o no regular: {path}")
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        rows[target] = {
            "name": path.name,
            "size": path.stat().st_size,
            "sha256": digest.hexdigest(),
        }
    return {
        "schema": 1,
        "product": "treseko-platform",
        "product_version": product_version,
        "installer_version": installer_version,
        "artifacts": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--product-version", required=True)
    parser.add_argument("--installer-version", required=True)
    parser.add_argument("--artifact", action="append", default=[], metavar="TARGET=PATH")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    artifacts = {}
    for value in args.artifact:
        if "=" not in value:
            parser.error("--artifact debe usar TARGET=PATH")
        target, path = value.split("=", 1)
        if target in artifacts:
            parser.error(f"Artefacto duplicado: {target}")
        artifacts[target] = Path(path)
    try:
        index = build_index(args.product_version, args.installer_version, artifacts)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    data = (json.dumps(index, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    with tempfile.NamedTemporaryFile(dir=args.output.parent, prefix=f".{args.output.name}.", delete=False) as temporary:
        temp_path = Path(temporary.name)
        temporary.write(data)
    temp_path.replace(args.output)
    print(f"Release index written: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
