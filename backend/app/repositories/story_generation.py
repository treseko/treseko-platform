"""AI-assisted story generation kept separate from test execution workflows."""

from __future__ import annotations

from uuid import UUID
import hashlib
import json
from datetime import datetime, timezone

import httpx
from sqlalchemy import select

from .repository_context import *
from .core_settings_ai_workflow_helpers import get_configured_ai_provider_api_key
from .ai_workflow_serialization import _workflow_definition
from .ai_workflows import get_ai_workflow
from .ai_provider_profiles import workflow_provider_payload
from .traceability_records import _next_code, _story_payload
from .story_authoring_rules import find_title_similarities, validate_proposal


from .story_generation_helpers import (
    _analysis_readiness,
    _auto_accept_low_risk_assumptions,
    _build_context,
    _call_engine,
    _compare_story_intentions,
    _ensure_story_generation_workflow,
    _filter_planned_stories,
    _generation_payload,
    _hash,
    _json_safe,
    _normalize_candidates,
    _outline_candidates,
    _persist_engine_audit,
    _repair_traceability_refs,
    _safe_error,
    _story_generation_workflow,
    )
async def estimate_story_generation(db, requirement, payload, user_id):
    workflow = await _story_generation_workflow(db)
    context = await _build_context(db, requirement, payload.wiki_page_ids, payload.componente_ids)
    run = models.HistoriaGeneracion(
        requisito_id=requirement.id, proyecto_id=requirement.proyecto_id, workflow_id=workflow.id,
        workflow_version=workflow.version, instrucciones=payload.instrucciones.strip(), fuente_snapshot=context,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    try:
        result = await _call_engine(db, workflow, "analyze", context, run.instrucciones)
        config = await get_ai_engine_config(db)
        _persist_engine_audit(run, workflow, result, config)
        analysis = result.get("analysis") if isinstance(result.get("analysis"), dict) else {}
        readiness = _analysis_readiness(analysis)
        run.analysis_json = analysis
        readiness = _auto_accept_low_risk_assumptions(run, readiness)
        estimate = result.get("estimacion") if isinstance(result.get("estimacion"), dict) else {}
        recommended = int(estimate.get("cantidad_recomendada") or analysis.get("recommended_story_count") or 1)
        if not 1 <= recommended <= 20:
            raise ValueError("La IA no pudo estimar una cantidad válida de historias.")
        run.estimacion = {"cantidad_recomendada": recommended, "rango_min": max(1, int(estimate.get("rango_min") or recommended)), "rango_max": min(20, int(estimate.get("rango_max") or recommended)), "justificacion": str(estimate.get("justificacion") or "")[:2000], "fuentes_usadas": result.get("fuentes_usadas") or []}
        run.estimacion["readiness"] = readiness
        run.estado = "ANALIZADA" if readiness == "READY" else "ESPERANDO_SUPUESTOS"
    except Exception as exc:
        run.estado = "BLOQUEADA"; run.error_detalle = _safe_error(exc); run.sanitized_error = _safe_error(exc)
    await db.commit()
    await db.refresh(run)
    return _generation_payload(run)


def _record_question_answers(run, question_answers):
    if not question_answers:
        return
    known_questions = {
        str(question).strip()
        for question in (run.analysis_json or {}).get("questions", [])
        if str(question).strip()
    }
    answers = []
    for item in question_answers:
        question = item.question.strip()
        answer = item.answer.strip()
        if question not in known_questions:
            raise ValueError("Solo se pueden responder preguntas devueltas por el análisis.")
        if answer:
            answers.append({"question": question, "answer": answer})
    context = dict(run.fuente_snapshot or {})
    context["respuestas_usuario"] = answers
    run.fuente_snapshot = context


async def generate_story_candidates(db, run, payload):
    if run.estado not in {"ANALIZADA", "LISTA_PARA_GENERAR"}:
        raise ValueError("Primero analiza el requisito y confirma los supuestos requeridos.")
    workflow = await _story_generation_workflow(db)
    if run.workflow_id != workflow.id or run.workflow_version != workflow.version:
        raise ValueError("El workflow de generación cambió; solicita una nueva estimación.")
    _record_question_answers(run, payload.question_answers)
    context = dict(run.fuente_snapshot or {})
    context["analysis"] = run.analysis_json or {}
    run.fuente_snapshot = context
    run.estado = "GENERANDO"
    decisions = dict(run.decisiones_json or {})
    decisions["generation_progress"] = {
        "requested": payload.max_historias,
        "completed": 0,
        "failed": [],
    }
    run.decisiones_json = decisions
    run.propuestas = []
    run.propuestas_originales_json = []
    run.propuestas_finales_json = []
    await db.commit()
    await db.refresh(run)
    candidates = []
    failures = []
    all_traces = list(run.workflow_traces_json or [])
    try:
        existing = (await db.execute(select(models.HistoriaUsuario).where(models.HistoriaUsuario.proyecto_id == run.proyecto_id, models.HistoriaUsuario.archivado.is_(False)))).scalars().all()
        existing_data = [{"title": item.titulo, "actor": "", "goal": item.descripcion_markdown} for item in existing]
        existing_title_index = [
            {"id": item.id, "codigo": item.codigo, "titulo": item.titulo}
            for item in existing
        ]
        accepted = set(run.accepted_assumption_ids or [])
        # First compare the inexpensive scope titles with the existing project
        # stories. This runs once per batch, before any full draft is created.
        # It is especially important for local models where one draft can take
        # minutes. The result is advisory but duplicate plans are excluded by
        # default; the user can explicitly request a fresh analysis instead.
        plan = _outline_candidates(run, payload.max_historias)
        if not plan:
            # Old generations created before story_outline existed remain
            # compatible. They retain the previous bounded sequential path.
            plan = [
                {"local_id": f"PLAN-{index:03d}", "title": "", "story_type": "USER_STORY", "actor": "", "goal": "", "benefit": "", "reason": ""}
                for index in range(1, payload.max_historias + 1)
            ]
        preflight_traces = []
        try:
            plan_matches, preflight_traces = await _compare_story_intentions(
                db, workflow, run, plan, existing,
            )
        except Exception as exc:
            # Do not block authoring if the optional semantic critic is
            # temporarily unavailable. The fast title check and final check
            # remain in place and the audit tells QA which fallback was used.
            plan_matches = {
                item["local_id"]: find_title_similarities(item.get("title", ""), existing_title_index)
                for item in plan
            }
            decisions["preflight_duplicate_check_error"] = _safe_error(exc)
        all_traces.extend(preflight_traces)
        planned, excluded = _filter_planned_stories(plan, plan_matches)
        decisions["preflight_duplicate_check"] = {
            "requested": payload.max_historias,
            "planned": len(planned),
            "excluded_existing_intent": excluded,
            "mode": "AI_INTENT" if preflight_traces else "TITLE_FALLBACK",
        }
        decisions["generation_progress"] = {
            "requested": len(planned),
            "completed": 0,
            "failed": [],
            "excluded_existing_intent": len(excluded),
        }
        run.decisiones_json = decisions
        run.workflow_traces_json = all_traces
        await db.commit()
        await db.refresh(run)
        for proposal_index, planned_story in enumerate(planned, start=1):
            request_context = dict(run.fuente_snapshot or {})
            # The LLM does not receive an ever-growing raw conversation. It
            # receives the approved analysis plus a compact session summary,
            # enough to avoid duplicates without exhausting the local context.
            request_context["authoring_session"] = {
                "proposal_number": proposal_index,
                "proposal_total": len(planned),
                "planned_story": planned_story,
                "accepted_assumption_ids": sorted(accepted),
                "prior_proposals": [
                    {
                        "local_id": item.get("local_id"),
                        "title": item.get("title"),
                        "actor": item.get("actor"),
                        "goal": item.get("goal"),
                    }
                    for item in candidates[-10:]
                ],
            }
            try:
                result = await _call_engine(
                    db,
                    workflow,
                    "generate",
                    request_context,
                    run.instrucciones,
                    1,
                    proposal_index,
                    payload.max_historias,
                )
                config = await get_ai_engine_config(db)
                _persist_engine_audit(run, workflow, result, config)
                all_traces.extend(result.get("workflow_traces") or [])
                generated = _normalize_candidates(result, 1)
                generated = _repair_traceability_refs(
                    generated,
                    (run.fuente_snapshot or {}).get("requisito", {}).get("codigo"),
                )
                candidate = generated[0]
                # Each Engine invocation asks for one proposal. Local models
                # commonly restart identifiers at PROP-001, so make IDs stable
                # across the persisted generation rather than letting later
                # proposals overwrite the first one in review/audit records.
                candidate["local_id"] = f"PROP-{proposal_index:03d}"
                for criterion_index, criterion in enumerate(
                    candidate.get("acceptance_criteria") or [], start=1,
                ):
                    criterion["local_id"] = (
                        f"AC-PROP-{proposal_index:03d}-{criterion_index:02d}"
                    )
                # Compare with persisted stories and proposals already processed,
                # never with the candidate currently being evaluated.
                validate_proposal(candidate, accepted, existing_data + candidates)
                # This is intentionally an advisory check. A similar title may
                # still represent a different scope, so QA makes the decision.
                candidate["similar_stories"] = find_title_similarities(
                    candidate.get("title", ""), existing_title_index,
                )
                candidates.append(candidate)
            except Exception as exc:
                failures.append({"position": proposal_index, "message": _safe_error(exc)})
                # A contract failure already received one repair attempt in
                # the Engine. Continuing with four more identical calls only
                # burns local-model time and hides the actionable error.
                if "borrador incompleto después de un intento de reparación" in str(exc):
                    break
            finally:
                decisions = dict(run.decisiones_json or {})
                decisions["generation_progress"] = {
                    "requested": payload.max_historias,
                    "planned": len(planned),
                    "completed": len(candidates),
                    "failed": failures,
                    "current": proposal_index,
                    "excluded_existing_intent": len(excluded),
                }
                run.decisiones_json = decisions
                run.propuestas_originales_json = candidates
                run.propuestas_finales_json = candidates
                run.propuestas = candidates
                run.workflow_traces_json = all_traces
                run.warnings_json = [finding for item in candidates for finding in item.get("rule_findings", [])]
                await db.commit()
                await db.refresh(run)
        if not candidates and not planned:
            # The user does not need to wait for empty drafts only to learn
            # that the requirement is already covered. Keep the audit visible
            # and return directly to a review state.
            run.propuestas_originales_json = []
            run.propuestas_finales_json = []
            run.propuestas = []
            run.estado = "LISTA_PARA_REVISION"
            run.error_detalle = None
            run.sanitized_error = None
            await db.commit()
            await db.refresh(run)
            return _generation_payload(run)
        if not candidates:
            if failures:
                raise ValueError(failures[-1]["message"])
            raise ValueError("La IA no devolvió propuestas estructuradas válidas para revisar.")
        # A title heuristic is immediate but can over-report similar wording.
        # The configured QA critic adjudicates intent once for the whole batch;
        # if that short advisory call fails, retain the heuristic rather than
        # throwing away already generated, valid drafts.
        try:
            semantic_matches, comparison_traces = await _compare_story_intentions(
                db, workflow, run, candidates, existing,
            )
            all_traces.extend(comparison_traces)
            for candidate in candidates:
                candidate["similar_stories"] = semantic_matches.get(candidate.get("local_id"), [])
                candidate["similarity_check"] = {"mode": "AI_INTENT", "status": "COMPLETED"}
        except Exception as exc:
            for candidate in candidates:
                candidate["similarity_check"] = {
                    "mode": "TITLE_FALLBACK",
                    "status": "UNAVAILABLE",
                    "message": _safe_error(exc),
                }
        run.propuestas_originales_json = candidates
        run.propuestas_finales_json = candidates
        run.propuestas = candidates
        run.warnings_json = [finding for item in candidates for finding in item.get("rule_findings", [])]
        run.estado = "LISTA_PARA_REVISION"; run.error_detalle = None; run.sanitized_error = None
    except Exception as exc:
        run.estado = "BLOQUEADA"; run.error_detalle = _safe_error(exc); run.sanitized_error = _safe_error(exc)
    await db.commit()
    await db.refresh(run)
    return _generation_payload(run)


async def get_story_generation(db, generation_id):
    return (await db.execute(select(models.HistoriaGeneracion).where(models.HistoriaGeneracion.id == generation_id))).scalar_one_or_none()


async def confirm_generation_assumptions(
    db,
    run,
    assumption_ids,
    question_answers=None,
    continuation_mode="MANUAL",
):
    analysis = run.analysis_json or {}
    proposed = {str(item.get("id")) for item in analysis.get("proposed_assumptions", []) if isinstance(item, dict)}
    accepted = set(assumption_ids)
    if not accepted.issubset(proposed):
        raise ValueError("Solo se pueden aceptar supuestos devueltos por el análisis.")
    critical = {str(item.get("id")) for item in analysis.get("proposed_assumptions", []) if isinstance(item, dict) and str(item.get("risk", "")).upper() == "CRITICAL"}
    if critical - accepted:
        raise ValueError("Los supuestos críticos deben resolverse o aceptarse explícitamente antes de generar.")
    _record_question_answers(run, question_answers or [])
    run.accepted_assumption_ids = sorted(accepted)
    decisions = dict(run.decisiones_json or {})
    decisions["assumption_confirmation"] = {
        "mode": continuation_mode,
        "accepted_assumption_ids": run.accepted_assumption_ids,
        "answered_questions": len(question_answers or []),
    }
    run.decisiones_json = decisions
    run.estado = "LISTA_PARA_GENERAR"
    await db.commit()
    await db.refresh(run)
    return _generation_payload(run)


async def reanalyze_story_generation(db, run, question_answers):
    if run.estado not in {"ANALIZADA", "ESPERANDO_SUPUESTOS", "LISTA_PARA_GENERAR"}:
        raise ValueError("La generación ya avanzó y no puede volver a analizarse.")
    workflow = await _story_generation_workflow(db)
    if run.workflow_id != workflow.id or run.workflow_version != workflow.version:
        raise ValueError("El workflow de generación cambió; solicita un nuevo análisis.")
    _record_question_answers(run, question_answers)
    try:
        result = await _call_engine(db, workflow, "analyze", run.fuente_snapshot or {}, run.instrucciones)
        config = await get_ai_engine_config(db)
        _persist_engine_audit(run, workflow, result, config)
        analysis = result.get("analysis") if isinstance(result.get("analysis"), dict) else {}
        readiness = _analysis_readiness(analysis)
        run.analysis_json = analysis
        readiness = _auto_accept_low_risk_assumptions(run, readiness)
        estimate = result.get("estimacion") if isinstance(result.get("estimacion"), dict) else {}
        recommended = int(estimate.get("cantidad_recomendada") or analysis.get("recommended_story_count") or 1)
        if not 1 <= recommended <= 20:
            raise ValueError("La IA no pudo estimar una cantidad válida de historias.")
        run.estimacion = {
            "cantidad_recomendada": recommended,
            "rango_min": max(1, int(estimate.get("rango_min") or recommended)),
            "rango_max": min(20, int(estimate.get("rango_max") or recommended)),
            "justificacion": str(estimate.get("justificacion") or "")[:2000],
            "fuentes_usadas": result.get("fuentes_usadas") or [],
            "readiness": readiness,
        }
        run.estado = "ANALIZADA" if readiness == "READY" else "ESPERANDO_SUPUESTOS"
        run.error_detalle = None; run.sanitized_error = None
    except Exception as exc:
        run.estado = "BLOQUEADA"; run.error_detalle = _safe_error(exc); run.sanitized_error = _safe_error(exc)
    await db.commit()
    await db.refresh(run)
    return _generation_payload(run)


async def apply_story_generation(db, run, stories, user_id):
    if run.estado == "APLICADA":
        decisions = run.decisiones_json or {}
        return decisions.get("created_stories", [])
    if run.estado != "LISTA_PARA_REVISION":
        raise ValueError("La generación debe estar lista para revisión antes de crear borradores.")
    selected = [story for story in stories if story.selected]
    if not selected:
        raise ValueError("Selecciona al menos una propuesta para crear borradores.")
    existing = (await db.execute(select(models.HistoriaUsuario.titulo).where(
        models.HistoriaUsuario.proyecto_id == run.proyecto_id,
        models.HistoriaUsuario.archivado.is_(False),
    ))).scalars().all()
    titles = {str(title).strip().lower() for title in existing}
    incoming = set()
    accepted_assumptions = set(run.accepted_assumption_ids or [])
    for candidate in selected:
        # Never trust the editable preview's quality field. Re-run the
        # deterministic guards against exactly what will be persisted.
        candidate_for_validation = candidate.model_dump()
        validate_proposal(candidate_for_validation, accepted_assumptions, [])
        if (
            candidate_for_validation["quality"]["testability"] == "FAIL"
            and not candidate.quality_override_accepted
        ):
            raise ValueError(
                "Confirma las observaciones críticas de cada propuesta antes de crearla."
            )
        normalized = candidate.title.strip().lower()
        if normalized in titles or normalized in incoming:
            raise ValueError("No se puede aplicar una historia duplicada.")
        incoming.add(normalized)
    created = []
    next_number = None
    original_by_id = {item.get("local_id"): item for item in (run.propuestas_originales_json or []) if isinstance(item, dict)}
    decisions = []
    for candidate in selected:
        if next_number is None:
            code = await _next_code(db, models.HistoriaUsuario, run.proyecto_id, "US")
            next_number = int(code.rsplit("-", 1)[1])
        else:
            next_number += 1
        story = models.HistoriaUsuario(
            requisito_id=run.requisito_id, proyecto_id=run.proyecto_id, codigo=f"US-{next_number:03d}",
            titulo=candidate.title, descripcion_markdown=candidate.description or _story_markdown(candidate),
            criterios_aceptacion_markdown=_criteria_markdown(candidate.acceptance_criteria),
            prioridad=candidate.prioridad, estado="BORRADOR", creado_por=user_id, ultima_edicion_por=user_id,
            ai_generation_id=run.id, criterios_estructuracion_estado="STRUCTURED",
        )
        db.add(story); await db.flush()
        for order, criterion in enumerate(candidate.acceptance_criteria):
            db.add(models.AcceptanceCriterion(
                historia_id=story.id, codigo=criterion.local_id, tipo=criterion.type, titulo=criterion.title,
                given_text=criterion.given, when_text=criterion.when, then_items=criterion.then,
                observable_result=criterion.observable_result, mandatory=criterion.mandatory,
                source_refs=criterion.source_refs, assumption_refs=criterion.assumption_ids, orden=order,
            ))
        db.add(models.HistoriaHistorial(
            historia_id=story.id, titulo=story.titulo, descripcion_markdown=story.descripcion_markdown,
            criterios_aceptacion_markdown=story.criterios_aceptacion_markdown, estado=story.estado,
            prioridad=story.prioridad, editado_por=user_id, comentario_cambio="Creada desde generación IA",
        ))
        await db.refresh(story, attribute_names=["requisito", "casos"])
        created.append(_story_payload(story))
        decisions.append({
            "local_id": candidate.local_id,
            "selected": True,
            "user_id": str(user_id),
            "created_story_id": str(story.id),
            "original": original_by_id.get(candidate.local_id),
            "edited": candidate.model_dump(),
            "quality_decision": {
                "testability": candidate_for_validation["quality"]["testability"],
                "rule_findings": candidate_for_validation.get("rule_findings", []),
                "override_accepted": candidate.quality_override_accepted,
                "override_reason": candidate.quality_override_reason.strip() if candidate.quality_override_reason else None,
                "decided_by": str(user_id),
                "decided_at": datetime.now(timezone.utc).isoformat(),
            },
        })
    run.estado = "APLICADA"
    run.propuestas_finales_json = [item.model_dump(mode="json") for item in stories]
    run.decisiones_json = _json_safe({"created_stories": created, "decisions": decisions})
    await db.commit()
    return created


def _story_markdown(candidate):
    return "\n".join(filter(None, [f"**Como:** {candidate.actor}" if candidate.actor else "", f"**Quiero:** {candidate.goal}" if candidate.goal else "", f"**Para:** {candidate.benefit}" if candidate.benefit else ""]))


def _criteria_markdown(criteria):
    return "\n\n".join(
        f"### {item.title}\n**Dado:** {item.given}\n**Cuando:** {item.when}\n**Entonces:** " + "; ".join(item.then)
        for item in criteria
    )
