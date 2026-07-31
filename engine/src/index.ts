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
import { buildAiReport } from './run-report-builder.ts';
import type { AgentTimelineEvent as ReportTimelineEvent } from './run-report-builder.ts';
import { createProgressChannel } from './progress-channel.ts';
import { finalizeFailedRun, finalizeSuccessfulRun } from './run-finalization.ts';
import { executeConfiguredWorkflow } from './workflow-executor.ts';

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

function safeExecutionError(error: unknown): string {
  return String(error instanceof Error ? error.message : error || "Error de ejecución")
    .replace(/(token|secret|password|api[-_]?key)=?[^\s,;]+/gi, "$1=[redacted]")
    .replace(/https?:\/\/[^\s]+/gi, "[redacted-url]")
    .slice(0, 800);
}

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

type AgentTimelineEvent = ReportTimelineEvent;

function buildBackendWsUrl(executionId: string, engineWsToken?: string, callbackToken?: string, callbackUrl?: string, progressWsUrl?: string, correlationId?: string): string {
  const wsBase = progressWsUrl || BACKEND_WS_URL || backendWsUrlFromPublicUrl(callbackUrl) || 'ws://localhost:8000/ws/engine-sync';
  if (progressWsUrl) {
    const token = engineWsToken || callbackToken || BACKEND_WS_TOKEN;
    const params = new URLSearchParams(progressWsUrl.split('?')[1] || '');
    if (token) params.set('callback_token', token);
    if (correlationId) params.set('correlation_id', correlationId);
    const base = progressWsUrl.split('?')[0];
    return `${base}${params.toString() ? `?${params.toString()}` : ''}`;
  }
  const base = `${wsBase}/${encodeURIComponent(executionId)}`;
  const token = engineWsToken || callbackToken || BACKEND_WS_TOKEN;
  const params = new URLSearchParams();
  if (token) params.set(engineWsToken ? 'engine_token' : 'callback_token', token);
  if (correlationId) params.set('correlation_id', correlationId);
  return `${base}${params.toString() ? `?${params.toString()}` : ''}`;
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
    correlationId?: string;
  } = {}
): Promise<EngineRunResult> {
  const startedAt = Date.now();
  const progress = createProgressChannel({
    testId,
    stepMap: step_map,
    io: options.io,
    wsUrl: buildBackendWsUrl(testId, options.engineWsToken, options.callbackToken, options.callbackUrl, options.progressWsUrl, options.correlationId),
    correlationId: options.correlationId,
  });
  const emit = progress.emit;
  const flushAndCloseBackendWs = progress.flushAndClose;

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

    const workflowExecution = await executeConfiguredWorkflow({ options, testId, task, expected, url, urlCandidate, manualSteps, qaSteps, ai, page, emit, emitAgent, navigateToResolvedBaseUrl, runQaSteps, runResult, normalizeEngineUrl, firstStepUrl, performFinalAudit, workflowTimeoutMs });
    runResult = workflowExecution.runResult;
    workflowTraces = workflowExecution.workflowTraces;

    return await finalizeSuccessfulRun({ runResult, qaSteps, report, emitAgent, emit, browser, opencode, testId, startedAt, ai, task, suite, expected, validation: (await performFinalAudit()).data, auditEvidence, visualAuditUsed, finalScreenshot, timeline, workflowTraces, options, maxSteps, workflowTimeoutMs, resultSteps, url, flushAndCloseBackendWs });
  } catch (error: any) {
    return await finalizeFailedRun({ error, safeExecutionError, emitAgent, emit, report, browser, opencode, testId, startedAt, task, suite, ai, resultSteps, timeline, options, maxSteps, workflowTimeoutMs, url, flushAndCloseBackendWs });
  }
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\\\/g, '/')}`) {
  const options = program.opts();
  runTask(options.task, options.url, parseInt(options.maxSteps), options.testId, options.suite, options.expected, options.guidance);
}
