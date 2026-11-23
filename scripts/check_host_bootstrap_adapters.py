#!/usr/bin/env python3
"""Static conformance checks for the signed host bootstrap entrypoints."""
from __future__ import annotations

import ast
from pathlib import Path
import subprocess
import sys


PROTOCOL = "treseko-host-update-coordinator/v1"
ROOT = Path(__file__).resolve().parents[1]
ADAPTERS = {
    "scripts/bootstrap_host_update_coordinator.sh": (
        "Linux", "app.services.update_host_coordinator_cli",
        "app.services.update_legacy_host_migration", "--source-release-root"),
    "scripts/bootstrap_host_update_coordinator_macos.sh": (
        "Darwin", "app.services.update_host_coordinator_cli",
        "app.services.update_legacy_host_migration", "--source-release-root"),
    "scripts/bootstrap_host_update_coordinator.ps1": (
        "microsoft-standard-WSL2", '"--exec", "docker", "info"', '"--exec", "loginctl", "show-user"',
        '"--user", $linuxUser, "--exec", "systemctl", "--user", "is-system-running"',
        "Register-ScheduledTask",
        "bootstrap_host_update_coordinator.sh", "--source-release-root",
        'ValidateSet("preflight", "prepare", "plan", "install", "migrate")',
        'if ($Command -eq "migrate")', "-Package",
        'if (-not [string]::IsNullOrWhiteSpace($Manifest))',
        "Start-ScheduledTask", 'function Resolve-WslPath', 'StartsWith("/")',
        '"realpath", "-e", "--"', 'dbus-user-session', 'daemon Docker',
        'No existe el socket Docker', '$distroLabel'),
}


def main() -> int:
    errors: list[str] = []
    for relative, markers in ADAPTERS.items():
        path = ROOT / relative
        if path.is_symlink() or not path.is_file():
            errors.append(f"missing_or_unsafe:{relative}")
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            errors.append(f"unreadable:{relative}")
            continue
        if not relative.endswith(".ps1") and PROTOCOL not in text:
            errors.append(f"protocol_missing:{relative}")
        if relative.endswith(".ps1") and "TRESEKO_HOST_BOOTSTRAP_PROTOCOL=$Protocol" not in text:
            errors.append(f"protocol_forwarding_missing:{relative}")
        for marker in markers:
            if marker not in text:
                errors.append(f"marker_missing:{relative}:{marker}")
        if relative.endswith(".sh"):
            syntax = subprocess.run(["bash", "-n", str(path)], capture_output=True, text=True)
            if syntax.returncode:
                errors.append(f"shell_syntax_invalid:{relative}")
    for relative in (
        "backend/app/services/update_host_bootstrap_preflight.py",
        "backend/app/services/update_host_coordinator_bootstrap.py",
        "backend/app/services/update_host_coordinator_installer.py",
        "backend/app/services/update_host_coordinator_cli.py",
        "backend/app/services/update_legacy_host_migration.py",
    ):
        path = ROOT / relative
        if path.is_symlink() or not path.is_file():
            errors.append(f"bootstrap_runtime_missing_or_unsafe:{relative}")
            continue
        try:
            ast.parse(path.read_text(encoding="utf-8"), filename=relative)
        except (OSError, UnicodeError, SyntaxError):
            errors.append(f"bootstrap_runtime_invalid:{relative}")
    legacy_native = ROOT / "scripts/bootstrap_legacy_native_update.sh"
    if legacy_native.is_symlink() or not legacy_native.is_file():
        errors.append("legacy_native_bootstrap_missing_or_unsafe")
    else:
        syntax = subprocess.run(["bash", "-n", str(legacy_native)],
                                capture_output=True, text=True)
        if syntax.returncode:
            errors.append("legacy_native_bootstrap_shell_syntax_invalid")
        else:
            text = legacy_native.read_text(encoding="utf-8")
            for marker in ("--native-systemd", "prepare_host_bootstrap_python.sh",
                           "app.services.update_legacy_host_migration"):
                if marker not in text:
                    errors.append(f"legacy_native_bootstrap_contract_missing:{marker}")
    for relative in ("scripts/prepare_host_bootstrap_python.sh",
                     "scripts/host-bootstrap-requirements.txt",
                     "scripts/bootstrap_native_worker_restart.sh"):
        path = ROOT / relative
        if path.is_symlink() or not path.is_file():
            errors.append(f"bootstrap_dependency_missing_or_unsafe:{relative}")
    requirements = ROOT / "scripts/host-bootstrap-requirements.txt"
    if requirements.is_file() and requirements.read_text(encoding="utf-8").splitlines() != [
        "cryptography==50.0.0", "cffi==2.1.1", "pycparser==3.12",
    ]:
        errors.append("bootstrap_dependency_not_pinned")
    prepare = ROOT / "scripts/prepare_host_bootstrap_python.sh"
    if prepare.is_file():
        syntax = subprocess.run(["bash", "-n", str(prepare)], capture_output=True, text=True)
        if syntax.returncode:
            errors.append("bootstrap_dependency_script_syntax_invalid")
        elif ' -r "${REQUIREMENTS}" >&2' not in prepare.read_text(encoding="utf-8"):
            errors.append("bootstrap_dependency_logs_must_not_pollute_python_path_stdout")
    native_worker_bootstrap = ROOT / "scripts/bootstrap_native_worker_restart.sh"
    if native_worker_bootstrap.is_file():
        syntax = subprocess.run(["bash", "-n", str(native_worker_bootstrap)],
                                capture_output=True, text=True)
        if syntax.returncode:
            errors.append("native_worker_bootstrap_shell_syntax_invalid")
        else:
            text = native_worker_bootstrap.read_text(encoding="utf-8")
            for marker in ("Restart=always", "daemon-reload", "no se reinicio"):
                if marker not in text:
                    errors.append(f"native_worker_bootstrap_contract_missing:{marker}")
            if "systemctl" not in text or "treseko-worker.service" not in text:
                errors.append("native_worker_bootstrap_unit_contract_missing")
    if errors:
        print("Host bootstrap adapter conformance failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print(f"Host bootstrap adapters conform to {PROTOCOL} (static checks only).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
