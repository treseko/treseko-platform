from fastapi import APIRouter
from typing import Annotated

from ...main_context import *
from ...services.edition.entitlement_service import require_feature


router = APIRouter(tags=["scheduler"], dependencies=[Depends(require_feature("automation.scheduler"))])

# --- ENDPOINTS SCHEDULER ---

@router.get("/proyectos/{proyecto_id}/schedules/", response_model=List[schemas.ScheduledRun])
async def read_schedules(
    proyecto_id: UUID, 
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_module("ejecutar", "read"))
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    return await crud.get_scheduled_runs_proyecto(db, proyecto_id=proyecto_id, skip=skip, limit=limit)

@router.post("/schedules/", response_model=schemas.ScheduledRun)
async def create_schedule(
    schedule: schemas.ScheduledRunCreate, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_module("ejecutar", "edit"))
):
    await access_control.require_project_access(db, current_user, schedule.proyecto_id, "edit")
    suite_result = await db.execute(
        select(models.Suite).filter(
            models.Suite.id == schedule.suite_id,
            models.Suite.proyecto_id == schedule.proyecto_id,
            models.Suite.activo == True,
        )
    )
    if not suite_result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="La suite no pertenece al proyecto seleccionado")
    schedule.creado_por = current_user.id
    return await crud.create_scheduled_run(db, schedule=schedule)
