#!/usr/bin/env python3
"""Validate the built release images before an installer mutates an install.

This is a preflight only: it does not start Compose services, attach their
volumes, or run application entrypoints.  Each probe starts an isolated,
read-only container from the just-built image with its normal entrypoint
replaced by a version-file reader.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from typing import Callable, Sequence


VERSION_RE = re.compile(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\Z")
PROJECT_RE = re.compile(r"[a-z0-9][a-z0-9_-]*\Z")
PROBES = {
    "backend": ("cat", "/VERSION", "text"),
    "frontend": ("cat", "/opt/treseko/frontend-dist/version.json", "json"),
    "engine": ("node", "-p", "require('/opt/treseko/engine-source/package.json').version", "text"),
    "automation-worker": ("node", "-p", "require('/opt/treseko/worker-source/package.json').version", "text"),
    "plugin-runner": ("cat", "/TRESEKO_RELEASE_VERSION", "text"),
}
Runner = Callable[..., subprocess.CompletedProcess]


class CandidateImageError(RuntimeError):
    pass


def validate_candidate_images(
    docker: str,
    project: str,
    expected_version: str,
    services: Sequence[str],
    *,
    runner: Runner = subprocess.run,
) -> dict[str, str]:
    if not isinstance(docker, str) or not docker.strip():
        raise ValueError("A Docker executable is required")
    if not isinstance(project, str) or not PROJECT_RE.fullmatch(project):
        raise ValueError("A valid Compose project name is required")
    if not isinstance(expected_version, str) or not VERSION_RE.fullmatch(expected_version):
        raise ValueError("A valid expected release version is required")
    if (not isinstance(services, Sequence) or isinstance(services, (str, bytes))
            or not services or len(set(services)) != len(services)
            or any(service not in PROBES for service in services)):
        raise ValueError("An explicit unique set of supported application services is required")

    versions: dict[str, str] = {}
    for service in services:
        image = f"{project}-{service}"
        probe = PROBES[service]
        command = [
            docker, "run", "--rm", "--network", "none", "--read-only",
            "--entrypoint", probe[0], image, *probe[1:-1],
        ]
        try:
            result = runner(command, capture_output=True, text=True, timeout=60, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise CandidateImageError(f"Candidate image probe failed for {service}") from exc
        if result.returncode != 0:
            raise CandidateImageError(f"Candidate image probe failed for {service}")
        raw = result.stdout.strip()
        try:
            version = str(json.loads(raw).get("version") or "").strip() if probe[-1] == "json" else raw
        except (ValueError, AttributeError, TypeError) as exc:
            raise CandidateImageError(f"Candidate image metadata is invalid for {service}") from exc
        if version != expected_version:
            raise CandidateImageError(
                f"Candidate image version mismatch for {service}: expected {expected_version}, got {version or 'unknown'}"
            )
        versions[service] = version
    return versions


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--docker", required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--expected-version", required=True)
    parser.add_argument("--service", action="append", required=True, choices=tuple(PROBES))
    args = parser.parse_args(argv)
    try:
        versions = validate_candidate_images(args.docker, args.project, args.expected_version, args.service)
    except (ValueError, CandidateImageError) as exc:
        print(f"Candidate image validation failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({"status": "validated", "version": args.expected_version, "services": versions}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
