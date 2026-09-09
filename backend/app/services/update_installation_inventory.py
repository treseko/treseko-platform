"""Read-only evidence collector for an explicitly configured Compose install."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from .update_participant_commands import load_private_json

SCHEMA_VERSION = 1
ROLES = ("backend", "frontend", "engine", "worker", "db")
HEX64 = re.compile(r"^[0-9a-fA-F]{64}$")
IMAGE_ID = re.compile(r"^sha256:[0-9a-fA-F]{64}$")
_RUNNER = Callable[[Sequence[str]], Any]


class InventoryConfigurationError(ValueError):
    """The inspection request is not an explicit supported Compose request."""


@dataclass(frozen=True)
class DockerComposeInspection:
    config: Mapping[str, Any]
    runner: _RUNNER | None = None

    def __post_init__(self) -> None:
        _validate_config(self.config)

    def inspect(self) -> dict[str, Any]:
        project, docker = str(self.config["project"]), str(self.config["docker"])
        run = self.runner or _subprocess_runner
        report: dict[str, Any] = {
            "schema": SCHEMA_VERSION, "kind": "INSPECT", "controller_ready": False,
            "docker": docker, "compose": {"project": project, "transport": "docker-cli"},
            "components": {}, "missing": [], "duplicates": [], "shared": [],
            "out_of_scope": [], "remote_aliases_pending": [], "requirements": [],
        }
        for item in self.config.get("remote_aliases", []):
            alias = item if isinstance(item, str) else item.get("alias")
            transport = item.get("transport") if isinstance(item, Mapping) else None
            if isinstance(alias, str) and alias.strip():
                reason = "unknown_transport" if transport not in (None, "ssh") else "remote_query_required"
                report["remote_aliases_pending"].append({"alias": alias, "status": "blocked", "reason": reason})
        if report["remote_aliases_pending"]:
            report["requirements"].append("remote_aliases_require_explicit_remote_query")

        ids, error = _list_ids(run, docker, project)
        if error:
            report.update(status="blocked", error=error)
            report["requirements"].append("docker_project_listing_failed")
            return report
        inspected = []
        for container_id in ids:
            record, error = _inspect_container(run, docker, project, container_id)
            if error:
                report["requirements"].append(error)
                inspected.append({"full_id": container_id, "status": "blocked", "error": error})
            elif record:
                inspected.append(record)
        _mark_mount_sharing(inspected)

        roles = self.config["roles"]
        declared = {str(value["service"]): role for role, value in roles.items()}
        for record in inspected:
            if record.get("service") not in declared:
                report["out_of_scope"].append({"full_id": record.get("full_id"), "service": record.get("service"), "reason": "service_not_declared"})
        for role in ROLES:
            service = str(roles[role]["service"])
            matches = [item for item in inspected if item.get("service") == service]
            if not matches:
                report["missing"].append({"role": role, "service": service})
                report["components"][role] = _missing_component(role, service)
                continue
            if len(matches) > 1:
                report["duplicates"].append({"role": role, "service": service, "full_ids": [item.get("full_id") for item in matches]})
            report["components"][role] = _component_evidence(role, matches[0], run, docker)
        service_roles: dict[str, list[str]] = {}
        for role, value in roles.items():
            service_roles.setdefault(str(value["service"]), []).append(role)
        for service, role_names in service_roles.items():
            if len(role_names) > 1:
                report["shared"].append({"service": service, "roles": role_names, "reason": "declared_role_alias"})
        report["requirements"].append("runtime_version_probe_required")
        report["status"] = "blocked" if any(report[key] for key in ("missing", "duplicates", "shared", "out_of_scope", "remote_aliases_pending")) or any(item.get("status") == "blocked" for item in report["components"].values()) else "evidence_collected"
        return report


def inspect_installation(config: Mapping[str, Any], runner: _RUNNER | None = None) -> dict[str, Any]:
    return DockerComposeInspection(config, runner).inspect()


def _validate_config(config: Mapping[str, Any]) -> None:
    allowed = {"schema", "docker", "project", "roles", "remote_aliases"}
    if not isinstance(config, Mapping) or set(config) - allowed or type(config.get("schema")) is not int or config.get("schema") != 1:
        raise InventoryConfigurationError("schema 1 configuration with no extra keys is required")
    if not isinstance(config.get("docker"), str) or not config["docker"].startswith("/"):
        raise InventoryConfigurationError("docker must be an absolute path")
    if not isinstance(config.get("project"), str) or not config["project"].strip() or any(ch.isspace() for ch in config["project"]):
        raise InventoryConfigurationError("project must be an explicit non-empty name")
    roles = config.get("roles")
    if not isinstance(roles, Mapping) or set(roles) != set(ROLES):
        raise InventoryConfigurationError("roles must explicitly declare backend/frontend/engine/worker/db")
    for role in ROLES:
        value = roles[role]
        if not isinstance(value, Mapping) or set(value) != {"service"} or not isinstance(value["service"], str) or not value["service"].strip():
            raise InventoryConfigurationError(f"role {role} must declare only service")
    remote = config.get("remote_aliases", [])
    if not isinstance(remote, list):
        raise InventoryConfigurationError("remote_aliases must be a list")
    for item in remote:
        if not isinstance(item, (str, Mapping)) or (isinstance(item, Mapping) and (set(item) - {"alias", "transport"} or not isinstance(item.get("alias"), str))):
            raise InventoryConfigurationError("remote aliases must be explicit strings or {alias, transport}")


def _subprocess_runner(argv: Sequence[str]) -> Any:
    return subprocess.run(list(argv), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, check=False, timeout=10)


def _invoke(run: _RUNNER, argv: Sequence[str]) -> tuple[Any | None, str | None]:
    try:
        return run(argv), None
    except (OSError, subprocess.TimeoutExpired, TimeoutError):
        return None, "docker_operation_failed"


def _list_ids(run: _RUNNER, docker: str, project: str) -> tuple[list[str], str | None]:
    result, error = _invoke(run, [docker, "ps", "-a", "--no-trunc", "--filter", f"label=com.docker.compose.project={project}", "--format", "{{{{.ID}}}}"])
    if error or result is None or getattr(result, "returncode", 1) != 0:
        return [], error or "docker_project_listing_failed"
    ids = [line.strip() for line in str(getattr(result, "stdout", "")).splitlines() if line.strip()]
    if any(not HEX64.fullmatch(item) for item in ids):
        return [], "container_listing_invalid"
    return ids, None


def _inspect_container(run: _RUNNER, docker: str, expected_project: str, container_id: str) -> tuple[dict[str, Any] | None, str | None]:
    result, error = _invoke(run, [docker, "inspect", "--type", "container", container_id])
    if error or result is None or getattr(result, "returncode", 1) != 0:
        return None, error or "container_inspection_failed"
    try:
        raw = json.loads(str(result.stdout))
        if not isinstance(raw, list) or len(raw) != 1 or not isinstance(raw[0], Mapping):
            return None, "container_inspection_invalid"
        data = raw[0]
        full_id = data.get("Id")
        if not isinstance(full_id, str) or not HEX64.fullmatch(full_id) or full_id != container_id:
            return None, "container_identity_mismatch"
        labels, state = (data.get("Config") or {}).get("Labels"), data.get("State")
        project, service = (labels or {}).get("com.docker.compose.project"), (labels or {}).get("com.docker.compose.service")
        if project != expected_project or not isinstance(service, str) or not isinstance(state, Mapping) or type(state.get("Running")) is not bool:
            return None, "container_inspection_invalid"
        image = data.get("Image")
        if not isinstance(image, str) or not IMAGE_ID.fullmatch(image):
            return None, "container_image_id_invalid"
        return {"full_id": full_id, "image": image, "project": project, "service": service, "running": state["Running"], "mounts": _mounts(data.get("Mounts")), "networks": _networks((data.get("NetworkSettings") or {}).get("Networks")), "ports": _ports((data.get("NetworkSettings") or {}).get("Ports"))}, None
    except (TypeError, ValueError, json.JSONDecodeError):
        return None, "container_inspection_invalid"


def _component_evidence(role: str, container: Mapping[str, Any], run: _RUNNER, docker: str) -> dict[str, Any]:
    image = str(container["image"])
    result, error = _invoke(run, [docker, "image", "inspect", "--no-trunc", image])
    image_status = "verified"
    platform: dict[str, Any] | None = None
    if error or result is None:
        image_status = "image_inspection_failed"
    elif getattr(result, "returncode", 1) != 0:
        check, check_error = _invoke(run, [docker, "image", "ls", "--no-trunc", "--format", "{{{{.ID}}}}", "--filter", f"id={image}"])
        if check_error or check is None or getattr(check, "returncode", 1) != 0:
            image_status = "image_inspection_unknown"
        elif not str(getattr(check, "stdout", "")).strip():
            image_status = "recovery_private_export_required"
        else:
            image_status = "image_inspection_failed"
    else:
        try:
            raw = json.loads(str(result.stdout))
            if not isinstance(raw, list) or len(raw) != 1 or not isinstance(raw[0], Mapping) or raw[0].get("Id") != image:
                image_status = "image_identity_mismatch"
            else:
                platform = {key: raw[0].get(key) for key in ("Os", "Architecture", "Variant") if raw[0].get(key)}
                if not platform.get("Os") or not platform.get("Architecture"):
                    image_status = "platform_unknown"
        except (TypeError, ValueError, json.JSONDecodeError):
            image_status = "image_inspection_failed"
    evidence = dict(container)
    evidence.pop("project", None)
    evidence.update(role=role, image_status=image_status, platform=platform, runtime_version={"value": None, "status": "unknown", "required_probe": True})
    if image_status != "verified":
        evidence["status"] = "blocked"
    return evidence


def _missing_component(role: str, service: str) -> dict[str, Any]:
    return {"role": role, "service": service, "status": "missing", "runtime_version": {"value": None, "status": "unknown", "required_probe": True}}


def _mounts(items: Any) -> list[dict[str, Any]]:
    result = []
    for item in items or []:
        if isinstance(item, Mapping):
            result.append({"type": item.get("Type"), "source": item.get("Source"), "name": item.get("Name"), "destination": item.get("Destination"), "read_only": item.get("RW") is False, "shared_status": "unknown_other_consumers"})
    return result


def _mark_mount_sharing(records: list[dict[str, Any]]) -> None:
    counts: dict[tuple[Any, Any, Any], int] = {}
    for record in records:
        for mount in record.get("mounts", []):
            key = (mount.get("type"), mount.get("name"), mount.get("source"))
            if key[1] or key[2]:
                counts[key] = counts.get(key, 0) + 1
    for record in records:
        for mount in record.get("mounts", []):
            key = (mount.get("type"), mount.get("name"), mount.get("source"))
            if counts.get(key, 0) > 1:
                mount["shared_status"] = "shared_with_inspected_consumers"


def _networks(items: Any) -> list[str]:
    return sorted(str(name) for name in (items or {}) if isinstance(name, str))


def _ports(items: Any) -> list[dict[str, Any]]:
    result = []
    for target, bindings in (items or {}).items():
        for binding in bindings or []:
            result.append({"target": target, "published": binding.get("HostPort") if isinstance(binding, Mapping) else None, "protocol": str(target).split("/")[-1]})
    return result


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read-only Docker Compose installation inspection")
    parser.add_argument("--config", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        report = inspect_installation(load_private_json(args.config))
    except Exception:
        print(json.dumps({"schema": SCHEMA_VERSION, "kind": "INSPECT", "status": "blocked", "error": "invalid_private_config"}, sort_keys=True))
        return 2
    print(json.dumps(report, sort_keys=True))
    return 0 if report.get("status") == "evidence_collected" else 2


if __name__ == "__main__":
    raise SystemExit(main())
