import type { QAEngineStep } from './automation/action-types.ts';

 type AgentTimelineEvent = {
  ts: string;
  level: string;
  agent: string;
  message: string;
  step?: number;
  attempt?: number;
  action?: unknown;
  reason?: string;
  confidence?: number;
  metrics?: Record<string, any>;
  prompt_excerpt?: string;
  raw_response_excerpt?: string;
  validation?: unknown;
  execution?: unknown;
};

function normalizeAuditStatus(status: string | undefined): string {
  const normalized = (status || '').toUpperCase();
  if (['PASSED', 'PASS', 'PASO', 'SUCCESS', 'OK'].includes(normalized)) return 'PASO';
  if (['BLOCKED', 'BLOQUEADO'].includes(normalized)) return 'BLOQUEADO';
  return 'FALLO';
}

function averageConfidence(values: Array<number | undefined>): number {
  const clean = values.map((value) => Number(value || 0)).filter((value) => value > 0);
  if (!clean.length) return 0;
  return Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length);
}

function sumMetricsFromTimeline(timeline: AgentTimelineEvent[]): Record<string, number> {
  return timeline.reduce((acc, item) => {
    const metrics = item.metrics || {};
    acc.promptTokens += Number(metrics.promptTokens || metrics.prompt_tokens || 0);
    acc.completionTokens += Number(metrics.completionTokens || metrics.completion_tokens || 0);
    acc.totalTokens += Number(metrics.totalTokens || metrics.total_tokens || 0);
    acc.latencyMs += Number(metrics.latencyMs || metrics.latency_ms || 0);
    acc.estimatedCost += Number(metrics.estimatedCost || metrics.estimated_cost || 0);
    acc.aiCalls += metrics.totalTokens || metrics.total_tokens || metrics.latencyMs || metrics.latency_ms ? 1 : 0;
    return acc;
  }, {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    latencyMs: 0,
    estimatedCost: 0,
    aiCalls: 0,
  });
}

function compactHistoryItem(item: any): Record<string, any> {
  const compactObservation = (observation: any) => observation ? {
    url: observation.url,
    title: observation.title,
    readyState: observation.readyState,
    loadingSignals: Array.isArray(observation.loadingSignals) ? observation.loadingSignals.slice(0, 10) : [],
    visibleText: Array.isArray(observation.visibleText) ? observation.visibleText.slice(0, 20) : [],
    bodyTextExcerpt: typeof observation.bodyText === 'string' ? observation.bodyText.slice(0, 1200) : undefined,
    elementCount: Array.isArray(observation.elements) ? observation.elements.length : undefined,
  } : undefined;
  return {
    step_number: item.step_number,
    attempt: item.attempt,
    action: item.action,
    execution: item.execution,
    validation: item.validation,
    post_validation: item.post_validation,
    observation_before: compactObservation(item.observation_before),
    observation_after: compactObservation(item.observation_after),
    duration_ms: item.duration_ms,
    screenshot_available: Boolean(item.screenshot_base64),
    metrics: item.metrics,
    raw_ai_response_excerpt: item.raw_ai_response ? JSON.stringify(item.raw_ai_response).slice(0, 2500) : undefined,
  };
}

function compactWorkflowValue(value: any, depth = 0): any {
  if (value === null || value === undefined) return value;
  if (depth > 3) return undefined;
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 2000)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => compactWorkflowValue(item, depth + 1));
  if (typeof value === 'object') {
    const compact: Record<string, any> = {};
    for (const [key, item] of Object.entries(value).slice(0, 30)) {
      if (['screenshot', 'screenshot_base64', 'image_base64', 'base64'].includes(key)) {
        compact[`${key}_available`] = Boolean(item);
        continue;
      }
      if (['prompt_template', 'prompt', 'system_prompt', 'raw_response', 'rawResponse'].includes(key)) {
        compact[`${key}_excerpt`] = typeof item === 'string' ? item.slice(0, 1000) : JSON.stringify(item).slice(0, 1000);
        continue;
      }
      compact[key] = compactWorkflowValue(item, depth + 1);
    }
    return compact;
  }
  return String(value).slice(0, 1000);
}

function compactWorkflowNode(node: any): Record<string, any> {
  return {
    id: node?.id,
    type: node?.type,
    name: node?.name,
    agent_key: node?.agent_key,
    enabled: node?.enabled,
    locked: node?.locked,
    timeout_sec: node?.timeout_sec,
    position_x: node?.position_x,
    position_y: node?.position_y,
    model_override: node?.model_override,
    temperature_override: node?.temperature_override,
  };
}

function compactany(trace: any): Record<string, any> {
  return {
    ts: trace.ts || trace.started_at,
    workflow_id: trace.workflow_id,
    workflow_version: trace.workflow_version,
    node_id: trace.node_id,
    node_name: trace.node_name,
    node_type: trace.node_type,
    status: trace.status,
    started_at: trace.started_at,
    ended_at: trace.ended_at,
    input_json: compactWorkflowValue(trace.input_json),
    output_json: compactWorkflowValue(trace.output_json),
    metrics_json: compactWorkflowValue(trace.metrics_json),
  };
}

const AI_REPORT_DELIVERY_BUDGET_BYTES = 240 * 1024;

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function selectWorkflowPayloadFields(value: any, keys: string[]): Record<string, any> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const selected: Record<string, any> = {};
  for (const key of keys) {
    if (value[key] !== undefined) selected[key] = compactWorkflowValue(value[key]);
  }
  return Object.keys(selected).length ? selected : undefined;
}

function compactTraceForDelivery(trace: Record<string, any>): Record<string, any> {
  const input = selectWorkflowPayloadFields(trace.input_json, [
    'executionId', 'caseId', 'current_step', 'step_number', 'attempt', 'objective',
  ]);
  const output = selectWorkflowPayloadFields(trace.output_json, [
    'status', 'confidence', 'reason', 'message', 'output_port', 'reason_code',
    'implementation', 'planned_action', 'action', 'decision', 'events',
  ]);
  return {
    ts: trace.ts,
    workflow_id: trace.workflow_id,
    workflow_version: trace.workflow_version,
    node_id: trace.node_id,
    node_name: trace.node_name,
    node_type: trace.node_type,
    status: trace.status,
    started_at: trace.started_at,
    ended_at: trace.ended_at,
    ...(input ? { input_json: input } : {}),
    ...(output ? { output_json: output } : {}),
    metrics_json: trace.metrics_json,
  };
}

function compactConversationForDelivery(item: Record<string, any>): Record<string, any> {
  return {
    ts: item.ts,
    level: item.level,
    agent: item.agent,
    node_id: item.node_id,
    node_type: item.node_type,
    status: item.status,
    message: typeof item.message === 'string' ? item.message.slice(0, 1000) : item.message,
    reason: typeof item.reason === 'string' ? item.reason.slice(0, 1500) : item.reason,
    confidence: item.confidence,
    metrics: item.metrics,
    started_at: item.started_at,
    ended_at: item.ended_at,
  };
}

function compactTimelineForDelivery(item: AgentTimelineEvent): AgentTimelineEvent {
  return {
    ts: item.ts,
    level: item.level,
    agent: item.agent,
    message: String(item.message || '').slice(0, 1200),
    step: item.step,
    attempt: item.attempt,
    action: compactWorkflowValue(item.action, 2),
    reason: item.reason?.slice(0, 1000),
    confidence: item.confidence,
    metrics: item.metrics,
    prompt_excerpt: item.prompt_excerpt?.slice(0, 500),
    raw_response_excerpt: item.raw_response_excerpt?.slice(0, 500),
    validation: compactWorkflowValue(item.validation, 2),
    execution: compactWorkflowValue(item.execution, 2),
  };
}

/**
 * Keeps the durable report below the backend contract limit without dropping
 * case steps, evidence, audit decisions or terminal status. Workflow inputs
 * and outputs are summarized because the same runtime state is otherwise
 * repeated in traces, conversation and timeline.
 */
function compactAiReportForDelivery(report: Record<string, any>): Record<string, any> {
  const originalBytes = serializedBytes(report);
  const compacted: Record<string, any> = {
    ...report,
    workflow_traces: (report.workflow_traces || []).map(compactTraceForDelivery),
    agent_conversation: (report.agent_conversation || []).map(compactConversationForDelivery),
  };
  if (serializedBytes(compacted) <= AI_REPORT_DELIVERY_BUDGET_BYTES) {
    return originalBytes === serializedBytes(compacted)
      ? compacted
      : { ...compacted, report_compaction: { applied: true, original_bytes: originalBytes } };
  }

  const reduced: Record<string, any> = {
    ...compacted,
    timeline: (compacted.timeline || []).map(compactTimelineForDelivery),
    workflow_traces: (compacted.workflow_traces || []).map((trace: Record<string, any>) => ({
      ...trace,
      input_json: selectWorkflowPayloadFields(trace.input_json, ['current_step', 'step_number', 'attempt']),
      output_json: selectWorkflowPayloadFields(trace.output_json, [
        'status', 'confidence', 'reason', 'output_port', 'reason_code', 'implementation', 'planned_action', 'action',
      ]),
    })),
    report_compaction: { applied: true, original_bytes: originalBytes, level: 'reduced_runtime_duplicates' },
  };
  if (serializedBytes(reduced) <= AI_REPORT_DELIVERY_BUDGET_BYTES) return reduced;

  // Last-resort protection for unusually verbose providers. Detailed case
  // steps and evidence remain intact; only duplicate workflow telemetry is
  // bounded. Full traces remain available in Engine logs and monitoring.
  return {
    ...reduced,
    timeline: (reduced.timeline || []).slice(-80),
    workflow_traces: (reduced.workflow_traces || []).map((trace: Record<string, any>) => ({
      ts: trace.ts,
      node_id: trace.node_id,
      node_name: trace.node_name,
      node_type: trace.node_type,
      status: trace.status,
      started_at: trace.started_at,
      ended_at: trace.ended_at,
      output_json: selectWorkflowPayloadFields(trace.output_json, ['status', 'confidence', 'reason', 'output_port', 'reason_code']),
      metrics_json: trace.metrics_json,
    })),
    agent_conversation: (reduced.agent_conversation || []).slice(-80),
    report_compaction: { applied: true, original_bytes: originalBytes, level: 'bounded_runtime_telemetry' },
  };
}

function failureCategory(status: string, errors: string[], failedAssertions = 0): string | undefined {
  if (status === 'PASO') return undefined;
  if (failedAssertions > 0) return 'assertion_failed';
  const text = errors.join(' ').toLowerCase();
  if (text.includes('url') || text.includes('navigate') || text.includes('goto')) return 'navigation_error';
  if (text.includes('target') || text.includes('visible') || text.includes('element')) return 'target_not_found';
  if (text.includes('bloque')) return 'model_blocked';
  return status === 'BLOQUEADO' ? 'blocked_by_engine' : 'execution_failed';
}

function buildAiReport(args: {
  task: string;
  expected?: string;
  testId: string;
  suite: string;
  model: string;
  status: string;
  durationSeconds: number;
  validation: { status: string; reason: string; confidence: number };
  auditDecision: any;
  consensusDecision: any;
  auditEvidence: any;
  visualAuditUsed: boolean;
  runResult?: any;
  resultSteps: any[];
  errors: string[];
  startedAt: number;
  url?: string | undefined;
  finalScreenshotBase64?: string | undefined;
  timeline?: AgentTimelineEvent[];
  workflowTraces?: any[];
  parameters?: Record<string, any>;
}): Record<string, any> {
  const stepConfidences = args.runResult?.steps.map((step: any) => step.confidence) || [];
  const confidence = averageConfidence([args.consensusDecision.confidence, ...stepConfidences]);
  const category = failureCategory(args.status, args.errors, args.auditEvidence.summary.failed_assertions);
  const deterministicDecision = args.auditEvidence.summary.failed_assertions > 0
    || (
      args.auditEvidence.steps.length > 0
      && args.auditEvidence.steps.every((step: any) => (
        step.technical_status === 'PASO'
        && step.attempts.some((attempt: any) => attempt.validation_conclusive && attempt.validation_ok)
      ))
    );
  const consensusSignals = {
    technical: args.auditEvidence.technical_status,
    visual_audit: normalizeAuditStatus(args.validation.status),
    final: args.status,
    resolution: args.consensusDecision.resolution,
  };
  const visualAudit = {
    enabled: args.visualAuditUsed,
    status: args.visualAuditUsed ? normalizeAuditStatus(args.auditDecision.status) : 'NO_APLICADA',
    confidence: args.visualAuditUsed ? args.auditDecision.confidence : null,
    evidence_refs: args.visualAuditUsed ? args.auditDecision.evidence_refs : [],
    reason: args.visualAuditUsed ? args.auditDecision.reason : 'El resultado se resolvio sin consultar un modelo de vision.',
  };
  const timeline = args.timeline || [];
  const metrics = sumMetricsFromTimeline(timeline);
  const checkpoints = args.runResult?.checkpoints || [];
  const contractSteps: any[] = args.runResult?.steps || [];
  const fullContracts = contractSteps.filter((step: any) => step.contract?.coverage === 'full').length;
  const partialContracts = contractSteps.filter((step: any) => step.contract?.coverage === 'partial').length;
  const semanticContracts = contractSteps.filter((step: any) => step.contract?.requires_semantic_audit).length;
  const totalAttempts = contractSteps.reduce((total: number, step: any) => total + step.history.length, 0);
  const workflowDefinition = (args.parameters || {}).workflow_definition || null;
  const workflowMeta = workflowDefinition?.workflow || null;
  const workflowNodes = (workflowDefinition?.nodes || []).map(compactWorkflowNode);
  const workflowEdges = (workflowDefinition?.edges || []).map((edge: any) => ({
    id: edge?.id,
    source_node_id: edge?.source_node_id,
    target_node_id: edge?.target_node_id,
    condition: edge?.condition,
  }));
  const compactTraces = (args.workflowTraces || []).map(compactany);
  const evidenceStepsByNumber = new Map<number, any>((args.auditEvidence.steps || []).map((step: any) => [Number(step.number), step]));
  const workflowConversation = compactTraces.map((trace) => ({
    ts: trace.ts || trace.started_at,
    level: trace.status === 'FAILED' ? 'ERROR' : trace.status === 'BLOCKED' ? 'WARN' : 'INFO',
    agent: trace.node_name || trace.node_type || 'WORKFLOW',
    node_id: trace.node_id,
    node_type: trace.node_type,
    status: trace.status,
    message: `${trace.node_name || trace.node_type || 'Nodo workflow'}: ${trace.status}`,
    reason: trace.output_json?.reason,
    confidence: trace.output_json?.confidence,
    input_json: trace.input_json,
    output_json: trace.output_json,
    metrics: trace.metrics_json,
    started_at: trace.started_at,
    ended_at: trace.ended_at,
  }));
  const compactParameters = {
    ...(args.parameters || {}),
    workflow_definition: workflowDefinition
      ? {
          workflow: workflowMeta,
          nodes_count: workflowNodes.length,
          edges_count: workflowEdges.length,
        }
      : null,
  };
  const report = {
    schema_version: 1,
    decision_contract_version: 3,
    execution_id: args.testId,
    objective: args.task,
    expected_result: args.expected || undefined,
    suite: args.suite,
    summary: args.consensusDecision.reason,
    status: args.status,
    duration_seconds: args.durationSeconds,
    confidence,
    consensus: args.status,
    consensus_signals: consensusSignals,
    visual_audit: visualAudit,
    failure_category: category,
    human_review_required: args.consensusDecision.human_review_required,
    decision_mode: deterministicDecision ? 'deterministic_assertions' : 'ai_audit',
    audit_decision: args.auditDecision,
    audit_evidence: args.auditEvidence,
    evidence_summary: args.auditEvidence.summary,
    started_at: new Date(args.startedAt).toISOString(),
    ended_at: new Date().toISOString(),
    model: args.model,
    parameters: compactWorkflowValue(compactParameters),
    workflow_id: workflowMeta?.id,
    workflow_version: workflowMeta?.version,
    workflow_snapshot: workflowDefinition
      ? {
          workflow: workflowMeta,
          nodes_count: workflowNodes.length,
          edges_count: workflowEdges.length,
        }
      : null,
    workflow_nodes: workflowNodes,
    workflow_edges: workflowEdges,
    data: (args.parameters || {}).context || {},
    metrics: {
      ...metrics,
      duration_seconds: args.durationSeconds,
      avg_latency_ms: metrics.aiCalls ? Math.round(Number(metrics.latencyMs || 0) / metrics.aiCalls) : 0,
      reliability: {
        contract_coverage_percent: contractSteps.length ? Math.round((fullContracts / contractSteps.length) * 100) : 0,
        full_contract_steps: fullContracts,
        partial_contract_steps: partialContracts,
        semantic_audit_steps: semanticContracts,
        attempts: totalAttempts,
        retries: Math.max(0, totalAttempts - contractSteps.length),
        checkpoint_count: checkpoints.length,
        terminal_step_count: contractSteps.length,
        completed_step_count: contractSteps.filter((step: any) => ['PASO', 'FALLO', 'BLOQUEADO'].includes(step.status)).length,
      },
    },
    timeline,
    workflow_traces: compactTraces,
    agent_conversation: workflowConversation.length
      ? workflowConversation
      : timeline.filter((item: any) => ['AI_AGENT', 'QA_GUARD', 'AUDITOR', 'RECOVERY', 'SENTINEL'].includes(item.agent)),
    initial_url: args.url,
    visited_urls: args.runResult?.visited_urls || [],
    errors: args.errors,
    final_result: args.consensusDecision.reason,
    steps: (args.runResult?.steps || []).map((step: any) => ({
      number: step.number,
      status: step.status,
      action: evidenceStepsByNumber.get(Number(step.number))?.action || step.action,
      data: evidenceStepsByNumber.get(Number(step.number))?.data || step.data,
      expected_result: evidenceStepsByNumber.get(Number(step.number))?.expected_result || args.expected || undefined,
      observations: step.observations,
      confidence: step.confidence ?? averageConfidence(step.history.map((item: any) => item.action?.confidence)),
      failure_category: step.failure_category,
      attempts: step.history.map((item: any) => ({
        ...compactHistoryItem(item),
      })),
      contract: step.contract,
      checkpoints: step.checkpoints,
    })),
    screenshots: {
      final_available: Boolean(args.finalScreenshotBase64),
      per_step: args.resultSteps.filter((step: any) => Boolean(step.screenshot_base64)).map((step) => step.number),
    },
  };
  return compactAiReportForDelivery(report);
}

export { AI_REPORT_DELIVERY_BUDGET_BYTES, buildAiReport, compactAiReportForDelivery };
export type { AgentTimelineEvent };
