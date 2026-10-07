# PyInstaller configuration for the native Linux runner.
import os
from pathlib import Path

ROOT = Path(os.environ["TRESEKO_INSTALLER_ROOT"]).resolve()
NAME = os.environ.get("TRESEKO_ARTIFACT_NAME", "Treseko-Installer")

a = Analysis(
    [str(ROOT / "installer" / "treseko_installer_qt.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[(str(ROOT / "installer" / "treseko-installer.png"), "installer")],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name=NAME,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
)
