"""Resolve durable backend storage for complete worker evidence."""

import os
from pathlib import Path


def result_upload_root(*, data_root: Path = Path("/data/updates"), fallback_root: Path | None = None) -> Path:
    configured = (os.getenv("AUTOMATION_RESULT_UPLOAD_DIR") or "").strip()
    if configured:
        return Path(configured)

    # The 1.0.6 Compose file already mounts /data/updates as a persistent
    # volume, while it does not yet declare the dedicated worker-results
    # volume introduced later. Store complete results there during that upgrade
    # path so a container restart cannot discard acknowledged evidence.
    if os.getenv("TRESEKO_DEPLOY_MODE", "").strip().lower() == "docker":
        return data_root / "worker-results"

    return fallback_root or (Path(__file__).resolve().parents[2] / ".treseko" / "worker-results")
