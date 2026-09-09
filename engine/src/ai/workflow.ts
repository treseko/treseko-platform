import type { BrowserObservation, QAEngineStep, StructuredHistoryItem } from '../automation/action-types.ts';
import { runtimeManifestFor } from './agent-runtime-manifest.ts';
import { finalizeUniversalAgentExecution, prepareUniversalAgentExecution, universalEnvelopeFor } from './universal-agent.ts';
import {
  resolveAuthoritativeWorkflowHandler,
} from './graph-runtime/authoritative-handler-resolver.ts';
import { compileWorkflowSnapshot } from './graph-runtime/compiler.ts';
import type { CompiledWorkflowPlan } from './graph-runtime/contracts.ts';
import { applyNodeInputMapping, applyNodeOutputMapping, valueAtPath } from './graph-runtime/workflow-mapping.ts';
import {
  compiledNodeTimeoutMs,
  executeGraphNativeHandler,
  outputPortFor,
  runtimeNodeFromCompiled,
  selectCompiledV3Edge,
} from './graph-runtime/v3-runtime.ts';
import { conditionMatches, startNode } from './graph-runtime/workflow-routing.ts';
import { graphDispatchEnabled, isGraphAuthoritativeV3, isUniversalWorkflow, workflowFormat } from './graph-runtime/workflow-mode.ts';
import { resolveLegacyNodeTimeoutMs, withTimeout } from './graph-runtime/workflow-timeout.ts';
import { deterministicPlannerAction } from './custom-agents.ts';

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
  /** Optional declarative mapping from workflow input paths to node inputs. */
  input_mapping?: Record<string, string>;
  output_mapping?: Record<string, string>;
  output_ports?: Array<string | { id?: string; key?: string; name?: string }>;
  terminal_ports?: string[];
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
    workflow_purpose?: string;
    decision_policy_json?: Record<string, any>;
    source_workflow_id?: string | null;
    /** Explicit opt-in for persisted graph dispatch. Legacy remains the default. */
    runtime_mode?: 'legacy' | 'graph_compat' | 'graph_native' | 'shadow_compare' | string;
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
  return {
    ...base,
    ...patch,
    ...(patch.graph_node_outputs && typeof patch.graph_node_outputs === 'object' ? {
      graph_node_outputs: { ...(base.graph_node_outputs || {}), ...patch.graph_node_outputs },
    } : {}),
    ...(patch.retry_count && typeof patch.retry_count === 'object' ? {
      retry_count: { ...(base.retry_count || {}), ...patch.retry_count },
    } : {}),
  };
}

const MAX_SUBWORKFLOW_DEPTH = 5;

function nestedWorkflowResultStatus(status: WorkflowRunStatus): AgentStatus {
  if (status === 'PASSED') return 'SUCCESS';
  if (status === 'BLOCKED' || status === 'TIMEOUT') return 'BLOCKED';
  return 'FAILED';
}

function isWorkflowDefinition(value: any): value is WorkflowDefinition {
  return Boolean(value && typeof value === 'object' && value.workflow && Array.isArray(value.nodes) && Array.isArray(value.edges));
}

async function executeNestedWorkflow(
  node: WorkflowNode,
  input: AgentInput,
  handlers: Record<string, WorkflowHandler>,
  options: { timeoutMs?: number; emitTrace?: (trace: WorkflowTrace) => void },
): Promise<AgentOutput> {
  const child = node.config_json?.subworkflow_definition;
  const depth = Number(input.sharedMemory.__workflow_depth || 0);
  if (!isWorkflowDefinition(child)) {
    return { status: 'BLOCKED', confidence: 100, reason: `El subworkflow ${node.name} no tiene una definicion valida`, events: [] };
  }
  if (depth >= MAX_SUBWORKFLOW_DEPTH) {
    return { status: 'BLOCKED', confidence: 100, reason: `Profundidad maxima de subworkflows alcanzada en ${node.name}`, events: [] };
  }
  if (child.nodes.length > 100 || child.edges.length > 300) {
    return { status: 'BLOCKED', confidence: 100, reason: `El subworkflow ${child.workflow.name || child.workflow.id} supera los limites del motor`, events: [] };
  }
  if (child.workflow.workflow_format !== 'universal_v2') {
    return { status: 'BLOCKED', confidence: 100, reason: 'El subworkflow debe usar el formato universal_v2', events: [] };
  }
  try {
    child.nodes.filter((childNode) => childNode.enabled !== false).forEach((childNode) => universalEnvelopeFor(childNode));
  } catch (error: any) {
    return { status: 'BLOCKED', confidence: 100, reason: `Contrato universal invalido en subworkflow: ${error?.message || error}`, events: [] };
  }
  const nested = await executeWorkflowGraph(
    child,
    {
      ...input,
      context: { ...input.context, parent_workflow_node: node.id },
      sharedMemory: { ...input.sharedMemory, __workflow_depth: depth + 1 },
    },
    handlers,
    options,
  );
  return {
    status: nestedWorkflowResultStatus(nested.status),
    confidence: nested.lastOutput?.confidence ?? (nested.status === 'PASSED' ? 100 : 60),
    reason: nested.lastOutput?.reason || `Subworkflow ${child.workflow.name || child.workflow.id} finalizado como ${nested.status}`,
    decision: { subworkflow: { id: child.workflow.id, workflow_version: child.workflow.version, status: nested.status } },
    events: [{ type: 'subworkflow_completed', node_id: node.id, workflow_id: child.workflow.id, workflow_version: child.workflow.version, status: nested.status }],
    sharedMemoryPatch: nested.sharedMemory,
  };
}

export async function executeWorkflowGraph(
  definition: WorkflowDefinition,
  baseInput: Omit<AgentInput, 'history' | 'sharedMemory'> & { history?: AgentEvent[]; sharedMemory?: Record<string, any> },
  handlers: Record<string, WorkflowHandler>,
  options: { timeoutMs?: number; emitTrace?: (trace: WorkflowTrace) => void } = {},
): Promise<WorkflowExecutionResult> {
  let compiledV3: CompiledWorkflowPlan | undefined;
  if (isGraphAuthoritativeV3(definition)) {
    const compilation = compileWorkflowSnapshot(definition as any, {
      allow_legacy_fallback: false,
      global_max_timeout_ms: options.timeoutMs,
      global_max_attempts: 10,
    });
    if (!compilation.ok || !compilation.plan) {
      const reason = compilation.issues.filter((issue) => issue.severity === 'error').map((issue) => `${issue.code}: ${issue.message}`).join(' | ');
      return {
        status: 'BLOCKED', sharedMemory: baseInput.sharedMemory || {}, history: baseInput.history || [], traces: [],
        lastOutput: { status: 'BLOCKED', reason: `Workflow universal_v3 invalido: ${reason}`, events: [], decision: { graph_runtime_error_code: 'V3_COMPILE_FAILED', compile_issues: compilation.issues } },
      };
    }
    compiledV3 = compilation.plan;
  }
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

  let current = compiledV3
    ? nodesById.get(compiledV3.entry_node_id)
    : startNode(definition);
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
    const compiledNode = compiledV3?.nodes[String(current.id)];
    const runtimeNode = compiledNode ? runtimeNodeFromCompiled(current, compiledNode) : current;
    if (runtimeNode.enabled === false) {
      lastOutput = { status: 'SKIPPED', reason: 'Nodo deshabilitado', events: [] };
    } else {
      nodePasses[runtimeNode.id] = (nodePasses[runtimeNode.id] || 0) + 1;
      let input: AgentInput = {
        ...baseInput,
        context: {
          ...baseInput.context,
          workflow_format: workflowFormat(definition),
        },
        history,
        sharedMemory,
      };
      const traceStarted = new Date();
      const universalEnvelope = isUniversalWorkflow(definition) ? universalEnvelopeFor(runtimeNode) : null;
      let universalError: string | null = null;
      if (isUniversalWorkflow(definition)) {
        try {
          input = prepareUniversalAgentExecution(runtimeNode, input).input;
        } catch (error: any) {
          universalError = error?.message || String(error);
        }
      }
      input = applyNodeInputMapping(runtimeNode, input);
      const universalAdapter = String(universalEnvelope?.contract.implementation?.native_adapter || '');
      let handler: WorkflowHandler | undefined;
      let dispatchError: string | null = null;
      if (graphDispatchEnabled(definition)) {
        try {
          // In graph modes the persisted native_adapter is authoritative. The
          // visual type and legacy agent_key are only aliases registered by
          // the runtime, never an override for the graph contract.
          handler = resolveAuthoritativeWorkflowHandler(runtimeNode, handlers, compiledNode ? {
            requiredAdapter: compiledNode.native_adapter,
            requireV3Atomic: true,
          } : {});
        } catch (error: any) {
          dispatchError = error?.message || String(error);
        }
      } else {
        // Compatibility path for historical snapshots that predate the graph
        // runtime. This is intentionally unchanged until a workflow is
        // explicitly migrated and published in a graph mode.
        handler = handlers[runtimeNode.type] || handlers[runtimeNode.agent_key] || handlers[universalAdapter] || handlers.default;
      }
      const isSubworkflow = universalAdapter === 'universal-subworkflow/v1';
      const timeout = compiledNode
        ? compiledNodeTimeoutMs(compiledNode, options.timeoutMs, startedAt)
        : resolveLegacyNodeTimeoutMs(runtimeNode, options.timeoutMs, startedAt);
      let output: AgentOutput = universalError
        ? { status: 'BLOCKED', reason: `Contrato universal invalido: ${universalError}`, events: [] }
        : dispatchError
        ? { status: 'BLOCKED', reason: `Despacho del grafo invalido: ${dispatchError}`, events: [], decision: {
            graph_runtime_error: dispatchError,
            graph_runtime_error_code: dispatchError.includes('native_adapter')
              ? 'MISSING_NATIVE_ADAPTER'
              : dispatchError.includes('not registered')
              ? 'UNKNOWN_RUNTIME_ADAPTER'
              : 'WORKFLOW_HANDLER_RESOLUTION_FAILED',
          } }
        : isSubworkflow
        ? await withTimeout(executeNestedWorkflow(runtimeNode, input, handlers, options), timeout, {
            status: 'BLOCKED',
            reason: `Timeout del nodo ${runtimeNode.name}`,
            events: [],
          })
        : handler && compiledNode
        ? await executeGraphNativeHandler(runtimeNode, compiledNode, input, handler, timeout)
        : handler
        ? await withTimeout(handler(runtimeNode, input), timeout, {
            status: 'BLOCKED',
            reason: `Timeout del nodo ${runtimeNode.name}`,
            events: [],
          })
        : { status: 'SKIPPED', reason: `Sin handler para ${runtimeNode.type}`, events: [] };
      output = applyNodeOutputMapping(runtimeNode, output);
      if (
        workflowFormat(definition) === 'universal_v3'
        && universalAdapter === 'qa-action-planner/v2'
      ) {
        const currentStep = Number(sharedMemory.current_step || 1);
        const configuredSteps = Array.isArray(input.context.qaSteps)
          ? input.context.qaSteps
          : Array.isArray(input.context.manualSteps)
            ? input.context.manualSteps
            : [];
        const step = configuredSteps.find((candidate: any) => Number(candidate?.number ?? candidate?.numero_paso) === currentStep);
        const fallbackAction = deterministicPlannerAction(step)
          || (currentStep === 1 && typeof sharedMemory.base_url === 'string' && sharedMemory.base_url
            ? { type: 'navigate', url: sharedMemory.base_url, step_number: currentStep, reason: 'Navegacion resuelta por Context Resolver.' }
            : undefined);
        if (fallbackAction) {
          output = {
            ...output,
            decision: {
              ...(output.decision || {}),
              proposed_action: fallbackAction,
              metrics: { ...(output.decision?.metrics || {}), implementation: 'v3-graph-structured-step-contract' },
            },
            sharedMemoryPatch: { ...(output.sharedMemoryPatch || {}), planned_action: fallbackAction },
          };
        }
      }
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
            workflow_format: workflowFormat(definition),
            ...(compiledV3 ? { graph_plan_hash: compiledV3.plan_hash, graph_runtime_mode: compiledV3.runtime_mode } : {}),
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

    if ((compiledV3 && compiledNode?.terminal_ports.includes(outputPortFor(lastOutput))) || (!compiledV3 && TERMINAL_TYPES.has(current.type))) {
      status = lastOutput?.status === 'SUCCESS' || lastOutput?.status === 'SKIPPED'
        ? 'PASSED'
        : lastOutput?.status === 'BLOCKED'
          ? 'BLOCKED'
          : 'FAILED';
      break;
    }
    if (lastOutput?.next && !isUniversalWorkflow(definition)) {
      current = nodesById.get(String(lastOutput.next));
      continue;
    }
    const currentNodeId = current.id;
    if (compiledV3) {
      let nextCompiledEdge;
      try {
        nextCompiledEdge = selectCompiledV3Edge({
          plan: compiledV3,
          nodeId: currentNodeId,
          output: lastOutput,
          state: sharedMemory,
          edgePasses,
          retryCount: Number(sharedMemory.retry_count?.[currentNodeId] || nodePasses[currentNodeId] || 0),
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        lastOutput = {
          status: 'BLOCKED',
          reason: `Seleccion de conexion V3 bloqueada: ${reason}`,
          events: [],
          decision: { graph_runtime_error_code: 'AMBIGUOUS_EDGE_MATCH', graph_runtime_error: reason },
        };
        history.push({ ts: new Date().toISOString(), node_id: currentNodeId, status: 'BLOCKED', reason });
        status = 'BLOCKED';
        break;
      }
      if (!nextCompiledEdge) {
        status = lastOutput?.status === 'SUCCESS' ? 'PASSED' : lastOutput?.status === 'BLOCKED' ? 'BLOCKED' : 'FAILED';
        break;
      }
      edgePasses[nextCompiledEdge.id] = (edgePasses[nextCompiledEdge.id] || 0) + 1;
      if (nextCompiledEdge.data_mapping.length) {
        const targetInputs: Record<string, Record<string, any>> = { ...(sharedMemory.universal_inputs || {}) };
        const currentInputs: Record<string, any> = { ...(targetInputs[nextCompiledEdge.target_node_id] || {}) };
        const source = {
          outputs: lastOutput?.decision?.universal_result?.outputs || lastOutput?.decision?.outputs || {},
          memory: sharedMemory,
        };
        for (const mapping of nextCompiledEdge.data_mapping) {
          if (mapping.target.startsWith('inputs.')) currentInputs[mapping.target.slice('inputs.'.length)] = valueAtPath(source, mapping.source);
        }
        targetInputs[nextCompiledEdge.target_node_id] = currentInputs;
        sharedMemory = { ...sharedMemory, universal_inputs: targetInputs };
      }
      current = nodesById.get(nextCompiledEdge.target_node_id);
      continue;
    }
    const nextEdge = (outgoing.get(currentNodeId) || []).find((edge) => {
      edgePasses[edge.id] = edgePasses[edge.id] || 0;
      if (edgePasses[edge.id] >= Number(edge.max_passes || 1)) return false;
      const retryCount = Number(sharedMemory.retry_count?.[currentNodeId] || nodePasses[currentNodeId] || 0);
      if (isUniversalWorkflow(definition)) {
        const port = outputPortFor(lastOutput);
        const sourceHandle = String(edge.source_handle || '').toLowerCase();
        // A typed connection must never become a catch-all edge when an agent
        // omits its route. This keeps the visual port contract equivalent to
        // the runtime selection contract.
        if (sourceHandle && sourceHandle !== port) return false;
      }
      return conditionMatches(edge, lastOutput || { status: 'SKIPPED', events: [] }, retryCount);
    });
    if (!nextEdge) {
      status = lastOutput?.status === 'SUCCESS' ? 'PASSED' : lastOutput?.status === 'BLOCKED' ? 'BLOCKED' : 'FAILED';
      break;
    }
    edgePasses[nextEdge.id] += 1;
    if (isUniversalWorkflow(definition) && Array.isArray(nextEdge.data_mapping_json) && nextEdge.data_mapping_json.length) {
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
