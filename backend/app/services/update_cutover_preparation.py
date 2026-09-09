"""Offline preparation of a reviewable coordinated-cutover bundle."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import stat
from typing import Any, Mapping

from .update_participant_commands import load_private_json

SCHEMA = 1
ROLES = frozenset({"backend", "frontend", "engine", "automation_worker", "db"})
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\Z")
PERSISTENT_BINDING_ROOTS = (Path("/etc/treseko/update"), Path("/var/lib/treseko/update"))
TEMPLATE_DIR = Path(__file__).resolve().parents[3] / "scripts" / "systemd"


class CutoverPreparationError(ValueError):
    """The existing installation is not safe to prepare offline."""


def _absolute(value: Any, label: str) -> Path:
    if (not isinstance(value, str) or not value.startswith("/")
            or ".." in Path(value).parts
            or any(char in value for char in ("\x00", "\n", "\r"))):
        raise CutoverPreparationError(f"{label}_invalid")
    return Path(value)


def _render_path(value: str, label: str) -> str:
    path = _absolute(value, label)
    if any(char.isspace() or char in "%\\`$'\"" for char in value):
        raise CutoverPreparationError(f"{label}_unsafe")
    return str(path)


def _mount_directory(path: Path, label: str, uid: int, gid: int, *, writable: bool,
                     group_writable: bool = False) -> None:
    try:
        info = path.lstat()
    except OSError as exc:
        raise CutoverPreparationError(f"{label}_unavailable") from exc
    group_bits = stat.S_IMODE(info.st_mode) & 0o070
    required_group = 0o030 if writable and group_writable else (0o050 if not writable else 0)
    unsafe = (not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode)
              or info.st_uid not in {0, uid, os.geteuid()} or info.st_gid != gid
              or (writable and not group_writable and info.st_uid != uid)
              or (group_writable and group_bits & 0o030 != 0o030)
              or group_bits & required_group != required_group
              or (not writable and group_bits & 0o020)
              or info.st_mode & 0o007)
    if unsafe:
        raise CutoverPreparationError(f"{label}_unsafe")


def _regular(path: Path, label: str, *, private: bool = False) -> os.stat_result:
    try:
        info = path.lstat()
    except OSError as exc:
        raise CutoverPreparationError(f"{label}_unavailable") from exc
    if (not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode)
            or info.st_uid not in {0, os.geteuid()} or info.st_mode & 0o022
            or (private and info.st_mode & 0o077)):
        raise CutoverPreparationError(f"{label}_unsafe")
    return info


def _digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _roles(value: Any) -> dict[str, str]:
    if not isinstance(value, Mapping) or set(value) != ROLES:
        raise CutoverPreparationError("topology_roles_incomplete")
    result = {}
    for role, service in value.items():
        if not isinstance(service, str) or not IDENTIFIER.fullmatch(service):
            raise CutoverPreparationError("topology_service_invalid")
        result[role] = service
    if len(set(result.values())) != len(result):
        raise CutoverPreparationError("topology_service_ambiguous")
    return result


def _config(config: Mapping[str, Any]) -> dict[str, Any]:
    expected = {"schema", "installation_id", "topology_binding_existing", "fixed_settings", "legacy_state"}
    if not isinstance(config, Mapping) or set(config) != expected or config.get("schema") != SCHEMA:
        raise CutoverPreparationError("cutover_config_invalid")
    installation_id = config.get("installation_id")
    if not isinstance(installation_id, str) or not IDENTIFIER.fullmatch(installation_id):
        raise CutoverPreparationError("installation_id_invalid")
    topology = config["topology_binding_existing"]
    topology_keys = {"scope", "compose_file", "project", "services"}
    if not isinstance(topology, Mapping) or set(topology) != topology_keys:
        raise CutoverPreparationError("topology_binding_invalid")
    if not isinstance(topology["scope"], str) or not topology["scope"].strip():
        raise CutoverPreparationError("topology_scope_invalid")
    compose = _absolute(topology["compose_file"], "compose_file")
    _regular(compose, "compose_file")
    if not isinstance(topology["project"], str) or not IDENTIFIER.fullmatch(topology["project"]):
        raise CutoverPreparationError("compose_project_invalid")
    services = _roles(topology["services"])
    fixed_keys = {"binding_path", "compose_override_path", "systemd_service_path",
                  "systemd_timer_path", "systemd_wrapper_path", "request_inbox",
                  "package_inbox", "report_dir", "control_dir", "host_bridge_wrapper",
                  "host_bridge_config", "bridge_uid", "bridge_gid"}
    fixed = config["fixed_settings"]
    if not isinstance(fixed, Mapping) or set(fixed) != fixed_keys:
        raise CutoverPreparationError("fixed_settings_invalid")
    binding_path = _absolute(fixed["binding_path"], "binding_path")
    if not any(binding_path == root / "installation-binding.json" for root in PERSISTENT_BINDING_ROOTS):
        raise CutoverPreparationError("binding_path_not_persistent")
    paths = {key: _absolute(fixed[key], key) for key in fixed_keys
             if key.endswith("_path") or key in {"request_inbox", "package_inbox", "report_dir",
                                                   "control_dir", "host_bridge_wrapper", "host_bridge_config"}}
    _regular(paths["host_bridge_wrapper"], "host_bridge_wrapper")
    _regular(paths["host_bridge_config"], "host_bridge_config", private=True)
    if (type(fixed["bridge_uid"]) is not int or fixed["bridge_uid"] < 0
            or type(fixed["bridge_gid"]) is not int or fixed["bridge_gid"] < 0):
        raise CutoverPreparationError("bridge_identity_invalid")
    for key in ("request_inbox", "package_inbox", "report_dir", "control_dir"):
        _render_path(fixed[key], key)
    _render_path(fixed["host_bridge_wrapper"], "host_bridge_wrapper")
    _render_path(fixed["host_bridge_config"], "host_bridge_config")
    _mount_directory(paths["request_inbox"], "request_inbox", fixed["bridge_uid"],
                     fixed["bridge_gid"], writable=True, group_writable=True)
    _mount_directory(paths["package_inbox"], "package_inbox", fixed["bridge_uid"],
                     fixed["bridge_gid"], writable=True)
    _mount_directory(paths["report_dir"], "report_dir", fixed["bridge_uid"],
                     fixed["bridge_gid"], writable=False)
    legacy = config["legacy_state"]
    if not isinstance(legacy, Mapping) or set(legacy) != {"update_ready", "pending_journal"}:
        raise CutoverPreparationError("legacy_state_invalid")
    markers = {key: _absolute(legacy[key], key) for key in legacy}
    return {"installation_id": installation_id, "topology": dict(topology), "services": services,
            "fixed": dict(fixed), "paths": paths, "markers": markers}


def _preconditions(value: Mapping[str, Any]) -> None:
    for name, path in value["markers"].items():
        if path.is_symlink():
            raise CutoverPreparationError(f"{name}_unsafe")
        if not path.exists():
            continue
        if name == "update_ready":
            raise CutoverPreparationError("legacy_update_pending")
        _regular(path, name, private=True)
        try:
            journal = json.loads(path.read_text())
        except (OSError, ValueError, UnicodeError) as exc:
            raise CutoverPreparationError("pending_journal_invalid") from exc
        if not isinstance(journal, Mapping):
            raise CutoverPreparationError("pending_journal_invalid")
        if journal.get("schema") == 3:
            valid = {"installed", "rolled_back", "aborted"}
            status = journal.get("phase")
        elif journal.get("schema") == 1:
            valid = {"complete", "rolled_back"}
            status = journal.get("status")
        else:
            raise CutoverPreparationError("pending_journal_invalid")
        if status not in valid:
            raise CutoverPreparationError("pending_journal_active")


def _render(value: Mapping[str, Any]) -> dict[str, str]:
    fixed, service = value["fixed"], value["services"]["backend"]
    container_binding = "/run/treseko/update/installation-binding.json"
    env = {"TRESEKO_UPDATE_REQUEST_INBOX": fixed["request_inbox"],
           "TRESEKO_UPDATE_PACKAGE_INBOX": fixed["package_inbox"],
           "TRESEKO_UPDATE_REPORT_DIR": fixed["report_dir"],
           "TRESEKO_UPDATE_REQUEST_UID": str(fixed["bridge_uid"]),
           "TRESEKO_UPDATE_REQUEST_GID": str(fixed["bridge_gid"]),
           "TRESEKO_UPDATE_MODE": "coordinated",
           "TRESEKO_BACKEND_UPDATE_CONTROL_DIR": fixed["control_dir"],
           "TRESEKO_INSTALLATION_BINDING_FILE": container_binding}
    env_lines = "".join(f"      {json.dumps(key)}: {json.dumps(value)}\n" for key, value in env.items())
    mounts = ((fixed["request_inbox"], "rw"), (fixed["package_inbox"], "rw"),
              (fixed["report_dir"], "ro"), (fixed["binding_path"], "ro"))
    mount_lines = ""
    for source, mode in mounts:
        target = container_binding if source == fixed["binding_path"] else source
        mount_lines += f"      - {json.dumps(f'{source}:{target}:{mode}')}\n"
    override = ("services:\n  " + json.dumps(service) + ":\n    command: [\"coordinated-serve\"]\n"
                "    environment:\n" + env_lines + "    volumes:\n" + mount_lines)
    binding = json.dumps({"schema": 1, "installation_id": value["installation_id"],
                          "mode": "coordinated", "owner": "host-update-coordinator",
                          "generation": 1}, sort_keys=True, indent=2) + "\n"
    templates = {
        "treseko-update-spool.service": ("treseko-update-spool.service.in", {
            "@TRESEKO_UPDATE_BRIDGE_CONFIG@": str(fixed["host_bridge_config"]),
            "@TRESEKO_UPDATE_BRIDGE_WRAPPER@": str(fixed["host_bridge_wrapper"])}),
        "treseko-update-spool.timer": ("treseko-update-spool.timer.in", {}),
        "treseko-update-spool-wrapper.sh": ("treseko-update-spool-wrapper.sh.in", {
            "@TRESEKO_UPDATE_BRIDGE_HELPER@": str(fixed["host_bridge_wrapper"])})}
    result = {"installation-binding.json": binding, "compose.override.yaml": override}
    for output, (template, replacements) in templates.items():
        try:
            content = (TEMPLATE_DIR / template).read_text()
        except OSError as exc:
            raise CutoverPreparationError("systemd_template_unavailable") from exc
        for marker, replacement in replacements.items():
            if output.endswith(".service"):
                rendered = _systemd_quote(replacement)
            else:
                rendered = replacement.replace("'", "'\\''")
            content = content.replace(marker, rendered)
        if any(marker in content for marker in replacements):
            raise CutoverPreparationError("systemd_template_unresolved")
        result[output] = content
    return result


def _systemd_quote(value: str) -> str:
    if any(char in value for char in ("\n", "\r", "%", "\\")):
        raise CutoverPreparationError("rendered_path_unsafe")
    return json.dumps(value)


def prepare_cutover(config: Mapping[str, Any], output_dir: Path) -> dict[str, Any]:
    value = _config(config)
    _preconditions(value)
    output_dir = _absolute(str(output_dir), "output_dir")
    if output_dir.exists():
        raise CutoverPreparationError("output_dir_exists")
    output_dir.mkdir(mode=0o700, parents=False)
    rendered = _render(value)
    for name, content in rendered.items():
        path = output_dir / name
        path.write_text(content)
        path.chmod(0o600 if name == "installation-binding.json" else 0o640)
    bundle = {"schema": 1, "kind": "offline_cutover_bundle", "operational": False,
              "installation_id": value["installation_id"], "scope": value["topology"]["scope"],
              "compose_project": value["topology"]["project"], "services": value["services"],
              "binding_target": str(value["fixed"]["binding_path"]),
              "artifacts": {name: _digest(content) for name, content in rendered.items()}}
    (output_dir / "bundle.json").write_text(json.dumps(bundle, sort_keys=True, indent=2) + "\n")
    (output_dir / "bundle.json").chmod(0o600)
    return {"ok": True, "kind": "offline_cutover_bundle", "operational": False,
            "output_dir": str(output_dir), "artifacts": sorted(rendered), "services": value["services"]}


def main(argv: list[str] | None = None) -> int:
    import argparse
    parser = argparse.ArgumentParser(description="Prepare a reviewable offline cutover bundle")
    parser.add_argument("command", choices=["prepare-cutover"])
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        result = prepare_cutover(load_private_json(args.config), args.output_dir)
    except Exception:
        print(json.dumps({"ok": False, "error": "cutover_preparation_failed"}))
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
