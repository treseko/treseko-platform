# Reproducible PyInstaller configuration for the native macOS runners.
import os
from pathlib import Path

ROOT = Path(SPECPATH).parent.parent
ICON = Path(os.environ["TRESEKO_ICON"])
NAME = os.environ.get("TRESEKO_ARTIFACT_NAME", "Treseko-Installer")
VERSION = os.environ["TRESEKO_VERSION"]

a = Analysis(
    [str(ROOT / "installer" / "treseko_installer.py")],
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
app = BUNDLE(
    exe,
    name=NAME + ".app",
    icon=str(ICON),
    bundle_identifier="com.treseko.community.installer",
    info_plist={
        "CFBundleDisplayName": "Treseko Community Installer",
        "CFBundleName": "Treseko Installer",
        "CFBundleShortVersionString": VERSION,
        "CFBundleVersion": VERSION,
        "CFBundleIconFile": "treseko-installer.icns",
    },
)
