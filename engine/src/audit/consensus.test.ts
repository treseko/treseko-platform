import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuditEvidence, normalizeAuditDecision, resolveAuditConsensus, type AuditEvidenceBundle } from './consensus.ts';

function historyItem(overrides: Record<string, unknown>): any {
  return {
    step_number: 1,
    attempt: 1,
    observation_before: { url: 'https://example.test/catalog', title: 'Catalog', readyState: 'complete', loadingSignals: [] },
    observation_after: { url: 'https://example.test/catalog', title: 'Catalog', readyState: 'complete', loadingSignals: [], visibleText: [], bodyText: '' },
    action: { action: 'click', reason: 'Accion de prueba', confidence: 100, step_number: 1 },
    execution: { ok: true, command: 'click', message: 'OK' },
    duration_ms: 1,
    validation: { ok: true, reason: 'Accion valida', conclusive: false },
    post_validation: { ok: true, reason: 'Comprobado', conclusive: true },
    ...overrides,
  };
}

function conclusiveStep(number: number): AuditEvidenceBundle['steps'][number] {
  return {
    number,
    action: `Paso ${number}`,
    data: '-',
    expected_result: `Resultado ${number}`,
    technical_status: 'PASO',
    attempts: [{
      evidence_ref: `step-${number}-attempt-1`,
      step_number: number,
      attempt: 1,
      expected_result: `Resultado ${number}`,
      action: 'assert_text',
      action_reason: 'Validacion determinista',
      execution_ok: true,
      execution_message: 'OK',
      validation_ok: true,
      validation_reason: 'Texto encontrado',
      validation_conclusive: true,
      url_before: 'https://example.test/login',
      url_after: 'https://example.test/login',
      title_after: 'Login',
      visible_text_after: ['Mensaje esperado'],
      screenshot_ref: `step-${number}-attempt-1-screenshot`,
    }],
  };
}

function evidence(overrides: Partial<AuditEvidenceBundle> = {}): AuditEvidenceBundle {
  return {
    schema_version: 1,
    objective: 'Validar mensaje de error',
    technical_status: 'PASO',
    technical_errors: [],
    final_url: 'https://example.test/login',
    final_title: 'Login',
    steps: [1, 2, 3, 4].map(conclusiveStep),
    summary: {
      total_steps: 4,
      passed_steps: 4,
      failed_steps: 0,
      conclusive_assertions: 1,
      failed_assertions: 0,
      screenshot_count: 4,
    },
    ...overrides,
  };
}

test('mantiene PASO y solicita revision cuando el auditor contradice evidencia tecnica concluyente', () => {
  const audit = normalizeAuditDecision({
    status: 'FAILED',
    reason: 'No pude leer el mensaje final',
    confidence: 96,
    evidence_refs: ['step-4-attempt-1-screenshot'],
  });
  const result = resolveAuditConsensus(evidence(), audit);

  assert.equal(result.final_status, 'PASO');
  assert.equal(result.human_review_required, true);
  assert.equal(result.resolution, 'technical_override');
});

test('bloquea para revision cuando hay discrepancia y falta evidencia concluyente', () => {
  const audit = normalizeAuditDecision({ status: 'FAILED', reason: 'Captura ambigua', confidence: 88 });
  const result = resolveAuditConsensus(evidence({
    steps: [1, 2, 3, 4].map((number) => ({
      ...conclusiveStep(number),
      attempts: conclusiveStep(number).attempts.map((attempt) => ({ ...attempt, validation_conclusive: false })),
    })),
    summary: {
      total_steps: 4,
      passed_steps: 4,
      failed_steps: 0,
      conclusive_assertions: 0,
      failed_assertions: 0,
      screenshot_count: 4,
    },
  }), audit);

  assert.equal(result.final_status, 'BLOQUEADO');
  assert.equal(result.human_review_required, true);
  assert.equal(result.resolution, 'insufficient_evidence');
});

test('marca FALLO cuando el auditor demuestra una expectativa incumplida sin contradiccion tecnica concluyente', () => {
  const audit = normalizeAuditDecision({
    status: 'FAILED',
    reason: 'El titulo esperado no aparece en la captura final',
    confidence: 98,
    evidence_refs: ['step-1-attempt-1-screenshot'],
    failed_expectations: ['El titulo esperado no esta presente'],
  });
  const inconclusiveStep = conclusiveStep(1);
  inconclusiveStep.attempts = inconclusiveStep.attempts.map((attempt) => ({ ...attempt, validation_conclusive: false }));
  const result = resolveAuditConsensus(evidence({
    steps: [inconclusiveStep],
    summary: {
      total_steps: 1,
      passed_steps: 1,
      failed_steps: 0,
      conclusive_assertions: 0,
      failed_assertions: 0,
      screenshot_count: 1,
    },
  }), audit);

  assert.equal(result.final_status, 'FALLO');
  assert.equal(result.human_review_required, false);
  assert.equal(result.resolution, 'agreement');
});

test('no permite que una sola asercion concluyente cubra pasos sin verificar', () => {
  const audit = normalizeAuditDecision({ status: 'FAILED', reason: 'El ultimo resultado no esta demostrado', confidence: 90 });
  const result = resolveAuditConsensus(evidence({
    steps: [
      conclusiveStep(1),
      { ...conclusiveStep(2), attempts: [] },
      { ...conclusiveStep(3), attempts: [] },
      { ...conclusiveStep(4), attempts: [] },
    ],
  }), audit);

  assert.equal(result.final_status, 'BLOQUEADO');
  assert.equal(result.resolution, 'insufficient_evidence');
});

test('construye evidencia trazable con observacion posterior y captura por intento', () => {
  const built = buildAuditEvidence(
    'Validar mensaje de error',
    [{ number: 1, action: 'Enviar formulario', expected: 'Debe aparecer "Usuario invalido"' }],
    [{
      number: 1,
      status: 'PASO',
      observations: 'Mensaje encontrado',
      history: [{
        step_number: 1,
        attempt: 1,
        observation_before: { url: 'https://example.test/login', title: 'Login', readyState: 'complete', loadingSignals: [] },
        observation_after: { url: 'https://example.test/login', title: 'Login', readyState: 'complete', loadingSignals: [], visibleText: ['Usuario invalido'], bodyText: 'Usuario invalido' },
        action: { action: 'assert_text', value: 'Usuario invalido', reason: 'Comprobar mensaje', confidence: 100, step_number: 1 },
        execution: { ok: true, command: 'assert_text', message: 'Texto encontrado' },
        duration_ms: 12,
        screenshot_base64: 'captura-base64',
        validation: { ok: true, reason: 'Accion valida', conclusive: false },
        post_validation: { ok: true, reason: 'Texto encontrado', conclusive: true },
      }],
    }],
    [],
  );

  assert.equal(built.bundle.technical_status, 'PASO');
  assert.equal(built.bundle.summary.conclusive_assertions, 1);
  assert.equal(built.bundle.steps[0]?.attempts[0]?.visible_text_after[0], 'Usuario invalido');
  assert.equal(built.images[0]?.evidence_ref, 'step-1-attempt-1-screenshot');
});

test('no contabiliza intentos intermedios fallidos cuando un paso compuesto termina comprobado', () => {
  const built = buildAuditEvidence('Flujo compuesto', [{ number: 1, action: 'Agregar y abrir Checkout', expected: 'Checkout visible' }], [{
    number: 1,
    status: 'PASO',
    observations: 'Paso completado',
    history: [
      historyItem({ step_number: 1, attempt: 1, execution: { ok: false, command: 'postActionValidation', message: 'Aun en catalogo' }, post_validation: { ok: false, conclusive: true, reason: 'Aun no checkout' } }),
      historyItem({ step_number: 1, attempt: 2, execution: { ok: true, command: 'click', message: 'OK' }, post_validation: { ok: true, conclusive: true, reason: 'Checkout visible' } }),
    ],
  }], []);
  assert.equal(built.bundle.summary.failed_assertions, 0);
  assert.equal(built.bundle.summary.conclusive_assertions, 1);
});

test('un fallo tecnico prevalece sobre cualquier dictamen visual', () => {
  const audit = normalizeAuditDecision({ status: 'PASSED', reason: 'La captura parece correcta', confidence: 99 });
  const result = resolveAuditConsensus(evidence({
    technical_status: 'FALLO',
    technical_errors: ['No se pudo enviar el formulario'],
  }), audit);

  assert.equal(result.final_status, 'FALLO');
  assert.equal(result.resolution, 'technical_failure');
  assert.equal(result.human_review_required, true);
  assert.match(result.reason, /No se pudo enviar/);
});

test('la evidencia visual puede corregir una asercion textual falsa cuando la accion tecnica si se completo', () => {
  const failedStep = conclusiveStep(1);
  failedStep.technical_status = 'FALLO';
  failedStep.attempts = failedStep.attempts.map((attempt) => ({
    ...attempt,
    validation_ok: false,
    validation_reason: 'text_contains no cumplida',
  }));
  const audit = normalizeAuditDecision({
    status: 'PASSED',
    reason: 'La captura muestra Username y Password visibles.',
    confidence: 94,
    evidence_refs: ['step-1-attempt-1-screenshot'],
  });
  const result = resolveAuditConsensus(evidence({
    technical_status: 'FALLO',
    technical_errors: ['Paso 1: text_contains no cumplida'],
    steps: [failedStep],
    summary: {
      total_steps: 1,
      passed_steps: 0,
      failed_steps: 1,
      conclusive_assertions: 1,
      failed_assertions: 1,
      screenshot_count: 1,
    },
  }), audit);

  assert.equal(result.final_status, 'PASO');
  assert.equal(result.human_review_required, false);
  assert.equal(result.resolution, 'technical_override');
});

test('un incumplimiento determinista concluyente no requiere reinterpretacion humana', () => {
  const audit = normalizeAuditDecision({ status: 'FAILED', reason: 'Texto esperado ausente', confidence: 100 });
  const result = resolveAuditConsensus(evidence({
    technical_status: 'FALLO',
    technical_errors: ['No se encontro el texto esperado'],
    summary: {
      total_steps: 1,
      passed_steps: 0,
      failed_steps: 1,
      conclusive_assertions: 1,
      failed_assertions: 1,
      screenshot_count: 1,
    },
  }), audit);

  assert.equal(result.final_status, 'FALLO');
  assert.equal(result.confidence, 100);
  assert.equal(result.human_review_required, false);
});

test('aprueba sin revision cuando evidencia tecnica y auditor coinciden', () => {
  const audit = normalizeAuditDecision({
    status: 'PASSED',
    reason: 'El mensaje esperado aparece en la evidencia',
    confidence: 97,
    evidence_refs: ['step-4-attempt-1-screenshot'],
  });
  const result = resolveAuditConsensus(evidence(), audit);

  assert.equal(result.final_status, 'PASO');
  assert.equal(result.human_review_required, false);
  assert.equal(result.resolution, 'agreement');
});

test('no considera acuerdo una aprobacion visual sin referencias de evidencia validas', () => {
  const audit = normalizeAuditDecision({
    status: 'PASSED',
    reason: 'Parece correcto',
    confidence: 99,
    evidence_refs: ['captura-inexistente'],
  });
  const result = resolveAuditConsensus(evidence(), audit);

  assert.equal(result.final_status, 'PASO');
  assert.equal(result.human_review_required, true);
  assert.equal(result.resolution, 'technical_override');
  assert.match(result.reason, /no cito evidencia valida/);
});

test('normaliza respuestas incompletas del modelo sin inventar evidencia', () => {
  const audit = normalizeAuditDecision({ status: 'unexpected' as never, reason: '', confidence: 500 });

  assert.equal(audit.status, 'BLOCKED');
  assert.equal(audit.confidence, 100);
  assert.deepEqual(audit.evidence_refs, []);
  assert.ok(audit.reason.length > 0);
});
