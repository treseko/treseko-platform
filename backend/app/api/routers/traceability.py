from typing import Annotated, Optional

from fastapi import APIRouter

from ...main_context import *
from ...services.edition.entitlement_service import require_feature


router = APIRouter(tags=["Trazabilidad"])


async def _require_requirement(db, user, requisito_id, level="read"):
    item = await crud.get_requisito(db, requisito_id)
    if not item:
        raise HTTPException(status_code=404, detail="Requisito no encontrado")
    await access_control.require_project_access(db, user, item.proyecto_id, level)
    return item


async def _require_story(db, user, historia_id, level="read"):
    item = await crud.get_historia(db, historia_id)
    if not item:
        raise HTTPException(status_code=404, detail="Historia no encontrada")
    await access_control.require_project_access(db, user, item.proyecto_id, level)
    return item


async def _audit(db, user, action, resource, resource_id, project_id, details=None):
    await crud.create_audit_log(
        db=db, usuario_id=user.id, accion=action, recurso=resource, recurso_id=resource_id,
        detalles={"proyecto_id": str(project_id), **(details or {})}, ip_address="api",
    )


async def _publish_traceability_change(item, current_user, resource, action, payload=None):
    """Notify project clients after the transaction and audit record are persisted."""
    await realtime_event_bus.publish(
        item.proyecto_id,
        f"traceability.{resource}.{action}",
        actor_id=current_user.id,
        payload={
            resource: {"id": str(item.id), "codigo": getattr(item, "codigo", None)},
            **(payload or {}),
        },
    )


@router.get("/proyectos/{proyecto_id}/requisitos/")
async def read_requisitos(
    proyecto_id: UUID, include_archived: bool = False, estado: Optional[str] = None,
    componente_id: Optional[UUID] = None, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.requisitos", "read")),
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    return await crud.list_requisitos(db, proyecto_id, include_archived, estado, componente_id)


@router.post("/requisitos/")
async def create_requisito(
    payload: schemas.RequisitoCreate, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.requisitos", "edit")),
):
    await access_control.require_project_access(db, current_user, payload.proyecto_id, "edit")
    try:
        item = await crud.create_requisito(db, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await _audit(db, current_user, "CREATE", "requisito", item.id, item.proyecto_id, {"codigo": item.codigo})
    await _publish_traceability_change(item, current_user, "requirement", "created")
    return crud._requirement_payload(item)


@router.get("/requisitos/{requisito_id}")
async def read_requisito(
    requisito_id: UUID, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.requisitos", "read")),
):
    item = await _require_requirement(db, current_user, requisito_id)
    return crud._requirement_payload(item)


@router.patch("/requisitos/{requisito_id}")
async def update_requisito(
    requisito_id: UUID, payload: schemas.RequisitoUpdate, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.requisitos", "edit")),
):
    item = await _require_requirement(db, current_user, requisito_id, "edit")
    try:
        updated = await crud.update_requisito(db, item, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await _audit(db, current_user, "UPDATE", "requisito", requisito_id, updated.proyecto_id)
    await _publish_traceability_change(updated, current_user, "requirement", "updated")
    return crud._requirement_payload(updated)


@router.post("/requisitos/{requisito_id}/archive")
async def archive_requisito(
    requisito_id: UUID, payload: schemas.ArchiveRequest, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.requisitos", "edit")),
):
    item = await _require_requirement(db, current_user, requisito_id, "edit")
    item.archivado = payload.archivado
    item.estado = "ARCHIVADO" if payload.archivado else "ACTIVO"
    item.ultima_edicion_por = current_user.id
    db.add(models.RequisitoHistorial(
        requisito_id=item.id, titulo=item.titulo, descripcion_markdown=item.descripcion_markdown,
        estado=item.estado, prioridad=item.prioridad, external_provider=item.external_provider,
        external_reference=item.external_reference, external_url=item.external_url,
        editado_por=current_user.id, comentario_cambio="Archivado" if payload.archivado else "Restaurado",
    ))
    await db.commit()
    await _audit(db, current_user, "ARCHIVE" if payload.archivado else "RESTORE", "requisito", item.id, item.proyecto_id)
    await _publish_traceability_change(item, current_user, "requirement", "archived" if payload.archivado else "restored")
    return {"ok": True}


@router.get("/requisitos/{requisito_id}/history/")
async def read_requisito_history(
    requisito_id: UUID, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.requisitos", "read")),
):
    await _require_requirement(db, current_user, requisito_id)
    return await crud.list_requisito_history(db, requisito_id)


@router.get("/requisitos/{requisito_id}/historias/")
async def read_requisito_historias(
    requisito_id: UUID, include_archived: bool = False, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.historias", "read")),
):
    item = await _require_requirement(db, current_user, requisito_id)
    return await crud.list_historias(db, item.proyecto_id, requisito_id, include_archived)


@router.get("/proyectos/{proyecto_id}/historias/")
async def read_historias(
    proyecto_id: UUID, requisito_id: Optional[UUID] = None, include_archived: bool = False,
    db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.check_capability("proyectos.historias", "read")),
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    return await crud.list_historias(db, proyecto_id, requisito_id, include_archived)


@router.post("/historias/")
async def create_historia(
    payload: schemas.HistoriaCreate, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.historias", "edit")),
):
    await access_control.require_project_access(db, current_user, payload.proyecto_id, "edit")
    try:
        item = await crud.create_historia(db, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await _audit(db, current_user, "CREATE", "historia", item.id, item.proyecto_id, {"codigo": item.codigo})
    await _publish_traceability_change(item, current_user, "story", "created")
    return {**crud._story_payload(item), "criterios_estructurados_count": len(payload.acceptance_criteria)}


@router.get("/historias/{historia_id}")
async def read_historia(
    historia_id: UUID, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.historias", "read")),
):
    item = await _require_story(db, current_user, historia_id)
    return crud._story_payload(item)


@router.patch("/historias/{historia_id}")
async def update_historia(
    historia_id: UUID, payload: schemas.HistoriaUpdate, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.historias", "edit")),
):
    item = await _require_story(db, current_user, historia_id, "edit")
    try:
        updated = await crud.update_historia(db, item, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await _audit(db, current_user, "UPDATE", "historia", historia_id, updated.proyecto_id)
    await _publish_traceability_change(updated, current_user, "story", "updated")
    return crud._story_payload(updated)


@router.post("/historias/{historia_id}/archive")
async def archive_historia(
    historia_id: UUID, payload: schemas.ArchiveRequest, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.historias", "edit")),
):
    item = await _require_story(db, current_user, historia_id, "edit")
    item.archivado = payload.archivado
    item.estado = "ARCHIVADA" if payload.archivado else "BORRADOR"
    item.ultima_edicion_por = current_user.id
    db.add(models.HistoriaHistorial(
        historia_id=item.id, titulo=item.titulo, descripcion_markdown=item.descripcion_markdown,
        criterios_aceptacion_markdown=item.criterios_aceptacion_markdown, estado=item.estado,
        prioridad=item.prioridad, external_provider=item.external_provider,
        external_reference=item.external_reference, external_url=item.external_url,
        editado_por=current_user.id, comentario_cambio="Archivada" if payload.archivado else "Restaurada",
    ))
    await db.commit()
    await _audit(db, current_user, "ARCHIVE" if payload.archivado else "RESTORE", "historia", item.id, item.proyecto_id)
    await _publish_traceability_change(item, current_user, "story", "archived" if payload.archivado else "restored")
    return {"ok": True}


@router.get("/historias/{historia_id}/history/")
async def read_historia_history(
    historia_id: UUID, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.historias", "read")),
):
    await _require_story(db, current_user, historia_id)
    return await crud.list_historia_history(db, historia_id)


@router.get("/historias/{historia_id}/casos/")
async def read_historia_cases(
    historia_id: UUID, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.trazabilidad", "read")),
):
    await _require_story(db, current_user, historia_id)
    return await crud.get_historia_cases(db, historia_id)


@router.get("/casos/{master_id}/historias/")
async def read_case_historias(
    master_id: UUID, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.trazabilidad", "read")),
):
    cases = await crud.get_caso_versions(db, master_id)
    if not cases:
        raise HTTPException(status_code=404, detail="Caso de prueba no encontrado")
    await access_control.require_project_access(db, current_user, cases[0].proyecto_id, "read")
    return await crud.list_case_historias(db, master_id)


@router.post("/casos/{master_id}/historias/{historia_id}/confirmar-revision")
async def confirm_case_historia_revision(
    master_id: UUID, historia_id: UUID, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.trazabilidad", "edit")),
):
    cases = await crud.get_caso_versions(db, master_id)
    if not cases:
        raise HTTPException(status_code=404, detail="Caso de prueba no encontrado")
    case = cases[0]
    await access_control.require_project_access(db, current_user, case.proyecto_id, "edit")
    try:
        await crud.confirm_case_historia_revision(db, case, historia_id, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await _audit(db, current_user, "CONFIRM_REVIEW", "caso_historia", case.id, case.proyecto_id, {"historia_id": str(historia_id)})
    await _publish_traceability_change(case, current_user, "case_links", "review_confirmed", {"historia_id": str(historia_id)})
    return await crud.list_case_historias(db, master_id)


@router.put("/casos/{master_id}/historias/")
async def replace_case_historias(
    master_id: UUID, payload: schemas.CasoHistoriasUpdate, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.trazabilidad", "edit")),
):
    cases = await crud.get_caso_versions(db, master_id)
    if not cases:
        raise HTTPException(status_code=404, detail="Caso de prueba no encontrado")
    case = cases[0]
    await access_control.require_project_access(db, current_user, case.proyecto_id, "edit")
    try:
        await crud.replace_case_historias(db, case, payload.historia_ids, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await _audit(db, current_user, "LINK", "caso_historias", case.id, case.proyecto_id, {"historia_ids": [str(item) for item in payload.historia_ids]})
    await _publish_traceability_change(case, current_user, "case_links", "updated", {"historia_ids": [str(item) for item in payload.historia_ids]})
    return await crud.list_case_historias(db, master_id)


@router.get("/proyectos/{proyecto_id}/trazabilidad/cobertura/")
async def read_coverage(
    proyecto_id: UUID, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.trazabilidad", "read")),
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    return await crud.coverage_summary(db, proyecto_id)


@router.post("/requisitos/{requisito_id}/generaciones-historias/estimar")
async def estimate_generated_stories(
    requisito_id: UUID, payload: schemas.HistoriaGeneracionEstimateRequest, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.historias.generar_ia", "edit")),
):
    if not auth.has_capability_permission(current_user, "motor_ia.workflow_execute", "edit"):
        raise HTTPException(status_code=403, detail="No tienes permisos para ejecutar workflows")
    requirement = await _require_requirement(db, current_user, requisito_id, "edit")
    if requirement.archivado:
        raise HTTPException(status_code=400, detail="No se pueden generar historias para un requisito archivado")
    try:
        generation = await crud.estimate_story_generation(db, requirement, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await _audit(db, current_user, "ESTIMATE", "historia_generacion", generation["id"], requirement.proyecto_id)
    return generation


@router.post("/generaciones-historias/{generation_id}/generar")
async def generate_story_candidates(
    generation_id: UUID, payload: schemas.HistoriaGeneracionGenerateRequest, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.historias.generar_ia", "edit")),
):
    if not auth.has_capability_permission(current_user, "motor_ia.workflow_execute", "edit"):
        raise HTTPException(status_code=403, detail="No tienes permisos para ejecutar workflows")
    generation = await crud.get_story_generation(db, generation_id)
    if not generation:
        raise HTTPException(status_code=404, detail="Generación no encontrada")
    await access_control.require_project_access(db, current_user, generation.proyecto_id, "edit")
    try:
        return await crud.generate_story_candidates(db, generation, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/generaciones-historias/{generation_id}")
async def read_story_generation(
    generation_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.historias.generar_ia", "read")),
):
    generation = await crud.get_story_generation(db, generation_id)
    if not generation:
        raise HTTPException(status_code=404, detail="Generación no encontrada")
    await access_control.require_project_access(db, current_user, generation.proyecto_id, "read")
    return crud._generation_payload(generation)


@router.post("/generaciones-historias/{generation_id}/reanalizar")
async def reanalyze_story_generation(
    generation_id: UUID, payload: schemas.HistoriaGeneracionGenerateRequest, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.historias.generar_ia", "edit")),
):
    generation = await crud.get_story_generation(db, generation_id)
    if not generation:
        raise HTTPException(status_code=404, detail="Generación no encontrada")
    await access_control.require_project_access(db, current_user, generation.proyecto_id, "edit")
    try:
        result = await crud.reanalyze_story_generation(db, generation, payload.question_answers)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await _audit(db, current_user, "REANALYZE", "historia_generacion", generation.id, generation.proyecto_id, {"answered_questions": len(payload.question_answers)})
    return result


@router.post("/generaciones-historias/{generation_id}/supuestos")
async def confirm_generation_assumptions(
    generation_id: UUID, payload: schemas.AssumptionConfirmation, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.historias.generar_ia", "edit")),
):
    generation = await crud.get_story_generation(db, generation_id)
    if not generation:
        raise HTTPException(status_code=404, detail="Generación no encontrada")
    await access_control.require_project_access(db, current_user, generation.proyecto_id, "edit")
    try:
        result = await crud.confirm_generation_assumptions(
            db,
            generation,
            payload.assumption_ids,
            payload.question_answers,
            payload.continuation_mode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await _audit(db, current_user, "CONFIRM_ASSUMPTIONS", "historia_generacion", generation.id, generation.proyecto_id, {"assumption_ids": payload.assumption_ids, "answered_questions": len(payload.question_answers), "continuation_mode": payload.continuation_mode})
    return result


@router.post("/generaciones-historias/{generation_id}/aplicar")
async def apply_generated_stories(
    generation_id: UUID, payload: schemas.HistoriaGeneracionApplyRequest, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.historias", "edit")),
):
    generation = await crud.get_story_generation(db, generation_id)
    if not generation:
        raise HTTPException(status_code=404, detail="Generación no encontrada")
    await access_control.require_project_access(db, current_user, generation.proyecto_id, "edit")
    if generation.estado != "LISTA_PARA_REVISION":
        raise HTTPException(status_code=400, detail="La generación no tiene propuestas disponibles para aplicar")
    try:
        created = await crud.apply_story_generation(db, generation, payload.historias, current_user.id)
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await _audit(db, current_user, "APPLY", "historia_generacion", generation.id, generation.proyecto_id, {"historias": [item["codigo"] for item in created]})
    for item in created:
        await realtime_event_bus.publish(generation.proyecto_id, "traceability.story.created", actor_id=current_user.id, payload={"resource": {"id": str(item["id"]), "codigo": item["codigo"]}, "source": "ai_generation"})
    return {"historias": created}


@router.post("/historias/{historia_id}/generaciones-casos/estimar", dependencies=[Depends(require_feature("ai.case_generation"))])
async def estimate_generated_cases(
    historia_id: UUID, payload: schemas.CasoGeneracionEstimateRequest, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.historias.generar_casos_ia", "edit")),
):
    if not auth.has_capability_permission(current_user, "motor_ia.workflow_execute", "edit"):
        raise HTTPException(status_code=403, detail="No tienes permisos para ejecutar workflows")
    story = await _require_story(db, current_user, historia_id, "edit")
    if not auth.has_capability_permission(current_user, "crear_pruebas.casos", "edit") or not auth.has_capability_permission(current_user, "crear_pruebas.trazabilidad", "edit"):
        raise HTTPException(status_code=403, detail="Necesitas permisos para crear y trazar casos de prueba")
    try:
        result = await crud.estimate_case_generation(db, story.id, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await _audit(db, current_user, "ESTIMATE", "caso_generacion", result["id"], story.proyecto_id)
    return result


@router.get("/generaciones-casos/{generation_id}", dependencies=[Depends(require_feature("ai.case_generation"))])
async def read_case_generation(
    generation_id: UUID, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.historias.generar_casos_ia", "read")),
):
    item = (await db.execute(select(models.CasoGeneracion).where(models.CasoGeneracion.id == generation_id))).scalar_one_or_none()
    if not item: raise HTTPException(status_code=404, detail="Generación no encontrada")
    await access_control.require_project_access(db, current_user, item.proyecto_id, "read")
    return crud.case_generation_payload(item)


@router.post("/generaciones-casos/{generation_id}/supuestos", dependencies=[Depends(require_feature("ai.case_generation"))])
async def confirm_generated_case_assumptions(
    generation_id: UUID, payload: schemas.AssumptionConfirmation, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.historias.generar_casos_ia", "edit")),
):
    item = (await db.execute(select(models.CasoGeneracion).where(models.CasoGeneracion.id == generation_id))).scalar_one_or_none()
    if not item: raise HTTPException(status_code=404, detail="Generación no encontrada")
    await access_control.require_project_access(db, current_user, item.proyecto_id, "edit")
    try:
        result = await crud.confirm_case_generation_assumptions(db, item, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await _audit(db, current_user, "CONFIRM_ASSUMPTIONS", "caso_generacion", item.id, item.proyecto_id, {"assumption_ids": payload.assumption_ids, "answered_questions": len(payload.question_answers)})
    return result


@router.post("/generaciones-casos/{generation_id}/planificar", dependencies=[Depends(require_feature("ai.case_generation"))])
@router.post("/generaciones-casos/{generation_id}/generar", dependencies=[Depends(require_feature("ai.case_generation"))])
async def generate_case_proposals(
    generation_id: UUID, payload: schemas.CasoGeneracionPlanRequest, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.historias.generar_casos_ia", "edit")),
):
    if not auth.has_capability_permission(current_user, "motor_ia.workflow_execute", "edit"):
        raise HTTPException(status_code=403, detail="No tienes permisos para ejecutar workflows")
    item = (await db.execute(select(models.CasoGeneracion).where(models.CasoGeneracion.id == generation_id))).scalar_one_or_none()
    if not item: raise HTTPException(status_code=404, detail="Generación no encontrada")
    await access_control.require_project_access(db, current_user, item.proyecto_id, "edit")
    try:
        result = await crud.generate_case_proposals(db, item, payload)
    except ValueError as exc:
        await db.rollback(); raise HTTPException(status_code=400, detail=str(exc)) from exc
    await _audit(db, current_user, "GENERATE", "caso_generacion", item.id, item.proyecto_id, {"max_casos": payload.max_casos})
    return result


@router.get("/historias/{historia_id}/criterios-cobertura", dependencies=[Depends(require_feature("ai.case_generation"))])
async def read_story_criterion_coverage(
    historia_id: UUID, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.trazabilidad", "read")),
):
    story = await _require_story(db, current_user, historia_id)
    return await crud.get_acceptance_criterion_coverage(db, story.id)


@router.post("/generaciones-casos/{generation_id}/aplicar", dependencies=[Depends(require_feature("ai.case_generation"))])
async def apply_generated_cases(
    generation_id: UUID, payload: schemas.CasoGeneracionApplyRequest, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.historias.generar_casos_ia", "edit")),
):
    item = (await db.execute(select(models.CasoGeneracion).where(models.CasoGeneracion.id == generation_id))).scalar_one_or_none()
    if not item: raise HTTPException(status_code=404, detail="Generación no encontrada")
    await access_control.require_project_access(db, current_user, item.proyecto_id, "edit")
    if not auth.has_capability_permission(current_user, "crear_pruebas.casos", "edit") or not auth.has_capability_permission(current_user, "crear_pruebas.trazabilidad", "edit"):
        raise HTTPException(status_code=403, detail="Necesitas permisos para crear y trazar casos de prueba")
    try:
        created = await crud.apply_case_generation(db, item, payload, current_user.id)
    except ValueError as exc:
        await db.rollback(); raise HTTPException(status_code=400, detail=str(exc)) from exc
    await _audit(db, current_user, "APPLY", "caso_generacion", item.id, item.proyecto_id, {"casos": [case["codigo"] for case in created]})
    for case in created:
        await realtime_event_bus.publish(item.proyecto_id, "traceability.case.created", actor_id=current_user.id, payload={"resource": {"id": str(case["id"]), "codigo": case["codigo"]}, "source": "ai_case_generation"})
    return {"casos": created}
