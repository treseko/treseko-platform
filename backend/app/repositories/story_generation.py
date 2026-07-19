"""AI-assisted story generation kept separate from test execution workflows."""

from __future__ import annotations

from uuid import UUID
import hashlib
import json

import httpx
from sqlalchemy import select

from .repository_context import *
from .core_settings_ai_workflow_helpers import get_configured_ai_provider_api_key
from .ai_workflow_serialization import _workflow_definition
from .ai_workflows import get_ai_workflow
from .traceability_records import _next_code, _story_payload


def _generation_payload(item):
    return {
        "id": item.id, "requisito_id": item.requisito_id, "proyecto_id": item.proyecto_id,
        "workflow_id": item.workflow_id, "workflow_version": item.workflow_version,
        "estado": item.estado, "instrucciones": item.instrucciones,
        "fuente_snapshot": item.fuente_snapshot or {}, "estimacion": item.estimacion or {},
        "propuestas": item.propuestas or [], "error_detalle": item.error_detalle,
        "fecha_creacion": item.fecha_creacion, "fecha_actualizacion": item.fecha_actualizacion,
    }


async def _story_generation_workflow(db):
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
    """Install the additive universal default without touching test execution."""
    agent = (await db.execute(select(models.AiUniversalAgent).where(models.AiUniversalAgent.key == "story-generation"))).scalar_one_or_none()
    if not agent:
        agent = models.AiUniversalAgent(key="story-generation", name="Generador de historias", description="Genera propuestas revisables desde requisitos", category="analysis", origin_type="builtin")
        db.add(agent); await db.flush()
        contract = {
            "contract_version": "treseko.universal-agent/v1", "key": "story-generation", "version": "1.0.0", "name": agent.name,
            "description": agent.description, "metadata": {"author_type": "builtin", "tags": ["traceability", "story-generation"]},
            "implementation": {"runtime_key": "universal-agent-runtime/v1", "capability_profile": "analysis", "native_adapter": "universal-llm/v1", "editable_strategy": "prompt"},
            "inputs": {"schema": {}, "mapping": {}}, "instructions": {"mode": "llm", "objective": "Generar historias de usuario revisables desde un requisito."},
            "capabilities": ["llm.reason", "memory.read", "memory.write"], "output_contract": {"schema": {}, "publish": {}},
            "memory": {"read_namespaces": ["generation"], "write_namespaces": ["generation"]},
            "execution": {"timeout_sec": 180, "max_retries": 0, "model": {}},
            "ports": {"control_inputs": ["input"], "control_outputs": ["success", "failed", "blocked", "retry"]},
            "security": {"allow_private_network": False, "allow_filesystem": False, "allow_shell": False, "allow_arbitrary_code": False}, "ui": {"category": "analysis"},
        }
        digest = hashlib.sha256(json.dumps(contract, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        version = models.AiUniversalAgentVersion(agent_id=agent.id, version="1.0.0", status="PUBLISHED", contract_json=contract, contract_hash=digest)
        db.add(version); await db.flush()
    else:
        version = (await db.execute(select(models.AiUniversalAgentVersion).where(models.AiUniversalAgentVersion.agent_id == agent.id, models.AiUniversalAgentVersion.status == "PUBLISHED").order_by(models.AiUniversalAgentVersion.created_at.desc()))).scalars().first()
    if not version:
        raise ValueError("El agente universal para generar historias no tiene una versión publicada.")
    workflow = models.AiWorkflow(name="Generación de historias", version=1, status="ACTIVE", is_default=False, workflow_format="universal_v2", workflow_purpose="story_generation")
    db.add(workflow); await db.flush()
    node = models.AiWorkflowNode(workflow_id=workflow.id, type="StoryGenerator", name="Generar historias", agent_key="STORY_GENERATOR", universal_agent_version_id=version.id, prompt_template="Genera historias de usuario claras, sin duplicados y con criterios verificables.", timeout_sec=180)
    db.add(node)
    await db.commit()
    return workflow


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
        wiki_pages = [{"id": str(item.id), "titulo": item.titulo, "contenido": (item.contenido or "")[:12000]} for item in rows]
    return {
        "requisito": {
            "id": str(requirement.id), "codigo": requirement.codigo, "titulo": requirement.titulo,
            "descripcion_markdown": requirement.descripcion_markdown or "", "prioridad": requirement.prioridad,
            "estado": requirement.estado, "referencia_externa": {
                "provider": requirement.external_provider, "reference": requirement.external_reference,
                "url": requirement.external_url,
            },
        },
        "componentes": components,
        "wiki": wiki_pages,
    }


async def _call_engine(db, workflow, phase, context, instructions, max_stories=None):
    config = await get_ai_engine_config(db)
    payload = {
        "phase": phase,
        "context": context,
        "instructions": instructions,
        "max_stories": max_stories,
        "workflow_definition": _workflow_definition(workflow),
        "provider": config.get("provider"), "llm_endpoint": config.get("llm_endpoint"),
        "model": config.get("model"), "provider_api_key": get_configured_ai_provider_api_key(config, config.get("provider")),
        "temperature": config.get("temperature"), "timeout_seconds": min(int(config.get("timeout_seconds") or 900), 180),
    }
    # Content generation should fail visibly instead of leaving the review modal
    # waiting for the Engine's much longer model timeout.
    async with httpx.AsyncClient(timeout=45) as client:
        response = await client.post(f"{ENGINE_URL.rstrip('/')}/generate-stories-sync", json=payload)
    if response.status_code >= 400:
        raise ValueError("El Motor IA no pudo generar historias. Revisa su disponibilidad y configuración.")
    data = response.json()
    if not isinstance(data, dict):
        raise ValueError("El Motor IA devolvió una respuesta inválida.")
    return data


def _normalize_candidates(raw, max_stories):
    candidates = raw.get("historias") if isinstance(raw, dict) else None
    if not isinstance(candidates, list) or not candidates:
        raise ValueError("La IA no devolvió historias válidas para revisar.")
    normalized = []
    titles = set()
    for item in candidates[:max_stories]:
        if not isinstance(item, dict):
            continue
        title = str(item.get("titulo") or "").strip()
        if not title or title.lower() in titles:
            continue
        titles.add(title.lower())
        normalized.append({
            "titulo": title[:255],
            "descripcion_markdown": str(item.get("descripcion_markdown") or "")[:512 * 1024],
            "criterios_aceptacion_markdown": str(item.get("criterios_aceptacion_markdown") or "")[:512 * 1024],
            "prioridad": str(item.get("prioridad") or "MEDIA").upper() if str(item.get("prioridad") or "MEDIA").upper() in {"ALTA", "MEDIA", "BAJA"} else "MEDIA",
        })
    if not normalized:
        raise ValueError("Las propuestas de IA no cumplen el formato requerido.")
    return normalized


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
        result = await _call_engine(db, workflow, "estimate", context, run.instrucciones)
        estimate = result.get("estimacion") if isinstance(result.get("estimacion"), dict) else {}
        recommended = int(estimate.get("cantidad_recomendada") or 0)
        if not 1 <= recommended <= 20:
            raise ValueError("La IA no pudo estimar una cantidad válida de historias.")
        run.estimacion = {"cantidad_recomendada": recommended, "rango_min": max(1, int(estimate.get("rango_min") or recommended)), "rango_max": min(20, int(estimate.get("rango_max") or recommended)), "justificacion": str(estimate.get("justificacion") or "")[:2000], "fuentes_usadas": result.get("fuentes_usadas") or []}
        run.estado = "ESTIMADA"
    except Exception as exc:
        run.estado = "BLOQUEADA"; run.error_detalle = str(exc)
    await db.commit()
    await db.refresh(run)
    return _generation_payload(run)


async def generate_story_candidates(db, run, payload):
    if run.estado != "ESTIMADA":
        raise ValueError("Primero solicita y revisa la estimación de esta generación.")
    workflow = await _story_generation_workflow(db)
    if run.workflow_id != workflow.id or run.workflow_version != workflow.version:
        raise ValueError("El workflow de generación cambió; solicita una nueva estimación.")
    run.estado = "GENERANDO"; await db.commit()
    await db.refresh(run)
    try:
        result = await _call_engine(db, workflow, "generate", run.fuente_snapshot or {}, run.instrucciones, payload.max_historias)
        candidates = _normalize_candidates(result, payload.max_historias)
        existing = (await db.execute(select(models.HistoriaUsuario.titulo).where(models.HistoriaUsuario.proyecto_id == run.proyecto_id, models.HistoriaUsuario.archivado.is_(False)))).scalars().all()
        existing_titles = {str(title).strip().lower() for title in existing}
        if any(item["titulo"].lower() in existing_titles for item in candidates):
            raise ValueError("La IA propuso una historia ya existente; ajusta el contexto o vuelve a estimar.")
        run.propuestas = candidates; run.estado = "LISTA_PARA_REVISION"; run.error_detalle = None
    except Exception as exc:
        run.estado = "BLOQUEADA"; run.error_detalle = str(exc)
    await db.commit()
    await db.refresh(run)
    return _generation_payload(run)


async def get_story_generation(db, generation_id):
    return (await db.execute(select(models.HistoriaGeneracion).where(models.HistoriaGeneracion.id == generation_id))).scalar_one_or_none()


async def apply_story_generation(db, run, stories, user_id):
    existing = (await db.execute(select(models.HistoriaUsuario.titulo).where(
        models.HistoriaUsuario.proyecto_id == run.proyecto_id,
        models.HistoriaUsuario.archivado.is_(False),
    ))).scalars().all()
    titles = {str(title).strip().lower() for title in existing}
    incoming = set()
    for candidate in stories:
        normalized = candidate.titulo.strip().lower()
        if normalized in titles or normalized in incoming:
            raise ValueError("No se puede aplicar una historia duplicada.")
        incoming.add(normalized)
    created = []
    next_number = None
    for candidate in stories:
        if next_number is None:
            code = await _next_code(db, models.HistoriaUsuario, run.proyecto_id, "US")
            next_number = int(code.rsplit("-", 1)[1])
        else:
            next_number += 1
        story = models.HistoriaUsuario(
            requisito_id=run.requisito_id, proyecto_id=run.proyecto_id, codigo=f"US-{next_number:03d}",
            titulo=candidate.titulo, descripcion_markdown=candidate.descripcion_markdown,
            criterios_aceptacion_markdown=candidate.criterios_aceptacion_markdown,
            prioridad=candidate.prioridad, estado="BORRADOR", creado_por=user_id, ultima_edicion_por=user_id,
        )
        db.add(story); await db.flush()
        db.add(models.HistoriaHistorial(
            historia_id=story.id, titulo=story.titulo, descripcion_markdown=story.descripcion_markdown,
            criterios_aceptacion_markdown=story.criterios_aceptacion_markdown, estado=story.estado,
            prioridad=story.prioridad, editado_por=user_id, comentario_cambio="Creada desde generación IA",
        ))
        await db.refresh(story, attribute_names=["requisito", "casos"])
        created.append(_story_payload(story))
    run.estado = "APLICADA"
    await db.commit()
    return created
