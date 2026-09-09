#!/usr/bin/env python3
"""Build/version/validate the standalone Treseko GUI artifacts.

Builds are intentionally native: each target must run on its matching host
platform. The macOS output is an architecture-specific application bundle.
"""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import plistlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "installer"
VERSION_RE = r"^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$"


def version() -> str:
    import re

    value = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    if not re.fullmatch(VERSION_RE, value):
        raise SystemExit(f"VERSION inválida: {value!r}")
    return value


def artifact_name(target: str, value: str) -> str:
    if target == "windows":
        suffix = "windows-x64.exe"
    elif target == "linux":
        suffix = "linux-x64.AppImage"
    else:
        suffix = f"macos-{macos_architecture()}.app"
    return f"Treseko-Installer-v{value}-{suffix}"


def require_files() -> None:
    required = [
        ROOT / "VERSION",
        INSTALLER / "treseko_installer.py",
        INSTALLER / "treseko-installer.png",
        INSTALLER / "treseko_installer_windows.spec",
        INSTALLER / "treseko_installer_linux.spec",
        INSTALLER / "treseko_installer_macos.spec",
    ]
    missing = [str(path.relative_to(ROOT)) for path in required if not path.is_file() or path.is_symlink()]
    if missing:
        raise SystemExit("Faltan archivos del instalador: " + ", ".join(missing))


def native_target(target: str) -> bool:
    system = platform.system()
    return (
        (target == "windows" and system == "Windows")
        or (target == "linux" and system == "Linux")
        or (target == "macos" and system == "Darwin")
    )


def macos_architecture() -> str:
    machine = platform.machine().lower()
    if machine in {"arm64", "aarch64"}:
        return "arm64"
    if machine in {"x86_64", "amd64"}:
        return "x64"
    raise SystemExit(f"Arquitectura macOS no soportada: {platform.machine()!r}; se requiere arm64 o x64.")


def write_windows_version_info(path: Path, value: str) -> None:
    # PyInstaller consumes this standard VERSIONINFO resource on Windows.
    base_version = value.split("-", 1)[0].split("+", 1)[0]
    version_tuple = base_version.replace(".", ", ") + ", 0"
    path.write_text(
        f'''VSVersionInfo(\n  ffi=FixedFileInfo(filevers=({version_tuple}), prodvers=({version_tuple}), mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),\n  kids=[StringFileInfo([StringTable(\'040904B0\',[StringStruct(\'CompanyName\', \'Treseko\'), StringStruct(\'FileDescription\', \'Treseko Community Installer\'), StringStruct(\'FileVersion\', \'{value}\'), StringStruct(\'ProductName\', \'Treseko Community\'), StringStruct(\'ProductVersion\', \'{value}\')])]), VarFileInfo([VarStruct(\'Translation\', [1033, 1200])])]\n)\n''',
        encoding="utf-8",
    )


def windows_icon(source: Path, temp: Path) -> Path:
    destination = temp / "treseko-installer.ico"
    try:
        from PIL import Image
    except ImportError as exc:
        raise SystemExit("Windows requiere Pillow para convertir el icono PNG a ICO.") from exc
    with Image.open(source) as image:
        image.convert("RGBA").save(destination, format="ICO", sizes=[(256, 256), (128, 128), (64, 64), (32, 32), (16, 16)])
    return destination


def macos_icon(source: Path, temp: Path) -> Path:
    """Create the standard macOS iconset and compile it with iconutil."""
    try:
        from PIL import Image
    except ImportError as exc:
        raise SystemExit("macOS requiere Pillow para convertir el icono PNG a ICNS.") from exc
    iconset = temp / "treseko-installer.iconset"
    iconset.mkdir()
    with Image.open(source) as image:
        image = image.convert("RGBA")
        resampling = getattr(Image, "Resampling", Image).LANCZOS
        for size in (16, 32, 128, 256, 512):
            image.resize((size, size), resampling).save(iconset / f"icon_{size}x{size}.png")
            image.resize((size * 2, size * 2), resampling).save(iconset / f"icon_{size}x{size}@2x.png")
    iconutil = shutil.which("iconutil")
    if not iconutil:
        raise SystemExit("macOS build bloqueado: falta iconutil para generar el icono .icns.")
    destination = temp / "treseko-installer.icns"
    run([iconutil, "-c", "icns", str(iconset), "-o", str(destination)], cwd=ROOT, env=os.environ.copy())
    if not destination.is_file() or destination.stat().st_size == 0:
        raise SystemExit("iconutil no produjo un .icns válido.")
    return destination


def run(command: list[str], *, cwd: Path, env: dict[str, str]) -> None:
    print("$ " + " ".join(command))
    subprocess.run(command, cwd=cwd, env=env, check=True)


def validate_artifact(path: Path, target: str, value: str) -> None:
    expected = artifact_name(target, value)
    if path.name != expected:
        raise SystemExit(f"Nombre de artefacto inesperado: {path.name} (esperado {expected})")
    if target == "macos":
        if not path.is_dir() or path.suffix != ".app":
            raise SystemExit(f"Bundle macOS ausente: {path}")
        contents = path / "Contents"
        executable = contents / "MacOS" / "Treseko-Installer"
        plist_path = contents / "Info.plist"
        icon_path = contents / "Resources" / "treseko-installer.icns"
        if not executable.is_file() or not executable.stat().st_size:
            raise SystemExit(f"Bundle macOS sin ejecutable: {executable}")
        if not plist_path.is_file():
            raise SystemExit(f"Bundle macOS sin Info.plist: {plist_path}")
        if not icon_path.is_file() or not icon_path.stat().st_size:
            raise SystemExit(f"Bundle macOS sin icono .icns: {icon_path}")
        try:
            metadata = plistlib.loads(plist_path.read_bytes())
        except (OSError, plistlib.InvalidFileException, ValueError) as exc:
            raise SystemExit(f"Info.plist inválido: {plist_path}") from exc
        expected_version = value
        if metadata.get("CFBundleShortVersionString") != expected_version or metadata.get("CFBundleVersion") != expected_version:
            raise SystemExit("Info.plist no conserva VERSION en ambos campos requeridos.")
        if metadata.get("CFBundleIdentifier") != "com.treseko.community.installer":
            raise SystemExit("Info.plist tiene un bundle identifier inesperado.")
        print(f"OK: {path.name} · macOS {macos_architecture()} · VERSION {value}")
        return
    if not path.is_file() or path.stat().st_size < 1024:
        raise SystemExit(f"Artefacto ausente o demasiado pequeño: {path}")
    header = path.open("rb").read(4)
    if target == "windows" and header[:2] != b"MZ":
        raise SystemExit("El artefacto Windows no tiene cabecera PE (MZ).")
    if target == "linux" and header != b"\x7fELF":
        raise SystemExit("El artefacto AppImage no contiene un binario ELF válido.")
    print(f"OK: {path.name} · {path.stat().st_size} bytes · VERSION {value}")


def appimage(appdir: Path, output: Path) -> None:
    tool = os.environ.get("APPIMAGETOOL") or shutil.which("appimagetool")
    if not tool:
        raise SystemExit("AppImage bloqueada: falta appimagetool (use el runner Linux o APPIMAGETOOL=/ruta/appimagetool).")
    run([tool, str(appdir), str(output)], cwd=ROOT, env=os.environ.copy())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=("windows", "linux", "macos"), required=True)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "dist")
    parser.add_argument("--plan", action="store_true", help="Mostrar el plan sin ejecutar PyInstaller ni generar artefactos")
    args = parser.parse_args()
    require_files()
    value = version()
    name = artifact_name(args.target, value)
    print(f"Treseko installer {value} · target={args.target} · artifact={name}")
    if args.plan:
        print("Plan solamente: build nativo + validación de estructura, nombre y versión.")
        return 0
    if not native_target(args.target):
        raise SystemExit(f"Build {args.target} bloqueado en {platform.system()}; use el runner nativo correspondiente.")
    pyinstaller = shutil.which("pyinstaller") or sys.executable
    if pyinstaller == sys.executable:
        command_prefix = [pyinstaller, "-m", "PyInstaller"]
    else:
        command_prefix = [pyinstaller]
    args.output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="treseko-installer-build-") as temp_dir:
        temp = Path(temp_dir)
        env = os.environ.copy()
        env["TRESEKO_ARTIFACT_NAME"] = "Treseko-Installer"
        if args.target == "windows":
            env["TRESEKO_ICON"] = str(windows_icon(INSTALLER / "treseko-installer.png", temp))
            version_info = temp / "version_info.txt"
            write_windows_version_info(version_info, value)
            env["TRESEKO_VERSION_INFO"] = str(version_info)
            spec = INSTALLER / "treseko_installer_windows.spec"
        elif args.target == "linux":
            env["TRESEKO_ICON"] = str(INSTALLER / "treseko-installer.png")
            spec = INSTALLER / "treseko_installer_linux.spec"
        else:
            env["TRESEKO_ICON"] = str(macos_icon(INSTALLER / "treseko-installer.png", temp))
            env["TRESEKO_VERSION"] = value
            spec = INSTALLER / "treseko_installer_macos.spec"
        work = temp / "pyinstaller"
        run(command_prefix + ["--noconfirm", "--clean", "--distpath", str(work / "dist"), "--workpath", str(work / "build"), str(spec)], cwd=ROOT, env=env)
        binary = work / "dist" / "Treseko-Installer"
        if args.target == "windows":
            binary = binary.with_suffix(".exe")
        elif args.target == "macos":
            binary = binary.with_suffix(".app")
        if not binary.is_file():
            if args.target != "macos" or not binary.is_dir():
                raise SystemExit(f"PyInstaller no produjo el binario esperado: {binary}")
        if args.target == "windows":
            final = args.output_dir / name
            shutil.copy2(binary, final)
        elif args.target == "linux":
            appdir = temp / "Treseko.AppDir"
            (appdir / "usr" / "bin").mkdir(parents=True)
            shutil.copy2(binary, appdir / "usr" / "bin" / "Treseko-Installer")
            shutil.copy2(INSTALLER / "treseko-installer.png", appdir / "treseko-installer.png")
            (appdir / "treseko-installer.desktop").write_text(
                "[Desktop Entry]\nType=Application\nName=Treseko Community Installer\nExec=Treseko-Installer\nIcon=treseko-installer\nTerminal=false\nCategories=Development;Testing;\n",
                encoding="utf-8",
            )
            (appdir / "AppRun").write_text("#!/bin/sh\nexec \"$(dirname \"$0\")/usr/bin/Treseko-Installer\" \"$@\"\n", encoding="utf-8")
            (appdir / "AppRun").chmod(0o755)
            final = args.output_dir / name
            appimage(appdir, final)
        else:
            final = args.output_dir / name
            if final.exists():
                raise SystemExit(f"El destino ya existe, no se sobrescribe: {final}")
            shutil.copytree(binary, final)
        validate_artifact(final, args.target, value)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
