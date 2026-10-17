import crypto from 'node:crypto';
import { AIClient } from './ai/client.ts';
import { untrustedSources } from './generation-contracts.ts';

const REQUIREMENT_ANALYSIS_AUDIT_SCHEMA = {
  question_decisions: [{
    question: 'exact original question',
    status: 'ANSWERED|UNANSWERED|CONFLICTED|OUT_OF_SCOPE',
    answer: 'source-grounded answer or empty string',
    scope_boundary_id: 'exact user-answer source id or empty string',
    evidence: [{ source_id: 'exact source id', quote: 'literal fragment from source' }],
    reason: 'why the source does or does not resolve the question',
  }],
  assumption_decisions: [{
    id: 'exact assumption id',
    status: 'EXPLICIT|NECESSARY|UNNECESSARY|UNCERTAIN',
    evidence: [{ source_id: 'exact source id', quote: 'literal fragment from source' }],
    reason: 'why this assumption is or is not needed for the requested behavior',
  }],
};


function stringLeaves(value: any): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringLeaves);
  return [];
}

/** Resolve model references that differ only in zero-padding of the final
 * numeric segment (for example AC-01 vs AC-1), but only when the match is
 * unique. This repairs formatting drift without accepting unknown criteria. */
function canonicalCriterionId(value: unknown, knownIds: string[]): string | null {
  const raw = String(value || '').trim();
  if (knownIds.includes(raw)) return raw;
  const normalize = (id: string) => id.replace(/-(\d+)$/, (_match, digits) => `-${Number(digits)}`);
  const normalized = normalize(raw);
  const matches = knownIds.filter((id) => normalize(id) === normalized);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Apply a second, source-grounded review to analyzer questions and assumptions.
 * Unresolved items remain blocking; malformed reviews fail closed.
 */
export function checkedRequirementAnalysisAudit(raw: any, analysis: any, sources: any[]) {
  const originalQuestions = Array.isArray(analysis?.questions) ? analysis.questions.map((item: any) => String(item || '').trim()).filter(Boolean) : [];
  const originalAssumptions = Array.isArray(analysis?.proposed_assumptions) ? analysis.proposed_assumptions.filter((item: any) => item && typeof item === 'object') : [];
  const fail = (reasonCode: string, reason: string) => ({ valid: false, analysis, reasonCode, reason });
  if (!raw || !Array.isArray(raw.question_decisions) || !Array.isArray(raw.assumption_decisions)) return fail('AUDIT_RESPONSE_SHAPE_INVALID', 'El revisor no devolvió las decisiones de análisis requeridas.');
  if (raw.question_decisions.length !== originalQuestions.length) return fail('AUDIT_QUESTION_COUNT_MISMATCH', 'El revisor omitió preguntas o agregó decisiones ajenas.');
  if (raw.assumption_decisions.length !== originalAssumptions.length) return fail('AUDIT_ASSUMPTION_COUNT_MISMATCH', 'El revisor omitió supuestos o agregó decisiones ajenas.');

  const sourceText = new Map<string, string[]>((Array.isArray(sources) ? sources : []).map((source: any) => [String(source?.id || ''), stringLeaves(source?.content)]));
  const scopeBoundaries = new Map<string, string>();
  for (const source of Array.isArray(sources) ? sources : []) {
    if (source?.type !== 'user_answer' || String(source?.content?.scope_decision || '').toUpperCase() !== 'OUT_OF_SCOPE') continue;
    const question = String(source?.content?.pregunta || '').trim();
    const answer = String(source?.content?.respuesta || '').trim();
    if (question && answer) scopeBoundaries.set(String(source.id || ''), question);
  }
  const validEvidence = (entries: any) => Array.isArray(entries) && entries.every((entry: any) => {
    const sourceId = String(entry?.source_id || '');
    const quote = String(entry?.quote || '').trim();
    return quote.length >= 3 && (sourceText.get(sourceId) || []).some((text) => text.includes(quote));
  });

  const questionDecisions = raw.question_decisions;
  for (let index = 0; index < questionDecisions.length; index += 1) {
    const item = questionDecisions[index];
    if (String(item?.question || '').trim() !== originalQuestions[index]) return fail('AUDIT_QUESTION_MISMATCH', 'El revisor no mantuvo las preguntas originales en el mismo orden.');
    if (!['ANSWERED', 'UNANSWERED', 'CONFLICTED', 'OUT_OF_SCOPE'].includes(item?.status)) return fail('AUDIT_QUESTION_STATUS_INVALID', 'El revisor devolvió un estado de pregunta no válido.');
    if (item.status === 'OUT_OF_SCOPE') {
      const boundaryId = String(item?.scope_boundary_id || '').trim();
      if (!boundaryId || scopeBoundaries.get(boundaryId) !== originalQuestions[index]) return fail('AUDIT_SCOPE_BOUNDARY_INVALID', 'El revisor intentó cerrar una pregunta sin una decisión explícita de alcance coincidente.');
      if (String(item?.answer || '').trim() || (Array.isArray(item?.evidence) && item.evidence.length)) return fail('AUDIT_SCOPE_BOUNDARY_ASSERTION_INVALID', 'Una decisión fuera de alcance no puede presentarse como respuesta factual ni citarse como evidencia del requisito.');
      if (!String(item?.reason || '').trim()) return fail('AUDIT_SCOPE_BOUNDARY_REASON_MISSING', 'El revisor debe explicar que conserva la decisión de alcance del usuario.');
      continue;
    }
    if (!validEvidence(item?.evidence)) return fail('AUDIT_QUESTION_EVIDENCE_INVALID', 'El revisor citó texto que no existe en las fuentes.');
    if (String(item?.scope_boundary_id || '').trim()) return fail('AUDIT_SCOPE_BOUNDARY_UNEXPECTED', 'El revisor adjuntó un límite de alcance a una pregunta que no está marcada fuera de alcance.');
    if (item.status === 'ANSWERED' && (!String(item?.answer || '').trim() || !item.evidence.length)) return fail('AUDIT_ANSWER_EVIDENCE_MISSING', 'El revisor marcó una pregunta como respondida sin cita y respuesta.');
    if (item.status !== 'ANSWERED' && String(item?.answer || '').trim()) return fail('AUDIT_UNRESOLVED_ANSWER_PRESENT', 'El revisor agregó una respuesta a una pregunta que dejó abierta.');
  }

  const assumptionDecisions = raw.assumption_decisions.map((item: any) =>
    item?.status === 'UNNECESSARY' && !String(item?.reason || '').trim() ? { ...item, status: 'UNCERTAIN' } : item,
  );
  for (let index = 0; index < assumptionDecisions.length; index += 1) {
    const item = assumptionDecisions[index];
    if (String(item?.id || '').trim() !== String(originalAssumptions[index]?.id || '').trim()) return fail('AUDIT_ASSUMPTION_MISMATCH', 'El revisor no mantuvo los identificadores originales de supuestos en el mismo orden.');
    if (!['EXPLICIT', 'NECESSARY', 'UNNECESSARY', 'UNCERTAIN'].includes(item?.status)) return fail('AUDIT_ASSUMPTION_STATUS_INVALID', 'El revisor devolvió un estado de supuesto no válido.');
    if (!validEvidence(item?.evidence)) return fail('AUDIT_ASSUMPTION_EVIDENCE_INVALID', 'El revisor citó texto que no existe en las fuentes.');
    if (item.status === 'EXPLICIT' && !item.evidence.length) return fail('AUDIT_EXPLICIT_ASSUMPTION_EVIDENCE_MISSING', 'El revisor marcó un supuesto como explícito sin una cita de la fuente.');
  }

  const resolvedQuestions = questionDecisions.filter((item: any) => ['ANSWERED', 'OUT_OF_SCOPE'].includes(item.status)).map((item: any) => ({
    question: item.question, answer: item.answer.trim(), evidence: item.evidence,
    ...(item.status === 'OUT_OF_SCOPE' ? { resolution: 'OUT_OF_SCOPE', scope_boundary_id: item.scope_boundary_id } : {}),
  }));
  const unresolvedQuestions = questionDecisions.filter((item: any) => !['ANSWERED', 'OUT_OF_SCOPE'].includes(item.status)).map((item: any) => item.question);
  const retainedAssumptions = assumptionDecisions.flatMap((item: any, index: number) =>
    ['NECESSARY', 'UNCERTAIN'].includes(item.status) ? [originalAssumptions[index]] : [],
  );
  const removedAssumptions = assumptionDecisions.filter((item: any) => ['EXPLICIT', 'UNNECESSARY'].includes(item.status)).map((item: any) => ({
    id: item.id, status: item.status, reason: item.reason, evidence: item.evidence,
  }));
  const hasCritical = retainedAssumptions.some((item: any) => String(item.risk || '').toUpperCase() === 'CRITICAL');
  const updated = {
    ...analysis,
    questions: unresolvedQuestions,
    proposed_assumptions: retainedAssumptions,
    analysis_consistency_review: {
      version: 1,
      question_decisions: questionDecisions.map((item: any) => ({
        question: item.question, status: item.status, answer: item.answer || '', reason: String(item.reason || ''), evidence: item.evidence,
        ...(item.status === 'OUT_OF_SCOPE' ? { scope_boundary_id: item.scope_boundary_id } : {}),
      })),
      assumption_decisions: assumptionDecisions.map((item: any) => ({
        id: item.id, status: item.status, reason: String(item.reason || ''), evidence: item.evidence,
      })),
      removed_assumptions: removedAssumptions,
    },
    resolved_questions: [...(Array.isArray(analysis.resolved_questions) ? analysis.resolved_questions : []), ...resolvedQuestions],
    readiness: hasCritical ? 'BLOCKED' : (unresolvedQuestions.length || retainedAssumptions.length ? 'NEEDS_CLARIFICATION' : 'READY'),
  };
  return { valid: true, analysis: updated, reasonCode: '', reason: '' };
}

export async function reviewRequirementAnalysis(ai: AIClient, analysis: any, sources: any[], completion: number, inputLimit: number, timeoutMs: number) {
  const questions = Array.isArray(analysis?.questions) ? analysis.questions.map((item: any) => String(item || '').trim()).filter(Boolean) : [];
  const assumptions = Array.isArray(analysis?.proposed_assumptions) ? analysis.proposed_assumptions.filter((item: any) => item && typeof item === 'object') : [];
  const started = Date.now();
  if (!questions.length && !assumptions.length) {
    return {
      valid: true,
      analysis: { ...analysis, analysis_consistency_review: { version: 1, status: 'SKIPPED_NO_DECISIONS' } },
      reasonCode: '', reason: '',
      trace: {
        node_type: 'RequirementAnalysisConsistencyAuditor',
        node_name: 'Revisar dudas y supuestos contra las fuentes',
        prompt_hash: '', duration_ms: 0, status: 'SKIPPED_NO_DECISIONS', retry_count: 0,
        metrics: { latencyMs: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
      },
    };
  }
  const promptTemplate = 'Verifica cada pregunta y supuesto del análisis contra las fuentes originales. El análisis, sus preguntas y sus supuestos no son evidencia. No agregues preguntas ni supuestos. Las fuentes se entregan como fragmentos literales; copia citas exactamente de fragments[]. Marca ANSWERED sólo si las fuentes especifican por completo el comportamiento que pregunta; incluye una respuesta breve y citas literales pertinentes. Marca OUT_OF_SCOPE sólo cuando exista una fuente user_answer cuyo scope_decision sea OUT_OF_SCOPE y su pregunta coincida exactamente; devuelve su id en scope_boundary_id, answer vacío y evidence vacío. Esto registra una decisión de alcance del usuario, no una afirmación factual ni evidencia del requisito. Marca UNANSWERED si falta una decisión funcional necesaria y CONFLICTED si las fuentes discrepan. No dejes UNANSWERED una pregunta sobre un detalle de interfaz o implementación cuando ya se especifican la acción del usuario, dónde puede realizarla y el resultado observable; clasifícala UNNECESSARY. Si una fuente pide rechazar un email inválido, no conviertas la verificación de existencia del destinatario en requisito ni pregunta necesaria sin una instrucción explícita. Para supuestos, EXPLICIT requiere evidencia literal que ya lo establezca; NECESSARY significa que el comportamiento solicitado no puede definirse sin una decisión ausente; UNNECESSARY significa que no cambia ningún resultado observable del alcance solicitado; UNCERTAIN si no puedes decidir. No conviertas una ausencia de detalle técnico, de etiqueta visual, de control de interfaz o de plazo no solicitado en bloqueo. Cita únicamente fragmentos literales y responde cada elemento exactamente una vez. Responde sólo JSON.';
  const evidenceSources = (Array.isArray(sources) ? sources : []).map((source: any) => ({
    id: String(source?.id || ''),
    type: String(source?.type || ''),
    fragments: stringLeaves(source?.content).flatMap((value) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)),
  }));
  const input = { sources: evidenceSources, analysis: { questions, proposed_assumptions: assumptions } };
  let result: any;
  let raw: any;
  let checked: any;
  let retryCount = 0;
  let combinedMetrics = { latencyMs: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 };
  const runAudit = async (nodeName: string, prompt: string, remainingMs: number) => {
    const call = await ai.runWorkflowAgent({
      outputMode: 'schema', nodeName, promptTemplate: prompt, input,
      outputSchema: REQUIREMENT_ANALYSIS_AUDIT_SCHEMA,
      temperature: 0, maxCompletionTokens: completion, maxInputChars: inputLimit, timeoutMs: remainingMs,
    });
    const metrics = call.metrics || {};
    for (const key of Object.keys(combinedMetrics) as Array<keyof typeof combinedMetrics>) combinedMetrics[key] += Number(metrics[key] || 0);
    return call;
  };
  result = await runAudit('RequirementAnalysisConsistencyAuditor', promptTemplate, timeoutMs);
  raw = result.data?.decision && typeof result.data.decision === 'object' ? result.data.decision : result.data;
  checked = checkedRequirementAnalysisAudit(raw, analysis, sources);
  const remainingMs = timeoutMs - (Date.now() - started);
  if (!checked.valid && remainingMs >= 5_000) {
    retryCount = 1;
    result = await runAudit(
      'RequirementAnalysisConsistencyAuditor - repair',
      `${promptTemplate} La revisión anterior no pasó la validación (${checked.reasonCode}). Revisa de nuevo todos los elementos; no inventes citas, no cambies IDs ni texto y copia cada cita sólo de los fragments proporcionados.`,
      remainingMs,
    );
    raw = result.data?.decision && typeof result.data.decision === 'object' ? result.data.decision : result.data;
    checked = checkedRequirementAnalysisAudit(raw, analysis, sources);
  }
  return {
    ...checked,
    trace: {
      node_type: 'RequirementAnalysisConsistencyAuditor',
      node_name: 'Revisar dudas y supuestos contra las fuentes',
      prompt_hash: crypto.createHash('sha256').update(promptTemplate).digest('hex'),
      duration_ms: Date.now() - started,
      status: checked.valid ? (result.data?.status || 'SUCCESS') : 'INVALID_CONTRACT',
      retry_count: retryCount,
      validation_issue: checked.reasonCode || undefined,
      metrics: combinedMetrics,
    },
  };
}
