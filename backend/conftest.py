from __future__ import annotations

import os

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://treseko_tests:treseko_tests@127.0.0.1:5432/treseko_tests",
)
os.environ.setdefault("SECRET_KEY", "public-release-mcp-test-secret-" + ("x" * 48))
os.environ.setdefault("REDIS_URL", "redis://127.0.0.1:6379/15")
os.environ.setdefault("TRESEKO_MCP_DEPLOYMENT_TOPOLOGY", "single_process")
# Backend tests must never contact the public verification service, even when
# the developer shell explicitly enables the optional installation ping.
os.environ["TRESEKO_DISABLE_INSTALLATION_PING"] = "1"
