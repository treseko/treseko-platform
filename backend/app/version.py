from __future__ import annotations

from pathlib import Path

PRODUCT_NAME = "Treseko Platform"
PRODUCT_EDITION_BASE = "community"
RELEASE_CHANNEL = "rc"
RELEASE_TAG_PREFIX = "treseko-community"


def _read_root_version() -> str:
    version_file = Path(__file__).resolve().parents[2] / "VERSION"
    try:
        value = version_file.read_text(encoding="utf-8").strip()
    except OSError:
        return "0.0.0-dev"
    return value or "0.0.0-dev"


PRODUCT_VERSION = _read_root_version()
COMMUNITY_RELEASE_TAG = f"{RELEASE_TAG_PREFIX}-v{PRODUCT_VERSION}"
