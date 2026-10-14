"""Workspace MCP handlers reuse native project/wiki/traceability repositories."""
from __future__ import annotations

import hashlib
import json
from uuid import UUID

from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from .. import models, schemas, access_control, crud
from ..repositories import projects_components_builds as projects, wiki_pages as wiki, traceability_records as trace
from ..repositories.story_criteria import criterion_input
from .mcp_redaction import redact
from .mcp_errors import McpRevisionConflict
from .mcp_workspace_contracts import SPECS


def revision(data):
    return hashlib.sha256(json.dumps(jsonable_encoder(data), sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def payload(item, family):
    if family == "requirements":
        data = trace._requirement_payload(item)
    elif family == "stories":
        data = trace._story_payload(item)
        data["acceptance_criteria"] = [
            {**criterion_input(criterion), "id": str(criterion.id)}
            for criterion in sorted(item.criterios_aceptacion, key=lambda value: value.orden)
            if criterion.activo
        ]
    else:
        data = {column.name: getattr(item, column.name) for column in item.__table__.columns}
    data = jsonable_encoder(data)
    data["revision"] = revision(data)
    return redact(data)


async def context(db, user, tool, args):
    if tool.handler_key == "organizations.list":
        return None
    if tool.handler_key in {"projects.list", "projects.create"}:
        return await access_control.require_organization_access(db, user, UUID(args["organization_id"]), "edit" if tool.operation == "commit" else "read")
    project = await access_control.require_project_access(db, user, UUID(args["project_id"]), "edit" if tool.operation == "commit" else "read")
    await access_control.require_organization_access(db, user, project.organizacion_id, "edit" if tool.operation == "commit" else "read")
    return project


async def organizations_list(db, user, org, args):
    ids = await access_control.accessible_organization_ids(db, user)
    query = select(models.Organizacion).where(models.Organizacion.activo.is_(True)).order_by(models.Organizacion.id)
    if ids is not None:
        query = query.where(models.Organizacion.id.in_(ids))
    limit, offset = args.get("limit", 100), args.get("offset", 0)
    rows = (await db.execute(query.offset(offset).limit(limit + 1))).scalars().all()
    return {"items": [{"id": str(x.id), "name": x.nombre} for x in rows[:limit]], "next_offset": offset + limit if len(rows) > limit else None}


async def projects_list(db, user, org, args):
    query = select(models.Proyecto).where(models.Proyecto.organizacion_id == org.id).order_by(models.Proyecto.id)
    if not access_control.is_global_admin(user):
        query = query.join(models.ProyectoMiembro).where(models.ProyectoMiembro.usuario_id == user.id)
    limit, offset = args.get("limit", 100), args.get("offset", 0)
    rows = (await db.execute(query.offset(offset).limit(limit + 1))).scalars().all()
    return {"items": [payload(x, "projects") for x in rows[:limit]], "next_offset": offset + limit if len(rows) > limit else None}


async def projects_create(db, user, org, args):
    item = await projects.create_proyecto(db, schemas.ProyectoCreate(**args["data"], organizacion_id=org.id))
    if not access_control.is_global_admin(user):
        await crud.add_proyecto_miembro(db, item.id, schemas.ProyectoMiembroCreate(usuario_id=user.id, rol_proyecto="MEMBER"), ensure_organization_membership=True)
    return payload(item, "projects")


async def projects_get(db, user, project, args):
    return payload(project, "projects")


async def projects_update(db, user, project, args):
    item = await db.get(models.Proyecto, project.id, with_for_update=True, populate_existing=True)
    if payload(item, "projects")["revision"] != args["expected_revision"]:
        raise McpRevisionConflict("revision conflict; get the project again before updating")
    item = await projects.update_proyecto(db, project.id, schemas.ProyectoUpdate(**args["data"]))
    return payload(item, "projects")


async def components_list(db, user, project, args):
    limit, offset = args.get("limit", 100), args.get("offset", 0)
    rows = (await db.execute(select(models.Componente).where(models.Componente.proyecto_id == project.id).order_by(models.Componente.id).offset(offset).limit(limit + 1))).scalars().all()
    return {"items": [payload(x, "components") for x in rows[:limit]], "next_offset": offset + limit if len(rows) > limit else None}


FAMILIES = {
    "requirements": (models.Requisito, "requirement_id", schemas.RequisitoCreate, schemas.RequisitoUpdate, trace.get_requisito, trace.create_requisito, trace.update_requisito),
    "stories": (models.HistoriaUsuario, "story_id", schemas.HistoriaCreate, schemas.HistoriaUpdate, trace.get_historia, trace.create_historia, trace.update_historia),
    "wiki": (models.WikiPage, "page_id", schemas.WikiPageCreate, schemas.WikiPageUpdate, wiki.get_wiki_page, wiki.create_wiki_page, wiki.update_wiki_page_data),
}


async def entity(db, project, family, args, *, lock=False):
    model, target, _, _, get, _, _ = FAMILIES[family]
    item_id = UUID(args[target])
    owned = await db.scalar(select(model).where(model.id == item_id, model.proyecto_id == project.id).with_for_update() if lock else select(model).where(model.id == item_id, model.proyecto_id == project.id))
    if not owned:
        raise LookupError("entity not found in project")
    return await get(db, item_id)


def wiki_chunk(data, args):
    content = data.get("contenido") or ""
    offset, limit = args.get("content_offset", 0), args.get("content_limit", 16000)
    data["contenido"] = content[offset:offset + limit]
    data["content_length"] = len(content)
    data["content_offset"] = offset
    data["next_content_offset"] = offset + limit if offset + limit < len(content) else None
    return data


async def run(db, user, project, args, family, action):
    model, target, create_schema, update_schema, get, create, update = FAMILIES[family]
    if action == "list":
        limit, offset = args.get("limit", 100), args.get("offset", 0)
        rows = (await db.execute(select(model.id).where(model.proyecto_id == project.id).order_by(model.id).offset(offset).limit(limit + 1))).scalars().all()
        items = []
        for item_id in rows[:limit]:
            data = payload(await get(db, item_id), family)
            if family == "wiki":
                data.pop("contenido", None)
            items.append(data)
        return {"items": items, "next_offset": offset + limit if len(rows) > limit else None}
    if action == "create":
        data = dict(args["data"])
        if family == "wiki":
            item = await create(db, create_schema(**data, proyecto_id=project.id, creado_por=user.id))
        else:
            item = await create(db, create_schema(**data, proyecto_id=project.id), user.id)
    else:
        item = await entity(db, project, family, args, lock=action == "update")
        if action == "history":
            history_model = {"wiki": models.WikiHistory, "requirements": models.RequisitoHistorial, "stories": models.HistoriaHistorial}[family]
            fk = {"wiki": "page_id", "requirements": "requisito_id", "stories": "historia_id"}[family]
            limit, offset = args.get("limit", 100), args.get("offset", 0)
            rows = (await db.execute(select(history_model).where(getattr(history_model, fk) == item.id).order_by(history_model.fecha_edicion.desc(), history_model.id).offset(offset).limit(limit + 1))).scalars().all()
            return {"items": [wiki_chunk(payload(x, "history"), args) if family == "wiki" else payload(x, "history") for x in rows[:limit]], "next_offset": offset + limit if len(rows) > limit else None}
        if action == "update":
            if payload(item, family)["revision"] != args["expected_revision"]:
                raise McpRevisionConflict("revision conflict; get the entity again before updating")
            if family == "wiki":
                item = await update(db, item.id, update_schema(**args["data"]), user.id)
            else:
                item = await update(db, item, update_schema(**args["data"]), user.id)
    data = payload(await get(db, item.id), family)
    return wiki_chunk(data, args) if family == "wiki" else data


def make_handler(family, action):
    async def handler(db, user, project, args):
        return await run(db, user, project, args, family, action)
    return handler


HANDLERS = {"organizations.list": organizations_list, "projects.list": projects_list, "projects.create": projects_create, "projects.get": projects_get, "projects.update": projects_update, "components.list": components_list}
HANDLERS.update({key: make_handler(*key.split('.')) for key in SPECS if key.split('.')[0] in FAMILIES})
