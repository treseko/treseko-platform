"""Review edited drafts before the user decides whether to create records."""
from typing import Any, Literal
from uuid import UUID
from pydantic import BaseModel, Field
from fastapi import APIRouter
from ...main_context import *
from ...repositories import story_generation, case_generation
from ...repositories.generation_guards import lock_generation, require_current_sources
from ...repositories.generation_semantic_review import reviews_for_application, stamp_semantic_review
from ...repositories.story_authoring_rules import validate_proposal
from ...services.edition.entitlement_service import require_feature

router = APIRouter(tags=['Trazabilidad'])


class DraftReviewRequest(BaseModel):
    propuestas: list[dict[str, Any]] = Field(min_length=1, max_length=20)


@router.post('/generaciones-{kind}/{generation_id}/revisar')
async def review_drafts(kind: Literal['historias', 'casos'], generation_id: UUID,
                       payload: DraftReviewRequest, db: AsyncSession = Depends(get_db),
                       user: models.Usuario = Depends(auth.get_current_active_user),
                       _module_user: models.Usuario = Depends(auth.check_module('proyectos', 'edit'))):
    capability = 'proyectos.historias.generar_casos_ia' if kind == 'casos' else 'proyectos.historias'
    await auth.check_capability(capability, 'edit')(user)
    if kind == 'casos':
        await require_feature('ai.case_generation')(db)
        if not auth.has_capability_permission(user, 'crear_pruebas.casos', 'edit') or not auth.has_capability_permission(user, 'crear_pruebas.trazabilidad', 'edit'):
            raise HTTPException(status_code=403, detail='Necesitas permisos para crear y trazar casos de prueba')
    module = case_generation if kind == 'casos' else story_generation
    run = (await db.execute(select(models.CasoGeneracion).where(models.CasoGeneracion.id == generation_id))).scalar_one_or_none() if kind == 'casos' else await crud.get_story_generation(db, generation_id)
    if not run:
        raise HTTPException(status_code=404, detail='Generación no encontrada')
    await access_control.require_project_access(db, user, run.proyecto_id, 'edit')
    run = await lock_generation(db, run)
    if run.estado != 'LISTA_PARA_REVISION':
        raise HTTPException(status_code=400, detail='La generación no está lista para revisión.')
    try:
        await require_current_sources(db, run)
        workflow = await (module._workflow(db) if kind == 'casos' else module._story_generation_workflow(db))
        if run.workflow_id != workflow.id or run.workflow_version != workflow.version:
            raise ValueError('El workflow cambió. Inicia un nuevo análisis.')
        originals = run.propuestas_originales_json or []
        known = {item['local_id'] for item in originals}
        proposals = []
        for raw in payload.propuestas:
            if raw.get('local_id') not in known:
                raise ValueError('La propuesta no pertenece a esta generación.')
            schema = schemas.CasoGeneracionProposalInput if kind == 'casos' else schemas.HistoriaGeneracionApplyStory
            data = {**raw, 'selected': False, 'quality': {}}
            typed = schema.model_validate(data)
            typed.selected = bool(raw.get('selected', True))
            proposals.append(typed)
        if len({item.local_id for item in proposals}) != len(proposals):
            raise ValueError('No se puede revisar una propuesta repetida.')
        reports = await reviews_for_application(db, run, workflow, proposals, module._call_engine,
                                               kind='case' if kind == 'casos' else 'story', enforce_review=False)
        updated = {item.local_id: item.model_dump(mode='json') for item in proposals}
        for item in updated.values():
            report = reports[item['local_id']]
            item['quality'] = {'testability': report['verdict'], 'warnings': [finding['message'] for finding in report.get('findings', [])][:30], 'semantic_review': report}
            if kind == 'historias':
                validate_proposal(item, set(run.accepted_assumption_ids or []), [], require_v2_fields=int(run.workflow_version or 1) >= 2)
            elif any(original.get('local_id') == item['local_id'] and (original.get('quality') or {}).get('testability') == 'FAIL' for original in originals):
                item['quality']['testability'] = 'FAIL'
                item['quality']['warnings'] = ['La propuesta original tenía observaciones críticas; confirma su revisión explícitamente.', *item['quality']['warnings']][:30]
            stamp_semantic_review(item)
        persisted = run.propuestas_finales_json or getattr(run, 'propuestas', None) or []
        persisted_by_id = {item['local_id']: item for item in persisted}
        for proposal_id, item in updated.items():
            # Keep server-owned duplicate warnings visible after semantic review.
            for key in ('duplicate_candidates', 'original_fingerprint', 'similar_stories', 'similarity_check'):
                if key in persisted_by_id.get(proposal_id, {}):
                    item[key] = persisted_by_id[proposal_id][key]
        run.propuestas_finales_json = [updated.get(item['local_id'], item) for item in persisted]
        await crud.create_audit_log(db=db, usuario_id=user.id, accion='REVIEW', recurso='generacion_contenido', recurso_id=run.id,
                                    detalles={'proyecto_id': str(run.proyecto_id), 'propuestas': list(updated)}, ip_address='api', commit=False)
        await db.commit()
    except (ValueError, TypeError) as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return module.case_generation_payload(run) if kind == 'casos' else module._generation_payload(run)
