"""AI-assisted story generation kept separate from test execution workflows."""

from __future__ import annotations

import asyncio
from uuid import UUID
import hashlib
import json
import re
from datetime import datetime, timezone

import httpx
from sqlalchemy import select

from .repository_context import *
from .core_settings_ai_workflow_helpers import get_ai_engine_config, get_configured_ai_provider_api_key
from .ai_workflow_serialization import _workflow_definition
from .ai_workflows import get_ai_workflow
from .ai_provider_profiles import workflow_provider_payload
from .traceability_records import _next_code, _story_payload
from .story_authoring_rules import find_title_similarities, validate_proposal
from .generation_semantic_review import effective_audit_runtime
from .ai_generation_engine_errors import engine_error_code, engine_generation_error_message, engine_contract_issues


def _generation_payload(item):
    return {
        "id": item.id, "requisito_id": item.requisito_id, "proyecto_id": item.proyecto_id,
        "workflow_id": item.workflow_id, "workflow_version": item.workflow_version,
        "estado": item.estado, "instrucciones": item.instrucciones,
        "fuente_snapshot": item.fuente_snapshot or {}, "estimacion": item.estimacion or {},
        "propuestas": item.propuestas_finales_json or item.propuestas or [], "propuestas_originales": item.propuestas_originales_json or [],
        "analysis": item.analysis_json or {}, "accepted_assumption_ids": item.accepted_assumption_ids or [],
        "warnings": item.warnings_json or [], "workflow_traces": item.workflow_traces_json or [],
        "generation_progress": (item.decisiones_json or {}).get("generation_progress") or {},
        "preflight_duplicate_check": (item.decisiones_json or {}).get("preflight_duplicate_check") or {},
        "error_detalle": item.sanitized_error or item.error_detalle,
        "fecha_creacion": item.fecha_creacion, "fecha_actualizacion": item.fecha_actualizacion,
    }


async def _story_generation_workflow(db):
    config = await get_ai_engine_config(db)
    selected_id = (config.get("active_workflow_ids") or {}).get("story_generation")
    workflow = None
    if selected_id:
        workflow = (await db.execute(select(models.AiWorkflow).where(
            models.AiWorkflow.id == UUID(str(selected_id)),
            models.AiWorkflow.workflow_purpose == "story_generation",
            models.AiWorkflow.workflow_format == "universal_v2",
            models.AiWorkflow.status == "ACTIVE",
        ))).scalars().first()
    if not workflow:
        result = await db.execute(select(models.AiWorkflow).where(
        models.AiWorkflow.workflow_purpose == "story_generation",
        models.AiWorkflow.workflow_format == "universal_v2",
        models.AiWorkflow.status == "ACTIVE",
    ).order_by(models.AiWorkflow.updated_at.desc()))
        workflow = result.scalars().first()
    if not workflow:
        workflow = await _ensure_story_generation_workflow(db)
    return await get_ai_workflow(db, workflow.id)


async def _ensure_story_generation_workflow(db):
    """Install the versioned official workflow without overwriting user edits."""
    from .ai_builtin_workflows import ensure_builtin_workflow
    return await ensure_builtin_workflow(db, "story-generation", activate_if_missing=True)


async def _build_context(db, requirement, wiki_page_ids, component_ids):
    selected_component_ids = component_ids or [link.componente_id for link in requirement.componentes]
    components = []
    if selected_component_ids:
        rows = (await db.execute(select(models.Componente).where(
            models.Componente.proyecto_id == requirement.proyecto_id,
            models.Componente.id.in_(selected_component_ids),
        ))).scalars().all()
        if len(rows) != len(set(selected_component_ids)):
            raise ValueError("Los componentes seleccionados deben pertenecer al proyecto.")
        components = [{"id": str(item.id), "nombre": item.nombre, "descripcion": item.descripcion or "", "tech_stack": item.tech_stack or ""} for item in rows]
    wiki_pages = []
    if wiki_page_ids:
        rows = (await db.execute(select(models.WikiPage).where(
            models.WikiPage.proyecto_id == requirement.proyecto_id,
            models.WikiPage.id.in_(wiki_page_ids),
        ))).scalars().all()
        if len(rows) != len(set(wiki_page_ids)):
            raise ValueError("Las páginas Wiki seleccionadas deben pertenecer al proyecto.")
        wiki_pages = [{"id": str(item.id), "titulo": item.titulo, "contenido": item.contenido or ""} for item in rows]
    return {
        "context_version": 2,
        "requisito": {
            "id": str(requirement.id), "codigo": requirement.codigo, "titulo": requirement.titulo,
            "descripcion_markdown": requirement.descripcion_markdown or "", "prioridad": requirement.prioridad,
            "estado": requirement.estado, "revision": requirement.ultima_actualizacion.isoformat(), "referencia_externa": {
                "provider": requirement.external_provider, "reference": requirement.external_reference,
                "url": requirement.external_url,
            },
        },
        "componentes": components,
        "wiki": wiki_pages,
    }


async def _call_engine(
    db,
    workflow,
    phase,
    context,
    instructions,
    max_stories=None,
    proposal_index=None,
    total_stories=None,
):
    config = await get_ai_engine_config(db)
    timeout_seconds = max(30, min(int(config.get("timeout_seconds") or 300), 7200))
    context_window_tokens = max(1024, int(config.get("context_window_tokens") or 8192))
    # Keep room for the governed prompts and source data. The Engine enforces
    # its own absolute output cap as a second line of defence.
    max_completion_tokens = max(256, min(
        int(config.get("max_completion_tokens") or 4096),
        max(256, context_window_tokens - 1024),
    ))
    provider_payload = await workflow_provider_payload(db, workflow, config)
    payload = {
        "phase": phase,
        "context": context,
        "instructions": instructions,
        "max_stories": max_stories,
        "proposal_index": proposal_index,
        "total_stories": total_stories,
        "workflow_definition": _workflow_definition(workflow),
        **provider_payload,
        "temperature": config.get("temperature"), "timeout_seconds": timeout_seconds,
        "context_window_tokens": context_window_tokens,
        "max_completion_tokens": max_completion_tokens,
    }
    headers = engine_internal_headers(current_correlation_id())
    # The governed pipeline executes several nodes sequentially. Local models
    # may need more time to complete a structured multi-story response.
    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        response = await client.post(f"{ENGINE_URL.rstrip('/')}/generate-stories-sync", json=payload, headers=headers)
    if response.status_code >= 400:
        try:
            error_payload = response.json() or {}
            error_code = engine_error_code(error_payload)
        except Exception:
            error_payload = {}
            error_code = ""
        if error_code == "STORY_ANALYSIS_CONTRACT_INVALID":
            raise ValueError("El análisis de IA quedó incompleto después de un reintento. Vuelve a analizar el requisito.")
        if error_code == "GENERATION_CONTEXT_LIMIT_EXCEEDED":
            raise ValueError("El contexto completo excede el presupuesto del modelo. Selecciona menos fuentes o un modelo con mayor ventana; no se omitieron fuentes en silencio.")
        if error_code == "GENERATION_SOURCE_EXTRACTION_INCOMPLETE":
            raise ValueError("La extracción de reglas quedó incompleta o sin citas verificables. Reintenta o selecciona menos fuentes antes de continuar.")
        if error_code == "STORY_GENERATION_CONTRACT_INVALID":
            issues = engine_contract_issues(error_payload)
            detail = f" Detalle: {' '.join(issues[:3])}" if issues else ""
            raise ValueError(f"El modelo devolvió un borrador incompleto después de un intento de reparación.{detail}")
        provider_error = engine_generation_error_message(error_payload)
        if provider_error:
            raise ValueError(provider_error)
        raise ValueError("El Motor IA no pudo generar historias. Revisa su disponibilidad y configuración.")
    data = response.json()
    if not isinstance(data, dict):
        raise ValueError("El Motor IA devolvió una respuesta inválida.")
    return data


def _hash(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()


def _json_safe(value):
    """Keep JSON audit columns portable when payloads contain UUIDs/datetimes."""
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))


def _safe_error(exc):
    if isinstance(exc, httpx.TimeoutException):
        return "El Motor IA no respondió dentro del tiempo de espera configurado."
    message = str(exc).replace("\n", " ").strip()
    return message[:500] if message else "La generación no se pudo completar. Revisa el Motor IA y vuelve a intentarlo."


def _persist_engine_audit(run, workflow, result, config):
    metrics = result.get("metrics") if isinstance(result.get("metrics"), dict) else {}
    runtime = effective_audit_runtime(result)
    run.provider, run.model, run.temperature = runtime["provider"], runtime["model"], runtime["temperature"]
    run.workflow_snapshot = _workflow_definition(workflow)
    run.context_hash = _hash(run.fuente_snapshot or {})
    run.prompt_hash = result.get("prompt_hash") or _hash(run.workflow_snapshot)
    run.prompt_version = str(workflow.version)
    run.workflow_traces_json = result.get("workflow_traces") or []
    run.prompt_tokens = metrics.get("promptTokens") or metrics.get("prompt_tokens")
    run.completion_tokens = metrics.get("completionTokens") or metrics.get("completion_tokens")
    run.total_tokens = metrics.get("totalTokens") or metrics.get("total_tokens")
    run.latency_ms = metrics.get("latencyMs") or metrics.get("latency_ms")
    run.estimated_cost = metrics.get("estimatedCost") or metrics.get("estimated_cost")
    run.completed_at = datetime.now(timezone.utc)


def _normalize_candidates(raw, max_stories):
    candidates = raw.get("propuestas") or raw.get("historias") if isinstance(raw, dict) else None
    if not isinstance(candidates, list) or not candidates:
        raise ValueError("La IA no devolvió historias válidas para revisar.")
    normalized = []
    titles = set()
    for item in candidates[:max_stories]:
        if not isinstance(item, dict):
            continue
        # Legacy Engine payloads are accepted only as an import boundary. New
        # workflow output must satisfy the structured proposal contract.
        title = str(item.get("title") or item.get("titulo") or "").strip()
        if not title or title.lower() in titles:
            continue
        titles.add(title.lower())
        if "title" not in item:
            item = {
                "local_id": f"PROP-{len(normalized) + 1:03d}", "story_type": "USER_STORY", "title": title,
                "actor": "", "goal": "", "benefit": "", "description": str(item.get("descripcion_markdown") or ""),
                "source_refs": [], "assumption_ids": [], "open_questions": [], "acceptance_criteria": [], "quality": {"testability": "WARN"},
            }
        try:
            normalized.append(schemas.StoryProposalInput.model_validate(item).model_dump())
        except Exception as exc:
            raise ValueError("La IA devolvió una propuesta que no cumple el contrato estructurado.") from exc
    if not normalized:
        raise ValueError("Las propuestas de IA no cumplen el formato requerido.")
    return normalized


def _analysis_readiness(analysis):
    """Return a trustworthy readiness state; never silently promote a block."""
    readiness = str((analysis or {}).get("readiness") or "NEEDS_CLARIFICATION").upper()
    if readiness not in {"READY", "NEEDS_CLARIFICATION", "BLOCKED"}:
        raise ValueError("El análisis no devolvió un estado de preparación válido.")
    questions = [item for item in (analysis or {}).get("questions", []) if str(item or "").strip()]
    assumptions = [item for item in (analysis or {}).get("proposed_assumptions", []) if isinstance(item, dict) and str(item.get("id") or "").strip()]
    if readiness == "BLOCKED" and not questions and not assumptions:
        raise ValueError("El análisis quedó bloqueado sin una decisión accionable. Vuelve a analizar el requisito.")
    if (questions or (analysis or {}).get("proposed_assumptions")) and readiness == "READY":
        # The model may emit contradictory fields. The interactive workflow
        # must never skip a user decision merely because the label is wrong.
        readiness = "NEEDS_CLARIFICATION"
        analysis["readiness"] = readiness
    return readiness


def _resolve_answered_analysis_questions(analysis, user_answers):
    """Remove only questions that have an explicit, exact user answer."""
    if not isinstance(analysis, dict) or not isinstance(analysis.get("questions"), list):
        return 0
    answered = {
        str(item.get("question") or "").strip()
        for item in (user_answers or [])
        if isinstance(item, dict) and str(item.get("answer") or "").strip()
    }
    if not answered:
        return 0
    questions = [str(item).strip() for item in analysis["questions"] if str(item).strip()]
    resolved = [question for question in questions if question in answered]
    if not resolved:
        return 0
    remaining = [question for question in questions if question not in answered]
    analysis["questions"] = remaining
    if not remaining and not analysis.get("proposed_assumptions"):
        analysis["readiness"] = "READY"
    return len(resolved)


def _analysis_after_answered_question_update(previous_analysis, user_answers):
    """Keep a usable analysis when the model fails during reanalysis."""
    if not isinstance(previous_analysis, dict) or not previous_analysis:
        return None
    restored = dict(previous_analysis)
    restored["questions"] = list(previous_analysis.get("questions") or [])
    _resolve_answered_analysis_questions(restored, user_answers)
    return restored


def _preserve_reanalysis_after_error(run, previous_analysis, previous_estimate):
    """Retain a valid prior analysis and its retryable state after model failure."""
    restored = _analysis_after_answered_question_update(
        previous_analysis, (run.fuente_snapshot or {}).get("respuestas_usuario", []),
    )
    if not restored:
        return False
    readiness = _analysis_readiness(restored)
    run.analysis_json = restored
    run.estimacion = {**previous_estimate, "readiness": readiness}
    readiness = _auto_accept_low_risk_assumptions(run, readiness)
    run.estimacion["readiness"] = readiness
    run.estado = "ANALIZADA" if readiness == "READY" else "ESPERANDO_SUPUESTOS"
    return True


async def _finalize_interrupted_story_generation(db, run, candidates, failures, traces, requested):
    """Persist partial drafts and a retryable state when the client disconnects."""
    for candidate in candidates:
        candidate.setdefault("similarity_check", {
            "mode": "TITLE_FALLBACK", "status": "INTERRUPTED",
            "message": "La comparación semántica final no terminó.",
        })
    decisions = dict(run.decisiones_json or {})
    progress = dict(decisions.get("generation_progress") or {})
    progress.update({
        "requested": requested,
        "completed": len(candidates),
        "failed": list(failures),
        "status": "INTERRUPTED",
        "interrupted": True,
    })
    decisions["generation_progress"] = progress
    run.decisiones_json = decisions
    run.propuestas_originales_json = candidates
    run.propuestas_finales_json = candidates
    run.propuestas = candidates
    run.workflow_traces_json = traces
    run.warnings_json = [finding for item in candidates for finding in item.get("rule_findings", [])]
    run.estado = "LISTA_PARA_REVISION" if candidates else "LISTA_PARA_GENERAR"
    run.error_detalle = "La solicitud se interrumpió. Las propuestas guardadas se pueden revisar y la generación se puede reintentar."
    run.sanitized_error = run.error_detalle
    await db.commit()


def _auto_accept_low_risk_assumptions(run, readiness):
    """Low-risk defaults reduce friction while preserving the audit trail."""
    if readiness != "NEEDS_CLARIFICATION":
        return readiness
    analysis = run.analysis_json or {}
    questions = [str(item).strip() for item in analysis.get("questions", []) if str(item).strip()]
    assumptions = [item for item in analysis.get("proposed_assumptions", []) if isinstance(item, dict) and item.get("id")]
    if questions or not assumptions or len(assumptions) != len(analysis.get("proposed_assumptions", [])) or len({str(item["id"]) for item in assumptions}) != len(assumptions) or any(
        not isinstance(item.get("id"), str) or not item["id"].strip()
        or not isinstance(item.get("text"), str) or not item["text"].strip()
        or str(item.get("risk") or "").strip().upper() != "LOW"
        for item in assumptions
    ):
        return readiness
    run.accepted_assumption_ids = sorted({str(item["id"]) for item in assumptions})
    analysis["readiness"] = "READY"
    analysis["auto_accepted_assumptions"] = run.accepted_assumption_ids
    run.analysis_json = analysis
    return "READY"


def _repair_traceability_refs(candidates, requirement_code):
    """Preserve provenance omissions for explicit review; never fabricate citations."""
    return candidates


async def _compare_story_intentions(db, workflow, run, candidates, existing_stories):
    """Ask the configured QA critic once to adjudicate title-level matches.

    It deliberately sends only compact authoring fields. This makes semantic
    comparison useful without replaying Wiki content or issuing one LLM call
    per proposal.
    """
    if not candidates or not existing_stories:
        return {}, []
    requirement = (run.fuente_snapshot or {}).get("requisito") or {
        "id": str(run.requisito_id),
        "codigo": "",
    }
    context = {
        "requisito": requirement,
        "story_intent_comparison": {
            "proposals": [
                {
                    "local_id": item.get("local_id"),
                    "title": item.get("title"),
                    "actor": item.get("actor"),
                    "goal": item.get("goal"),
                    "benefit": item.get("benefit"),
                }
                for item in candidates[:20]
            ],
            "existing_stories": [
                {
                    "id": str(item.id),
                    "codigo": item.codigo,
                    "titulo": item.titulo,
                    "actor": "",
                    "goal": str(item.descripcion_markdown or "")[:500],
                }
                for item in existing_stories[:100]
            ],
        },
    }
    result = await _call_engine(db, workflow, "compare", context, "", 1)
    matches_by_proposal = {
        str(item.get("proposal_local_id")): item.get("matches") or []
        for item in (result.get("comparisons") or [])
        if isinstance(item, dict) and str(item.get("proposal_local_id") or "")
    }
    return matches_by_proposal, result.get("workflow_traces") or []


def _explicit_user_story_statements(description):
    """Read formal user-story statements without deriving intent from keywords."""
    statements = []
    for raw_line in str(description or "").splitlines():
        line = re.sub(r"^\s*(?:[-*]\s*)?(?:\*\*)?", "", raw_line).strip()
        line = re.sub(r"(?:\*\*)?\s*$", "", line).strip()
        match = re.match(r"^Como\s+(.+?)\s*,?\s+quiero\s+(.+?)\.?$", line, re.IGNORECASE)
        if not match:
            continue
        actor = match.group(1).strip(" ,.")
        action_and_benefit = match.group(2).strip()
        parts = re.split(r"\s+para\s+", action_and_benefit, maxsplit=1, flags=re.IGNORECASE)
        goal = parts[0].strip(" .")
        benefit = parts[1].strip(" .") if len(parts) > 1 else ""
        if actor and goal:
            statements.append({
                "title": goal[:1].upper() + goal[1:],
                "actor": actor,
                "goal": goal,
                "benefit": benefit,
                "reason": line,
                "source_kind": "explicit_user_story",
            })
    return statements


def _canonicalize_explicit_story_fields(proposal, planned_story):
    """Keep the persisted actor and intent faithful to a source user story."""
    if not isinstance(proposal, dict) or planned_story.get("source_kind") != "explicit_user_story":
        return proposal
    for field in ("title", "actor", "goal", "benefit"):
        value = str(planned_story.get(field) or "").strip()
        if value:
            proposal[field] = value
    return proposal


def _outline_candidates(run, max_stories):
    """Turn the analyzed scope into the bounded authoring plan.

    The analyzer is the only stage that sees the whole requirement context.
    Keeping its outline as the plan lets us eliminate already-covered intent
    *before* asking a slow local model for full drafts.
    """
    outline = (run.analysis_json or {}).get("story_outline") or []
    requirement = (getattr(run, "fuente_snapshot", None) or {}).get("requisito") or {}
    description = str(requirement.get("descripcion_markdown") or "")
    explicit_stories = _explicit_user_story_statements(description)
    if explicit_stories:
        source_text = " ".join(description.casefold().split())
        outline_is_requirement_grounded = all(
            isinstance(item, dict)
            and str(item.get("reason") or "").strip()
            and " ".join(str(item.get("reason")).casefold().split()) in source_text
            for item in outline
        )
        # When the analyzer only restates literal rules from the same formal
        # user story as separate stories, those rules are criteria of that
        # capability. Keep unrelated or paraphrased outlines on the analyzed
        # path for review instead of silently merging them.
        if not outline or outline_is_requirement_grounded:
            return [
                {"local_id": f"PLAN-{index:03d}", **item}
                for index, item in enumerate(explicit_stories[:max_stories], start=1)
            ]
    candidates = []
    for index, item in enumerate(outline[:max_stories], start=1):
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        if not title:
            continue
        candidates.append({
            "local_id": f"PLAN-{index:03d}",
            "title": title,
            "story_type": str(item.get("story_type") or "USER_STORY"),
            # The analyzer's reason is intentionally a compact purpose
            # summary, suitable for the semantic duplicate comparison.
            "actor": "",
            "goal": str(item.get("reason") or "").strip(),
            "benefit": "",
            "reason": str(item.get("reason") or "").strip(),
        })
    return candidates


def _filter_planned_stories(plan, matches_by_plan):
    """Return the stories worth drafting and the auditable exclusions."""
    planned, excluded = [], []
    for item in plan:
        matches = matches_by_plan.get(item["local_id"], [])
        if matches:
            excluded.append({
                "title": item.get("title"),
                "reason": item.get("reason"),
                "similar_stories": matches,
            })
        else:
            planned.append(item)
    return planned, excluded
