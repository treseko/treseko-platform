import base64
import hashlib
import io
import json
import tarfile

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
import pytest

from app.services.edition import update_manager
from app.services.update_participant_package import stage_verified_package


def release(tmp_path, monkeypatch, *, extra=None, version="1.0.3", worker_version=None,
            additional_files=None, plugin_runner=False, from_versions=None,
            component_contract=False, contract_plan_components=None,
            contract_sources=None, contract_plan_sources=None, components=None,
            complete_source=False):
    if worker_version is None:
        worker_version = version
    files = {
        "backend/app/version.py": f"PRODUCT_VERSION = '{version}'\n",
        "backend/entrypoint.sh": "#!/bin/sh\n",
        "VERSION": version, "frontend/dist/VERSION": version,
        "frontend/dist/version.json": json.dumps({"version": version}),
        "engine/VERSION": version, "engine/package.json": json.dumps({"version": version}),
        "automation-worker/VERSION": worker_version,
        "automation-worker/package.json": json.dumps({"version": worker_version}),
    }
    if plugin_runner:
        files.update({
            "plugin-runner/Dockerfile": "FROM node:22-alpine\n",
            "plugin-runner/package.json": json.dumps({"name": "treseko-plugin-runner", "type": "module", "version": "0.1.0"}),
            "plugin-runner/src/server.mjs": "server.listen(3020)\n",
        })
    if component_contract:
        component_map = {
            "backend": True, "frontend": True, "engine": True,
            "automation-worker": True,
        }
        runtime_map = {
            "backend": {"context": ".", "dockerfile": "backend/Dockerfile"},
            "frontend": {"context": "frontend", "dockerfile": "frontend/update.Dockerfile"},
            "engine": {"context": "engine", "dockerfile": "engine/Dockerfile"},
            "automation_worker": {"context": "automation-worker", "dockerfile": "automation-worker/Dockerfile"},
        }
        plan_map = {"backend": "replace", "frontend": "replace", "engine": "replace",
                    "automation_worker": "replace"}
        files.update({
            "manifest.json": json.dumps({"version": version, "components": component_map}),
            "update-plan.json": json.dumps({
                "version": version, "components": contract_plan_components or plan_map,
                **({"previous_versions": contract_plan_sources or contract_sources}
                   if contract_sources is not None else {}),
                "rollback": {"enabled": True},
            }),
            "runtime-builds.json": json.dumps({"components": runtime_map}),
            "backend/Dockerfile": "FROM python:3.12-slim\n",
            "frontend/update.Dockerfile": "FROM nginx:alpine\n",
            "engine/Dockerfile": "FROM node:22-alpine\n",
            "automation-worker/Dockerfile": "FROM node:22-alpine\n",
        })
        if complete_source:
            deployment = {
                "mode": "complete-source", "path": "source-release",
                "compose_file": "docker-compose.prod.yml", "activation": "atomic-compose",
            }
            files.update({
                "manifest.json": json.dumps({"version": version, "components": component_map,
                                             "deployment": deployment}),
                "update-plan.json": json.dumps({
                    "version": version, "components": contract_plan_components or plan_map,
                    **({"previous_versions": contract_plan_sources or contract_sources}
                       if contract_sources is not None else {}),
                    "rollback": {"enabled": True}, "deployment": deployment,
                }),
                "source-release/VERSION": version,
                "source-release/docker-compose.prod.yml": "services:\n  backend:\n    image: treseko/backend\n",
                "source-release/scripts/atomic_local_update.py": "# trusted updater\n",
                "source-release/scripts/install_local_treseko.sh": "#!/bin/sh\n",
                "source-release/backend/Dockerfile": "FROM python:3.12-slim\n",
                "source-release/backend/app/main.py": "app = None\n",
                "source-release/backend/alembic/env.py": "# migrations\n",
                "source-release/frontend/Dockerfile": "FROM nginx:alpine\n",
                "source-release/frontend/src/main.tsx": "// app\n",
                "source-release/engine/Dockerfile": "FROM node:22-alpine\n",
                "source-release/engine/src/main.ts": "// engine\n",
                "source-release/automation-worker/Dockerfile": "FROM node:22-alpine\n",
                "source-release/automation-worker/src/worker.mjs": "// worker\n",
                "source-release/plugin-runner/Dockerfile": "FROM node:22-alpine\n",
                "source-release/plugin-runner/src/server.mjs": "// plugin runner\n",
            })
        if contract_sources is not None:
            embedded_manifest = json.loads(files["manifest.json"])
            embedded_manifest["from_versions"] = contract_sources
            files["manifest.json"] = json.dumps(embedded_manifest)
    files.update(additional_files or {})
    archive = tmp_path / "release.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        for name, value in files.items():
            body = value.encode()
            entry = tarfile.TarInfo(name)
            entry.size = len(body)
            tar.addfile(entry, io.BytesIO(body))
        if extra:
            tar.addfile(extra)
    private = Ed25519PrivateKey.generate()
    public = private.public_key()
    raw = public.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    encoded = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    monkeypatch.setattr(update_manager, "_configured_update_public_keys", lambda: (encoded,))
    manifest = {
        "version": version, "key_id": update_manager._public_key_fingerprint(public),
        "checksum_sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        "package_size_bytes": archive.stat().st_size,
    }
    if from_versions is not None:
        manifest["from_versions"] = list(from_versions)
    if plugin_runner:
        manifest["components"] = {"plugin-runner": True}
    if component_contract:
        manifest["components"] = {
            "backend": True, "frontend": True, "engine": True,
            "automation-worker": True,
        }
    if complete_source:
        manifest_components = dict(manifest.get("components") or {})
        manifest_components["source-release"] = True
        manifest["components"] = manifest_components
        manifest["deployment"] = {
            "mode": "complete-source", "path": "source-release",
            "compose_file": "docker-compose.prod.yml", "activation": "atomic-compose",
        }
    if components is not None:
        # El contrato de componente compara el inventario firmado con el de
        # manifest.json / update-plan.json / runtime-builds.json. Quien arma un
        # payload con esos tres archivos debe poder declarar el inventario
        # completo sin perder la firma.
        manifest["components"] = dict(components)
    signature = private.sign(update_manager._canonical_manifest_payload(manifest))
    manifest["signature"] = "ed25519:" + base64.urlsafe_b64encode(signature).decode().rstrip("=")
    return archive, manifest


@pytest.mark.parametrize("version", ["1.0.3", "1.0.4"])
def test_signed_release_stages_all_component_versions(tmp_path, monkeypatch, version):
    archive, manifest = release(tmp_path, monkeypatch, version=version)
    result = stage_verified_package(archive, manifest, tmp_path / "ready")
    assert (result / "VERSION").read_text() == version
    assert (result / "frontend/dist/version.json").read_text() == json.dumps({"version": version})
    assert (result / "engine/VERSION").read_text() == version
    assert (result / "automation-worker/VERSION").read_text() == version
    assert not list(tmp_path.glob(".release-*"))


def test_complete_source_release_stages_compose_and_all_runtime_build_contexts(tmp_path, monkeypatch):
    archive, manifest = release(tmp_path, monkeypatch, version="1.0.7",
                                component_contract=True, complete_source=True)
    result = stage_verified_package(archive, manifest, tmp_path / "ready")
    assert (result / "source-release/VERSION").read_text() == "1.0.7"
    assert (result / "source-release/docker-compose.prod.yml").is_file()
    assert (result / "source-release/scripts/atomic_local_update.py").is_file()
    assert (result / "source-release/plugin-runner/src/server.mjs").is_file()
    assert manifest["components"]["source-release"] is True


@pytest.mark.parametrize("name", [
    "source-release/.env.production.example",
    "source-release/backend/.env.example",
    "source-release/automation-worker/.env.production.example",
])
def test_complete_source_release_preserves_environment_examples(tmp_path, monkeypatch, name):
    archive, manifest = release(
        tmp_path, monkeypatch, version="1.0.7", component_contract=True,
        complete_source=True, additional_files={name: "EXAMPLE=value\\n"},
    )
    result = stage_verified_package(archive, manifest, tmp_path / "ready")
    assert (result / name).read_text() == "EXAMPLE=value\\n"


def test_complete_source_release_requires_signed_outer_marker(tmp_path, monkeypatch):
    archive, manifest = release(tmp_path, monkeypatch, version="1.0.7",
                                component_contract=True, complete_source=True)
    manifest = dict(manifest)
    manifest["components"] = {key: value for key, value in manifest["components"].items()
                              if key != "source-release"}
    private = Ed25519PrivateKey.generate()
    public = private.public_key()
    raw = public.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    encoded = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    monkeypatch.setattr(update_manager, "_configured_update_public_keys", lambda: (encoded,))
    manifest["key_id"] = update_manager._public_key_fingerprint(public)
    signature = private.sign(update_manager._canonical_manifest_payload(manifest))
    manifest["signature"] = "ed25519:" + base64.urlsafe_b64encode(signature).decode().rstrip("=")
    with pytest.raises(ValueError, match="missing its signed source-release component marker"):
        stage_verified_package(archive, manifest, tmp_path / "rejected")


@pytest.mark.parametrize("missing_path", [
    "source-release/docker-compose.prod.yml",
    "source-release/automation-worker/Dockerfile",
    "source-release/scripts/atomic_local_update.py",
])
def test_complete_source_release_rejects_missing_deployment_files(tmp_path, monkeypatch, missing_path):
    archive, manifest = release(tmp_path, monkeypatch, version="1.0.7",
                                component_contract=True, complete_source=True)
    with tarfile.open(archive, "r:gz") as source:
        members = [(member, source.extractfile(member).read()) for member in source.getmembers()
                   if member.isfile() and member.name != missing_path]
    rewritten = tmp_path / "incomplete.tar.gz"
    with tarfile.open(rewritten, "w:gz") as target:
        for original, body in members:
            item = tarfile.TarInfo(original.name)
            item.mode = original.mode
            item.size = len(body)
            target.addfile(item, io.BytesIO(body))
    manifest = dict(manifest)
    manifest["checksum_sha256"] = hashlib.sha256(rewritten.read_bytes()).hexdigest()
    manifest["package_size_bytes"] = rewritten.stat().st_size
    # The package signature binds the archive checksum, so re-sign the altered
    # manifest to exercise structural validation rather than signature failure.
    private = Ed25519PrivateKey.generate()
    public = private.public_key()
    raw = public.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    encoded = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    monkeypatch.setattr(update_manager, "_configured_update_public_keys", lambda: (encoded,))
    manifest["key_id"] = update_manager._public_key_fingerprint(public)
    manifest.pop("signature", None)
    manifest["signature"] = "ed25519:" + base64.urlsafe_b64encode(
        private.sign(update_manager._canonical_manifest_payload(manifest))
    ).decode().rstrip("=")
    with pytest.raises(ValueError, match="incomplete"):
        stage_verified_package(rewritten, manifest, tmp_path / "rejected")


def test_tampered_signature_rejected_before_staging(tmp_path, monkeypatch):
    archive, manifest = release(tmp_path, monkeypatch)
    manifest["version"] = "1.0.4"
    with pytest.raises(ValueError):
        stage_verified_package(archive, manifest, tmp_path / "ready")
    assert not (tmp_path / "ready").exists()


def test_tampered_archive_rejected(tmp_path, monkeypatch):
    archive, manifest = release(tmp_path, monkeypatch)
    archive.write_bytes(archive.read_bytes() + b"modified")
    with pytest.raises(ValueError, match="checksum"):
        stage_verified_package(archive, manifest, tmp_path / "ready")


@pytest.mark.parametrize("kind", ["symlink", "device", "traversal", "duplicate"])
def test_signed_but_unsafe_archive_rejected(tmp_path, monkeypatch, kind):
    entry = tarfile.TarInfo("VERSION" if kind == "duplicate" else "unsafe")
    if kind == "symlink":
        entry.type = tarfile.SYMTYPE
        entry.linkname = "/etc"
    elif kind == "device":
        entry.type = tarfile.CHRTYPE
    elif kind == "traversal":
        entry.name = "../escape"
    archive, manifest = release(tmp_path, monkeypatch, extra=entry)
    with pytest.raises(ValueError):
        stage_verified_package(archive, manifest, tmp_path / "ready")
    assert not (tmp_path / "ready").exists()
    assert not (tmp_path / "escape").exists()


def test_mixed_component_versions_rejected(tmp_path, monkeypatch):
    archive, manifest = release(tmp_path, monkeypatch, worker_version="1.0.2")
    with pytest.raises(ValueError, match="Component version"):
        stage_verified_package(archive, manifest, tmp_path / "ready")


def test_declared_plugin_runner_is_staged_and_version_checked(tmp_path, monkeypatch):
    archive, manifest = release(tmp_path, monkeypatch, version="1.0.4", plugin_runner=True)
    staged = stage_verified_package(archive, manifest, tmp_path / "ready")
    assert (staged / "plugin-runner/src/server.mjs").is_file()


def test_declared_plugin_runner_requires_expected_package_metadata(tmp_path, monkeypatch):
    archive, manifest = release(tmp_path, monkeypatch, version="1.0.4", plugin_runner=True,
                                additional_files={"plugin-runner/package.json": '{"name":"unexpected"}'})
    with pytest.raises(ValueError, match="package metadata"):
        stage_verified_package(archive, manifest, tmp_path / "ready")


def test_legacy_manifest_without_plugin_runner_remains_compatible(tmp_path, monkeypatch):
    archive, manifest = release(tmp_path, monkeypatch)
    assert stage_verified_package(archive, manifest, tmp_path / "ready").is_dir()


def test_declared_release_components_match_package_plan_and_runtime_builds(tmp_path, monkeypatch):
    archive, manifest = release(tmp_path, monkeypatch, component_contract=True,
                                from_versions=["1.0.3"], contract_sources=["1.0.3"])
    staged = stage_verified_package(archive, manifest, tmp_path / "ready")
    assert (staged / "runtime-builds.json").is_file()


def test_release_component_omission_is_rejected_before_staging(tmp_path, monkeypatch):
    archive, manifest = release(
        tmp_path, monkeypatch, component_contract=True,
        contract_plan_components={"backend": "replace", "frontend": "replace"},
    )
    with pytest.raises(ValueError, match="inventory disagrees"):
        stage_verified_package(archive, manifest, tmp_path / "ready")
    assert not (tmp_path / "ready").exists()


def test_release_source_chain_must_match_signed_origin_and_plan(tmp_path, monkeypatch):
    archive, manifest = release(
        tmp_path, monkeypatch, component_contract=True,
        from_versions=["1.0.3"], contract_sources=["1.0.3"],
        contract_plan_sources=["1.0.4"],
    )
    with pytest.raises(ValueError, match="source-version chain"):
        stage_verified_package(archive, manifest, tmp_path / "ready")
    assert not (tmp_path / "ready").exists()


def test_expansion_limit_and_existing_destination(tmp_path, monkeypatch):
    archive, manifest = release(tmp_path, monkeypatch)
    with pytest.raises(ValueError, match="limit"):
        stage_verified_package(archive, manifest, tmp_path / "ready", max_files=2)
    (tmp_path / "ready").mkdir()
    with pytest.raises(FileExistsError):
        stage_verified_package(archive, manifest, tmp_path / "ready")


@pytest.mark.parametrize("name", ["frontend/dist/.treseko-update-fence", "frontend/dist/.maintenance",
                                  "automation-worker/.runner-token", "engine/.env.production"])
def test_even_signed_package_cannot_supply_local_control_files(tmp_path, monkeypatch, name):
    archive, manifest = release(tmp_path, monkeypatch, extra=tarfile.TarInfo(name))
    with pytest.raises(ValueError, match="local identity"):
        stage_verified_package(archive, manifest, tmp_path / "ready")
    assert not (tmp_path / "ready").exists()
