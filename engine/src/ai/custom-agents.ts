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
  const result = await ai.runWorkflowAgent({
    nodeName: node.name,
    promptTemplate: node.prompt_template || '',
    input,
    outputSchema: config.output_schema || config.outputSchema || {},
    temperature: node.temperature_override ?? undefined,
  });
  return normalizeOutput({
    ...result.data,
    decision: { ...(result.data?.decision || {}), metrics: result.metrics },
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
