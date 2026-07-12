from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models

PROJECT_READ_ONLY_ROLES = {
    "GUEST",
    "INVITADO",
    "LECTOR",
    "READ_ONLY",
    "READONLY",
    "SOLO_LECTURA",
    "VIEWER",
}


def _forbidden():
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="No tienes acceso al recurso solicitado",
    )


def _not_found(resource: str):
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{resource} no encontrado")


def is_global_admin(user: models.Usuario):
    return user.rol == models.Rol.ADMIN


def _project_role_allows_level(role: str | None, level: str) -> bool:
    requested_level = (level or "read").strip().lower()
    if requested_level == "read":
        return True
    normalized_role = (role or "MEMBER").strip().upper().replace("-", "_").replace(" ", "_")
    return normalized_role not in PROJECT_READ_ONLY_ROLES


async def require_organization_access(
    db: AsyncSession,
    user: models.Usuario,
    organizacion_id: UUID,
    level: str = "read",
    *,
    allow_inactive_for_admin: bool = False,
):
    db_org = await db.get(models.Organizacion, organizacion_id)
    if not db_org:
        _not_found("Organizacion")
    if db_org.activo is not True:
        if is_global_admin(user) and allow_inactive_for_admin:
            return db_org
        _not_found("Organizacion")
    if is_global_admin(user):
        return db_org

    result = await db.execute(
        select(models.OrganizacionMiembro.id).filter(
            models.OrganizacionMiembro.organizacion_id == organizacion_id,
            models.OrganizacionMiembro.usuario_id == user.id,
        )
    )
    if result.scalar_one_or_none():
        return db_org
    _forbidden()


async def require_project_access(
    db: AsyncSession,
    user: models.Usuario,
    proyecto_id: UUID,
    level: str = "read",
):
    db_project = await db.get(models.Proyecto, proyecto_id)
    if not db_project:
        _not_found("Proyecto")
    org_active = await db.scalar(
        select(models.Organizacion.activo).filter(models.Organizacion.id == db_project.organizacion_id)
    )
    if org_active is not True:
        _not_found("Proyecto")
    if is_global_admin(user):
        return db_project

    project_member = await db.execute(
        select(models.ProyectoMiembro.rol_proyecto).filter(
            models.ProyectoMiembro.proyecto_id == proyecto_id,
            models.ProyectoMiembro.usuario_id == user.id,
        )
    )
    project_role = project_member.scalar_one_or_none()
    if project_role is not None and _project_role_allows_level(project_role, level):
        return db_project

    _forbidden()


async def require_component_access(
    db: AsyncSession,
    user: models.Usuario,
    componente_id: UUID,
    level: str = "read",
):
    db_component = await db.get(models.Componente, componente_id)
    if not db_component:
        _not_found("Componente")
    await require_project_access(db, user, db_component.proyecto_id, level)
    return db_component


async def require_build_access(
    db: AsyncSession,
    user: models.Usuario,
    build_id: UUID,
    level: str = "read",
):
    db_build = await db.get(models.Build, build_id)
    if not db_build:
        _not_found("Build")
    await require_project_access(db, user, db_build.proyecto_id, level)
    return db_build


def project_access_filter(user: models.Usuario):
    if is_global_admin(user):
        return None
    return models.ProyectoMiembro.usuario_id == user.id
