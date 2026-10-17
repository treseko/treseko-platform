"""Source freshness, concurrency and review guards for authoring workflows."""
import hashlib
from uuid import UUID
from sqlalchemy import select, text
from .. import models


async def lock_authoring_project(db, project_id):
    if db.bind.dialect.name == 'postgresql':
        key = int.from_bytes(hashlib.sha256(f'traceability:{project_id}'.encode()).digest()[:8], 'big', signed=True)
        await db.execute(text('SELECT pg_advisory_xact_lock(:key)'), {'key': key})


async def lock_generation(db, run, *, applying=False):
    # Serialize project code allocation and competing applications, then refresh
    # the generation under its row lock before checking its state.
    if applying:
        await lock_authoring_project(db, run.proyecto_id)
    return (await db.execute(select(type(run)).where(type(run).id == run.id)
        .with_for_update().execution_options(populate_existing=True))).scalar_one()


def checked_answers(analysis, answers, *, require_all=True):
    known = {str(q).strip() for q in analysis.get('questions', []) if str(q).strip()}
    answered = {}
    for item in answers:
        question, answer = item.question.strip(), item.answer.strip()
        scope_decision = str(getattr(item, 'scope_decision', 'IN_SCOPE') or 'IN_SCOPE')
        if question not in known or (not answer and scope_decision != 'OUT_OF_SCOPE') or question in answered:
            raise ValueError('Responde cada pregunta del análisis una sola vez; una pregunta sin respuesta requiere marcarse fuera del alcance.')
        answered[question] = (answer, scope_decision)
    if require_all and known - answered.keys():
        raise ValueError('Responde todas las preguntas pendientes antes de continuar.')
    return [{'question': q, 'answer': value[0], 'scope_decision': value[1]} for q, value in answered.items()]


def check_assumptions(analysis, accepted_ids, mode='MANUAL'):
    proposed = {str(x.get('id')): x for x in analysis.get('proposed_assumptions', []) if isinstance(x, dict)}
    accepted = set(accepted_ids)
    if accepted - proposed.keys():
        raise ValueError('El supuesto no pertenece a esta generación.')
    if mode == 'AUTO_TIMEOUT' and (
        any(str(question or '').strip() for question in analysis.get('questions', []))
        or not accepted
        or accepted != set(proposed)
        or len(proposed) != len(analysis.get('proposed_assumptions', []))
        or any(str(proposed[key].get('risk') or '').strip().upper() != 'LOW'
               or not isinstance(proposed[key].get('id'), str) or not proposed[key]['id'].strip()
               or not isinstance(proposed[key].get('text'), str) or not proposed[key]['text'].strip() for key in accepted)
    ):
        raise ValueError('La continuación automática solo admite supuestos completos de riesgo LOW sin preguntas pendientes.')
    critical = {key for key, item in proposed.items() if str(item.get('risk', '')).upper() == 'CRITICAL'}
    if critical - accepted or (critical & accepted and mode != 'MANUAL'):
        raise ValueError('Los supuestos críticos requieren confirmación manual explícita.')
    return sorted(accepted)


def _same_fields(expected, actual):
    return all(actual.get(key) == value for key, value in expected.items() if key in actual)


async def require_current_sources(db, run):
    # PostgreSQL FOR NO KEY UPDATE preserves source-edit serialization while
    # allowing foreign-key references (for example, a new component suite).
    # FOR UPDATE also blocks those inserts throughout the remote model call.
    snapshot = run.fuente_snapshot or {}
    requirement = (await db.execute(select(models.Requisito).where(models.Requisito.id == run.requisito_id)
        .with_for_update(key_share=True).execution_options(populate_existing=True))).scalar_one_or_none()
    message = 'La fuente cambió o fue archivada. Inicia un nuevo análisis antes de continuar.'
    if not requirement or requirement.archivado:
        raise ValueError(message)
    current = {'id': str(requirement.id), 'codigo': requirement.codigo, 'titulo': requirement.titulo,
        'descripcion_markdown': requirement.descripcion_markdown or '', 'prioridad': requirement.prioridad,
        'estado': requirement.estado, 'revision': requirement.ultima_actualizacion.isoformat(),
        'referencia_externa': {'provider': requirement.external_provider, 'reference': requirement.external_reference, 'url': requirement.external_url}}
    if not _same_fields(snapshot.get('requisito', {}), current):
        raise ValueError(message)
    if hasattr(run, 'historia_id'):
        story = (await db.execute(select(models.HistoriaUsuario).where(models.HistoriaUsuario.id == run.historia_id)
            .with_for_update(key_share=True).execution_options(populate_existing=True))).scalar_one_or_none()
        if not story or story.archivado or story.requisito_id != run.requisito_id:
            raise ValueError(message)
        current_story = {'id': str(story.id), 'codigo': story.codigo, 'titulo': story.titulo,
            'descripcion': story.descripcion_markdown, 'revision': story.ultima_actualizacion.isoformat()}
        if not _same_fields(snapshot.get('historia', {}), current_story):
            raise ValueError(message)
        criteria = (await db.execute(select(models.AcceptanceCriterion).where(
            models.AcceptanceCriterion.historia_id == story.id, models.AcceptanceCriterion.activo.is_(True))
            .with_for_update(key_share=True).execution_options(populate_existing=True))).scalars().all()
        by_id = {str(c.id): {'id': str(c.id), 'codigo': c.codigo, 'tipo': c.tipo, 'titulo': c.titulo,
            'given': c.given_text, 'when': c.when_text, 'then': c.then_items, 'observable_result': c.observable_result,
            'mandatory': c.mandatory, 'source_refs': c.source_refs, 'assumption_refs': c.assumption_refs} for c in criteria}
        frozen = snapshot.get('criterios', [])
        if set(by_id) != {str(c.get('id')) for c in frozen} or any(not _same_fields(c, by_id[str(c['id'])]) for c in frozen):
            raise ValueError(message)
    for section, model, fields in (
        ('wiki', models.WikiPage, {'titulo': 'titulo', 'contenido': 'contenido'}),
        ('componentes', models.Componente, {'nombre': 'nombre', 'descripcion': 'descripcion', 'tech_stack': 'tech_stack'}),
    ):
        for frozen in snapshot.get(section, []):
            row = (await db.execute(select(model).where(model.id == UUID(str(frozen['id'])))
                .with_for_update(key_share=True).execution_options(populate_existing=True))).scalar_one_or_none()
            if not row or row.proyecto_id != run.proyecto_id:
                raise ValueError(message)
            actual = {key: getattr(row, field) or '' for key, field in fields.items()}
            if section == 'wiki' and snapshot.get('context_version', 1) < 2:
                actual['contenido'] = actual['contenido'][:12000]
            if not _same_fields(frozen, actual):
                raise ValueError(message)


def case_quality(proposal, original, run, *, enforce_review=True):
    """Recheck the edited definition; a submitted PASS cannot erase a FAIL."""
    findings = []
    if not proposal.title.strip() or any(not step.action.strip() or not step.expected_result.strip() for step in proposal.steps):
        raise ValueError('El título, las acciones y los resultados esperados no pueden estar vacíos.')
    if set(proposal.assumption_ids) - set(run.accepted_assumption_ids or []):
        raise ValueError('El caso usa supuestos que no fueron aceptados.')
    if (original.get('quality') or {}).get('testability') == 'FAIL':
        findings.append('La propuesta original requiere revisión explícita.')
    if not proposal.objective.strip():
        findings.append('El caso necesita un objetivo verificable.')
    if enforce_review and findings and (not proposal.quality_override_accepted or not (proposal.quality_override_reason or '').strip()):
        raise ValueError('Confirma y justifica las observaciones críticas antes de crear el caso.')
    return {'testability': 'FAIL' if findings else (original.get('quality') or {}).get('testability', 'WARN'), 'findings': findings,
        'origin': 'backend_validation', 'semantic_validation': 'human_review',
        'override_accepted': proposal.quality_override_accepted, 'override_reason': proposal.quality_override_reason}


def require_story_provenance(candidate, run):
    snapshot = run.fuente_snapshot or {}
    requirement = snapshot.get('requisito') or {}
    allowed = {str(requirement.get('codigo') or ''), str(requirement.get('id') or ''), f"requirement:{requirement.get('id')}"}
    for section, prefix in [('componentes', 'component'), ('wiki', 'wiki')]:
        for item in snapshot.get(section, []):
            allowed.update({str(item.get('id')), f"{prefix}:{item.get('id')}"})
    allowed.update(f'user-answer:{index + 1}' for index, _ in enumerate(snapshot.get('respuestas_usuario', [])))
    accepted = set(run.accepted_assumption_ids or [])
    for item in [candidate, *candidate.acceptance_criteria]:
        if set(item.source_refs) - allowed or set(item.assumption_ids) - accepted:
            raise ValueError('La propuesta contiene fuentes desconocidas o supuestos no aceptados.')


def _record_question_answers(run, question_answers):
    if not question_answers:
        return
    answers = checked_answers(run.analysis_json or {}, question_answers, require_all=False)
    context = dict(run.fuente_snapshot or {})
    previous = {item['question']: item for item in context.get('respuestas_usuario', [])}
    previous.update({item['question']: item for item in answers})
    context['respuestas_usuario'] = list(previous.values())
    run.fuente_snapshot = context


def case_readiness(analysis):
    if not isinstance(analysis, dict) or not isinstance(analysis.get('questions'), list) or not isinstance(analysis.get('proposed_assumptions'), list):
        raise ValueError('El análisis no cumple el contrato de aclaraciones y supuestos.')
    readiness = str(analysis.get('readiness') or '').upper()
    if readiness not in {'READY', 'NEEDS_CLARIFICATION', 'BLOCKED'}:
        raise ValueError('El análisis no devolvió un estado válido.')
    questions = [str(item).strip() for item in analysis['questions'] if str(item).strip()]
    critical = any(str(item.get('risk', '')).upper() == 'CRITICAL' for item in analysis['proposed_assumptions'] if isinstance(item, dict))
    analysis['questions'] = questions
    if readiness == 'READY' and (questions or critical):
        readiness = 'NEEDS_CLARIFICATION'
    analysis['readiness'] = readiness
    return readiness
