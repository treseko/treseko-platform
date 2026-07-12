from fastapi import APIRouter
from typing import Annotated

from ...main_context import *


router = APIRouter(tags=["environments"])


async def _get_entorno_context(db: AsyncSession, entorno_id: UUID):
    result = await db.execute(select(models.Entorno).filter(models.Entorno.id == entorno_id))
    return result.scalar_one_or_none()


async def _get_dataset_context(db: AsyncSession, dataset_id: UUID):
    result = await db.execute(
        select(models.EntornoDataset, models.Entorno)
        .join(models.Entorno, models.Entorno.id == models.EntornoDataset.entorno_id)
        .filter(models.EntornoDataset.id == dataset_id)
    )
    row = result.first()
    if not row:
        return None, None
    return row[0], row[1]


async def _publish_environment_change(event_type: str, entorno: models.Entorno, current_user: models.Usuario, payload: dict | None = None):
    try:
        await realtime_event_bus.publish(
            entorno.proyecto_id,
            event_type,
            actor_id=current_user.id,
            payload={
                "environment": {
                    "id": str(entorno.id),
                    "nombre": entorno.nombre,
                    "activo": entorno.activo,
                    "status": entorno.status,
                },
                **(payload or {}),
            },
        )
    except Exception:
        logger.warning("Environment realtime publish failed for event %s", event_type, exc_info=True)


async def _publish_dataset_change(
    event_type: str,
    dataset: models.EntornoDataset,
    entorno: models.Entorno,
    current_user: models.Usuario,
    payload: dict | None = None,
):
    await realtime_event_bus.publish(
        entorno.proyecto_id,
        event_type,
        actor_id=current_user.id,
        payload={
            "environment": {"id": str(entorno.id), "nombre": entorno.nombre},
            "dataset": {
                "id": str(dataset.id),
                "nombre": dataset.nombre,
                "activo": dataset.activo,
                "es_default": dataset.es_default,
            },
            **(payload or {}),
        },
    )


def _public_update_fields(update_model):
    private_fields = {"variables", "url"}
    return {
        key: value
        for key, value in update_model.model_dump(exclude_unset=True).items()
        if key not in private_fields
    }

# --- ENDPOINTS ENTORNOS ---

@router.get("/proyectos/{proyecto_id}/entornos/", response_model=List[schemas.Entorno])
async def read_entornos(
    proyecto_id: UUID, 
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.ambientes", "read"))
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    return await crud.get_entornos_proyecto(db, proyecto_id=proyecto_id, skip=skip, limit=limit)

@router.post("/entornos/", response_model=schemas.Entorno)
async def create_entorno(
    entorno: schemas.EntornoCreate, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.ambientes", "edit"))
):
    await access_control.require_project_access(db, current_user, entorno.proyecto_id, "edit")
    created = await crud.create_entorno(db, entorno=entorno)
    await _publish_environment_change("environment.created", created, current_user)
    return created

@router.patch("/entornos/{entorno_id}", response_model=schemas.Entorno)
async def update_entorno(
    entorno_id: UUID, 
    entorno: schemas.EntornoUpdate, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.ambientes", "edit"))
):
    entorno_context = await _get_entorno_context(db, entorno_id)
    if not entorno_context:
        raise HTTPException(status_code=404, detail="Entorno no encontrado")
    await access_control.require_project_access(db, current_user, entorno_context.proyecto_id, "edit")
    db_entorno = await crud.update_entorno(db=db, entorno_id=entorno_id, entorno_update=entorno)
    if not db_entorno:
        raise HTTPException(status_code=404, detail="Entorno no encontrado")
    await _publish_environment_change(
        "environment.updated",
        db_entorno,
        current_user,
        {"updated_fields": _public_update_fields(entorno)},
    )
    return db_entorno

@router.delete("/entornos/{entorno_id}")
async def delete_entorno(
    entorno_id: UUID, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.ambientes", "edit"))
):
    entorno_context = await _get_entorno_context(db, entorno_id)
    if not entorno_context:
        raise HTTPException(status_code=404, detail="Entorno no encontrado")
    await access_control.require_project_access(db, current_user, entorno_context.proyecto_id, "edit")
    deleted = await crud.delete_entorno(db=db, entorno_id=entorno_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Entorno no encontrado")
    await _publish_environment_change("environment.deleted", entorno_context, current_user)
    return {"ok": True}

@router.get("/entornos/{entorno_id}/datasets/", response_model=List[schemas.EntornoDataset])
async def read_entorno_datasets(
    entorno_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.datasets", "read"))
):
    entorno_context = await _get_entorno_context(db, entorno_id)
    if not entorno_context:
        raise HTTPException(status_code=404, detail="Entorno no encontrado")
    await access_control.require_project_access(db, current_user, entorno_context.proyecto_id, "read")
    return await crud.get_entorno_datasets(db, entorno_id=entorno_id)

@router.post("/entornos/{entorno_id}/datasets/", response_model=schemas.EntornoDataset)
async def create_entorno_dataset(
    entorno_id: UUID,
    dataset: schemas.EntornoDatasetCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.datasets", "edit"))
):
    entorno_context = await _get_entorno_context(db, entorno_id)
    if not entorno_context:
        raise HTTPException(status_code=404, detail="Entorno no encontrado")
    await access_control.require_project_access(db, current_user, entorno_context.proyecto_id, "edit")
    db_dataset = await crud.create_entorno_dataset(db, entorno_id=entorno_id, dataset=dataset)
    if not db_dataset:
        raise HTTPException(status_code=404, detail="Entorno no encontrado")
    await _publish_dataset_change("dataset.created", db_dataset, entorno_context, current_user)
    return db_dataset

@router.patch("/entorno-datasets/{dataset_id}/", response_model=schemas.EntornoDataset)
async def update_entorno_dataset(
    dataset_id: UUID,
    dataset: schemas.EntornoDatasetUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.datasets", "edit"))
):
    dataset_context, entorno_context = await _get_dataset_context(db, dataset_id)
    if not dataset_context or not entorno_context:
        raise HTTPException(status_code=404, detail="Dataset no encontrado")
    await access_control.require_project_access(db, current_user, entorno_context.proyecto_id, "edit")
    db_dataset = await crud.update_entorno_dataset(db, dataset_id=dataset_id, dataset_update=dataset)
    if not db_dataset:
        raise HTTPException(status_code=404, detail="Dataset no encontrado")
    await _publish_dataset_change(
        "dataset.updated",
        db_dataset,
        entorno_context,
        current_user,
        {"updated_fields": _public_update_fields(dataset)},
    )
    return db_dataset

@router.delete("/entorno-datasets/{dataset_id}/")
async def delete_entorno_dataset(
    dataset_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.datasets", "edit"))
):
    dataset_context, entorno_context = await _get_dataset_context(db, dataset_id)
    if not dataset_context or not entorno_context:
        raise HTTPException(status_code=404, detail="Dataset no encontrado")
    await access_control.require_project_access(db, current_user, entorno_context.proyecto_id, "edit")
    deleted = await crud.delete_entorno_dataset(db, dataset_id=dataset_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Dataset no encontrado")
    await _publish_dataset_change("dataset.deleted", dataset_context, entorno_context, current_user)
    return {"ok": True}
