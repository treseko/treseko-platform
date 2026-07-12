from fastapi import APIRouter

from ...main_context import *
from ...services.error_sanitizer import sanitize_external_error


router = APIRouter(tags=["portability"])

# --- ENDPOINTS PORTABILIDAD ---


def _require_global_admin_for_project_import(current_user: models.Usuario):
    if current_user.rol != models.Rol.ADMIN:
        raise HTTPException(
            status_code=403,
            detail="Solo un administrador global puede importar proyectos completos",
        )


def _request_ip(request: Request | None) -> str:
    return request.client.host if request and request.client else "unknown"


def _project_package_summary(package: dict | None) -> dict:
    package = package if isinstance(package, dict) else {}
    suites = package.get("suites") if isinstance(package.get("suites"), list) else []
    cases = package.get("casos") if isinstance(package.get("casos"), list) else []
    step_count = sum(
        len(case.get("pasos") or [])
        for case in cases
        if isinstance(case, dict) and isinstance(case.get("pasos"), list)
    )
    project = package.get("proyecto") if isinstance(package.get("proyecto"), dict) else {}
    return {
        "project_name": project.get("nombre"),
        "suite_count": len(suites),
        "case_count": len(cases),
        "step_count": step_count,
        "format_version": package.get("version_formato"),
    }


@router.get("/proyectos/{proyecto_id}/export/")
async def export_proyecto(
    proyecto_id: UUID, 
    request: Request = None,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.usuarios", "read"))
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    package = await crud.export_proyecto(db, proyecto_id=proyecto_id)
    if not package: raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="EXPORT",
        recurso="project_portability",
        recurso_id=proyecto_id,
        detalles=_project_package_summary(package),
        ip_address=_request_ip(request),
    )
    return package

@router.post("/proyectos/import/", response_model=schemas.Proyecto)
async def import_proyecto(
    package: dict, 
    request: Request = None,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.usuarios", "edit"))
):
    _require_global_admin_for_project_import(current_user)
    summary = _project_package_summary(package)
    try:
        imported = await crud.import_proyecto(db, package=package, imported_by=current_user.id)
        await crud.create_audit_log(
            db=db,
            usuario_id=current_user.id,
            accion="IMPORT",
            recurso="project_portability",
            recurso_id=imported.id,
            detalles={**summary, "imported_project_id": str(imported.id)},
            ip_address=_request_ip(request),
        )
        return imported
    except Exception as e:
        raise HTTPException(status_code=400, detail=sanitize_external_error(e))
