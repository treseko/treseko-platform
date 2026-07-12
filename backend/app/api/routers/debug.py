from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from ...main_context import auth, engine, models, write_trace
from ...schema_sections.auth import validate_preference_json_payload
from ...services.error_sanitizer import sanitize_external_error
from ...test_trace import trace_enabled


router = APIRouter(tags=["Debug"])
MAX_FRONTEND_TRACE_PAYLOAD_BYTES = 64 * 1024


@router.post("/debug/test-trace/frontend")
async def receive_frontend_test_trace(
    payload: dict[str, Any],
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.monitor", "read")),
):
    if not trace_enabled():
        raise HTTPException(status_code=404, detail="Test trace no disponible")
    try:
        validate_preference_json_payload(
            payload,
            max_bytes=MAX_FRONTEND_TRACE_PAYLOAD_BYTES,
            label="La traza frontend",
        )
    except ValueError as exc:
        raise HTTPException(status_code=413, detail=str(exc))
    write_trace("frontend", str(payload.get("event") or "frontend_event"), payload)
    return {"ok": True}


@router.get("/debug/proyectos")
async def debug_proyectos(
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.monitor", "read")),
):
    try:
        async with engine.connect() as conn:
            if conn.dialect.name == "sqlite":
                result = await conn.execute(text("PRAGMA table_info(proyectos)"))
                columns = [col[1] for col in result.fetchall()]
            else:
                result = await conn.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_name = 'proyectos' ORDER BY ordinal_position"
                    )
                )
                columns = [row[0] for row in result.fetchall()]

            return {
                "columns": columns,
                "column_count": len(columns),
                "table": "proyectos",
                "status": "ok",
            }
    except Exception as exc:
        return {"error": sanitize_external_error(exc), "status": "error"}
