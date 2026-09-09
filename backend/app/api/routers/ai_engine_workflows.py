from fastapi import APIRouter
from typing import Any
from ...services.edition.entitlement_service import require_feature
from ...main_context import *
from ...services.ai_workflow_runtime_manifest import load_workflow_runtime_manifest, validate_workflow_runtime_adapters, workflow_runtime_adapters
from ...services.ai_workflow_graph_contract import validate_graph_contract

router = APIRouter(tags=["Motor IA"])

@router.get("/workflow-runtime-manifest", operation_id="get_ai_workflow_runtime_manifest", dependencies=[Depends(require_feature("ai.engine"))])
async def get_ai_workflow_runtime_manifest(
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_view", "read")),
):
    return load_workflow_runtime_manifest()


@router.post("/workflow-preflight-v2", operation_id="preflight_ai_workflow_v2", dependencies=[Depends(require_feature("ai.engine"))])
async def preflight_ai_workflow_v2(
    payload: dict[str, Any],
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_view", "read")),
):
    known = workflow_runtime_adapters().keys()
    issues = [
        {"severity": issue.severity, "code": issue.code, "message": issue.message, "path": issue.path, "node_id": issue.node_id, "edge_id": issue.edge_id}
        for issue in validate_graph_contract(payload, known_adapters=known)
    ]
    for error in validate_workflow_runtime_adapters(payload):
        issues.append({"severity": "error", **error})
    return {"valid": not any(item.get("severity") == "error" for item in issues), "errors": issues}

@router.post("/workflow-preflight-v3", operation_id="preflight_ai_workflow_v3", dependencies=[Depends(require_feature("ai.engine"))])
async def preflight_ai_workflow_v3(
    payload: dict[str, Any],
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_view", "read")),
):
    workflow = payload.get("workflow") if isinstance(payload.get("workflow"), dict) else {}
    issues = [
        {"severity": issue.severity, "code": issue.code, "message": issue.message, "path": issue.path, "node_id": issue.node_id, "edge_id": issue.edge_id}
        for issue in validate_graph_contract(payload, known_adapters=workflow_runtime_adapters().keys())
    ]
    if workflow.get("workflow_format") != "universal_v3":
        issues.append({"severity": "error", "code": "V3_FORMAT_REQUIRED", "message": "El preflight V3 requiere workflow_format=universal_v3."})
    manifest = workflow_runtime_adapters()
    for node in payload.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        contract = ((node.get("universal_agent") or {}).get("contract") or {})
        adapter = (node.get("config_json") or {}).get("runtime_adapter") or (contract.get("implementation") or {}).get("native_adapter")
        if adapter in manifest and manifest[adapter].get("atomic") is not True:
            issues.append({"severity": "error", "code": "V3_ATOMIC_ADAPTER_REQUIRED", "message": f"El adaptador {adapter} no es atomico.", "node_id": node.get("id")})
    for error in validate_workflow_runtime_adapters(payload):
        issues.append({"severity": "error", **error})
    return {"valid": not any(item.get("severity") == "error" for item in issues), "errors": issues}

@router.get("/ai-workflows/", response_model=List[schemas.AiWorkflowResponse], dependencies=[Depends(require_feature("ai.engine"))])
async def list_ai_workflows(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_view", "read")),
):
    return await crud.list_ai_workflows(db)

@router.get("/ai-agent-definitions/", response_model=List[schemas.AiAgentDefinitionResponse], dependencies=[Depends(require_feature("ai.engine"))])
async def list_ai_agent_definitions(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_view", "read")),
):
    return await crud.list_ai_agent_definitions(db)


@router.get("/ai-universal-agents/contract-schema", dependencies=[Depends(require_feature("ai.engine"))])
async def get_ai_universal_agent_contract_schema(
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_view", "read")),
):
    return crud.universal_agent_contract_schema()


@router.get("/ai-universal-capabilities/", response_model=List[schemas.AiUniversalCapabilityResponse], dependencies=[Depends(require_feature("ai.engine"))])
async def list_ai_universal_capabilities(
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_view", "read")),
):
    return list(crud.CAPABILITY_CATALOG.values())


@router.get("/ai-universal-agents/", response_model=List[schemas.AiUniversalAgentResponse], dependencies=[Depends(require_feature("ai.engine"))])
async def list_ai_universal_agents(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_view", "read")),
):
    return await crud.list_universal_agents(db)


@router.post("/ai-universal-agents/", response_model=schemas.AiUniversalAgentResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def create_ai_universal_agent(
    payload: schemas.AiUniversalAgentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_drafts", "edit")),
):
    try:
        return await crud.create_universal_agent(db, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/ai-universal-agents/{agent_id}/variants", response_model=schemas.AiUniversalAgentResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def create_ai_universal_agent_variant(
    agent_id: UUID,
    payload: schemas.AiUniversalAgentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_drafts", "edit")),
):
    try:
        return await crud.create_universal_variant(db, agent_id, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/ai-universal-agents/{agent_id}/versions", response_model=schemas.AiUniversalAgentVersionResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def create_ai_universal_agent_version(
    agent_id: UUID,
    payload: schemas.AiUniversalAgentVersionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_drafts", "edit")),
):
    try:
        return await crud.create_universal_agent_version(db, agent_id, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/ai-universal-agents/{agent_id}/versions/{version_id}/publish", response_model=schemas.AiUniversalAgentVersionResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def publish_ai_universal_agent_version(
    agent_id: UUID,
    version_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_publish", "edit")),
):
    try:
        return await crud.publish_universal_agent_version(db, agent_id, version_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/ai-universal-agents/{agent_id}/versions/{version_id}/export", dependencies=[Depends(require_feature("ai.engine"))])
async def export_ai_universal_agent(
    agent_id: UUID,
    version_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_view", "read")),
):
    version = (await db.execute(select(models.AiUniversalAgentVersion).filter(models.AiUniversalAgentVersion.id == version_id, models.AiUniversalAgentVersion.agent_id == agent_id))).scalar_one_or_none()
    if not version:
        raise HTTPException(status_code=404, detail="Version de agente universal no encontrada.")
    return crud.export_universal_agent_package(version)


@router.post("/ai-universal-agents/import", response_model=schemas.AiUniversalAgentResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def import_ai_universal_agent(
    payload: schemas.AiUniversalAgentImport,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_drafts", "edit")),
):
    try:
        return await crud.import_universal_agent_package(db, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.post("/ai-workflows/", response_model=schemas.AiWorkflowResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def create_ai_workflow(
    payload: schemas.AiWorkflowCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_drafts", "edit")),
):
    try:
        return await crud.create_ai_workflow(db, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.post("/ai-workflows/import", response_model=schemas.AiWorkflowResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def import_ai_workflow(
    payload: schemas.AiWorkflowImport,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_drafts", "edit")),
):
    try:
        return await crud.import_ai_workflow(db, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.post("/ai-workflows/import-universal-package", response_model=schemas.AiWorkflowResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def import_ai_universal_workflow_package(
    payload: schemas.AiUniversalWorkflowImport,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_drafts", "edit")),
):
    try:
        return await crud.import_universal_workflow_package(db, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.get("/ai-workflows/{workflow_id}", response_model=schemas.AiWorkflowResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def get_ai_workflow(
    workflow_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_view", "read")),
):
    try:
        return await crud.get_ai_workflow(db, workflow_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

@router.post("/ai-workflows/{workflow_id}/validate", response_model=schemas.AiWorkflowValidationResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def validate_ai_workflow(
    workflow_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_view", "read")),
):
    try:
        workflow = await crud.get_ai_workflow(db, workflow_id)
        issues = await crud.validate_workflow_graph(db, workflow)
        return {"workflow_id": workflow.id, "valid": not any(item["severity"] == "error" for item in issues), "issues": issues}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

@router.put("/ai-workflows/{workflow_id}", response_model=schemas.AiWorkflowResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def update_ai_workflow(
    workflow_id: UUID,
    payload: schemas.AiWorkflowUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_drafts", "edit")),
):
    try:
        return await crud.update_ai_workflow(db, workflow_id, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.post("/ai-workflows/{workflow_id}/duplicate", response_model=schemas.AiWorkflowResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def duplicate_ai_workflow(
    workflow_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_drafts", "edit")),
):
    try:
        return await crud.duplicate_ai_workflow(db, workflow_id, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

@router.post("/ai-workflows/{workflow_id}/copy-as-blocks", response_model=schemas.AiWorkflowResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def copy_ai_workflow_as_blocks(
    workflow_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_drafts", "edit")),
):
    try:
        return await crud.copy_ai_workflow_as_blocks(db, workflow_id, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

@router.post("/ai-workflows/{workflow_id}/copy-as-universal", response_model=schemas.AiWorkflowResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def copy_ai_workflow_as_universal(
    workflow_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_drafts", "edit")),
):
    try:
        return await crud.copy_ai_workflow_as_universal(db, workflow_id, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.post("/ai-workflows/{workflow_id}/copy-as-universal-v3", response_model=schemas.AiWorkflowResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def copy_ai_workflow_as_universal_v3(
    workflow_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_drafts", "edit")),
):
    try:
        return await crud.copy_ai_workflow_as_universal_v3(db, workflow_id, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.post("/ai-workflows/{workflow_id}/archive", response_model=schemas.AiWorkflowResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def archive_ai_workflow(
    workflow_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_archive", "edit")),
):
    try:
        return await crud.archive_ai_workflow(db, workflow_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.post("/ai-workflows/{workflow_id}/restore-default", response_model=schemas.AiWorkflowResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def restore_default_ai_workflow(
    workflow_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_activate", "edit")),
):
    try:
        return await crud.restore_default_ai_workflow(db, workflow_id, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

@router.get("/ai-workflows/{workflow_id}/export", response_model=schemas.AiWorkflowExport, dependencies=[Depends(require_feature("ai.engine"))])
async def export_ai_workflow(
    workflow_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_view", "read")),
):
    try:
        return await crud.export_ai_workflow(db, workflow_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

@router.get("/ai-workflows/{workflow_id}/export-universal-package", dependencies=[Depends(require_feature("ai.engine"))])
async def export_ai_universal_workflow_package(
    workflow_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_view", "read")),
):
    try:
        return await crud.export_universal_workflow_package(db, workflow_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.get("/ai-workflows/{workflow_id}/versions", response_model=List[schemas.AiWorkflowVersionResponse], dependencies=[Depends(require_feature("ai.engine"))])
async def list_ai_workflow_versions(
    workflow_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_view", "read")),
):
    return await crud.list_ai_workflow_versions(db, workflow_id)

@router.post("/ai-workflows/{workflow_id}/versions", response_model=schemas.AiWorkflowVersionResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def publish_ai_workflow_version(
    workflow_id: UUID,
    payload: schemas.AiWorkflowPublishRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_publish", "edit")),
):
    try:
        return await crud.publish_ai_workflow_version(db, workflow_id, payload.changelog, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.get("/ai-workflows/{workflow_id}/versions/{version}", response_model=schemas.AiWorkflowVersionResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def get_ai_workflow_version(
    workflow_id: UUID,
    version: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_view", "read")),
):
    try:
        return await crud.get_ai_workflow_version(db, workflow_id, version)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

@router.post("/ai-workflows/{workflow_id}/versions/{version}/activate", response_model=schemas.AiWorkflowResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def activate_ai_workflow_version(
    workflow_id: UUID,
    version: int,
    payload: schemas.AiWorkflowActivateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_activate", "edit")),
):
    try:
        confirm = bool(payload.confirm_running and current_user.rol == models.Rol.ADMIN)
        return await crud.activate_ai_workflow_version(db, workflow_id, version, confirm, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))

@router.post("/ai-workflows/{workflow_id}/versions/{version}/rollback", response_model=schemas.AiWorkflowResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def rollback_ai_workflow(
    workflow_id: UUID,
    version: int,
    payload: schemas.AiWorkflowRollbackRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_drafts", "edit")),
):
    try:
        return await crud.restore_ai_workflow_version_as_draft(db, workflow_id, version, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

@router.post("/ai-workflows/{workflow_id}/versions/{version}/rollback-activate", response_model=schemas.AiWorkflowResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def rollback_and_activate_ai_workflow(
    workflow_id: UUID,
    version: int,
    payload: schemas.AiWorkflowActivateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_activate", "edit")),
):
    try:
        confirm = bool(payload.confirm_running and current_user.rol == models.Rol.ADMIN)
        return await crud.rollback_ai_workflow_and_activate(db, workflow_id, version, confirm, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))

@router.get("/ai-agent-presets/", response_model=List[schemas.AiAgentPresetResponse], dependencies=[Depends(require_feature("ai.engine"))])
async def list_ai_agent_presets(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_view", "read")),
):
    return await crud.list_ai_agent_presets(db)

@router.post("/ai-agent-presets/", response_model=schemas.AiAgentPresetResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def create_ai_agent_preset(
    payload: schemas.AiAgentPresetCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_drafts", "edit")),
):
    if payload.type == "script_agent" and not _script_agent_allowed(current_user):
        raise HTTPException(status_code=403, detail="script_agent esta deshabilitado")
    return await crud.create_ai_agent_preset(db, payload, current_user.id)

@router.put("/ai-agent-presets/{preset_id}", response_model=schemas.AiAgentPresetResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def update_ai_agent_preset(
    preset_id: UUID,
    payload: schemas.AiAgentPresetUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_drafts", "edit")),
):
    try:
        if payload.type == "script_agent" and not _script_agent_allowed(current_user):
            raise HTTPException(status_code=403, detail="script_agent esta deshabilitado")
        return await crud.update_ai_agent_preset(db, preset_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

@router.post("/ai-workflows/{workflow_id}/nodes/from-preset", response_model=schemas.AiWorkflowResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def add_workflow_node_from_preset(
    workflow_id: UUID,
    payload: schemas.AiWorkflowNodeFromPresetRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflow_drafts", "edit")),
):
    try:
        return await crud.add_workflow_node_from_preset(db, workflow_id, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
