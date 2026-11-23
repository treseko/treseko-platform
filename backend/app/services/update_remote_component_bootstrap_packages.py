"""Package inspection and release staging for remote component bootstraps."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import tarfile
import uuid
from typing import Any

from .edition.update_manager import verify_update_manifest_signature
from .update_participant_package import stage_verified_package


def load_component_package(context: Any, ota: Path, temporary: Path) -> tuple[Path, dict[str, Any]]:
    if ota.is_symlink() or not ota.is_file() or ota.stat().st_size > context._MAX_OUTER_BYTES:
        raise context.RemoteBootstrapError("ota_archive_unsafe")
    try:
        with tarfile.open(ota, "r:gz") as outer:
            members = context._safe_tar_members(
                outer, max_files=context._MAX_FILES, max_bytes=context._MAX_EXPANDED_BYTES,
            )
            by_name = {"/".join(part for part in PurePosixPath(member.name).parts
                                if part not in {"", "."}): member for member in members}
            manifest_member = by_name.get("bootstrap/manifest.json")
            candidates = [member for name, member in by_name.items()
                          if name.startswith("bootstrap/") and name.endswith("-bootstrap.tar.gz")]
            if manifest_member is None or len(candidates) != 1:
                raise context.RemoteBootstrapError("ota_bootstrap_payload_missing_or_ambiguous")
            source = outer.extractfile(manifest_member)
            if source is None or manifest_member.size > 1024 * 1024:
                raise context.RemoteBootstrapError("ota_bootstrap_manifest_invalid")
            manifest = json.loads(source.read().decode("utf-8"))
            if not isinstance(manifest, dict):
                raise context.RemoteBootstrapError("ota_bootstrap_manifest_invalid")
            package_member = candidates[0]
            artifact = str(manifest.get("artifact") or "")
            if (manifest.get("artifact_type") != "tar.gz" or not artifact
                    or PurePosixPath(artifact).name != artifact
                    or package_member.name.removeprefix("./") != f"bootstrap/{artifact}"):
                raise context.RemoteBootstrapError("ota_bootstrap_artifact_mismatch")
            package_path = temporary / "component-bootstrap.tar.gz"
            source = outer.extractfile(package_member)
            if source is None:
                raise context.RemoteBootstrapError("ota_bootstrap_package_missing")
            with source, package_path.open("xb") as output:
                shutil.copyfileobj(source, output)
            if package_path.stat().st_size != manifest.get("package_size_bytes"):
                raise context.RemoteBootstrapError("ota_bootstrap_size_mismatch")
            if hashlib.sha256(package_path.read_bytes()).hexdigest() != manifest.get("checksum_sha256"):
                raise context.RemoteBootstrapError("ota_bootstrap_checksum_mismatch")
            valid, error = verify_update_manifest_signature(manifest)
            if not valid:
                code = "ota_bootstrap_signature_invalid" if error else "ota_bootstrap_signature_missing"
                raise context.RemoteBootstrapError(code)
            return package_path, manifest
    except context.RemoteBootstrapError:
        raise
    except (OSError, tarfile.TarError, json.JSONDecodeError, UnicodeError) as exc:
        raise context.RemoteBootstrapError("ota_archive_invalid") from exc


def stage_source(context: Any, archive: Path, manifest: dict[str, Any], component: str,
                 temporary: Path) -> tuple[Path, str, str]:
    components = manifest.get("components")
    manifest_name = "automation-worker" if component == "automation-worker" else component
    if not isinstance(components, dict) or components.get(manifest_name) is not True:
        raise context.RemoteBootstrapError("component_not_declared_in_signed_manifest")
    staged = stage_verified_package(archive, manifest, temporary / "verified")
    spec = context._COMPONENTS[component]
    source = staged / spec["package_path"]
    for relative in context._REQUIRED_SOURCE[component]:
        item = source / relative
        if item.is_symlink() or not item.is_file():
            raise context.RemoteBootstrapError("component_payload_incomplete")
    package = json.loads((source / "package.json").read_text(encoding="utf-8"))
    lock = json.loads((source / "package-lock.json").read_text(encoding="utf-8"))
    version = str(manifest.get("version") or "")
    if (not spec["version_re"].fullmatch(version) or package.get("version") != version
            or (source / "VERSION").read_text(encoding="utf-8").strip() != version
            or lock.get("version") != version
            or lock.get("packages", {}).get("", {}).get("version") != version):
        raise context.RemoteBootstrapError("component_payload_version_mismatch")
    return source, version, context._component_build_id(source, component)


def copy_release(context: Any, source: Path, release: Path, component: str, version: str,
                 build_id: str, owner_uid: int, owner_gid: int, env: dict[str, str], *,
                 install_dependencies: bool = True, install_browsers: bool = True) -> None:
    if release.exists():
        if (release.is_symlink() or not release.is_dir()
                or context._component_build_id(release, component) != build_id):
            raise context.RemoteBootstrapError("component_release_conflict")
        return
    stage = release.parent / f".stage-{uuid.uuid4().hex}"
    stage.mkdir(mode=0o700)
    try:
        for current, dirs, files in os.walk(source, followlinks=False):
            current_path = Path(current)
            relative = current_path.relative_to(source)
            excluded = {"node_modules", ".git", ".cache", ".state", ".pytest_cache",
                        "coverage", "logs", "reports", "test-results"}
            dirs[:] = sorted(name for name in dirs if name not in excluded)
            destination_dir = stage / relative
            destination_dir.mkdir(parents=True, exist_ok=True)
            for name in files:
                item = current_path / name
                if name == ".env" or name.startswith(".env.") or item.is_symlink() or not item.is_file():
                    continue
                shutil.copy2(item, destination_dir / name, follow_symlinks=False)
        if context._component_build_id(stage, component) != build_id:
            raise context.RemoteBootstrapError("component_stage_hash_mismatch")
        install_env = dict(env)
        install_env.update({"PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1", "CYPRESS_INSTALL_BINARY": "0",
                            "PUPPETEER_SKIP_DOWNLOAD": "1"})
        for current, dirs, files in os.walk(stage):
            os.chown(current, owner_uid, owner_gid)
            for name in files:
                os.chown(Path(current) / name, owner_uid, owner_gid)
        npm = shutil.which("npm")
        if install_dependencies:
            if not npm:
                raise context.RemoteBootstrapError("npm_unavailable")
            context._run_as_service_user([npm, "ci"], cwd=stage, timeout=20 * 60,
                                         env=install_env, uid=owner_uid)
        if component == "engine" and install_browsers:
            if not npm:
                raise context.RemoteBootstrapError("npm_unavailable")
            browser_env = dict(install_env)
            browser_path = install_env.get("PLAYWRIGHT_BROWSERS_PATH")
            if browser_path:
                browser_env["PLAYWRIGHT_BROWSERS_PATH"] = browser_path
            context._run_as_service_user([npm, "exec", "--", "playwright", "install", "chromium"],
                                         cwd=stage, timeout=25 * 60, env=browser_env, uid=owner_uid)
        (stage / ".treseko-content-digest").write_text(f"{build_id}\n", encoding="utf-8")
        (stage / ".treseko-runtime-manifest.json").write_text(
            json.dumps({"source": "ota-remote-bootstrap", "version": version}, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        for current, dirs, files in os.walk(stage):
            os.chown(current, owner_uid, owner_gid)
            for name in files:
                os.chown(Path(current) / name, owner_uid, owner_gid)
        os.rename(stage, release)
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise
