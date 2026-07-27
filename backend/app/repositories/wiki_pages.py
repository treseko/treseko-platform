from .repository_context import *

async def get_wiki_pages_proyecto(db: AsyncSession, proyecto_id: UUID, skip: int = 0, limit: int = 100):
    result = await db.execute(
        select(models.WikiPage)
        .filter(models.WikiPage.proyecto_id == proyecto_id)
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()

async def get_wiki_page(db: AsyncSession, page_id: UUID):
    result = await db.execute(select(models.WikiPage).filter(models.WikiPage.id == page_id))
    return result.scalar_one_or_none()

async def create_wiki_page(db: AsyncSession, page: schemas.WikiPageCreate):
    db_page = models.WikiPage(**page.model_dump())
    db.add(db_page)
    await db.flush()
    # Crear entrada inicial en el historial
    db_history = models.WikiHistory(
        page_id=db_page.id,
        contenido=db_page.contenido,
        editado_por=db_page.creado_por,
        comentario_cambio="Creación inicial"
    )
    db.add(db_history)
    await db.commit()
    await db.refresh(db_page)
    return db_page

async def update_wiki_page(db: AsyncSession, page_id: UUID, content: str, user_id: UUID, comment: str):
    result = await db.execute(select(models.WikiPage).filter(models.WikiPage.id == page_id))
    db_page = result.scalar_one_or_none()
    if not db_page: return None
    db_page.contenido = content
    db_page.ultima_edicion_por = user_id
    db_history = models.WikiHistory(
        page_id=page_id,
        contenido=content,
        editado_por=user_id,
        comentario_cambio=comment
    )
    db.add(db_history)
    await db.commit()
    await db.refresh(db_page)
    return db_page

async def update_wiki_page_data(db: AsyncSession, page_id: UUID, page_update: schemas.WikiPageUpdate, user_id: UUID):
    result = await db.execute(select(models.WikiPage).filter(models.WikiPage.id == page_id))
    db_page = result.scalar_one_or_none()
    if not db_page:
        return None
    update_data = page_update.model_dump(exclude_unset=True)
    if "titulo" in update_data:
        db_page.titulo = update_data["titulo"]
    if "contenido" in update_data:
        db_page.contenido = update_data["contenido"]
    db_page.ultima_edicion_por = user_id
    db_history = models.WikiHistory(
        page_id=page_id,
        contenido=db_page.contenido,
        editado_por=user_id,
        comentario_cambio=update_data.get("comentario_cambio") or "Edicion de contenido",
    )
    db.add(db_history)
    await db.commit()
    await db.refresh(db_page)
    return db_page

async def get_wiki_history(db: AsyncSession, page_id: UUID, skip: int = 0, limit: int = 100):
    result = await db.execute(
        select(models.WikiHistory)
        .filter(models.WikiHistory.page_id == page_id)
        .order_by(models.WikiHistory.fecha_edicion.desc())
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()

async def delete_wiki_page(db: AsyncSession, page_id: UUID):
    result = await db.execute(select(models.WikiPage).filter(models.WikiPage.id == page_id))
    db_page = result.scalar_one_or_none()
    if not db_page:
        return False
    await db.delete(db_page)
    await db.commit()
    return True
