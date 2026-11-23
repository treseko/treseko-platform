from __future__ import annotations

import base64
import hashlib
import io
import json
import os
from pathlib import Path
import pwd
import shutil
import stat
import tarfile

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.services import update_remote_component_bootstrap as bootstrap
from app.services.edition.update_manager import _canonical_manifest_payload


def _runtime(tmp_path: Path) -> tuple[Path, Path, str]:
    runtime = tmp_path / "legacy-engine"
    runtime.mkdir()
    releases = runtime / ".engine-releases"
    previous = releases / ("1.0.7-" + "0" * 12)
    previous.mkdir(parents=True)
    (previous / "VERSION").write_text("1.0.7\n", encoding="utf-8")
    (runtime / "VERSION").write_text("1.0.7\n", encoding="utf-8")
    (runtime / "package.json").write_text('{"version":"1.0.7"}\n', encoding="utf-8")
    (runtime / "package-lock.json").write_text('{"version":"1.0.7"}\n', encoding="utf-8")
    (runtime / "engine-launcher.mjs").write_text("old launcher\n", encoding="utf-8")
    (runtime / "release-lifecycle.mjs").write_text("old lifecycle\n", encoding="utf-8")
    (runtime / "entrypoint.sh").write_text("old entrypoint\n", encoding="utf-8")
    (runtime / "hash_component_tree.sh").write_text("old hash\n", encoding="utf-8")
    for name in ("package.json", "package-lock.json", "VERSION", "engine-launcher.mjs", "release-lifecycle.mjs", "entrypoint.sh", "hash_component_tree.sh"):
        os.chmod(runtime / name, 0o640 if name.endswith(".json") else 0o750)
    pointer = runtime / ".treseko-active-engine-release.json"
    pointer.write_text(json.dumps({"schema": 1, "release": previous.name}) + "\n", encoding="utf-8")
    os.chmod(pointer, 0o640)
    return runtime, previous, pointer.name


def test_worker_readiness_requires_stable_systemd_service(monkeypatch: pytest.MonkeyPatch) -> None:
    now = [0.0]
    build_id = "a" * 64
    monkeypatch.setattr(bootstrap.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(bootstrap.time, "sleep", lambda seconds: now.__setitem__(0, now[0] + seconds))
    monkeypatch.setattr(bootstrap, "_fetch_json", lambda *args, **kwargs: {
        "status": "current", "desired_version": "1.0.8", "observed_version": "1.0.8",
        "desired_build_id": build_id, "observed_build_id": build_id,
    })
    active = [True]
    monkeypatch.setattr(bootstrap.subprocess, "run", lambda *args, **kwargs: type(
        "Result", (), {"returncode": 0 if active[0] else 3},
    )())

    assert bootstrap._wait_worker("http://127.0.0.1:8000", "token", "1.0.8", build_id, timeout=10)

    now[0] = 0.0
    active[0] = False
    assert not bootstrap._wait_worker("http://127.0.0.1:8000", "token", "1.0.8", build_id, timeout=6)


@pytest.mark.parametrize("status_payload", [
    {"status": "current", "desired_version": "1.0.8"},
    {"status": "current", "desired_version": "1.0.8", "observed_version": "1.0.7",
     "desired_build_id": "a" * 64, "observed_build_id": "a" * 64},
    {"status": "current", "desired_version": "1.0.8", "observed_version": "1.0.8",
     "desired_build_id": "a" * 64, "observed_build_id": "b" * 64},
])
def test_worker_readiness_rejects_missing_or_stale_reported_version_and_build(
    status_payload: dict[str, str], monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = [0.0]
    monkeypatch.setattr(bootstrap.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(bootstrap.time, "sleep", lambda seconds: now.__setitem__(0, now[0] + seconds))
    monkeypatch.setattr(bootstrap, "_fetch_json", lambda *args, **kwargs: status_payload)
    monkeypatch.setattr(bootstrap.subprocess, "run", lambda *args, **kwargs: type(
        "Result", (), {"returncode": 0},
    )())

    assert not bootstrap._wait_worker(
        "http://127.0.0.1:8000", "token", "1.0.8", "a" * 64, timeout=1,
    )


def _install_mocks(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, *, healthy: bool) -> None:
    (tmp_path / "one-file-ota.tar.gz").write_bytes(b"test fixture")
    user = pwd.getpwuid(os.getuid())
    monkeypatch.setattr(bootstrap.sys, "platform", "linux")
    monkeypatch.setattr(bootstrap.os, "geteuid", lambda: 0)
    monkeypatch.setattr(bootstrap, "_unit_properties", lambda service, root: (user.pw_name, f"WorkingDirectory={root}\n"))
    monkeypatch.setattr(bootstrap, "_load_component_package", lambda ota, temp: (tmp_path / "payload.tar.gz", {"version": "1.0.8"}))
    monkeypatch.setattr(bootstrap, "_stage_source", lambda archive, manifest, component, temp: (tmp_path / "source", "1.0.8", "a" * 64))

    def copy_release(source: Path, release: Path, component: str, version: str, build_id: str,
                     owner_uid: int, owner_gid: int, env: dict[str, str]) -> None:
        release.mkdir(parents=True, exist_ok=True)
        for name in bootstrap._MANAGED_ROOT_FILES[component]:
            (release / name).write_text(f"new {name}\n", encoding="utf-8")

    monkeypatch.setattr(bootstrap, "_copy_release", copy_release)
    restarts: list[list[str]] = []

    def run(argv: list[str], **kwargs: object) -> str:
        restarts.append(argv)
        return ""

    monkeypatch.setattr(bootstrap, "_run", run)
    monkeypatch.setattr(bootstrap, "_wait_engine", lambda url, version: healthy)
    monkeypatch.setattr(bootstrap, "_restarts_for_test", restarts, raising=False)


def test_bootstrap_rolls_back_files_pointer_and_metadata_on_failed_health(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    runtime, previous, pointer_name = _runtime(tmp_path)
    _install_mocks(monkeypatch, tmp_path, healthy=False)
    old_files = {
        name: ((runtime / name).read_bytes(), (runtime / name).stat().st_mode & 0o777,
               (runtime / name).stat().st_uid, (runtime / name).stat().st_gid)
        for name in bootstrap._MANAGED_ROOT_FILES["engine"]
    }
    pointer = runtime / pointer_name
    old_pointer = (pointer.read_bytes(), pointer.stat().st_mode & 0o777, pointer.stat().st_uid, pointer.stat().st_gid)

    with pytest.raises(bootstrap.RemoteBootstrapError, match="component_health_check_failed_rollback_applied"):
        bootstrap.bootstrap_remote_component(
            ota=tmp_path / "one-file-ota.tar.gz", component="engine", runtime_root=runtime,
        )

    for name, expected in old_files.items():
        path = runtime / name
        assert (path.read_bytes(), path.stat().st_mode & 0o777, path.stat().st_uid, path.stat().st_gid) == expected
    assert (pointer.read_bytes(), pointer.stat().st_mode & 0o777, pointer.stat().st_uid, pointer.stat().st_gid) == old_pointer
    assert previous.is_dir()
    assert len(getattr(bootstrap, "_restarts_for_test")) == 2


def test_bootstrap_validates_payload_before_creating_runtime_state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    runtime, _, pointer_name = _runtime(tmp_path)
    original_pointer = (runtime / pointer_name).read_bytes()
    _install_mocks(monkeypatch, tmp_path, healthy=True)
    monkeypatch.setattr(bootstrap, "_load_component_package", lambda ota, temp: (_ for _ in ()).throw(
        bootstrap.RemoteBootstrapError("ota_bootstrap_signature_invalid")))
    shutil.rmtree(runtime / ".engine-releases")

    with pytest.raises(bootstrap.RemoteBootstrapError, match="ota_bootstrap_signature_invalid"):
        bootstrap.bootstrap_remote_component(
            ota=tmp_path / "one-file-ota.tar.gz", component="engine", runtime_root=runtime,
        )

    assert not (runtime / ".engine-releases").exists()
    assert (runtime / pointer_name).read_bytes() == original_pointer
    assert not (runtime.parent / ".treseko-remote-bootstrap-backups").exists()


def test_snapshot_rejects_symlink_instead_of_deleting_it_during_rollback(tmp_path: Path) -> None:
    target = tmp_path / "target"
    target.write_text("keep\n", encoding="utf-8")
    link = tmp_path / "managed"
    link.symlink_to(target)

    with pytest.raises(bootstrap.RemoteBootstrapError, match="managed_runtime_file_unsafe"):
        bootstrap._snapshot_regular_file(link)
    assert target.read_text(encoding="utf-8") == "keep\n"


def test_dependency_install_uses_service_users_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    user = next(item for item in pwd.getpwall() if item.pw_uid not in {0, os.getuid()})
    captured: list[list[str]] = []
    monkeypatch.setattr(bootstrap.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(bootstrap, "_run", lambda argv, **kwargs: captured.append(argv) or "")

    bootstrap._run_as_service_user(
        ["npm", "ci"], cwd=tmp_path, timeout=60,
        env={"HOME": "/root", "PATH": "/usr/bin", "NPM_CONFIG_REGISTRY": "https://registry.npmjs.org"},
        uid=user.pw_uid,
    )

    assert len(captured) == 1
    assert f"HOME={user.pw_dir}" in captured[0]
    assert "HOME=/root" not in captured[0]


def test_extracts_signed_engine_payload_from_the_single_ota(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw,
    )
    encoded_key = base64.urlsafe_b64encode(public_key).decode("ascii").rstrip("=")
    key_id = "ed25519:sha256:" + hashlib.sha256(public_key).hexdigest()[:24]
    monkeypatch.setenv("TRESEKO_ALLOW_DEV_UPDATE_PUBLIC_KEY", "1")
    monkeypatch.setenv("TRESEKO_UPDATE_PUBLIC_KEY", encoded_key)

    payload_path = tmp_path / "component.tar.gz"
    with tarfile.open(payload_path, "w:gz") as archive:
        files = {
            "VERSION": "1.0.8\n",
            "backend/app/version.py": "PRODUCT_VERSION = '1.0.8'\n",
            "backend/entrypoint.sh": "#!/bin/sh\n",
            "frontend/dist/VERSION": "1.0.8\n",
            "frontend/dist/version.json": '{"version":"1.0.8"}\n',
            "automation-worker/package.json": '{"name":"treseko-automation-worker","version":"1.0.8"}\n',
            "automation-worker/package-lock.json": '{"name":"treseko-automation-worker","version":"1.0.8","lockfileVersion":3,"packages":{"":{"name":"treseko-automation-worker","version":"1.0.8"}}}\n',
            "engine/package.json": '{"name":"treseko-engine","version":"1.0.8"}\n',
            "engine/package-lock.json": '{"name":"treseko-engine","version":"1.0.8","packages":{"":{"version":"1.0.8"}}}\n',
            "engine/VERSION": "1.0.8\n",
            "engine/src/server.ts": "export const version = '1.0.8'\n",
            "engine/engine-launcher.mjs": "// launcher\n",
            "engine/release-lifecycle.mjs": "// lifecycle\n",
            "engine/engine-self-update.mjs": "// updater\n",
            "engine/hash_component_tree.sh": "#!/bin/sh\n",
            "automation-worker/VERSION": "1.0.8\n",
            "automation-worker/src/worker.mjs": "// worker\n",
            "automation-worker/worker-launcher.mjs": "// launcher\n",
            "automation-worker/src/worker-self-update.mjs": "// updater\n",
            "automation-worker/hash_component_tree.sh": "#!/bin/sh\n",
            "plugin-runner/Dockerfile": "FROM node:22\n",
            "plugin-runner/package.json": '{"name":"treseko-plugin-runner","type":"module"}\n',
            "plugin-runner/src/server.mjs": "// plugin runner\n",
        }
        for name, content in files.items():
            encoded = content.encode("utf-8")
            info = tarfile.TarInfo(name)
            info.size = len(encoded)
            info.mode = 0o755 if name.endswith((".sh", ".mjs")) else 0o644
            archive.addfile(info, io.BytesIO(encoded))

    checksum = hashlib.sha256(payload_path.read_bytes()).hexdigest()
    manifest = {
        "manifest_version": 1, "channel": "premium-stable", "edition": "premium",
        "version": "1.0.8", "previous_version": "1.0.7", "from_versions": ["1.0.7"],
        "artifact": "component-bootstrap.tar.gz", "artifact_type": "tar.gz",
        "package_url": "treseko-update://premium-stable/1.0.8/component-bootstrap.tar.gz",
        "package_size_bytes": payload_path.stat().st_size, "checksum_sha256": checksum,
        "components": {"backend": True, "frontend": True, "engine": True,
                       "automation-worker": True, "plugin-runner": True},
        "key_id": key_id,
    }
    signature = private_key.sign(_canonical_manifest_payload(manifest))
    manifest["signature"] = "ed25519:" + base64.urlsafe_b64encode(signature).decode("ascii").rstrip("=")

    outer_path = tmp_path / "single-ota.tar.gz"
    with tarfile.open(outer_path, "w:gz") as archive:
        for name, content in (
            ("bootstrap/manifest.json", json.dumps(manifest).encode("utf-8")),
            ("bootstrap/component-bootstrap.tar.gz", payload_path.read_bytes()),
        ):
            info = tarfile.TarInfo(name)
            info.size = len(content)
            archive.addfile(info, io.BytesIO(content))

    with __import__("tempfile").TemporaryDirectory(dir=tmp_path) as temp_name:
        package, verified_manifest = bootstrap._load_component_package(outer_path, Path(temp_name))
        source, version, build_id = bootstrap._stage_source(
            package, verified_manifest, "engine", Path(temp_name),
        )
        assert version == "1.0.8"
        assert len(build_id) == 64
        assert (source / "engine-launcher.mjs").is_file()
        assert (source / "release-lifecycle.mjs").is_file()
        assert (source / "engine-self-update.mjs").is_file()
        worker_temp = Path(temp_name) / "worker"
        worker_temp.mkdir()
        worker_source, worker_version, worker_build_id = bootstrap._stage_source(
            package, verified_manifest, "automation-worker", worker_temp,
        )
        assert worker_version == "1.0.8"
        assert len(worker_build_id) == 64
        assert (worker_source / "src/worker-self-update.mjs").is_file()


@pytest.mark.parametrize("value", [
    "http://127.0.0.1.attacker.invalid/api",
    "http://example.com/api",
    "https://user:password@example.com/api",
    "https://example.com/api?token=secret",
])
def test_worker_api_base_rejects_token_leaking_or_cleartext_destinations(value: str) -> None:
    with pytest.raises(bootstrap.RemoteBootstrapError):
        bootstrap._validated_api_base(value)


@pytest.mark.parametrize("value", [
    "https://updates.example.test/api/",
    "http://127.0.0.1:8000/api",
    "http://[::1]:8000/api",
])
def test_worker_api_base_accepts_tls_and_exact_loopback(value: str) -> None:
    assert bootstrap._validated_api_base(value).rstrip("/") == value.rstrip("/")


def test_worker_token_requires_private_regular_file_owned_by_service_user(tmp_path: Path) -> None:
    token = tmp_path / "runner-token"
    token.write_text("secret\n", encoding="utf-8")
    os.chmod(token, 0o600)
    assert bootstrap._read_worker_token(token, os.getuid()) == "secret"

    os.chmod(token, 0o640)
    with pytest.raises(bootstrap.RemoteBootstrapError, match="worker_token_file_unsafe"):
        bootstrap._read_worker_token(token, os.getuid())

    link = tmp_path / "runner-token-link"
    link.symlink_to(token)
    with pytest.raises(bootstrap.RemoteBootstrapError, match="worker_token_file_unsafe"):
        bootstrap._read_worker_token(link, os.getuid())


def test_worker_update_lock_is_private_resumable_and_released_only_after_api_ack(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime = tmp_path / "worker"
    runtime.mkdir()
    calls: list[tuple[str, str, dict[str, str]]] = []

    def request(url, token, header, **kwargs):
        calls.append((kwargs["method"], url, kwargs["extra_headers"]))
        lock_token = kwargs["extra_headers"]["X-Runner-Update-Lock"]
        if kwargs["method"] == "POST":
            return {"locked": True, "lock_token": lock_token}
        return {"locked": False, "released": True}

    monkeypatch.setattr(bootstrap, "_fetch_json", request)
    lock_file, lock_token = bootstrap._acquire_worker_update_lock(
        "https://treseko.example/api", "runner-secret", runtime, os.getuid(), os.getgid(),
    )
    assert lock_file == runtime / ".state" / "ota-update-lock"
    assert lock_file.read_text(encoding="ascii").strip() == lock_token
    assert stat.S_IMODE(lock_file.stat().st_mode) == 0o600

    resumed_file, resumed_token = bootstrap._worker_update_lock_file(runtime, os.getuid(), os.getgid())
    assert resumed_file == lock_file
    assert resumed_token == lock_token
    bootstrap._release_worker_update_lock("https://treseko.example/api", "runner-secret", lock_file, lock_token)
    assert not lock_file.exists()
    assert [call[0] for call in calls] == ["POST", "DELETE"]
    assert all(call[1].endswith("/automation-runners/me/update-lock") for call in calls)


def test_worker_update_lock_requires_api_ack_before_treating_worker_as_drained(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime = tmp_path / "worker"
    runtime.mkdir()
    monkeypatch.setattr(bootstrap, "_fetch_json", lambda *args, **kwargs: {
        "locked": True, "lock_token": "different-lock-token-value-1234567890",
    })

    with pytest.raises(bootstrap.RemoteBootstrapError, match="worker_update_lock_not_confirmed"):
        bootstrap._acquire_worker_update_lock(
            "https://treseko.example/api", "runner-secret", runtime, os.getuid(), os.getgid(),
        )
