"""Server-owned semantic reviews of the exact definition being applied."""
import hashlib
import json


def definition_hash(proposal):
    value = proposal.model_dump(mode='json') if hasattr(proposal, 'model_dump') else dict(proposal)
    # Review fields are decisions, not the definition; never accept client verdicts.
    for key in ('quality', 'selected', 'prioridad', 'quality_override_accepted', 'quality_override_reason',
                'duplicate_override_accepted', 'duplicate_override_reason', 'duplicate_candidates',
                'original_fingerprint', 'rule_findings', 'similar_stories', 'similarity_check'):
        value.pop(key, None)
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def stamp_semantic_review(proposal):
    quality = dict(proposal.get('quality') or {})
    report = dict(quality.get('semantic_review') or {})
    report['definition_hash'] = definition_hash(proposal)
    quality['semantic_review'] = report
    proposal['quality'] = quality


def effective_audit_runtime(result):
    runtime = result.get('runtime') or {}
    # An old Engine response cannot prove which profile/fallback actually ran.
    return {key: runtime.get(key) for key in ('provider', 'model', 'temperature')}


async def reviews_for_application(db, run, workflow, selected, call_engine, *, kind, enforce_review=True):
    persisted = run.propuestas_finales_json or (getattr(run, 'propuestas', None) or [])
    by_id = {str(item.get('local_id')): item for item in persisted if isinstance(item, dict)}
    reports = {}
    pending = []
    for proposal in selected:
        stored = by_id.get(proposal.local_id, {})
        report = (stored.get('quality') or {}).get('semantic_review') or {}
        if report.get('version') == 1 and report.get('definition_hash') == definition_hash(proposal):
            reports[proposal.local_id] = report
        else:
            # Legacy drafts and edits need fresh review against the frozen sources.
            data = proposal.model_dump(mode='json')
            data.pop('quality', None)
            pending.append(data)
    if pending:
        context = {**(run.fuente_snapshot or {}), 'analysis': run.analysis_json or {},
                   'accepted_assumption_ids': run.accepted_assumption_ids or [],
                   'question_answers': (run.decisiones_json or {}).get('question_answers', []),
                   'propuestas': pending}
        output = await call_engine(db, workflow, 'review', context, run.instrucciones)
        result = output[0] if isinstance(output, tuple) else output
        received = result.get('propuestas') or []
        expected = {item['local_id'] for item in pending}
        if len(received) != len(expected) or {item.get('local_id') for item in received} != expected:
            raise ValueError('La revisión no devolvió todas las propuestas. Reintenta antes de aplicar.')
        for item in received:
            report = (item.get('quality') or {}).get('semantic_review') or {}
            if report.get('version') != 1 or report.get('verdict') not in {'PASS', 'WARN', 'FAIL'}:
                raise ValueError('La revisión semántica quedó incompleta. Reintenta antes de aplicar.')
            # The reviewed content must be exactly what the user approved. Story
            # review may propose better provenance, but never change it silently.
            original = next(proposal for proposal in selected if proposal.local_id == item['local_id'])
            report = {**report, 'definition_hash': definition_hash(original)}
            reports[item['local_id']] = report
        run.workflow_traces_json = [*(run.workflow_traces_json or []), *(result.get('workflow_traces') or [])]
        runtime = effective_audit_runtime(result)
        run.provider, run.model, run.temperature = runtime['provider'], runtime['model'], runtime['temperature']
        run.decisiones_json = {**(run.decisiones_json or {}), 'semantic_apply_reviews': reports}
    for proposal in selected if enforce_review else []:
        report = reports[proposal.local_id]
        if report.get('verdict') == 'FAIL' and (not proposal.quality_override_accepted or not (proposal.quality_override_reason or '').strip()):
            raise ValueError('La revisión encontró contenido sin respaldo o cobertura incompleta. Corrige la propuesta o confirma y justifica las observaciones críticas.')
    return reports
