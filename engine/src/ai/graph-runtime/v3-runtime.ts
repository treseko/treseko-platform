import type { AgentInput, AgentOutput, AgentStatus, WorkflowHandler, WorkflowNode } from '../workflow.ts';
import type { CompiledWorkflowEdge, CompiledWorkflowNode, CompiledWorkflowPlan, WorkflowNodeResult } from './contracts.ts';
import { selectDeterministicEdge, type ConditionExpression } from './condition-evaluator.ts';

export function outputPortFor(output?: AgentOutput): string {
  return String(output?.decision?.universal_result?.route?.outputPort || output?.decision?.route?.outputPort || output?.decision?.output_port || '').trim().toLowerCase();
}

export function reasonCodeFor(output?: AgentOutput): string {
  return String(output?.decision?.universal_result?.reason_code || output?.decision?.reason_code || output?.reason || 'NODE_RESULT').trim();
}

function normalizeGraphNativeOutput(value: any, node: WorkflowNode): AgentOutput {
  if (!value || typeof value !== 'object' || !('output_port' in value || 'outputPort' in value || value.status === 'RETRYABLE' || value.status === 'CANCELLED')) {
    return { ...value, events: Array.isArray(value?.events) ? value.events : [] } as AgentOutput;
  }
  const rawStatus = String(value.status || 'FAILED').toUpperCase();
  const status: AgentStatus = rawStatus === 'SUCCESS' ? 'SUCCESS' : rawStatus === 'SKIPPED' ? 'SKIPPED' : rawStatus === 'BLOCKED' || rawStatus === 'CANCELLED' ? 'BLOCKED' : 'FAILED';
  const outputPort = String(value.output_port || value.outputPort || (status === 'SUCCESS' ? 'success' : status.toLowerCase())).toLowerCase();
  const reasonCode = String(value.reason_code || value.reasonCode || rawStatus);
  const data = value.data && typeof value.data === 'object' && !Array.isArray(value.data) ? value.data : {};
  const proposedAction = value.proposed_action
    || value.decision?.proposed_action
    || data.proposed_action
    || value.sharedMemoryPatch?.planned_action
    || value.action
    || value.decision?.action
    || data.action;
  return {
    status,
    confidence: Number.isFinite(Number(value.confidence)) ? Number(value.confidence) : undefined,
    reason: String(value.message || value.reason || reasonCode),
    events: Array.isArray(value.events) ? value.events : [],
    decision: {
      ...(value.decision || {}), graph_native: true, raw_status: rawStatus, reason_code: reasonCode, outputs: data,
      route: { ...(value.decision?.route || {}), outputPort },
      ...(Array.isArray(value.evidence_refs) ? { evidence_refs: value.evidence_refs } : {}),
      ...(value.metrics ? { metrics: value.metrics } : {}),
    },
    sharedMemoryPatch: {
      ...(value.sharedMemoryPatch || {}), graph_node_outputs: { [String(node.id)]: data }, last_node_output: data,
      ...(proposedAction ? { planned_action: proposedAction } : {}),
    },
  };
}

function shouldRetry(raw: any, compiledNode: CompiledWorkflowNode, attempt: number): boolean {
  const retry = compiledNode.retry_policy;
  const maxAttempts = retry.max_attempts;
  if (attempt >= maxAttempts) return false;
  const rawStatus = String(raw?.status || '').toUpperCase();
  const reasonCode = String(raw?.reason_code || raw?.reasonCode || '');
  const configured = Array.isArray(retry.retryable_reason_codes) ? retry.retryable_reason_codes.map(String) : [];
  return rawStatus === 'RETRYABLE' || (configured.length > 0 && configured.includes(reasonCode));
}

export async function executeGraphNativeHandler(
  node: WorkflowNode,
  compiledNode: CompiledWorkflowNode,
  input: AgentInput,
  handler: WorkflowHandler,
  timeout: number,
): Promise<AgentOutput> {
  let attempt = 0;
  let raw: any;
  do {
    attempt += 1;
    raw = await withTimeout(handler(node, input), timeout, {
      status: 'BLOCKED', reason: `Timeout del nodo ${node.name}`, events: [],
      decision: { reason_code: 'NODE_TIMEOUT', route: { outputPort: 'blocked' } },
    });
    if (!shouldRetry(raw, compiledNode, attempt)) break;
    const retry = compiledNode.retry_policy;
    const initial = retry.initial_backoff_ms;
    const maximum = retry.max_backoff_ms;
    const delay = Math.min(maximum, initial * Math.max(1, 2 ** (attempt - 1)));
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 5_000)));
  } while (true);
  const normalized = normalizeGraphNativeOutput(raw, node);
  normalized.decision = { ...(normalized.decision || {}), technical_attempts: attempt };
  return normalized;
}

export function runtimeNodeFromCompiled(node: WorkflowNode, compiledNode: CompiledWorkflowNode): WorkflowNode {
  const contract = node.universal_agent?.contract ?? {};
  return {
    ...node,
    prompt_template: compiledNode.prompt,
    timeout_sec: compiledNode.timeout_ms / 1000,
    retry_policy: { ...compiledNode.retry_policy },
    input_mapping: { ...compiledNode.input_mapping } as Record<string, string>,
    output_mapping: { ...compiledNode.output_mapping } as Record<string, string>,
    output_ports: [...compiledNode.output_ports],
    terminal_ports: [...compiledNode.terminal_ports],
    config_json: {
      ...compiledNode.config,
      runtime_adapter: compiledNode.native_adapter,
      input_mapping: { ...compiledNode.input_mapping },
      output_mapping: { ...compiledNode.output_mapping },
      output_ports: [...compiledNode.output_ports],
      terminal_ports: [...compiledNode.terminal_ports],
      timeout_ms: compiledNode.timeout_ms,
    },
    universal_agent: node.universal_agent ? {
      ...node.universal_agent,
      contract: {
        ...contract,
        implementation: {
          ...(contract.implementation ?? {}),
          native_adapter: compiledNode.native_adapter,
        },
      },
    } : node.universal_agent,
  };
}

export function compiledNodeTimeoutMs(
  compiledNode: CompiledWorkflowNode,
  workflowTimeoutMs: number | undefined,
  workflowStartedAt: number,
): number {
  if (!workflowTimeoutMs || workflowTimeoutMs <= 0) return compiledNode.timeout_ms;
  const remaining = Math.max(1, workflowTimeoutMs - (Date.now() - workflowStartedAt));
  return Math.min(compiledNode.timeout_ms, remaining);
}

function nodeResultFor(output: AgentOutput | undefined): WorkflowNodeResult {
  const status = output?.status === 'SUCCESS'
    ? 'SUCCESS'
    : output?.status === 'BLOCKED'
      ? 'BLOCKED'
      : output?.status === 'SKIPPED'
        ? 'SKIPPED'
        : 'FAILED';
  return {
    status,
    output_port: outputPortFor(output),
    reason_code: reasonCodeFor(output),
    data: (output?.decision?.universal_result?.outputs || output?.decision?.outputs || {}) as any,
  };
}

export function selectCompiledV3Edge(args: {
  plan: CompiledWorkflowPlan;
  nodeId: string;
  output: AgentOutput | undefined;
  state: Record<string, any>;
  edgePasses: Record<string, number>;
  retryCount: number;
}): CompiledWorkflowEdge | undefined {
  const outputPort = outputPortFor(args.output);
  const candidates = args.plan.edges.filter((edge) => {
    if (edge.source_node_id !== args.nodeId) return false;
    if ((args.edgePasses[edge.id] || 0) >= Number(edge.max_passes || 1)) return false;
    return !edge.source_port || edge.source_port.toLowerCase() === outputPort;
  });
  return selectDeterministicEdge(
    candidates.map((edge) => ({ ...edge, condition: edge.condition as ConditionExpression })),
    {
      result: nodeResultFor(args.output),
      state: args.state,
      retry_count: args.retryCount,
      pass_count: Math.max(0, ...candidates.map((edge) => args.edgePasses[edge.id] || 0)),
      confidence: args.output?.confidence,
    },
  );
}

function withTimeout<T>(promise: Promise<T>, timeout: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), timeout); });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}
