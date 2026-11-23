from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from app.services import update_remote_component_bootstrap as common
from app.services import update_remote_docker_component_bootstrap as bootstrap


def _inspect(container: str, runtime: Path, component: str = "engine") -> dict:
    destination = "/engine" if component == "engine" else "/worker"
    return {
        "Name": f"/{container}",
        "Config": {"Env": ["NPM_CONFIG_REGISTRY=https://registry.npmjs.org", "SECRET_TOKEN=do-not-use"]},
        "State": {"Running": True},
        "Mounts": [{"Type": "volume", "Source": str(runtime), "Destination": destination, "RW": True}],
    }


def _runtime(root: Path) -> tuple[Path, Path]:
    runtime = root / "engine-runtime"
    runtime.mkdir()
    releases = runtime / ".engine-releases"
    previous = releases / ("1.0.7-" + "0" * 12)
    previous.mkdir(parents=True)
    for name in common._MANAGED_ROOT_FILES["engine"]:
        (runtime / name).write_text(f"old {name}\n", encoding="utf-8")
        os.chmod(runtime / name, 0o750 if name.endswith((".mjs", ".sh")) else 0o640)
    pointer = runtime / common._COMPONENTS["engine"]["pointer"]
    pointer.write_text(json.dumps({"schema": 1, "release": previous.name}) + "\n", encoding="utf-8")
    os.chmod(pointer, 0o600)
    return runtime, pointer


def test_runtime_mount_requires_unique_writable_component_mount(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    monkeypatch.setattr(bootstrap, "_docker_json", lambda *args: _inspect("engine", runtime))
    details, found, destination = bootstrap._runtime_mount("docker", "engine", "engine")
    assert details["Name"] == "/engine"
    assert found == runtime
    assert destination == "/engine"

    bad = _inspect("engine", runtime)
    bad["Mounts"][0]["Destination"] = "/data"
    monkeypatch.setattr(bootstrap, "_docker_json", lambda *args: bad)
    with pytest.raises(bootstrap.RemoteDockerBootstrapError, match="docker_component_runtime_mount_invalid"):
        bootstrap._runtime_mount("docker", "engine", "engine")


def test_remote_docker_bootstrap_rejects_nonlocal_context(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DOCKER_HOST", "tcp://docker.example:2376")
    with pytest.raises(bootstrap.RemoteDockerBootstrapError, match="local_docker_context_required"):
        bootstrap._require_local_docker_endpoint("docker")
    monkeypatch.setenv("DOCKER_HOST", "unix:///run/user/1000/docker.sock")
    bootstrap._require_local_docker_endpoint("docker")


def test_docker_bootstrap_switches_versioned_runtime_and_checks_health(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime, pointer = _runtime(tmp_path)
    ota = tmp_path / "one-file-ota.tar.gz"
    ota.write_bytes(b"fixture")
    source = tmp_path / "source"
    source.mkdir()
    monkeypatch.setattr(bootstrap.os, "geteuid", lambda: 0)
    monkeypatch.setattr(bootstrap.sys, "platform", "linux")
    monkeypatch.setattr(bootstrap, "_runtime_mount", lambda *args: (_inspect("engine", runtime), runtime, "/engine"))
    monkeypatch.setattr(bootstrap, "_require_local_docker_endpoint", lambda *_args: None)
    monkeypatch.setattr(common, "_load_component_package", lambda *args: (tmp_path / "component.tar.gz", {
        "version": "1.0.8", "components": {"engine": True},
    }))
    monkeypatch.setattr(common, "_stage_source", lambda *args: (source, "1.0.8", "a" * 64))

    def copy_release(_source, release, component, version, build_id, uid, gid, env, **kwargs):
        release.mkdir(parents=True)
        for name in common._MANAGED_ROOT_FILES[component]:
            (release / name).write_text(f"new {name}\n", encoding="utf-8")
        if component == "engine":
            (release / ".treseko-runtime-manifest.json").write_text(
                json.dumps({"source": "ota-remote-bootstrap", "version": version}) + "\n",
                encoding="utf-8",
            )

    monkeypatch.setattr(common, "_copy_release", copy_release)
    dependency_calls: list[tuple[str, ...]] = []
    monkeypatch.setattr(bootstrap, "_install_release_dependencies", lambda *args: dependency_calls.append(args))
    docker_calls: list[list[str]] = []
    monkeypatch.setattr(common, "_run", lambda argv, **kwargs: docker_calls.append(argv) or "")
    monkeypatch.setattr(bootstrap, "_docker_json", lambda *args: _inspect("engine", runtime))
    monkeypatch.setattr(bootstrap, "_container_health", lambda *args: True)
    monkeypatch.setattr(bootstrap.time, "sleep", lambda _seconds: None)

    result = bootstrap.bootstrap_remote_docker_component(
        ota=ota, component="engine", container="engine", docker="docker",
        maintenance_window_confirmed=True,
    )

    assert result["ok"] is True
    assert result["version"] == "1.0.8"
    assert result["identity_preserved"] is False
    assert json.loads(pointer.read_text(encoding="utf-8"))["release"] == "1.0.8-aaaaaaaaaaaa"
    assert (runtime / "engine-launcher.mjs").read_text(encoding="utf-8") == "new engine-launcher.mjs\n"
    assert json.loads((runtime / ".treseko-runtime-manifest.json").read_text(encoding="utf-8")) == {
        "source": "ota-remote-bootstrap", "version": "1.0.8",
    }
    assert [call[1] for call in docker_calls] == ["stop", "start"]
    assert dependency_calls


def test_docker_worker_bootstrap_marks_ota_runtime_for_legacy_entrypoint(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime = tmp_path / "worker-runtime"
    runtime.mkdir()
    releases = runtime / ".worker-releases"
    releases.mkdir()
    token_file = runtime / ".runner-token"
    token_file.write_text("runner-test-token\n", encoding="utf-8")
    os.chmod(token_file, 0o600)
    os.chown(token_file, os.getuid(), os.getgid())
    ota = tmp_path / "one-file-ota.tar.gz"
    ota.write_bytes(b"fixture")
    source = tmp_path / "source"
    source.mkdir()
    monkeypatch.setattr(bootstrap.os, "geteuid", lambda: 0)
    monkeypatch.setattr(bootstrap.sys, "platform", "linux")
    monkeypatch.setattr(
        bootstrap, "_runtime_mount",
        lambda *args: (_inspect("worker", runtime, "automation-worker"), runtime, "/worker"),
    )
    monkeypatch.setattr(bootstrap, "_require_local_docker_endpoint", lambda *_args: None)
    monkeypatch.setattr(common, "_load_component_package", lambda *args: (tmp_path / "component.tar.gz", {
        "version": "1.0.8", "components": {"automation-worker": True},
    }))
    monkeypatch.setattr(common, "_stage_source", lambda *args: (source, "1.0.8", "b" * 64))

    def copy_release(_source, release, component, version, _build_id, uid, gid, _env, **kwargs):
        release.mkdir(parents=True)
        for name in common._MANAGED_ROOT_FILES[component]:
            (release / name).write_text(f"new {name}\n", encoding="utf-8")
        (release / ".treseko-runtime-manifest.json").write_text(
            json.dumps({"source": "ota-remote-bootstrap", "version": version}) + "\n",
            encoding="utf-8",
        )
        for item in release.rglob("*"):
            if item.is_file():
                os.chown(item, uid, gid)

    monkeypatch.setattr(common, "_copy_release", copy_release)
    monkeypatch.setattr(bootstrap, "_install_release_dependencies", lambda *args: None)
    monkeypatch.setattr(common, "_run", lambda *args, **kwargs: "")
    monkeypatch.setattr(bootstrap, "_docker_json", lambda *args: _inspect("worker", runtime, "automation-worker"))
    monkeypatch.setattr(common, "_acquire_worker_update_lock", lambda *args: (runtime / ".lock", "lock-token"))
    monkeypatch.setattr(common, "_release_worker_update_lock", lambda *args: None)
    monkeypatch.setattr(bootstrap, "_wait_worker", lambda *args: True)

    result = bootstrap.bootstrap_remote_docker_component(
        ota=ota, component="automation-worker", container="worker", docker="docker",
        api_base="https://treseko.example/api", runner_token_file=token_file,
    )

    assert result["ok"] is True
    assert result["identity_preserved"] is True
    marker = json.loads((runtime / ".treseko-runtime-manifest.json").read_text(encoding="utf-8"))
    assert marker == {"source": "ota-remote-bootstrap", "version": "1.0.8"}
    assert token_file.read_text(encoding="utf-8") == "runner-test-token\n"
    pointer = json.loads((runtime / common._COMPONENTS["automation-worker"]["pointer"]).read_text())
    assert pointer["release"] == "1.0.8-" + "b" * 12


def test_docker_bootstrap_restores_pointer_and_files_when_health_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime, pointer = _runtime(tmp_path)
    ota = tmp_path / "one-file-ota.tar.gz"
    ota.write_bytes(b"fixture")
    source = tmp_path / "source"
    source.mkdir()
    monkeypatch.setattr(bootstrap.os, "geteuid", lambda: 0)
    monkeypatch.setattr(bootstrap.sys, "platform", "linux")
    monkeypatch.setattr(bootstrap, "_runtime_mount", lambda *args: (_inspect("engine", runtime), runtime, "/engine"))
    monkeypatch.setattr(bootstrap, "_require_local_docker_endpoint", lambda *_args: None)
    monkeypatch.setattr(common, "_load_component_package", lambda *args: (tmp_path / "component.tar.gz", {
        "version": "1.0.8", "components": {"engine": True},
    }))
    monkeypatch.setattr(common, "_stage_source", lambda *args: (source, "1.0.8", "a" * 64))

    def copy_release(_source, release, component, version, build_id, uid, gid, env, **kwargs):
        release.mkdir(parents=True)
        for name in common._MANAGED_ROOT_FILES[component]:
            (release / name).write_text(f"new {name}\n", encoding="utf-8")
        if component == "engine":
            (release / ".treseko-runtime-manifest.json").write_text(
                json.dumps({"source": "ota-remote-bootstrap", "version": version}) + "\n",
                encoding="utf-8",
            )

    monkeypatch.setattr(common, "_copy_release", copy_release)
    monkeypatch.setattr(bootstrap, "_install_release_dependencies", lambda *args: None)
    monkeypatch.setattr(common, "_run", lambda *args, **kwargs: "")
    monkeypatch.setattr(bootstrap, "_docker_json", lambda *args: _inspect("engine", runtime))
    monkeypatch.setattr(bootstrap, "_container_health", lambda *args: False)
    ticks = iter([0.0, 151.0, 152.0, 303.0])
    monkeypatch.setattr(bootstrap.time, "monotonic", lambda: next(ticks, 303.0))
    old_pointer = pointer.read_bytes()
    old_launcher = (runtime / "engine-launcher.mjs").read_bytes()

    with pytest.raises(bootstrap.RemoteDockerBootstrapError, match="component_health_check_failed_rollback_applied"):
        bootstrap.bootstrap_remote_docker_component(
            ota=ota, component="engine", container="engine", docker="docker",
            maintenance_window_confirmed=True,
        )

    assert pointer.read_bytes() == old_pointer
    assert (runtime / "engine-launcher.mjs").read_bytes() == old_launcher
    assert not (runtime / ".treseko-runtime-manifest.json").exists()
    assert not (runtime / ".engine-releases" / ("1.0.8-" + "a" * 12)).exists()


def test_engine_docker_bootstrap_requires_maintenance_confirmation(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(bootstrap.os, "geteuid", lambda: 0)
    monkeypatch.setattr(bootstrap.sys, "platform", "linux")
    with pytest.raises(bootstrap.RemoteDockerBootstrapError, match="engine_maintenance_window_confirmation_required"):
        bootstrap.bootstrap_remote_docker_component(
            ota=tmp_path / "unused.tar.gz", component="engine", container="engine", docker="docker",
        )
