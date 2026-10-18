import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedSemanticReview, reviewGeneratedProposals } from './generation-review.ts';

const criterionId = '00000000-0000-4000-8000-000000000032';
const quote = 'Montos 10 y 500 aprobados emiten una tarjeta.';
const scenario = { local_id: 'SC-LOWER', title: 'Monto mínimo', objective: 'Probar el monto mínimo aprobado.', criterion_refs: [criterionId] };
const context = { requisito: { id: 'REQ-1', descripcion_markdown: quote }, historia: { id: 'ST-1', titulo: 'Compra' },
  criterios: [{ id: criterionId, titulo: 'Límites aprobados', mandatory: true, given: '', when: '', then: [quote],
    observable_result: quote, source_refs: [], assumption_refs: [] }], question_answers: [], accepted_assumption_ids: [] };
const proposal = { local_id: 'TC-LOWER', criterion_refs: [criterionId], quality: { testability: 'FAIL', warnings: [] },
  steps: [{ number: 1, action: 'Comprar por 10', data: '', expected_result: 'Se emite una tarjeta única.' }] };
const grounding = [{ criterion_id: criterionId, status: 'EXPLICIT',
  evidence: [{ source_id: `criterion:${criterionId}`, quote }], assumption_ids: [], reason: 'La regla está en el criterio.' }];
const coverage = [{ criterion_id: criterionId, status: 'PARTIAL', step_numbers: [1], reason: 'Este caso cubre solo el monto mínimo.' }];
const scenarioCoverage = [{ scenario_id: scenario.local_id, status: 'COVERED', step_numbers: [1],
  reason: 'El paso valida la compra aprobada en el monto mínimo.' }];

test('surfaces conflicting scenario and criterion reviews as a human-review warning', () => {
  const raw = { verdict: 'FAIL', findings: [{ severity: 'FAIL', message: 'Este caso no prueba el límite superior de 500.',
    criterion_id: criterionId, scope: 'SCENARIO', disposition: 'ACTIONABLE', scope_boundary_ids: [] }],
    grounding, coverage, scenario_coverage: scenarioCoverage };
  const result = checkedSemanticReview(raw, proposal, context, 'case', 'traceability', undefined, undefined, scenario);
  assert.equal(result.verdict, 'WARN');
  assert.equal(result.findings[0].severity, 'WARN');
  assert.equal(result.findings[0].review_consistency, 'SCENARIO_COVERAGE_CONFLICT');
});

test('keeps parent-criterion gaps informational for an assigned atomic scenario', () => {
  const raw = { verdict: 'FAIL', findings: [{ severity: 'FAIL', message: 'Este caso no prueba el límite superior de 500.',
    criterion_id: criterionId, scope: 'PARENT_CRITERION', disposition: 'ACTIONABLE', scope_boundary_ids: [] }],
    grounding, coverage, scenario_coverage: scenarioCoverage };
  const result = checkedSemanticReview(raw, proposal, context, 'case', 'traceability', undefined, undefined, scenario);
  assert.equal(result.verdict, 'WARN');
  assert.equal(result.findings[0].severity, 'WARN');
  assert.equal(result.findings[0].scope, 'PARENT_CRITERION');
});

test('deduplicates findings across review stages and replaces stale generator self-assessment', async () => {
  const message = 'El caso necesita revisión humana.';
  const finding = { severity: 'WARN', message, criterion_id: '', scope: 'GLOBAL',
    disposition: 'ACTIONABLE', scope_boundary_ids: [] };
  const ai = { runWorkflowAgent: async () => ({ data: { verdict: 'WARN', findings: [finding],
    grounding: [], coverage: [], source_coverage: [] }, metrics: {}, prompt: {}, rawResponse: {} }) } as any;
  const result = await reviewGeneratedProposals(ai, [
    { type: 'QaCaseCritic', name: 'Calidad', prompt_template: 'Evalúa.', timeout_sec: 10 },
    { type: 'CoverageTraceabilityAuditor', name: 'Trazabilidad', prompt_template: 'Audita.', timeout_sec: 10 },
  ], [{ ...proposal, criterion_refs: [], quality: { testability: 'FAIL', warnings: [] }, steps: [] }],
  { requisito: context.requisito, historia: context.historia, criterios: [] }, 'case', 1024, 10000);
  const reviewed = result.proposals[0].quality;
  assert.equal(reviewed.semantic_review.verdict, 'WARN');
  assert.equal(reviewed.semantic_review.findings.length, 1);
  assert.equal(reviewed.testability, 'WARN');
});

test('retries traceability once when the model cites a fragment absent from its sources', async () => {
  const scenarioCoverage = [{ scenario_id: scenario.local_id, status: 'COVERED', step_numbers: [1], reason: 'El paso cubre el escenario.' }];
  const review = { verdict: 'PASS', findings: [], grounding: [{ criterion_id: criterionId, status: 'EXPLICIT',
    evidence: [{ source_id: `criterion:${criterionId}`, quote }], assumption_ids: [], reason: 'La fuente contiene el criterio.' }],
    coverage, scenario_coverage: scenarioCoverage, source_coverage: [] };
  const invalidReview = { ...review, grounding: [{ ...review.grounding[0], evidence: [
    ...review.grounding[0].evidence, { source_id: `criterion:${criterionId}`, quote: 'Esta frase no está en la fuente.' },
  ] }] };
  const calls: any[] = [];
  const ai = { runWorkflowAgent: async (request: any) => {
    calls.push(request);
    const data = request.nodeName === 'Calidad' ? { verdict: 'PASS', findings: [] }
      : request.nodeName.includes('corregir contrato') ? review : invalidReview;
    return { data, metrics: {}, prompt: {}, rawResponse: {} };
  } } as any;
  const result = await reviewGeneratedProposals(ai, [
    { type: 'QaCaseCritic', name: 'Calidad', prompt_template: 'Evalúa.', timeout_sec: 10 },
    { type: 'CoverageTraceabilityAuditor', name: 'Trazabilidad', prompt_template: 'Audita.', timeout_sec: 10 },
  ], [proposal], context, 'case', 1024, 10000, [scenario]);

  assert.equal(calls.length, 3);
  assert.match(calls[2].promptTemplate, /copia fragmentos literales completos/);
  assert.equal(result.proposals[0].quality.semantic_review.verdict, 'PASS');
  assert.equal(result.proposals[0].quality.semantic_review.grounding[0].evidence.length, 1);
  assert.equal(result.traces[2].execution_mode, 'ai_semantic_review_contract_retry');
});
