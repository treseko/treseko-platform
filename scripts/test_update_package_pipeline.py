from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import shutil
import shlex
import subprocess
import tarfile
import sys
import tarfile
import tempfile
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.edition.update_manager import (  # noqa: E402
    validate_update_manifest, verify_update_manifest_signature,
)
from app.services.edition import update_manager as update_manager_module  # noqa: E402
from app.services import update_remote_component_bootstrap as remote_component_bootstrap  # noqa: E402
from scripts.publish_update_release import build_payload  # noqa: E402


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def assert_package_tree_matches_source(archive: tarfile.TarFile, source_root: Path, relative: str) -> None:
    source_dir = source_root / relative
    expected: dict[str, str] = {}
    for path in sorted(candidate for candidate in source_dir.rglob("*") if candidate.is_file()):
        item = path.relative_to(source_dir).as_posix()
        if (
            "__pycache__" in path.parts
            or path.suffix in {".pyc", ".pyo"}
            or any(part.startswith("._") for part in path.relative_to(source_dir).parts)
        ):
            continue
        if relative == "backend/app" and item.startswith(("static/attachments/", "static/evidencias/")):
            continue
        expected[item] = hashlib.sha256(path.read_bytes()).hexdigest()

    archive_prefix = relative + "/"
    actual: dict[str, str] = {}
    for member in archive.getmembers():
        name = member.name.removeprefix("./")
        if not member.isfile() or not name.startswith(archive_prefix):
            continue
        item = name.removeprefix(archive_prefix)
        if (
            "__pycache__" in Path(item).parts
            or Path(item).suffix in {".pyc", ".pyo"}
            or any(part.startswith("._") for part in Path(item).parts)
        ):
            continue
        if relative == "backend/app" and item.startswith(("static/attachments/", "static/evidencias/")):
            continue
        content = archive.extractfile(member)
        assert content is not None, f"Could not read packaged file: {name}"
        actual[item] = hashlib.sha256(content.read()).hexdigest()

    missing = sorted(set(expected) - set(actual))
    extra = sorted(set(actual) - set(expected))
    changed = sorted(path for path in set(expected) & set(actual) if expected[path] != actual[path])
    assert not missing and not extra and not changed, (
        f"Update payload diverges from public {relative}: "
        f"missing={missing[:10]}, extra={extra[:10]}, changed={changed[:10]}"
    )


def assert_complete_source_matches_release(archive: tarfile.TarFile, source_root: Path) -> None:
    """The embedded host candidate is the full public tree minus mutable/local data."""
    excluded_dirs = {
        ".git", ".treseko", ".treseko-local", ".venv", "venv", "node_modules",
        "dist", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
        "coverage", "test-results", "playwright-report",
    }
    excluded_suffixes = {".pyc", ".pyo", ".log", ".jsonl"}
    allowed_env_examples = {
        ".env.production.example",
        "automation-worker/.env.example",
        "automation-worker/.env.production.example",
        "backend/.env.production.example",
        "engine/.env.production.example",
        "frontend/.env.example",
    }
    expected: dict[str, str] = {}
    for current, directories, names in os.walk(source_root, topdown=True, followlinks=False):
        current_path = Path(current)
        relative = current_path.relative_to(source_root)
        directories[:] = [name for name in directories
                          if (name not in excluded_dirs
                              or (name == "dist" and relative.parts[:2] == ("automation-worker", "vendor")))
                          and not name.startswith(".env")
                          and not (relative.as_posix() == "backend/app" and name == "static")
                          and not (relative == Path(".") and name == "public-release")]
        for name in names:
            path = current_path / name
            is_env_example = path.relative_to(source_root).as_posix() in allowed_env_examples
            if (name in {".runner-token", ".worker-instance-id", ".runner-token.pairing",
                         ".maintenance", ".DS_Store", ".gitignore", "dump.rdb"}
                    or (name.startswith(".env") and not is_env_example)
                    or name.startswith("._") or path.suffix in excluded_suffixes):
                continue
            expected[path.relative_to(source_root).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    prefix = "./source-release/"
    actual: dict[str, str] = {}
    for member in archive.getmembers():
        name = member.name
        if not member.isfile() or not name.startswith(prefix):
            continue
        handle = archive.extractfile(member)
        assert handle is not None
        actual[name.removeprefix(prefix)] = hashlib.sha256(handle.read()).hexdigest()
    assert actual == expected, (
        "Embedded complete source differs from curated public release: "
        f"missing={sorted(set(expected) - set(actual))[:8]}, "
        f"extra={sorted(set(actual) - set(expected))[:8]}, "
        f"changed={sorted(path for path in set(expected) & set(actual) if expected[path] != actual[path])[:8]}"
    )


def _premium_state() -> dict:
    return {
        "edition": "premium",
        "state": "active",
        "valid": True,
        "enabled_features": ["updates.premium"],
        "update_channel": "premium-stable",
        "license": {
            "license_id": "lic-package-smoke",
            "activation_token": "tok_" + "x" * 32,
        },
    }


def verify_public_release_package() -> None:
    """Build from the actual public-release tree and inspect every runtime input."""
    public_root = ROOT / "public-release" / "treseko-platform"
    version = (public_root / "VERSION").read_text(encoding="utf-8").strip()
    previous_version = os.getenv("TRESEKO_UPDATE_FROM_VERSION")
    if not previous_version and version == "1.0.7":
        previous_version = "1.0.6"
    dist_version_path = public_root / "frontend" / "dist" / "VERSION"
    dist_version_before = dist_version_path.read_bytes() if dist_version_path.exists() else None
    with tempfile.TemporaryDirectory(prefix="treseko-public-update-package-") as tmp:
        output_root = Path(tmp) / "updates"
        env = os.environ.copy()
        env.update({
            "SOURCE_DIR": str(public_root),
            "VERSION_VALUE": version,
            "OUTPUT_ROOT": str(output_root),
            "EDITION": "community",
            "CHANNEL": "community-stable",
            "PYTHON_BIN": sys.executable,
            "TRESEKO_UPDATE_SKIP_BUILD": "true",
            "TRESEKO_COMPLETE_SOURCE_ENABLED": "true",
            "TRESEKO_BRIDGE_BOOTSTRAP_VERIFIED": "true",
            "PUBLIC_BASE_URL": "https://updates.example.invalid",
        })
        if previous_version:
            env["PREVIOUS_VERSION"] = previous_version
            env["FROM_VERSIONS"] = previous_version

        # The component payload and complete Compose source must be from the
        # same checkout. A split source silently reintroduces mixed releases.
        mismatched_env = env.copy()
        mismatched_env["SOURCE_DIR"] = str(ROOT)
        mismatched_env["OUTPUT_ROOT"] = str(Path(tmp) / "mismatched-source")
        mismatched_build = subprocess.run(
            ["bash", "scripts/build_update_package.sh"], cwd=ROOT,
            env=mismatched_env, check=False, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True)
        assert mismatched_build.returncode != 0
        assert "must be the same public checkout" in (
            f"{mismatched_build.stdout}\n{mismatched_build.stderr}")
        assert not (Path(mismatched_env["OUTPUT_ROOT"]) / "packages" / version).exists()

        subprocess.run(["bash", "scripts/build_update_package.sh"],
                       cwd=ROOT, env=env, check=True)

        package_dir = output_root / "packages" / version
        manifest = json.loads((package_dir / "manifest.json").read_text(encoding="utf-8"))
        archive_path = package_dir / manifest["artifact"]
        assert manifest["edition"] == "community"
        assert manifest["version"] == version
        assert manifest["deployment"] == {
            "mode": "complete-source", "path": "source-release",
            "compose_file": "docker-compose.prod.yml", "activation": "atomic-compose",
        }
        assert manifest["host_bridge_bootstrap_verified"] is True
        assert manifest["components"]["source-release"] is True
        if previous_version:
            assert manifest["previous_version"] == previous_version
            assert manifest["from_versions"] == [previous_version]
        assert {name for name, included in manifest["components"].items() if included} == {
            "backend", "frontend", "engine", "automation-worker", "plugin-runner",
            "source-release"}
        bootstrap_manifest = json.loads(
            (package_dir / "bootstrap" / "manifest.json").read_text(encoding="utf-8"))
        bootstrap_artifact = package_dir / "bootstrap" / bootstrap_manifest["artifact"]
        assert bootstrap_artifact.is_file()
        assert bootstrap_manifest["checksum_sha256"] == hashlib.sha256(bootstrap_artifact.read_bytes()).hexdigest()
        assert bootstrap_manifest["checksum_sha256"] != manifest["checksum_sha256"]
        assert bootstrap_manifest["package_size_bytes"] == bootstrap_artifact.stat().st_size
        assert "deployment" not in bootstrap_manifest
        assert "source-release" not in bootstrap_manifest["components"]
        assert bool(bootstrap_manifest.get("signature")) == bool(manifest.get("signature"))
        if manifest.get("signature"):
            bootstrap_signature = verify_update_manifest_signature(bootstrap_manifest)
            assert bootstrap_signature == (True, None), bootstrap_signature[1]
        with tarfile.open(bootstrap_artifact, "r:gz") as bootstrap_archive:
            bootstrap_names = {item.name.removeprefix("./") for item in bootstrap_archive.getmembers()}
            assert not any(name == "source-release" or name.startswith("source-release/")
                           for name in bootstrap_names)
            assert not any("/.env" in f"/{name}" or name.startswith(".env")
                           for name in bootstrap_names)
            bootstrap_internal = json.load(bootstrap_archive.extractfile("./manifest.json"))
            bootstrap_plan = json.load(bootstrap_archive.extractfile("./update-plan.json"))
            assert "deployment" not in bootstrap_internal and "deployment" not in bootstrap_plan
            assert bootstrap_internal["artifact"] == bootstrap_manifest["artifact"]
        with tarfile.open(archive_path, "r:gz") as archive:
            names = {item.name.removeprefix("./") for item in archive.getmembers()}
            internal_manifest = json.load(archive.extractfile("./manifest.json"))
            assert "source-release" not in internal_manifest["components"]
            assert {
                "backend/Dockerfile", "frontend/update.Dockerfile", "engine/Dockerfile",
                "backend/app/api/routers/engine_updates.py",
                "backend/app/services/engine_updates.py",
                "engine/engine-launcher.mjs", "engine/release-lifecycle.mjs", "engine/engine-self-update.mjs",
                "automation-worker/Dockerfile", "plugin-runner/Dockerfile",
                "plugin-runner/package.json", "plugin-runner/src/server.mjs",
                "frontend/hash_component_tree.sh", "engine/hash_component_tree.sh",
                "engine/engine-launcher.mjs", "engine/engine-self-update.mjs",
                "automation-worker/hash_component_tree.sh",
                "source-release/VERSION", "source-release/docker-compose.prod.yml",
                "source-release/scripts/atomic_local_update.py",
                "source-release/scripts/install_local_treseko.sh",
                "source-release/scripts/install_local_treseko.ps1",
                "source-release/scripts/install_remote_treseko.sh",
                "source-release/scripts/install_remote_treseko.ps1",
                "source-release/scripts/install_treseko.sh",
                "source-release/scripts/bootstrap_remote_component_from_ota.sh",
                "source-release/scripts/bootstrap_remote_docker_component_from_ota.sh",
                "source-release/scripts/bootstrap_native_worker_restart.sh",
                "source-release/scripts/bootstrap_legacy_native_update.sh",
                "source-release/backend/app/services/update_remote_docker_component_bootstrap.py",
                "source-release/backend/Dockerfile", "source-release/frontend/Dockerfile",
                "source-release/engine/Dockerfile", "source-release/automation-worker/Dockerfile",
                "source-release/engine/engine-launcher.mjs",
                "source-release/engine/release-lifecycle.mjs",
                "source-release/engine/engine-self-update.mjs",
                "source-release/backend/app/api/routers/engine_updates.py",
                "source-release/backend/app/services/engine_updates.py",
                "source-release/plugin-runner/Dockerfile",
                "bootstrap/manifest.json",
            } <= names
            native_worker_unit = archive.extractfile("./source-release/scripts/install_treseko.sh")
            worker_marker = archive.extractfile("./automation-worker/src/update-marker.mjs")
            source_worker_marker = archive.extractfile(
                "./source-release/automation-worker/src/update-marker.mjs"
            )
            assert native_worker_unit is not None and b"Restart=always" in native_worker_unit.read()
            assert worker_marker is not None and b"exit(75)" in worker_marker.read()
            assert source_worker_marker is not None and b"exit(75)" in source_worker_marker.read()
            bundled_bootstrap_manifest = json.load(archive.extractfile("./bootstrap/manifest.json"))
            bundled_bootstrap_name = f"./bootstrap/{bundled_bootstrap_manifest['artifact']}"
            bundled_bootstrap_file = archive.extractfile(bundled_bootstrap_name)
            assert bundled_bootstrap_file is not None
            bundled_bootstrap_bytes = bundled_bootstrap_file.read()
            assert hashlib.sha256(bundled_bootstrap_bytes).hexdigest() == bundled_bootstrap_manifest["checksum_sha256"]
            assert len(bundled_bootstrap_bytes) == bundled_bootstrap_manifest["package_size_bytes"]
            assert bundled_bootstrap_manifest["version"] == manifest["version"]
            assert bool(bundled_bootstrap_manifest.get("signature")) == bool(manifest.get("signature"))
            if manifest.get("signature"):
                bootstrap_signature = verify_update_manifest_signature(bundled_bootstrap_manifest)
                assert bootstrap_signature == (True, None), bootstrap_signature[1]
            assert not any(name.startswith("source-release/") and (
                "/node_modules/" in f"/{name}" or "/.git/" in f"/{name}"
                or ("/.env" in f"/{name}" and name.removeprefix("./") not in {
                    "source-release/.env.production.example",
                    "source-release/automation-worker/.env.example",
                    "source-release/automation-worker/.env.production.example",
                    "source-release/backend/.env.production.example",
                    "source-release/engine/.env.production.example",
                    "source-release/frontend/.env.example",
                })
            ) for name in names)
            assert not any(name.startswith("source-release/public-release/") for name in names)
            assert not any(name.startswith("./source-release/backend/app/static/") for name in names)
            assert_complete_source_matches_release(archive, public_root)
            builds = json.load(archive.extractfile("./runtime-builds.json"))
            assert set(builds["components"]) == {
                "backend", "frontend", "engine", "automation_worker", "plugin_runner"}
            for spec in builds["components"].values():
                recipe = archive.extractfile("./" + spec["dockerfile"]).read().decode()
                for line in recipe.splitlines():
                    if not line.startswith("COPY "):
                        continue
                    sources = [part for part in line.split()[1:-1] if not part.startswith("--from=")]
                    for source in sources:
                        relative = (Path(spec["context"]) / source).as_posix()
                        assert relative in names, f"Public package build input missing: {relative}"
            for component_tree in (
                "backend/app",
                "backend/alembic",
                "engine/src",
                "automation-worker/src",
                "plugin-runner/src",
            ):
                assert_package_tree_matches_source(archive, public_root, component_tree)
            assert archive.extractfile("./update-plan.json") is not None
            plan = json.load(archive.extractfile("./update-plan.json"))
            assert plan["version"] == version
            assert plan["components"] == {
                "backend": "replace",
                "frontend": "replace",
                "engine": "replace",
                "automation_worker": "replace",
                "plugin_runner": "replace",
            }
            if previous_version:
                assert plan["previous_versions"] == [previous_version]
            assert plan["migrations"] is True and plan["rollback"]["enabled"] is True
            assert plan["deployment"] == manifest["deployment"]
            assert plan["host_bridge_bootstrap_verified"] is True
            assert archive.extractfile("./backend/app/expected_schema.json") is not None

        disabled_env = os.environ.copy()
        disabled_env.update({
            "SOURCE_DIR": str(public_root),
            "OUTPUT_ROOT": str(output_root / "without-bootstrap-attestation"),
            "EDITION": "community",
            "CHANNEL": "community-stable",
            "PYTHON_BIN": sys.executable,
            "TRESEKO_UPDATE_SKIP_BUILD": "true",
            "PUBLIC_BASE_URL": "https://updates.example.invalid",
        })
        disabled_env.pop("TRESEKO_COMPLETE_SOURCE_ENABLED", None)
        disabled_env.pop("TRESEKO_BRIDGE_BOOTSTRAP_VERIFIED", None)
        if previous_version:
            disabled_env["PREVIOUS_VERSION"] = previous_version
            disabled_env["FROM_VERSIONS"] = previous_version
        disabled_build = subprocess.run(
            ["bash", "scripts/build_update_package.sh"], cwd=ROOT, env=disabled_env,
            check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if previous_version == "1.0.6":
            assert disabled_build.returncode != 0
            assert "sin bootstrap del bridge" in f"{disabled_build.stdout}\n{disabled_build.stderr}"
            assert not (output_root / "without-bootstrap-attestation" / "packages" / version).exists()
        else:
            assert disabled_build.returncode == 0, disabled_build.stderr
            component_only = output_root / "without-bootstrap-attestation" / "packages" / version
            assert not json.loads((component_only / "manifest.json").read_text()).get("deployment")
        current_dist_version = dist_version_path.read_bytes() if dist_version_path.exists() else None
        assert current_dist_version == dist_version_before, "Package build modified the public frontend dist"


def verify_1_0_7_legacy_source_requires_a_real_host_bootstrap() -> None:
    """Do not build an OTA offer for legacy 1.0.7 without its host migration."""
    public_root = ROOT / "public-release" / "treseko-platform"
    with tempfile.TemporaryDirectory(prefix="treseko-107-complete-source-") as tmp:
        tmp_root = Path(tmp)
        source_copy = tmp_root / "public"
        shutil.copytree(
            public_root,
            source_copy,
            ignore=shutil.ignore_patterns(
                ".git", ".treseko", "public-release", "node_modules",
                "__pycache__", ".pytest_cache", "test-results",
            ),
        )
        (source_copy / "VERSION").write_text("1.0.9\n", encoding="utf-8")
        output_root = tmp_root / "updates"
        env = os.environ.copy()
        env.update({
            "SOURCE_DIR": str(source_copy),
            "TRESEKO_UPDATE_SOURCE_RELEASE_DIR": str(source_copy),
            "VERSION_VALUE": "1.0.9",
            "PREVIOUS_VERSION": "1.0.7",
            "FROM_VERSIONS": "1.0.7",
            "OUTPUT_ROOT": str(output_root),
            "EDITION": "community",
            "CHANNEL": "community-stable",
            "PYTHON_BIN": sys.executable,
            "TRESEKO_UPDATE_SKIP_BUILD": "true",
            "TRESEKO_COMPLETE_SOURCE_ENABLED": "true",
            "TRESEKO_BRIDGE_BOOTSTRAP_VERIFIED": "false",
            "PUBLIC_BASE_URL": "https://updates.example.invalid",
        })
        result = subprocess.run(
            ["bash", "scripts/build_update_package.sh"],
            cwd=ROOT, env=env, check=False, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True,
        )
        assert result.returncode != 0
        assert "adaptadores probados para Linux, macOS y Windows" in f"{result.stdout}\n{result.stderr}"
        assert not (output_root / "packages" / "1.0.9").exists()


def run_checks() -> None:
    builder = (ROOT / "scripts/build_update_package.sh").read_text(encoding="utf-8")
    assert "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm --prefix engine ci" in builder
    assert (
        "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PUPPETEER_SKIP_DOWNLOAD=1 CYPRESS_INSTALL_BINARY=0"
        in builder
    )
    assert "npm --prefix automation-worker ci" in builder
    assert 'TRESEKO_UPDATE_SIGNER_ROOT="${TRESEKO_UPDATE_SIGNER_ROOT:-${BUILDER_ROOT}}"' in builder
    assert 'root = Path("${PWD}")' not in builder
    assert not (ROOT / "public-release/treseko-platform/backend/scripts/premium_signing.py").exists()

    private_key = Ed25519PrivateKey.generate()
    private_raw = private_key.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_raw = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    public_key_b64 = _b64url(public_raw)
    previous_public_key = os.environ.get("TRESEKO_UPDATE_PUBLIC_KEY")
    previous_dev_flag = os.environ.get("TRESEKO_ALLOW_DEV_UPDATE_PUBLIC_KEY")

    os.environ["TRESEKO_UPDATE_PUBLIC_KEY"] = public_key_b64
    os.environ["TRESEKO_ALLOW_DEV_UPDATE_PUBLIC_KEY"] = "1"
    try:
        with tempfile.TemporaryDirectory(prefix="treseko-update-package-") as tmp:
            output_root = Path(tmp) / "updates"
            private_key_file = Path(tmp) / "update-private.key"
            private_key_file.write_text(_b64url(private_raw), encoding="utf-8")
            private_key_file.chmod(0o600)
            env = os.environ.copy()
            env.update(
                {
                    "EDITION": "premium",
                    "CHANNEL": "premium-stable",
                    "SOURCE_DIR": str(ROOT / "public-release" / "treseko-platform"),
                    "OUTPUT_ROOT": str(output_root),
                    "PYTHON_BIN": sys.executable,
                    "TRESEKO_UPDATE_PRIVATE_KEY_FILE": str(private_key_file),
                    "TRESEKO_UPDATE_SIGNER_ROOT": str(ROOT),
                    "TRESEKO_UPDATE_PUBLIC_KEY": public_key_b64,
                    "TRESEKO_ALLOW_DEV_UPDATE_PUBLIC_KEY": "1",
                    "TRESEKO_UPDATE_SKIP_BUILD": "true",
                    "TRESEKO_COMPLETE_SOURCE_ENABLED": "true",
                    "TRESEKO_BRIDGE_BOOTSTRAP_VERIFIED": "true",
                    "TRESEKO_HOST_BOOTSTRAP_PROTOCOL": "treseko-host-update-coordinator/v1",
                    "PREVIOUS_VERSION": "1.0.7",
                    "FROM_VERSIONS": "1.0.7",
                }
            )
            subprocess.run(["bash", "scripts/build_update_package.sh"], cwd=ROOT, env=env, check=True)

            public_root = ROOT / "public-release" / "treseko-platform"
            version = (public_root / "VERSION").read_text(encoding="utf-8").strip()
            package_dir = output_root / "packages" / version
            package_path = package_dir / f"treseko-update-v{version}.tar.gz"
            single_file_bundle = package_dir / f"treseko-update-v{version}-single-file.tar"
            manifest_path = package_dir / "manifest.json"
            channel_path = output_root / "channels" / "premium-stable.json"

            assert package_path.exists(), f"No se genero el paquete: {package_path}"
            assert manifest_path.exists(), f"No se genero el manifest: {manifest_path}"
            assert single_file_bundle.exists(), f"No se genero el bundle unico: {single_file_bundle}"
            assert channel_path.exists(), f"No se genero el indice de canal: {channel_path}"

            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            channel = json.loads(channel_path.read_text(encoding="utf-8"))
            checksum = hashlib.sha256(package_path.read_bytes()).hexdigest()

            with tarfile.open(single_file_bundle, "r:") as bundle:
                members = {member.name: member for member in bundle.getmembers()}
                assert set(members) == {package_path.name, "manifest.json"}
                assert all(member.isfile() for member in members.values())
                bundled_package = bundle.extractfile(package_path.name)
                bundled_manifest = bundle.extractfile("manifest.json")
                assert bundled_package is not None and bundled_package.read() == package_path.read_bytes()
                assert bundled_manifest is not None
                assert json.loads(bundled_manifest.read()) == manifest

            assert manifest["version"] == version
            assert manifest["previous_version"] == "1.0.7"
            assert manifest["from_versions"] == ["1.0.7"]
            assert manifest["edition"] == "premium"
            assert manifest["channel"] == "premium-stable"
            assert manifest["checksum_sha256"] == checksum
            assert manifest["package_size_bytes"] == package_path.stat().st_size
            _, validated_payload = build_payload(
                argparse.Namespace(
                    admin_token_file="",
                    channel="",
                    manifest=str(manifest_path),
                    package=str(package_path),
                    source_release_dir=str(public_root),
                )
            )
            assert base64.b64decode(validated_payload["package_b64"]) == package_path.read_bytes()
            assert manifest["package_url"].startswith("treseko-update://premium-stable/")
            assert "Treseko" in manifest["changelog"]
            assert manifest["migration_revisions"]
            assert manifest["min_schema_revision"] == json.loads((public_root / "backend/app/expected_schema.json").read_text(encoding="utf-8"))["revision"]
            assert manifest["signature"].startswith("ed25519:")
            assert manifest["key_id"].startswith("ed25519:sha256:")
            assert channel["version"] == version
            assert channel["key_id"] == manifest["key_id"]
            assert manifest["deployment"] == {
                "mode": "complete-source", "path": "source-release",
                "compose_file": "docker-compose.prod.yml", "activation": "atomic-compose",
            }
            bootstrap_manifest = json.loads(
                (package_dir / "bootstrap" / "manifest.json").read_text(encoding="utf-8"))
            bootstrap_artifact = package_dir / "bootstrap" / bootstrap_manifest["artifact"]
            assert bootstrap_manifest["checksum_sha256"] != manifest["checksum_sha256"]
            assert bootstrap_manifest["checksum_sha256"] == hashlib.sha256(bootstrap_artifact.read_bytes()).hexdigest()
            assert "deployment" not in bootstrap_manifest
            assert "source-release" not in bootstrap_manifest["components"]
            with tempfile.TemporaryDirectory(prefix="treseko-nested-bootstrap-check-") as nested_temp:
                nested_package, nested_manifest = remote_component_bootstrap._load_component_package(
                    package_path, Path(nested_temp),
                )
                for component in ("engine", "automation-worker"):
                    source, staged_version, build_id = remote_component_bootstrap._stage_source(
                        nested_package, nested_manifest, component, Path(nested_temp) / component,
                    )
                    assert staged_version == version
                    assert len(build_id) == 64
                    assert (source / "VERSION").read_text(encoding="utf-8").strip() == version
            # Validate the generated upgrade as a real 1.0.7 installation.
            # The smoke runs from a 1.0.8 checkout, whose imported runtime
            # version would otherwise correctly reject the 1.0.7 source chain.
            original_product_version = update_manager_module.PRODUCT_VERSION
            update_manager_module.PRODUCT_VERSION = manifest.get("previous_version") or "1.0.7"
            assert validate_update_manifest(bootstrap_manifest, _premium_state())["allowed"] is True
            bootstrap_signature = verify_update_manifest_signature(bootstrap_manifest)
            assert bootstrap_signature == (True, None), bootstrap_signature[1]

            validation = validate_update_manifest(manifest, _premium_state())
            assert validation["allowed"] is True
            assert validation["download_grant_required"] is True
            assert validation["package_url"] is None
            update_manager_module.PRODUCT_VERSION = original_product_version

            inline_key_env = env.copy()
            inline_key_env.pop("TRESEKO_UPDATE_PRIVATE_KEY_FILE", None)
            inline_key_env["TRESEKO_UPDATE_PRIVATE_KEY"] = _b64url(private_raw)
            inline_key_env["OUTPUT_ROOT"] = str(Path(tmp) / "updates-inline-key")
            proc = subprocess.run(
                ["bash", "scripts/build_update_package.sh"],
                cwd=ROOT,
                env=inline_key_env,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            assert proc.returncode != 0
            assert "EDITION=premium requiere TRESEKO_UPDATE_PRIVATE_KEY_FILE" in f"{proc.stdout}\n{proc.stderr}"

            with tarfile.open(package_path, "r:gz") as archive:
                members = archive.getmembers()
                names = set(member.name for member in members)
                installation_mode = archive.extractfile(
                    "./backend/app/services/update_installation_mode.py"
                )
                assert installation_mode is not None
                assert b"def require_atomic_update_coordinator()" in installation_mode.read()
                required_roots = {
                    "./VERSION",
                    "./source-release/VERSION",
                    "./source-release/docker-compose.prod.yml",
                    "./source-release/scripts/atomic_local_update.py",
                    "./source-release/scripts/install_local_treseko.sh",
                    "./source-release/scripts/install_local_treseko.ps1",
                    "./source-release/scripts/install_remote_treseko.sh",
                    "./source-release/scripts/install_remote_treseko.ps1",
                    "./source-release/scripts/install_treseko.sh",
                    "./source-release/scripts/bootstrap_remote_component_from_ota.sh",
                    "./source-release/scripts/bootstrap_remote_docker_component_from_ota.sh",
                    "./source-release/scripts/bootstrap_legacy_native_update.sh",
                    "./source-release/backend/app/services/update_remote_component_bootstrap.py",
                    "./source-release/backend/app/services/update_remote_docker_component_bootstrap.py",
                    "./CHANGELOG.md",
                    "./manifest.json",
                    "./update-plan.json",
                    "./runtime-builds.json",
                    "./backend/Dockerfile",
                    "./backend/alembic.ini",
                    "./backend/app/api/router.py",
                    "./backend/app/api/routers/automation_worker_updates.py",
                    "./backend/app/services/automation_worker_updates.py",
                    "./backend/app/services/update_remote_component_bootstrap.py",
                    "./scripts/bootstrap_remote_component_from_ota.sh",
                    "./scripts/bootstrap_remote_docker_component_from_ota.sh",
                    "./backend/app/services/update_remote_docker_component_bootstrap.py",
                    "./backend/seed_admin.py",
                    "./backend/reset_user_password.py",
                    "./backend/seed_demo_showcase.py",
                    "./frontend/update.Dockerfile",
                    "./frontend/update.Dockerfile.dockerignore",
                    "./frontend/.dockerignore",
                    "./frontend/hash_component_tree.sh",
                    "./engine/hash_component_tree.sh",
                    "./automation-worker/hash_component_tree.sh",
                    "./automation-worker/worker-launcher.mjs",
                    "./automation-worker/src/worker.mjs",
                    "./automation-worker/src/worker-capabilities.mjs",
                    "./automation-worker/src/runner-token-store.mjs",
                    "./automation-worker/src/worker-instance-id.mjs",
                    "./automation-worker/src/worker-self-update.mjs",
                    "./backend/app",
                    "./backend/alembic",
                    "./frontend/dist",
                    "./frontend/nginx.conf",
                    "./engine/package.json",
                    "./automation-worker/package.json",
                    "./plugin-runner/Dockerfile",
                    "./plugin-runner/package.json",
                    "./source-release/.env.production.example",
                    "./source-release/automation-worker/.env.example",
                    "./source-release/automation-worker/.env.production.example",
                    "./source-release/automation-worker/vendor/node-forge/dist/forge.all.min.js",
                    "./source-release/automation-worker/vendor/node-forge/dist/forge.all.min.js.map",
                    "./source-release/automation-worker/vendor/node-forge/dist/forge.min.js",
                    "./source-release/automation-worker/vendor/node-forge/dist/forge.min.js.map",
                    "./source-release/automation-worker/vendor/node-forge/dist/prime.worker.min.js",
                    "./source-release/automation-worker/vendor/node-forge/dist/prime.worker.min.js.map",
                    "./source-release/backend/.env.production.example",
                    "./source-release/engine/.env.production.example",
                    "./source-release/frontend/.env.example",
                    "./plugin-runner/src",
                    "./scripts/update_existing_installation.sh",
                    "./scripts/update_existing_installation_docker.sh",
                    "./scripts/bootstrap_update_helpers_docker.sh",
                    "./scripts/bootstrap_remote_component_from_ota.sh",
                    "./scripts/update-runtime/bootstrap/Dockerfile",
                    "./scripts/update-runtime/bootstrap/helper-modules.txt",
                    "./scripts/systemd/README.md",
                    "./scripts/systemd/treseko-update-spool-wrapper.sh.in",
                    "./scripts/systemd/treseko-update-spool.service.in",
                    "./scripts/systemd/treseko-update-spool.timer.in",
                    "./docs/UPDATE_EXISTING_INSTALLATION.md",
                    "./docs/UPDATE_EXISTING_INSTALLATION_DOCKER.md",
                    "./docs/UPDATE_HELPER_BOOTSTRAP.md",
                    "./docs/UPDATE_HELPER_BOOTSTRAP_IMAGE.md",
                    "./docs/examples/update-installation-controller.example.json",
                }
                missing = sorted(item for item in required_roots if item not in names)
                assert not missing, f"Faltan rutas esperadas en el paquete: {missing}"
                frontend_ignore = archive.extractfile("./frontend/.dockerignore").read().decode()
                assert "dist" in {line.strip() for line in frontend_ignore.splitlines()}
                frontend_update_ignore = archive.extractfile(
                    "./frontend/update.Dockerfile.dockerignore").read().decode()
                assert "dist" not in {line.strip() for line in frontend_update_ignore.splitlines()}
                frontend_dockerfile = archive.extractfile("./frontend/update.Dockerfile").read().decode()
                assert "nginx -t" in frontend_dockerfile
                assert "wget -qO- http://127.0.0.1/" not in frontend_dockerfile
                worker_dockerfile = archive.extractfile("./automation-worker/Dockerfile").read().decode()
                assert '"$(dpkg --print-architecture)" != arm64' in worker_dockerfile
                assert (
                    "COPY src/docker-puppeteer-config.cjs /root/.config/puppeteer/config.cjs"
                    in worker_dockerfile
                )
                assert "./automation-worker/src/docker-puppeteer-config.cjs" in names

                # The Backend publishes remote Engine/Worker updates from the
                # source trees baked into its image. Those trees must be byte
                # for byte the same file inventories that the OTA itself ships;
                # otherwise workers can report 1.0.8 while retaining another
                # build, and Engine/Worker status endpoints offer a different
                # payload from the single-file OTA.
                backend_dockerfile = archive.extractfile("./backend/Dockerfile").read().decode()
                archived_paths = {name.removeprefix("./") for name in names}
                archived_files = {
                    member.name.removeprefix("./") for member in members if member.isfile()
                }

                def copied_component_files(component: str) -> set[str]:
                    destination = f"/opt/treseko/{component}-source/"
                    copied: set[str] = set()
                    for line in backend_dockerfile.splitlines():
                        if not line.lstrip().startswith("COPY "):
                            continue
                        parts = shlex.split(line)
                        if (len(parts) < 3 or parts[0] != "COPY"
                                or not parts[-1].startswith(destination)):
                            continue
                        target_subdirectory = parts[-1][len(destination):].strip("/")
                        for source in parts[1:-1]:
                            source = source.removeprefix("./").rstrip("/")
                            prefix = f"{source}/"
                            if source in archived_files and not any(
                                name.startswith(prefix) for name in archived_files
                            ):
                                relative = source.removeprefix(f"{component}/")
                                copied.add("/".join(part for part in (target_subdirectory, relative.split("/")[-1]) if part))
                            else:
                                copied.update(
                                    "/".join(part for part in (
                                        target_subdirectory, name.removeprefix(prefix)
                                    ) if part)
                                    for name in archived_files
                                    if name.startswith(prefix) and not name.endswith("/")
                                )
                    packaged = {
                        name.removeprefix(f"{component}/")
                        for name in archived_files
                        if name.startswith(f"{component}/")
                    }
                    return copied

                for component in ("engine", "automation-worker"):
                    copied = copied_component_files(component)
                    packaged = {
                        name.removeprefix(f"{component}/")
                        for name in archived_files
                        if name.startswith(f"{component}/")
                    }
                    assert copied == packaged, (
                        f"Backend {component} source inventory differs from the OTA: "
                        f"missing={sorted(packaged - copied)}, extra={sorted(copied - packaged)}"
                    )

                packaged_scripts = {
                    member.name.removeprefix("./")
                    for member in members
                    if member.isfile() and member.name.removeprefix("./").startswith("scripts/")
                }
                assert packaged_scripts == {
                    "scripts/update_existing_installation.sh",
                    "scripts/update_existing_installation_docker.sh",
                    "scripts/bootstrap_update_helpers_docker.sh",
                    "scripts/bootstrap_remote_component_from_ota.sh",
                    "scripts/bootstrap_remote_docker_component_from_ota.sh",
                    "scripts/update-runtime/bootstrap/Dockerfile",
                    "scripts/update-runtime/bootstrap/helper-modules.txt",
                    "scripts/systemd/README.md",
                    "scripts/systemd/treseko-update-spool-wrapper.sh.in",
                    "scripts/systemd/treseko-update-spool.service.in",
                    "scripts/systemd/treseko-update-spool.timer.in",
                }
                packaged_docs = {
                    member.name.removeprefix("./")
                    for member in members
                    if member.isfile() and member.name.removeprefix("./").startswith("docs/")
                }
                assert packaged_docs == {
                    "docs/UPDATE_EXISTING_INSTALLATION.md",
                    "docs/UPDATE_EXISTING_INSTALLATION_DOCKER.md",
                    "docs/UPDATE_HELPER_BOOTSTRAP.md",
                    "docs/UPDATE_HELPER_BOOTSTRAP_IMAGE.md",
                    "docs/ENGINE_REMOTE_UPDATES.md",
                    "docs/AUTOMATION_WORKER_REMOTE_UPDATES.md",
                    "docs/examples/update-installation-controller.example.json",
                }
                bootstrap = archive.extractfile(
                    "./scripts/bootstrap_update_helpers_docker.sh").read().decode()
                assert "image inspect" in bootstrap
                assert "stage_verified_package" not in bootstrap
                remote_bootstrap = archive.extractfile(
                    "./scripts/bootstrap_remote_component_from_ota.sh").read().decode()
                assert "app.services.update_remote_component_bootstrap" in remote_bootstrap
                remote_docker_bootstrap = archive.extractfile(
                    "./scripts/bootstrap_remote_docker_component_from_ota.sh").read().decode()
                assert "app.services.update_remote_docker_component_bootstrap" in remote_docker_bootstrap
                assert "--maintenance-window-confirmed" in archive.extractfile(
                    "./backend/app/services/update_remote_docker_component_bootstrap.py").read().decode()
                worker_entrypoint = archive.extractfile("./automation-worker/entrypoint.sh").read().decode()
                assert "legacy-payload|ota-remote-bootstrap" in worker_entrypoint
                assert "./backend/app/services/update_remote_component_bootstrap.py" in names
                helper_doc = archive.extractfile(
                    "./docs/UPDATE_HELPER_BOOTSTRAP.md").read().decode()
                assert "bootstrap_update_helpers_docker.sh" in helper_doc
                assert "no se publica ni se inventa aquí un digest" in helper_doc
                image_doc = archive.extractfile(
                    "./docs/UPDATE_HELPER_BOOTSTRAP_IMAGE.md").read().decode()
                assert "python:3.12-slim-bookworm" in image_doc
                assert "scripts/build_trusted_update_helper_image.sh" in image_doc
                assert "contexto temporal" in image_doc
                bootstrap_recipe = archive.extractfile(
                    "./scripts/update-runtime/bootstrap/Dockerfile").read().decode()
                bootstrap_allowlist = archive.extractfile(
                    "./scripts/update-runtime/bootstrap/helper-modules.txt").read().decode()
                allowlisted_sources = {
                    line.strip() for line in bootstrap_allowlist.splitlines()
                    if line.strip() and not line.lstrip().startswith("#")
                }
                copied_sources = set()
                for line in bootstrap_recipe.splitlines():
                    if line.startswith("COPY ") and "--from=" not in line:
                        copied_sources.update(line.split()[1:-1])
                assert copied_sources == allowlisted_sources
                assert all("./" + path in names for path in allowlisted_sources)
                builds = json.load(archive.extractfile("./runtime-builds.json"))
                assert set(builds["components"]) == {
                    "backend", "frontend", "engine", "automation_worker", "plugin_runner"}
                # Check COPY inputs against the actual signed package, not the
                # checkout (which used to hide missing Docker build inputs).
                for spec in builds["components"].values():
                    recipe = archive.extractfile("./" + spec["dockerfile"]).read().decode()
                    for line in recipe.splitlines():
                        if not line.startswith("COPY "):
                            continue
                        sources = [item for item in line.split()[1:-1]
                                   if not item.startswith("--from=")]
                        assert all(not item.startswith("--") for item in sources)
                        for source in sources:
                            relative = Path(spec["context"]) / source
                            assert "./" + relative.as_posix() in names, f"Build input missing: {relative}"
                plan_member = archive.extractfile("./update-plan.json")
                assert plan_member is not None, "No se pudo leer update-plan.json"
                plan = json.loads(plan_member.read().decode("utf-8"))
                assert plan["version"] == version
                assert plan["migrations"] is True
                assert plan["rollback"]["enabled"] is True
                changelog_member = archive.extractfile("./CHANGELOG.md")
                assert changelog_member is not None, "No se pudo leer CHANGELOG.md del paquete"
                changelog_text = changelog_member.read().decode("utf-8").strip()
                assert "Treseko" in changelog_text, "CHANGELOG.md del paquete no contiene notas de release"
                for component_path in (
                    "./frontend/dist/version.json",
                    "./engine/package.json",
                    "./engine/package-lock.json",
                    "./automation-worker/package.json",
                    "./automation-worker/package-lock.json",
                ):
                    member = archive.extractfile(component_path)
                    assert member is not None, f"No se pudo leer {component_path}"
                    metadata = json.loads(member.read().decode("utf-8"))
                    assert metadata["version"] == version, f"{component_path} no fue normalizado"
                forbidden_fragments = (
                    "/node_modules/",
                    "/.gitignore",
                    "/.runner-token",
                    "/.worker-instance-id",
                    "/.runner-token.pairing",
                    "/.maintenance",
                    "/.treseko-update-",
                    "/dump.rdb",
                    "/__pycache__/",
                    "/test-results/",
                    ".pyc",
                    ".pyo",
                    ".log",
                    ".jsonl",
                    "/._",
                    "/__MACOSX/",
                    "/static/attachments/",
                    "/static/evidencias/",
                )
                allowed_env_examples = {
                    "./source-release/.env.production.example",
                    "./source-release/automation-worker/.env.example",
                    "./source-release/automation-worker/.env.production.example",
                    "./source-release/backend/.env.production.example",
                    "./source-release/engine/.env.production.example",
                    "./source-release/frontend/.env.example",
                }
                forbidden = sorted(
                    name for name in names
                    if any(fragment in name for fragment in forbidden_fragments)
                    or ("/.env" in name and name not in allowed_env_examples)
                )
                assert not forbidden, f"El paquete contiene residuos locales o secretos: {forbidden[:10]}"
                assert not any(
                    Path(name.removeprefix("./")).name.startswith("._")
                    or "__MACOSX" in Path(name.removeprefix("./")).parts
                    for name in names
                ), "El paquete contiene metadata AppleDouble"
                links = sorted(member.name for member in members if member.issym() or member.islnk())
                assert not links, f"El paquete no debe contener symlinks ni hardlinks: {links[:10]}"
            if os.environ.get("TRESEKO_RUN_DOCKER_UPDATE_TESTS") == "1":
                from test_update_frontend_image import check_frontend_image
                check_frontend_image(package_path, version)
            if os.environ.get("TRESEKO_UPDATE_IMAGE_COMPONENTS"):
                from test_update_runtime_images import check_runtime_images
                components = os.environ["TRESEKO_UPDATE_IMAGE_COMPONENTS"].split(",")
                check_runtime_images(package_path, version, components)
        verify_public_release_package()
        verify_1_0_7_legacy_source_requires_a_real_host_bootstrap()
    finally:
        if previous_public_key is None:
            os.environ.pop("TRESEKO_UPDATE_PUBLIC_KEY", None)
        else:
            os.environ["TRESEKO_UPDATE_PUBLIC_KEY"] = previous_public_key
        if previous_dev_flag is None:
            os.environ.pop("TRESEKO_ALLOW_DEV_UPDATE_PUBLIC_KEY", None)
        else:
            os.environ["TRESEKO_ALLOW_DEV_UPDATE_PUBLIC_KEY"] = previous_dev_flag

    print("Update package pipeline smoke OK")


if __name__ == "__main__":
    run_checks()
