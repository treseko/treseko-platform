import hashlib
import os
from fastapi import APIRouter, File, UploadFile
from typing import Annotated

from ...main_context import *
from ...content_type_validation import content_matches_declared_type


router = APIRouter(tags=["Proyectos"])

PROJECT_LOGO_MIME_TYPES = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
}
MAX_PROJECT_LOGO_BYTES = 2 * 1024 * 1024

@router.post("/proyectos/", response_model=schemas.Proyecto)
async def create_proyecto(
    proyecto: schemas.ProyectoCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.portfolio", "edit"))
):
    if proyecto.organizacion_id:
        await access_control.require_organization_access(db, current_user, proyecto.organizacion_id, "edit")
    elif not access_control.is_global_admin(current_user):
        raise HTTPException(status_code=400, detail="Debe indicar una organizacion valida")
    try:
        created = await crud.create_proyecto(db=db, proyecto=proyecto)
        if current_user.rol != models.Rol.ADMIN:
            await crud.add_proyecto_miembro(
                db=db,
                proyecto_id=created.id,
                miembro=schemas.ProyectoMiembroCreate(usuario_id=current_user.id, rol_proyecto="MEMBER"),
                ensure_organization_membership=True,
            )
            created = await crud.get_proyecto(db, created.id)
        await realtime_event_bus.publish(
            created.id,
            "project.created",
            actor_id=current_user.id,
            payload={"project": {"id": str(created.id), "nombre": created.nombre}},
        )
        return created
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.get("/proyectos/", response_model=List[schemas.Proyecto])
async def read_proyectos(
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.portfolio", "read"))
):
    if current_user.rol != models.Rol.ADMIN:
        result = await db.execute(
            select(models.Proyecto)
            .join(models.Organizacion, models.Organizacion.id == models.Proyecto.organizacion_id)
            .join(models.ProyectoMiembro)
            .filter(
                models.ProyectoMiembro.usuario_id == current_user.id,
                models.Organizacion.activo.is_(True),
            )
            .order_by(models.Proyecto.id)
            .offset(skip)
            .limit(limit)
        )
        return result.scalars().all()
    return await crud.get_proyectos(db, skip=skip, limit=limit)

@router.get("/proyectos/{proyecto_id}", response_model=schemas.Proyecto)
async def read_proyecto(
    proyecto_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.portfolio", "read"))
):
    db_proyecto = await crud.get_proyecto(db, proyecto_id=proyecto_id)
    if db_proyecto is None:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    return db_proyecto

@router.patch("/proyectos/{proyecto_id}", response_model=schemas.Proyecto)
async def update_proyecto(
    proyecto_id: UUID,
    proyecto: schemas.ProyectoUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.portfolio", "edit"))
):
    await access_control.require_project_access(db, current_user, proyecto_id, "edit")
    if proyecto.organizacion_id:
        await access_control.require_organization_access(db, current_user, proyecto.organizacion_id, "edit")
    try:
        db_proyecto = await crud.update_proyecto(db=db, proyecto_id=proyecto_id, proyecto_update=proyecto)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if db_proyecto is None:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    previous_active = db.info["project_previous_active"][proyecto_id]
    await realtime_event_bus.publish(
        db_proyecto.id,
        "project.updated",
        actor_id=current_user.id,
        payload={
            "project": {"id": str(db_proyecto.id), "nombre": db_proyecto.nombre},
            "updated_fields": proyecto.model_dump(exclude_unset=True),
        },
    )
    if previous_active is True and db_proyecto.activo is False:
        await notification_event_service.emit_event(
            db=db,
            event_type="project.closed",
            actor_user_id=current_user.id,
            proyecto_id=db_proyecto.id,
            entity_type="project",
            entity_id=db_proyecto.id,
            severity="info",
            payload={"proyecto": {"id": str(db_proyecto.id), "nombre": db_proyecto.nombre}, "actor": {"email": current_user.email}, "message": f"Proyecto cerrado: {db_proyecto.nombre}"},
            dedupe_key=f"project.closed:{db_proyecto.id}:{utc_now().strftime('%Y%m%d%H%M')}",
        )
        await realtime_event_bus.publish(
            db_proyecto.id,
            "project.deleted",
            actor_id=current_user.id,
            payload={"project": {"id": str(db_proyecto.id), "nombre": db_proyecto.nombre}, "source": "soft_delete"},
        )
    elif previous_active is False and db_proyecto.activo is True:
        await notification_event_service.emit_event(
            db=db,
            event_type="project.reopened",
            actor_user_id=current_user.id,
            proyecto_id=db_proyecto.id,
            entity_type="project",
            entity_id=db_proyecto.id,
            severity="info",
            payload={"proyecto": {"id": str(db_proyecto.id), "nombre": db_proyecto.nombre}, "actor": {"email": current_user.email}, "message": f"Proyecto reabierto: {db_proyecto.nombre}"},
            dedupe_key=f"project.reopened:{db_proyecto.id}:{utc_now().strftime('%Y%m%d%H%M')}",
        )
        await realtime_event_bus.publish(
            db_proyecto.id,
            "project.restored",
            actor_id=current_user.id,
            payload={"project": {"id": str(db_proyecto.id), "nombre": db_proyecto.nombre}, "source": "active_flag"},
        )
    return db_proyecto

@router.post("/proyectos/{proyecto_id}/logo", response_model=schemas.Proyecto)
async def upload_proyecto_logo(
    proyecto_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.portfolio", "edit")),
):
    await access_control.require_project_access(db, current_user, proyecto_id, "edit")
    proyecto = await crud.get_proyecto(db, proyecto_id=proyecto_id)
    if proyecto is None:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")

    content_type = (file.content_type or "application/octet-stream").split(";", 1)[0].strip().lower()
    if content_type not in PROJECT_LOGO_MIME_TYPES:
        raise HTTPException(status_code=400, detail="El logo debe ser PNG, JPG, WEBP o GIF.")
    content = await file.read(MAX_PROJECT_LOGO_BYTES + 1)
    if len(content) > MAX_PROJECT_LOGO_BYTES:
        raise HTTPException(status_code=400, detail="El logo no puede superar 2 MB.")
    if not content_matches_declared_type(content_type, content):
        raise HTTPException(status_code=400, detail="El contenido del logo no coincide con el tipo declarado.")

    digest = hashlib.sha256(content).hexdigest()
    extension = PROJECT_LOGO_MIME_TYPES[content_type]
    target_dir = os.path.join("app", "static", "project-logos")
    os.makedirs(target_dir, exist_ok=True)
    filename = f"{proyecto_id}-{digest}.{extension}"
    target_path = os.path.join(target_dir, filename)
    if not os.path.exists(target_path):
        with open(target_path, "wb") as output:
            output.write(content)

    updated = await crud.update_proyecto(
        db=db,
        proyecto_id=proyecto_id,
        proyecto_update=schemas.ProyectoUpdate(imagen_url=f"/static/project-logos/{filename}"),
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    return updated

@router.get("/proyectos/{proyecto_id}/miembros/", response_model=List[schemas.ProyectoMiembro])
async def read_proyecto_miembros(
    proyecto_id: UUID,
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.equipo", "read"))
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    return await crud.get_proyecto_miembros(db=db, proyecto_id=proyecto_id, skip=skip, limit=limit)

@router.post("/proyectos/{proyecto_id}/miembros/", response_model=schemas.ProyectoMiembro)
async def add_proyecto_miembro(
    proyecto_id: UUID,
    miembro: schemas.ProyectoMiembroCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.equipo", "edit"))
):
    await access_control.require_project_access(db, current_user, proyecto_id, "edit")
    user = await crud.get_user(db, miembro.usuario_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    created_member = await crud.add_proyecto_miembro(db=db, proyecto_id=proyecto_id, miembro=miembro, ensure_organization_membership=True)
    await notification_event_service.emit_event(
        db=db,
        event_type="project.member_added",
        actor_user_id=current_user.id,
        proyecto_id=proyecto_id,
        entity_type="project_member",
        entity_id=created_member.id,
        severity="info",
        payload={"member": {"user_id": str(user.id), "email": user.email, "rol_proyecto": created_member.rol_proyecto}, "actor": {"email": current_user.email}, "message": f"Miembro agregado al proyecto: {user.email}"},
        dedupe_key=f"project.member_added:{proyecto_id}:{user.id}",
    )
    await realtime_event_bus.publish(
        proyecto_id,
        "project.member_added",
        actor_id=current_user.id,
        payload={"member": {"user_id": str(user.id), "email": user.email, "rol_proyecto": created_member.rol_proyecto}},
    )
    return created_member

@router.delete("/proyectos/{proyecto_id}/miembros/{usuario_id}")
async def delete_proyecto_miembro(
    proyecto_id: UUID,
    usuario_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.equipo", "edit"))
):
    await access_control.require_project_access(db, current_user, proyecto_id, "edit")
    deleted = await crud.delete_proyecto_miembro(db=db, proyecto_id=proyecto_id, usuario_id=usuario_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Miembro de proyecto no encontrado")
    await notification_event_service.emit_event(
        db=db,
        event_type="project.member_removed",
        actor_user_id=current_user.id,
        proyecto_id=proyecto_id,
        entity_type="project_member",
        entity_id=usuario_id,
        severity="info",
        payload={"member": {"user_id": str(usuario_id)}, "actor": {"email": current_user.email}, "message": "Miembro removido del proyecto"},
        dedupe_key=f"project.member_removed:{proyecto_id}:{usuario_id}:{utc_now().strftime('%Y%m%d%H%M')}",
    )
    await realtime_event_bus.publish(
        proyecto_id,
        "project.member_removed",
        actor_id=current_user.id,
        payload={"member": {"user_id": str(usuario_id)}},
    )
    return {"ok": True}

# --- ENDPOINTS COMPONENTES ---
