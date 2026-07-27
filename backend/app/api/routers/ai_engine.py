import secrets

from fastapi import APIRouter
import jwt
from jwt import InvalidTokenError as JWTError
from pydantic import ValidationError

from ...main_context import _emit_ai_engine_unavailable_event
from ...services.edition.entitlement_service import require_feature
from ...services.error_sanitizer import sanitize_external_error
from ...main_context import *


router = APIRouter(tags=["Motor IA"])
MAX_AI_ENGINE_CALLBACK_TOKEN_LENGTH = 2048


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


def _is_valid_generated_callback_token(token: str, ejecucion_id: UUID) -> bool:
    try:
        payload = jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
    except JWTError:
        return False
    return (
        payload.get("type") == "engine_callback"
        and payload.get("scope") == "ai-engine-callback"
        and payload.get("sub") == "ai-engine"
        and payload.get("execution_id") == str(ejecucion_id)
    )

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
    try:
        return await crud.update_ai_engine_config(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get("/ai-provider-credentials/", response_model=List[schemas.AiProviderCredentialResponse], dependencies=[Depends(require_feature("ai.engine"))])
async def list_ai_provider_credentials(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.configuracion", "read")),
):
    return await crud.list_ai_provider_credentials(db)


@router.post("/ai-provider-credentials/", response_model=schemas.AiProviderCredentialResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def create_ai_provider_credential(
    payload: schemas.AiProviderCredentialCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.configuracion", "edit")),
):
    try:
        result = await crud.create_ai_provider_credential(db, payload, current_user.id)
        await crud.create_audit_log(db=db, usuario_id=current_user.id, accion="CREATE", recurso="ai_provider_credential", recurso_id=result["id"], detalles={"provider": result["provider"], "label": result["label"]})
        return result
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/ai-provider-credentials/migrate-legacy", dependencies=[Depends(require_feature("ai.engine"))])
async def migrate_legacy_ai_provider_credentials(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.configuracion", "edit")),
):
    try:
        result = await crud.migrate_legacy_ai_provider_credentials(db, current_user.id)
        await crud.create_audit_log(
            db=db, usuario_id=current_user.id, accion="MIGRATE",
            recurso="ai_provider_credential", recurso_id=None,
            detalles={"migrated_count": result["migrated_count"]},
        )
        return result
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.put("/ai-provider-credentials/{credential_id}", response_model=schemas.AiProviderCredentialResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def replace_ai_provider_credential(
    credential_id: UUID,
    payload: schemas.AiProviderCredentialReplace,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.configuracion", "edit")),
):
    try:
        result = await crud.replace_ai_provider_credential(db, credential_id, payload)
        await crud.create_audit_log(db=db, usuario_id=current_user.id, accion="ROTATE", recurso="ai_provider_credential", recurso_id=credential_id, detalles={"provider": result["provider"]})
        return result
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.patch("/ai-provider-credentials/{credential_id}", response_model=schemas.AiProviderCredentialResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def update_ai_provider_credential(
    credential_id: UUID,
    payload: schemas.AiProviderCredentialUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.configuracion", "edit")),
):
    try:
        result = await crud.update_ai_provider_credential(db, credential_id, payload)
        await crud.create_audit_log(db=db, usuario_id=current_user.id, accion="UPDATE", recurso="ai_provider_credential", recurso_id=credential_id, detalles={"provider": result["provider"], "label": result["label"]})
        return result
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/ai-provider-credentials/{credential_id}", response_model=schemas.AiProviderCredentialResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def disable_ai_provider_credential(
    credential_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.configuracion", "edit")),
):
    try:
        result = await crud.disable_ai_provider_credential(db, credential_id)
        await crud.create_audit_log(db=db, usuario_id=current_user.id, accion="DISABLE", recurso="ai_provider_credential", recurso_id=credential_id, detalles={"provider": result["provider"]})
        return result
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/ai-provider-profiles/", response_model=List[schemas.AiProviderProfileResponse], dependencies=[Depends(require_feature("ai.engine"))])
async def list_ai_provider_profiles(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.configuracion", "read")),
):
    return await crud.list_ai_provider_profiles(db)


@router.post("/ai-provider-profiles/", response_model=schemas.AiProviderProfileResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def create_ai_provider_profile(
    payload: schemas.AiProviderProfileCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.configuracion", "edit")),
):
    try:
        result = await crud.create_ai_provider_profile(db, payload, current_user.id)
        await crud.create_audit_log(db=db, usuario_id=current_user.id, accion="CREATE", recurso="ai_provider_profile", recurso_id=result["id"], detalles={"provider": result["provider"], "adapter": result["adapter"], "model": result["model"]})
        return result
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.patch("/ai-provider-profiles/{profile_id}", response_model=schemas.AiProviderProfileResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def update_ai_provider_profile(
    profile_id: UUID,
    payload: schemas.AiProviderProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.configuracion", "edit")),
):
    try:
        result = await crud.update_ai_provider_profile(db, profile_id, payload)
        await crud.create_audit_log(db=db, usuario_id=current_user.id, accion="UPDATE", recurso="ai_provider_profile", recurso_id=profile_id, detalles={"provider": result["provider"], "model": result["model"]})
        return result
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/ai-provider-profiles/{profile_id}/activate", dependencies=[Depends(require_feature("ai.engine"))])
async def activate_ai_provider_profile(
    profile_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.configuracion", "edit")),
):
    try:
        result = await crud.activate_ai_provider_profile(db, profile_id)
        await crud.create_audit_log(db=db, usuario_id=current_user.id, accion="ACTIVATE", recurso="ai_provider_profile", recurso_id=profile_id, detalles={"provider": result["profile"]["provider"]})
        return result
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/ai-provider-profiles/{profile_id}/test", dependencies=[Depends(require_feature("ai.engine"))])
async def test_ai_provider_profile(
    profile_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.configuracion", "edit")),
):
    try:
        result = await crud.test_ai_provider_profile(db, profile_id)
        await crud.create_audit_log(
            db=db, usuario_id=current_user.id, accion="TEST",
            recurso="ai_provider_profile", recurso_id=profile_id,
            detalles={"status": result["status"]},
        )
        return result
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.delete("/ai-provider-profiles/{profile_id}", response_model=schemas.AiProviderProfileResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def disable_ai_provider_profile(
    profile_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.configuracion", "edit")),
):
    try:
        result = await crud.disable_ai_provider_profile(db, profile_id)
        await crud.create_audit_log(db=db, usuario_id=current_user.id, accion="DISABLE", recurso="ai_provider_profile", recurso_id=profile_id, detalles={"provider": result["provider"]})
        return result
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

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


@router.get("/ai-engine/queue")
async def get_shared_ai_execution_queue(
    proyecto_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.ver", "read")),
):
    """Shared operational queue, scoped strictly to one authorized project."""
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    from ...services.ai_execution_queue import list_project_ai_queue
    return await list_project_ai_queue(db, proyecto_id)

@router.post("/ai-engine/executions/{ejecucion_id}/result", response_model=schemas.AiEngineExecutionAck)
async def complete_ai_engine_execution(
    ejecucion_id: UUID,
    payload: schemas.AiEngineExecutionResult,
    x_ai_engine_token: Optional[str] = Header(None),
    x_idempotency_key: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    raw_expected_token = os.getenv("AI_ENGINE_CALLBACK_TOKEN")
    provided_token = _normalize_ai_engine_callback_token(x_ai_engine_token)
    shared_token_valid = False
    if raw_expected_token:
        expected_token = _normalize_ai_engine_callback_token(raw_expected_token)
        shared_token_valid = secrets.compare_digest(provided_token, expected_token)
    generated_token_valid = _is_valid_generated_callback_token(provided_token, ejecucion_id)
    if not shared_token_valid and not generated_token_valid:
        raise HTTPException(status_code=403, detail="Token de Motor IA invalido")
    metadata = payload.metadata if isinstance(payload.metadata, dict) else {}
    delivery_id = str(metadata.get("terminal_delivery_id") or "").strip()
    if not delivery_id or len(delivery_id) > 200:
        raise HTTPException(status_code=400, detail="Falta terminal_delivery_id valido")
    if not x_idempotency_key:
        raise HTTPException(status_code=400, detail="Falta X-Idempotency-Key")
    if not secrets.compare_digest(str(x_idempotency_key), delivery_id):
        raise HTTPException(status_code=409, detail="La clave idempotente no coincide con el resultado terminal")
    try:
        execution = await crud.complete_ai_engine_execution(db, ejecucion_id, payload)
        report = execution.ai_report if isinstance(execution.ai_report, dict) else {}
        return {
            "execution_id": execution.id,
            "status": execution.estado_resultado,
            "acknowledged": report.get("report_complete") is True,
            "report_complete": report.get("report_complete") is True,
            "terminal_delivery_id": str(report.get("terminal_delivery_id") or delivery_id),
        }
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/ai-engine/executions/{ejecucion_id}/recover-from-engine-log")
async def recover_ai_execution_from_engine_log(
    ejecucion_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.ver", "read")),
):
    await _require_ai_execution_project_access(db, current_user, ejecucion_id, "edit")
    try:
        execution = await crud.recover_ai_execution_from_engine_log(db, ejecucion_id)
        report = execution.ai_report if isinstance(execution.ai_report, dict) else {}
        return {
            "execution_id": execution.id,
            "status": execution.estado_resultado,
            "report_complete": report.get("report_complete") is True,
            "recovered": report.get("recovered") is True,
        }
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))

@router.post("/ai-engine/dry-run", response_model=schemas.AiEngineDryRunResult, dependencies=[Depends(require_feature("ai.basic_execution"))])
async def run_ai_engine_dry_run(
    payload: schemas.AiEngineDryRunRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.scripts", "edit")),
):
    if not auth.has_capability_permission(current_user, "motor_ia.ver", "read"):
        raise HTTPException(status_code=403, detail="Necesitas permiso de Motor IA para testear pruebas con IA")
    await access_control.require_project_access(db, current_user, payload.proyecto_id, "edit")
    try:
        return await crud.run_ai_engine_dry_run(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ConnectionError as exc:
        safe_error = sanitize_external_error(exc)
        await _emit_ai_engine_unavailable_event(db, actor=current_user, detail=safe_error)
        raise HTTPException(status_code=503, detail=safe_error)
    except ValidationError as exc:
        safe_error = sanitize_external_error(exc, max_len=800)
        raise HTTPException(
            status_code=502,
            detail=f"Motor IA devolvio un resultado con formato inesperado: {safe_error}",
        )
    except Exception as exc:
        safe_error = sanitize_external_error(exc, max_len=800)
        raise HTTPException(status_code=502, detail=f"Dry-run IA no pudo completarse: {safe_error}")
