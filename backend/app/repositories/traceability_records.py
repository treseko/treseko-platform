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
        "criterios_aceptacion_markdown": item.criterios_aceptacion_markdown, "estado": "BORRADOR" if item.estado == "BORRADOR_IA" else item.estado,
        "criterios_estructuracion_estado": item.criterios_estructuracion_estado,
        "prioridad": item.prioridad, "external_provider": item.external_provider,
        "external_reference": item.external_reference, "external_url": item.external_url,
        "creado_por": item.creado_por, "ultima_edicion_por": item.ultima_edicion_por,
        "fecha_creacion": item.fecha_creacion, "ultima_actualizacion": item.ultima_actualizacion,
        "archivado": item.archivado, "requisito_codigo": item.requisito.codigo if item.requisito else None,
        "requisito_titulo": item.requisito.titulo if item.requisito else None,
        "case_count": len(item.casos), "requiere_revision_count": sum(1 for link in item.casos if link.requiere_revision),
    }


def _short_field_value(value):
    if value is None:
        return "vacío"
    if isinstance(value, bool):
        return "sí" if value else "no"
    text = str(value).strip()
    if not text:
        return "vacío"
    return text if len(text) <= 48 else f"{text[:45]}..."


def _build_requirement_history_comment(item, payload, component_ids, base_comment):
    labels = {
        "titulo": "Título",
        "descripcion_markdown": "Descripción",
        "estado": "Estado",
        "prioridad": "Prioridad",
        "external_provider": "Proveedor externo",
        "external_reference": "Referencia externa",
        "external_url": "URL externa",
    }
    changes = []
    for key, value in payload.items():
        if key not in labels or not hasattr(item, key):
            continue
        previous_value = getattr(item, key)
        if previous_value == value:
            continue
        if key == "descripcion_markdown":
            changes.append(f"{labels[key]} actualizada")
        else:
            changes.append(f"{labels[key]}: {_short_field_value(previous_value)} → {_short_field_value(value)}")
    if component_ids is not None:
        previous_components = sorted([link.componente_id for link in item.componentes])
        if sorted(component_ids) != previous_components:
            changes.append("Componentes actualizados")
    if not changes:
        return base_comment
    return (f"{base_comment}: " + "; ".join(changes))[:255]


def _build_story_history_comment(item, payload, base_comment):
    labels = {
        "titulo": "Título",
        "descripcion_markdown": "Descripción",
        "criterios_aceptacion_markdown": "Criterios de aceptación",
        "estado": "Estado",
        "prioridad": "Prioridad",
        "external_provider": "Proveedor externo",
        "external_reference": "Referencia externa",
        "external_url": "URL externa",
        "archivado": "Archivado",
    }
    changes = []
    for key, value in payload.items():
        if key not in labels or not hasattr(item, key):
            continue
        previous_value = getattr(item, key)
        if previous_value == value:
            continue
        if key in {"descripcion_markdown", "criterios_aceptacion_markdown"}:
            changes.append(f"{labels[key]} actualizada")
        else:
            changes.append(f"{labels[key]}: {_short_field_value(previous_value)} → {_short_field_value(value)}")
    if not changes:
        return base_comment
    return (f"{base_comment}: " + "; ".join(changes))[:255]


def _history_actor_display_name(user):
    if not user:
        return None, None
    name = (user.display_name or user.nombre_completo or user.email or "").strip() or None
    return name, user.email


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
    comment = data.pop("comentario_cambio", None) or "Edición de requisito"
    comment = _build_requirement_history_comment(item, data, component_ids, comment)
    if data.get("estado") == "CUMPLIDO":
        coverage = await coverage_summary(db, item.proyecto_id)
        requirement = next((value for value in coverage["items"] if value["id"] == item.id), None)
        waiver = (await db.execute(select(models.TraceabilityWaiver).where(models.TraceabilityWaiver.requisito_id == item.id, models.TraceabilityWaiver.estado == "APPROVED"))).scalars().first()
        if not waiver and (not requirement or not requirement.get("historias") or requirement.get("criterios_obligatorios_sin_caso", 0) or requirement.get("criterios_pendientes_revision", 0)):
            raise ValueError("No se puede cumplir el requisito sin historias, criterios cubiertos y revisados, salvo excepción aprobada")
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
    entries = (await db.execute(select(models.RequisitoHistorial).where(
        models.RequisitoHistorial.requisito_id == requisito_id
    ).order_by(models.RequisitoHistorial.fecha_edicion.desc()))).scalars().all()
    user_ids = sorted({entry.editado_por for entry in entries if entry.editado_por})
    actor_map = {}
    if user_ids:
        users = (await db.execute(select(models.Usuario).where(models.Usuario.id.in_(user_ids)))).scalars().all()
        actor_map = {user.id: _history_actor_display_name(user) for user in users}
    return [
        {
            "id": entry.id,
            "requisito_id": entry.requisito_id,
            "titulo": entry.titulo,
            "descripcion_markdown": entry.descripcion_markdown,
            "estado": entry.estado,
            "prioridad": entry.prioridad,
            "external_provider": entry.external_provider,
            "external_reference": entry.external_reference,
            "external_url": entry.external_url,
            "editado_por": entry.editado_por,
            "fecha_edicion": entry.fecha_edicion,
            "comentario_cambio": entry.comentario_cambio,
            "editado_por_nombre": (actor_map.get(entry.editado_por) or (None, None))[0],
            "editado_por_email": (actor_map.get(entry.editado_por) or (None, None))[1],
        }
        for entry in entries
    ]


async def list_historias(db, project_id, requisito_id=None, include_archived=False):
    query = select(models.HistoriaUsuario).options(
        selectinload(models.HistoriaUsuario.requisito), selectinload(models.HistoriaUsuario.casos),
        selectinload(models.HistoriaUsuario.criterios_aceptacion)
    ).where(models.HistoriaUsuario.proyecto_id == project_id)
    if requisito_id:
        query = query.where(models.HistoriaUsuario.requisito_id == requisito_id)
    if not include_archived:
        query = query.where(models.HistoriaUsuario.archivado.is_(False))
    items = (await db.execute(query.order_by(models.HistoriaUsuario.codigo))).scalars().unique().all()
    return [{**_story_payload(item), "criterios_estructurados_count": sum(1 for criterion in item.criterios_aceptacion if criterion.activo)} for item in items]


async def get_historia(db, historia_id):
    query = select(models.HistoriaUsuario).options(
        selectinload(models.HistoriaUsuario.requisito), selectinload(models.HistoriaUsuario.casos)
    ).where(models.HistoriaUsuario.id == historia_id)
    return (await db.execute(query)).scalar_one_or_none()


async def create_historia(db, payload, user_id):
    data = payload.model_dump()
    acceptance_criteria = data.pop("acceptance_criteria", [])
    if acceptance_criteria and not str(data.get("criterios_aceptacion_markdown") or "").strip():
        data["criterios_aceptacion_markdown"] = "\n\n".join(
            "\n".join([
                f"### {criterion['title']}",
                f"**Dado:** {criterion['given']}" if criterion["given"] else "",
                f"**Cuando:** {criterion['when']}" if criterion["when"] else "",
                *(f"**Entonces:** {item}" for item in criterion["then"]),
                f"**Resultado observable:** {criterion['observable_result']}" if criterion["observable_result"] else "",
            ]).strip()
            for criterion in acceptance_criteria
        )
    requisito = await get_requisito(db, data["requisito_id"])
    if not requisito or requisito.proyecto_id != data["proyecto_id"]:
        raise ValueError("El requisito debe pertenecer al proyecto de la historia")
    data["codigo"] = data["codigo"] or await _next_code(db, models.HistoriaUsuario, data["proyecto_id"], "US")
    data["creado_por"] = user_id
    data["ultima_edicion_por"] = user_id
    item = models.HistoriaUsuario(
        **data,
        criterios_estructuracion_estado="STRUCTURED" if acceptance_criteria else "PENDING_STRUCTURING",
    )
    db.add(item)
    await db.flush()
    for order, criterion in enumerate(acceptance_criteria):
        db.add(models.AcceptanceCriterion(
            historia_id=item.id, codigo=criterion["local_id"], tipo=criterion["type"], titulo=criterion["title"],
            given_text=criterion["given"], when_text=criterion["when"], then_items=criterion["then"],
            observable_result=criterion["observable_result"], mandatory=criterion["mandatory"],
            source_refs=criterion["source_refs"], assumption_refs=criterion["assumption_ids"], orden=order,
        ))
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
    comment = data.pop("comentario_cambio", None) or "Edición de historia"
    comment = _build_story_history_comment(item, data, comment)
    functional_fields = {"titulo", "descripcion_markdown", "criterios_aceptacion_markdown"}
    changed = any(key in functional_fields and getattr(item, key) != value for key, value in data.items())
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
    entries = (await db.execute(select(models.HistoriaHistorial).where(
        models.HistoriaHistorial.historia_id == historia_id
    ).order_by(models.HistoriaHistorial.fecha_edicion.desc()))).scalars().all()
    user_ids = sorted({entry.editado_por for entry in entries if entry.editado_por})
    actor_map = {}
    if user_ids:
        users = (await db.execute(select(models.Usuario).where(models.Usuario.id.in_(user_ids)))).scalars().all()
        actor_map = {user.id: _history_actor_display_name(user) for user in users}
    return [
        {
            "id": entry.id,
            "historia_id": entry.historia_id,
            "titulo": entry.titulo,
            "descripcion_markdown": entry.descripcion_markdown,
            "criterios_aceptacion_markdown": entry.criterios_aceptacion_markdown,
            "estado": entry.estado,
            "prioridad": entry.prioridad,
            "external_provider": entry.external_provider,
            "external_reference": entry.external_reference,
            "external_url": entry.external_url,
            "editado_por": entry.editado_por,
            "fecha_edicion": entry.fecha_edicion,
            "comentario_cambio": entry.comentario_cambio,
            "editado_por_nombre": (actor_map.get(entry.editado_por) or (None, None))[0],
            "editado_por_email": (actor_map.get(entry.editado_por) or (None, None))[1],
        }
        for entry in entries
    ]


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
            # Saving an unchanged selection is not a review confirmation.
            # Only confirmar-revision may clear an outstanding review.
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
    criteria = (await db.execute(select(models.AcceptanceCriterion).join(models.HistoriaUsuario).where(models.HistoriaUsuario.proyecto_id == project_id, models.AcceptanceCriterion.activo.is_(True)))).scalars().all()
    criterion_cases = (await db.execute(select(models.AcceptanceCriterionCase))).scalars().all()
    by_criterion = {}
    for link in criterion_cases:
        by_criterion.setdefault(link.acceptance_criterion_id, []).append(link.caso_master_id)
    mandatory = [item for item in criteria if item.mandatory]
    criteria_with_cases = [item for item in mandatory if by_criterion.get(item.id)]
    approved_masters = set((await db.execute(select(models.CasoPrueba.master_id).where(models.CasoPrueba.proyecto_id == project_id, models.CasoPrueba.ultimo_resultado.in_(["APROBADO", "APROBADA", "PASADO", "PASS"])))).scalars().all())
    criteria_executed = [item for item in criteria_with_cases if any(master in approved_masters for master in by_criterion[item.id])]
    result = {
        "requisitos_total": len(requirements),
        "requisitos_sin_historias": sum(1 for item in requirements if not story_by_requirement.get(item["id"])),
        "requisitos_con_historias": sum(1 for item in requirements if story_by_requirement.get(item["id"])),
        "historias_total": len(stories), "historias_sin_casos": sum(1 for item in stories if not item["case_count"]),
        "historias_con_casos": len(stories_with_cases), "casos_sin_historia": len(case_master_ids - linked_master_ids),
        "historias_requieren_revision": sum(1 for item in stories if item["requiere_revision_count"] > 0),
        "cobertura_historias_porcentaje": round((len(stories_with_cases) * 100 / len(stories)) if stories else 0, 2),
        "design_story_link_coverage": round((len(stories_with_cases) * 100 / len(stories)) if stories else 0, 2),
        "criterios_obligatorios_total": len(mandatory), "criterios_con_caso": len(criteria_with_cases),
        "criterios_sin_caso": len(mandatory) - len(criteria_with_cases), "criterios_con_ejecucion": len(criteria_executed),
        "criterios_con_ultimo_resultado_aprobado": len(criteria_executed),
        "cobertura_diseno": round((len(criteria_with_cases) * 100 / len(mandatory)) if mandatory else 0, 2),
        "cobertura_ejecutada": round((len(criteria_executed) * 100 / len(mandatory)) if mandatory else 0, 2),
        "cobertura_validada": round((len(criteria_executed) * 100 / len(mandatory)) if mandatory else 0, 2),
        "estado_disponibilidad": "NOT_AVAILABLE" if not mandatory else "AVAILABLE",
        "items": [{**requirement, "historias": story_by_requirement.get(requirement["id"], [])} for requirement in requirements],
    }
    for item in result["items"]:
        requirement_story_ids = {story["id"] for story in item["historias"]}
        requirement_criteria = [criterion for criterion in mandatory if criterion.historia_id in requirement_story_ids]
        item["criterios_obligatorios_sin_caso"] = sum(1 for criterion in requirement_criteria if not by_criterion.get(criterion.id))
        item["criterios_pendientes_revision"] = sum(story["requiere_revision_count"] for story in item["historias"])
    return result


async def get_acceptance_criterion_coverage(db, historia_id):
    """Coverage matrix used by the review-first AI case-generation wizard."""
    criteria = (await db.execute(select(models.AcceptanceCriterion).where(
        models.AcceptanceCriterion.historia_id == historia_id,
        models.AcceptanceCriterion.activo.is_(True),
    ).order_by(models.AcceptanceCriterion.orden))).scalars().all()
    links = (await db.execute(select(models.AcceptanceCriterionCase).where(
        models.AcceptanceCriterionCase.acceptance_criterion_id.in_([item.id for item in criteria]) if criteria else False
    ))).scalars().all() if criteria else []
    by_criterion = {}
    for link in links:
        by_criterion.setdefault(link.acceptance_criterion_id, []).append(str(link.caso_master_id))
    return {"historia_id": historia_id, "criterios": [{"id": item.id, "codigo": item.codigo, "titulo": item.titulo, "mandatory": item.mandatory, "case_master_ids": by_criterion.get(item.id, []), "covered": bool(by_criterion.get(item.id))} for item in criteria]}
