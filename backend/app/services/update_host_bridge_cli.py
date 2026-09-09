"""Bounded stdin/stdout CLI for the host-owned update bridge."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from .update_host_bridge import HostBridgeError, HostUpdateBridge
from .update_host_bridge_spool import HostBridgeSpool
from .update_participant_commands import load_private_json


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Host-owned existing-installation bridge")
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--spool", action="store_true")
    args = parser.parse_args(argv)
    if not args.once:
        print(json.dumps({"schema": 1, "error": "once_required"}))
        return 2
    try:
        private = load_private_json(args.config)
        if args.spool:
            result = HostBridgeSpool(private).process_once()
        else:
            raw = sys.stdin.buffer.read(1024 * 1024 + 1)
            if len(raw) > 1024 * 1024:
                raise HostBridgeError("request_too_large")
            result = HostUpdateBridge(private).handle(json.loads(raw))
        print(json.dumps(result, sort_keys=True))
        return 0
    except HostBridgeError as exc:
        print(json.dumps({"schema": 1, "status": "blocked", "error": exc.code}))
        return 1
    except Exception:
        print(json.dumps({"schema": 1, "status": "blocked", "error": "bridge_request_failed"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
