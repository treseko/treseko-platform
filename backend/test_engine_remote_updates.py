from fastapi import FastAPI
from fastapi.testclient import TestClient
from pathlib import Path

from app.services.engine_updates import engine_update_status, create_engine_update_archive, engine_source_build_id


def test_engine_update_status_never_downgrades_and_detects_same_version_build(tmp_path):
    desired = "a" * 64
    assert engine_update_status("1.0.7", "b" * 64, desired_version="1.0.8", desired_build_id=desired)["status"] == "update_required"
    assert engine_update_status("1.0.8", "b" * 64, desired_version="1.0.8", desired_build_id=desired)["status"] == "update_required"
    assert engine_update_status("1.0.10", "b" * 64, desired_version="1.0.8", desired_build_id=desired)["status"] == "ahead"
    assert engine_update_status("1.0.8", desired, desired_version="1.0.8", desired_build_id=desired)["status"] == "current"


def test_engine_build_id_rejects_source_from_a_different_ota_version(tmp_path):
    source = tmp_path / "engine"
    source.mkdir()
    (source / "package.json").write_text('{"version":"1.0.7"}')
    (source / "VERSION").write_text("1.0.7\n")

    import pytest
    with pytest.raises(ValueError, match="engine_source_version_mismatch"):
        engine_source_build_id(source)


def test_engine_update_archive_contains_verified_source_without_runtime_state(tmp_path):
    source = tmp_path / "engine"
    (source / "src").mkdir(parents=True)
    for name, content in {
        "VERSION": "1.0.8\n",
        "package.json": '{"version":"1.0.8"}',
        "package-lock.json": '{"name":"treseko-engine","version":"1.0.8","lockfileVersion":3,"packages":{}}',
        "entrypoint.sh": "#!/bin/sh\n",
        "engine-launcher.mjs": "// launcher\n",
        "release-lifecycle.mjs": "// lifecycle\n",
        "engine-self-update.mjs": "// updater\n",
        "hash_component_tree.sh": "#!/bin/sh\n",
        "src/server.ts": "export {};\n",
        "src/test-trace.ts": "export const traceEntry = () => undefined;\n",
        ".env": "must-not-ship\n",
    }.items():
        (source / name).write_text(content)
    (source / "node_modules").mkdir()
    (source / "node_modules" / "secret.txt").write_text("must-not-ship")
    archive, checksum = create_engine_update_archive(source, version="1.0.8")
    try:
        import hashlib
        import tarfile
        assert hashlib.sha256(archive.read_bytes()).hexdigest() == checksum
        with tarfile.open(archive, "r:gz") as package:
            names = set(package.getnames())
        assert {"VERSION", "package.json", "package-lock.json", "entrypoint.sh", "engine-launcher.mjs", "release-lifecycle.mjs", "engine-self-update.mjs", "hash_component_tree.sh", "src/server.ts", "src/test-trace.ts"} <= names
        assert ".env" not in names
        assert not any(name.startswith("node_modules/") for name in names)
        assert engine_source_build_id(source)
    finally:
        archive.unlink(missing_ok=True)


def test_docker_context_keeps_engine_update_runtime_dependencies():
    dockerignore = Path(__file__).resolve().parents[1] / ".dockerignore"
    excluded = set(dockerignore.read_text(encoding="utf-8").splitlines())
    assert "engine/src/test-trace.ts" not in excluded


def test_private_engine_update_api_authenticates_and_delivers_matching_archive(tmp_path, monkeypatch):
    from app.api.routers import engine_updates
    source = tmp_path / "engine-api"
    (source / "src").mkdir(parents=True)
    version = engine_updates.PRODUCT_VERSION
    for name, content in {
        "VERSION": f"{version}\n",
        "package.json": f'{{"version":"{version}"}}',
        "package-lock.json": f'{{"name":"treseko-engine","version":"{version}","lockfileVersion":3,"packages":{{}}}}',
        "entrypoint.sh": "#!/bin/sh\n",
        "engine-launcher.mjs": "// launcher\n",
        "release-lifecycle.mjs": "// lifecycle\n",
        "engine-self-update.mjs": "// updater\n",
        "hash_component_tree.sh": "#!/bin/sh\n",
        "src/server.ts": "export {};\n",
    }.items():
        (source / name).write_text(content)
    monkeypatch.setenv("AI_ENGINE_INTERNAL_TOKEN", "internal-test-token")
    monkeypatch.setattr(engine_updates, "engine_source_directory", lambda: source)
    desired_build = engine_source_build_id(source)
    app = FastAPI()
    app.include_router(engine_updates.router, prefix="/api")
    client = TestClient(app)
    path = "/api/engine-updates/me/status?version=0.9.0&build_id=" + "0" * 64
    assert client.get(path).status_code == 401
    status = client.get(path, headers={"x-engine-internal-token": "internal-test-token"})
    assert status.status_code == 200
    assert status.json()["desired_build_id"] == desired_build
    package = client.get("/api/engine-updates/me/package?version=0.9.0&build_id=" + "0" * 64,
                         headers={"x-engine-internal-token": "internal-test-token"})
    try:
        assert package.status_code == 200
        assert package.headers["x-engine-update-version"] == version
        assert package.headers["x-engine-update-build-id"] == desired_build
        import hashlib
        assert hashlib.sha256(package.content).hexdigest() == package.headers["x-engine-update-sha256"]
    finally:
        client.close()
