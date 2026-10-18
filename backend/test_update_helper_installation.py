import base64
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import stat
import sys
import tarfile
import textwrap

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
import pytest

from app.services import update_helper_installation as module
from app.services.edition import update_manager
from test_update_participant_package import release


HELPER_MODULES = {
    "backend/app/__init__.py": "",
    "backend/app/services/__init__.py": "",
    "backend/app/services/update_participant_cli.py": "def main(): return 0\n",
    "backend/app/services/update_ingress_cli.py": "def main(): return 0\n",
    "backend/app/services/update_runtime_preparation_cli.py": "def main(argv=None): return 0\n",
}


def _versioned_release(root, monkeypatch, version, marker):
    root.mkdir(parents=True, exist_ok=True)
    files = {
        "backend/app/version.py": f"PRODUCT_VERSION = '{version}'\n",
        "backend/entrypoint.sh": "#!/bin/sh\n", "VERSION": version,
        "frontend/dist/VERSION": version, "frontend/dist/version.json": json.dumps({"version": version}),
        "engine/VERSION": version, "engine/package.json": json.dumps({"version": version}),
        "automation-worker/VERSION": version, "automation-worker/package.json": json.dumps({"version": version}),
        **HELPER_MODULES,
        "backend/app/services/update_participant_cli.py": f"MARKER = {marker!r}\ndef main(): return 0\n",
    }
    archive = root / f"{version}-{marker}.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        for name, body in files.items():
            data = body.encode()
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            tar.addfile(entry, io.BytesIO(data))
    private = Ed25519PrivateKey.generate()
    public = private.public_key()
    raw = public.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    encoded = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    monkeypatch.setattr(update_manager, "_configured_update_public_keys", lambda: (encoded,))
    manifest = {"version": version, "key_id": update_manager._public_key_fingerprint(public),
                "checksum_sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
                "package_size_bytes": archive.stat().st_size}
    signature = private.sign(update_manager._canonical_manifest_payload(manifest))
    manifest["signature"] = "ed25519:" + base64.urlsafe_b64encode(signature).decode().rstrip("=")
    return archive, manifest


def _select_release(root, config, archive, manifest):
    paths = {"manifest": root / "manifest.json", "cache": root / "cache"}
    paths["manifest"].write_text(json.dumps(manifest, sort_keys=True))
    paths["manifest"].chmod(0o600)
    cached = paths["cache"] / f"{manifest['checksum_sha256']}.tar.gz"
    shutil.copyfile(archive, cached)
    cached.chmod(0o600)


def _run_crashing_child(root, config, mode):
    operator_config = root / "operator.json"
    operator_config.write_text(json.dumps(config, sort_keys=True))
    operator_config.chmod(0o600)
    script = root / "crash-child.py"
    script.write_text(textwrap.dedent(
        """
        import json
        import os
        from pathlib import Path
        import sys
        from app.services import update_helper_installation as helper
        from app.services import update_participant_package as package

        root = Path(sys.argv[1])
        config_path = Path(sys.argv[2])
        mode = sys.argv[3]
        helper.verify_update_manifest_signature = lambda value: (True, None)
        package.verify_update_manifest_signature = lambda value: (True, None)
        config = json.loads(config_path.read_text())

        if mode == "before_rename":
            real_replace = helper.os.replace
            version_root = root / "state" / json.loads((root / "manifest.json").read_text())["version"]
            def crash_replace(source, target):
                if Path(target) == version_root:
                    os._exit(91)
                return real_replace(source, target)
            helper.os.replace = crash_replace
        else:
            def crash_backup(self, previous):
                os._exit(92)
            helper.HelperInstallation._backup_existing = crash_backup

        helper.HelperInstallation(config, root).install()
        """
    ))
    environment = os.environ.copy()
    environment["PYTHONPATH"] = str(Path(__file__).parent)
    return subprocess.run(
        [sys.executable, str(script), str(root), str(operator_config), mode],
        cwd=Path(__file__).parents[1], env=environment, check=False,
    )


def _config(root, manifest, *, dependencies=None):
    paths = {
        "cache": root / "cache", "manifest": root / "manifest.json",
        "bin_dir": root / "installed",
        "state_dir": root / "state",
        "configs": {name: root / "etc" / f"{name}.json" for name in module.HELPERS},
    }
    for path in paths["configs"].values():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"schema": 1, "helper": path.stem}))
        path.chmod(0o600)
    paths["manifest"].write_text(json.dumps(manifest, sort_keys=True))
    paths["manifest"].chmod(0o600)
    paths["cache"].mkdir(mode=0o700)
    config = {"schema": 1, "python": sys.executable, "cache": "/cache",
              "manifest": "/manifest.json", "bin_dir": "/installed", "state_dir": "/state",
              "configs": {name: f"/etc/{name}.json" for name in module.HELPERS}}
    if dependencies is not None:
        config["dependencies"] = dependencies
    return config, paths


@pytest.fixture
def signed_helper_package(tmp_path, monkeypatch):
    release_root = tmp_path / "release"
    release_root.mkdir()
    archive, manifest = release(release_root, monkeypatch, additional_files=HELPER_MODULES)
    root = tmp_path / "root"
    root.mkdir(mode=0o700)
    config, paths = _config(root, manifest, dependencies=[])
    cached = paths["cache"] / f"{manifest['checksum_sha256']}.tar.gz"
    shutil.copyfile(archive, cached)
    cached.chmod(0o600)
    return root, config, manifest, archive


def test_plan_is_read_only_and_reports_only_hashes(signed_helper_package):
    root, config, manifest, _archive = signed_helper_package
    installer = module.HelperInstallation(config, root)
    result = installer.plan()
    assert result["mode"] == "plan"
    assert result["checksum_sha256"] == manifest["checksum_sha256"]
    assert result["config_digest"]
    assert not (root / "installed").exists()
    assert "password" not in json.dumps(result).lower()


def test_install_stages_before_publishing_fixed_wrappers(signed_helper_package):
    root, config, manifest, _archive = signed_helper_package
    result = module.HelperInstallation(config, root).install()
    destination = root / "installed"
    assert result["ok"] is True
    assert (root / "state" / manifest["version"] / "backend").is_dir()
    for filename in module.HELPERS.values():
        wrapper = destination / filename
        assert wrapper.is_file() and os.access(wrapper, os.X_OK)
        assert str(root / "state" / manifest["version"] / "backend") in wrapper.read_text()
        name = next(key for key, value in module.HELPERS.items() if value == filename)
        assert str(root / "etc" / f"{name}.json") in wrapper.read_text()
    journal = json.loads((root / "state" / ".helper-installation.json").read_text())
    assert journal["phase"] == "installed"
    assert journal["receipt"]["checksum_sha256"] == manifest["checksum_sha256"]
    assert stat.S_IMODE(destination.stat().st_mode) == 0o755
    assert stat.S_IMODE((root / "state").stat().st_mode) == 0o700


def test_invalid_signed_package_does_not_create_destination(signed_helper_package):
    root, config, manifest, _archive = signed_helper_package
    manifest["version"] = "tampered"
    (root / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError):
        module.HelperInstallation(config, root).install()
    assert not (root / "installed").exists()


def test_existing_unowned_wrapper_and_symlink_are_never_overwritten(signed_helper_package):
    root, config, _manifest, _archive = signed_helper_package
    destination = root / "installed"
    destination.mkdir(mode=0o755)
    foreign = destination / module.HELPERS["participant"]
    foreign.write_text("foreign")
    foreign.chmod(0o700)
    with pytest.raises(ValueError, match="owned installation"):
        module.HelperInstallation(config, root).install()
    assert foreign.read_text() == "foreign"


def test_missing_operator_dependency_fails_without_docker_or_sql(signed_helper_package, monkeypatch):
    root, config, _manifest, _archive = signed_helper_package
    config["dependencies"] = ["module_that_is_not_installed_for_bootstrap"]
    calls = []
    real_run = module.subprocess.run
    def record(command, **kwargs):
        calls.append(command)
        return real_run(command, **kwargs)
    monkeypatch.setattr(module.subprocess, "run", record)
    with pytest.raises(ValueError, match="dependency"):
        module.HelperInstallation(config, root).install()
    assert all("docker" not in command and "psql" not in command for command in calls)
    assert not (root / "state" / "1.0.3").exists()


def test_rollback_removes_only_owned_new_helpers(signed_helper_package):
    root, config, _manifest, _archive = signed_helper_package
    installer = module.HelperInstallation(config, root)
    installer.install()
    result = installer.rollback()
    assert result["phase"] == "rolled_back"
    assert all(not (root / "installed" / name).exists() for name in module.HELPERS.values())
    assert (root / "state" / "1.0.3" / "backend").is_dir()


def test_rollback_uses_owned_receipt_when_incoming_cache_is_gone(signed_helper_package):
    root, config, _manifest, _archive = signed_helper_package
    installer = module.HelperInstallation(config, root)
    installer.install()
    shutil.rmtree(root / "cache")
    result = installer.rollback()
    assert result["phase"] == "rolled_back"
    assert all(not (root / "installed" / name).exists() for name in module.HELPERS.values())


def test_final_receipt_loss_reconciles_published_install(signed_helper_package, monkeypatch):
    root, config, manifest, _archive = signed_helper_package
    real_save = module.state.save_journal
    calls = 0

    def fail_final(path, value, state_dir, state_identity):
        nonlocal calls
        calls += 1
        if calls == 4:
            raise OSError("lost receipt ACK")
        return real_save(path, value, state_dir, state_identity)

    monkeypatch.setattr(module.state, "save_journal", fail_final)
    with pytest.raises(OSError, match="lost receipt ACK"):
        module.HelperInstallation(config, root).install()
    destination = root / "installed"
    assert all((destination / name).is_file() for name in module.HELPERS.values())
    assert json.loads((root / "state" / ".helper-installation.json").read_text())["phase"] == "installing"

    monkeypatch.setattr(module.state, "save_journal", real_save)
    replay = module.HelperInstallation(config, root).install()
    assert replay["replayed"] is True
    assert replay["checksum_sha256"] == manifest["checksum_sha256"]


def test_rollback_lost_ack_is_reconciled_and_keeps_restored_receipt(signed_helper_package, monkeypatch):
    root, config, _manifest, _archive = signed_helper_package
    installer = module.HelperInstallation(config, root)
    installer.install()
    real_save_journal = module.state.save_journal
    calls = 0

    def fail_rollback_final(value, state_identity):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("lost rollback ACK")
        return real_save_journal(installer.journal, value, root / "state", state_identity)

    def save_rollback(path, value, state_dir, state_identity):
        return fail_rollback_final(value, state_identity)

    monkeypatch.setattr(module.state, "save_journal", save_rollback)
    with pytest.raises(OSError, match="lost rollback ACK"):
        installer.rollback()
    journal = json.loads((root / "state" / ".helper-installation.json").read_text())
    assert journal["phase"] == "rollback_pending"
    monkeypatch.setattr(module.state, "save_journal", real_save_journal)
    result = installer.rollback()
    assert result["phase"] == "rolled_back"
    assert json.loads((root / "state" / ".helper-installation.json").read_text())["receipt"] is None


def test_same_checksum_replay_rejects_modified_backend_or_wrapper(signed_helper_package):
    root, config, _manifest, _archive = signed_helper_package
    installer = module.HelperInstallation(config, root)
    installer.install()
    destination = root / "installed"
    (destination / module.HELPERS["participant"]).write_text("foreign")
    with pytest.raises(ValueError, match="receipt"):
        installer.install()


def test_replay_rejects_changed_config_path_and_bin_path(signed_helper_package):
    root, config, _manifest, _archive = signed_helper_package
    installer = module.HelperInstallation(config, root)
    installer.install()
    alternate = root / "etc" / "participant-alt.json"
    alternate.write_text((root / "etc" / "participant.json").read_text())
    alternate.chmod(0o600)
    config["configs"]["participant"] = "/etc/participant-alt.json"
    with pytest.raises(ValueError, match="receipt"):
        module.HelperInstallation(config, root).install()
    config["configs"]["participant"] = "/etc/participant.json"
    config["bin_dir"] = "/other-bin"
    with pytest.raises(ValueError, match="receipt"):
        module.HelperInstallation(config, root).install()


def test_dangling_journal_symlink_is_rejected(signed_helper_package):
    root, config, _manifest, _archive = signed_helper_package
    state = root / "state"
    state.mkdir(mode=0o700)
    (state / ".helper-installation.json").symlink_to(root / "missing-journal")
    with pytest.raises(ValueError, match="journal.*symlink"):
        module.HelperInstallation(config, root).install()


def test_corrupt_attempt_journal_cannot_delete_outside_sentinel(signed_helper_package):
    root, config, _manifest, _archive = signed_helper_package
    installer = module.HelperInstallation(config, root)
    installer.install()
    journal_path = root / "state" / ".helper-installation.json"
    journal = json.loads(journal_path.read_text())
    journal["phase"] = "preparing"
    journal["staging_name"] = "../../outside"
    sentinel = root / "outside"
    sentinel.write_text("keep")
    journal_path.write_text(json.dumps(journal, sort_keys=True))
    journal_path.chmod(0o600)
    with pytest.raises(ValueError, match="artifact name"):
        installer.install()
    assert sentinel.read_text() == "keep"


def test_corrupt_attempt_receipt_version_cannot_delete_outside_sentinel(signed_helper_package):
    root, config, _manifest, _archive = signed_helper_package
    installer = module.HelperInstallation(config, root)
    installer.install()
    journal_path = root / "state" / ".helper-installation.json"
    journal = json.loads(journal_path.read_text())
    journal["phase"] = "preparing"
    journal["receipt"]["version"] = ".."
    sentinel = root / "outside"
    sentinel.write_text("keep")
    journal_path.write_text(json.dumps(journal, sort_keys=True))
    journal_path.chmod(0o600)
    with pytest.raises(ValueError, match="receipt.*release"):
        installer.install()
    assert sentinel.read_text() == "keep"


def test_foreign_symlink_is_never_replaced(signed_helper_package):
    root, config, _manifest, _archive = signed_helper_package
    destination = root / "installed"
    destination.mkdir(mode=0o755)
    target = root / "foreign"
    target.write_text("do not touch")
    (destination / module.HELPERS["ingress"]).symlink_to(target)
    with pytest.raises(ValueError, match="owned installation"):
        module.HelperInstallation(config, root).install()
    assert target.read_text() == "do not touch"


def test_wrapper_executes_with_effective_private_config(signed_helper_package):
    root, config, _manifest, _archive = signed_helper_package
    installer = module.HelperInstallation(config, root)
    installer.install()
    wrapper = root / "installed" / module.HELPERS["participant"]
    result = subprocess.run([str(wrapper)], input="{}\n", text=True, capture_output=True, check=False)
    assert result.returncode == 0
    assert not list((root / "state" / "1.0.3" / "backend").rglob("__pycache__"))
    assert installer.install()["replayed"] is True


def test_upgrade_crash_before_backup_reconciles_preparing(signed_helper_package, monkeypatch):
    root, config, _manifest, _archive = signed_helper_package
    installer = module.HelperInstallation(config, root)
    installer.install()
    archive, manifest = _versioned_release(root / "release-b", monkeypatch, "1.0.4", "before")
    _select_release(root, config, archive, manifest)
    original = module.HelperInstallation._backup_existing

    def crash(*args, **kwargs):
        raise OSError("crash before backup")

    monkeypatch.setattr(module.HelperInstallation, "_backup_existing", crash)
    with pytest.raises(OSError, match="before backup"):
        installer.install()
    assert json.loads((root / "state" / ".helper-installation.json").read_text())["phase"] == "preparing"
    monkeypatch.setattr(module.HelperInstallation, "_backup_existing", original)
    result = installer.install()
    assert result["version"] == "1.0.4"
    assert json.loads((root / "state" / ".helper-installation.json").read_text())["phase"] == "installed"


def test_upgrade_crash_after_backup_reconciles_and_retries(signed_helper_package, monkeypatch):
    root, config, _manifest, _archive = signed_helper_package
    installer = module.HelperInstallation(config, root)
    installer.install()
    archive, manifest = _versioned_release(root / "release-b", monkeypatch, "1.0.4", "after")
    _select_release(root, config, archive, manifest)
    real_save = module.state.save_journal
    calls = 0

    def crash_after_backup(path, value, state_dir, state_identity):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("crash after backup")
        return real_save(path, value, state_dir, state_identity)

    monkeypatch.setattr(module.state, "save_journal", crash_after_backup)
    with pytest.raises(OSError, match="after backup"):
        installer.install()
    assert json.loads((root / "state" / ".helper-installation.json").read_text())["phase"] == "preparing"
    monkeypatch.setattr(module.state, "save_journal", real_save)
    assert installer.install()["version"] == "1.0.4"


def test_rollback_b_to_a_then_install_c_uses_restored_receipt(signed_helper_package, monkeypatch):
    root, config, _manifest, _archive = signed_helper_package
    installer = module.HelperInstallation(config, root)
    installer.install()
    archive_b, manifest_b = _versioned_release(root / "release-b", monkeypatch, "1.0.4", "b")
    _select_release(root, config, archive_b, manifest_b)
    installer.install()
    installer.rollback()
    journal = json.loads((root / "state" / ".helper-installation.json").read_text())
    assert journal["phase"] == "rolled_back"
    assert journal["receipt"]["version"] == "1.0.3"
    archive_c, manifest_c = _versioned_release(root / "release-c", monkeypatch, "1.0.5", "c")
    _select_release(root, config, archive_c, manifest_c)
    assert installer.install()["version"] == "1.0.5"


@pytest.mark.parametrize("mode,exit_code", [("before_rename", 91), ("after_rename", 92)])
def test_real_process_crash_retries_without_losing_baseline(signed_helper_package, monkeypatch, mode, exit_code):
    root, config, _manifest, _archive = signed_helper_package
    installer = module.HelperInstallation(config, root)
    installer.install()
    baseline_wrapper = (root / "installed" / module.HELPERS["participant"]).read_bytes()
    baseline_backend = (root / "state" / "1.0.3" / "backend" / "app" / "__init__.py").read_bytes()
    archive, manifest = _versioned_release(root / "release-b", monkeypatch, "1.0.4", mode)
    _select_release(root, config, archive, manifest)

    crashed = _run_crashing_child(root, config, mode)
    assert crashed.returncode == exit_code
    assert (root / "state" / ".helper-installation.json").is_file()
    assert (root / "state" / "1.0.3" / "backend" / "app" / "__init__.py").read_bytes() == baseline_backend

    result = installer.install()
    assert result["version"] == "1.0.4"
    assert (root / "installed" / module.HELPERS["participant"]).read_bytes() != baseline_wrapper
    assert (root / "state" / "1.0.3" / "backend" / "app" / "__init__.py").read_bytes() == baseline_backend
