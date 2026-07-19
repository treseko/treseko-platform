from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from .repository_context import *


async def _next_code(db, model, project_id, prefix):
    rows = (await db.execute(select(model.codigo).where(model.proyecto_id == project_id))).scalars().all()
    maximum = 0
    for code in rows:
        try:
            maximum = max(maximum, int(str(code).rsplit("-", 1)[1]))
        except (IndexError, TypeError, ValueError):
            continue
    return f"{prefix}-{maximum + 1:03d}"


async def _validate_components(db, project_id, component_ids):
    if not component_ids:
        return []
    components = (await db.execute(select(models.Componente).where(models.Componente.id.in_(component_ids)))).scalars().all()
    if len(components) != len(component_ids) or any(item.proyecto_id != project_id for item in components):
        raise ValueError("Los componentes deben pertenecer al proyecto del requisito")
    return components


def _requirement_payload(item):
    return {
        "id": item.id, "proyecto_id": item.proyecto_id, "codigo": item.codigo, "titulo": item.titulo,
        "descripcion_markdown": item.descripcion_markdown, "estado": item.estado, "prioridad": item.prioridad,
        "external_provider": item.external_provider, "external_reference": item.external_reference,
        "external_url": item.external_url, "componente_ids": [link.componente_id for link in item.componentes],
        "creado_por": item.creado_por, "ultima_edicion_por": item.ultima_edicion_por,
        "fecha_creacion": item.fecha_creacion, "ultima_actualizacion": item.ultima_actualizacion,
        "archivado": item.archivado,
    }


def _story_payload(item):
    return {
        "id": item.id, "requisito_id": item.requisito_id, "proyecto_id": item.proyecto_id,
        "codigo": item.codigo, "titulo": item.titulo, "descripcion_markdown": item.descripcion_markdown,
        "criterios_aceptacion_markdown": item.criterios_aceptacion_markdown, "estado": item.estado,
        "prioridad": item.prioridad, "external_provider": item.external_provider,
        "external_reference": item.external_reference, "external_url": item.external_url,
        "creado_por": item.creado_por, "ultima_edicion_por": item.ultima_edicion_por,
        "fecha_creacion": item.fecha_creacion, "ultima_actualizacion": item.ultima_actualizacion,
        "archivado": item.archivado, "requisito_codigo": item.requisito.codigo if item.requisito else None,
        "requisito_titulo": item.requisito.titulo if item.requisito else None,
        "case_count": len(item.casos), "requiere_revision_count": sum(1 for link in item.casos if link.requiere_revision),
    }


async def list_requisitos(db, project_id, include_archived=False, estado=None, componente_id=None):
    query = select(models.Requisito).options(selectinload(models.Requisito.componentes)).where(models.Requisito.proyecto_id == project_id)
    if not include_archived:
        query = query.where(models.Requisito.archivado.is_(False))
    if estado:
        query = query.where(models.Requisito.estado == estado)
    if componente_id:
        query = query.join(models.RequisitoComponente).where(models.RequisitoComponente.componente_id == componente_id)
    items = (await db.execute(query.order_by(models.Requisito.codigo))).scalars().unique().all()
    return [_requirement_payload(item) for item in items]


async def get_requisito(db, requisito_id):
    result = await db.execute(select(models.Requisito).options(selectinload(models.Requisito.componentes)).where(models.Requisito.id == requisito_id))
    return result.scalar_one_or_none()


async def create_requisito(db, payload, user_id):
    data = payload.model_dump()
    component_ids = data.pop("componente_ids", [])
    await _validate_components(db, data["proyecto_id"], component_ids)
    data["codigo"] = data["codigo"] or await _next_code(db, models.Requisito, data["proyecto_id"], "REQ")
    data["creado_por"] = user_id
    data["ultima_edicion_por"] = user_id
    item = models.Requisito(**data)
    db.add(item)
    await db.flush()
    for component_id in component_ids:
        db.add(models.RequisitoComponente(requisito_id=item.id, componente_id=component_id))
    db.add(models.RequisitoHistorial(
        requisito_id=item.id, titulo=item.titulo, descripcion_markdown=item.descripcion_markdown,
        estado=item.estado, prioridad=item.prioridad, external_provider=item.external_provider,
        external_reference=item.external_reference, external_url=item.external_url, editado_por=user_id,
        comentario_cambio="Creacion inicial",
    ))
    await db.commit()
    return await get_requisito(db, item.id)


async def update_requisito(db, item, payload, user_id):
    data = payload.model_dump(exclude_unset=True)
    component_ids = data.pop("componente_ids", None)
    comment = data.pop("comentario_cambio", None) or "Edicion de requisito"
    if component_ids is not None:
        await _validate_components(db, item.proyecto_id, component_ids)
        item.componentes.clear()
        for component_id in component_ids:
            item.componentes.append(models.RequisitoComponente(componente_id=component_id))
    for key, value in data.items():
        setattr(item, key, value)
    item.ultima_edicion_por = user_id
    db.add(models.RequisitoHistorial(
        requisito_id=item.id, titulo=item.titulo, descripcion_markdown=item.descripcion_markdown,
        estado=item.estado, prioridad=item.prioridad, external_provider=item.external_provider,
        external_reference=item.external_reference, external_url=item.external_url, editado_por=user_id,
        comentario_cambio=comment,
    ))
    await db.commit()
    return await get_requisito(db, item.id)


async def list_requisito_history(db, requisito_id):
    return (await db.execute(select(models.RequisitoHistorial).where(models.RequisitoHistorial.requisito_id == requisito_id).order_by(models.RequisitoHistorial.fecha_edicion.desc()))).scalars().all()


async def list_historias(db, project_id, requisito_id=None, include_archived=False):
    query = select(models.HistoriaUsuario).options(
        selectinload(models.HistoriaUsuario.requisito), selectinload(models.HistoriaUsuario.casos)
    ).where(models.HistoriaUsuario.proyecto_id == project_id)
    if requisito_id:
        query = query.where(models.HistoriaUsuario.requisito_id == requisito_id)
    if not include_archived:
        query = query.where(models.HistoriaUsuario.archivado.is_(False))
    items = (await db.execute(query.order_by(models.HistoriaUsuario.codigo))).scalars().unique().all()
    return [_story_payload(item) for item in items]


async def get_historia(db, historia_id):
    query = select(models.HistoriaUsuario).options(
        selectinload(models.HistoriaUsuario.requisito), selectinload(models.HistoriaUsuario.casos)
    ).where(models.HistoriaUsuario.id == historia_id)
    return (await db.execute(query)).scalar_one_or_none()


async def create_historia(db, payload, user_id):
    data = payload.model_dump()
    requisito = await get_requisito(db, data["requisito_id"])
    if not requisito or requisito.proyecto_id != data["proyecto_id"]:
        raise ValueError("El requisito debe pertenecer al proyecto de la historia")
    data["codigo"] = data["codigo"] or await _next_code(db, models.HistoriaUsuario, data["proyecto_id"], "US")
    data["creado_por"] = user_id
    data["ultima_edicion_por"] = user_id
    item = models.HistoriaUsuario(**data)
    db.add(item)
    await db.flush()
    db.add(models.HistoriaHistorial(
        historia_id=item.id, titulo=item.titulo, descripcion_markdown=item.descripcion_markdown,
        criterios_aceptacion_markdown=item.criterios_aceptacion_markdown, estado=item.estado,
        prioridad=item.prioridad, external_provider=item.external_provider,
        external_reference=item.external_reference, external_url=item.external_url, editado_por=user_id,
        comentario_cambio="Creacion inicial",
    ))
    await db.commit()
    return await get_historia(db, item.id)


async def update_historia(db, item, payload, user_id):
    data = payload.model_dump(exclude_unset=True)
    comment = data.pop("comentario_cambio", None) or "Edicion de historia"
    changed = bool(data)
    for key, value in data.items():
        setattr(item, key, value)
    item.ultima_edicion_por = user_id
    if changed:
        for link in item.casos:
            link.requiere_revision = True
    db.add(models.HistoriaHistorial(
        historia_id=item.id, titulo=item.titulo, descripcion_markdown=item.descripcion_markdown,
        criterios_aceptacion_markdown=item.criterios_aceptacion_markdown, estado=item.estado,
        prioridad=item.prioridad, external_provider=item.external_provider,
        external_reference=item.external_reference, external_url=item.external_url, editado_por=user_id,
        comentario_cambio=comment,
    ))
    await db.commit()
    return await get_historia(db, item.id)


async def list_historia_history(db, historia_id):
    return (await db.execute(select(models.HistoriaHistorial).where(models.HistoriaHistorial.historia_id == historia_id).order_by(models.HistoriaHistorial.fecha_edicion.desc()))).scalars().all()


async def replace_case_historias(db, case, historia_ids, user_id):
    stories = []
    if historia_ids:
        stories = (await db.execute(select(models.HistoriaUsuario).where(models.HistoriaUsuario.id.in_(historia_ids)))).scalars().all()
        if len(stories) != len(historia_ids) or any(item.proyecto_id != case.proyecto_id for item in stories):
            raise ValueError("Las historias deben pertenecer al proyecto del caso")
    existing = (await db.execute(select(models.CasoHistoria).where(models.CasoHistoria.caso_master_id == case.master_id))).scalars().all()
    existing_by_story = {item.historia_id: item for item in existing}
    wanted = set(historia_ids)
    for link in existing:
        if link.historia_id not in wanted:
            await db.delete(link)
    for story in stories:
        link = existing_by_story.get(story.id)
        if link:
            link.requiere_revision = False
            link.fecha_revision = utc_now()
            link.revisado_por = user_id
            link.historia_actualizada_en_vinculo = story.ultima_actualizacion
        else:
            db.add(models.CasoHistoria(
                caso_master_id=case.master_id, historia_id=story.id, creado_por=user_id,
                historia_actualizada_en_vinculo=story.ultima_actualizacion,
            ))
    await db.commit()


async def confirm_case_historia_revision(db, case, historia_id, user_id):
    link = (await db.execute(select(models.CasoHistoria).where(
        models.CasoHistoria.caso_master_id == case.master_id,
        models.CasoHistoria.historia_id == historia_id,
    ))).scalar_one_or_none()
    if not link:
        raise ValueError("La historia no esta vinculada al caso de prueba")
    story = await get_historia(db, historia_id)
    if not story or story.proyecto_id != case.proyecto_id:
        raise ValueError("La historia debe pertenecer al proyecto del caso")
    link.requiere_revision = False
    link.fecha_revision = utc_now()
    link.revisado_por = user_id
    link.historia_actualizada_en_vinculo = story.ultima_actualizacion
    await db.commit()


async def list_case_historias(db, case_master_id):
    query = select(models.CasoHistoria, models.HistoriaUsuario, models.Requisito).join(
        models.HistoriaUsuario, models.HistoriaUsuario.id == models.CasoHistoria.historia_id
    ).join(models.Requisito, models.Requisito.id == models.HistoriaUsuario.requisito_id).where(
        models.CasoHistoria.caso_master_id == case_master_id
    ).order_by(models.HistoriaUsuario.codigo)
    rows = (await db.execute(query)).all()
    return [{
        "historia_id": story.id, "historia_codigo": story.codigo, "historia_titulo": story.titulo,
        "historia_estado": story.estado, "requisito_id": requirement.id, "requisito_codigo": requirement.codigo,
        "requisito_titulo": requirement.titulo, "requiere_revision": link.requiere_revision,
        "fecha_revision": link.fecha_revision,
    } for link, story, requirement in rows]


async def get_historia_cases(db, historia_id):
    query = select(models.CasoHistoria, models.CasoPrueba).join(
        models.CasoPrueba, models.CasoPrueba.master_id == models.CasoHistoria.caso_master_id
    ).where(models.CasoHistoria.historia_id == historia_id).order_by(models.CasoPrueba.version.desc())
    rows = (await db.execute(query)).all()
    latest = {}
    for link, case in rows:
        latest.setdefault(case.master_id, (link, case))
    return [{"master_id": case.master_id, "caso_id": case.id, "codigo": case.codigo, "titulo": case.titulo,
             "estado_caso": case.estado_caso.value if hasattr(case.estado_caso, "value") else case.estado_caso,
             "ultimo_resultado": case.ultimo_resultado, "requiere_revision": link.requiere_revision}
            for link, case in latest.values()]


async def coverage_summary(db, project_id):
    requirements = await list_requisitos(db, project_id, include_archived=False)
    stories = await list_historias(db, project_id, include_archived=False)
    for story in stories:
        story["casos"] = await get_historia_cases(db, story["id"])
    story_by_requirement = {}
    for story in stories:
        story_by_requirement.setdefault(story["requisito_id"], []).append(story)
    case_master_ids = set((await db.execute(select(models.CasoPrueba.master_id).where(models.CasoPrueba.proyecto_id == project_id, models.CasoPrueba.activo.is_(True)))).scalars().all())
    linked_master_ids = set((await db.execute(select(models.CasoHistoria.caso_master_id).join(models.HistoriaUsuario).where(models.HistoriaUsuario.proyecto_id == project_id))).scalars().all())
    stories_with_cases = [item for item in stories if item["case_count"] > 0]
    return {
        "requisitos_total": len(requirements),
        "requisitos_sin_historias": sum(1 for item in requirements if not story_by_requirement.get(item["id"])),
        "requisitos_con_historias": sum(1 for item in requirements if story_by_requirement.get(item["id"])),
        "historias_total": len(stories), "historias_sin_casos": sum(1 for item in stories if not item["case_count"]),
        "historias_con_casos": len(stories_with_cases), "casos_sin_historia": len(case_master_ids - linked_master_ids),
        "historias_requieren_revision": sum(1 for item in stories if item["requiere_revision_count"] > 0),
        "cobertura_historias_porcentaje": round((len(stories_with_cases) * 100 / len(stories)) if stories else 0, 2),
        "items": [{**requirement, "historias": story_by_requirement.get(requirement["id"], [])} for requirement in requirements],
    }
