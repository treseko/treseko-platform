from fastapi import APIRouter
from typing import Annotated

from ...main_context import *


router = APIRouter(tags=["wiki"])

# --- ENDPOINTS WIKI ---

async def _require_wiki_page_access(
    db: AsyncSession,
    current_user: models.Usuario,
    page_id: UUID,
    level: str = "read",
):
    page = await crud.get_wiki_page(db, page_id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Pagina Wiki no encontrada")
    await access_control.require_project_access(db, current_user, page.proyecto_id, level)
    return page

@router.get("/proyectos/{proyecto_id}/wiki/", response_model=List[schemas.WikiPage])
async def read_wiki_pages(
    proyecto_id: UUID, 
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.wiki", "read"))
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    return await crud.get_wiki_pages_proyecto(db, proyecto_id=proyecto_id, skip=skip, limit=limit)

@router.get("/wiki/{page_id}", response_model=schemas.WikiPage)
async def read_wiki_page(
    page_id: UUID, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.wiki", "read"))
):
    page = await crud.get_wiki_page(db, page_id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Página Wiki no encontrada")
    await access_control.require_project_access(db, current_user, page.proyecto_id, "read")
    return page

@router.post("/wiki/", response_model=schemas.WikiPage)
async def create_wiki_page(
    page: schemas.WikiPageCreate, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.wiki", "edit"))
):
    await access_control.require_project_access(db, current_user, page.proyecto_id, "edit")
    page.creado_por = current_user.id
    return await crud.create_wiki_page(db, page=page)

@router.patch("/wiki/{page_id}", response_model=schemas.WikiPage)
async def update_wiki_page(
    page_id: UUID,
    page: schemas.WikiPageUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.wiki", "edit"))
):
    await _require_wiki_page_access(db, current_user, page_id, "edit")
    db_page = await crud.update_wiki_page_data(db=db, page_id=page_id, page_update=page, user_id=current_user.id)
    if not db_page:
        raise HTTPException(status_code=404, detail="Pagina Wiki no encontrada")
    return db_page

@router.get("/wiki/{page_id}/history/", response_model=List[schemas.WikiHistory])
async def read_wiki_history(
    page_id: UUID, 
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.wiki", "read"))
):
    await _require_wiki_page_access(db, current_user, page_id, "read")
    return await crud.get_wiki_history(db=db, page_id=page_id, skip=skip, limit=limit)

@router.delete("/wiki/{page_id}")
async def delete_wiki_page(
    page_id: UUID, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.wiki", "edit"))
):
    await _require_wiki_page_access(db, current_user, page_id, "edit")
    deleted = await crud.delete_wiki_page(db=db, page_id=page_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Pagina Wiki no encontrada")
    return {"ok": True}
