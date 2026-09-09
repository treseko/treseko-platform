from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping


class WorkflowRuntimeManifestError(ValueError):
    pass


def _manifest_path() -> Path:
    root_manifest = Path(__file__).resolve().parents[3] / "contracts" / "workflow-runtime" / "v2" / "runtime-manifest.json"
    if root_manifest.exists():
        return root_manifest
    return Path(__file__).resolve().parents[1] / "workflow_catalog" / "runtime-manifest.v2.json"


@lru_cache(maxsize=1)
def load_workflow_runtime_manifest() -> dict[str, Any]:
    path = _manifest_path()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise WorkflowRuntimeManifestError(f"Unable to load workflow runtime manifest: {exc}") from exc
    if not isinstance(data, dict) or not isinstance(data.get("adapters"), list):
        raise WorkflowRuntimeManifestError("Runtime manifest must contain an adapters array")
    return data


@lru_cache(maxsize=1)
def workflow_runtime_adapters() -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for raw in load_workflow_runtime_manifest()["adapters"]:
        if not isinstance(raw, dict):
            continue
        key = raw.get("key")
        if isinstance(key, str) and key.strip():
            result[key.strip()] = raw
    return result


def _as_mapping(value: Any) -> Mapping[str, Any] | None:
    if isinstance(value, Mapping):
        return value
    for method_name in ("model_dump", "dict"):
        method = getattr(value, method_name, None)
        if callable(method):
            dumped = method()
            if isinstance(dumped, Mapping):
                return dumped
    return None


def _walk_nodes(value: Any):
    mapping = _as_mapping(value)
    if mapping is not None:
        if isinstance(mapping.get("type"), str) and (
            "universal_agent" in mapping or "universalAgent" in mapping
        ):
            yield mapping
        for nested in mapping.values():
            yield from _walk_nodes(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from _walk_nodes(nested)


def _native_adapter(node: Mapping[str, Any]) -> str | None:
    universal = _as_mapping(node.get("universal_agent") or node.get("universalAgent"))
    contract = _as_mapping(universal.get("contract")) if universal else None
    implementation = _as_mapping(contract.get("implementation")) if contract else None
    config = _as_mapping(node.get("config_json")) or {}
    value = config.get("runtime_adapter")
    if value is None and implementation:
        value = implementation.get("native_adapter") or implementation.get("nativeAdapter")
    return value.strip() if isinstance(value, str) and value.strip() else None


def validate_workflow_runtime_adapters(definition: Any) -> list[dict[str, Any]]:
    """Validate all universal nodes against the same manifest exposed to the UI."""
    known = workflow_runtime_adapters()
    errors: list[dict[str, Any]] = []
    for node in _walk_nodes(definition):
        node_id = str(node.get("id") or node.get("node_id") or "<unknown-node>")
        adapter = _native_adapter(node)
        if not adapter:
            errors.append({
                "code": "MISSING_NATIVE_ADAPTER",
                "path": f"nodes.{node_id}.universal_agent.contract.implementation.native_adapter",
                "node_id": node_id,
                "message": "Universal node must declare implementation.native_adapter",
            })
        elif adapter not in known:
            errors.append({
                "code": "UNKNOWN_RUNTIME_ADAPTER",
                "path": f"nodes.{node_id}.universal_agent.contract.implementation.native_adapter",
                "node_id": node_id,
                "adapter": adapter,
                "message": f"Runtime adapter {adapter!r} is not registered",
            })
    return errors
