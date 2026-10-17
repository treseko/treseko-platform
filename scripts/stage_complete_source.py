#!/usr/bin/env python3
"""Stage the versioned public Compose tree without packaging local state."""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path


EXCLUDED_DIRS = {
    ".git", ".treseko", ".treseko-local", ".venv", "venv", "node_modules",
    "dist", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
    "coverage", "test-results", "playwright-report",
}
EXCLUDED_FILES = {".gitignore", ".runner-token", ".worker-instance-id",
                  ".runner-token.pairing", ".maintenance", ".DS_Store"}
EXCLUDED_SUFFIXES = {".pyc", ".pyo", ".log", ".jsonl"}
ALLOWED_ENV_EXAMPLES = {
    ".env.production.example",
    "automation-worker/.env.example",
    "automation-worker/.env.production.example",
    "backend/.env.production.example",
    "engine/.env.production.example",
    "frontend/.env.example",
}
REQUIRED_PATHS = (
    "VERSION", "docker-compose.prod.yml", "scripts/atomic_local_update.py",
    "scripts/install_local_treseko.sh", "backend/Dockerfile", "frontend/Dockerfile",
    "engine/Dockerfile", "automation-worker/Dockerfile", "plugin-runner/Dockerfile",
)


def iter_release_files(source: Path):
    """Yield every shipped file, excluding only generated or local state."""
    source = source.resolve(strict=True)
    for current, directories, names in os.walk(source, topdown=True, followlinks=False):
        current_path = Path(current)
        relative = current_path.relative_to(source)
        is_backend_app = relative.as_posix() == "backend/app"
        kept_dirs = []
        for name in sorted(directories):
            if name in EXCLUDED_DIRS or name.startswith(".env"):
                continue
            if relative == Path(".") and name == "public-release":
                continue
            if is_backend_app and name == "static":
                continue
            path = current_path / name
            if path.is_symlink():
                raise ValueError(f"Source release contains a symbolic link: {path.relative_to(source)}")
            kept_dirs.append(name)
        directories[:] = kept_dirs
        for name in sorted(names):
            path = current_path / name
            is_env_example = path.relative_to(source).as_posix() in ALLOWED_ENV_EXAMPLES
            if (name in EXCLUDED_FILES
                    or (name.startswith(".env") and not is_env_example)
                    or name.startswith(("._", ".treseko-update-"))
                    or path.suffix in EXCLUDED_SUFFIXES):
                continue
            if path.is_symlink() or not path.is_file():
                raise ValueError(f"Source release contains a non-regular file: {path.relative_to(source)}")
            yield path


def stage(source: Path, destination: Path, expected_version: str) -> int:
    source = source.resolve(strict=True)
    if source.is_symlink() or not source.is_dir():
        raise ValueError("Public source root must be a real directory")
    destination = destination.resolve()
    if source == destination or source in destination.parents or destination in source.parents:
        raise ValueError("Source and destination must be separate, non-overlapping trees")
    if destination.exists() and any(destination.iterdir()):
        raise ValueError("Source release destination must be empty")
    destination.mkdir(parents=True, exist_ok=True)
    count = 0
    for path in iter_release_files(source):
        relative = path.relative_to(source)
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        count += 1
    missing = [name for name in REQUIRED_PATHS if not (destination / name).is_file()]
    if missing:
        raise ValueError("Complete source release is missing: " + ", ".join(missing))
    actual_version = (destination / "VERSION").read_text(encoding="utf-8").strip()
    if actual_version != expected_version:
        raise ValueError("Complete source release VERSION does not match the update package")
    return count


def main(argv: list[str]) -> int:
    if len(argv) != 4:
        print("Usage: stage_complete_source.py SOURCE DESTINATION VERSION", file=sys.stderr)
        return 2
    try:
        count = stage(Path(argv[1]), Path(argv[2]), argv[3])
    except (OSError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(f"Complete source staged: {count} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
