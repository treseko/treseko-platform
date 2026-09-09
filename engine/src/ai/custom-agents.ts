import vm from 'node:vm';
import net from 'node:net';
import type { AIClient } from './client.ts';
import type { AgentInput, AgentOutput, WorkflowNode } from './workflow.ts';

function normalizeOutput(raw: any, fallbackReason: string): AgentOutput {
  const status = String(raw?.status || 'SUCCESS').toUpperCase();
  return {
    status: ['SUCCESS', 'FAILED', 'BLOCKED', 'SKIPPED'].includes(status) ? status as AgentOutput['status'] : 'SUCCESS',
    decision: raw?.decision,
    confidence: Number(raw?.confidence ?? 80),
    reason: raw?.reason || fallbackReason,
    events: Array.isArray(raw?.events) ? raw.events : [],
    sharedMemoryPatch: raw?.sharedMemoryPatch && typeof raw.sharedMemoryPatch === 'object' ? raw.sharedMemoryPatch : undefined,
    next: raw?.next ?? null,
  };
}

function runtimeAdapterFor(node: WorkflowNode): string {
  return String(
    node.config_json?.runtime_adapter
    ?? node.universal_agent?.contract?.implementation?.native_adapter
    ?? '',
  ).trim();
}

function configuredSteps(input: AgentInput): any[] {
  if (Array.isArray(input.context?.qaSteps)) return input.context.qaSteps;
  if (Array.isArray(input.context?.manualSteps)) return input.context.manualSteps;
  return [];
}

function currentPlannerStep(input: AgentInput): any | undefined {
  const steps = configuredSteps(input);
  const current = Number(input.sharedMemory?.current_step ?? steps[0]?.number ?? steps[0]?.numero_paso);
  return steps.find((step: any) => Number(step?.number ?? step?.numero_paso) === current);
}

function plannerInputForCurrentStep(input: AgentInput): AgentInput {
  const step = currentPlannerStep(input);
  if (!step) return input;
  const number = Number(step.number ?? step.numero_paso);
  const action = step.action ?? step.accion ?? '';
  const expected = step.expected ?? step.expected_result ?? step.resultado_esperado ?? '';
  return {
    ...input,
    step,
    context: {
      ...input.context,
      task: `Ejecuta solamente el paso ${number}: ${String(action)}`,
      expected,
      qaSteps: [step],
      manualSteps: [step],
      current_step_contract: {
        number,
        action,
        data: step.data ?? step.datos ?? '',
        expected,
        constraint: 'Propone una sola accion para este paso. No uses selectores, URLs ni datos de otros pasos.',
      },
      total_case_steps: configuredSteps(input).length,
    },
  };
}

type ExplicitStepKey = 'selector' | 'url' | 'value' | 'option_value';

function explicitStepValue(step: any, key: ExplicitStepKey): string | undefined {
  const data = step?.data ?? step?.datos;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const value = data[key];
    return value === undefined || value === null ? undefined : String(value).trim();
  }
  const match = String(data ?? '').match(new RegExp(`(?:^|[,;\\n])\\s*${key}\\s*=\\s*([^,;\\n]+)`, 'i'));
  return match?.[1]?.trim();
}

function normalizePlannerActionType(rawType: string): string {
  const type = rawType.trim().toLowerCase();
  if (['get_url', 'open_url', 'navigate_url', 'navigate_to', 'go_to', 'goto_url'].includes(type)) return 'navigate';
  if (['type_text', 'input_text', 'enter_text', 'set_value', 'write', 'write_text'].includes(type)) return 'fill';
  if (['select_option', 'choose_option', 'pick_option'].includes(type)) return 'select';
  if (['tap', 'press_button', 'click_button'].includes(type)) return 'click';
  return type;
}

function applyExplicitStepContract(action: Record<string, any>, step: any): Record<string, any> {
  const selector = explicitStepValue(step, 'selector');
  const url = explicitStepValue(step, 'url');
  const value = explicitStepValue(step, 'value');
  const optionValue = explicitStepValue(step, 'option_value');
  const stepAction = String(step?.action ?? step?.accion ?? '').toLowerCase();
  let type = normalizePlannerActionType(String(action.type ?? ''));

  // Structured case data is the executable contract. The LLM may explain or
  // classify the action, but it must not replace an explicit URL/selector with
  // a target guessed from another part of the case.
  if (/^(?:comprobar|verificar|validar|confirmar|revisar|observar)\b/i.test(stepAction)) type = 'no_op';
  else if (url && !selector) type = 'navigate';
  else if (selector && optionValue !== undefined) type = 'select';
  else if (selector && value !== undefined) type = 'fill';
  else if (selector && /(?:abrir|hacer clic|presionar|agregar|quitar|volver|iniciar|continuar|finalizar|intentar)/i.test(stepAction)) type = 'click';

  return {
    ...action,
    type,
    ...(selector ? { selector } : {}),
    ...(url && type === 'navigate' ? { url } : {}),
    ...(value !== undefined ? { value } : {}),
    ...(optionValue !== undefined ? { value: optionValue, option: optionValue } : {}),
  };
}

export function deterministicPlannerAction(step: any): Record<string, any> | undefined {
  const selector = explicitStepValue(step, 'selector');
  const url = explicitStepValue(step, 'url');
  const value = explicitStepValue(step, 'value');
  const optionValue = explicitStepValue(step, 'option_value');
  const actionText = String(step?.action ?? step?.accion ?? '').trim();
  const normalizedAction = actionText.toLowerCase();
  const stepNumber = Number(step?.number ?? step?.numero_paso);
  const expected = step?.expected ?? step?.expected_result ?? step?.resultado_esperado;
  const base = {
    step_number: Number.isFinite(stepNumber) ? stepNumber : undefined,
    reason: 'Accion resuelta desde el contrato estructurado del paso.',
    ...(expected ? { expected: String(expected) } : {}),
  };

  if (/^(?:comprobar|verificar|validar|confirmar|revisar|observar)\b/i.test(normalizedAction) && selector) {
    return { ...base, type: 'no_op', selector };
  }
  if (url && !selector) return { ...base, type: 'navigate', url };
  if (selector && optionValue !== undefined) {
    return { ...base, type: 'select', selector, value: optionValue, option: optionValue };
  }
  if (selector && value !== undefined) return { ...base, type: 'fill', selector, value };
  if (selector && /(?:abrir|hacer clic|clic|click|presionar|pulsar|agregar|quitar|volver|iniciar|continuar|finalizar|intentar|enviar)/i.test(normalizedAction)) {
    return { ...base, type: 'click', selector };
  }
  return undefined;
}

function plannerActionMatchesStep(action: Record<string, any>, step: any): boolean {
  const expectedSelector = explicitStepValue(step, 'selector');
  const actualSelector = action.selector === undefined ? undefined : String(action.selector).trim();
  if (expectedSelector && expectedSelector !== actualSelector) return false;
  const expectedUrl = explicitStepValue(step, 'url');
  const actualUrl = action.url === undefined ? undefined : String(action.url).trim();
  if (expectedUrl && (!actualUrl || action.type !== 'navigate')) return false;
  if (expectedUrl && actualUrl) {
    try {
      if (new URL(expectedUrl).toString() !== new URL(actualUrl).toString()) return false;
    } catch {
      if (expectedUrl !== actualUrl) return false;
    }
  }
  return true;
}

function canonicalPlannerAction(raw: any, currentStep?: number, allowV3Envelopes = false): Record<string, any> | undefined {
  const source = raw?.decision && typeof raw.decision === 'object' ? raw.decision : raw;
  if (!source || typeof source !== 'object') return undefined;
  // The V3 planner must tolerate provider-specific JSON envelopes while
  // keeping the legacy planner extraction unchanged. LM Studio-compatible
  // models have returned the action under `outputs`, `output`, `result`, or
  // `data` even when the prompt asks for the universal AgentOutput shape.
  const v3Candidates = allowV3Envelopes
    ? [
      source.outputs?.proposed_action,
      source.outputs?.planned_action,
      source.outputs?.action,
      source.output?.proposed_action,
      source.output?.planned_action,
      source.output?.action,
      source.result?.proposed_action,
      source.result?.planned_action,
      source.result?.action,
      raw?.data?.proposed_action,
      raw?.data?.planned_action,
      raw?.data?.action,
      raw?.data?.outputs?.action,
      raw?.action,
      raw?.output?.action,
    ]
    : [];
  const nested = source.proposed_action
    ?? source.planned_action
    ?? (allowV3Envelopes && source.action && typeof source.action === 'object' && !Array.isArray(source.action) ? source.action : undefined)
    ?? v3Candidates.find((candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate));
  const nestedAction = nested && typeof nested === 'object' && !Array.isArray(nested) ? nested : {};
  const rawType = String(
    nestedAction.type ?? nestedAction.action ?? source.action ?? source.action_type ?? source.type ?? '',
  ).trim().toLowerCase();
  if (!rawType) return undefined;
  const targetRef = nestedAction.target_ref ?? nestedAction.targetRef ?? source.target_ref ?? source.targetRef;
  const explicitUrl = nestedAction.url ?? nestedAction.href ?? source.url ?? source.href ?? source.target_url ?? source.targetUrl;
  const candidateUrl = explicitUrl ?? (typeof targetRef === 'string' && /^https?:\/\//i.test(targetRef) ? targetRef : undefined);
  const method = String(nestedAction.method ?? source.method ?? 'GET').toUpperCase();
  const navigationAlias = ['get_url', 'open_url', 'navigate_url', 'navigate_to'].includes(rawType)
    || (rawType === 'http.request' && method === 'GET' && candidateUrl);
  const type = normalizePlannerActionType(navigationAlias ? 'navigate' : rawType);

  return {
    ...nestedAction,
    type,
    ...(targetRef !== undefined ? { target_ref: targetRef } : {}),
    ...(nestedAction.selector !== undefined || source.selector !== undefined ? { selector: nestedAction.selector ?? source.selector } : {}),
    ...(candidateUrl !== undefined && (type === 'navigate' || type === 'goto') ? { url: candidateUrl } : {}),
    ...(nestedAction.value !== undefined || source.value !== undefined ? { value: nestedAction.value ?? source.value } : {}),
    ...(source.reason !== undefined ? { reason: source.reason } : {}),
    ...(source.expected !== undefined ? { expected: source.expected } : {}),
    ...(Number.isFinite(currentStep) ? { step_number: currentStep } : source.step_number !== undefined ? { step_number: source.step_number } : {}),
  };
}

function valueAtPath(source: any, path: string): any {
  return String(path || '').split('.').filter(Boolean).reduce((acc, key) => acc?.[key], source);
}

function compareValue(actual: any, op: string, expected: any): boolean {
  if (op === 'exists') return actual !== undefined && actual !== null;
  if (op === 'not_exists') return actual === undefined || actual === null;
  if (op === 'eq') return actual === expected;
  if (op === 'neq') return actual !== expected;
  if (op === 'gt') return Number(actual) > Number(expected);
  if (op === 'gte') return Number(actual) >= Number(expected);
  if (op === 'lt') return Number(actual) < Number(expected);
  if (op === 'lte') return Number(actual) <= Number(expected);
  if (op === 'includes') return String(actual ?? '').includes(String(expected ?? ''));
  return false;
}

export async function runLlmAgent(ai: AIClient, node: WorkflowNode, input: AgentInput): Promise<AgentOutput> {
  const config = node.config_json || {};
  const isPlanner = runtimeAdapterFor(node) === 'qa-action-planner/v2';
  const plannerStep = isPlanner ? currentPlannerStep(input) : undefined;
  if (isPlanner && !plannerStep) {
    return { status: 'BLOCKED', reason: 'No se encontro el contrato del paso actual', confidence: 100, events: [] };
  }
  const structuredPlannerEnabled = config.planner_strategy !== 'llm_only'
    && config.prefer_structured_step_contract !== false;
  const structuredAction = isPlanner && plannerStep && structuredPlannerEnabled
    ? deterministicPlannerAction(plannerStep)
    : undefined;
  if (structuredAction) {
    return normalizeOutput({
      status: 'SUCCESS',
      confidence: 100,
      reason: `Paso ${structuredAction.step_number} planificado desde su contrato estructurado`,
      decision: {
        proposed_action: structuredAction,
        metrics: {
          implementation: 'structured-step-contract',
          llm_calls: 0,
        },
      },
      sharedMemoryPatch: { planned_action: structuredAction },
      events: [{
        type: 'planner_structured_contract',
        step_number: structuredAction.step_number,
        action_type: structuredAction.type,
      }],
    }, 'Paso planificado desde su contrato estructurado');
  }
  const agentInput = isPlanner ? plannerInputForCurrentStep(input) : input;
  const isUniversalV3 = String(input.context?.workflow_format || '').toLowerCase() === 'universal_v3'
    || config.workflow_contract_version === 'treseko.workflow/v3';
  const result = await ai.runWorkflowAgent({
    nodeName: node.name,
    promptTemplate: node.prompt_template || '',
    input: agentInput,
    outputSchema: config.output_schema || config.outputSchema || {},
    temperature: node.temperature_override ?? undefined,
    ...(isUniversalV3 ? { responseFormat: 'text' as const } : {}),
  });
  const currentStepNumber = Number(plannerStep?.number ?? plannerStep?.numero_paso);
  const canonicalAction = isPlanner
    ? canonicalPlannerAction(
      result.data,
      currentStepNumber,
      isUniversalV3,
    )
    : undefined;
  const plannerAction = canonicalAction && plannerStep
    ? applyExplicitStepContract(canonicalAction, plannerStep)
    : isUniversalV3 && plannerStep
      ? deterministicPlannerAction(plannerStep)
      : canonicalAction;
  if (plannerAction && plannerStep && !plannerActionMatchesStep(plannerAction, plannerStep)) {
    return normalizeOutput({
      status: 'BLOCKED',
      confidence: 100,
      reason: `La accion propuesta no corresponde al paso ${currentStepNumber}`,
      decision: { reason_code: 'PLANNER_ACTION_OUTSIDE_CURRENT_STEP', rejected_action: plannerAction },
      sharedMemoryPatch: {
        detected_errors: [`Planner propuso datos ajenos al paso ${currentStepNumber}`],
      },
    }, 'Accion del Planner rechazada');
  }
  return normalizeOutput({
    ...result.data,
    decision: {
      ...(result.data?.decision || {}),
      ...(plannerAction ? { proposed_action: plannerAction } : {}),
      metrics: {
        ...result.metrics,
        ...(plannerAction && !canonicalAction ? { implementation: 'v3-structured-step-fallback' } : {}),
      },
    },
    sharedMemoryPatch: {
      ...(result.data?.sharedMemoryPatch || {}),
      ...(plannerAction ? { planned_action: plannerAction } : {}),
    },
  }, `Agente LLM ${node.name} ejecutado`);
}

export async function runRuleAgent(node: WorkflowNode, input: AgentInput): Promise<AgentOutput> {
  const rules = Array.isArray(node.config_json?.rules) ? node.config_json?.rules : [];
  const source = { input, context: input.context, sharedMemory: input.sharedMemory };
  for (const rule of rules) {
    const actual = valueAtPath(source, rule.path || '');
    if (compareValue(actual, String(rule.op || 'eq'), rule.value)) {
      return normalizeOutput({
        status: rule.status || 'SUCCESS',
        reason: rule.reason || `Regla ${rule.path} ${rule.op} cumplida`,
        confidence: rule.confidence ?? 90,
        decision: rule.outputPort || rule.output_port || rule.route
          ? { route: { outputPort: rule.outputPort || rule.output_port || rule.route } }
          : undefined,
        sharedMemoryPatch: rule.sharedMemoryPatch,
      }, 'Regla cumplida');
    }
  }
  return { status: 'SUCCESS', reason: 'Sin reglas bloqueantes', confidence: 80, events: [] };
}

export async function runValidatorAgent(node: WorkflowNode, input: AgentInput): Promise<AgentOutput> {
  const minConfidence = Number(node.config_json?.min_confidence ?? 0);
  const confidence = Number(input.sharedMemory.confidence || input.sharedMemory.last_confidence || 90);
  const errors = Array.isArray(input.sharedMemory.detected_errors) ? input.sharedMemory.detected_errors : [];
  if (errors.length) return { status: 'FAILED', reason: errors.join(' | '), confidence, events: [] };
  if (confidence < minConfidence) return { status: 'FAILED', reason: `Confidence ${confidence} menor a ${minConfidence}`, confidence, events: [] };
  return { status: 'SUCCESS', reason: 'Validacion custom aprobada', confidence, events: [] };
}

export function advanceValidatedGraphStep(input: AgentInput, output: AgentOutput): AgentOutput {
  if (output.status !== 'SUCCESS') return output;
  const configuredSteps = Array.isArray(input.context.qaSteps)
    ? input.context.qaSteps
    : Array.isArray(input.context.manualSteps)
      ? input.context.manualSteps
      : [];
  const stepNumbers = configuredSteps
    .map((step: any) => Number(step?.number ?? step?.numero_paso))
    .filter((value: number) => Number.isFinite(value));
  const current = Number(input.sharedMemory.current_step ?? stepNumbers[0] ?? 1);
  const completed = Array.from(new Set([
    ...(Array.isArray(input.sharedMemory.completed_steps) ? input.sharedMemory.completed_steps.map(Number) : []),
    current,
  ])).filter(Number.isFinite);
  const currentIndex = stepNumbers.indexOf(current);
  const next = currentIndex >= 0 ? stepNumbers[currentIndex + 1] : undefined;
  const total = Number(input.sharedMemory.total_steps ?? stepNumbers.length ?? 0);
  const complete = next === undefined && (total <= 0 || completed.length >= total);
  return {
    ...output,
    sharedMemoryPatch: {
      ...(output.sharedMemoryPatch || {}),
      completed_steps: completed,
      current_step: complete ? null : (next ?? current + 1),
      qa_run_complete: complete,
    },
  };
}

export async function runReporterAgent(node: WorkflowNode, input: AgentInput): Promise<AgentOutput> {
  return {
    status: 'SUCCESS',
    reason: node.config_json?.reason || 'Reporte custom generado',
    confidence: 100,
    events: [{ type: 'reporter_agent', node_id: node.id, sharedMemory: input.sharedMemory }],
    sharedMemoryPatch: {
      report_summary: {
        detected_errors: input.sharedMemory.detected_errors || [],
        visited_urls: input.sharedMemory.visited_urls || [],
      },
    },
  };
}

function allowedWebhookHost(url: URL, allowlist: string[]): boolean {
  return allowlist.some((item) => item === '*' || item.toLowerCase() === url.hostname.toLowerCase());
}

function isPrivateOrBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === 'metadata.google.internal') return true;
  if (net.isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  if (net.isIP(host) === 6) {
    if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return true;
  }
  return false;
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers || {}).map(([key, value]) => (
    /authorization|token|secret|key/i.test(key) ? [key, '[redacted]'] : [key, value]
  )));
}

export async function runWebhookAgent(node: WorkflowNode, input: AgentInput): Promise<AgentOutput> {
  const config = node.config_json || {};
  let target: URL;
  try {
    target = new URL(String(config.url || ''));
  } catch {
    return { status: 'BLOCKED', reason: 'Webhook URL invalida', confidence: 100, events: [] };
  }
  const allowlist = Array.isArray(config.allowlist)
    ? config.allowlist.map(String)
    : String(process.env.WEBHOOK_AGENT_ALLOWLIST || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!allowlist.length) {
    return { status: 'BLOCKED', reason: 'Webhook allowlist obligatoria no configurada', confidence: 100, events: [] };
  }
  if (!allowedWebhookHost(target, allowlist)) {
    return { status: 'BLOCKED', reason: `Host webhook no permitido: ${target.hostname}`, confidence: 100, events: [] };
  }
  if (isPrivateOrBlockedHost(target.hostname) && config.allow_private_networks !== true && process.env.WEBHOOK_AGENT_ALLOW_PRIVATE_NETWORKS !== 'true') {
    return { status: 'BLOCKED', reason: `Host webhook privado/local bloqueado: ${target.hostname}`, confidence: 100, events: [] };
  }
  if (!config.timeout_ms) {
    return { status: 'BLOCKED', reason: 'Webhook requiere timeout_ms obligatorio', confidence: 100, events: [] };
  }
  const timeoutMs = Math.max(500, Math.min(30000, Number(config.timeout_ms)));
  const retries = Math.max(0, Math.min(3, Number(config.retries || 0)));
  const allowedHeaders = new Set((Array.isArray(config.allowed_headers) ? config.allowed_headers : ['content-type']).map((item: any) => String(item).toLowerCase()));
  const configuredHeaders = config.headers && typeof config.headers === 'object' ? config.headers : {};
  const safeConfiguredHeaders = Object.fromEntries(Object.entries(configuredHeaders).filter(([key]) => allowedHeaders.has(key.toLowerCase())));
  let lastError = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
    const headers = { 'Content-Type': 'application/json', ...safeConfiguredHeaders };
    const response = await fetch(target, {
      method: String(config.method || 'POST').toUpperCase(),
      headers,
      body: JSON.stringify({ input, sharedMemory: input.sharedMemory, node: { id: node.id, name: node.name, type: node.type } }),
      signal: controller.signal,
    });
    const text = await response.text().catch(() => '');
    return {
      status: response.ok ? 'SUCCESS' : 'FAILED',
      reason: `Webhook HTTP ${response.status}`,
      confidence: response.ok ? 90 : 40,
      decision: { status: response.status, body: text.slice(0, 500), headers: redactHeaders(headers) },
      events: [],
    };
    } catch (error: any) {
      lastError = error?.message || String(error);
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: 'BLOCKED', reason: `Webhook error: ${lastError}`, confidence: 0, events: [] };
}

export async function runScriptAgent(node: WorkflowNode, input: AgentInput): Promise<AgentOutput> {
  if (process.env.AI_SCRIPT_AGENT_ENABLED !== 'true' && node.config_json?.feature_flag_enabled !== true) {
    return { status: 'BLOCKED', reason: 'script_agent deshabilitado por feature flag', confidence: 100, events: [] };
  }
  if (!node.config_json?.timeout_ms) {
    return { status: 'BLOCKED', reason: 'script_agent requiere timeout_ms obligatorio', confidence: 100, events: [] };
  }
  const script = String(node.config_json?.script || "return { status: 'SUCCESS', reason: 'Sin script custom', events: [] }");
  if (script.length > 8000) {
    return { status: 'BLOCKED', reason: 'Script supera longitud maxima permitida', confidence: 100, events: [] };
  }
  if (/\b(require|import|process|fs|child_process|eval|Function|global|globalThis|Buffer)\b/.test(script)) {
    return { status: 'BLOCKED', reason: 'Script contiene API no permitida', confidence: 100, events: [] };
  }
  const context = vm.createContext({
    __input: JSON.parse(JSON.stringify(input)),
    __sharedMemory: JSON.parse(JSON.stringify(input.sharedMemory || {})),
    console: { log: () => undefined },
  });
  try {
    const wrapped = `(function(){ const input = __input; const sharedMemory = __sharedMemory; ${script}\n})()`;
    const result = new vm.Script(wrapped).runInContext(context, {
      timeout: Math.max(50, Math.min(5000, Number(node.config_json.timeout_ms))),
    });
    const normalized = normalizeOutput(result, 'Script ejecutado');
    if (JSON.stringify(normalized).length > 12000) {
      return { status: 'BLOCKED', reason: 'Output de script supera limite permitido', confidence: 100, events: [] };
    }
    return normalized;
  } catch (error: any) {
    return { status: 'FAILED', reason: `Script error: ${error?.message || error}`, confidence: 0, events: [] };
  }
}
