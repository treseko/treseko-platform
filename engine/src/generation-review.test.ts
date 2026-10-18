import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedSemanticReview, missingStorySourceFactIds, mergeTraceabilityRepair, reviewGeneratedProposals } from './generation-review.ts';
import { checkedRequirementAnalysisAudit, reviewRequirementAnalysis } from './generation-analysis-review.ts';
import { requiredStoryCoverageFacts } from './generation-context.ts';
import { normalizeCaseProposalCategory, removeUnacceptedStoryAssumptionRefs, storyContractIssues } from './generation-contracts.ts';

function context() {
  const description = [
    'Como cliente quiero comprar una gift card.',
    '',
    '### Reglas de negocio',
    '- El pago aprobado emite una tarjeta.',
    '- El pago rechazado no emite una tarjeta.',
    '',
    '### Criterios observables',
    '1. Una compra aprobada aparece en el historial.',
    '2. Un pago rechazado no crea una tarjeta.',
  ].join('\n');
  return {
    requisito: { id: 'req-1', descripcion_markdown: description },
    analysis: {
      explicit_facts: ['El pago aprobado emite una tarjeta.', 'El pago rechazado no emite una tarjeta.'],
    },
    authoring_session: { planned_story: { source_kind: 'explicit_user_story' } },
  };
}

function proposal() {
  return { acceptance_criteria: [{ local_id: 'AC-1' }] };
}

function review(sourceCoverage: any[]) {
  return {
    verdict: 'PASS',
    findings: [],
    grounding: [{
      criterion_id: 'AC-1', status: 'EXPLICIT',
      evidence: [{ source_id: 'requirement:req-1', quote: 'Una compra aprobada aparece en el historial.' }],
      assumption_ids: [], reason: 'El criterio corresponde al resultado indicado.',
    }],
    source_coverage: sourceCoverage,
  };
}

test('requires every literal business fact and observable criterion for a single explicit user story', () => {
  const facts = requiredStoryCoverageFacts(context());
  assert.deepEqual(facts.map((fact) => fact.quote), [
    'El pago aprobado emite una tarjeta.',
    'El pago rechazado no emite una tarjeta.',
    'Una compra aprobada aparece en el historial.',
    'Un pago rechazado no crea una tarjeta.',
  ]);
});

test('does not pass story traceability when explicit source facts were omitted', () => {
  const result = checkedSemanticReview(review([]), proposal(), context(), 'story', 'traceability');
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.source_coverage.length, 0);
  assert.ok(result.findings.some((finding) => finding.message.includes('hecho explícito')));
});

test('accepts complete, literal source coverage linked to proposal criteria', () => {
  const ctx = context();
  const facts = requiredStoryCoverageFacts(ctx);
  const complete = facts.map((fact) => ({ ...fact, status: 'COVERED', criterion_ids: ['AC-1'], reason: 'El criterio cubre la regla.' }));
  const result = checkedSemanticReview(review(complete), proposal(), ctx, 'story', 'traceability');
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.source_coverage.length, facts.length);
});

test('canonicalizes a uniquely matching zero-padded criterion reference in a finding', () => {
  const ctx = context();
  const draft = { acceptance_criteria: [{ local_id: 'AC-PROP-001-01' }] };
  const raw = {
    ...review([]),
    findings: [{ severity: 'WARN', message: 'Falta comprobar el historial.', criterion_id: 'AC-PROP-001-1' }],
  };
  const result = checkedSemanticReview(raw, draft, ctx, 'story', 'quality');
  assert.equal(result.verdict, 'WARN');
  assert.equal(result.findings[0].criterion_id, 'AC-PROP-001-01');
});

test('still rejects an unknown criterion reference in a finding', () => {
  const ctx = context();
  const draft = { acceptance_criteria: [{ local_id: 'AC-PROP-001-01' }] };
  const raw = {
    ...review([]),
    findings: [{ severity: 'WARN', message: 'Observación.', criterion_id: 'AC-PROP-001-9' }],
  };
  const result = checkedSemanticReview(raw, draft, ctx, 'story', 'quality');
  assert.equal(result.verdict, 'FAIL');
  assert.ok(result.findings.some((finding) => finding.message === 'La revisión contiene una observación inválida.'));
});

test('dismisses a finding that requests behavior explicitly marked out of scope', () => {
  const ctx = { ...context(), respuestas_usuario: [{
    question: '¿Qué pasa si el pago es exitoso y falla la emisión?',
    answer: 'Fuera del alcance de esta generación; dejar pendiente de definición.',
    scope_decision: 'OUT_OF_SCOPE',
  }] };
  const raw = {
    verdict: 'FAIL',
    findings: [{ severity: 'FAIL', message: 'Falta cubrir la emisión posterior al pago.', criterion_id: '',
      disposition: 'OUT_OF_SCOPE_OMISSION', scope_boundary_ids: ['user-answer:1'] }],
    grounding: [], source_coverage: [],
  };
  const result = checkedSemanticReview(raw, proposal(), ctx, 'story', 'quality');
  assert.equal(result.verdict, 'PASS');
  assert.deepEqual(result.findings, []);
});

test('retains a finding when the proposal includes behavior marked out of scope', () => {
  const ctx = { ...context(), respuestas_usuario: [{
    question: '¿Qué pasa si el pago es exitoso y falla la emisión?', answer: 'Fuera del alcance.', scope_decision: 'OUT_OF_SCOPE',
  }] };
  const raw = { verdict: 'FAIL', findings: [{ severity: 'FAIL', message: 'La propuesta incluye reintentos de emisión.', criterion_id: '',
    disposition: 'OUT_OF_SCOPE_INCLUDED', scope_boundary_ids: ['user-answer:1'] }], grounding: [], source_coverage: [] };
  const result = checkedSemanticReview(raw, proposal(), ctx, 'story', 'quality');
  assert.equal(result.verdict, 'FAIL');
  assert.match(result.findings[0].message, /reintentos/);
});

test('rejects scope dispositions that cite a non-existent boundary', () => {
  const ctx = { ...context(), respuestas_usuario: [] };
  const raw = { verdict: 'WARN', findings: [{ severity: 'WARN', message: 'Falta cubrir un flujo.', criterion_id: '',
    disposition: 'OUT_OF_SCOPE_OMISSION', scope_boundary_ids: ['user-answer:99'] }], grounding: [], source_coverage: [] };
  const result = checkedSemanticReview(raw, proposal(), ctx, 'story', 'quality');
  assert.equal(result.verdict, 'FAIL');
  assert.ok(result.findings.some((finding) => finding.message === 'La revisión contiene una observación inválida.'));
});

test('repairs omitted literal source-coverage entries and keeps uncovered facts failing', () => {
  const ctx = context();
  const draft = { acceptance_criteria: [{ local_id: 'AC-1' }] };
  const primary = checkedSemanticReview(review([]), draft, ctx, 'story', 'traceability');
  const missing = missingStorySourceFactIds(primary, ctx);
  assert.equal(missing.length, requiredStoryCoverageFacts(ctx).length);
  const coveredRaw = { verdict: 'PASS', findings: [], grounding: [], source_coverage: requiredStoryCoverageFacts(ctx).map((fact) => ({
    ...fact, status: 'COVERED', criterion_ids: ['AC-1'], reason: 'La propuesta conserva este comportamiento observable.',
  })) };
  const repaired = checkedSemanticReview(coveredRaw, draft, ctx, 'story', 'traceability', [], missing);
  const merged = mergeTraceabilityRepair(primary, repaired, [], 'story', missing, ctx);
  assert.equal(merged.verdict, 'PASS');
  assert.equal(merged.source_coverage.length, missing.length);

  const uncoveredRaw = { ...coveredRaw, source_coverage: coveredRaw.source_coverage.map((item: any, index: number) =>
    index === 0 ? { ...item, status: 'NOT_COVERED', criterion_ids: [] } : item) };
  const rejectedRepair = checkedSemanticReview(uncoveredRaw, draft, ctx, 'story', 'traceability', [], missing);
  const rejected = mergeTraceabilityRepair(primary, rejectedRepair, [], 'story', missing, ctx);
  assert.equal(rejected.verdict, 'FAIL');
  assert.ok(rejected.findings.some((finding: any) => finding.message.includes('no cubre un hecho explícito')));
});

test('does not apply a requirement-wide completeness gate to multiple formal stories', () => {
  const ctx = context();
  ctx.requisito.descripcion_markdown += '\nComo destinatario quiero ver la tarjeta recibida.';
  assert.deepEqual(requiredStoryCoverageFacts(ctx), []);
});

test('keeps explicit-story source coverage during review without an ephemeral authoring session', () => {
  const ctx: any = context();
  delete ctx.authoring_session;
  assert.equal(requiredStoryCoverageFacts(ctx).length, 4);
});

test('resolves a redundant payment question only with literal source evidence and preserves the real delivery question', () => {
  const sources = [{ id: 'requirement:req-1', content: { description: [
    'Si el pago se rechaza o vence, no se emite la tarjeta y se informa el estado al cliente.',
  ] } }];
  const analysis = {
    readiness: 'NEEDS_CLARIFICATION',
    questions: ['¿Cómo se manejan los errores de pago?', '¿Qué pasa si el destinatario no recibe la tarjeta?'],
    proposed_assumptions: [{ id: 'ASSUMP-001', text: 'El proveedor confirma el pago en un plazo razonable.', risk: 'MEDIUM' }],
  };
  const checked = checkedRequirementAnalysisAudit({
    question_decisions: [
      { question: analysis.questions[0], status: 'ANSWERED', answer: 'Ante rechazo o vencimiento no se emite la tarjeta y se informa el estado.', evidence: [{ source_id: 'requirement:req-1', quote: sources[0].content.description[0] }], reason: 'La fuente define ambos estados y el resultado.' },
      { question: analysis.questions[1], status: 'UNANSWERED', answer: '', evidence: [], reason: 'Las fuentes no indican el proceso alternativo de entrega.' },
    ],
    assumption_decisions: [{ id: 'ASSUMP-001', status: 'UNNECESSARY', evidence: [], reason: 'El tiempo de confirmación no cambia los resultados definidos en el alcance.' }],
  }, analysis, sources);

  assert.equal(checked.valid, true);
  assert.deepEqual(checked.analysis.questions, ['¿Qué pasa si el destinatario no recibe la tarjeta?']);
  assert.deepEqual(checked.analysis.proposed_assumptions, []);
  assert.equal(checked.analysis.readiness, 'NEEDS_CLARIFICATION');
  assert.equal(checked.analysis.analysis_consistency_review.removed_assumptions[0].status, 'UNNECESSARY');
});

test('fails closed when a reviewer cites a quote that is not in the source', () => {
  const analysis = { readiness: 'NEEDS_CLARIFICATION', questions: ['¿Cómo se maneja un pago rechazado?'], proposed_assumptions: [] };
  const checked = checkedRequirementAnalysisAudit({
    question_decisions: [{ question: analysis.questions[0], status: 'ANSWERED', answer: 'Se informa el rechazo.', evidence: [{ source_id: 'requirement:req-1', quote: 'No se emite la tarjeta.' }], reason: 'La fuente lo define.' }],
    assumption_decisions: [],
  }, analysis, [{ id: 'requirement:req-1', content: { description: 'El pago se informa al cliente.' } }]);

  assert.equal(checked.valid, false);
  assert.equal(analysis.questions.length, 1);
});

test('fails closed when the analysis auditor omits a question', () => {
  const analysis = { readiness: 'NEEDS_CLARIFICATION', questions: ['¿Qué ocurre al expirar el pago?'], proposed_assumptions: [] };
  const checked = checkedRequirementAnalysisAudit({ question_decisions: [], assumption_decisions: [] }, analysis, []);
  assert.equal(checked.valid, false);
  assert.equal(analysis.questions.length, 1);
});

test('resolves only the exact question explicitly marked out of scope by the user', () => {
  const scopedQuestion = '¿Cómo se entrega el código de la gift card?';
  const stillOpenQuestion = '¿Qué ocurre si se confirma el pago pero falla la emisión?';
  const analysis = { readiness: 'NEEDS_CLARIFICATION', questions: [scopedQuestion, stillOpenQuestion], proposed_assumptions: [] };
  const sources = [{ id: 'user-answer:2', type: 'user_answer', content: {
    pregunta: scopedQuestion, respuesta: 'El canal y el momento no están definidos; no asumir email ni push.', scope_decision: 'OUT_OF_SCOPE',
  } }];
  const checked = checkedRequirementAnalysisAudit({
    question_decisions: [
      { question: scopedQuestion, status: 'OUT_OF_SCOPE', answer: '', evidence: [], scope_boundary_id: 'user-answer:2', reason: 'Se respeta la decisión explícita de alcance.' },
      { question: stillOpenQuestion, status: 'UNANSWERED', answer: '', evidence: [], reason: 'No existe una decisión de alcance para esta pregunta.' },
    ],
    assumption_decisions: [],
  }, analysis, sources);

  assert.equal(checked.valid, true);
  assert.deepEqual(checked.analysis.questions, [stillOpenQuestion]);
  assert.equal(checked.analysis.resolved_questions[0].resolution, 'OUT_OF_SCOPE');
  assert.equal(checked.analysis.readiness, 'NEEDS_CLARIFICATION');
});

test('rejects an out-of-scope decision that cites another question boundary', () => {
  const question = '¿Cómo se entrega la gift card?';
  const analysis = { readiness: 'NEEDS_CLARIFICATION', questions: [question], proposed_assumptions: [] };
  const checked = checkedRequirementAnalysisAudit({
    question_decisions: [{ question, status: 'OUT_OF_SCOPE', answer: '', evidence: [], scope_boundary_id: 'user-answer:1', reason: 'Fuera del alcance.' }],
    assumption_decisions: [],
  }, analysis, [{ id: 'user-answer:1', type: 'user_answer', content: {
    pregunta: '¿Cuánto cuesta?', respuesta: 'No está definido.', scope_decision: 'OUT_OF_SCOPE',
  } }]);

  assert.equal(checked.valid, false);
  assert.equal(checked.reasonCode, 'AUDIT_SCOPE_BOUNDARY_INVALID');
  assert.deepEqual(analysis.questions, [question]);
});

test('tells story reviewers not to demand interface details absent from the source', async () => {
  const source = 'Si el pago se rechaza o vence, no se emite la tarjeta y se informa el estado al cliente.';
  const criterion = {
    local_id: 'AC-1', type: 'FUNCTIONAL', title: 'Informar estado del pago',
    given: 'Una compra válida', when: 'El pago es rechazado',
    then: ['No se emite la tarjeta.', 'Se informa el estado de la orden al cliente.'],
    observable_result: 'La orden informa el estado del pago.', source_refs: ['requirement:req-1'], assumption_ids: [],
  };
  const proposal = { acceptance_criteria: [criterion], source_refs: ['requirement:req-1'], assumption_ids: [] };
  const nodes = [{ type: 'QaStoryCritic', name: 'Criticar', prompt_template: 'Evalúa testabilidad.', timeout_sec: 10 },
    { type: 'TraceabilityAuditor', name: 'Trazabilidad', prompt_template: 'Verifica respaldo.', timeout_sec: 10 }];
  const calls: any[] = [];
  const ai = { runWorkflowAgent: async (request: any) => {
    calls.push(request);
    if (request.nodeName === 'Criticar') return { prompt: request.promptTemplate, data: { verdict: 'PASS', findings: [] } };
    return { prompt: request.promptTemplate, data: { verdict: 'PASS', findings: [], grounding: [{ criterion_id: 'AC-1', status: 'EXPLICIT',
      evidence: [{ source_id: 'requirement:req-1', quote: source }], assumption_ids: [], reason: 'La fuente define ambos resultados.' }],
      coverage: [], source_coverage: [] } };
  } } as any;

  await reviewGeneratedProposals(ai, nodes, [proposal], {
    ...context(), requisito: { id: 'req-1', descripcion_markdown: source },
  }, 'story', 1024, 10000);

  assert.match(calls[0].promptTemplate, /No eleves el nivel de detalle exigido por la fuente/);
  assert.match(calls[0].promptTemplate, /no exijas además texto exacto, canal de notificación/);
  assert.match(calls[0].promptTemplate, /Cada finding debe usar scope=SCENARIO solo para fallos del objetivo/);
  assert.match(calls[1].promptTemplate, /Cada finding debe incluir severity, message, criterion_id, scope, disposition y scope_boundary_ids/);
  assert.match(calls[1].promptTemplate, /exclusivamente los IDs UUID presentes en proposal\.criterion_refs/);
});

test('retries a malformed case traceability response and accepts only a valid scoped response', async () => {
  const criterionId = '00000000-0000-4000-8000-000000000001';
  const source = 'Cuando el proveedor confirma el pago, la orden queda pagada.';
  const caseContext = { ...context(), historia: { id: 'story-1', titulo: 'Compra' },
    requisito: { id: 'req-1', descripcion_markdown: source },
    criterios: [{ id: criterionId, codigo: 'AC-1', titulo: 'Pago confirmado', given: 'Compra iniciada',
      when: 'El proveedor confirma el pago', then: ['La orden queda pagada.'], observable_result: source,
      mandatory: true, source_refs: [], assumption_refs: [] }] };
  const draft = { local_id: 'TCP-001', title: 'Compra pagada', category: 'POSITIVE', test_type: 'MANUAL',
    criterion_refs: [criterionId], steps: [{ number: 1, action: 'Confirmar el pago', data: '', expected_result: source }] };
  const nodes = [{ type: 'QaCaseCritic', name: 'Calidad', prompt_template: 'Evalúa el caso.', timeout_sec: 10 },
    { type: 'CoverageTraceabilityAuditor', name: 'Trazabilidad', prompt_template: 'Audita criterios.', timeout_sec: 10 }];
  const calls: any[] = [];
  const metrics = { latencyMs: 1, promptTokens: 1, completionTokens: 1, totalTokens: 2, estimatedCost: 0 };
  const validAudit = { verdict: 'PASS', findings: [], grounding: [{ criterion_id: criterionId, status: 'EXPLICIT',
    evidence: [{ source_id: 'requirement:req-1', quote: source }], assumption_ids: [], reason: 'La fuente lo indica.' }],
    coverage: [{ criterion_id: criterionId, status: 'COVERED', step_numbers: [1], reason: 'El paso verifica el resultado.' }], source_coverage: [] };
  const ai = { runWorkflowAgent: async (request: any) => {
    calls.push(request);
    const data = request.nodeName === 'Calidad' ? { verdict: 'PASS', findings: [] }
      : request.nodeName.includes('corregir contrato') ? validAudit
        : { ...validAudit, findings: [{ severity: 'FAIL', message: 'Observación mal formada.', criterion_id: 'AC-OTRO' }],
          coverage: [...validAudit.coverage, { criterion_id: 'AC-OTRO', status: 'COVERED', step_numbers: [1], reason: 'ID ajeno.' }] };
    return { data, metrics, prompt: { nodeName: request.nodeName }, rawResponse: {} };
  } } as any;

  const result = await reviewGeneratedProposals(ai, nodes, [draft], caseContext, 'case', 1024, 10000);
  assert.equal(calls.length, 3);
  assert.match(calls[0].promptTemplate, /Evalúa solo los criterios incluidos en proposal\.criterion_refs/);
  assert.match(calls[2].promptTemplate, /no cumplió el contrato/);
  assert.equal(result.proposals[0].quality.semantic_review.verdict, 'PASS');
  assert.equal(result.traces[2].execution_mode, 'ai_semantic_review_contract_retry');
});

test('reviews generated case coverage against its assigned scenario and only referenced criteria', async () => {
  const criterionId = '00000000-0000-4000-8000-000000000011';
  const neighborId = '00000000-0000-4000-8000-000000000012';
  const quote = 'La compra muestra el estado rechazado y no emite tarjeta.';
  const criteria = [
    { id: criterionId, codigo: 'AC-1', titulo: 'Pago rechazado', given: 'La compra fue iniciada', when: 'El proveedor rechaza el pago', then: [quote], observable_result: quote, source_refs: [] },
    { id: neighborId, codigo: 'AC-2', titulo: 'Email inválido', given: 'El email no tiene formato válido', when: 'El cliente intenta pagar', then: ['El pago no se envía.'], observable_result: 'El pago no se envía.', source_refs: [] },
  ];
  const scenario = { local_id: 'SC-1', title: 'Pago rechazado', objective: 'Comprobar rechazo sin emisión.', criterion_refs: [criterionId] };
  const siblingScenario = { local_id: 'SC-2', title: 'Email inválido', objective: 'Bloquear el pago con email inválido.', criterion_refs: [neighborId] };
  const draft = { local_id: 'TC-1', title: 'Pago rechazado', category: 'NEGATIVE', test_type: 'MANUAL',
    criterion_refs: [criterionId], quality: { testability: 'FAIL', warnings: ['La autoevaluación del modelo falló.'] },
    steps: [{ number: 1, action: 'Rechazar el pago', data: '', expected_result: quote }] };
  const calls: any[] = [];
  const ai = { runWorkflowAgent: async (request: any) => {
    calls.push(request);
    const data = request.nodeName === 'Calidad' ? { verdict: 'FAIL', findings: [{ severity: 'FAIL',
      message: 'El caso no cubre un resultado asignado a otro escenario.', criterion_id: criterionId, scope: 'SCENARIO',
      disposition: 'ACTIONABLE', scope_boundary_ids: [] }] } : {
      verdict: 'PASS', findings: [],
      grounding: [{ criterion_id: criterionId, status: 'EXPLICIT', evidence: [{ source_id: `criterion:${criterionId}`, quote }], assumption_ids: [], reason: 'El criterio respalda el resultado.' }],
      coverage: [{ criterion_id: criterionId, status: 'PARTIAL', step_numbers: [1], reason: 'Este caso cubre el rechazo; otros escenarios cubren otras condiciones del criterio padre.' }],
      scenario_coverage: [{ scenario_id: scenario.local_id, status: 'COVERED', step_numbers: [1], reason: 'El paso verifica el objetivo del escenario asignado.' }], source_coverage: [],
    };
    return { data, metrics: {}, prompt: { nodeName: request.nodeName }, rawResponse: {} };
  } } as any;
  const result = await reviewGeneratedProposals(ai, [
    { type: 'QaCaseCritic', name: 'Calidad', prompt_template: 'Evalúa calidad.', timeout_sec: 10 },
    { type: 'CoverageTraceabilityAuditor', name: 'Trazabilidad', prompt_template: 'Audita cobertura.', timeout_sec: 10 },
  ], [draft], { ...context(), historia: { id: 'story-1', titulo: 'Compra' }, criterios: criteria,
    requisito: { id: 'req-1', descripcion_markdown: quote } }, 'case', 1024, 10000, [scenario, siblingScenario]);

  assert.equal(result.proposals[0].quality.semantic_review.verdict, 'WARN');
  assert.equal(result.proposals[0].quality.testability, 'WARN');
  assert.equal(result.proposals[0].quality.semantic_review.coverage[0].status, 'PARTIAL');
  assert.equal(result.proposals[0].quality.semantic_review.scenario_coverage[0].status, 'COVERED');
  assert.equal(result.proposals[0].quality.semantic_review.findings[0].review_consistency, 'SCENARIO_COVERAGE_CONFLICT');
  assert.deepEqual(calls[0].input.scenario_scope, scenario);
  assert.deepEqual(calls[0].input.planned_scenario_set, [scenario, siblingScenario]);
  assert.deepEqual(calls[0].input.sources.filter((source: any) => source.type === 'criterion').map((source: any) => source.id), [`criterion:${criterionId}`]);
  assert.match(calls[0].promptTemplate, /scenario_coverage debe contener exactamente una fila/);
  assert.match(calls[1].promptTemplate, /No conviertas la ausencia de otros escenarios hermanos en un defecto SCENARIO/);
  assert.match(calls[1].promptTemplate, /PARENT_CRITERION si pide cubrir otros resultados del criterio padre/);
  assert.match(calls[1].promptTemplate, /planned_scenario_set contiene todos los escenarios planificados/);
});

test('fails a case when its assigned scenario itself remains partially verified', () => {
  const criterionId = '00000000-0000-4000-8000-000000000021';
  const scenario = { local_id: 'SC-NEG-01', title: 'Monto inválido', objective: 'Impedir el pago con monto menor al mínimo.', criterion_refs: [criterionId] };
  const draft = { local_id: 'TC-NEG-01', criterion_refs: [criterionId], steps: [{ number: 1, action: 'Ingresar 9', expected_result: 'Se muestra validación.' }] };
  const raw = { verdict: 'PASS', findings: [],
    grounding: [{ criterion_id: criterionId, status: 'EXPLICIT', evidence: [{ source_id: 'criterion:00000000-0000-4000-8000-000000000021', quote: 'No se permite pagar menos de 10.' }], assumption_ids: [], reason: 'La regla es explícita.' }],
    coverage: [{ criterion_id: criterionId, status: 'PARTIAL', step_numbers: [1], reason: 'Este caso solo cubre el límite inferior.' }],
    scenario_coverage: [{ scenario_id: scenario.local_id, status: 'PARTIAL', step_numbers: [1], reason: 'No intenta continuar ni comprueba que el pago queda bloqueado.' }] };
  const ctx = { ...context(), historia: { id: 'story-1', titulo: 'Compra' }, criterios: [{ id: criterionId,
    titulo: 'Montos bajo el mínimo no se pagan', mandatory: true, given: '', when: '', then: ['No se permite pagar menos de 10.'],
    observable_result: 'El pago se bloquea.', source_refs: [], assumption_refs: [] }] };
  const result = checkedSemanticReview(raw, draft, ctx, 'case', 'traceability', undefined, undefined, scenario);
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.coverage[0].status, 'PARTIAL');
  assert.equal(result.scenario_coverage.length, 1);
  assert.ok(result.findings.some((finding) => finding.message.includes('escenario asignado')));
});

test('retries story traceability when the reviewer invents source facts outside an empty required set', async () => {
  const source = 'La orden aprobada queda disponible en el historial.';
  const proposal = { local_id: 'PROP-001', acceptance_criteria: [{ local_id: 'AC-1', type: 'FUNCTIONAL',
    title: 'Consultar historial', given: 'La orden fue aprobada', when: 'El cliente abre el historial',
    then: ['La orden aparece en el historial.'], observable_result: 'La orden aprobada queda disponible en el historial.',
    source_refs: ['requirement:req-1'], assumption_ids: [] }] };
  const nodes = [{ type: 'QaStoryCritic', name: 'Calidad', prompt_template: 'Evalúa la historia.', timeout_sec: 10 },
    { type: 'TraceabilityAuditor', name: 'Trazabilidad', prompt_template: 'Audita la historia.', timeout_sec: 10 }];
  const calls: any[] = [];
  const validAudit = { verdict: 'PASS', findings: [], grounding: [{ criterion_id: 'AC-1', status: 'EXPLICIT',
    evidence: [{ source_id: 'requirement:req-1', quote: source }], assumption_ids: [], reason: 'La fuente respalda el resultado.' }],
    coverage: [], source_coverage: [] };
  const ai = { runWorkflowAgent: async (request: any) => {
    calls.push(request);
    const data = request.nodeName === 'Calidad' ? { verdict: 'PASS', findings: [] }
      : request.nodeName.includes('corregir contrato') ? validAudit
        : { ...validAudit, source_coverage: [{ fact_id: 'SOURCE-FACT-999', source_id: 'requirement:req-1', quote: source,
          status: 'COVERED', criterion_ids: ['AC-1'], reason: 'Dato agregado por el modelo.' }] };
    return { data, metrics: {}, prompt: { nodeName: request.nodeName }, rawResponse: {} };
  } } as any;

  const result = await reviewGeneratedProposals(ai, nodes, [proposal], {
    ...context(), requisito: { id: 'req-1', descripcion_markdown: source },
  }, 'story', 1024, 10000);
  assert.equal(calls.length, 3);
  assert.match(calls[2].promptTemplate, /no cumplió el contrato/);
  assert.equal(result.proposals[0].quality.semantic_review.verdict, 'PASS');
  assert.equal(result.traces[2].execution_mode, 'ai_semantic_review_contract_retry');
});

test('normalizes optional case-step data to the persisted string contract', () => {
  const proposal = normalizeCaseProposalCategory({ category: ' positive ', steps: [
    { number: 1, action: 'Abrir formulario', data: null, expected_result: 'Formulario visible' },
    { number: 2, action: 'Completar datos', data: { correo: 'test@example.com', mensaje: 'Feliz día' }, expected_result: 'Datos cargados' },
    { number: 3, action: 'Confirmar', expected_result: 'Compra creada' },
  ] });
  assert.equal(proposal.category, 'POSITIVE');
  assert.equal(proposal.steps[0].data, '');
  assert.equal(proposal.steps[1].data, '{"correo":"test@example.com","mensaje":"Feliz día"}');
  assert.equal(proposal.steps[2].data, '');
});

test('retries one invalid analysis citation using literal source fragments and respects the checked result', async () => {
  const sourceLine = 'Si el pago se rechaza o vence, no se emite la tarjeta.';
  const analysis = { readiness: 'NEEDS_CLARIFICATION', questions: ['¿Qué pasa al rechazar el pago?'], proposed_assumptions: [] };
  const responses = [
    { question_decisions: [{ question: analysis.questions[0], status: 'ANSWERED', answer: 'No se emite.', evidence: [{ source_id: 'requirement:req-1', quote: 'El pago rechazado no emite una tarjeta.' }], reason: 'La fuente responde.' }], assumption_decisions: [] },
    { question_decisions: [{ question: analysis.questions[0], status: 'ANSWERED', answer: 'No se emite la tarjeta.', evidence: [{ source_id: 'requirement:req-1', quote: sourceLine }], reason: 'La fuente responde literalmente.' }], assumption_decisions: [] },
  ];
  const calls: any[] = [];
  const ai = { runWorkflowAgent: async (request: any) => {
    calls.push(request);
    return { data: { decision: responses.shift(), status: 'SUCCESS' }, metrics: { latencyMs: 10, promptTokens: 20, completionTokens: 5, totalTokens: 25, estimatedCost: 0 } };
  } } as any;

  const result = await reviewRequirementAnalysis(ai, analysis, [{ id: 'requirement:req-1', type: 'requirement', content: { description: sourceLine } }], 1024, 10000, 60000);

  assert.equal(result.valid, true);
  assert.equal(result.analysis.readiness, 'READY');
  assert.equal(result.trace.retry_count, 1);
  assert.equal(result.trace.metrics.totalTokens, 50);
  assert.deepEqual(calls[1].input.sources[0].fragments, [sourceLine]);
  assert.match(calls[1].promptTemplate, /AUDIT_QUESTION_EVIDENCE_INVALID/);
  assert.match(calls[0].promptTemplate, /no conviertas la verificación de existencia del destinatario en requisito ni pregunta necesaria/);
  assert.match(calls[0].promptTemplate, /detalle de interfaz o implementación/);
});

test('skips the analysis consistency model call when there are no questions or assumptions', async () => {
  const ai = { runWorkflowAgent: async () => { throw new Error('should not call a model'); } } as any;
  const result = await reviewRequirementAnalysis(ai, { readiness: 'READY', questions: [], proposed_assumptions: [] }, [], 1024, 10000, 60000);
  assert.equal(result.valid, true);
  assert.equal(result.trace.status, 'SKIPPED_NO_DECISIONS');
});

test('retains an unnecessary assumption as uncertain when the reviewer omits its rationale', () => {
  const analysis = { readiness: 'NEEDS_CLARIFICATION', questions: ['¿Qué ocurre si no llega la tarjeta?'], proposed_assumptions: [{ id: 'A-1', text: 'El proveedor confirma pronto.', risk: 'MEDIUM' }] };
  const checked = checkedRequirementAnalysisAudit({
    question_decisions: [{ question: analysis.questions[0], status: 'UNANSWERED', answer: '', evidence: [], reason: '' }],
    assumption_decisions: [{ id: 'A-1', status: 'UNNECESSARY', evidence: [], reason: '' }],
  }, analysis, []);
  assert.equal(checked.valid, true);
  assert.deepEqual(checked.analysis.proposed_assumptions, analysis.proposed_assumptions);
  assert.equal(checked.analysis.readiness, 'NEEDS_CLARIFICATION');
});

test('drops unaccepted assumption references only when a criterion independently cites an allowed source', () => {
  const allowedSources = new Set(['requirement:req-1']);
  const proposal = {
    local_id: 'PROP-001', story_type: 'USER_STORY', title: 'Compra de gift card',
    actor: 'cliente autenticado', goal: 'comprar una gift card', benefit: 'enviarla a un destinatario',
    description: 'Compra y emisión conforme al requisito.', source_refs: ['requirement:req-1'], assumption_ids: ['ASSUMP-EXPLICIT'],
    quality: {}, acceptance_criteria: [{
      local_id: 'AC-1', type: 'FUNCTIONAL', title: 'Pago aprobado', given: 'Una compra válida',
      when: 'El proveedor confirma el pago', then: ['Se emite la tarjeta'], observable_result: 'La orden queda pagada',
      source_refs: ['requirement:req-1'], assumption_ids: ['ASSUMP-EXPLICIT'],
    }],
  };
  const checked = removeUnacceptedStoryAssumptionRefs([proposal], allowedSources, new Set());
  assert.deepEqual(checked.proposals[0].acceptance_criteria[0].assumption_ids, []);
  assert.deepEqual(checked.proposals[0].assumption_ids, []);
  assert.equal(checked.removed.length, 2);
  assert.deepEqual(storyContractIssues(checked.proposals, allowedSources, new Set()), []);

  const unsupported = removeUnacceptedStoryAssumptionRefs([{
    ...proposal,
    source_refs: [],
    acceptance_criteria: [{ ...proposal.acceptance_criteria[0], source_refs: [] }],
  }], allowedSources, new Set());
  assert.deepEqual(unsupported.proposals[0].acceptance_criteria[0].assumption_ids, ['ASSUMP-EXPLICIT']);
  assert.ok(storyContractIssues(unsupported.proposals, allowedSources, new Set()).length > 0);
});
