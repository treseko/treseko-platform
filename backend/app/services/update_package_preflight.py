"""Static integrity checks for update packages before any runtime mutation."""

from __future__ import annotations

import argparse
import ast
import json
import re
import shlex
from pathlib import Path


class UpdatePackagePreflightError(ValueError):
    """Raised when a package is incomplete or internally inconsistent."""


def _docker_copy_inventory(dockerfile: Path, context_root: Path, component: str) -> set[str]:
    """Resolve files copied into a Backend image's remote-update source tree."""
    destination = f"/opt/treseko/{component}-source/"
    inventory: set[str] = set()
    for line in dockerfile.read_text(encoding="utf-8").splitlines():
        if not line.lstrip().startswith("COPY "):
            continue
        try:
            parts = shlex.split(line)
        except ValueError as exc:
            raise UpdatePackagePreflightError("Backend Dockerfile contiene una instruccion COPY invalida") from exc
        if (len(parts) < 3 or parts[0] != "COPY"
                or not parts[-1].startswith(destination)):
            continue
        target_subdirectory = parts[-1][len(destination):].strip("/")
        for source in parts[1:-1]:
            source_path = (context_root / source.removeprefix("./")).resolve()
            try:
                source_path.relative_to(context_root.resolve())
            except ValueError as exc:
                raise UpdatePackagePreflightError("Backend Dockerfile copia fuente fuera del paquete") from exc
            if source_path.is_file():
                inventory.add("/".join(part for part in (target_subdirectory, source_path.name) if part))
            elif source_path.is_dir() and not source_path.is_symlink():
                inventory.update(
                    "/".join(part for part in (
                        target_subdirectory, item.relative_to(source_path).as_posix()
                    ) if part)
                    for item in source_path.rglob("*")
                    if item.is_file() and not item.is_symlink()
                )
    return inventory


def _validate_remote_update_source_inventories(
    package_root: Path, *, context_root: Path | None = None, dockerfile: Path | None = None
) -> None:
    context_root = context_root or package_root
    dockerfile = dockerfile or context_root / "backend" / "Dockerfile"
    if not dockerfile.is_file():
        raise UpdatePackagePreflightError("Backend Dockerfile ausente para fuentes de actualizacion remota")
    for component in ("engine", "automation-worker"):
        root = package_root / component
        expected = {
            item.relative_to(root).as_posix()
            for item in root.rglob("*")
            if item.is_file() and not item.is_symlink()
        }
        copied = _docker_copy_inventory(dockerfile, context_root, component)
        if copied != expected:
            missing = sorted(expected - copied)
            extra = sorted(copied - expected)
            raise UpdatePackagePreflightError(
                f"Backend no incluye la fuente {component} exacta del OTA unificado "
                f"(faltan={missing[:8]}, sobran={extra[:8]})"
            )


def _module_index(app_root: Path) -> set[str]:
    modules: set[str] = set()
    for path in app_root.rglob("*.py"):
        relative = path.relative_to(app_root).with_suffix("")
        parts = list(relative.parts)
        if parts[-1] == "__init__":
            parts.pop()
        modules.add(".".join(["app", *parts]))
    return modules


def _resolve_relative_import(module_name: str, level: int, imported: str | None) -> str:
    package = module_name.split(".")[:-1]
    if level > len(package) + 1:
        return ""
    base = package[: len(package) - level + 1]
    return ".".join([*base, *(imported.split(".") if imported else [])])


def _check_relative_imports(app_root: Path, modules: set[str]) -> None:
    for path in sorted(app_root.rglob("*.py")):
        relative = path.relative_to(app_root).with_suffix("")
        parts = list(relative.parts)
        if parts[-1] == "__init__":
            parts.pop()
        module_name = ".".join(["app", *parts])
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except (OSError, SyntaxError, UnicodeError) as exc:
            raise UpdatePackagePreflightError(f"Python invalido: {path.relative_to(app_root.parent)}") from exc
        for node in ast.walk(tree):
            if not isinstance(node, ast.ImportFrom) or node.level <= 0:
                continue
            target = _resolve_relative_import(module_name, node.level, node.module)
            if target and target not in modules and node.module:
                raise UpdatePackagePreflightError(f"Import relativo faltante: {module_name} -> {target}")


def _check_migrations(app_root: Path) -> None:
    versions_root = app_root / "alembic" / "versions"
    revisions: set[str] = set()
    parents: list[tuple[str, Path]] = []
    for path in sorted(versions_root.glob("*.py")):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except (OSError, SyntaxError, UnicodeError) as exc:
            raise UpdatePackagePreflightError(f"Migracion invalida: {path.name}") from exc
        values: dict[str, object] = {}
        for node in tree.body:
            if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant):
                for target in node.targets:
                    if isinstance(target, ast.Name) and target.id in {"revision", "down_revision"}:
                        values[target.id] = node.value.value
        revision = values.get("revision")
        if not isinstance(revision, str) or not revision:
            raise UpdatePackagePreflightError(f"Migracion sin revision: {path.name}")
        revisions.add(revision)
        down_revision = values.get("down_revision")
        if isinstance(down_revision, str) and down_revision:
            parents.append((down_revision, path))
        elif isinstance(down_revision, (tuple, list)):
            parents.extend((parent, path) for parent in down_revision if isinstance(parent, str) and parent)
    for parent, path in parents:
        if parent not in revisions:
            raise UpdatePackagePreflightError(f"Migracion {path.name} referencia revision ausente: {parent}")


def validate_update_package(root: Path) -> None:
    package_root = root.resolve()
    backend_root = package_root / "backend"
    app_root = backend_root / "app"
    required = (
        package_root / "VERSION",
        backend_root / "entrypoint.sh",
        backend_root / "alembic" / "versions",
        app_root / "api" / "routers" / "report_rendering.py",
        app_root / "api" / "routers" / "report_rendering_html.py",
        app_root / "api" / "routers" / "report_rendering_sections.py",
    )
    missing = [str(path.relative_to(package_root)) for path in required if not path.exists()]
    if missing:
        raise UpdatePackagePreflightError("Archivos requeridos ausentes: " + ", ".join(missing))
    version = (package_root / "VERSION").read_text(encoding="utf-8").strip()
    match = re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?", version)
    if not match:
        raise UpdatePackagePreflightError("VERSION del paquete invalida")
    if tuple(int(value) for value in match.groups()) >= (1, 0, 8):
        worker_update_required = (
            package_root / "automation-worker" / "VERSION",
            package_root / "automation-worker" / "package.json",
            package_root / "automation-worker" / "package-lock.json",
            package_root / "automation-worker" / "worker-launcher.mjs",
            package_root / "automation-worker" / "src" / "worker.mjs",
            package_root / "automation-worker" / "src" / "worker-capabilities.mjs",
            package_root / "automation-worker" / "src" / "runner-token-store.mjs",
            package_root / "automation-worker" / "src" / "worker-instance-id.mjs",
            package_root / "automation-worker" / "src" / "worker-self-update.mjs",
            app_root / "api" / "router.py",
            app_root / "api" / "routers" / "automation_worker_updates.py",
            app_root / "services" / "automation_worker_updates.py",
        )
        missing_worker_update = [
            str(path.relative_to(package_root)) for path in worker_update_required if not path.is_file()
        ]
        router_source = (app_root / "api" / "router.py").read_text(encoding="utf-8")
        if "automation_worker_updates" not in router_source or "api_router.include_router(automation_worker_updates.router)" not in router_source:
            missing_worker_update.append("backend/app/api/router.py: automation_worker_updates router wiring")
        if missing_worker_update:
            raise UpdatePackagePreflightError(
                "Worker auto-update incompleto para VERSION >= 1.0.8: " + ", ".join(missing_worker_update)
            )
        try:
            worker_metadata = json.loads(
                (package_root / "automation-worker" / "package.json").read_text(encoding="utf-8")
            )
            worker_lock = json.loads(
                (package_root / "automation-worker" / "package-lock.json").read_text(encoding="utf-8")
            )
            worker_version = (package_root / "automation-worker" / "VERSION").read_text(encoding="utf-8").strip()
        except (OSError, ValueError) as exc:
            raise UpdatePackagePreflightError("Metadatos de version del Worker invalidos") from exc
        if (worker_metadata.get("version") != version or worker_version != version
                or worker_lock.get("version") != version
                or worker_lock.get("packages", {}).get("", {}).get("version") != version
                or worker_metadata.get("scripts", {}).get("start") != "node worker-launcher.mjs"):
            raise UpdatePackagePreflightError(
                "Worker debe coincidir con el paquete e iniciar mediante worker-launcher.mjs"
            )
        engine_update_required = (
            package_root / "engine" / "VERSION",
            package_root / "engine" / "package.json",
            package_root / "engine" / "package-lock.json",
            package_root / "engine" / "engine-launcher.mjs",
            package_root / "engine" / "release-lifecycle.mjs",
            package_root / "engine" / "engine-self-update.mjs",
            package_root / "engine" / "engine-self-update.d.mts",
            package_root / "engine" / "src" / "engine-update-runtime.ts",
            app_root / "api" / "routers" / "engine_updates.py",
            app_root / "services" / "engine_updates.py",
        )
        missing_engine_update = [
            str(path.relative_to(package_root)) for path in engine_update_required if not path.is_file()
        ]
        router_source = (app_root / "api" / "router.py").read_text(encoding="utf-8")
        if "engine_updates" not in router_source or "api_router.include_router(engine_updates.router)" not in router_source:
            missing_engine_update.append("backend/app/api/router.py: engine_updates router wiring")
        if missing_engine_update:
            raise UpdatePackagePreflightError(
                "Engine auto-update incompleto para VERSION >= 1.0.8: " + ", ".join(missing_engine_update)
            )
        try:
            engine_metadata = json.loads((package_root / "engine" / "package.json").read_text(encoding="utf-8"))
            engine_lock = json.loads((package_root / "engine" / "package-lock.json").read_text(encoding="utf-8"))
            engine_version = (package_root / "engine" / "VERSION").read_text(encoding="utf-8").strip()
        except (OSError, ValueError) as exc:
            raise UpdatePackagePreflightError("Metadatos de Engine invalidos") from exc
        if (engine_metadata.get("version") != version or engine_version != version
                or engine_lock.get("version") != version
                or engine_lock.get("packages", {}).get("", {}).get("version") != version
                or engine_metadata.get("scripts", {}).get("start") != "node engine-launcher.mjs"):
            raise UpdatePackagePreflightError("Engine debe coincidir con el paquete e iniciar mediante engine-launcher.mjs")
        try:
            plugin_metadata = json.loads(
                (package_root / "plugin-runner" / "package.json").read_text(encoding="utf-8")
            )
        except (OSError, ValueError) as exc:
            raise UpdatePackagePreflightError("Metadatos de version del Plugin Runner invalidos") from exc
        if plugin_metadata.get("version") != version:
            raise UpdatePackagePreflightError("Plugin Runner debe coincidir con la version del OTA")
        engine_server = package_root / "engine" / "src" / "server.ts"
        engine_runtime = package_root / "engine" / "src" / "engine-update-runtime.ts"
        if (not engine_server.is_file() or "engine-update-runtime" not in engine_server.read_text(encoding="utf-8")
                or "engine-self-update.mjs" not in engine_runtime.read_text(encoding="utf-8")):
            raise UpdatePackagePreflightError("Engine no inicia su cliente de autoactualizacion")
        _validate_remote_update_source_inventories(package_root)
        source_release = package_root / "source-release"
        if source_release.exists():
            source_required = (
                source_release / "VERSION",
                source_release / "backend" / "Dockerfile",
                source_release / "automation-worker" / "VERSION",
                source_release / "automation-worker" / "package.json",
                source_release / "automation-worker" / "package-lock.json",
                source_release / "engine" / "VERSION",
                source_release / "engine" / "package.json",
                source_release / "engine" / "package-lock.json",
                source_release / "engine" / "engine-launcher.mjs",
                source_release / "engine" / "engine-self-update.mjs",
                source_release / "engine" / "engine-self-update.d.mts",
                source_release / "engine" / "src" / "engine-update-runtime.ts",
                source_release / "automation-worker" / "worker-launcher.mjs",
                source_release / "automation-worker" / "src" / "worker-self-update.mjs",
                source_release / "automation-worker" / "src" / "worker-instance-id.mjs",
                source_release / "automation-worker" / "src" / "runner-token-store.mjs",
                source_release / "backend" / "app" / "services" / "update_remote_component_bootstrap.py",
                source_release / "scripts" / "bootstrap_remote_component_from_ota.sh",
                source_release / "scripts" / "bootstrap_legacy_native_update.sh",
                source_release / "plugin-runner" / "Dockerfile",
                source_release / "plugin-runner" / "package.json",
            )
            missing_source = [
                str(path.relative_to(package_root)) for path in source_required if not path.is_file()
            ]
            source_version = (source_release / "VERSION").read_text(encoding="utf-8").strip()
            source_backend_dockerfile = source_release / "backend" / "Dockerfile"
            if source_version != version:
                raise UpdatePackagePreflightError("source-release debe tener la misma VERSION que el OTA")
            try:
                _validate_remote_update_source_inventories(
                    package_root,
                    context_root=source_release,
                    dockerfile=source_backend_dockerfile,
                )
            except UpdatePackagePreflightError as exc:
                missing_source.append(str(exc))
            if not missing_source:
                try:
                    source_engine_metadata = json.loads(
                        (source_release / "engine" / "package.json").read_text(encoding="utf-8")
                    )
                    source_engine_lock = json.loads(
                        (source_release / "engine" / "package-lock.json").read_text(encoding="utf-8")
                    )
                    source_engine_version = (
                        source_release / "engine" / "VERSION"
                    ).read_text(encoding="utf-8").strip()
                    source_worker_metadata = json.loads(
                        (source_release / "automation-worker" / "package.json").read_text(encoding="utf-8")
                    )
                    source_worker_lock = json.loads(
                        (source_release / "automation-worker" / "package-lock.json").read_text(encoding="utf-8")
                    )
                    source_worker_version = (
                        source_release / "automation-worker" / "VERSION"
                    ).read_text(encoding="utf-8").strip()
                    source_plugin_metadata = json.loads(
                        (source_release / "plugin-runner" / "package.json").read_text(encoding="utf-8")
                    )
                except (OSError, ValueError) as exc:
                    raise UpdatePackagePreflightError(
                        "Metadatos de version de componentes en source-release invalidos"
                    ) from exc
                if (source_engine_metadata.get("version") != version or source_engine_version != version
                        or source_engine_lock.get("version") != version
                        or source_engine_lock.get("packages", {}).get("", {}).get("version") != version
                        or source_engine_metadata.get("scripts", {}).get("start") != "node engine-launcher.mjs"):
                    raise UpdatePackagePreflightError(
                        "Engine de source-release debe coincidir con el OTA e iniciar mediante engine-launcher.mjs"
                    )
                if (source_worker_metadata.get("version") != version or source_worker_version != version
                        or source_worker_lock.get("version") != version
                        or source_worker_lock.get("packages", {}).get("", {}).get("version") != version
                        or source_worker_metadata.get("scripts", {}).get("start") != "node worker-launcher.mjs"):
                    raise UpdatePackagePreflightError(
                        "Worker de source-release debe coincidir con el OTA e iniciar mediante worker-launcher.mjs"
                    )
                if source_plugin_metadata.get("version") != version:
                    raise UpdatePackagePreflightError("Plugin Runner de source-release debe coincidir con el OTA")
            if missing_source:
                raise UpdatePackagePreflightError(
                    "source-release incompleto para actualizar todos los componentes: " + ", ".join(missing_source)
                )
    modules = _module_index(app_root)
    _check_relative_imports(app_root, modules)
    _check_migrations(backend_root)


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate Treseko update package contents")
    parser.add_argument("--root", required=True, type=Path)
    args = parser.parse_args()
    validate_update_package(args.root)
    print("Update package preflight OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
