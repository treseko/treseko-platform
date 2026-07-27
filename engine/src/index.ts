import { Command } from 'commander';
import dotenv from 'dotenv';
import { AIClient, type AIResult } from './ai/client.ts';
import { OpenCodeDriver } from './ai/opencode-driver.ts';
import { BrowserController } from './automation/browser.ts';
import { ReportGenerator } from './automation/report-generator.ts';
import { TraceLogger } from './automation/trace-logger.ts';
import { runQaSteps } from './automation/step-runner.ts';
import { interpretStepData } from './automation/context-data-interpreter.ts';
import { planExecutionValidation } from './automation/execution-validation-planner.ts';
import type { BackendStatus, QAEngineStep } from './automation/action-types.ts';
import { executeWorkflowGraph, type WorkflowDefinition, type WorkflowTrace } from './ai/workflow.ts';
import { compileBlockWorkflow } from './ai/block-workflow.ts';
import { validateWorkflowRuntime } from './ai/agent-registry.ts';
import { runLlmAgent, runReporterAgent, runRuleAgent, runScriptAgent, runValidatorAgent, runWebhookAgent } from './ai/custom-agents.ts';
import { ENGINE_LOCAL_EVIDENCE_ENABLED, ENGINE_NAME, ENGINE_VERSION } from './runtime-config.ts';
import {
  buildAuditEvidence,
  normalizeAuditDecision,
  resolveAuditConsensus,
  type AuditConsensus,
  type AuditDecision,
  type AuditEvidenceBundle,
} from './audit/consensus.ts';
import WebSocket from 'ws';

dotenv.config({ override: false });

function backendWsUrlFromPublicUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    parsed.pathname = '/ws/engine-sync';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

const BACKEND_WS_URL = process.env.BACKEND_WS_URL || backendWsUrlFromPublicUrl(process.env.BACKEND_PUBLIC_URL) || 'ws://localhost:8000/ws/engine-sync';
const BACKEND_WS_TOKEN = process.env.AI_ENGINE_CALLBACK_TOKEN || '';
const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>),;]+|\bwww\.[^\s"'<>),;]+/i;

const program = new Command();

program
  .option('-t, --task <task>', 'Task for the AI to perform')
  .option('-u, --url <url>', 'Initial URL')
  .option('-m, --max-steps <number>', 'Maximum number of steps', '10')
  .option('-i, --test-id <id>', 'Test Link ID', 'TL-000')
  .option('-s, --suite <suite>', 'Suite name', 'smoke-tests')
  .option('-e, --expected <text>', 'Expected overall result')
  .option('-g, --guidance <steps>', 'Manual steps/guidance to help the AI');

program.parse(process.argv);

type EngineRunResult = {
  status: BackendStatus;
  duration_seconds: number;
  observations?: string;
  logs?: string;
  error_message?: string;
  metadata: Record<string, any>;
  steps: Array<{
    number: number;
    status: BackendStatus;
    observations?: string;
    error_log?: string;
    screenshot_base64?: string;
    agent?: string;
    failure_category?: string;
    reason?: string;
    action_summary?: string;
    action_executed?: boolean;
    url?: string;
  }>;
  visited_urls?: string[];
  errors?: string[];
  final_result?: string;
  final_screenshot_base64?: string | undefined;
  ai_report?: Record<string, any>;
};

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

function normalizeAuditStatus(status: string | undefined): BackendStatus {
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

function buildBackendWsUrl(executionId: string, engineWsToken?: string, callbackToken?: string, callbackUrl?: string, progressWsUrl?: string): string {
  const wsBase = progressWsUrl || BACKEND_WS_URL || backendWsUrlFromPublicUrl(callbackUrl) || 'ws://localhost:8000/ws/engine-sync';
  if (progressWsUrl) {
    const token = engineWsToken || callbackToken || BACKEND_WS_TOKEN;
    if (!token || progressWsUrl.includes('callback_token=')) return progressWsUrl;
    const separator = progressWsUrl.includes('?') ? '&' : '?';
    return `${progressWsUrl}${separator}callback_token=${encodeURIComponent(token)}`;
  }
  const base = `${wsBase}/${encodeURIComponent(executionId)}`;
  const token = engineWsToken || callbackToken || BACKEND_WS_TOKEN;
  if (!token) return base;
  const separator = base.includes('?') ? '&' : '?';
  const paramName = engineWsToken ? 'engine_token' : 'callback_token';
  return `${base}${separator}${paramName}=${encodeURIComponent(token)}`;
}

function normalizeEngineUrl(value?: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(URL_PATTERN);
  const candidate = (match?.[0] || raw).trim().replace(/^["']|["']$/g, '');
  const withProtocol = /^www\./i.test(candidate) ? `https://${candidate}` : candidate;
  try {
    const parsed = new URL(withProtocol);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function firstStepUrl(steps?: QAEngineStep[]): string {
  for (const step of steps || []) {
    const source = `${step.data || ''}\n${step.action || ''}\n${step.expected || ''}`;
    const normalized = normalizeEngineUrl(source);
    if (normalized) return normalized;
  }
  return '';
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

function compactWorkflowTrace(trace: WorkflowTrace): Record<string, any> {
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

function failureCategory(status: BackendStatus, errors: string[], failedAssertions = 0): string | undefined {
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
  testId: string;
  suite: string;
  model: string;
  status: BackendStatus;
  durationSeconds: number;
  validation: { status: string; reason: string; confidence: number };
  auditDecision: AuditDecision;
  consensusDecision: AuditConsensus;
  auditEvidence: AuditEvidenceBundle;
  visualAuditUsed: boolean;
  runResult?: Awaited<ReturnType<typeof runQaSteps>>;
  resultSteps: EngineRunResult['steps'];
  errors: string[];
  startedAt: number;
  url?: string | undefined;
  finalScreenshotBase64?: string | undefined;
  timeline?: AgentTimelineEvent[];
  workflowTraces?: WorkflowTrace[];
  parameters?: Record<string, any>;
}): Record<string, any> {
  const stepConfidences = args.runResult?.steps.map((step) => step.confidence) || [];
  const confidence = averageConfidence([args.consensusDecision.confidence, ...stepConfidences]);
  const category = failureCategory(args.status, args.errors, args.auditEvidence.summary.failed_assertions);
  const deterministicDecision = args.auditEvidence.summary.failed_assertions > 0
    || (
      args.auditEvidence.steps.length > 0
      && args.auditEvidence.steps.every((step) => (
        step.technical_status === 'PASO'
        && step.attempts.some((attempt) => attempt.validation_conclusive && attempt.validation_ok)
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
  const contractSteps = args.runResult?.steps || [];
  const fullContracts = contractSteps.filter((step) => step.contract?.coverage === 'full').length;
  const partialContracts = contractSteps.filter((step) => step.contract?.coverage === 'partial').length;
  const semanticContracts = contractSteps.filter((step) => step.contract?.requires_semantic_audit).length;
  const totalAttempts = contractSteps.reduce((total, step) => total + step.history.length, 0);
  const workflowDefinition = (args.parameters || {}).workflow_definition || null;
  const workflowMeta = workflowDefinition?.workflow || null;
  const workflowNodes = (workflowDefinition?.nodes || []).map(compactWorkflowNode);
  const workflowEdges = (workflowDefinition?.edges || []).map((edge: any) => ({
    id: edge?.id,
    source_node_id: edge?.source_node_id,
    target_node_id: edge?.target_node_id,
    condition: edge?.condition,
  }));
  const compactTraces = (args.workflowTraces || []).map(compactWorkflowTrace);
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
  return {
    schema_version: 1,
    decision_contract_version: 3,
    execution_id: args.testId,
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
        completed_step_count: contractSteps.filter((step) => ['PASO', 'FALLO', 'BLOQUEADO'].includes(step.status)).length,
      },
    },
    timeline,
    workflow_traces: compactTraces,
    agent_conversation: workflowConversation.length
      ? workflowConversation
      : timeline.filter((item) => ['AI_AGENT', 'QA_GUARD', 'AUDITOR', 'RECOVERY', 'SENTINEL'].includes(item.agent)),
    initial_url: args.url,
    visited_urls: args.runResult?.visited_urls || [],
    errors: args.errors,
    final_result: args.consensusDecision.reason,
    steps: (args.runResult?.steps || []).map((step) => ({
      number: step.number,
      status: step.status,
      observations: step.observations,
      confidence: step.confidence ?? averageConfidence(step.history.map((item) => item.action?.confidence)),
      failure_category: step.failure_category,
      attempts: step.history.map((item) => ({
        ...compactHistoryItem(item),
      })),
      contract: step.contract,
      checkpoints: step.checkpoints,
    })),
    screenshots: {
      final_available: Boolean(args.finalScreenshotBase64),
      per_step: args.resultSteps.filter((step) => Boolean(step.screenshot_base64)).map((step) => step.number),
    },
  };
}

type RunReport = Pick<ReportGenerator,
  'setPreConditions' |
  'setPostConditions' |
  'setModel' |
  'setFinalStatus' |
  'addUsage' |
  'addStep' |
  'generate'
>;

function createRunReport(task: string, testId: string, suite: string, manualSteps?: string): RunReport {
  if (ENGINE_LOCAL_EVIDENCE_ENABLED) {
    return new ReportGenerator(task, testId, suite, manualSteps);
  }
  return {
    setPreConditions: () => undefined,
    setPostConditions: () => undefined,
    setModel: () => undefined,
    setFinalStatus: () => undefined,
    addUsage: () => undefined,
    addStep: () => undefined,
    generate: () => 'Evidencia local desactivada; resultado y capturas enviados al backend.',
  };
}

export async function runTask(
  task: string,
  url: string,
  maxSteps: number,
  testId: string,
  suite: string,
  expected?: string,
  manualSteps?: string,
  step_map: Record<string, string> = {},
  options: {
    headless?: boolean;
    viewport?: { width: number; height: number };
    io?: any;
    aiConfig?: { provider?: string; endpoint?: string; model?: string; apiKey?: string; temperature?: number; tokenCostPer1K?: number; promptTokenCostPer1K?: number; completionTokenCostPer1K?: number; visionEnabled?: boolean; maxRetries?: number; fallbacks?: Array<{ provider?: string; llm_endpoint?: string; endpoint?: string; model?: string; provider_api_key?: string; apiKey?: string; max_retries?: number }>; executionDriver?: 'treseko_engine' | 'opencode'; opencodeUrl?: string; opencodeUsername?: string; opencodePassword?: string; opencodeModel?: string; opencodeAgent?: string; opencodeTimeoutMs?: number };
    steps?: QAEngineStep[];
    contextData?: Record<string, any>;
    agentWorkflow?: Array<Record<string, any>>;
    workflowDefinition?: WorkflowDefinition;
    timeoutSeconds?: number;
    caseId?: string;
    engineWsToken?: string;
    callbackToken?: string;
    callbackUrl?: string;
    progressWsUrl?: string;
  } = {}
): Promise<EngineRunResult> {
  const startedAt = Date.now();
  const ws = new WebSocket(buildBackendWsUrl(testId, options.engineWsToken, options.callbackToken, options.callbackUrl, options.progressWsUrl));
  let backendWsReady = false;
  const pendingWsMessages: string[] = [];
  const backendWsEventType = (event: string): string => {
    if (event === 'step_result') return 'STEP_RESULT';
    if (event === 'agent_event') return 'AGENT_LOG';
    if (event === 'execution_finished') return 'EXECUTION_FINISHED';
    return 'STREAM_DOM_LOG';
  };
  ws.on('open', () => {
    backendWsReady = true;
    while (pendingWsMessages.length && ws.readyState === WebSocket.OPEN) {
      ws.send(pendingWsMessages.shift() as string);
    }
  });
  ws.on('error', (error) => {
    backendWsReady = false;
    console.warn(`[WS] Backend progress stream unavailable for ${testId}: ${(error as Error)?.message || error}`);
  });
  ws.on('close', () => {
    backendWsReady = false;
  });

  const emit = (event: string, data: any) => {
    try { options.io?.to(testId).emit(event, data); } catch (e) {}
    const snapshot_id = data.step ? step_map[data.step.toString()] : null;
    const message = JSON.stringify({
      type: backendWsEventType(event),
      ...data,
      snapshot_id,
      text: data.message || JSON.stringify(data)
    });
    if (backendWsReady && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(message);
        } catch (error) {
          backendWsReady = false;
          pendingWsMessages.push(message);
          console.warn(`[WS] Could not send progress for ${testId}: ${(error as Error)?.message || error}`);
        }
    } else {
      pendingWsMessages.push(message);
    }
  };

  const flushAndCloseBackendWs = async () => {
    if (ws.readyState !== WebSocket.OPEN) {
      try { ws.close(); } catch (_) {}
      return;
    }
    await new Promise<void>((resolve) => {
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };
      ws.once('close', finish);
      setTimeout(finish, 350);
      try {
        ws.close(1000, 'execution finished');
      } catch (_) {
        finish();
      }
    });
  };

  const browser = new BrowserController();
  const opencode = options.aiConfig?.executionDriver === 'opencode'
    ? new OpenCodeDriver({ baseUrl: options.aiConfig.opencodeUrl, username: options.aiConfig.opencodeUsername, password: options.aiConfig.opencodePassword, apiKey: options.aiConfig.apiKey, provider: options.aiConfig.provider, model: options.aiConfig.opencodeModel || options.aiConfig.model, agent: options.aiConfig.opencodeAgent, timeoutMs: options.aiConfig.opencodeTimeoutMs })
    : undefined;
  if (opencode) {
    const health = await opencode.ensureAvailable();
    if (health.status !== 'ok') throw new Error(`OPENCODE_UNAVAILABLE: ${health.detail || 'servidor local no disponible'}`);
    await opencode.startRun({ runId: testId, prompt: task, model: options.aiConfig?.opencodeModel, agent: options.aiConfig?.opencodeAgent });
  }
  const ai = new AIClient({
    ...(options.aiConfig || {}),
    ...(options.agentWorkflow ? { agentWorkflow: options.agentWorkflow } : {}),
    ...(opencode ? { agentDriver: opencode, agentRunId: testId } : {}),
  });
  const report = createRunReport(task, testId, suite, manualSteps);
  const logger = new TraceLogger(suite, testId, ai.model);
  const workflowTimeoutMs = Math.max(
    30,
    Math.min(7200, Number(options.timeoutSeconds || Math.max(30, Number(maxSteps || 10) * 60)))
  ) * 1000;
  const timeline: AgentTimelineEvent[] = [];
  const emitAgent = (agent: string, level: string, message: string, details: Record<string, any> = {}) => {
    const event: AgentTimelineEvent = {
      ts: new Date().toISOString(),
      level,
      agent,
      message,
      step: details.step,
      attempt: details.attempt,
      action: details.action,
      reason: details.reason || details.action?.reason,
      confidence: details.confidence ?? details.action?.confidence,
      metrics: details.metrics,
      prompt_excerpt: details.prompt_excerpt,
      raw_response_excerpt: details.raw_response_excerpt,
      validation: details.validation,
      execution: details.execution,
    };
    timeline.push(event);
    logger.log(agent, level, message);
    emit('agent_event', event);
  };
  const resultSteps: EngineRunResult['steps'] = [];
  if (expected) report.setPostConditions(`Resultado esperado: ${expected}`);

  emitAgent('SYSTEM', 'INFO', `Iniciando tarea: ${task}`, { step: 0 });

  try {
    const suppliedSteps: QAEngineStep[] = (options.steps && options.steps.length > 0)
      ? options.steps
      : Array.from({ length: Math.max(1, maxSteps || 1) }, (_, index) => ({
        number: index + 1,
        action: index === 0 ? task : 'Continuar validacion',
        ...(manualSteps ? { data: manualSteps } : {}),
        ...(expected ? { expected } : {}),
      }));
    // This agent works on the in-memory execution copy only. Case definitions,
    // imports and exports retain their three-field public format.
    const qaSteps = planExecutionValidation(suppliedSteps);
    for (const step of qaSteps) {
      const plan = step.validation_plan;
      if (!plan) continue;
      emitAgent('ANALISTA_PREVIO', plan.mode === 'dom' ? 'INFO' : 'WARN', `Plan de validacion del paso ${step.number}: ${plan.mode}`, {
        step: step.number,
        confidence: plan.confidence,
        reason: plan.reason,
        metrics: {
          source: plan.source,
          mode: plan.mode,
          assertions: plan.assertions.map((item) => item.type),
        },
      });
    }
    const urlCandidate = normalizeEngineUrl(url) || firstStepUrl(qaSteps);

    await browser.init(Boolean(options.headless), options.viewport);
    report.setModel(ai.model);
    const page = browser.getPage();
    let activeBaseUrl = '';
    const navigateToResolvedBaseUrl = async (candidate: unknown, source: string): Promise<string> => {
      const resolved = normalizeEngineUrl(candidate) || firstStepUrl(qaSteps);
      if (!resolved) {
        throw new Error('URL inicial invalida: el Context Resolver no devolvio una base_url ejecutable.');
      }
      if (activeBaseUrl === resolved && page.url() !== 'about:blank') return resolved;
      emitAgent('BROWSER', 'INFO', `Navegando a ${resolved} (${source})...`, { step: 0 });
      await page.goto(resolved, { waitUntil: 'networkidle' });
      activeBaseUrl = resolved;
      report.setPreConditions(`Navegador abierto en ${resolved} con carga inicial completa.`);
      emitAgent('BROWSER', 'INFO', 'Navegacion completada y pagina estable.', { step: 0 });
      return resolved;
    };

    let runResult: Awaited<ReturnType<typeof runQaSteps>> | undefined;
    let workflowTraces: WorkflowTrace[] = [];
    let finalScreenshot: Buffer | undefined;
    let auditResult: AIResult<AuditDecision> | undefined;
    let auditPromise: Promise<AIResult<AuditDecision>> | undefined;
    let auditEvidence: AuditEvidenceBundle | undefined;
    let visualAuditUsed = false;
    const performFinalAudit = async (): Promise<AIResult<AuditDecision>> => {
      if (auditResult) return auditResult;
      if (auditPromise) return auditPromise;
      auditPromise = (async () => {
        if (!runResult) throw new Error('La auditoria final no puede ejecutarse sin resultados de pasos.');

        finalScreenshot = await page.screenshot();
        const evidence = buildAuditEvidence(task, qaSteps, runResult.steps, runResult.errors);
        const evidenceBundle = evidence.bundle;
        auditEvidence = evidenceBundle;
        const finalScreenshotBase64 = finalScreenshot.toString('base64');
        if (!evidence.images.some((image) => image.base64 === finalScreenshotBase64)) {
          evidence.images.push({ evidence_ref: 'final-screenshot', base64: finalScreenshotBase64 });
        }

        // A conclusive technical failure already establishes the outcome.
        // Do not wait for a visual model to reinterpret it: that adds latency
        // and can leave a campaign blocked when the local model is unavailable.
        if (runResult.errors.length) {
          const status = runResult.steps.some((step) => step.status === 'FALLO') ? 'FAILED' : 'BLOCKED';
          auditResult = {
            data: normalizeAuditDecision({
              status,
              reason: runResult.errors.join(' | '),
              confidence: 90,
              evidence_refs: [],
              failed_expectations: runResult.errors,
              missing_evidence: [],
              contradictions: [],
            }),
            metrics: { latencyMs: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
            prompt: { deterministic: true, technical_errors: runResult.errors },
            rawResponse: { deterministic: true, status },
          };
          return auditResult;
        }

        const conclusivePassedAttempts = evidenceBundle.steps.flatMap((step) => (
          step.attempts.filter((attempt) => attempt.validation_conclusive && attempt.validation_ok)
        ));
        const deterministicPass = evidenceBundle.steps.length > 0
          && evidenceBundle.steps.every((step) => (
            step.technical_status === 'PASO'
            && step.attempts.some((attempt) => attempt.validation_conclusive && attempt.validation_ok)
          ))
          && evidenceBundle.summary.failed_assertions === 0;
        if (deterministicPass) {
          const evidenceRefs = conclusivePassedAttempts.map((attempt) => attempt.evidence_ref);
          auditResult = {
            data: normalizeAuditDecision({
              status: 'PASSED',
              reason: 'Todos los resultados esperados fueron comprobados mediante aserciones deterministas.',
              confidence: 100,
              evidence_refs: evidenceRefs,
              failed_expectations: [],
              missing_evidence: [],
              contradictions: [],
            }),
            metrics: { latencyMs: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
            prompt: { deterministic: true, evidence_refs: evidenceRefs },
            rawResponse: { deterministic: true, status: 'PASSED' },
          };
          emitAgent('AUDITOR', 'INFO', 'Auditoria determinista completada sin delegar hechos observables al LLM', {
            confidence: 100,
            evidence_refs: evidenceRefs,
          });
          return auditResult;
        }

        // A non-vision model cannot add a trustworthy visual verdict. When
        // every step completed successfully and the runtime recorded no
        // technical error, keep that verified execution as the final result
        // instead of manufacturing a BLOCKED audit solely for missing vision.
        const technicalPassWithoutVision = !ai.supportsVision
          && evidenceBundle.technical_status === 'PASO'
          && evidenceBundle.steps.length > 0
          && evidenceBundle.steps.every((step) => step.technical_status === 'PASO');
        if (technicalPassWithoutVision) {
          const evidenceRefs = evidenceBundle.steps.flatMap((step) => step.attempts.map((attempt) => attempt.evidence_ref));
          auditResult = {
            data: normalizeAuditDecision({
              status: 'PASSED',
              reason: 'Todos los pasos finalizaron correctamente con evidencia observable; no se requiere auditoria visual para este modelo.',
              confidence: 90,
              evidence_refs: evidenceRefs,
              failed_expectations: [],
              missing_evidence: [],
              contradictions: [],
            }),
            metrics: { latencyMs: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
            prompt: { deterministic: true, technical_pass_without_vision: true, evidence_refs: evidenceRefs },
            rawResponse: { deterministic: true, status: 'PASSED' },
          };
          emitAgent('AUDITOR', 'INFO', 'Auditoria tecnica completada sin vision: todos los pasos finalizaron correctamente.', {
            confidence: 90,
            evidence_refs: evidenceRefs,
          });
          return auditResult;
        }

        const historyText = runResult.history.map((item) => (
          `Paso ${item.step_number} intento ${item.attempt}: ${item.action?.action || '-'} -> ${item.execution?.ok ? 'OK' : 'ERROR'}; validacion=${item.post_validation?.reason || item.validation?.reason || 'sin registrar'}`
        ));
        const finalState = [
          `URL final: ${evidenceBundle.final_url || '-'}`,
          `Titulo final: ${evidenceBundle.final_title || '-'}`,
          `Pasos aprobados: ${evidenceBundle.summary.passed_steps}/${evidenceBundle.summary.total_steps}`,
          `Aserciones concluyentes: ${evidenceBundle.summary.conclusive_assertions}`,
        ].join('\n');
        visualAuditUsed = ai.supportsVision;
        const rawAudit = await ai.validateGoal(
          task,
          finalState,
          finalScreenshotBase64,
          historyText,
          evidenceBundle,
          evidence.images,
        );
        auditResult = { ...rawAudit, data: normalizeAuditDecision(rawAudit.data) };
        emitAgent('AUDITOR', 'INFO', 'Auditoria final con evidencia estructurada completada', {
          confidence: auditResult.data.confidence,
          reason: auditResult.data.reason,
          metrics: auditResult.metrics,
          prompt_excerpt: JSON.stringify(auditResult.prompt).slice(0, 2000),
          raw_response_excerpt: JSON.stringify(auditResult.rawResponse).slice(0, 2000),
        });
        return auditResult;
      })();
      try {
        return await auditPromise;
      } catch (error) {
        auditPromise = undefined;
        throw error;
      }
    };

    if (options.workflowDefinition?.nodes?.length) {
      const compiledWorkflow = compileBlockWorkflow(options.workflowDefinition);
      const runtimeErrors = validateWorkflowRuntime(compiledWorkflow);
      if (runtimeErrors.length) throw new Error(runtimeErrors.join(' | '));
      emitAgent('WORKFLOW', 'INFO', `Ejecutando workflow ${options.workflowDefinition.workflow?.name || options.workflowDefinition.workflow?.id}`);
      const workflowResult = await executeWorkflowGraph(
        compiledWorkflow,
        {
          executionId: testId,
          caseId: options.caseId || testId,
          context: {
            task,
            expected,
            received_url: url,
            url_candidate: urlCandidate,
            manualSteps,
            qaSteps,
            ...(options.contextData || {}),
          },
          sharedMemory: {
            base_url_candidate: urlCandidate,
            current_step: qaSteps[0]?.number ?? null,
            retry_count: {},
            resolved_context: qaSteps.map((step) => ({
              step_number: step.number,
              ...interpretStepData(step.data, options.contextData || {}),
            })),
          },
        },
        {
          ContextResolver: async (node, input) => {
            const fallbackUrl = normalizeEngineUrl(input.sharedMemory.base_url)
              || normalizeEngineUrl(input.sharedMemory.base_url_candidate)
              || normalizeEngineUrl(input.context.url_candidate)
              || firstStepUrl(qaSteps);
            const explicitStepUrl = firstStepUrl(qaSteps);
            if (explicitStepUrl && fallbackUrl === explicitStepUrl) {
              return {
                status: 'SUCCESS',
                confidence: 100,
                reason: 'URL resuelta desde los datos explicitos del caso de prueba',
                events: [],
                sharedMemoryPatch: {
                  base_url: explicitStepUrl,
                  total_steps: qaSteps.length,
                  workflow_node: node.name,
                  context_resolver_used: true,
                  context_resolver_deterministic: true,
                },
              };
            }
            if (!fallbackUrl) {
              return {
                status: 'BLOCKED',
                confidence: 100,
                reason: 'Falta una URL inicial ejecutable: agrega url o base_url en el ambiente, datos del caso o un paso.',
                events: [],
                sharedMemoryPatch: {
                  base_url: '',
                  total_steps: qaSteps.length,
                  workflow_node: node.name,
                  context_resolver_used: true,
                  context_resolver_blocked: true,
                  failure_category: 'missing_base_url',
                },
              };
            }
            try {
              const output = await runLlmAgent(ai, node, {
                ...input,
                context: {
                  ...input.context,
                  resolver_role: 'Resolver contexto de ejecución sin ejecutar el navegador. Elegir la URL/base_url únicamente desde ambiente, dataset, inventario, datos del caso o un paso explícito. Interpretar los datos libres de cada paso y devolver resolved_context con source, confidence, inputs y ambiguities. No inventar URLs, credenciales, selectores ni valores.',
                  expected_shared_memory_patch: {
                    base_url: 'URL absoluta http/https elegida para iniciar la prueba',
                    reason: 'por que se eligio esa URL',
                    relevant_variables: 'variables o datos usados',
                    resolved_context: 'interpretación estructurada de los datos por paso',
                    input_mapping: 'rol semántico, valor respaldado, origen y confianza',
                  },
                },
              });
              const decidedUrl = normalizeEngineUrl(output.sharedMemoryPatch?.base_url)
                || normalizeEngineUrl(output.decision?.base_url)
                || normalizeEngineUrl(output.decision?.url)
                || normalizeEngineUrl(output.decision?.target_url);
              return {
                ...output,
                status: output.status || 'SUCCESS',
                confidence: output.confidence ?? (decidedUrl ? 95 : 80),
                reason: output.reason || (decidedUrl ? 'Contexto resuelto por agente' : 'Contexto resuelto con fallback'),
                sharedMemoryPatch: {
                  ...(output.sharedMemoryPatch || {}),
                  base_url: decidedUrl || fallbackUrl,
                  total_steps: qaSteps.length,
                  workflow_node: node.name,
                  context_resolver_used: true,
                },
              };
            } catch (error: any) {
              return {
                status: fallbackUrl ? 'SUCCESS' : 'BLOCKED',
                confidence: fallbackUrl ? 70 : 100,
                reason: fallbackUrl
                  ? `Context Resolver no pudo consultar el LLM; se usa URL candidata: ${error?.message || error}`
                  : `Context Resolver no encontro URL ejecutable: ${error?.message || error}`,
                events: [],
                sharedMemoryPatch: {
                  base_url: fallbackUrl,
                  total_steps: qaSteps.length,
                  workflow_node: node.name,
                  context_resolver_used: true,
                  context_resolver_fallback: true,
                },
              };
            }
          },
          PreExecutionAnalyst: async (node) => ({
            status: 'SUCCESS',
            confidence: 96,
            reason: 'Contratos temporales de validacion preparados antes de ejecutar los pasos.',
            events: [],
            sharedMemoryPatch: {
              workflow_node: node.name,
              execution_validation_plans: qaSteps.map((step) => ({
                step_number: step.number,
                mode: step.validation_plan?.mode || 'visual_semantic',
                confidence: step.validation_plan?.confidence || 0,
              })),
              resolved_context: qaSteps.map((step) => ({
                step_number: step.number,
                ...interpretStepData(step.data, options.contextData || {}),
              })),
            },
          }),
          Observer: async (_node, input) => {
            if (input.sharedMemory.qa_run_complete) {
              return {
                status: 'BLOCKED',
                confidence: 100,
                reason: 'no_more_steps',
                events: [],
                sharedMemoryPatch: { current_step: null },
              };
            }
            return {
              status: 'SUCCESS',
              confidence: 95,
              reason: 'Observacion delegada al runner de pasos',
              events: [],
            };
          },
          Planner: async () => ({
            status: 'SUCCESS',
            confidence: 90,
            reason: 'Planificacion delegada al agente IA por paso',
            events: [],
          }),
          SecurityGuard: async () => ({
            status: 'SUCCESS',
            confidence: 90,
            reason: 'Guard activo dentro de cada accion del runner',
            events: [],
            decision: { approved: true },
          }),
          Executor: async (_node, input) => {
            await navigateToResolvedBaseUrl(input.sharedMemory.base_url, 'Context Resolver');
            runResult = await runQaSteps(page, ai, qaSteps, {
              executionId: testId,
              task,
              ...(expected ? { expected } : {}),
              maxAttempts: 2,
              contextData: options.contextData || {},
              emit,
              logger: { log: emitAgent },
              ...(options.agentWorkflow ? { agentWorkflow: options.agentWorkflow } : {}),
            });
            const ok = runResult.errors.length === 0;
            return {
              status: ok ? 'SUCCESS' : 'FAILED',
              confidence: ok ? 90 : 60,
              reason: ok ? 'Pasos ejecutados por el runner' : runResult.errors.join(' | '),
              events: [],
              sharedMemoryPatch: {
                qa_run_complete: true,
                visited_urls: runResult.visited_urls,
                detected_errors: runResult.errors,
                last_action: runResult.history.at(-1)?.action || null,
                current_step: null,
              },
            };
          },
          Validator: async (node, input) => {
            const errors = runResult?.errors || [];
            return {
              status: errors.length ? 'FAILED' : 'SUCCESS',
              confidence: errors.length ? 60 : 90,
              reason: errors.length ? errors.join(' | ') : 'Ejecucion validada sin errores detectados',
              events: [],
              sharedMemoryPatch: {
                workflow_node: node.name,
                detected_errors: errors,
              },
            };
          },
          Recovery: async (_node, input) => ({
            status: 'BLOCKED',
            confidence: 70,
            reason: (input.sharedMemory.detected_errors || []).join(' | ') || 'No hay estrategia de recuperacion automatica disponible',
            events: [],
          }),
          Auditor: async () => {
            const audit = await performFinalAudit();
            return {
              status: 'SUCCESS',
              confidence: audit.data.confidence,
              reason: audit.data.reason,
              decision: audit.data,
              events: [],
              sharedMemoryPatch: {
                audit_status: audit.data.status,
                audit_evidence_refs: audit.data.evidence_refs,
              },
            };
          },
          Reporter: async () => ({
            status: 'SUCCESS',
            confidence: 100,
            reason: 'Trazabilidad del workflow preparada',
            events: [],
          }),
          llm_agent: async (node, input) => runLlmAgent(ai, node, input),
          rule_agent: async (node, input) => runRuleAgent(node, input),
          browser_action_agent: async (_node, input) => {
            await navigateToResolvedBaseUrl(input.sharedMemory.base_url, 'Context Resolver');
            if (!runResult) {
              runResult = await runQaSteps(page, ai, qaSteps, {
                executionId: testId,
                task,
                ...(expected ? { expected } : {}),
              maxAttempts: 2,
              contextData: options.contextData || {},
              emit,
                logger: { log: emitAgent },
                ...(options.agentWorkflow ? { agentWorkflow: options.agentWorkflow } : {}),
              });
            }
            return {
              status: runResult.errors.length ? 'FAILED' : 'SUCCESS',
              confidence: runResult.errors.length ? 60 : 90,
              reason: runResult.errors.length ? runResult.errors.join(' | ') : 'Acciones browser ejecutadas',
              events: [],
              sharedMemoryPatch: {
                qa_run_complete: true,
                visited_urls: runResult.visited_urls,
                detected_errors: runResult.errors,
              },
            };
          },
          validator_agent: async (node, input) => runValidatorAgent(node, input),
          reporter_agent: async (node, input) => runReporterAgent(node, input),
          webhook_agent: async (node, input) => runWebhookAgent(node, input),
          script_agent: async (node, input) => runScriptAgent(node, input),
          human_approval_agent: async (node) => ({
            // A universal workflow cannot auto-approve. The backend can later
            // resume from an explicit approval record without executing code.
            status: 'BLOCKED', confidence: 100,
            reason: `Aprobacion humana pendiente para ${node.name}`,
            events: [{ type: 'human_approval_requested', node_id: node.id }],
          }),
          mcp_tool_agent: async (node) => ({
            // MCP stays disabled until an installed tool is explicitly
            // allowlisted. This is safer than treating it as an LLM request.
            status: 'BLOCKED', confidence: 100,
            reason: `La herramienta MCP de ${node.name} no esta autorizada en esta instalacion`,
            events: [{ type: 'mcp_tool_blocked', node_id: node.id }],
          }),
          a2a_disabled_agent: async (node) => ({
            status: 'BLOCKED', confidence: 100,
            reason: `A2A permanece deshabilitado para ${node.name} hasta configurar identidad y confianza remota`,
            events: [{ type: 'a2a_disabled', node_id: node.id }],
          }),
          default: async (node) => ({
            status: node.enabled === false ? 'SKIPPED' : 'SUCCESS',
            confidence: 80,
            reason: `Nodo generico ${node.type} procesado`,
            events: [],
          }),
        },
        {
          timeoutMs: workflowTimeoutMs,
          emitTrace: (trace) => {
            workflowTraces.push(trace);
            const traceReason = String(trace.output_json?.reason || '');
            const isNoMoreSteps = trace.node_type === 'Observer' && trace.status === 'BLOCKED' && traceReason === 'no_more_steps';
            emitAgent(trace.node_type || 'WORKFLOW', trace.status === 'FAILED' ? 'ERROR' : isNoMoreSteps ? 'INFO' : trace.status === 'BLOCKED' ? 'WARN' : 'INFO', `${trace.node_name}: ${isNoMoreSteps ? 'sin mas pasos' : trace.status}`, {
              metrics: trace.metrics_json,
              reason: traceReason,
            });
          },
        },
      );
      workflowTraces = workflowResult.traces;
      if (!runResult) {
        runResult = { steps: [], history: [], visited_urls: [], checkpoints: [], errors: workflowResult.lastOutput?.reason ? [workflowResult.lastOutput.reason] : ['Workflow finalizado sin ejecutar pasos'] };
      }
    } else {
      await navigateToResolvedBaseUrl(urlCandidate, 'fallback sin workflow');
      runResult = await runQaSteps(page, ai, qaSteps, {
        executionId: testId,
        task,
        ...(expected ? { expected } : {}),
              maxAttempts: 2,
              contextData: options.contextData || {},
              emit,
        logger: { log: emitAgent },
        ...(options.agentWorkflow ? { agentWorkflow: options.agentWorkflow } : {}),
      });
    }

    for (const step of runResult.steps) {
      const last = step.history[step.history.length - 1];
      if (last?.metrics) report.addUsage(last.metrics);
      report.addStep(
        step.number,
        last ? JSON.stringify(last.action) : 'Sin accion',
        qaSteps.find((item) => item.number === step.number)?.expected || expected || 'Validar resultado esperado',
        step.observations || '',
        step.status === 'PASO' ? 'PASSED' : 'FAILED',
        step.screenshot_base64 || '',
        step.error_log || step.observations || ''
      );
      const persistedStep: EngineRunResult['steps'][number] = {
        number: step.number,
        status: step.status,
      };
      if (step.observations) persistedStep.observations = step.observations;
      if (step.error_log) persistedStep.error_log = step.error_log;
      if (step.screenshot_base64) persistedStep.screenshot_base64 = step.screenshot_base64;
      if (step.agent) persistedStep.agent = step.agent;
      if (step.failure_category) persistedStep.failure_category = step.failure_category;
      if (step.reason) persistedStep.reason = step.reason;
      if (step.action_summary) persistedStep.action_summary = step.action_summary;
      if (typeof step.action_executed === 'boolean') persistedStep.action_executed = step.action_executed;
      if (step.url) persistedStep.url = step.url;
      resultSteps.push(persistedStep);
    }

    emitAgent('SYSTEM', 'INFO', 'Pasos QA finalizados. Iniciando auditoria final.');
    const completedAudit = await performFinalAudit();
    const validation = completedAudit.data;
    const consensusDecision = resolveAuditConsensus(auditEvidence as AuditEvidenceBundle, validation);

    if (visualAuditUsed) {
      emitAgent('AUDITOR', 'INFO', `Auditoria visual aplicada sobre ${validation.evidence_refs.length} captura(s) citada(s).`, {
        confidence: validation.confidence,
        reason: validation.reason,
        visual_audit: true,
        evidence_refs: validation.evidence_refs,
      });
    } else {
      emitAgent('AUDITOR', 'INFO', 'Auditoria visual no aplicada: se uso validacion determinista o el modelo no soporta vision.', {
        visual_audit: false,
      });
    }

    emitAgent('AUDITOR', consensusDecision.human_review_required ? 'WARN' : 'INFO', `Resultado visual: ${validation.status}; resultado final: ${consensusDecision.final_status}`, {
      confidence: consensusDecision.confidence,
      reason: consensusDecision.reason,
      validation,
    });
    emitAgent('AUDITOR', 'INFO', `Resolucion de consenso: ${consensusDecision.resolution}`, {
      confidence: consensusDecision.confidence,
      reason: consensusDecision.reason,
    });
    report.setFinalStatus(consensusDecision.final_status, consensusDecision.reason, consensusDecision.confidence);
    await browser.close();
    await opencode?.closeRun(testId);
    
    const reportPath = await report.generate();
    const localEvidenceLog = ENGINE_LOCAL_EVIDENCE_ENABLED
      ? `Reporte generado: ${reportPath}`
      : reportPath;
    emitAgent('SYSTEM', 'SUCCESS', `Test ${testId} finalizado.`);
    const durationSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    const finalStatus = consensusDecision.final_status;
    const aiReport = buildAiReport({
      task,
      testId,
      suite,
      model: ai.model,
      status: finalStatus,
      durationSeconds,
      validation,
      auditDecision: validation,
      consensusDecision,
      auditEvidence: auditEvidence as AuditEvidenceBundle,
      visualAuditUsed,
      runResult,
      resultSteps,
      errors: runResult.errors,
      startedAt,
      url,
      finalScreenshotBase64: finalScreenshot?.toString('base64'),
      timeline,
      workflowTraces,
      parameters: {
        maxSteps,
        timeout_seconds: Math.round(workflowTimeoutMs / 1000),
        headless: Boolean(options.headless),
        viewport: options.viewport,
        llm_endpoint: options.aiConfig?.endpoint,
        provider: options.aiConfig?.provider,
        model: ai.model,
        temperature: options.aiConfig?.temperature,
        step_count: qaSteps.length,
        agent_workflow: options.agentWorkflow || [],
        workflow_definition: options.workflowDefinition || null,
        context: options.contextData || {},
      },
    });
    emit('execution_finished', {
      status: finalStatus,
      report_pending: true,
      duration_seconds: durationSeconds,
      observations: consensusDecision.reason,
      confidence: aiReport.confidence,
      consensus: aiReport.consensus,
      failure_category: aiReport.failure_category,
      human_review_required: aiReport.human_review_required,
      model: ai.model,
      message: `Ejecucion finalizada: ${finalStatus}`,
      ai_report_summary: {
        confidence: aiReport.confidence,
        consensus: aiReport.consensus,
        failure_category: aiReport.failure_category,
        human_review_required: aiReport.human_review_required,
      },
    });
    await flushAndCloseBackendWs();
    return {
      status: finalStatus,
      duration_seconds: durationSeconds,
      observations: consensusDecision.reason,
      logs: localEvidenceLog,
      metadata: {
        engine: ENGINE_NAME,
        version: ENGINE_VERSION,
        local_evidence_enabled: ENGINE_LOCAL_EVIDENCE_ENABLED,
        model: ai.model,
        confidence: consensusDecision.confidence,
        audit_status: validation.status,
        structured_history: true,
        report_complete: true,
        ai_report_summary: {
          confidence: aiReport.confidence,
          consensus: aiReport.consensus,
          failure_category: aiReport.failure_category,
          human_review_required: aiReport.human_review_required,
        },
      },
      ai_report: aiReport,
      steps: resultSteps,
      visited_urls: runResult.visited_urls,
      errors: runResult.errors,
      final_result: consensusDecision.reason,
      final_screenshot_base64: finalScreenshot?.toString('base64'),
    };

  } catch (error: any) {
    emitAgent('SYSTEM', 'ERROR', `Error en ${testId}: ${error.message}`);
    emit('status', { agent: 'SYSTEM', level: 'ERROR', message: `Error critico: ${error.message}` });
    report.setFinalStatus('FAILED', error.message, 0);
    let finalScreenshot: string | undefined;
    try {
      const page = browser.getPage();
      finalScreenshot = page.isClosed() ? undefined : (await page.screenshot()).toString('base64');
    } catch (_) {}
    await browser.close();
    await opencode?.closeRun(testId);
    const durationSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    const catchAuditDecision = normalizeAuditDecision({
      status: 'FAILED',
      reason: error.message,
      confidence: 0,
      evidence_refs: [],
      failed_expectations: [error.message],
      missing_evidence: [],
      contradictions: [],
    });
    const catchEvidence: AuditEvidenceBundle = {
      schema_version: 1,
      objective: task,
      technical_status: 'FALLO',
      technical_errors: [error.message],
      final_url: '',
      final_title: '',
      steps: [],
      summary: {
        total_steps: 0,
        passed_steps: 0,
        failed_steps: 1,
        conclusive_assertions: 0,
        failed_assertions: 0,
        screenshot_count: finalScreenshot ? 1 : 0,
        full_contract_steps: 0,
        partial_contract_steps: 0,
        semantic_audit_steps: 0,
      },
    };
    const catchConsensus = resolveAuditConsensus(catchEvidence, catchAuditDecision);
    const errorReport = buildAiReport({
      task,
      testId,
      suite,
      model: ai.model,
      status: 'FALLO',
      durationSeconds,
      validation: catchAuditDecision,
      auditDecision: catchAuditDecision,
      consensusDecision: catchConsensus,
      auditEvidence: catchEvidence,
      visualAuditUsed: false,
      resultSteps,
      errors: [error.message],
      startedAt,
      url,
      finalScreenshotBase64: finalScreenshot,
      timeline,
      workflowTraces: [],
      parameters: {
        maxSteps,
        timeout_seconds: Math.round(workflowTimeoutMs / 1000),
        headless: Boolean(options.headless),
        viewport: options.viewport,
        llm_endpoint: options.aiConfig?.endpoint,
        provider: options.aiConfig?.provider,
        model: ai.model,
        temperature: options.aiConfig?.temperature,
        agent_workflow: options.agentWorkflow || [],
        workflow_definition: options.workflowDefinition || null,
        context: options.contextData || {},
      },
    });
    emit('execution_finished', {
      status: 'FALLO',
      report_pending: true,
      duration_seconds: durationSeconds,
      observations: error.message,
      error_message: error.message,
      confidence: errorReport.confidence,
      consensus: errorReport.consensus,
      failure_category: errorReport.failure_category,
      human_review_required: true,
      model: ai.model,
      message: 'Ejecucion finalizada con error',
      ai_report_summary: {
        confidence: errorReport.confidence,
        consensus: errorReport.consensus,
        failure_category: errorReport.failure_category,
        human_review_required: errorReport.human_review_required,
      },
    });
    await flushAndCloseBackendWs();
    return {
      status: 'FALLO',
      duration_seconds: durationSeconds,
      observations: error.message,
      error_message: error.message,
      logs: error.stack,
      metadata: {
        engine: ENGINE_NAME,
        version: ENGINE_VERSION,
        local_evidence_enabled: ENGINE_LOCAL_EVIDENCE_ENABLED,
        model: ai.model,
        report_complete: true,
        ai_report_summary: {
          confidence: errorReport.confidence,
          consensus: errorReport.consensus,
          failure_category: errorReport.failure_category,
          human_review_required: errorReport.human_review_required,
        },
      },
      ai_report: errorReport,
      steps: resultSteps,
      final_screenshot_base64: finalScreenshot,
    };
  }
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\\\/g, '/')}`) {
  const options = program.opts();
  runTask(options.task, options.url, parseInt(options.maxSteps), options.testId, options.suite, options.expected, options.guidance);
}
