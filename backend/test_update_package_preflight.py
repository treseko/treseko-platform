import shutil

import pytest

from app.services.update_package_preflight import (
    UpdatePackagePreflightError,
    validate_update_package,
)


def _make_package(root, version: str, *, include_worker_update: bool) -> None:
    (root / "VERSION").write_text(f"{version}\n", encoding="utf-8")
    (root / "backend" / "entrypoint.sh").parent.mkdir(parents=True)
    (root / "backend" / "entrypoint.sh").write_text("#!/bin/sh\n", encoding="utf-8")
    (root / "backend" / "Dockerfile").write_text("", encoding="utf-8")
    (root / "backend" / "alembic" / "versions").mkdir(parents=True)
    app = root / "backend" / "app"
    for name in (
        "api/__init__.py",
        "api/routers/__init__.py",
        "api/routers/report_rendering.py",
        "api/routers/report_rendering_html.py",
        "api/routers/report_rendering_sections.py",
    ):
        path = app / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("", encoding="utf-8")

    if include_worker_update:
        for name in (
            "automation-worker/worker-launcher.mjs",
            "automation-worker/src/worker.mjs",
            "automation-worker/src/worker-capabilities.mjs",
            "automation-worker/src/runner-token-store.mjs",
            "automation-worker/src/worker-instance-id.mjs",
            "automation-worker/src/worker-self-update.mjs",
            "backend/app/api/routers/automation_worker_updates.py",
            "backend/app/services/automation_worker_updates.py",
        ):
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("", encoding="utf-8")
        worker_package = root / "automation-worker" / "package.json"
        worker_package.write_text(
            '{"version":"1.0.8","scripts":{"start":"node worker-launcher.mjs"}}\n', encoding="utf-8"
        )
        worker_lock = root / "automation-worker" / "package-lock.json"
        worker_lock.write_text(
            '{"version":"1.0.8","packages":{"":{"version":"1.0.8"}}}\n', encoding="utf-8"
        )
        (root / "automation-worker" / "VERSION").write_text("1.0.8\n", encoding="utf-8")
        router = app / "api" / "router.py"
        router.write_text(
            "from .routers import automation_worker_updates\n"
            "api_router.include_router(automation_worker_updates.router)\n",
            encoding="utf-8",
        )

        (root / "backend" / "Dockerfile").write_text(
            "COPY engine/ /opt/treseko/engine-source/\n"
            "COPY automation-worker/ /opt/treseko/automation-worker-source/\n",
            encoding="utf-8",
        )

        for name in (
            "engine/VERSION", "engine/package.json", "engine/package-lock.json",
            "engine/engine-launcher.mjs", "engine/engine-self-update.mjs",
            "engine/release-lifecycle.mjs",
            "engine/src/engine-update-runtime.ts",
            "backend/app/api/routers/engine_updates.py", "backend/app/services/engine_updates.py",
        ):
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("1.0.8\n" if name.endswith("/VERSION") else "{}\n", encoding="utf-8")
        engine_package = root / "engine" / "package.json"
        engine_package.write_text(
            '{"version":"1.0.8","scripts":{"start":"node engine-launcher.mjs"}}\n', encoding="utf-8"
        )
        (root / "engine" / "engine-self-update.d.mts").write_text("export {};\n", encoding="utf-8")
        engine_lock = root / "engine" / "package-lock.json"
        engine_lock.write_text(
            '{"version":"1.0.8","packages":{"":{"version":"1.0.8"}}}\n', encoding="utf-8"
        )
        (root / "engine" / "src" / "server.ts").parent.mkdir(parents=True, exist_ok=True)
        (root / "engine" / "src" / "server.ts").write_text(
            'import "./engine-update-runtime.ts";\n', encoding="utf-8"
        )
        (root / "engine" / "src" / "engine-update-runtime.ts").write_text(
            'import "../engine-self-update.mjs";\n', encoding="utf-8"
        )
        (root / "plugin-runner" / "package.json").parent.mkdir(parents=True, exist_ok=True)
        (root / "plugin-runner" / "package.json").write_text('{"version":"1.0.8"}\n', encoding="utf-8")
        router.write_text(
            "from .routers import automation_worker_updates, engine_updates\n"
            "api_router.include_router(automation_worker_updates.router)\n"
            "api_router.include_router(engine_updates.router)\n",
            encoding="utf-8",
        )


def _add_complete_source(root, version: str, *, include_agent_updaters: bool = True) -> None:
    source = root / "source-release"
    (source / "VERSION").parent.mkdir(parents=True)
    (source / "VERSION").write_text(f"{version}\n", encoding="utf-8")
    (source / "backend" / "Dockerfile").parent.mkdir(parents=True)
    (source / "backend" / "Dockerfile").write_text(
        "COPY engine/ /opt/treseko/engine-source/\n"
        "COPY automation-worker/ /opt/treseko/automation-worker-source/\n",
        encoding="utf-8",
    )
    paths = [
        "automation-worker/VERSION",
        "automation-worker/package.json",
        "automation-worker/package-lock.json",
        "engine/engine-launcher.mjs",
        "engine/release-lifecycle.mjs",
        "engine/engine-self-update.mjs",
        "engine/engine-self-update.d.mts",
        "engine/src/engine-update-runtime.ts",
        "engine/VERSION",
        "engine/package.json",
        "engine/package-lock.json",
        "automation-worker/worker-launcher.mjs",
        "automation-worker/src/worker-self-update.mjs",
        "automation-worker/src/worker-instance-id.mjs",
        "automation-worker/src/runner-token-store.mjs",
        "backend/app/services/update_remote_component_bootstrap.py",
        "scripts/bootstrap_remote_component_from_ota.sh",
        "scripts/bootstrap_legacy_native_update.sh",
        "plugin-runner/Dockerfile",
        "plugin-runner/package.json",
    ]
    if not include_agent_updaters:
        paths.remove("automation-worker/src/worker-self-update.mjs")
    for relative in paths:
        path = source / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        if relative.endswith("/package.json"):
            if relative.startswith("engine/"):
                path.write_text(
                    '{"version":"1.0.8","scripts":{"start":"node engine-launcher.mjs"}}\n', encoding="utf-8"
                )
            elif relative.startswith("automation-worker/"):
                path.write_text(
                    '{"version":"1.0.8","scripts":{"start":"node worker-launcher.mjs"}}\n', encoding="utf-8"
                )
            else:
                path.write_text('{"version":"1.0.8"}\n', encoding="utf-8")
        elif relative.endswith("/package-lock.json"):
            path.write_text(
                '{"version":"1.0.8","packages":{"":{"version":"1.0.8"}}}\n', encoding="utf-8"
            )
        elif relative.endswith("/VERSION"):
            path.write_text("1.0.8\n", encoding="utf-8")
        else:
            path.write_text("source\n", encoding="utf-8")

    for component in ("engine", "automation-worker"):
        source_component = source / component
        if source_component.exists():
            shutil.rmtree(source_component)
        shutil.copytree(root / component, source_component)
    if not include_agent_updaters:
        (source / "automation-worker/src/worker-self-update.mjs").unlink()


def test_108_package_requires_worker_update_client_and_backend_endpoint(tmp_path):
    _make_package(tmp_path, "1.0.8", include_worker_update=True)

    validate_update_package(tmp_path)


def test_108_package_rejects_missing_worker_launcher(tmp_path):
    _make_package(tmp_path, "1.0.8", include_worker_update=True)
    (tmp_path / "automation-worker" / "worker-launcher.mjs").unlink()

    with pytest.raises(UpdatePackagePreflightError, match="Worker auto-update incompleto"):
        validate_update_package(tmp_path)


def test_108_package_rejects_missing_persistent_worker_identity_module(tmp_path):
    _make_package(tmp_path, "1.0.8", include_worker_update=True)
    (tmp_path / "automation-worker" / "src" / "worker-instance-id.mjs").unlink()

    with pytest.raises(UpdatePackagePreflightError, match="worker-instance-id.mjs"):
        validate_update_package(tmp_path)


def test_108_package_rejects_worker_package_that_bypasses_persistent_launcher(tmp_path):
    _make_package(tmp_path, "1.0.8", include_worker_update=True)
    worker_package = tmp_path / "automation-worker" / "package.json"
    worker_package.write_text(
        '{"version":"1.0.8","scripts":{"start":"node src/worker.mjs"}}\n', encoding="utf-8"
    )

    with pytest.raises(UpdatePackagePreflightError, match="Worker debe coincidir.*worker-launcher"):
        validate_update_package(tmp_path)


def test_108_package_rejects_missing_engine_self_update_agent(tmp_path):
    _make_package(tmp_path, "1.0.8", include_worker_update=True)
    (tmp_path / "engine" / "engine-self-update.mjs").unlink()

    with pytest.raises(UpdatePackagePreflightError, match="Engine auto-update incompleto"):
        validate_update_package(tmp_path)


def test_107_package_does_not_require_the_108_worker_update_client(tmp_path):
    _make_package(tmp_path, "1.0.7", include_worker_update=False)

    validate_update_package(tmp_path)


def test_108_complete_source_requires_all_component_bootstrap_files(tmp_path):
    _make_package(tmp_path, "1.0.8", include_worker_update=True)
    _add_complete_source(tmp_path, "1.0.8", include_agent_updaters=False)

    with pytest.raises(UpdatePackagePreflightError, match="source-release incompleto.*worker-self-update"):
        validate_update_package(tmp_path)


def test_108_complete_source_with_all_component_runtimes_passes(tmp_path):
    _make_package(tmp_path, "1.0.8", include_worker_update=True)
    _add_complete_source(tmp_path, "1.0.8")

    validate_update_package(tmp_path)


def test_108_complete_source_rejects_component_version_mismatch(tmp_path):
    _make_package(tmp_path, "1.0.8", include_worker_update=True)
    _add_complete_source(tmp_path, "1.0.7")

    with pytest.raises(UpdatePackagePreflightError, match="source-release debe tener la misma VERSION"):
        validate_update_package(tmp_path)


def test_invalid_package_version_is_rejected(tmp_path):
    _make_package(tmp_path, "current", include_worker_update=False)

    with pytest.raises(UpdatePackagePreflightError, match="VERSION del paquete invalida"):
        validate_update_package(tmp_path)
