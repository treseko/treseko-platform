import hashlib
import json
from pathlib import Path
import tempfile

from app.services import update_existing_installation as orchestration
from app.services import update_complete_source as complete_source
from app.services import update_existing_installation_docker_preflight as preflight


DEPLOYMENT = {
    "mode": "complete-source", "path": "source-release",
    "compose_file": "docker-compose.prod.yml", "activation": "atomic-compose",
}


def _host_config(root: Path):
    state = root / "state"
    state.mkdir(mode=0o700)
    project = root / "project"
    project.mkdir(mode=0o700)
    env_file = project / "compose.production.env"
    env_file.write_text("LOCAL_SETTING=kept\n", encoding="utf-8")
    env_file.chmod(0o600)
    return {"schema": 1, "directory": str(state),
            "atomic_compose": {"schema": 1, "project": "treseko-test",
                               "project_root": str(project), "env_file": str(env_file)}}


def _manifest(package: Path):
    return {"version": "1.0.7", "checksum_sha256": hashlib.sha256(package.read_bytes()).hexdigest(),
            "package_size_bytes": package.stat().st_size, "deployment": DEPLOYMENT,
            "signature": "fixture"}


def _stage_fixture(package, manifest, destination):
    destination.mkdir(parents=True, mode=0o700)
    source = destination / "payload" / "source-release"
    (source / "scripts").mkdir(parents=True)
    (source / "scripts" / "atomic_local_update.py").write_text("# fixture\n")
    (source / "VERSION").write_text("1.0.7\n")
    (source / "docker-compose.prod.yml").write_text("services: {}\n")
    return destination


def test_component_only_manifest_keeps_existing_mode():
    assert orchestration._requires_complete_source({"version": "1.0.7"}) is False


def test_complete_source_plan_requires_and_binds_private_host_settings(tmp_path):
    config = _host_config(tmp_path)

    result = orchestration.plan(config, {"version": "1.0.7", "deployment": DEPLOYMENT}, "tx-107")

    assert result == {"status": "plan_validated", "deployment_mode": "complete-source",
                      "atomic_compose": True, "project": "treseko-test"}


def test_complete_source_rejects_unknown_deployment_contract():
    try:
        orchestration._requires_complete_source({"deployment": {"mode": "unknown"}})
    except orchestration.ExistingInstallationError as exc:
        assert "Unsupported signed deployment contract" in str(exc)
    else:
        raise AssertionError("unknown deployment contract was accepted")


def test_prepare_stages_signed_source_and_apply_commits_full_compose(tmp_path, monkeypatch):
    config = _host_config(tmp_path)
    package = tmp_path / "release.tar.gz"
    package.write_bytes(b"signed-package-fixture")
    manifest = _manifest(package)
    monkeypatch.setattr(complete_source, "stage_verified_package", _stage_fixture)
    calls = []

    def atomic(candidate, settings, transaction, version, *, mode):
        calls.append((candidate, settings, transaction, version, mode))
        if mode == "validate":
            return {"phase": "prepared", "candidate_services": ["backend", "frontend"]}
        return {"phase": "committed"}

    monkeypatch.setattr(orchestration, "_run_atomic_source", atomic)
    prepared = orchestration.prepare(config, manifest, "tx-107", package)

    assert prepared["status"] == "prepared"
    assert prepared["preparation"]["status"] == "ready_for_adoption"
    assert calls[-1][-1] == "validate"

    applied = orchestration.apply(config, manifest, "tx-107")

    assert applied["status"] == "complete"
    assert applied["apply"]["version"] == "1.0.7"
    assert calls[-1][-1] == "apply"
    journal = Path(config["directory"]) / "existing-installation" / "tx-107.json"
    assert json.loads(journal.read_text())["candidate_tree_sha256"]


def test_resume_reconciles_same_atomic_transaction(tmp_path, monkeypatch):
    config = _host_config(tmp_path)
    package = tmp_path / "release.tar.gz"
    package.write_bytes(b"signed-package-fixture")
    manifest = _manifest(package)
    monkeypatch.setattr(complete_source, "stage_verified_package", _stage_fixture)
    calls = []

    def atomic(candidate, settings, transaction, version, *, mode):
        calls.append((transaction, mode))
        return {"phase": "prepared" if mode == "validate" else "rolled_back"}

    monkeypatch.setattr(orchestration, "_run_atomic_source", atomic)
    orchestration.prepare(config, manifest, "tx-resume", package)
    journal = Path(config["directory"]) / "existing-installation" / "tx-resume.json"
    state = json.loads(journal.read_text())
    state["stage"] = "apply_uncertain"
    orchestration._save(journal.parent, journal, state)

    result = orchestration.resume(config, manifest, "tx-resume")

    assert result["status"] == "rolled_back"
    assert calls[-1] == ("tx-resume", "resume")


def test_docker_preflight_requires_readonly_project_mount_for_complete_source(tmp_path, monkeypatch):
    config = _host_config(tmp_path)
    config_path = tmp_path / "controller.json"
    config_path.write_text(json.dumps(config), encoding="utf-8")
    config_path.chmod(0o600)
    package = tmp_path / "release.tar.gz"
    package.write_bytes(b"package")
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"version": "1.0.7", "deployment": DEPLOYMENT}))
    socket = tmp_path / "docker.sock"
    socket.write_text("")
    cache = tmp_path / "cache"
    cache.mkdir()
    launcher_path = tmp_path / "launcher.json"
    mounts = [
        {"source": str(launcher_path), "target": str(launcher_path), "mode": "ro", "purpose": "launcher"},
        {"source": str(config_path), "target": str(config_path), "mode": "ro", "purpose": "controller"},
        {"source": str(socket), "target": str(socket), "mode": "rw", "purpose": "socket"},
        {"source": config["directory"], "target": config["directory"], "mode": "rw", "purpose": "state"},
        {"source": str(cache), "target": str(cache), "mode": "rw", "purpose": "cache"},
        {"source": str(manifest), "target": str(manifest), "mode": "ro", "purpose": "manifest"},
        {"source": config["atomic_compose"]["project_root"],
         "target": config["atomic_compose"]["project_root"], "mode": "ro", "purpose": "atomic-project"},
    ]
    launcher = {"schema": 1, "type": "docker", "docker": "/usr/bin/docker",
                "image": "sha256:" + "a" * 64, "socket": str(socket),
                "network": "treseko-update", "mounts": mounts}
    launcher_path.write_text(json.dumps(launcher))
    launcher_path.chmod(0o600)
    original_is_file = Path.is_file
    monkeypatch.setattr(Path, "is_file", lambda self: True if str(self) == "/usr/bin/docker" else original_is_file(self))
    original_access = preflight.os.access
    monkeypatch.setattr(preflight.os, "access", lambda path, mode: True if str(path) == "/usr/bin/docker" else original_access(path, mode))
    args = [str(launcher_path), "sha256:" + "a" * 64, "/usr/bin/docker", str(socket),
            "treseko-update", "plan", str(config_path), str(manifest), "", "0"]

    accepted = preflight.validate(args)
    assert any(purpose == "atomic-project" for _, _, _, purpose in accepted)

    launcher["mounts"] = [item for item in mounts if item["purpose"] != "atomic-project"]
    launcher_path.write_text(json.dumps(launcher))
    try:
        preflight.validate(args)
    except SystemExit as exc:
        assert "project root must be mounted readonly" in str(exc)
    else:
        raise AssertionError("complete-source plan accepted an unmounted project root")
