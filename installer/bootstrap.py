"""Helpers shared by the installer bootstrap and its non-GUI tests."""

from pathlib import Path
import os
import stat


def publish_release_tree(package_root: Path, target: Path) -> Path:
    """Publish one fully extracted release tree without replacing an active tree.

    ``os.rename`` is atomic on the same filesystem. Release directories are
    immutable: if the tag already exists, the caller must validate and reuse
    it or fail; it must never delete a directory that Compose may still use.
    """
    package_root = Path(package_root)
    target = Path(target)
    if package_root.is_symlink() or not package_root.is_dir():
        raise ValueError("Release staging root must be a real directory")
    if target.exists() or target.is_symlink():
        raise FileExistsError("Release target already exists; refusing to replace it")
    if not target.parent.is_dir() or target.parent.is_symlink():
        raise ValueError("Release cache directory must already exist and not be a symlink")
    if os.stat(package_root).st_dev != os.stat(target.parent).st_dev:
        raise OSError("Release staging and cache must be on the same filesystem")
    os.rename(package_root, target)
    info = target.lstat()
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise OSError("Published release tree is not a regular directory")
    return target


def build_gui_handoff_args(
    python_executable: str,
    gui_path: Path,
    package_root: Path,
    installation_root: Path,
    port: str,
    mode: str,
    demo: bool,
) -> list[str]:
    """Pass new package code and existing installation data as distinct roots."""
    args = [
        python_executable,
        str(gui_path),
        "--package",
        str(package_root),
        "--installation-root",
        str(installation_root),
        "--port",
        port,
        "--mode",
        mode,
    ]
    if demo:
        args.append("--demo")
    return args
