"""Governed, review-first manual test case generation from structured stories."""
from __future__ import annotations

import hashlib
import json
import os
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from uuid import UUID

import httpx
from sqlalchemy import func, select

from .repository_context import *
from .ai_workflow_serialization import _workflow_definition
from .core_settings_ai_workflow_helpers import get_configured_ai_provider_api_key
from .ai_workflows import get_ai_workflow
from .ai_provider_profiles import workflow_provider_payload
from .traceability_records import get_historia
from .suites_cases import generate_case_code
from ..services.edition.entitlement_service import check_limit

CASE_NODES = ["CaseScopeAnalyzer", "TestDesignPlanner", "TestCaseAuthor", "QaCaseCritic", "CoverageTraceabilityAuditor"]
_DUPLICATE_STOPWORDS = {"a", "al", "con", "de", "del", "el", "en", "la", "las", "los", "para", "por", "que", "se", "un", "una", "y"}


def _hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def _normalized_text(value):
    value = unicodedata.normalize("NFD", str(value or ""))
    value = "".join(char for char in value if unicodedata.category(char) != "Mn").lower()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", value).split())


def _terms(value):
    return {word for word in _normalized_text(value).split() if len(word) > 2 and word not in _DUPLICATE_STOPWORDS}


def _jaccard(left, right):
    left_terms, right_terms = _terms(left), _terms(right)
    if not left_terms and not right_terms:
        return 0.0
    return len(left_terms & right_terms) / len(left_terms | right_terms)


def _proposal_steps_text(proposal):
    return " ".join(f"{step.action} {step.data} {step.expected_result}" for step in proposal.steps)


def _duplicate_signals(proposal, candidates):
    """Return explainable, deterministic duplicate hints for one location."""
    signals = []
    title_key = _normalized_text(proposal.title)
    proposal_criteria = {str(item) for item in proposal.criterion_refs}
    proposal_steps = _proposal_steps_text(proposal)
    for candidate in candidates:
        title_score = _jaccard(proposal.title, candidate["title"])
        objective_score = _jaccard(proposal.objective, candidate["objective"])
        steps_score = _jaccard(proposal_steps, candidate["steps"])
        candidate_criteria = candidate["criterion_refs"]
        criterion_score = len(proposal_criteria & candidate_criteria) / len(proposal_criteria | candidate_criteria) if proposal_criteria or candidate_criteria else 0.0
        exact_title = title_key and title_key == _normalized_text(candidate["title"])
        score = 1.0 if exact_title else round((criterion_score * 0.50) + (title_score * 0.30) + (objective_score * 0.10) + (steps_score * 0.10), 3)
        if score < 0.45:
            continue
        severity = "EXACT" if exact_title else "HIGH" if score >= 0.70 else "MEDIUM"
        reasons = []
        if exact_title:
            reasons.append("título normalizado idéntico")
        if criterion_score:
            reasons.append("criterios de aceptación en común")
        if title_score >= 0.35:
            reasons.append("título funcionalmente similar")
        if steps_score >= 0.35:
            reasons.append("pasos similares")
        signals.append({"case_id": str(candidate["case_id"]), "master_id": str(candidate["master_id"]), "code": candidate["code"], "title": candidate["title"], "score": score, "severity": severity, "reasons": reasons or ["contenido funcional similar"]})
    return sorted(signals, key=lambda item: (-item["score"], item["code"]))[:10]


async def _location_case_candidates(db, project_id, suite_id, component_id):
    query = select(models.CasoPrueba).where(
        models.CasoPrueba.proyecto_id == project_id,
        models.CasoPrueba.activo.is_(True),
        models.CasoPrueba.suite_id == suite_id,
        models.CasoPrueba.componente_id == component_id,
    )
    cases = (await db.execute(query)).scalars().all()
    master_ids = [item.master_id for item in cases]
    criteria_by_master = {master_id: set() for master_id in master_ids}
    if master_ids:
        links = (await db.execute(select(models.AcceptanceCriterionCase).where(models.AcceptanceCriterionCase.caso_master_id.in_(master_ids)))).scalars().all()
        for link in links:
            criteria_by_master.setdefault(link.caso_master_id, set()).add(str(link.acceptance_criterion_id))
    steps_by_case = {item.id: [] for item in cases}
    if cases:
        steps = (await db.execute(select(models.PasoPrueba).where(models.PasoPrueba.caso_id.in_(steps_by_case)).order_by(models.PasoPrueba.numero_paso))).scalars().all()
        for step in steps:
            steps_by_case.setdefault(step.caso_id, []).append(f"{step.accion} {step.datos or ''} {step.resultado_esperado}")
    return [{"case_id": item.id, "master_id": item.master_id, "code": item.codigo, "title": item.titulo, "objective": item.descripcion or "", "steps": " ".join(steps_by_case.get(item.id, [])), "criterion_refs": criteria_by_master.get(item.master_id, set())} for item in cases]


async def _resolve_destination_suite(db, project_id, suite_id, requested_component_id):
    if not suite_id:
        raise ValueError("La suite destino no fue definida para esta generación.")

    try:
        suite_uuid = UUID(str(suite_id))
    except (TypeError, ValueError):
        raise ValueError("La suite destino no tiene un identificador válido.")

    suite = (await db.execute(select(models.Suite).where(
        models.Suite.id == suite_uuid,
        models.Suite.proyecto_id == project_id,
        models.Suite.activo == True,
    ))).scalar_one_or_none()
    if not suite:
        raise ValueError("La suite destino no existe o no pertenece al proyecto.")
    if suite.archivado:
        raise ValueError("La suite destino está archivada. Seleccioná una suite activa del proyecto.")

    component_id = requested_component_id
    if suite.componente_id:
        if component_id and str(component_id) != str(suite.componente_id):
            raise ValueError("La suite destino pertenece a otro componente. Seleccioná una suite y componente compatibles.")
        component_id = suite.componente_id
    if not component_id:
        raise ValueError("La suite destino no tiene componente asociado. Seleccioná una suite con componente o ajustá el destino.")

    try:
        component_uuid = UUID(str(component_id))
    except (TypeError, ValueError):
        raise ValueError("El componente destino no tiene un identificador válido.")

    component = (await db.execute(select(models.Componente).where(
        models.Componente.id == component_uuid,
        models.Componente.proyecto_id == project_id,
        models.Componente.activo == True,
    ))).scalar_one_or_none()
    if not component:
        raise ValueError("El componente destino no es válido para este proyecto.")

    return suite, component.id


async def _workflow(db):
    config = await get_ai_engine_config(db)
    selected_id = (config.get("active_workflow_ids") or {}).get("test_case_generation")
    row = None
    if selected_id:
        row = (await db.execute(select(models.AiWorkflow).where(
            models.AiWorkflow.id == UUID(str(selected_id)),
            models.AiWorkflow.workflow_purpose == "test_case_generation",
            models.AiWorkflow.workflow_format == "universal_v2",
            models.AiWorkflow.status == "ACTIVE",
        ))).scalars().first()
    if not row:
        row = (await db.execute(select(models.AiWorkflow).where(models.AiWorkflow.workflow_purpose == "test_case_generation", models.AiWorkflow.workflow_format == "universal_v2", models.AiWorkflow.status == "ACTIVE").order_by(models.AiWorkflow.updated_at.desc()))).scalars().first()
    if not row:
        row = await _ensure_case_generation_workflow(db)
    return await get_ai_workflow(db, row.id)


async def _ensure_case_generation_workflow(db):
    """Install the versioned official workflow without overwriting user edits."""
    from .ai_builtin_workflows import ensure_builtin_workflow
    return await ensure_builtin_workflow(db, "test-case-generation", activate_if_missing=True)


async def _structured_story(db, story_id):
    story = await get_historia(db, story_id)
    if not story or story.archivado:
        raise ValueError("La historia no está disponible.")
    criteria = (await db.execute(select(models.AcceptanceCriterion).where(models.AcceptanceCriterion.historia_id == story.id, models.AcceptanceCriterion.activo.is_(True)).order_by(models.AcceptanceCriterion.orden))).scalars().all()
    if story.criterios_estructuracion_estado != "STRUCTURED" or not criteria:
        raise ValueError("La historia requiere criterios de aceptación estructurados antes de generar casos.")
    return story, criteria


async def _quota(db, project):
    since = utc_now() - timedelta(days=7)
    count, oldest = (await db.execute(
        select(func.count(), func.min(models.CasoGeneracion.fecha_creacion))
        .select_from(models.CasoGeneracion)
        .join(models.Proyecto, models.Proyecto.id == models.CasoGeneracion.proyecto_id)
        .where(models.Proyecto.organizacion_id == project.organizacion_id, models.CasoGeneracion.fecha_creacion >= since)
    )).one()
    check = await check_limit(db, "max_ai_case_generations_per_week", int(count or 0), increment=1, tenant_id=str(project.organizacion_id))
    if not check["allowed"]:
        raise ValueError(f"Límite semanal de generaciones de casos IA alcanzado ({check['current']} de {check['limit']}).")


def case_generation_payload(run):
    return {"id": run.id, "historia_id": run.historia_id, "requisito_id": run.requisito_id, "proyecto_id": run.proyecto_id, "workflow_id": run.workflow_id, "workflow_version": run.workflow_version, "estado": run.estado, "analysis": run.analysis_json or {}, "estimacion": run.estimacion or {}, "propuestas": run.propuestas_finales_json or [], "propuestas_originales": run.propuestas_originales_json or [], "accepted_assumption_ids": run.accepted_assumption_ids or [], "warnings": run.warnings_json or [], "workflow_traces": run.workflow_traces_json or [], "error_detalle": run.sanitized_error, "decisiones": run.decisiones_json or {}}


async def _call_engine(db, workflow, phase, context, instructions, max_cases=None):
    config = await get_ai_engine_config(db)
    timeout_seconds = max(30, min(int(config.get("timeout_seconds") or 300), 900))
    provider_payload = await workflow_provider_payload(db, workflow, config)
    provider_name = str(provider_payload.get("provider") or "").strip().lower()
    no_key_required = provider_name in {"openai-compatible", "lm-studio", "ollama"}
    if not provider_payload.get("provider"):
        raise ValueError("La configuración del workflow IA no tiene proveedor asignado.")
    if not provider_payload.get("llm_endpoint"):
        raise ValueError("La configuración del workflow IA no tiene endpoint configurado.")
    if not provider_payload.get("model"):
        raise ValueError("La configuración del workflow IA no tiene modelo configurado.")
    if not provider_payload.get("provider_api_key") and not no_key_required:
        raise ValueError(f"El proveedor IA '{provider_payload.get('provider')}' no tiene API key configurada.")

    payload = {
        "phase": phase,
        "context": context,
        "instructions": instructions,
        "max_cases": max_cases,
        "workflow_definition": _workflow_definition(workflow),
        **provider_payload,
        "temperature": config.get("temperature"),
        "max_completion_tokens": min(int(config.get("max_completion_tokens") or 4096), 12000),
    }
    token = os.getenv("AI_ENGINE_INTERNAL_TOKEN")
    headers = {"X-Engine-Internal-Token": token} if token else {}
    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        response = await client.post(f"{ENGINE_URL.rstrip('/')}/generate-test-cases-sync", json=payload, headers=headers)
    if response.status_code >= 400:
        detail = ""
        try:
            body = response.json()
            if isinstance(body, dict):
                detail = str(body.get("error") or body.get("detail") or body.get("message") or body)
            else:
                detail = str(body)
        except Exception:
            detail = (response.text or "").strip()
        if detail:
            detail = detail[:500]
            raise ValueError(f"El Motor IA no pudo generar propuestas de casos (HTTP {response.status_code}): {detail}")
        raise ValueError(f"El Motor IA no pudo generar propuestas de casos. Revisa su disponibilidad y configuración. (HTTP {response.status_code})")
    data = response.json()
    if not isinstance(data, dict):
        raise ValueError("El Motor IA devolvió una respuesta inválida.")
    return data, config


def _persist_engine_audit(run, workflow, result, config):
    metrics = result.get("metrics") if isinstance(result.get("metrics"), dict) else {}
    run.provider, run.model, run.temperature = config.get("provider"), config.get("model"), config.get("temperature")
    run.workflow_snapshot, run.context_hash = _workflow_definition(workflow), _hash(run.fuente_snapshot or {})
    run.prompt_hash, run.prompt_version = result.get("prompt_hash") or _hash(run.workflow_snapshot), str(workflow.version)
    run.workflow_traces_json = result.get("workflow_traces") or []
    run.prompt_tokens, run.completion_tokens = metrics.get("promptTokens"), metrics.get("completionTokens")
    run.total_tokens, run.latency_ms, run.estimated_cost = metrics.get("totalTokens"), metrics.get("latencyMs"), metrics.get("estimatedCost")
    run.completed_at = datetime.now(timezone.utc)


async def estimate_case_generation(db, story_id, request, user_id):
    story, criteria = await _structured_story(db, story_id)
    project = (await db.execute(select(models.Proyecto).where(models.Proyecto.id == story.proyecto_id))).scalar_one()
    destination_suite, destination_component_id = await _resolve_destination_suite(db, story.proyecto_id, request.suite_id, request.componente_id)
    await _quota(db, project)
    workflow = await _workflow(db)
    components, wiki = [], []
    if request.componente_ids:
        rows = (await db.execute(select(models.Componente).where(models.Componente.proyecto_id == story.proyecto_id, models.Componente.id.in_(request.componente_ids)))).scalars().all()
        if len(rows) != len(set(request.componente_ids)): raise ValueError("Los componentes seleccionados deben pertenecer al proyecto.")
        components = [{"id": str(x.id), "nombre": x.nombre, "descripcion": x.descripcion or ""} for x in rows]
    if request.wiki_page_ids:
        rows = (await db.execute(select(models.WikiPage).where(models.WikiPage.proyecto_id == story.proyecto_id, models.WikiPage.id.in_(request.wiki_page_ids)))).scalars().all()
        if len(rows) != len(set(request.wiki_page_ids)): raise ValueError("Las páginas Wiki seleccionadas deben pertenecer al proyecto.")
        wiki = [{"id": str(x.id), "titulo": x.titulo, "contenido": (x.contenido or "")[:12000]} for x in rows]
    context = {"historia": {"id": str(story.id), "codigo": story.codigo, "titulo": story.titulo, "descripcion": story.descripcion_markdown}, "requisito": {"id": str(story.requisito.id), "codigo": story.requisito.codigo, "titulo": story.requisito.titulo}, "criterios": [{"id": str(c.id), "codigo": c.codigo, "tipo": c.tipo, "titulo": c.titulo, "given": c.given_text, "when": c.when_text, "then": c.then_items, "observable_result": c.observable_result, "mandatory": c.mandatory, "source_refs": c.source_refs, "assumption_refs": c.assumption_refs} for c in criteria], "componentes": components, "wiki": wiki, "focus_categories": request.focus_categories}
    run = models.CasoGeneracion(
        historia_id=story.id,
        requisito_id=story.requisito_id,
        proyecto_id=story.proyecto_id,
        workflow_id=workflow.id,
        workflow_version=workflow.version,
        estado="ESTIMANDO",
        instrucciones=request.instrucciones,
        fuente_snapshot=context,
        decisiones_json={"suite_id": str(destination_suite.id), "componente_id": str(destination_component_id)},
        creado_por=user_id,
    )
    db.add(run); await db.commit(); await db.refresh(run)
    try:
        result, config = await _call_engine(db, workflow, "analyze", context, run.instrucciones)
        run.analysis_json = result.get("analysis") or {}
        run.estimacion = {**(result.get("estimacion") or {}), "scenarios": result.get("scenarios") or []}
        _persist_engine_audit(run, workflow, result, config)
        readiness = str(run.analysis_json.get("readiness") or "NEEDS_CLARIFICATION").upper()
        run.estado = "LISTA_PARA_GENERAR" if readiness == "READY" else "BLOQUEADA" if readiness == "BLOCKED" else "ESPERANDO_ACLARACIONES"
        await db.commit()
    except Exception as exc:
        run.estado, run.sanitized_error = "BLOQUEADA", "No se pudo completar el análisis de generación de casos."
        await db.commit()
        raise ValueError(str(exc)) from exc
    return case_generation_payload(run)


async def confirm_case_generation_assumptions(db, run, payload):
    if run.estado not in {"ESPERANDO_ACLARACIONES", "BLOQUEADA"}: raise ValueError("La generación no espera aclaraciones.")
    analysis = run.analysis_json or {}
    proposed = {str(x.get("id")): x for x in analysis.get("proposed_assumptions", []) if isinstance(x, dict)}
    if any(item not in proposed for item in payload.assumption_ids): raise ValueError("El supuesto no pertenece a la generación.")
    run.accepted_assumption_ids = sorted(set(payload.assumption_ids))
    run.decisiones_json = {**(run.decisiones_json or {}), "question_answers": [x.model_dump() for x in payload.question_answers], "assumption_decision_mode": payload.continuation_mode}
    unanswered = [str(x).strip() for x in analysis.get("questions", []) if str(x).strip()]
    if unanswered and not payload.question_answers: raise ValueError("Responde las preguntas abiertas antes de continuar.")
    run.estado = "LISTA_PARA_GENERAR"
    await db.commit()
    return case_generation_payload(run)


async def generate_case_proposals(db, run, request):
    if run.estado != "LISTA_PARA_GENERAR": raise ValueError("La generación no está lista para planificar casos.")
    workflow = await _workflow(db)
    planned = [item for item in (run.estimacion or {}).get("scenarios", []) if isinstance(item, dict)]
    planned_by_id = {str(item.get("local_id")): item for item in planned if str(item.get("local_id") or "").strip()}
    if request.scenario_ids and any(item not in planned_by_id for item in request.scenario_ids):
        raise ValueError("El escenario seleccionado no pertenece al plan de cobertura.")
    selected_scenarios = [planned_by_id[item] for item in request.scenario_ids] if request.scenario_ids else planned
    if planned and not selected_scenarios:
        raise ValueError("Selecciona al menos un escenario del plan de cobertura.")
    context = {**(run.fuente_snapshot or {}), "analysis": run.analysis_json or {}, "accepted_assumption_ids": run.accepted_assumption_ids or [], "question_answers": (run.decisiones_json or {}).get("question_answers", []), "scenarios": selected_scenarios}
    run.estado = "GENERANDO"; await db.commit()
    try:
        result, config = await _call_engine(db, workflow, "generate", context, run.instrucciones, min(request.max_casos, len(selected_scenarios) or request.max_casos))
        proposals = result.get("propuestas") or []
        validated = [schemas.CasoGeneracionProposalInput.model_validate({**x, "selected": True}).model_dump(mode="json") for x in proposals]
        if not validated: raise ValueError("La IA no devolvió casos con el contrato requerido.")
        decisions = run.decisiones_json or {}
        destination_suite_id = decisions.get("suite_id")
        destination_component_id = decisions.get("componente_id")
        if not destination_suite_id or not destination_component_id:
            raise ValueError("La generación no tiene una ubicación destino válida. Reinicia el proceso y vuelve a seleccionar suite y componente.")
        destination_suite, destination_component_id = await _resolve_destination_suite(
            db,
            run.proyecto_id,
            destination_suite_id,
            destination_component_id,
        )
        candidates = await _location_case_candidates(db, run.proyecto_id, destination_suite.id, destination_component_id)
        for proposal, validated_proposal in zip(proposals, validated):
            validated_proposal["duplicate_candidates"] = _duplicate_signals(
                schemas.CasoGeneracionProposalInput.model_validate(validated_proposal), candidates
            )
        run.propuestas_originales_json, run.propuestas_finales_json = proposals, validated
        run.warnings_json = result.get("warnings") or []
        _persist_engine_audit(run, workflow, result, config)
        run.estado = "LISTA_PARA_REVISION"
        await db.commit()
    except Exception as exc:
        run.estado, run.sanitized_error = "BLOQUEADA", "El modelo no devolvió propuestas de casos válidas."
        await db.commit()
        raise ValueError(str(exc)) from exc
    return case_generation_payload(run)


async def apply_case_generation(db, run, payload, user_id):
    if run.estado != "LISTA_PARA_REVISION":
        raise ValueError("La generación no está lista para revisión.")
    story, criteria = await _structured_story(db, run.historia_id)
    criteria_by_id = {item.id: item for item in criteria}
    decisions = run.decisiones_json or {}
    destination_suite_id = decisions.get("suite_id")
    destination_component_id = decisions.get("componente_id")
    if not destination_suite_id:
        raise ValueError("La generación no tiene una ubicación destino válida. Reinicia el proceso y vuelve a seleccionar suite y componente.")
    destination_suite, destination_component_id = await _resolve_destination_suite(db, story.proyecto_id, destination_suite_id, destination_component_id)
    selected = [item for item in payload.casos if item.selected]
    if not selected:
        raise ValueError("Selecciona al menos un caso.")
    created = []
    duplicate_overrides = []
    seen = set()
    decisions = run.decisiones_json or {}
    suite_id, component_id = destination_suite.id, destination_component_id
    candidates = await _location_case_candidates(db, story.proyecto_id, suite_id, component_id)
    for proposal in selected:
        key = _normalized_text(proposal.title)
        if key in seen: raise ValueError("No se puede aplicar un título de caso duplicado.")
        duplicate_signals = _duplicate_signals(proposal, candidates)
        if any(item["severity"] == "EXACT" for item in duplicate_signals):
            raise ValueError("Ya existe un caso con el mismo título en la suite y componente destino.")
        if any(item["severity"] == "HIGH" for item in duplicate_signals) and not proposal.duplicate_override_accepted:
            raise ValueError("Un caso es muy similar a otro existente. Exclúyelo o indicá una justificación auditada para conservarlo.")
        if proposal.duplicate_override_accepted:
            duplicate_overrides.append({"local_id": proposal.local_id, "reason": proposal.duplicate_override_reason, "candidates": [item["code"] for item in duplicate_signals if item["severity"] == "HIGH"]})
        seen.add(key)
        if any(item not in criteria_by_id for item in proposal.criterion_refs): raise ValueError("Un criterio seleccionado no pertenece a la historia.")
        case = models.CasoPrueba(master_id=uuid.uuid4(), codigo=await generate_case_code(db), proyecto_id=story.proyecto_id, suite_id=suite_id, componente_id=component_id, titulo=proposal.title, descripcion=proposal.objective, precondiciones="\n".join(proposal.preconditions), prioridad=models.Prioridad(proposal.priority), criticidad=models.Criticidad(proposal.criticality), tipo_prueba=models.TipoPrueba.MANUAL, dataset=proposal.test_data, creado_por=user_id)
        db.add(case); await db.flush()
        for step in proposal.steps: db.add(models.PasoPrueba(caso_id=case.id, numero_paso=step.number, accion=step.action, datos=step.data or None, resultado_esperado=step.expected_result, metadata_ai={"case_generation_id": str(run.id), "automation": proposal.automation.model_dump()}))
        db.add(models.CasoHistoria(caso_master_id=case.master_id, historia_id=story.id, creado_por=user_id, historia_actualizada_en_vinculo=story.ultima_actualizacion))
        for criterion_id in proposal.criterion_refs: db.add(models.AcceptanceCriterionCase(acceptance_criterion_id=criterion_id, caso_master_id=case.master_id, creado_por=user_id))
        created.append({"id": str(case.id), "master_id": str(case.master_id), "codigo": case.codigo, "titulo": case.titulo})
    mandatory = {x.id for x in criteria if x.mandatory}
    covered = {ref for proposal in selected for ref in proposal.criterion_refs}
    excluded = set(payload.excluded_criteria_reasons)
    if missing := mandatory - covered - excluded: raise ValueError("Hay criterios obligatorios sin cobertura o motivo de exclusión.")
    run.estado = "APLICADA"; run.decisiones_json = {**(run.decisiones_json or {}), "created_cases": created, "excluded_criteria_reasons": {str(k): v for k, v in payload.excluded_criteria_reasons.items()}, "duplicate_overrides": duplicate_overrides, "applied_by": str(user_id)}
    await db.commit()
    return created
