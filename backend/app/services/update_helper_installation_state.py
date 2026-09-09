"""Durable state transitions for the local helper installer."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat

from .update_journal import save_json


def fsync_tree(root):
    for directory, _, files in os.walk(root, topdown=False):
        for filename in files:
            descriptor = os.open(Path(directory) / filename, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        descriptor = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def installation_binding(manifest, config_hashes, python_binding, configs, paths, *, launcher_binding=None):
    config_binding = {
        name: {"path": str(path), "sha256": config_hashes[name]}
        for name, path in configs.items()
    }
    manifest_digest = hashlib.sha256(
        json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    result = {
        "release": {
            "manifest_sha256": manifest_digest,
            "version": manifest["version"],
            "checksum_sha256": manifest["checksum_sha256"],
            "package_size_bytes": manifest["package_size_bytes"],
        },
        "configs": config_binding,
        "bin_dir": str(paths["bin_dir"]),
        "state_dir": str(paths["state_dir"]),
        "python": python_binding,
    }
    if launcher_binding is not None:
        result["launcher"] = launcher_binding
    return result


def read_journal(path):
    try:
        info = path.lstat()
    except FileNotFoundError:
        return None
    if stat.S_ISLNK(info.st_mode):
        raise ValueError("Helper journal cannot be a symlink")
    if (not stat.S_ISREG(info.st_mode) or info.st_uid not in {0, os.geteuid()}
            or info.st_mode & 0o077):
        raise ValueError("Unsafe private helper journal")
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError, UnicodeError) as exc:
        raise ValueError("Invalid helper journal") from exc


def _assert_directory_identity(path, identity, label):
    info = path.lstat()
    current = (info.st_dev, info.st_ino, info.st_uid, stat.S_IMODE(info.st_mode))
    if not stat.S_ISDIR(info.st_mode) or current != identity:
        raise ValueError(f"{label} directory changed during installation")


def save_journal(path, value, state_dir, state_identity):
    _assert_directory_identity(state_dir, state_identity, "Helper state")
    save_json(path, value)


def _assert_safe_parent(path, label):
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        try:
            info = current.lstat()
        except FileNotFoundError:
            break
        if (stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode)
                or info.st_uid not in {0, os.geteuid()} or info.st_mode & 0o022):
            raise ValueError(f"Unsafe {label} parent")


def _validate_attempt(journal, binding):
    release = binding.get("release")
    receipt = journal.get("receipt")
    attempt_id = journal.get("attempt_id")
    version = receipt.get("version") if isinstance(receipt, dict) else None
    if (not isinstance(release, dict) or not isinstance(receipt, dict)
            or version != release.get("version")
            or not isinstance(version, str)
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}", version)):
        raise ValueError("Helper attempt receipt does not match release binding")
    if not isinstance(attempt_id, str) or not re.fullmatch(r"[0-9a-f]{32}", attempt_id):
        raise ValueError("Invalid helper attempt identifier")
    expected_staging = f"{release.get('checksum_sha256')}-{attempt_id}"
    expected_temp = f".{version}-{attempt_id}"
    staging_name = journal.get("staging_name")
    temp_name = journal.get("temp_name")
    for name in (staging_name, temp_name):
        if (not isinstance(name, str) or name in {"", ".", ".."}
                or Path(name).name != name or "/" in name or "\\" in name):
            raise ValueError("Invalid helper attempt artifact name")
    if staging_name != expected_staging or temp_name != expected_temp:
        raise ValueError("Helper attempt artifact name does not match receipt")


def _remove_attempt_artifacts(journal, binding, state_dir, cache_dir):
    _validate_attempt(journal, binding)
    staging_parent = cache_dir / ".helper-staging"
    _assert_safe_parent(staging_parent, "helper staging")
    _assert_safe_parent(state_dir, "helper state")
    for parent, name in ((staging_parent, journal["staging_name"]),
                         (state_dir, journal["temp_name"])):
        candidate = parent / name
        if candidate.is_symlink():
            raise ValueError("Helper attempt artifact cannot be a symlink")
        if candidate.is_dir():
            shutil.rmtree(candidate)

    root = state_dir / journal["receipt"]["version"]
    restored = journal.get("restored_receipt")
    if restored and restored.get("version") == journal["receipt"]["version"]:
        raise ValueError("Helper attempt collides with restored version")
    if root.is_symlink():
        raise ValueError("Helper version root cannot be a symlink")
    if root.is_dir():
        shutil.rmtree(root)


def reconcile(journal, binding, state_dir, cache_dir, state_identity, bin_identity,
              journal_path, receipt_valid, restore, save):
    if journal.get("binding") != binding:
        raise ValueError("Helper journal binding differs from current installation")
    _validate_attempt(journal, binding)
    if journal["phase"] == "preparing":
        _remove_attempt_artifacts(journal, binding, state_dir, cache_dir)
        journal["phase"] = "aborted"
        journal["receipt"] = journal.get("restored_receipt")
        save(journal_path, journal, state_dir, state_identity)
        return journal
    if journal["phase"] == "installing":
        if receipt_valid(journal["receipt"]):
            journal["phase"] = "installed"
            save(journal_path, journal, state_dir, state_identity)
            return journal
        restore(journal, state_identity, bin_identity)
        _remove_attempt_artifacts(journal, binding, state_dir, cache_dir)
        journal["phase"] = "aborted"
        journal["receipt"] = journal.get("restored_receipt")
        save(journal_path, journal, state_dir, state_identity)
        return journal
    if journal["phase"] == "rollback_pending":
        restore(journal, state_identity, bin_identity)
        journal["phase"] = "rolled_back"
        journal["rolled_back_from"] = journal.get("receipt")
        journal["receipt"] = journal.get("restored_receipt")
        save(journal_path, journal, state_dir, state_identity)
    return journal
