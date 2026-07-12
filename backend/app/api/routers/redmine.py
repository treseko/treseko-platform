from fastapi import APIRouter

from ...main_context import *
from ...services.edition.entitlement_service import require_feature


router = APIRouter(tags=["redmine"], dependencies=[Depends(require_feature("integrations.enterprise"))])

# --- ENDPOINTS REDMINE ---
REDACTED_REDMINE_API_KEY = "********"


def _redacted_redmine_config(config) -> schemas.RedmineConfig:
    public_config = schemas.RedmineConfig.model_validate(config)
    return public_config.model_copy(update={"api_key": REDACTED_REDMINE_API_KEY if public_config.api_key else ""})

@router.post("/proyectos/{proyecto_id}/redmine/", response_model=schemas.RedmineConfig)
async def create_redmine_config(
    proyecto_id: UUID, 
    config: schemas.RedmineConfigBase, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("redmine.configuracion", "edit"))
):
    await access_control.require_project_access(db, current_user, proyecto_id, "edit")
    db_config = schemas.RedmineConfigCreate(**config.model_dump(), proyecto_id=proyecto_id)
    created = await crud.create_redmine_config(db=db, config=db_config)
    return _redacted_redmine_config(created)

@router.get("/proyectos/{proyecto_id}/redmine/", response_model=schemas.RedmineConfig)
async def read_redmine_config(
    proyecto_id: UUID, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("redmine.configuracion", "read"))
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    db_config = await crud.get_redmine_config(db, proyecto_id=proyecto_id)
    if db_config is None:
        raise HTTPException(status_code=404, detail="Configuración de Redmine no encontrada")
    return _redacted_redmine_config(db_config)
