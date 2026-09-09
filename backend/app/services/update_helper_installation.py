"""Durable, explicit local installation of the fixed update helpers."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import uuid

from .update_journal import exclusive_lock
from . import update_helper_installation_state as state
from . import update_helper_installation_launcher as launcher
from .update_participant_commands import load_private_json
from .update_participant_package import stage_verified_package
from .edition.update_manager import verify_update_manifest_signature

HELPERS = {"participant": "treseko-update-participant", "ingress": "treseko-update-ingress",
           "runtime_preparation": "treseko-update-runtime-preparation"}
MODULES = {"participant": "app.services.update_participant_cli", "ingress": "app.services.update_ingress_cli",
           "runtime_preparation": "app.services.update_runtime_preparation_cli"}
OPTIONAL_HELPERS = {"host_bridge": "treseko-update-host-bridge"}
OPTIONAL_MODULES = {"host_bridge": "app.services.update_host_bridge_cli"}
_VERSION = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\Z")
_MAX_FILE = 1024 * 1024 * 1024

def _absolute(value, label):
    if not isinstance(value, str): raise ValueError(f"{label} must be an absolute path")
    path = Path(value)
    if not path.is_absolute() or ".." in path.parts: raise ValueError(f"{label} must be an absolute dedicated path")
    return path

def _under(root, path):
    root = root.resolve()
    candidate = root / str(path).lstrip("/")
    resolved = candidate.resolve()
    if resolved != root and root not in resolved.parents: raise ValueError("Path escapes the dedicated root prefix")
    return candidate

def _reject_symlink_components(root, path):
    current = root
    for part in path.relative_to(root).parts:
        current /= part
        if current.is_symlink(): raise ValueError("Helper installation paths cannot contain symlinks")

def _safe_file(path, label, *, required=True):
    try: info = path.lstat()
    except FileNotFoundError:
        if required: raise ValueError(f"Missing private {label}")
        return None
    if (not stat.S_ISREG(info.st_mode) or info.st_uid not in {0, os.geteuid()} or info.st_mode & 0o077
            or info.st_size > _MAX_FILE): raise ValueError(f"Unsafe private {label}")
    return info

def _private_directory(path, label, *, required=False):
    if not path.exists():
        if required: raise ValueError(f"Missing private {label} directory")
        return
    info = path.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid not in {0, os.geteuid()} or info.st_mode & 0o077):
        raise ValueError(f"Unsafe private {label} directory")


def _public_directory(path, label):
    return _directory_identity(path, label, private=False)


def _directory_identity(path, label, *, private):
    info = path.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid not in {0, os.geteuid()}
            or info.st_mode & 0o022
            or (private and info.st_mode & 0o077)
            or (not private and not stat.S_IMODE(info.st_mode) & 0o555)):
        raise ValueError(f"Unsafe public {label} directory")
    return (info.st_dev, info.st_ino, info.st_uid, stat.S_IMODE(info.st_mode))


def _assert_directory_identity(path, identity, label):
    info = path.lstat()
    current = (info.st_dev, info.st_ino, info.st_uid, stat.S_IMODE(info.st_mode))
    if not stat.S_ISDIR(info.st_mode) or current != identity:
        raise ValueError(f"{label} directory changed during installation")

def _sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024): digest.update(chunk)
    return digest.hexdigest()

def _tree_sha256(root):
    if not root.is_dir() or root.is_symlink(): raise ValueError("Helper backend tree is missing or unsafe")
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if path.is_symlink(): raise ValueError("Helper backend contains a symlink")
        if path.is_file(): digest.update(path.relative_to(root).as_posix().encode() + b"\0" + _sha256(path).encode() + b"\0")
    return digest.hexdigest()

def _config(config, root):
    expected = {"schema", "cache", "manifest", "bin_dir", "state_dir", "configs"}
    allowed = expected | {"python", "dependencies", "launcher"}
    if not isinstance(config, dict) or set(config) - allowed or set(config) < expected or config.get("schema") != 1:
        raise ValueError("Invalid helper installation configuration")
    if not isinstance(config["configs"], dict):
        raise ValueError("All fixed helper config paths are required")
    helper_names = set(config["configs"])
    if helper_names not in (set(HELPERS), set(HELPERS) | set(OPTIONAL_HELPERS)):
        raise ValueError("All fixed helper config paths are required")
    launcher_config = launcher.validate(config.get("launcher"), root, helper_names)
    if "host_bridge" in helper_names and launcher_config is None:
        raise ValueError("host_bridge requires the explicit Docker launcher configuration")
    if "python" not in config and launcher_config is None:
        raise ValueError("Python is required for the host launcher")
    python = _absolute(config.get("python", sys.executable), "python")
    if not python.is_file() or not os.access(python, os.X_OK): raise ValueError("Configured operator Python is not executable")
    paths = {name: _under(root, _absolute(config[name], name))
             for name in ("cache", "manifest", "bin_dir", "state_dir")}
    for path in paths.values(): _reject_symlink_components(root, path)
    configs = {name: _under(root, _absolute(value, f"{name} config")) for name, value in config["configs"].items()}
    for path in configs.values(): _reject_symlink_components(root, path)
    dependencies = config.get("dependencies", ["cryptography"])
    if (not isinstance(dependencies, list) or len(set(dependencies)) != len(dependencies)
            or not all(isinstance(v, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.]*", v) for v in dependencies)):
        raise ValueError("Invalid operator Python dependency list")
    return python, paths, configs, dependencies, launcher_config, helper_names

def _private_configs(configs):
    for name, path in configs.items(): _safe_file(path, f"{name} config")
    return {name: _sha256(path) for name, path in configs.items()}

def _python_binding(python):
    resolved = python.resolve(strict=True)
    info = resolved.stat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid not in {0, os.geteuid()} or not os.access(resolved, os.X_OK)
            or info.st_size > _MAX_FILE): raise ValueError("Unsafe operator Python binding")
    return {"path": str(python), "resolved": str(resolved), "sha256": _sha256(resolved), "mode": stat.S_IMODE(info.st_mode), "size": info.st_size}

def _manifest(path):
    _safe_file(path, "release manifest")
    try: value = json.loads(path.read_text())
    except (OSError, ValueError, UnicodeError) as exc: raise ValueError("Invalid release manifest") from exc
    if (not isinstance(value, dict) or not isinstance(value.get("version"), str) or not _VERSION.fullmatch(value["version"])
            or not re.fullmatch(r"[0-9a-f]{64}", str(value.get("checksum_sha256", "")))): raise ValueError("Release manifest lacks a valid version or checksum")
    valid, error = verify_update_manifest_signature(value)
    if not valid: raise ValueError(error or "Invalid release signature")
    return value

def _archive(cache, manifest):
    archive = cache / f"{manifest['checksum_sha256']}.tar.gz"
    _safe_file(archive, "cached signed package")
    if _sha256(archive) != manifest["checksum_sha256"]: raise ValueError("Cached package checksum mismatch")
    if archive.stat().st_size != manifest.get("package_size_bytes"): raise ValueError("Cached package size mismatch")
    return archive

def _dependency_check(python, dependencies, staged_backend, modules):
    code = ("import importlib,sys\n"
            "def ok(n):\n"
            "    try: importlib.import_module(n); return True\n"
            "    except Exception: return False\n"
            "missing=[n for n in sys.argv[1:] if not ok(n)]\n"
            "raise SystemExit(','.join(missing) if missing else 0)\n")
    environment = os.environ.copy()
    environment["PYTHONPATH"] = str(staged_backend) + (
        os.pathsep + environment["PYTHONPATH"] if environment.get("PYTHONPATH") else "")
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    result = subprocess.run([str(python), "-c", code, *(list(dependencies) + list(modules.values()))], env=environment, capture_output=True, text=True, timeout=30, check=False)
    if result.returncode: raise ValueError("Configured operator Python cannot import a required helper dependency")

def _wrapper(python, backend, module, config):
    return (f"#!{str(python)}\n# Fixed operator-owned Treseko update helper; no shell or RPC argv.\nimport sys\n"
            "sys.dont_write_bytecode = True\n"
            f"sys.path.insert(0, {str(backend)!r})\n"
            f"sys.argv = [sys.argv[0], '--config', {str(config)!r}, *sys.argv[1:]]\n"
            f"from {module} import main\nraise SystemExit(main())\n").encode()

def _digest(value): return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

class HelperInstallation:
    def __init__(self, config, root_prefix):
        self.root = Path(root_prefix).resolve()
        if not self.root.is_absolute(): raise ValueError("A dedicated absolute root prefix is required")
        self.python, self.paths, self.configs, self.dependencies, self.launcher, helper_names = _config(config, self.root)
        self.helpers = {**HELPERS, **OPTIONAL_HELPERS} if helper_names == set(HELPERS) | set(OPTIONAL_HELPERS) else dict(HELPERS)
        self.modules = {**MODULES, **OPTIONAL_MODULES} if helper_names == set(HELPERS) | set(OPTIONAL_HELPERS) else dict(MODULES)
        self.config = config
        self.journal = self.paths["state_dir"] / ".helper-installation.json"

    def _inventory(self):
        manifest = _manifest(self.paths["manifest"])
        _private_directory(self.paths["cache"], "package cache", required=True)
        archive = _archive(self.paths["cache"], manifest)
        return manifest, archive, _private_configs(self.configs), _python_binding(self.python), self.launcher

    def plan(self):
        manifest, archive, config_hashes, binding, launcher_config = self._inventory()
        return {"ok": True, "mode": "plan", "version": manifest["version"],
                "checksum_sha256": manifest["checksum_sha256"],
                "archive_sha256": _sha256(archive), "config_digest": _digest(config_hashes),
                "bin_dir": str(self.paths["bin_dir"]), "state_dir": str(self.paths["state_dir"]),
                "wrappers": list(self.helpers.values()),
                "launcher": launcher_config["type"] if launcher_config else "host-python"}

    def _receipt_valid(self, receipt):
        if not receipt: return True
        state_dir = self.paths["state_dir"]
        bin_dir = self.paths["bin_dir"]
        root = state_dir / receipt["version"]
        try: valid = receipt.get("backend_sha256") == _tree_sha256(root / "backend")
        except (OSError, ValueError): return False
        for filename, expected in receipt.get("wrappers", {}).items():
            target = bin_dir / filename
            if not target.is_file() or target.is_symlink() or _sha256(target) != expected: valid = False
        return valid

    def _assert_previous_owned(self, journal):
        if not self._receipt_valid(journal.get("receipt")):
            raise ValueError("Existing helper is not the previously owned receipt")

    def _prepare_package(self, archive, manifest, staging_path):
        parent = self.paths["cache"] / ".helper-staging"
        parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        staged = staging_path
        if staged.exists(): raise FileExistsError("Signed package staging path already exists")
        stage_verified_package(archive, manifest, staged)
        backend = staged / "backend"
        if not backend.is_dir(): raise ValueError("Signed package backend tree is missing")
        for module in self.modules.values():
            source = (backend / Path(*module.split("."))).with_suffix(".py")
            if not source.is_file() or source.is_symlink(): raise ValueError("Signed helper module is missing")
        _dependency_check(self.python, self.dependencies, backend, self.modules)
        return staged

    def _backup_existing(self, previous):
        backups = {name: None for name in self.helpers.values()}
        if not previous: return backups
        state_dir = self.paths["state_dir"]
        bin_dir = self.paths["bin_dir"]
        old = previous["receipt"]
        backup_dir = state_dir / ".backups" / old["version"]
        backup_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        _private_directory(backup_dir, "helper backup", required=True)
        for filename, expected in old["wrappers"].items():
            source = bin_dir / filename
            if not source.is_file() or source.is_symlink() or _sha256(source) != expected: raise ValueError("Existing helper is not the previously owned receipt")
            target = backup_dir / filename
            if target.exists() or target.is_symlink():
                if target.is_symlink() or _sha256(target) != expected: raise ValueError("Helper backup hash mismatch")
            else:
                temporary = target.with_name(f".{target.name}.new")
                shutil.copyfile(source, temporary)
                temporary.chmod(0o400)
                os.replace(temporary, target)
            if _sha256(target) != expected: raise ValueError("Helper backup hash mismatch")
            backups[filename] = {"path": str(target.relative_to(state_dir)), "sha256": expected}
        state.fsync_tree(backup_dir)
        return backups

    def _publish(self, source, target, bin_identity=None):
        if bin_identity:
            _assert_directory_identity(self.paths["bin_dir"], bin_identity, "Helper binary")
        if target.exists() or target.is_symlink():
            if target.is_symlink() or not stat.S_ISREG(target.stat().st_mode): raise ValueError("Foreign helper path")
        temporary = target.with_name(f".{target.name}.new")
        if temporary.exists() or temporary.is_symlink():
            if temporary.is_symlink(): raise ValueError("Unsafe helper temporary")
            temporary.unlink()
        shutil.copyfile(source, temporary)
        temporary.chmod(0o755)
        descriptor = os.open(temporary, os.O_RDONLY)
        try: os.fsync(descriptor)
        finally: os.close(descriptor)
        os.replace(temporary, target)
        descriptor = os.open(target.parent, os.O_RDONLY)
        try: os.fsync(descriptor)
        finally: os.close(descriptor)

    def _restore(self, journal, state_identity=None, bin_identity=None):
        state_dir = self.paths["state_dir"]
        bin_dir = self.paths["bin_dir"]
        if state_identity:
            _assert_directory_identity(state_dir, state_identity, "Helper state")
        if bin_identity:
            _assert_directory_identity(bin_dir, bin_identity, "Helper binary")
        current = journal.get("receipt")
        restored = journal.get("restored_receipt")
        for filename, backup in journal["backups"].items():
            target = bin_dir / filename
            if backup:
                source = state_dir / backup["path"]
                if source.is_symlink() or not source.is_file() or _sha256(source) != backup["sha256"]: raise ValueError("Helper backup hash mismatch")
                if restored and backup["sha256"] != restored["wrappers"][filename]: raise ValueError("Restored receipt mismatch")
                self._publish(source, target, bin_identity)
            elif target.exists() or target.is_symlink():
                if target.is_symlink() or (current and _sha256(target) != current["wrappers"][filename]): raise ValueError("Foreign helper path during rollback")
                target.unlink()
        if restored and not self._receipt_valid(restored):
            raise ValueError("Restored helper receipt mismatch")

    def install(self):
        manifest, archive, config_hashes, binding, launcher_config = self._inventory()
        version_root = self.paths["state_dir"] / manifest["version"]
        installation_binding = state.installation_binding(
            manifest, config_hashes, binding, self.configs, self.paths,
            launcher_binding=launcher.binding(
                launcher_config, self.configs, config_hashes, version_root / "backend", None,
                self.helpers))
        bin_dir = self.paths["bin_dir"]
        state_dir = self.paths["state_dir"]
        bin_dir.mkdir(parents=True, exist_ok=True, mode=0o755)
        state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        bin_identity = _public_directory(bin_dir, "helper binary")
        state_identity = _directory_identity(state_dir, "Helper state", private=True)
        _private_directory(state_dir, "helper state", required=True)
        with exclusive_lock(state_dir / ".install.lock"):
            journal = state.read_journal(self.journal)
            if journal and journal.get("phase") in {"preparing", "installing", "rollback_pending"}:
                journal = state.reconcile(
                    journal, installation_binding, state_dir, self.paths["cache"],
                    state_identity, bin_identity, self.journal,
                    self._receipt_valid, self._restore, state.save_journal)
            if journal and journal.get("phase") == "installed":
                if journal["manifest"]["checksum_sha256"] == manifest["checksum_sha256"]:
                    replay_launcher = launcher.binding(
                        launcher_config, self.configs, config_hashes,
                        version_root / "backend", journal["receipt"].get("backend_sha256"),
                        self.helpers)
                    replay_binding = state.installation_binding(
                        manifest, config_hashes, binding, self.configs, self.paths,
                        launcher_binding=replay_launcher)
                    if (journal.get("binding") != replay_binding
                            or journal["config_digest"] != _digest(config_hashes)
                            or journal["python_binding"] != binding
                            or not self._receipt_valid(journal["receipt"] )):
                        raise ValueError("Installed helper receipt does not match current files")
                    return {"ok": True, "replayed": True, **journal["receipt"]}
                self._assert_previous_owned(journal)
            previous = journal if journal and journal.get("phase") == "installed" else None
            if journal and journal.get("phase") in {"aborted", "rolled_back"} and journal.get("receipt"):
                previous = {"receipt": journal["receipt"]}
            if previous is None and any((bin_dir / name).exists() or (bin_dir / name).is_symlink() for name in self.helpers.values()):
                raise ValueError("Existing helper has no owned installation receipt")
            attempt_id = uuid.uuid4().hex
            staging_name = f"{manifest['checksum_sha256']}-{attempt_id}"
            temp_name = f".{manifest['version']}-{attempt_id}"
            staging_path = self.paths["cache"] / ".helper-staging" / staging_name
            temp_root = state_dir / temp_name
            staged = None
            if version_root.exists() or version_root.is_symlink():
                raise FileExistsError("Versioned helper destination already exists")
            try:
                receipt = {
                    "version": manifest["version"],
                    "checksum_sha256": manifest["checksum_sha256"],
                    "binding_digest": _digest(installation_binding),
                    "config_digest": _digest(config_hashes),
                    "python_binding": binding,
                    "launcher": installation_binding.get("launcher"),
                    "backend_sha256": None,
                    "wrappers": {},
                    "backups": {name: None for name in self.helpers.values()},
                }
                intent = {
                    "schema": 3,
                    "phase": "preparing",
                    "manifest": manifest,
                    "binding": installation_binding,
                    "config_digest": receipt["config_digest"],
                    "python_binding": binding,
                    "receipt": receipt,
                    "restored_receipt": previous.get("receipt") if previous else None,
                    "staging_name": staging_name,
                    "temp_name": temp_name,
                    "attempt_id": attempt_id,
                }
                state.save_journal(self.journal, intent, state_dir, state_identity)
                staged = self._prepare_package(archive, manifest, staging_path)
                temp_root.mkdir(mode=0o700)
                shutil.copytree(staged / "backend", temp_root / "backend", symlinks=False)
                for name, module in self.modules.items():
                    wrapper = temp_root / self.helpers[name]
                    if launcher_config:
                        wrapper.write_bytes(launcher.wrapper(
                            installation_binding["launcher"], name,
                            version_root / "backend", self.configs[name]))
                    else:
                        wrapper.write_bytes(_wrapper(self.python, version_root / "backend", module, self.configs[name]))
                    wrapper.chmod(0o755)
                state.fsync_tree(temp_root)
                receipt["backend_sha256"] = _tree_sha256(temp_root / "backend")
                receipt["wrappers"] = {name: _sha256(temp_root / name) for name in self.helpers.values()}
                final_launcher = launcher.binding(
                    launcher_config, self.configs, config_hashes,
                    version_root / "backend", receipt["backend_sha256"], self.helpers)
                installation_binding = state.installation_binding(
                    manifest, config_hashes, binding, self.configs, self.paths,
                    launcher_binding=final_launcher)
                receipt["launcher"] = final_launcher
                receipt["binding_digest"] = _digest(installation_binding)
                intent["receipt"] = receipt
                intent["binding"] = installation_binding
                state.save_journal(self.journal, intent, state_dir, state_identity)
                _assert_directory_identity(state_dir, state_identity, "Helper state")
                os.replace(temp_root, version_root)
                temp_root = None
                backups = self._backup_existing(previous)
                intent["backups"] = backups
                receipt["backups"] = backups
                intent["phase"] = "installing"
                state.save_journal(self.journal, intent, state_dir, state_identity)
                for name in self.helpers.values():
                    self._publish(version_root / name, bin_dir / name, bin_identity)
                if staged and staged.exists():
                    shutil.rmtree(staged)
                    staged = None
                intent["phase"] = "installed"
                intent["receipt"] = receipt
                state.save_journal(self.journal, intent, state_dir, state_identity)
                return {"ok": True, "replayed": False, **receipt}
            except Exception:
                # If the first intent could not be persisted, this version tree was never published.
                # Once an intent exists, leave every artifact for reconciliation on the next run.
                if version_root.exists() and not self.journal.exists() and not any((bin_dir / name).exists() for name in self.helpers.values()):
                    shutil.rmtree(version_root)
                raise
            finally:
                if temp_root and temp_root.exists(): shutil.rmtree(temp_root)
                if staged and staged.exists(): shutil.rmtree(staged)

    def rollback(self):
        state_dir = self.paths["state_dir"]
        bin_dir = self.paths["bin_dir"]
        _private_directory(state_dir, "helper state", required=True)
        state_identity = _directory_identity(state_dir, "Helper state", private=True)
        bin_identity = _directory_identity(bin_dir, "Helper binary", private=False)
        with exclusive_lock(state_dir / ".install.lock"):
            journal = state.read_journal(self.journal)
            if not journal: raise ValueError("No helper installation receipt is available")
            config_hashes = _private_configs(self.configs)
            python_binding = _python_binding(self.python)
            previous_root = state_dir / journal["manifest"]["version"] / "backend"
            launcher_binding = launcher.binding(
                self.launcher, self.configs, config_hashes, previous_root,
                journal.get("receipt", {}).get("backend_sha256"), self.helpers)
            installation_binding = state.installation_binding(
                journal["manifest"], config_hashes, python_binding,
                self.configs, self.paths, launcher_binding=launcher_binding)
            if journal.get("binding") != installation_binding:
                raise ValueError("Helper journal binding differs from current installation")
            if journal.get("phase") == "rollback_pending":
                journal = state.reconcile(
                    journal, installation_binding, state_dir, self.paths["cache"],
                    state_identity, bin_identity, self.journal,
                    self._receipt_valid, self._restore, state.save_journal)
            if journal.get("phase") == "rolled_back":
                return {"ok": True, "phase": "rolled_back", "version": journal.get("rolled_back_from", {}).get("version"),
                        "restored_receipt": journal.get("receipt")}
            if journal.get("phase") != "installed": raise ValueError("Helper installation is not rollbackable")
            receipt = journal["receipt"]
            if not self._receipt_valid(receipt): raise ValueError("Current helper receipt mismatch")
            pending = dict(journal, phase="rollback_pending", backups=receipt["backups"])
            state.save_journal(self.journal, pending, state_dir, state_identity)
            self._restore(pending, state_identity, bin_identity)
            pending["phase"] = "rolled_back"
            pending["rolled_back_from"] = receipt
            pending["receipt"] = journal.get("restored_receipt")
            state.save_journal(self.journal, pending, state_dir, state_identity)
            return {"ok": True, "phase": "rolled_back", "version": receipt["version"], "restored_receipt": pending["receipt"]}

def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description="Install fixed Treseko update helpers locally")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--root-prefix", type=Path, required=True)
    parser.add_argument("--plan", action="store_true")
    parser.add_argument("--rollback", action="store_true")
    args = parser.parse_args(argv)
    try:
        config = load_private_json(args.config)
        installer = HelperInstallation(config, args.root_prefix)
        if args.rollback:
            result = installer.rollback()
        elif args.plan:
            result = installer.plan()
        else:
            result = installer.install()
    except Exception:
        print(json.dumps({"ok": False, "error": "helper_installation_failed"}))
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0

if __name__ == "__main__": raise SystemExit(main())
