import type { BackendStatus, QAEngineStep, StepRunResult, StructuredHistoryItem } from '../automation/action-types.ts';

export type VisualAuditStatus = 'PASSED' | 'FAILED' | 'BLOCKED' | 'SKIPPED';

export interface AuditDecision {
  status: VisualAuditStatus;
  reason: string;
  confidence: number;
  evidence_refs: string[];
  failed_expectations: string[];
  missing_evidence: string[];
  contradictions: string[];
}

export interface AuditEvidenceAttempt {
  evidence_ref: string;
  step_number: number;
  attempt: number;
  expected_result: string;
  action: string;
  action_reason: string;
  execution_ok: boolean;
  execution_message: string;
  validation_ok: boolean;
  validation_reason: string;
  validation_conclusive: boolean;
  url_before: string;
  url_after: string;
  title_after: string;
  visible_text_after: string[];
  screenshot_ref?: string;
  contract_coverage?: 'full' | 'partial' | 'none';
  unresolved_expectations?: string[];
  checkpoint?: StructuredHistoryItem['checkpoint'];
}

export interface AuditEvidenceBundle {
  schema_version: 1;
  objective: string;
  technical_status: BackendStatus;
  technical_errors: string[];
  final_url: string;
  final_title: string;
  steps: Array<{
    number: number;
    action: string;
    data: string;
    expected_result: string;
    technical_status: BackendStatus;
    attempts: AuditEvidenceAttempt[];
  }>;
  summary: {
    total_steps: number;
    passed_steps: number;
    failed_steps: number;
    conclusive_assertions: number;
    failed_assertions: number;
    screenshot_count: number;
    full_contract_steps?: number;
    partial_contract_steps?: number;
    semantic_audit_steps?: number;
  };
}

export interface AuditImage {
  evidence_ref: string;
  base64: string;
}

export interface AuditConsensus {
  final_status: BackendStatus;
  reason: string;
  confidence: number;
  human_review_required: boolean;
  resolution: 'agreement' | 'technical_failure' | 'technical_override' | 'insufficient_evidence';
}

function normalizeVisualStatus(status: string | undefined): BackendStatus {
  const normalized = String(status || '').toUpperCase();
  if (['PASSED', 'PASS', 'PASO', 'SUCCESS', 'OK'].includes(normalized)) return 'PASO';
  if (['BLOCKED', 'BLOQUEADO', 'SKIPPED'].includes(normalized)) return 'BLOQUEADO';
  return 'FALLO';
}

function compactVisibleText(value: string[] | undefined): string[] {
  return (value || [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((item) => item.slice(0, 240));
}

function attemptEvidenceRef(item: StructuredHistoryItem): string {
  return `step-${item.step_number}-attempt-${item.attempt}`;
}

export function buildAuditEvidence(
  objective: string,
  qaSteps: QAEngineStep[],
  resultSteps: StepRunResult[],
  errors: string[],
): { bundle: AuditEvidenceBundle; images: AuditImage[] } {
  const resultByNumber = new Map(resultSteps.map((step) => [step.number, step]));
  const images: AuditImage[] = [];
  const imageRefs = new Map<string, string>();
  let conclusiveAssertions = 0;
  let failedAssertions = 0;

  const steps = qaSteps.map((step) => {
    const result = resultByNumber.get(step.number);
    const history = result?.history || [];
    // A composed legacy step can deliberately take several browser actions
    // (for example add product -> cart -> checkout). Intermediate snapshots
    // are evidence of progress, not failed assertions once a later attempt
    // conclusively proves the step.
    const effectiveAttempt = [...history].reverse().find((item) => (
      item.execution?.ok && item.post_validation?.conclusive && item.post_validation.ok
    )) || history[history.length - 1];
    const attempts = history.map((item): AuditEvidenceAttempt => {
      const evidenceRef = attemptEvidenceRef(item);
      let screenshotRef: string | undefined;
      if (item.screenshot_base64) {
        screenshotRef = imageRefs.get(item.screenshot_base64) || `${evidenceRef}-screenshot`;
      }
      if (item.screenshot_base64 && !imageRefs.has(item.screenshot_base64)) {
        imageRefs.set(item.screenshot_base64, screenshotRef as string);
        images.push({ evidence_ref: screenshotRef as string, base64: item.screenshot_base64 });
      }
      if (item === effectiveAttempt && item.post_validation?.conclusive) {
        conclusiveAssertions += 1;
        if (!item.post_validation.ok) failedAssertions += 1;
      }
      const auditAttempt: AuditEvidenceAttempt = {
        evidence_ref: evidenceRef,
        step_number: item.step_number,
        attempt: item.attempt,
        expected_result: step.expected || '-',
        action: item.action?.action || '-',
        action_reason: item.action?.reason || '-',
        execution_ok: Boolean(item.execution?.ok),
        execution_message: item.execution?.message || '-',
        validation_ok: Boolean(item.post_validation?.ok ?? item.validation?.ok),
        validation_reason: item.post_validation?.reason || item.validation?.reason || 'Sin validacion registrada',
        validation_conclusive: Boolean(item.post_validation?.conclusive),
        url_before: item.observation_before?.url || '',
        url_after: item.observation_after?.url || '',
        title_after: item.observation_after?.title || '',
        visible_text_after: compactVisibleText(item.observation_after?.visibleText),
        ...(item.contract?.coverage ? { contract_coverage: item.contract.coverage } : {}),
        ...(item.contract ? { unresolved_expectations: item.contract.unresolved_fragments } : {}),
        ...(item.checkpoint ? { checkpoint: item.checkpoint } : {}),
      };
      if (screenshotRef) auditAttempt.screenshot_ref = screenshotRef;
      return auditAttempt;
    });
    return {
      number: step.number,
      action: step.action || '-',
      data: step.data || '-',
      expected_result: step.expected || '-',
      technical_status: result?.status || 'BLOQUEADO',
      attempts,
    };
  });

  const completedSteps = resultSteps.filter((step) => step.status === 'PASO').length;
  const failedSteps = resultSteps.filter((step) => step.status !== 'PASO').length;
  const technicalStatus: BackendStatus = errors.length
    ? (resultSteps.some((step) => step.status === 'FALLO') ? 'FALLO' : 'BLOQUEADO')
    : (resultSteps.length === qaSteps.length && failedSteps === 0 ? 'PASO' : 'BLOQUEADO');
  const finalAttempt = [...steps].reverse().flatMap((step) => [...step.attempts].reverse())[0];

  return {
    bundle: {
      schema_version: 1,
      objective,
      technical_status: technicalStatus,
      technical_errors: errors,
      final_url: finalAttempt?.url_after || '',
      final_title: finalAttempt?.title_after || '',
      steps,
      summary: {
        total_steps: qaSteps.length,
        passed_steps: completedSteps,
        failed_steps: failedSteps,
        conclusive_assertions: conclusiveAssertions,
        failed_assertions: failedAssertions,
        screenshot_count: images.length,
        full_contract_steps: steps.filter((step) => step.attempts.some((attempt) => attempt.contract_coverage === 'full')).length,
        partial_contract_steps: steps.filter((step) => step.attempts.some((attempt) => attempt.contract_coverage === 'partial')).length,
        semantic_audit_steps: steps.filter((step) => !step.attempts.some((attempt) => attempt.contract_coverage === 'full')).length,
      },
    },
    images: images.slice(-6),
  };
}

export function resolveAuditConsensus(bundle: AuditEvidenceBundle, audit: AuditDecision): AuditConsensus {
  const visualStatus = normalizeVisualStatus(audit.status);
  const confidence = Math.max(0, Math.min(100, Math.round(Number(audit.confidence || 0))));
  const validEvidenceRefs = new Set(bundle.steps.flatMap((step) => (
    step.attempts.flatMap((attempt) => [attempt.evidence_ref, attempt.screenshot_ref].filter(Boolean) as string[])
  )));
  const citedEvidenceRefs = audit.evidence_refs.filter((ref) => validEvidenceRefs.has(ref));
  const visualDecisionHasEvidence = citedEvidenceRefs.length > 0
    && citedEvidenceRefs.length === audit.evidence_refs.length;

  const visualPassCanOverrideTextAssertion = bundle.technical_status === 'FALLO'
    && visualStatus === 'PASO'
    && visualDecisionHasEvidence
    && confidence >= 80
    && audit.failed_expectations.length === 0
    && audit.missing_evidence.length === 0
    && audit.contradictions.length === 0
    && bundle.steps.some((step) => step.technical_status === 'FALLO')
    && bundle.steps.every((step) => step.technical_status !== 'FALLO' || step.attempts.some((attempt) => (
      attempt.execution_ok && attempt.validation_conclusive && !attempt.validation_ok
    )));

  if (visualPassCanOverrideTextAssertion) {
    return {
      final_status: 'PASO',
      reason: `La evidencia visual citada confirma el resultado esperado y corrige una asercion textual determinista: ${audit.reason}`,
      confidence,
      human_review_required: confidence < 90,
      resolution: 'technical_override',
    };
  }

  if (bundle.technical_status !== 'PASO') {
    const deterministicFailure = bundle.technical_status === 'FALLO'
      && bundle.summary.failed_assertions > 0;
    return {
      final_status: bundle.technical_status,
      reason: bundle.technical_errors.join(' | ') || 'La ejecucion tecnica no finalizo correctamente.',
      confidence: deterministicFailure ? 100 : Math.max(confidence, 90),
      human_review_required: !deterministicFailure,
      resolution: 'technical_failure',
    };
  }

  if (visualStatus === 'PASO' && visualDecisionHasEvidence) {
    return {
      final_status: 'PASO',
      reason: audit.reason || 'La evidencia tecnica y la auditoria final coinciden.',
      confidence,
      human_review_required: confidence < 70 || audit.missing_evidence.length > 0 || audit.contradictions.length > 0,
      resolution: 'agreement',
    };
  }

  const conclusiveTechnicalEvidence = bundle.steps.length > 0
    && bundle.steps.every((step) => (
      step.technical_status === 'PASO'
      && step.attempts.some((attempt) => attempt.validation_conclusive && attempt.validation_ok)
    ))
    && bundle.summary.failed_assertions === 0;
  if (conclusiveTechnicalEvidence) {
    const disagreementReason = visualStatus === 'PASO'
      ? 'el auditor no cito evidencia valida para sostener su dictamen'
      : audit.reason || 'sin motivo detallado';
    return {
      final_status: 'PASO',
      reason: `La ejecucion tecnica comprobo el resultado, pero la auditoria visual no pudo confirmarlo de forma trazable: ${disagreementReason}`,
      confidence: Math.min(confidence || 70, 85),
      human_review_required: true,
      resolution: 'technical_override',
    };
  }

  const visualFailureHasEvidence = visualStatus === 'FALLO'
    && visualDecisionHasEvidence
    && audit.failed_expectations.length > 0
    && audit.missing_evidence.length === 0;
  if (visualFailureHasEvidence) {
    return {
      final_status: 'FALLO',
      reason: audit.reason || 'La evidencia citada demuestra que no se cumplio el resultado esperado.',
      confidence,
      human_review_required: confidence < 70 || audit.contradictions.length > 0,
      resolution: 'agreement',
    };
  }

  return {
    final_status: 'BLOQUEADO',
    reason: `La ejecucion tecnica termino sin errores, pero falta evidencia determinista para resolver el dictamen del auditor: ${visualDecisionHasEvidence ? audit.reason || 'sin motivo detallado' : 'no se citaron referencias de evidencia validas'}`,
    confidence: Math.min(confidence || 60, 70),
    human_review_required: true,
    resolution: 'insufficient_evidence',
  };
}

export function normalizeAuditDecision(value: Partial<AuditDecision> | undefined): AuditDecision {
  const status = String(value?.status || 'BLOCKED').toUpperCase();
  return {
    status: (['PASSED', 'FAILED', 'BLOCKED', 'SKIPPED'].includes(status) ? status : 'BLOCKED') as VisualAuditStatus,
    reason: String(value?.reason || 'El auditor no devolvio un motivo verificable.'),
    confidence: Math.max(0, Math.min(100, Math.round(Number(value?.confidence || 0)))),
    evidence_refs: Array.isArray(value?.evidence_refs) ? value.evidence_refs.map(String) : [],
    failed_expectations: Array.isArray(value?.failed_expectations) ? value.failed_expectations.map(String) : [],
    missing_evidence: Array.isArray(value?.missing_evidence) ? value.missing_evidence.map(String) : [],
    contradictions: Array.isArray(value?.contradictions) ? value.contradictions.map(String) : [],
  };
}
