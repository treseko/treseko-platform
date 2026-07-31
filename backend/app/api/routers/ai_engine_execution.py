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
