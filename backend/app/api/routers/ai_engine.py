from fastapi import APIRouter
from pydantic import ValidationError

from ...main_context import *
from ...main_context import _emit_ai_engine_unavailable_event
from ...services.error_sanitizer import sanitize_external_error
from . import ai_engine_config, ai_engine_execution, ai_engine_workflows
from .ai_engine_execution import (
    complete_ai_engine_execution,
    recover_ai_execution_from_engine_log,
)
from .ai_engine_execution import _is_valid_generated_callback_token, _normalize_ai_engine_callback_token

router = APIRouter(tags=["Motor IA"])
# Keep the public router flat. Besides preserving the historical inspection
# contract, this lets FastAPI expose the same route metadata to callers that
# import this router directly.
router.routes.extend(ai_engine_config.router.routes)
router.routes.extend(ai_engine_workflows.router.routes)
router.routes.extend(ai_engine_execution.router.routes)


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


async def get_ai_execution_traces(
    execution_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("motor_ia.ver", "read")),
):
    await _require_ai_execution_project_access(db, current_user, execution_id, "read")
    return await crud.list_ai_execution_traces(db, execution_id)


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
