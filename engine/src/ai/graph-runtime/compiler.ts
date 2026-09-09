import { createHash } from 'node:crypto';
import type {
  AdapterManifestEntry,
  CompileIssue,
  CompiledRetryPolicy,
  CompiledWorkflowEdge,
  CompiledWorkflowNode,
  CompiledWorkflowPlan,
  GraphRuntimeMode,
  PersistedWorkflowSnapshot,
  WorkflowCompileResult,
  WorkflowRuntimeManifest,
} from './contracts.ts';
import { normalizeCondition } from './condition-evaluator.ts';
import { isV3AtomicAdapter } from './v3-adapter-policy.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

function firstNumber(...values: unknown[]): number | undefined {
  return values.find((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function extractNodes(snapshot: PersistedWorkflowSnapshot): readonly unknown[] {
  if (Array.isArray(snapshot.nodes)) return snapshot.nodes;
  const graph = record(snapshot.graph);
  return Array.isArray(graph.nodes) ? graph.nodes : [];
}

function extractEdges(snapshot: PersistedWorkflowSnapshot): readonly unknown[] {
  if (Array.isArray(snapshot.edges)) return snapshot.edges;
  const graph = record(snapshot.graph);
  return Array.isArray(graph.edges) ? graph.edges : [];
}

function extractNativeAdapter(node: Record<string, unknown>): string | undefined {
  const universalAgent = record(node.universal_agent);
  const contract = record(universalAgent.contract);
  const implementation = record(contract.implementation);
  const runtime = record(node.runtime);
  return firstString(implementation.native_adapter, runtime.native_adapter, node.native_adapter);
}

function extractEffectiveV3Adapter(node: Record<string, unknown>): string | undefined {
  const config = record(node.config_json ?? extractConfig(node));
  return firstString(config.runtime_adapter, extractNativeAdapter(node));
}

function extractContractVersion(node: Record<string, unknown>): string {
  const universalAgent = record(node.universal_agent);
  const contract = record(universalAgent.contract);
  return firstString(contract.version, contract.contract_version, universalAgent.version, '1') ?? '1';
}

function extractPrompt(node: Record<string, unknown>): string {
  const prompt = record(node.prompt);
  return firstString(node.prompt_template, node.system_prompt, prompt.template, prompt.text, '') ?? '';
}

function extractConfig(node: Record<string, unknown>): Record<string, unknown> {
  return record(node.configuration_json ?? node.config ?? node.configuration);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [item.trim()];
    if (!isRecord(item)) return [];
    const id = firstString(item.id, item.key, item.name, item.port);
    return id ? [id] : [];
  });
}

function workflowMetadata(snapshot: PersistedWorkflowSnapshot): Record<string, unknown> {
  return record(snapshot.workflow);
}

function runtimeModeFor(snapshot: PersistedWorkflowSnapshot): GraphRuntimeMode {
  const workflow = workflowMetadata(snapshot);
  const policy = record(workflow.decision_policy_json ?? snapshot.decision_policy_json);
  return firstString(snapshot.runtime_mode, workflow.runtime_mode, policy.runtime_mode, 'legacy') as GraphRuntimeMode;
}

function conditionForEdge(rawEdge: Record<string, unknown>): unknown {
  const conditionType = firstString(rawEdge.condition_type, 'always') ?? 'always';
  const condition = record(rawEdge.condition_json ?? rawEdge.condition);
  if (condition.op) return condition;
  switch (conditionType.toLowerCase()) {
    case 'always': return { op: 'always' };
    case 'on_success': return { op: 'status_is', value: 'SUCCESS' };
    case 'on_failed': return { op: 'status_is', value: 'FAILED' };
    case 'on_blocked': return { op: 'status_is', value: 'BLOCKED' };
    case 'output_port':
    case 'decision_is': return { op: 'output_port_is', value: firstString(condition.value, condition.output_port, rawEdge.source_handle, rawEdge.source_port) };
    case 'retry_count_lt': return { op: 'retry_count_lt', value: firstNumber(condition.max, condition.value, 1) };
    case 'confidence_lt':
      return { op: 'not', condition: { op: 'confidence_gte', value: firstNumber(condition.value, condition.threshold, 70) } };
    case 'on_rejected':
      return { op: 'any', conditions: [
        { op: 'status_is', value: 'FAILED' },
        { op: 'output_port_is', value: 'rejected' },
        { op: 'output_port_is', value: 'blocked' },
      ] };
    default: return condition;
  }
}

function dataMappingForEdge(rawEdge: Record<string, unknown>): Array<{ source: string; target: string }> {
  const raw = rawEdge.data_mapping_json ?? rawEdge.data_mapping;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!isRecord(item)) return [];
    const source = firstString(item.source, item.from);
    const target = firstString(item.target, item.to);
    return source && target ? [{ source, target }] : [];
  });
}

function compileRetryPolicy(node: Record<string, unknown>, manifest?: AdapterManifestEntry): CompiledRetryPolicy {
  const retry = record(node.retry_policy);
  const explicitAttempts = firstNumber(retry.max_attempts);
  const configuredRetries = firstNumber(retry.max_retries, node.max_retries);
  const maxAttempts = Math.max(1, Math.floor(explicitAttempts ?? ((configuredRetries ?? 0) + 1)));
  const initialBackoff = Math.max(0, Math.floor(firstNumber(retry.initial_backoff_ms, retry.backoff_ms, 0) ?? 0));
  const maxBackoff = Math.max(initialBackoff, Math.floor(firstNumber(retry.max_backoff_ms, initialBackoff) ?? initialBackoff));
  const requestedCodes = stringArray(retry.retryable_reason_codes);
  const allowedCodes = new Set(manifest?.retryable_reason_codes ?? requestedCodes);
  return {
    max_attempts: maxAttempts,
    initial_backoff_ms: initialBackoff,
    max_backoff_ms: maxBackoff,
    retryable_reason_codes: requestedCodes.filter((code) => allowedCodes.has(code)),
  };
}

export interface WorkflowCompilerOptions {
  readonly runtime_mode?: GraphRuntimeMode;
  readonly runtime_manifest?: WorkflowRuntimeManifest;
  readonly global_max_timeout_ms?: number;
  readonly global_max_attempts?: number;
  readonly allow_legacy_fallback?: boolean;
  readonly now?: () => Date;
}

export function compileWorkflowSnapshot(
  snapshot: PersistedWorkflowSnapshot,
  options: WorkflowCompilerOptions = {},
): WorkflowCompileResult {
  const issues: CompileIssue[] = [];
  const workflow = workflowMetadata(snapshot);
  const policy = record(workflow.decision_policy_json ?? snapshot.decision_policy_json);
  const format = firstString(snapshot.format, workflow.format, workflow.workflow_format, 'legacy') ?? 'legacy';
  const purpose = firstString(snapshot.purpose, workflow.purpose, workflow.workflow_purpose, 'unknown') ?? 'unknown';
  const runtimeMode = options.runtime_mode ?? runtimeModeFor(snapshot);
  const strictV3 = format === 'universal_v3';
  if (strictV3 && runtimeMode !== 'graph_native') {
    issues.push({ severity: 'error', code: 'V3_REQUIRES_GRAPH_NATIVE', message: 'universal_v3 requires runtime_mode graph_native', path: 'workflow.decision_policy_json.runtime_mode' });
  }
  if (strictV3 && policy.source_of_truth !== 'persisted_graph') {
    issues.push({ severity: 'error', code: 'V3_REQUIRES_PERSISTED_GRAPH', message: 'universal_v3 requires source_of_truth persisted_graph', path: 'workflow.decision_policy_json.source_of_truth' });
  }
  if (strictV3 && policy.legacy_step_runner_allowed !== false) {
    issues.push({ severity: 'error', code: 'V3_LEGACY_STEP_RUNNER_FORBIDDEN', message: 'universal_v3 requires legacy_step_runner_allowed false', path: 'workflow.decision_policy_json.legacy_step_runner_allowed' });
  }
  const manifest = new Map((options.runtime_manifest?.adapters ?? []).map((entry) => [entry.key, entry]));
  const rawNodes = extractNodes(snapshot);
  const rawEdges = extractEdges(snapshot);
  const nodes: Record<string, CompiledWorkflowNode> = {};

  rawNodes.forEach((rawNode, index) => {
    if (!isRecord(rawNode)) {
      issues.push({ severity: 'error', code: 'NODE_NOT_OBJECT', message: 'Node must be an object', path: `nodes[${index}]` });
      return;
    }
    const id = firstString(rawNode.id, rawNode.node_id, rawNode.key);
    if (!id) {
      issues.push({ severity: 'error', code: 'NODE_ID_MISSING', message: 'Node ID is required', path: `nodes[${index}]` });
      return;
    }
    if (nodes[id]) {
      issues.push({ severity: 'error', code: 'NODE_ID_DUPLICATE', message: `Duplicate node ID: ${id}`, node_id: id });
      return;
    }
    const type = firstString(rawNode.type, rawNode.node_type, 'Unknown') ?? 'Unknown';
    let adapter = strictV3 ? extractEffectiveV3Adapter(rawNode) : extractNativeAdapter(rawNode);
    if (!adapter && (format === 'universal_v2' || strictV3)) {
      issues.push({ severity: 'error', code: 'NATIVE_ADAPTER_MISSING', message: `${format} requires implementation.native_adapter`, node_id: id });
      adapter = '__invalid__/missing';
    } else if (!adapter) {
      if (options.allow_legacy_fallback === true || runtimeMode === 'legacy') {
        adapter = firstString(rawNode.agent_key, rawNode.type, rawNode.node_type, '__invalid__/missing') ?? '__invalid__/missing';
        issues.push({ severity: 'warning', code: 'LEGACY_ADAPTER_FALLBACK', message: `Legacy fallback selected adapter ${adapter}`, node_id: id });
      } else {
        adapter = '__invalid__/missing';
        issues.push({ severity: 'error', code: 'NATIVE_ADAPTER_MISSING', message: 'Native adapter is required in graph modes', node_id: id });
      }
    }
    const manifestEntry = manifest.get(adapter);
    if (strictV3 && !isV3AtomicAdapter(adapter)) {
      issues.push({ severity: 'error', code: 'V3_ATOMIC_ADAPTER_REQUIRED', message: `universal_v3 only accepts built-in atomic qa-*/v2 adapters: ${adapter}`, node_id: id });
    }
    if (options.runtime_manifest && !manifestEntry) {
      issues.push({ severity: 'error', code: 'UNKNOWN_RUNTIME_ADAPTER', message: `Adapter is not present in runtime manifest: ${adapter}`, node_id: id });
    }
    const contractVersion = extractContractVersion(rawNode);
    if (manifestEntry) {
      if (!manifestEntry.purposes.includes('*') && !manifestEntry.purposes.includes(purpose)) {
        issues.push({ severity: 'error', code: 'ADAPTER_PURPOSE_MISMATCH', message: `${adapter} does not support ${purpose}`, node_id: id });
      }
      if (!manifestEntry.contract_versions.includes(contractVersion)) {
        issues.push({ severity: 'error', code: 'ADAPTER_CONTRACT_MISMATCH', message: `${adapter} does not support contract ${contractVersion}`, node_id: id });
      }
    }
    const prompt = extractPrompt(rawNode);
    const config = record(rawNode.config_json ?? extractConfig(rawNode));
    const requestedCapabilities = stringArray(rawNode.capabilities ?? record(record(rawNode.universal_agent).contract).capabilities);
    const allowedCapabilities = new Set(manifestEntry?.capabilities ?? requestedCapabilities);
    const invalidCapabilities = requestedCapabilities.filter((capability) => !allowedCapabilities.has(capability));
    if (invalidCapabilities.length > 0) {
      issues.push({ severity: 'error', code: 'CAPABILITY_NOT_ALLOWED', message: `Capabilities not allowed by adapter: ${invalidCapabilities.join(', ')}`, node_id: id });
    }
    const timeoutSeconds = firstNumber(rawNode.timeout_sec);
    const timeoutRequested = Math.max(1, Math.floor(firstNumber(rawNode.timeout_ms, config.timeout_ms, timeoutSeconds === undefined ? undefined : timeoutSeconds * 1000, 30_000) ?? 30_000));
    const timeout = Math.min(timeoutRequested, options.global_max_timeout_ms ?? timeoutRequested);
    const retryPolicy = compileRetryPolicy(rawNode, manifestEntry);
    const boundedRetryPolicy = {
      ...retryPolicy,
      max_attempts: Math.min(retryPolicy.max_attempts, options.global_max_attempts ?? retryPolicy.max_attempts),
    };
    const universalContract = record(record(rawNode.universal_agent).contract);
    const contractPorts = record(universalContract.ports);
    // V3 control ports belong to the immutable agent contract. Graph-level
    // aliases must not create capabilities that final contract enforcement
    // would reject at runtime. V1/V2 keep their compatibility precedence.
    const inputPorts = strictV3
      ? stringArray(contractPorts.control_inputs)
      : stringArray(rawNode.input_ports ?? config.input_ports ?? record(rawNode.ports).inputs ?? contractPorts.control_inputs);
    const outputPorts = strictV3
      ? stringArray(contractPorts.control_outputs)
      : stringArray(rawNode.output_ports ?? config.output_ports ?? record(rawNode.ports).outputs ?? contractPorts.control_outputs);
    const terminalPorts = stringArray(rawNode.terminal_ports ?? config.terminal_ports ?? record(rawNode.terminal_policy).ports);
    if (strictV3 && outputPorts.length === 0) {
      issues.push({ severity: 'error', code: 'OUTPUT_PORTS_MISSING', message: 'universal_v3 nodes must declare output ports', node_id: id });
    }
    if (strictV3) {
      for (const terminalPort of terminalPorts) {
        if (!outputPorts.includes(terminalPort)) {
          issues.push({ severity: 'error', code: 'V3_TERMINAL_PORT_UNDECLARED', message: `Terminal port ${terminalPort} is not declared by ${id}`, node_id: id });
        }
      }
    }
    nodes[id] = {
      id,
      type,
      enabled: rawNode.enabled !== false,
      native_adapter: adapter,
      contract_version: contractVersion,
      prompt,
      prompt_hash: hash(prompt),
      implementation_hash: hash({ adapter, contractVersion }),
      timeout_ms: timeout,
      retry_policy: boundedRetryPolicy,
      capabilities: requestedCapabilities,
      input_mapping: record(rawNode.input_mapping ?? config.input_mapping ?? universalContract.input_mapping),
      output_mapping: record(rawNode.output_mapping ?? config.output_mapping ?? universalContract.output_mapping),
      input_ports: inputPorts,
      output_ports: outputPorts,
      terminal_ports: terminalPorts,
      config,
    };
  });

  const edges: CompiledWorkflowEdge[] = [];
  rawEdges.forEach((rawEdge, index) => {
    if (!isRecord(rawEdge)) {
      issues.push({ severity: 'error', code: 'EDGE_NOT_OBJECT', message: 'Edge must be an object', path: `edges[${index}]` });
      return;
    }
    const id = firstString(rawEdge.id, rawEdge.edge_id, `edge-${index}`) ?? `edge-${index}`;
    const source = firstString(rawEdge.source_node_id, rawEdge.source, rawEdge.from);
    const target = firstString(rawEdge.target_node_id, rawEdge.target, rawEdge.to);
    if (!source || !target) {
      issues.push({ severity: 'error', code: 'EDGE_ENDPOINT_MISSING', message: 'Edge source and target are required', edge_id: id });
      return;
    }
    if (!nodes[source]) issues.push({ severity: 'error', code: 'EDGE_SOURCE_UNKNOWN', message: `Unknown source node: ${source}`, edge_id: id });
    if (!nodes[target]) issues.push({ severity: 'error', code: 'EDGE_TARGET_UNKNOWN', message: `Unknown target node: ${target}`, edge_id: id });
    let condition: unknown;
    try {
      condition = normalizeCondition(conditionForEdge(rawEdge));
    } catch (error) {
      issues.push({ severity: 'error', code: 'CONDITION_INVALID', message: error instanceof Error ? error.message : String(error), edge_id: id });
      condition = { op: 'always' };
    }
    const priority = Math.floor(firstNumber(rawEdge.priority, 0) ?? 0);
    const maxPasses = firstNumber(rawEdge.max_passes, record(rawEdge.condition_json).max_passes);
    edges.push({
      id,
      source_node_id: source,
      source_port: firstString(rawEdge.source_handle, rawEdge.source_port, rawEdge.output_port),
      target_node_id: target,
      target_port: firstString(rawEdge.target_handle, rawEdge.target_port, rawEdge.input_port),
      priority,
      max_passes: maxPasses === undefined ? undefined : Math.max(1, Math.floor(maxPasses)),
      condition,
      data_mapping: dataMappingForEdge(rawEdge),
    });
  });

  const inbound = new Set(edges.map((edge) => edge.target_node_id));
  const graph = record(snapshot.graph);
  const explicitEntry = firstString(snapshot.entry_node_id, graph.entry_node_id, workflow.entry_node_id, policy.entry_node_id);
  const candidates = Object.values(nodes).filter((node) => node.enabled && !inbound.has(node.id));
  const entry = explicitEntry ?? (candidates.length === 1 ? candidates[0].id : undefined);
  if (!entry || !nodes[entry]) {
    issues.push({ severity: 'error', code: 'ENTRY_NODE_INVALID', message: explicitEntry ? `Entry node does not exist: ${explicitEntry}` : `Expected one entry node, found ${candidates.length}` });
  }
  if (entry && nodes[entry] && !nodes[entry].enabled) {
    issues.push({ severity: 'error', code: 'ENTRY_NODE_DISABLED', message: `Entry node is disabled: ${entry}`, node_id: entry });
  }
  if (strictV3 && !explicitEntry) {
    issues.push({ severity: 'error', code: 'V3_ENTRY_NODE_REQUIRED', message: 'universal_v3 requires an explicit entry_node_id', path: 'workflow.decision_policy_json.entry_node_id' });
  }

  if (strictV3) {
    for (const edge of edges) {
      const sourceNode = nodes[edge.source_node_id];
      if (!edge.source_port) {
        issues.push({ severity: 'error', code: 'V3_SOURCE_PORT_REQUIRED', message: 'Every universal_v3 edge requires source_handle', edge_id: edge.id });
      } else if (sourceNode && !sourceNode.output_ports.includes(edge.source_port)) {
        issues.push({ severity: 'error', code: 'V3_SOURCE_PORT_UNDECLARED', message: `Edge port ${edge.source_port} is not declared by ${sourceNode.id}`, edge_id: edge.id });
      }
      const targetNode = nodes[edge.target_node_id];
      if (!edge.target_port) {
        issues.push({ severity: 'error', code: 'V3_TARGET_PORT_REQUIRED', message: 'Every universal_v3 edge requires target_handle', edge_id: edge.id });
      } else if (targetNode && !targetNode.input_ports.includes(edge.target_port)) {
        issues.push({ severity: 'error', code: 'V3_TARGET_PORT_UNDECLARED', message: `Edge target port ${edge.target_port} is not declared by ${targetNode.id}`, edge_id: edge.id });
      }
    }
    const enabledOutgoing = new Set(edges.filter((edge) => nodes[edge.source_node_id]?.enabled && nodes[edge.target_node_id]?.enabled).map((edge) => edge.source_node_id));
    for (const node of Object.values(nodes).filter((candidate) => candidate.enabled)) {
      if (!enabledOutgoing.has(node.id) && node.terminal_ports.length === 0) {
        issues.push({ severity: 'error', code: 'V3_TERMINAL_PORT_REQUIRED', message: `Terminal universal_v3 node ${node.id} must declare terminal_ports`, node_id: node.id });
      }
    }
  }

  // Detect obvious ambiguous unconditional edges. Runtime still checks all matched conditions.
  const groups = new Map<string, CompiledWorkflowEdge[]>();
  for (const edge of edges) {
    const key = `${edge.source_node_id}:${edge.priority}`;
    const group = groups.get(key) ?? [];
    group.push(edge); groups.set(key, group);
  }
  for (const group of groups.values()) {
    const unconditional = group.filter((edge) => isRecord(edge.condition) && edge.condition.op === 'always');
    if (unconditional.length > 1) {
      issues.push({ severity: 'error', code: 'AMBIGUOUS_UNCONDITIONAL_EDGES', message: `Multiple unconditional edges share priority: ${unconditional.map((edge) => edge.id).join(', ')}`, node_id: group[0].source_node_id });
    }
  }

  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0 || !entry) return { ok: false, issues };
  const planWithoutHash = {
    workflow_id: String(snapshot.workflow_id ?? snapshot.id ?? snapshot.name ?? 'unknown'),
    workflow_version: String(snapshot.version ?? record(snapshot.workflow).version ?? 'unknown'),
    purpose,
    format,
    runtime_mode: runtimeMode,
    entry_node_id: entry,
    nodes,
    edges,
    compiled_at: (options.now?.() ?? new Date()).toISOString(),
  };
  const plan: CompiledWorkflowPlan = { ...planWithoutHash, plan_hash: hash({ ...planWithoutHash, compiled_at: undefined }) };
  return { ok: true, plan, issues };
}
