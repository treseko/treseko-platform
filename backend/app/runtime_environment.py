from __future__ import annotations

import os


RUNTIME_ENVIRONMENT = "production"
_LEGACY_ENVIRONMENT_NAMES = ("APP_ENV", "ENVIRONMENT", "ENV")
_PRODUCTION_VALUES = {"prod", "production"}


def enforce_production_runtime() -> str:
    """Treseko sólo admite runtime productivo; las variables son opcionales."""
    for name in _LEGACY_ENVIRONMENT_NAMES:
        configured = (os.getenv(name) or "").strip().lower()
        if configured and configured not in _PRODUCTION_VALUES:
            raise RuntimeError(
                f"{name}={configured!r} no está permitido: Treseko sólo se ejecuta en producción."
            )
    return RUNTIME_ENVIRONMENT


enforce_production_runtime()
IS_PRODUCTION = True
