from fastapi import APIRouter
from typing import Annotated

from ...main_context import *


router = APIRouter(tags=["wiki"])

# --- ENDPOINTS WIKI ---

def _user_display_name(user: models.Usuario | None) -> str | None:
    if not user:
        return None
    return user.display_name or user.nombre_completo or user.email


async def _wiki_author_names(db: AsyncSession, pages: list[models.WikiPage]) -> dict[UUID, str]:
    user_ids = {
        user_id
        for page in pages
        for user_id in (page.creado_por, page.ultima_edicion_por)
        if user_id
    }
    if not user_ids:
        return {}
    result = await db.execute(select(models.Usuario).where(models.Usuario.id.in_(user_ids)))
    return {
        user.id: _user_display_name(user) or str(user.id)
        for user in result.scalars().all()
    }


async def _wiki_page_response(db: AsyncSession, page: models.WikiPage) -> dict:
    authors = await _wiki_author_names(db, [page])
    return {
        **schemas.WikiPage.model_validate(page).model_dump(),
        "creado_por_display": authors.get(page.creado_por),
        "ultima_edicion_por_display": authors.get(page.ultima_edicion_por),
    }


async def _wiki_page_responses(db: AsyncSession, pages: list[models.WikiPage]) -> list[dict]:
    authors = await _wiki_author_names(db, pages)
    return [
        {
            **schemas.WikiPage.model_validate(page).model_dump(),
            "creado_por_display": authors.get(page.creado_por),
            "ultima_edicion_por_display": authors.get(page.ultima_edicion_por),
        }
        for page in pages
    ]

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
    pages = await crud.get_wiki_pages_proyecto(db, proyecto_id=proyecto_id, skip=skip, limit=limit)
    return await _wiki_page_responses(db, pages)

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
    return await _wiki_page_response(db, page)

@router.post("/wiki/", response_model=schemas.WikiPage)
async def create_wiki_page(
    page: schemas.WikiPageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.wiki", "edit"))
):
    await access_control.require_project_access(db, current_user, page.proyecto_id, "edit")
    page.creado_por = current_user.id
    created = await crud.create_wiki_page(db, page=page)
    return await _wiki_page_response(db, created)

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
    return await _wiki_page_response(db, db_page)

@router.get("/wiki/{page_id}/history/", response_model=List[schemas.WikiHistory])
async def read_wiki_history(
    page_id: UUID,
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.wiki", "read"))
):
    await _require_wiki_page_access(db, current_user, page_id, "read")
    entries = await crud.get_wiki_history(db=db, page_id=page_id, skip=skip, limit=limit)
    user_ids = {entry.editado_por for entry in entries if entry.editado_por}
    users = {}
    if user_ids:
        result = await db.execute(select(models.Usuario).where(models.Usuario.id.in_(user_ids)))
        users = {user.id: _user_display_name(user) or str(user.id) for user in result.scalars().all()}
    return [
        {
            **schemas.WikiHistory.model_validate(entry).model_dump(),
            "editado_por_display": users.get(entry.editado_por),
        }
        for entry in entries
    ]

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
