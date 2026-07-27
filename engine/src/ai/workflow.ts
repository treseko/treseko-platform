import type { BrowserObservation, QAEngineStep, StructuredHistoryItem } from '../automation/action-types.ts';
import { runtimeManifestFor } from './agent-runtime-manifest.ts';
import { finalizeUniversalAgentExecution, prepareUniversalAgentExecution, universalEnvelopeFor } from './universal-agent.ts';

export type AgentStatus = 'SUCCESS' | 'FAILED' | 'BLOCKED' | 'SKIPPED';
export type NodeRunStatus = 'PENDING' | 'SKIPPED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'RETRYING' | 'BLOCKED';
export type WorkflowRunStatus = 'QUEUED' | 'INITIALIZING' | 'RUNNING' | 'WAITING_RETRY' | 'BLOCKED' | 'FAILED' | 'PASSED' | 'CANCELLED' | 'TIMEOUT';

export type ResolvedContext = Record<string, any>;
export type AgentEvent = Record<string, any>;

export type AgentInput = {
  executionId: string;
  caseId: string;
  step?: QAEngineStep;
  context: ResolvedContext;
  observation?: BrowserObservation;
  history: AgentEvent[];
  sharedMemory: Record<string, any>;
};

export type AgentOutput = {
  status: AgentStatus;
  decision?: any;
  confidence?: number;
  reason?: string;
  events: AgentEvent[];
  sharedMemoryPatch?: Record<string, any>;
  next?: string | null;
};

export type WorkflowNode = {
  id: string;
  name: string;
  type: string;
  agent_key: string;
  enabled: boolean;
  locked?: boolean;
  prompt_template?: string;
  config_json?: Record<string, any>;
  position_x?: number;
  position_y?: number;
  retry_policy?: Record<string, any>;
  timeout_sec?: number;
  model_override?: string | null;
  temperature_override?: number | null;
  universal_agent_version_id?: string | null;
  universal_agent?: {
    version_id: string;
    version: string;
    contract: Record<string, any>;
    contract_hash?: string;
  };
};

export type WorkflowEdge = {
  id: string;
  source_node_id: string;
  target_node_id: string;
  source_handle?: string | null;
  target_handle?: string | null;
  condition_type: string;
  condition_json?: Record<string, any>;
  priority?: number;
  max_passes?: number;
  data_mapping_json?: Array<{ source: string; target: string }>;
};

export type WorkflowDefinition = {
  workflow: {
    id: string;
    name: string;
    version: number;
    status?: string;
    is_default?: boolean;
    workflow_format?: 'legacy_v1' | 'block_v2' | string;
    source_workflow_id?: string | null;
  };
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

export type WorkflowTrace = {
  ts: string;
  workflow_id?: string;
  workflow_version?: number;
  node_id?: string;
  node_name?: string;
  node_type?: string;
  status: NodeRunStatus;
  input_json: Record<string, any>;
  output_json: Record<string, any>;
  metrics_json: Record<string, any>;
  started_at: string;
  ended_at: string;
};

export type WorkflowHandler = (node: WorkflowNode, input: AgentInput) => Promise<AgentOutput>;

export type WorkflowExecutionResult = {
  status: WorkflowRunStatus;
  sharedMemory: Record<string, any>;
  history: AgentEvent[];
  traces: WorkflowTrace[];
  lastOutput?: AgentOutput;
};

const TERMINAL_TYPES = new Set(['Reporter', 'End']);

function mergePatch(base: Record<string, any>, patch?: Record<string, any>): Record<string, any> {
  if (!patch || typeof patch !== 'object') return base;
  return { ...base, ...patch };
}

function valueAtPath(source: any, path: string): any {
  return String(path || '').split('.').filter(Boolean).reduce((current, part) => current?.[part], source);
}

function startNode(definition: WorkflowDefinition): WorkflowNode | undefined {
  const targets = new Set(definition.edges.map((edge) => String(edge.target_node_id)));
  return definition.nodes.find((node) => node.enabled !== false && !targets.has(String(node.id)))
    || definition.nodes.find((node) => node.enabled !== false);
}

function conditionMatches(edge: WorkflowEdge, output: AgentOutput, sharedMemory: Record<string, any>, retryCount: number): boolean {
  const condition = String(edge.condition_type || 'always').toLowerCase();
  const outputPort = String(output.decision?.universal_result?.route?.outputPort || output.decision?.route?.outputPort || '').toLowerCase();
  if (condition === 'output_port' || condition === 'decision_is') {
    const expected = String(edge.condition_json?.value || edge.condition_json?.output_port || edge.source_handle || '').toLowerCase();
    return Boolean(expected) && outputPort === expected;
  }
  if (condition === 'always') return true;
  if (condition === 'on_success') return output.status === 'SUCCESS';
  if (condition === 'on_failed') return output.status === 'FAILED';
  if (condition === 'on_blocked') return output.status === 'BLOCKED';
  if (condition === 'on_rejected') return output.status === 'FAILED' || output.decision?.approved === false || output.decision?.rejected === true;
  if (condition === 'confidence_lt') return Number(output.confidence || 0) < Number(edge.condition_json?.value ?? edge.condition_json?.threshold ?? 70);
  if (condition === 'retry_count_lt') return retryCount < Number(edge.condition_json?.max ?? edge.condition_json?.value ?? 1);
  return false;
}

export async function executeWorkflowGraph(
  definition: WorkflowDefinition,
  baseInput: Omit<AgentInput, 'history' | 'sharedMemory'> & { history?: AgentEvent[]; sharedMemory?: Record<string, any> },
  handlers: Record<string, WorkflowHandler>,
  options: { timeoutMs?: number; emitTrace?: (trace: WorkflowTrace) => void } = {},
): Promise<WorkflowExecutionResult> {
  const nodesById = new Map(definition.nodes.map((node) => [String(node.id), node]));
  const outgoing = new Map<string, WorkflowEdge[]>();
  for (const edge of definition.edges) {
    const list = outgoing.get(String(edge.source_node_id)) || [];
    list.push(edge);
    outgoing.set(String(edge.source_node_id), list);
  }
  for (const list of outgoing.values()) {
    list.sort((a, b) => Number(a.priority || 0) - Number(b.priority || 0));
  }

  let current = startNode(definition);
  let status: WorkflowRunStatus = 'RUNNING';
  let sharedMemory: Record<string, any> = {
    base_url: '',
    current_step: null,
    last_action: null,
    last_observation: null,
    detected_errors: [],
    visited_urls: [],
    credentials_used: {},
    confidence_by_step: {},
    retry_count: {},
    ...(baseInput.sharedMemory || {}),
  };
  const history: AgentEvent[] = [...(baseInput.history || [])];
  const traces: WorkflowTrace[] = [];
  const edgePasses: Record<string, number> = {};
  const nodePasses: Record<string, number> = {};
  const startedAt = Date.now();
  let lastOutput: AgentOutput | undefined;

  while (current) {
    if (Date.now() - startedAt > Number(options.timeoutMs || 15 * 60 * 1000)) {
      status = 'TIMEOUT';
      break;
    }
    if (current.enabled === false) {
      lastOutput = { status: 'SKIPPED', reason: 'Nodo deshabilitado', events: [] };
    } else {
      nodePasses[current.id] = (nodePasses[current.id] || 0) + 1;
      let input: AgentInput = {
        ...baseInput,
        history,
        sharedMemory,
      };
      const traceStarted = new Date();
      const universalEnvelope = definition.workflow?.workflow_format === 'universal_v2' ? universalEnvelopeFor(current) : null;
      let universalError: string | null = null;
      if (definition.workflow?.workflow_format === 'universal_v2') {
        try {
          input = prepareUniversalAgentExecution(current, input).input;
        } catch (error: any) {
          universalError = error?.message || String(error);
        }
      }
      const handler = handlers[current.type] || handlers[current.agent_key] || handlers.default;
      const timeout = resolveNodeTimeoutMs(current, options.timeoutMs, startedAt);
      let output: AgentOutput = universalError
        ? { status: 'BLOCKED', reason: `Contrato universal invalido: ${universalError}`, events: [] }
        : handler
        ? await withTimeout(handler(current, input), timeout, {
            status: 'BLOCKED',
            reason: `Timeout del nodo ${current.name}`,
            events: [],
          })
        : { status: 'SKIPPED', reason: `Sin handler para ${current.type}`, events: [] };
      if (universalEnvelope) output = finalizeUniversalAgentExecution(universalEnvelope, output);
      lastOutput = output;
      sharedMemory = mergePatch(sharedMemory, output.sharedMemoryPatch);
      history.push(...(output.events || []), {
        ts: new Date().toISOString(),
        node_id: current.id,
        node_name: current.name,
        status: output.status,
        reason: output.reason,
        confidence: output.confidence,
      });
      const trace: WorkflowTrace = {
        ts: new Date().toISOString(),
        workflow_id: definition.workflow?.id,
        workflow_version: Number(definition.workflow?.version || 1),
        node_id: current.id,
        node_name: current.name,
        node_type: current.type,
        status: output.status === 'BLOCKED' ? 'BLOCKED' : output.status === 'FAILED' ? 'FAILED' : output.status === 'SKIPPED' ? 'SKIPPED' : 'SUCCESS',
        input_json: {
          executionId: input.executionId,
          caseId: input.caseId,
          current_step: sharedMemory.current_step,
        },
        output_json: output as Record<string, any>,
        metrics_json: {
          ...(output.decision?.metrics || {}),
          timeout_ms: timeout,
          ...(runtimeManifestFor(current.agent_key) ? {
            implementation: runtimeManifestFor(current.agent_key)?.implementation,
            implementation_version: runtimeManifestFor(current.agent_key)?.version,
            source_module: runtimeManifestFor(current.agent_key)?.sourceModule,
            editable_strategy: runtimeManifestFor(current.agent_key)?.editableStrategy,
          } : {}),
          ...(universalEnvelope ? {
            workflow_format: 'universal_v2',
            universal_agent_version_id: universalEnvelope.version_id,
            universal_agent_version: universalEnvelope.version,
            universal_agent_key: universalEnvelope.contract.key,
            implementation: universalEnvelope.contract.implementation.native_adapter,
            capabilities: universalEnvelope.contract.capabilities,
            contract_hash: universalEnvelope.contract_hash,
          } : {}),
        },
        started_at: traceStarted.toISOString(),
        ended_at: new Date().toISOString(),
      };
      traces.push(trace);
      options.emitTrace?.(trace);
    }

    if (TERMINAL_TYPES.has(current.type)) {
      status = lastOutput?.status === 'SUCCESS' || lastOutput?.status === 'SKIPPED'
        ? 'PASSED'
        : lastOutput?.status === 'BLOCKED'
          ? 'BLOCKED'
          : 'FAILED';
      break;
    }
    if (lastOutput?.next && definition.workflow?.workflow_format !== 'universal_v2') {
      current = nodesById.get(String(lastOutput.next));
      continue;
    }
    const currentNodeId = current.id;
    const nextEdge = (outgoing.get(currentNodeId) || []).find((edge) => {
      edgePasses[edge.id] = edgePasses[edge.id] || 0;
      if (edgePasses[edge.id] >= Number(edge.max_passes || 1)) return false;
      const retryCount = Number(sharedMemory.retry_count?.[currentNodeId] || nodePasses[currentNodeId] || 0);
      if (definition.workflow?.workflow_format === 'universal_v2') {
        const port = String(lastOutput?.decision?.universal_result?.route?.outputPort || '').toLowerCase();
        const sourceHandle = String(edge.source_handle || '').toLowerCase();
        if (sourceHandle && port && sourceHandle !== port) return false;
      }
      return conditionMatches(edge, lastOutput || { status: 'SKIPPED', events: [] }, sharedMemory, retryCount);
    });
    if (!nextEdge) {
      status = lastOutput?.status === 'SUCCESS' ? 'PASSED' : lastOutput?.status === 'BLOCKED' ? 'BLOCKED' : 'FAILED';
      break;
    }
    edgePasses[nextEdge.id] += 1;
    if (definition.workflow?.workflow_format === 'universal_v2' && Array.isArray(nextEdge.data_mapping_json) && nextEdge.data_mapping_json.length) {
      const targetInputs: Record<string, Record<string, any>> = { ...(sharedMemory.universal_inputs || {}) };
      const currentInputs: Record<string, any> = { ...(targetInputs[String(nextEdge.target_node_id)] || {}) };
      const source = {
        outputs: lastOutput?.decision?.universal_result?.outputs || lastOutput?.decision?.outputs || {},
        memory: sharedMemory,
      };
      for (const mapping of nextEdge.data_mapping_json) {
        if (String(mapping.target || '').startsWith('inputs.')) {
          currentInputs[String(mapping.target).slice('inputs.'.length)] = valueAtPath(source, String(mapping.source || ''));
        }
      }
      targetInputs[String(nextEdge.target_node_id)] = currentInputs;
      sharedMemory = { ...sharedMemory, universal_inputs: targetInputs };
    }
    current = nodesById.get(String(nextEdge.target_node_id));
  }

  return { status, sharedMemory, history, traces, lastOutput };
}

function resolveNodeTimeoutMs(node: WorkflowNode, workflowTimeoutMs: number | undefined, workflowStartedAt: number): number {
  const remainingWorkflowMs = Number(workflowTimeoutMs || 0) > 0
    ? Math.max(1000, Number(workflowTimeoutMs) - (Date.now() - workflowStartedAt))
    : 0;
  const configuredTimeoutMs = Math.max(1, Number(node.timeout_sec || 60)) * 1000;
  const type = String(node.type || '').toLowerCase();

  // The Executor runs the whole QA step runner. A fixed 60s cap is too short for
  // valid slow tests and for large-context local models, so let the global
  // execution timeout govern it unless the node has an explicit larger value.
  if ((type === 'executor' || type === 'browser_action_agent' || type === 'contextresolver' || type === 'auditor') && configuredTimeoutMs <= 60000 && remainingWorkflowMs > 0) {
    return remainingWorkflowMs;
  }

  if (remainingWorkflowMs > 0) {
    return Math.min(configuredTimeoutMs, remainingWorkflowMs);
  }
  return configuredTimeoutMs;
}

function withTimeout<T>(promise: Promise<T>, timeout: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), timeout);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}
