import asyncio
import secrets
import uuid

from fastapi import APIRouter, Depends

from ...main_context import *
from ...services.edition.entitlement_service import require_feature
from ...services.error_sanitizer import sanitize_external_error
from ...services.ai_dry_run_stream import ai_dry_run_stream


router = APIRouter(tags=["Motor IA"])


@router.post("/ai-engine/dry-run/start", dependencies=[Depends(require_feature("ai.basic_execution"))])
async def start_ai_engine_dry_run(
    payload: schemas.AiEngineDryRunRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.scripts", "edit")),
):
    if not auth.has_capability_permission(current_user, "motor_ia.ver", "read"):
        raise HTTPException(status_code=403, detail="Necesitas permiso de Motor IA para testear pruebas con IA")
    await access_control.require_project_access(db, current_user, payload.proyecto_id, "edit")
    run_id = f"AI-DRY-RUN-{uuid.uuid4().hex[:12]}"
    callback_token = secrets.token_urlsafe(32)
    await ai_dry_run_stream.register(run_id, str(payload.proyecto_id), callback_token)

    async def execute() -> None:
        try:
            async with AsyncSessionLocal() as background_db:
                result = await crud.run_ai_engine_dry_run(
                    background_db,
                    payload,
                    run_id=run_id,
                    progress_callback_token=callback_token,
                )
            await ai_dry_run_stream.publish(run_id, {"type": "DRY_RUN_RESULT", **result.model_dump(mode="json")})
        except Exception as exc:
            await ai_dry_run_stream.publish(run_id, {
                "type": "ERROR",
                "status": "FALLO",
                "error_message": sanitize_external_error(exc, max_len=800),
                "message": "El dry-run IA no pudo completarse.",
            })

    asyncio.create_task(execute())
    return {"run_id": run_id, "status": "RUNNING"}
