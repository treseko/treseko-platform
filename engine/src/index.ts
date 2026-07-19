import { Command } from 'commander';
import dotenv from 'dotenv';
import { AIClient } from './ai/client.ts';
import { BrowserController } from './automation/browser.ts';
import { ReportGenerator } from './automation/report-generator.ts';
import { TraceLogger } from './automation/trace-logger.ts';
import { runQaSteps } from './automation/step-runner.ts';
import type { BackendStatus, QAEngineStep } from './automation/action-types.ts';
import { executeWorkflowGraph, type WorkflowDefinition, type WorkflowTrace } from './ai/workflow.ts';
import { runLlmAgent, runReporterAgent, runRuleAgent, runScriptAgent, runValidatorAgent, runWebhookAgent } from './ai/custom-agents.ts';
import { ENGINE_LOCAL_EVIDENCE_ENABLED, ENGINE_NAME, ENGINE_VERSION } from './runtime-config.ts';
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

function buildBackendWsUrl(executionId: string, engineWsToken?: string, callbackUrl?: string): string {
  const wsBase = backendWsUrlFromPublicUrl(callbackUrl) || BACKEND_WS_URL;
  const base = `${wsBase}/${encodeURIComponent(executionId)}`;
  const token = engineWsToken || BACKEND_WS_TOKEN;
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
  return {
    step_number: item.step_number,
    attempt: item.attempt,
    action: item.action,
    execution: item.execution,
    validation: item.validation,
    observation_before: item.observation_before,
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

function failureCategory(status: BackendStatus, errors: string[]): string | undefined {
  if (status === 'PASO') return undefined;
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
  runResult?: Awaited<ReturnType<typeof runQaSteps>>;
  resultSteps: EngineRunResult['steps'];
  errors: string[];
  startedAt: number;
  url?: string;
  finalScreenshotBase64?: string;
  timeline?: AgentTimelineEvent[];
  workflowTraces?: WorkflowTrace[];
  parameters?: Record<string, any>;
}): Record<string, any> {
  const stepConfidences = args.runResult?.steps.map((step) => step.confidence) || [];
  const confidence = averageConfidence([args.validation.confidence, ...stepConfidences]);
  const category = failureCategory(args.status, args.errors);
  const consensusSignals = {
    technical: args.errors.length === 0 ? 'PASO' : args.status,
    visual_audit: normalizeAuditStatus(args.validation.status),
    final: args.status,
  };
  const timeline = args.timeline || [];
  const metrics = sumMetricsFromTimeline(timeline);
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
    input_json: trace.input_json,
    output_json: trace.output_json,
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
    execution_id: args.testId,
    suite: args.suite,
    summary: args.validation.reason,
    status: args.status,
    duration_seconds: args.durationSeconds,
    confidence,
    consensus: args.status,
    consensus_signals: consensusSignals,
    failure_category: category,
    human_review_required: args.status !== 'PASO' || confidence < 70,
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
      avg_latency_ms: metrics.aiCalls ? Math.round(metrics.latencyMs / metrics.aiCalls) : 0,
    },
    timeline,
    workflow_traces: compactTraces,
    agent_conversation: workflowConversation.length
      ? workflowConversation
      : timeline.filter((item) => ['AI_AGENT', 'QA_GUARD', 'AUDITOR', 'RECOVERY', 'SENTINEL'].includes(item.agent)),
    initial_url: args.url,
    visited_urls: args.runResult?.visited_urls || [],
    errors: args.errors,
    final_result: args.validation.reason,
    steps: (args.runResult?.steps || []).map((step) => ({
      number: step.number,
      status: step.status,
      observations: step.observations,
      confidence: step.confidence ?? averageConfidence(step.history.map((item) => item.action?.confidence)),
      failure_category: step.failure_category,
      attempts: step.history.map((item) => ({
        ...compactHistoryItem(item),
      })),
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
    aiConfig?: { provider?: string; endpoint?: string; model?: string; apiKey?: string; temperature?: number; tokenCostPer1K?: number; promptTokenCostPer1K?: number; completionTokenCostPer1K?: number };
    steps?: QAEngineStep[];
    contextData?: Record<string, any>;
    agentWorkflow?: Array<Record<string, any>>;
    workflowDefinition?: WorkflowDefinition;
    timeoutSeconds?: number;
    caseId?: string;
    engineWsToken?: string;
    callbackUrl?: string;
  } = {}
): Promise<EngineRunResult> {
  const startedAt = Date.now();
  const ws = new WebSocket(buildBackendWsUrl(testId, options.engineWsToken, options.callbackUrl));
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
  const ai = new AIClient({ ...(options.aiConfig || {}), agentWorkflow: options.agentWorkflow });
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
    const qaSteps = (options.steps && options.steps.length > 0)
      ? options.steps
      : Array.from({ length: Math.max(1, maxSteps || 1) }, (_, index) => ({
          number: index + 1,
          action: index === 0 ? task : 'Continuar validacion',
          data: manualSteps,
          expected,
        }));
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

    if (options.workflowDefinition?.nodes?.length) {
      emitAgent('WORKFLOW', 'INFO', `Ejecutando workflow ${options.workflowDefinition.workflow?.name || options.workflowDefinition.workflow?.id}`);
      const workflowResult = await executeWorkflowGraph(
        options.workflowDefinition,
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
          },
        },
        {
          ContextResolver: async (node, input) => {
            const fallbackUrl = normalizeEngineUrl(input.sharedMemory.base_url)
              || normalizeEngineUrl(input.sharedMemory.base_url_candidate)
              || normalizeEngineUrl(input.context.url_candidate)
              || firstStepUrl(qaSteps);
            try {
              const output = await runLlmAgent(ai, node, {
                ...input,
                context: {
                  ...input.context,
                  resolver_role: 'Elegir la URL/base_url correcta para iniciar la prueba usando todos los datos disponibles. No ejecutes navegador; solo resuelve contexto.',
                  expected_shared_memory_patch: {
                    base_url: 'URL absoluta http/https elegida para iniciar la prueba',
                    reason: 'por que se eligio esa URL',
                    relevant_variables: 'variables o datos usados',
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
              expected,
              maxAttempts: 2,
              emit,
              logger: { log: emitAgent },
              agentWorkflow: options.agentWorkflow,
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
          Auditor: async () => ({
            status: 'SUCCESS',
            confidence: 90,
            reason: 'Auditoria final se ejecutara con el auditor existente',
            events: [],
          }),
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
                expected,
                maxAttempts: 2,
                emit,
                logger: { log: emitAgent },
                agentWorkflow: options.agentWorkflow,
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
        runResult = { steps: [], history: [], visited_urls: [], errors: workflowResult.lastOutput?.reason ? [workflowResult.lastOutput.reason] : ['Workflow finalizado sin ejecutar pasos'] };
      }
    } else {
      await navigateToResolvedBaseUrl(urlCandidate, 'fallback sin workflow');
      runResult = await runQaSteps(page, ai, qaSteps, {
        executionId: testId,
        task,
        expected,
        maxAttempts: 2,
        emit,
        logger: { log: emitAgent },
        agentWorkflow: options.agentWorkflow,
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
      resultSteps.push({
        number: step.number,
        status: step.status,
        observations: step.observations,
        error_log: step.error_log,
        screenshot_base64: step.screenshot_base64,
      });
    }

    emitAgent('SYSTEM', 'INFO', 'Pasos QA finalizados. Iniciando auditoria final.');
    const finalScreenshot = await page.screenshot();
    const historyText = runResult.history.map((item) => (
      `Paso ${item.step_number} intento ${item.attempt}: ${item.action?.action || '-'} -> ${item.execution?.ok ? 'OK' : 'ERROR'} ${item.execution?.message || ''}`
    ));
    const validation = runResult.errors.length
      ? {
          status: (runResult.steps.some((step) => step.status === 'FALLO') ? 'FAILED' : 'BLOCKED') as 'FAILED' | 'BLOCKED',
          reason: runResult.errors.join(' | '),
          confidence: 90,
        }
      : (await (async () => {
          const audit = await ai.validateGoal(task, historyText.join('\n') || 'Sin historial estructurado.', finalScreenshot.toString('base64'), historyText);
          emitAgent('AUDITOR', 'INFO', 'Auditoria final con modelo completada', {
            confidence: audit.data.confidence,
            reason: audit.data.reason,
            metrics: audit.metrics,
            prompt_excerpt: JSON.stringify(audit.prompt).slice(0, 2000),
            raw_response_excerpt: JSON.stringify(audit.rawResponse).slice(0, 2000),
          });
          return audit.data;
        })());

    emitAgent('AUDITOR', 'INFO', `Resultado: ${validation.status} (${validation.confidence}%)`, {
      confidence: validation.confidence,
      reason: validation.reason,
    });
    emitAgent('AUDITOR', 'INFO', `Razon: ${validation.reason}`, {
      confidence: validation.confidence,
      reason: validation.reason,
    });
    report.setFinalStatus(validation.status, validation.reason, validation.confidence);
    await browser.close();
    
    const reportPath = await report.generate();
    const localEvidenceLog = ENGINE_LOCAL_EVIDENCE_ENABLED
      ? `Reporte generado: ${reportPath}`
      : reportPath;
    emitAgent('SYSTEM', 'SUCCESS', `Test ${testId} finalizado.`);
    const durationSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    const finalStatus = normalizeAuditStatus(validation.status);
    const aiReport = buildAiReport({
      task,
      testId,
      suite,
      model: ai.model,
      status: finalStatus,
      durationSeconds,
      validation,
      runResult,
      resultSteps,
      errors: runResult.errors,
      startedAt,
      url,
      finalScreenshotBase64: finalScreenshot.toString('base64'),
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
      duration_seconds: durationSeconds,
      observations: validation.reason,
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
      observations: validation.reason,
      logs: localEvidenceLog,
      metadata: {
        engine: ENGINE_NAME,
        version: ENGINE_VERSION,
        local_evidence_enabled: ENGINE_LOCAL_EVIDENCE_ENABLED,
        model: ai.model,
        confidence: validation.confidence,
        audit_status: validation.status,
        structured_history: true,
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
      final_result: validation.reason,
      final_screenshot_base64: finalScreenshot.toString('base64'),
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
    const durationSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    const errorReport = buildAiReport({
      task,
      testId,
      suite,
      model: ai.model,
      status: 'FALLO',
      durationSeconds,
      validation: { status: 'FAILED', reason: error.message, confidence: 0 },
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
