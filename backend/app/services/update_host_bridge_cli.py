"""Bounded stdin/stdout CLI for the host-owned update bridge."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import signal
import sys
import threading

from .update_host_bridge import HostBridgeError, HostUpdateBridge
from .update_host_bridge_spool import HostBridgeSpool
from .update_participant_commands import load_private_json


def supervise(spool: HostBridgeSpool, interval: float, stop: threading.Event,
              emit=None) -> None:
    """Poll the durable host spool until the container is stopped.

    The fixed, bounded interval makes this suitable for an auto-restarting
    Docker container on Linux, macOS, and Docker Desktop for Windows without a
    platform-specific scheduler. Requests remain durable in the spool; an
    interrupted operation is reconciled by the next process_once call.
    """
    while not stop.is_set():
        try:
            result = spool.process_once()
        except HostBridgeError as exc:
            result = {"schema": 1, "status": "blocked", "error": exc.code}
        except Exception:
            result = {"schema": 1, "status": "blocked", "error": "bridge_request_failed"}
        if result.get("status") != "idle":
            encoded = json.dumps(result, sort_keys=True)
            if emit is None:
                print(encoded, flush=True)
            else:
                emit(encoded)
        stop.wait(interval)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Host-owned existing-installation bridge")
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--spool", action="store_true")
    parser.add_argument("--watch", action="store_true",
                        help="Poll the durable spool until SIGTERM (for a restartable container).")
    parser.add_argument("--interval", type=float, default=30.0)
    args = parser.parse_args(argv)
    if args.watch:
        if not args.spool or args.once or not 1.0 <= args.interval <= 300.0:
            print(json.dumps({"schema": 1, "error": "invalid_watch_mode"}))
            return 2
        try:
            spool = HostBridgeSpool(load_private_json(args.config))
            stop = threading.Event()
            signal.signal(signal.SIGTERM, lambda *_: stop.set())
            signal.signal(signal.SIGINT, lambda *_: stop.set())
            supervise(spool, args.interval, stop)
            return 0
        except HostBridgeError as exc:
            print(json.dumps({"schema": 1, "status": "blocked", "error": exc.code}))
            return 1
        except Exception:
            print(json.dumps({"schema": 1, "status": "blocked", "error": "bridge_request_failed"}))
            return 1
    if not args.once or args.interval != 30.0:
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
