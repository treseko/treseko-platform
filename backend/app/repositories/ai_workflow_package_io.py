"""Safe deterministic I/O and graph remapping for portable workflows."""

from __future__ import annotations

import base64
import io
import zipfile
from copy import deepcopy
from typing import Any, Dict, List
from uuid import UUID, uuid4

from .. import schemas


def _zip_payload(files: Dict[str, bytes]) -> str:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted(files):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, files[name])
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _read_zip_payload(package_base64: str) -> Dict[str, bytes]:
    try:
        raw = base64.b64decode(package_base64, validate=True)
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            names = archive.namelist()
            if len(names) > 50 or any(name.startswith("/") or ".." in name.split("/") for name in names):
                raise ValueError("El paquete contiene rutas no seguras.")
            return {name: archive.read(name) for name in names if not name.endswith("/")}
    except (ValueError, zipfile.BadZipFile) as exc:
        raise ValueError("El paquete ZIP no es valido.") from exc


def workflow_create_payload_from_portable_graph(
    graph: Dict[str, Any],
    version_map: Dict[str, UUID],
    *,
    imported_name_suffix: str = " - importado",
    preserve_catalog_metadata: bool = False,
) -> schemas.AiWorkflowCreate:
    raw_workflow = graph.get("workflow") if isinstance(graph, dict) else None
    if not isinstance(raw_workflow, dict) or not isinstance(graph.get("nodes"), list) or not isinstance(graph.get("edges"), list):
        raise ValueError("El workflow portable no tiene un grafo valido.")
    if raw_workflow.get("workflow_format") != "universal_v2":
        raise ValueError("El grafo importado no usa el formato universal_v2.")
    purpose = str(raw_workflow.get("workflow_purpose") or "")
    if purpose not in {"test_execution", "story_generation", "test_case_generation"}:
        raise ValueError("El workflow portable no declara un proposito valido.")

    node_payloads: List[schemas.AiWorkflowNodeBase] = []
    id_map: Dict[str, UUID] = {}
    for node in graph["nodes"]:
        if not isinstance(node, dict):
            raise ValueError("El paquete contiene un nodo invalido.")
        source_node_id = str(node.get("id") or "")
        if not source_node_id or source_node_id in id_map:
            raise ValueError("El paquete contiene nodos sin ID o con IDs duplicados.")
        version_id = version_map.get(str(
            node.get("universal_agent_version_id")
            or (node.get("universal_agent") or {}).get("version_id")
            or ""
        ))
        if not version_id:
            raise ValueError("Un nodo del workflow no pudo resolver su agente portable.")
        target_node_id = uuid4()
        id_map[source_node_id] = target_node_id
        node_payloads.append(schemas.AiWorkflowNodeBase(
            id=target_node_id,
            type=str(node.get("type") or "llm_agent"),
            name=str(node.get("name") or "Agente"),
            agent_key=str(node.get("agent_key") or "UNIVERSAL_AGENT"),
            agent_definition_id=None,
            universal_agent_version_id=version_id,
            enabled=bool(node.get("enabled", True)),
            locked=False,
            prompt_template=str(node.get("prompt_template") or ""),
            config_json=node.get("config_json") if isinstance(node.get("config_json"), dict) else {},
            position_x=int(node.get("position_x") or 0),
            position_y=int(node.get("position_y") or 0),
            retry_policy=node.get("retry_policy") if isinstance(node.get("retry_policy"), dict) else {},
            timeout_sec=int(node.get("timeout_sec") or 60),
            model_override=node.get("model_override"),
            temperature_override=node.get("temperature_override"),
        ))

    edge_payloads: List[schemas.AiWorkflowEdgeBase] = []
    for edge in graph["edges"]:
        if not isinstance(edge, dict):
            raise ValueError("El paquete contiene una conexion invalida.")
        source_id = id_map.get(str(edge.get("source_node_id") or ""))
        target_id = id_map.get(str(edge.get("target_node_id") or ""))
        if not source_id or not target_id:
            raise ValueError("El paquete contiene una arista con nodos inexistentes.")
        edge_payloads.append(schemas.AiWorkflowEdgeBase(
            source_node_id=source_id,
            target_node_id=target_id,
            source_handle=edge.get("source_handle"),
            target_handle=edge.get("target_handle"),
            condition_type=str(edge.get("condition_type") or "always"),
            condition_json=edge.get("condition_json") if isinstance(edge.get("condition_json"), dict) else {},
            priority=int(edge.get("priority") or 0),
            max_passes=max(1, int(edge.get("max_passes") or 1)),
            data_mapping_json=edge.get("data_mapping_json") if isinstance(edge.get("data_mapping_json"), list) else [],
        ))

    decision_policy = raw_workflow.get("decision_policy_json")
    if not isinstance(decision_policy, dict):
        decision_policy = {}
    else:
        decision_policy = deepcopy(decision_policy)
    if not preserve_catalog_metadata:
        for key in ("catalog_key", "catalog_source_sha256", "catalog_version"):
            decision_policy.pop(key, None)
    return schemas.AiWorkflowCreate(
        name=f"{raw_workflow.get('name') or 'Workflow importado'}{imported_name_suffix}",
        version=max(1, int(raw_workflow.get("version") or 1)),
        status="DRAFT",
        is_default=False,
        workflow_format="universal_v2",
        workflow_purpose=purpose,
        source_workflow_id=None,
        provider_profile_id=None,
        fallback_profile_ids=[],
        decision_policy_json=decision_policy,
        nodes=node_payloads,
        edges=edge_payloads,
        changelog="Workflow universal importado",
    )
