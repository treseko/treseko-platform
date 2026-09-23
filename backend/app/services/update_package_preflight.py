"""Static integrity checks for update packages before any runtime mutation."""

from __future__ import annotations

import argparse
import ast
from pathlib import Path


class UpdatePackagePreflightError(ValueError):
    """Raised when a package is incomplete or internally inconsistent."""


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
