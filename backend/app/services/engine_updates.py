"""Authenticated update payloads for independently hosted Treseko Engines."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import tarfile
import tempfile
from functools import lru_cache

from ..version import PRODUCT_VERSION

_VERSION = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$")
_BUILD = re.compile(r"[a-f0-9]{64}\Z")
_EXCLUDED_DIRS = {".git", "node_modules", ".cache", "logs", "reports", "pending-deliveries", "update-control", ".engine-releases", "test-results"}
_EXCLUDED_FILES = {".treseko-content-digest", ".treseko-runtime-manifest.json", ".treseko-update-fence", ".treseko-update-restart", ".treseko-active-engine-release.json", ".env"}


def engine_source_directory() -> Path:
    configured = os.getenv("TRESEKO_ENGINE_UPDATE_SOURCE_DIR", "").strip()
    candidates = [Path(configured)] if configured else []
    candidates += [Path("/opt/treseko/engine-source"), Path(__file__).resolve().parents[3] / "engine"]
    for candidate in candidates:
        if candidate.is_absolute() and candidate.is_dir() and not candidate.is_symlink():
            return candidate.resolve()
    raise ValueError("engine_source_unavailable")


def _records(source: Path):
    items: list[tuple[str, Path]] = []
    for current, dirs, files in os.walk(source, followlinks=False):
        base = Path(current)
        dirs[:] = [name for name in dirs if name not in _EXCLUDED_DIRS and not (base / name).is_symlink()]
        for name in files:
            item = base / name
            rel = item.relative_to(source).as_posix()
            if (name in _EXCLUDED_FILES or name.startswith(".env.") or item.is_symlink()
                    or not item.is_file()):
                continue
            if "\\" in rel or "\n" in rel or "\r" in rel:
                raise ValueError("engine_source_filename_invalid")
            items.append((rel, item))
    return sorted(items)


def _validate_engine_source_version(source: Path, version: str = PRODUCT_VERSION) -> None:
    try:
        metadata = json.loads((source / "package.json").read_text(encoding="utf-8"))
        source_version = (source / "VERSION").read_text(encoding="utf-8").strip()
    except (OSError, ValueError) as exc:
        raise ValueError("engine_source_metadata_invalid") from exc
    if not isinstance(metadata, dict) or metadata.get("version") != version or source_version != version:
        raise ValueError("engine_source_version_mismatch")


@lru_cache(maxsize=8)
def _build_id(root: str) -> str:
    source = Path(root)
    digest = hashlib.sha256()
    for rel, item in _records(source):
        file_hash = hashlib.sha256(item.read_bytes()).hexdigest()
        digest.update(f"{file_hash}  ./{rel}\n".encode())
    return digest.hexdigest()


def engine_source_build_id(source: Path | None = None) -> str:
    selected = (source or engine_source_directory()).resolve(strict=True)
    _validate_engine_source_version(selected)
    return _build_id(str(selected))


def create_engine_update_archive(source: Path, *, version: str = PRODUCT_VERSION) -> tuple[Path, str]:
    _validate_engine_source_version(source, version)
    files = _records(source)
    if not {"src/server.ts", "entrypoint.sh", "engine-launcher.mjs", "release-lifecycle.mjs", "engine-self-update.mjs",
            "package-lock.json", "package.json", "VERSION", "hash_component_tree.sh"} <= {r for r, _ in files}:
        raise ValueError("engine_source_incomplete")
    if len(files) > 20_000 or sum(path.stat().st_size for _, path in files) > 256 * 1024 * 1024:
        raise ValueError("engine_source_archive_limit_exceeded")
    handle, name = tempfile.mkstemp(prefix="treseko-engine-update-", suffix=".tar.gz")
    os.close(handle)
    archive = Path(name)
    try:
        with tarfile.open(archive, "w:gz") as tar:
            for rel, item in files:
                tar.add(item, arcname=rel, recursive=False)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        return archive, digest
    except Exception:
        archive.unlink(missing_ok=True)
        raise


def engine_update_status(version: str, build_id: str, *, desired_version: str = PRODUCT_VERSION,
                         desired_build_id: str = "") -> dict:
    observed = str(version or "").strip()
    desired = str(desired_version or "").strip()
    observed_build = str(build_id or "").strip().lower()
    target_build = str(desired_build_id or "").strip().lower()
    desired_match = _VERSION.fullmatch(desired)
    observed_match = _VERSION.fullmatch(observed)
    if not desired_match or not _BUILD.fullmatch(target_build):
        state = "target_unavailable"
    elif not observed_match or not _BUILD.fullmatch(observed_build):
        state = "version_unverified"
    elif tuple(map(int, observed_match.groups())) > tuple(map(int, desired_match.groups())):
        state = "ahead"
    elif observed == desired and observed_build == target_build:
        state = "current"
    else:
        state = "update_required"
    return {"status": state, "update_required": state == "update_required",
            "desired_version": desired if _VERSION.fullmatch(desired) else None,
            "observed_version": observed or None,
            "desired_build_id": target_build if _BUILD.fullmatch(target_build) else None,
            "observed_build_id": observed_build if _BUILD.fullmatch(observed_build) else None}
