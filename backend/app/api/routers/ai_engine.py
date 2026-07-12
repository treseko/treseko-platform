import secrets

from fastapi import APIRouter

from ...main_context import _emit_ai_engine_unavailable_event
from ...services.edition.entitlement_service import require_feature
from ...services.error_sanitizer import sanitize_external_error
from ...main_context import *


router = APIRouter(tags=["Motor IA"])
MAX_AI_ENGINE_CALLBACK_TOKEN_LENGTH = 256


def _normalize_ai_engine_callback_token(value: Optional[str]) -> str:
    token = (value or "").strip()
    if (
        not token
        or len(token) > MAX_AI_ENGINE_CALLBACK_TOKEN_LENGTH
        or any(char.isspace() for char in token)
        or "\x00" in token
    ):
        raise HTTPException(status_code=403, detail="Token de Motor IA invalido")
    return token

async def _require_ai_execution_project_access(
    db: AsyncSession,
    current_user: models.Usuario,
    execution_id: UUID,
    level: str = "read",
):
    result = await db.execute(
        select(models.EjecucionCaso, models.TestRun)
        .join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
        .filter(models.EjecucionCaso.id == execution_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Ejecucion no encontrada")
    _execution, run = row
    await access_control.require_project_access(db, current_user, run.proyecto_id, level)
    return run

@router.get("/ai-engine/config", response_model=schemas.AiEngineConfig, dependencies=[Depends(require_feature("ai.engine"))])
async def get_ai_engine_config(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.configuracion", "read")),
):
    return await crud.get_ai_engine_public_config(db)

@router.put("/ai-engine/config", response_model=schemas.AiEngineConfig, dependencies=[Depends(require_feature("ai.engine"))])
async def update_ai_engine_config(
    payload: schemas.AiEngineConfig,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.configuracion", "edit")),
):
    return await crud.update_ai_engine_config(db, payload)

@router.post("/ai-engine/models/scan", response_model=schemas.AiModelScanResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def scan_ai_engine_models(
    payload: schemas.AiModelScanRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.configuracion", "read")),
):
    return await crud.scan_ai_engine_models(db, payload)

@router.get("/ai-workflows/", response_model=List[schemas.AiWorkflowResponse], dependencies=[Depends(require_feature("ai.engine"))])
async def list_ai_workflows(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflows", "read")),
):
    return await crud.list_ai_workflows(db)

@router.post("/ai-workflows/", response_model=schemas.AiWorkflowResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def create_ai_workflow(
    payload: schemas.AiWorkflowCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflows", "edit")),
):
    try:
        return await crud.create_ai_workflow(db, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.post("/ai-workflows/import", response_model=schemas.AiWorkflowResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def import_ai_workflow(
    payload: schemas.AiWorkflowImport,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflows", "edit")),
):
    try:
        return await crud.import_ai_workflow(db, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.get("/ai-workflows/{workflow_id}", response_model=schemas.AiWorkflowResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def get_ai_workflow(
    workflow_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflows", "read")),
):
    try:
        return await crud.get_ai_workflow(db, workflow_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

@router.put("/ai-workflows/{workflow_id}", response_model=schemas.AiWorkflowResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def update_ai_workflow(
    workflow_id: UUID,
    payload: schemas.AiWorkflowUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflows", "edit")),
):
    try:
        return await crud.update_ai_workflow(db, workflow_id, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.post("/ai-workflows/{workflow_id}/duplicate", response_model=schemas.AiWorkflowResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def duplicate_ai_workflow(
    workflow_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflows", "edit")),
):
    try:
        return await crud.duplicate_ai_workflow(db, workflow_id, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

@router.post("/ai-workflows/{workflow_id}/archive", response_model=schemas.AiWorkflowResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def archive_ai_workflow(
    workflow_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflows", "edit")),
):
    try:
        return await crud.archive_ai_workflow(db, workflow_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.post("/ai-workflows/{workflow_id}/restore-default", response_model=schemas.AiWorkflowResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def restore_default_ai_workflow(
    workflow_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflows", "edit")),
):
    try:
        return await crud.restore_default_ai_workflow(db, workflow_id, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

@router.get("/ai-workflows/{workflow_id}/export", response_model=schemas.AiWorkflowExport, dependencies=[Depends(require_feature("ai.engine"))])
async def export_ai_workflow(
    workflow_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflows", "read")),
):
    try:
        return await crud.export_ai_workflow(db, workflow_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

@router.get("/ai-workflows/{workflow_id}/versions", response_model=List[schemas.AiWorkflowVersionResponse], dependencies=[Depends(require_feature("ai.engine"))])
async def list_ai_workflow_versions(
    workflow_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflows", "read")),
):
    return await crud.list_ai_workflow_versions(db, workflow_id)

@router.post("/ai-workflows/{workflow_id}/versions", response_model=schemas.AiWorkflowVersionResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def publish_ai_workflow_version(
    workflow_id: UUID,
    payload: schemas.AiWorkflowPublishRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflows", "edit")),
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
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflows", "read")),
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
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflows", "edit")),
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
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflows", "edit")),
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
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflows", "edit")),
):
    try:
        confirm = bool(payload.confirm_running and current_user.rol == models.Rol.ADMIN)
        return await crud.rollback_ai_workflow_and_activate(db, workflow_id, version, confirm, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))

@router.get("/ai-agent-presets/", response_model=List[schemas.AiAgentPresetResponse], dependencies=[Depends(require_feature("ai.engine"))])
async def list_ai_agent_presets(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflows", "read")),
):
    return await crud.list_ai_agent_presets(db)

@router.post("/ai-agent-presets/", response_model=schemas.AiAgentPresetResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def create_ai_agent_preset(
    payload: schemas.AiAgentPresetCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflows", "edit")),
):
    if payload.type == "script_agent" and not _script_agent_allowed(current_user):
        raise HTTPException(status_code=403, detail="script_agent esta deshabilitado")
    return await crud.create_ai_agent_preset(db, payload, current_user.id)

@router.put("/ai-agent-presets/{preset_id}", response_model=schemas.AiAgentPresetResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def update_ai_agent_preset(
    preset_id: UUID,
    payload: schemas.AiAgentPresetUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflows", "edit")),
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
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.workflows", "edit")),
):
    try:
        return await crud.add_workflow_node_from_preset(db, workflow_id, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.get("/ai-engine/executions/{execution_id}/traces", response_model=List[schemas.AiExecutionTraceResponse])
async def get_ai_execution_traces(
    execution_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.ver", "read")),
):
    await _require_ai_execution_project_access(db, current_user, execution_id, "read")
    return await crud.list_ai_execution_traces(db, execution_id)

@router.get("/ai-engine/health", response_model=schemas.AiEngineHealth)
async def get_ai_engine_health(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.ver", "read")),
):
    return await crud.check_ai_engine_health(db)

@router.post("/ai-engine/executions/{ejecucion_id}/result", response_model=schemas.EjecucionCaso)
async def complete_ai_engine_execution(
    ejecucion_id: UUID,
    payload: schemas.AiEngineExecutionResult,
    x_ai_engine_token: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    raw_expected_token = os.getenv("AI_ENGINE_CALLBACK_TOKEN")
    if not raw_expected_token:
        raise HTTPException(status_code=503, detail="Token de callback de Motor IA no configurado")
    expected_token = _normalize_ai_engine_callback_token(raw_expected_token)
    provided_token = _normalize_ai_engine_callback_token(x_ai_engine_token)
    if not secrets.compare_digest(provided_token, expected_token):
        raise HTTPException(status_code=403, detail="Token de Motor IA invalido")
    try:
        return await crud.complete_ai_engine_execution(db, ejecucion_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

@router.post("/ai-engine/dry-run", response_model=schemas.AiEngineDryRunResult, dependencies=[Depends(require_feature("ai.basic_execution"))])
async def run_ai_engine_dry_run(
    payload: schemas.AiEngineDryRunRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.scripts", "edit")),
):
    if not auth.has_capability_permission(current_user, "motor_ia.ver", "read"):
        raise HTTPException(status_code=403, detail="Necesitas permiso de Motor IA para testear pruebas con IA")
    await access_control.require_project_access(db, current_user, payload.proyecto_id, "edit")
    project = (
        await db.execute(select(models.Proyecto).filter(models.Proyecto.id == payload.proyecto_id))
    ).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    try:
        return await crud.run_ai_engine_dry_run(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ConnectionError as exc:
        safe_error = sanitize_external_error(exc)
        await _emit_ai_engine_unavailable_event(db, actor=current_user, detail=safe_error)
        raise HTTPException(status_code=503, detail=safe_error)
