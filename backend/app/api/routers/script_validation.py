from fastapi import APIRouter

from ...main_context import *


router = APIRouter(tags=["script_validation"])

# --- ENDPOINTS VALIDACION DE SCRIPTS ---


async def _require_script_validation_context_access(
    db: AsyncSession,
    current_user: models.Usuario,
    request: schemas.ScriptValidateRequest,
):
    context_ids = [request.proyecto_id, request.component_id, request.entorno_id, request.dataset_id]
    if not any(context_ids):
        return
    if not request.proyecto_id:
        raise HTTPException(status_code=400, detail="El contexto de validacion requiere proyecto_id")

    await access_control.require_project_access(db, current_user, request.proyecto_id, "read")

    if request.component_id:
        component = await access_control.require_component_access(db, current_user, request.component_id, "read")
        if component.proyecto_id != request.proyecto_id:
            raise HTTPException(status_code=400, detail="El componente no pertenece al proyecto indicado")

    entorno = None
    if request.entorno_id:
        entorno = await db.get(models.Entorno, request.entorno_id)
        if not entorno or entorno.proyecto_id != request.proyecto_id or not entorno.activo:
            raise HTTPException(status_code=404, detail="Ambiente no encontrado")

    if request.dataset_id:
        dataset = await db.get(models.EntornoDataset, request.dataset_id)
        if not dataset or not dataset.activo:
            raise HTTPException(status_code=404, detail="Dataset no encontrado")
        if request.entorno_id and dataset.entorno_id != request.entorno_id:
            raise HTTPException(status_code=400, detail="El dataset no pertenece al ambiente indicado")
        if not entorno:
            entorno = await db.get(models.Entorno, dataset.entorno_id)
        if not entorno or entorno.proyecto_id != request.proyecto_id or not entorno.activo:
            raise HTTPException(status_code=404, detail="Dataset no encontrado")


@router.post("/scripts/validate/", response_model=schemas.ScriptValidateResponse)
async def validate_script(
    request: schemas.ScriptValidateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("automatizacion.validacion_scripts", "read"))
):
    await _require_script_validation_context_access(db, current_user, request)
    return await crud.validate_script(
        db=db,
        script=request.script,
        framework=request.framework,
        tipo_prueba=request.tipo_prueba,
        titulo=request.titulo,
        datos_caso=request.datos_caso,
        pasos=request.pasos,
        proyecto_id=request.proyecto_id,
        component_id=request.component_id,
        entorno_id=request.entorno_id,
        dataset_id=request.dataset_id,
    )
