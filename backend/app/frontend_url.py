"""Resolve the public frontend origin from one shared runtime configuration.

The backend must not guess the Vite port independently from the frontend.  In
local development both processes receive ``FRONTEND_HOST`` and
``FRONTEND_PORT`` from the same launcher/environment.  A fully qualified
``FRONTEND_PUBLIC_URL`` can override that pair for deployed environments.
"""

from __future__ import annotations

import os
from urllib.parse import urlparse


def _valid_origin(value: str | None) -> str | None:
    candidate = str(value or "").strip().rstrip("/")
    if not candidate:
        return None
    parsed = urlparse(candidate)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        return None
    if parsed.username or parsed.password:
        return None
    return candidate


def frontend_public_url(*, container_default: str | None = None) -> str:
    """Return the canonical frontend origin used in generated links."""

    for variable in ("FRONTEND_PUBLIC_URL", "NOTIFICATIONS_PUBLIC_BASE_URL"):
        configured = _valid_origin(os.getenv(variable))
        if configured:
            return configured

    if container_default:
        return container_default.rstrip("/")

    host = (os.getenv("FRONTEND_HOST") or "127.0.0.1").strip() or "127.0.0.1"
    port = (os.getenv("FRONTEND_PORT") or "5173").strip() or "5173"
    return f"http://{host}:{port}"
