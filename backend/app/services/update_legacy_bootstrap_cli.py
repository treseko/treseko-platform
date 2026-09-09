"""Non-mutating CLI for legacy binding and admission preflight."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Sequence

from .update_legacy_bootstrap import LegacyBootstrap


def _load(path: Path):
    with path.open("rb") as stream:
        raw = stream.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise ValueError("Input exceeds limit")
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("JSON object required")
    return value


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Plan or record a legacy update binding")
    parser.add_argument("action", choices=("plan", "prepare", "record-consent", "preflight", "status"))
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--transaction", required=True)
    parser.add_argument("--inventory-digest")
    parser.add_argument("--source-id", action="append", dest="source_ids")
    parser.add_argument("--consent")
    parser.add_argument("--evidence", type=Path)
    args = parser.parse_args(argv)
    try:
        bootstrap = LegacyBootstrap(_load(args.config))
        if args.action == "status":
            result = bootstrap.status(args.transaction)
        else:
            if args.manifest is None or args.inventory_digest is None or not args.source_ids:
                raise ValueError("Manifest, inventory digest, and source IDs are required")
            manifest = _load(args.manifest)
            if args.action == "plan":
                result = bootstrap.plan(manifest, args.transaction, args.inventory_digest, args.source_ids)
            elif args.action == "prepare":
                result = bootstrap.prepare(manifest, args.transaction, args.inventory_digest, args.source_ids)
            elif args.action == "record-consent":
                if args.consent is None or args.evidence is None:
                    raise ValueError("Consent and separate evidence are required")
                result = bootstrap.record_consent(manifest, args.transaction, args.inventory_digest, args.source_ids,
                                                  consent=args.consent, evidence=_load(args.evidence))
            else:
                raise ValueError("Preflight requires injected fence and SQL observer; no CLI bypass exists")
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception:
        print(json.dumps({"ok": False, "error": "legacy_bootstrap_request_failed"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
