from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from ... import access_control, auth, crud, models
from ...main_context import AsyncSession, get_db
from ...services.api_bug_context import resolve_bug_api_context


router = APIRouter(tags=["bugs"])


@router.get("/bugs/{bug_id}/api-context/")
async def read_api_bug_context(
    bug_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_any_capability(("incidencias.ver", "read"), ("bugs.ver", "read"))),
):
    bug = await crud.get_bug_issue(db, bug_id)
    if not bug:
        raise HTTPException(status_code=404, detail="Bug no encontrado")
    await access_control.require_project_access(db, current_user, bug.proyecto_id, "read")
    context = await resolve_bug_api_context(db, bug)
    if not context:
        raise HTTPException(status_code=409, detail="El bug no tiene contexto de ejecución API.")
    return context
