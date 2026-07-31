from fastapi import APIRouter
from ...services.edition.entitlement_service import require_feature
from ...services.audit_context import audit_request_context
from ...main_context import *

router = APIRouter(tags=["Motor IA"])

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
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.configuracion", "edit")),
):
    try:
        result = await crud.create_ai_provider_credential(db, payload, current_user.id)
        await crud.create_audit_log(db=db, usuario_id=current_user.id, accion="CREATE", recurso="ai_provider_credential", recurso_id=result["id"], detalles={"provider": result["provider"], "label": result["label"], "result": "success"}, **audit_request_context(request))
        return result
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/ai-provider-credentials/migrate-legacy", dependencies=[Depends(require_feature("ai.engine"))])
async def migrate_legacy_ai_provider_credentials(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.configuracion", "edit")),
):
    try:
        result = await crud.migrate_legacy_ai_provider_credentials(db, current_user.id)
        await crud.create_audit_log(
            db=db, usuario_id=current_user.id, accion="MIGRATE",
            recurso="ai_provider_credential", recurso_id=None,
            detalles={"migrated_count": result["migrated_count"], "result": "success"},
            **audit_request_context(request),
        )
        return result
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.put("/ai-provider-credentials/{credential_id}", response_model=schemas.AiProviderCredentialResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def replace_ai_provider_credential(
    credential_id: UUID,
    payload: schemas.AiProviderCredentialReplace,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.configuracion", "edit")),
):
    try:
        result = await crud.replace_ai_provider_credential(db, credential_id, payload)
        await crud.create_audit_log(db=db, usuario_id=current_user.id, accion="ROTATE", recurso="ai_provider_credential", recurso_id=credential_id, detalles={"provider": result["provider"], "result": "success"}, **audit_request_context(request))
        return result
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.patch("/ai-provider-credentials/{credential_id}", response_model=schemas.AiProviderCredentialResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def update_ai_provider_credential(
    credential_id: UUID,
    payload: schemas.AiProviderCredentialUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.configuracion", "edit")),
):
    try:
        result = await crud.update_ai_provider_credential(db, credential_id, payload)
        await crud.create_audit_log(db=db, usuario_id=current_user.id, accion="UPDATE", recurso="ai_provider_credential", recurso_id=credential_id, detalles={"provider": result["provider"], "label": result["label"], "result": "success"}, **audit_request_context(request))
        return result
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/ai-provider-credentials/{credential_id}", response_model=schemas.AiProviderCredentialResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def disable_ai_provider_credential(
    credential_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.configuracion", "edit")),
):
    try:
        result = await crud.disable_ai_provider_credential(db, credential_id)
        await crud.create_audit_log(db=db, usuario_id=current_user.id, accion="DISABLE", recurso="ai_provider_credential", recurso_id=credential_id, detalles={"provider": result["provider"], "result": "success"}, **audit_request_context(request))
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
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.configuracion", "edit")),
):
    try:
        result = await crud.create_ai_provider_profile(db, payload, current_user.id)
        await crud.create_audit_log(db=db, usuario_id=current_user.id, accion="CREATE", recurso="ai_provider_profile", recurso_id=result["id"], detalles={"provider": result["provider"], "adapter": result["adapter"], "model": result["model"], "result": "success"}, **audit_request_context(request))
        return result
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.patch("/ai-provider-profiles/{profile_id}", response_model=schemas.AiProviderProfileResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def update_ai_provider_profile(
    profile_id: UUID,
    payload: schemas.AiProviderProfileUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.configuracion", "edit")),
):
    try:
        result = await crud.update_ai_provider_profile(db, profile_id, payload)
        await crud.create_audit_log(db=db, usuario_id=current_user.id, accion="UPDATE", recurso="ai_provider_profile", recurso_id=profile_id, detalles={"provider": result["provider"], "model": result["model"], "result": "success"}, **audit_request_context(request))
        return result
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/ai-provider-profiles/{profile_id}/activate", dependencies=[Depends(require_feature("ai.engine"))])
async def activate_ai_provider_profile(
    profile_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.configuracion", "edit")),
):
    try:
        result = await crud.activate_ai_provider_profile(db, profile_id)
        await crud.create_audit_log(db=db, usuario_id=current_user.id, accion="ACTIVATE", recurso="ai_provider_profile", recurso_id=profile_id, detalles={"provider": result["profile"]["provider"], "result": "success"}, **audit_request_context(request))
        return result
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/ai-provider-profiles/{profile_id}/test", dependencies=[Depends(require_feature("ai.engine"))])
async def test_ai_provider_profile(
    profile_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.configuracion", "edit")),
):
    try:
        result = await crud.test_ai_provider_profile(db, profile_id)
        await crud.create_audit_log(
            db=db, usuario_id=current_user.id, accion="TEST",
            recurso="ai_provider_profile", recurso_id=profile_id,
            detalles={"status": result["status"], "result": "success"},
            **audit_request_context(request),
        )
        return result
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.delete("/ai-provider-profiles/{profile_id}", response_model=schemas.AiProviderProfileResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def disable_ai_provider_profile(
    profile_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.configuracion", "edit")),
):
    try:
        result = await crud.disable_ai_provider_profile(db, profile_id)
        await crud.create_audit_log(db=db, usuario_id=current_user.id, accion="DISABLE", recurso="ai_provider_profile", recurso_id=profile_id, detalles={"provider": result["provider"], "result": "success"}, **audit_request_context(request))
        return result
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

@router.post("/ai-engine/models/scan", response_model=schemas.AiModelScanResponse, dependencies=[Depends(require_feature("ai.engine"))])
async def scan_ai_engine_models(
    payload: schemas.AiModelScanRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.configuracion", "read")),
):
    try:
        return await crud.scan_ai_engine_models(db, payload)
    except ValueError as exc:
        # A provider scan can fail because the profile, credential, endpoint,
        # or internal engine configuration is incomplete. These are expected
        # configuration errors and must not be converted into a generic 500.
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        # Keep engine/configuration failures actionable while preserving the
        # generic 500 handler for genuinely unexpected exceptions.
        raise HTTPException(status_code=503, detail=str(exc)) from exc
