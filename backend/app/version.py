from __future__ import annotations

import os
from pathlib import Path

PRODUCT_NAME = "Treseko Platform"
PRODUCT_EDITION_BASE = "community"
RELEASE_CHANNEL = "rc"
RELEASE_TAG_PREFIX = "treseko-community"


def _read_root_version() -> str:
    candidates = [
        Path(os.getenv("TRESEKO_VERSION_FILE") or ""),
        Path("/app/VERSION"),
        Path(__file__).resolve().parents[2] / "VERSION",
    ]
    for version_file in candidates:
        if not str(version_file):
            continue
        try:
            value = version_file.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if value:
            return value
    return "0.0.0-dev"


PRODUCT_VERSION = _read_root_version()
COMMUNITY_RELEASE_TAG = f"{RELEASE_TAG_PREFIX}-v{PRODUCT_VERSION}"
