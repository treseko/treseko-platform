import assert from 'node:assert/strict';
import test from 'node:test';
import { compileWorkflowSnapshot } from './compiler.ts';
import { executeWorkflowGraph, type WorkflowDefinition } from '../workflow.ts';

function contract(adapter: string, outputs: string[], inputs = ['input']) {
  return {
    contract_version: 'treseko.universal-agent/v1',
    version: '1',
    key: adapter,
    implementation: { runtime_key: 'universal-agent-runtime/v1', native_adapter: adapter, editable_strategy: 'none' },
    inputs: { schema: {}, mapping: {} },
    instructions: { mode: 'none', objective: 'V3 regression' },
    capabilities: ['memory.read'],
    output_contract: { schema: {}, publish: {} },
    memory: { read_namespaces: ['execution'], write_namespaces: ['execution'] },
    execution: { timeout_sec: 30, max_retries: 0, model: {} },
    ports: { control_inputs: inputs, control_outputs: outputs },
    security: { allow_private_network: false, allow_filesystem: false, allow_shell: false, allow_arbitrary_code: false },
    ui: { category: 'qa' },
  };
}

function node(args: {
  id: string;
  adapter?: string;
  outputs?: string[];
  inputs?: string[];
  terminal?: string[];
  enabled?: boolean;
  config?: Record<string, unknown>;
  retry?: Record<string, unknown>;
  timeoutSec?: number;
}) {
  const adapter = args.adapter ?? 'qa-execution-reporter/v2';
  const outputs = args.outputs ?? ['reported', 'failed', 'blocked'];
  return {
    id: args.id,
    name: args.id,
    type: 'Reporter',
    agent_key: 'REPORTER',
    enabled: args.enabled ?? true,
    timeout_sec: args.timeoutSec,
    retry_policy: args.retry,
    config_json: { terminal_ports: args.terminal ?? [], ...(args.config ?? {}) },
    universal_agent: {
      version_id: `${args.id}-version`,
      version: '1.0.0',
      contract: contract(adapter, outputs, args.inputs),
    },
  };
}

function definition(args: {
  nodes?: any[];
  edges?: any[];
  policy?: Record<string, unknown>;
} = {}): WorkflowDefinition {
  return {
    workflow: {
      id: 'v3-adversarial',
      name: 'V3 adversarial',
      version: 3,
      workflow_format: 'universal_v3',
      workflow_purpose: 'test_execution',
      decision_policy_json: {
        runtime_mode: 'graph_native',
        source_of_truth: 'persisted_graph',
        legacy_step_runner_allowed: false,
        entry_node_id: 'entry',
        ...(args.policy ?? {}),
      },
    },
    nodes: args.nodes ?? [node({ id: 'entry', terminal: ['reported'] })],
    edges: args.edges ?? [],
  };
}

function compile(input: WorkflowDefinition) {
  return compileWorkflowSnapshot(input as any, {
    allow_legacy_fallback: false,
    global_max_attempts: 10,
  });
}

test('V3 requires persisted_graph and explicitly disables the legacy step runner', () => {
  const wrongSource = compile(definition({ policy: { source_of_truth: 'runtime_code' } }));
  const legacyAllowed = compile(definition({ policy: { legacy_step_runner_allowed: true } }));
  const missingFlags = compile(definition({ policy: { source_of_truth: undefined, legacy_step_runner_allowed: undefined } }));

  assert.equal(wrongSource.ok, false);
  assert.ok(wrongSource.issues.some((issue) => issue.code === 'V3_REQUIRES_PERSISTED_GRAPH'));
  assert.equal(legacyAllowed.ok, false);
  assert.ok(legacyAllowed.issues.some((issue) => issue.code === 'V3_LEGACY_STEP_RUNNER_FORBIDDEN'));
  assert.equal(missingFlags.ok, false);
  assert.ok(missingFlags.issues.some((issue) => issue.code === 'V3_REQUIRES_PERSISTED_GRAPH'));
  assert.ok(missingFlags.issues.some((issue) => issue.code === 'V3_LEGACY_STEP_RUNNER_FORBIDDEN'));
});

test('V3 control ports come only from the immutable contract', () => {
  const result = compile(definition({
    nodes: [node({
      id: 'entry',
      outputs: ['reported'],
      terminal: ['forged-output'],
      config: { output_ports: ['forged-output'], input_ports: ['forged-input'] },
    })],
  }));

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'V3_TERMINAL_PORT_UNDECLARED'));
});

test('V3 compiles config_json.runtime_adapter as the effective adapter and hashes it', () => {
  const original = definition({ nodes: [node({ id: 'entry', adapter: 'qa-execution-reporter/v2', outputs: ['planned'], terminal: ['planned'] })] });
  const overridden = definition({ nodes: [node({
    id: 'entry',
    adapter: 'qa-execution-reporter/v2',
    outputs: ['planned'],
    terminal: ['planned'],
    config: { runtime_adapter: 'qa-action-planner/v2' },
  })] });
  const originalResult = compile(original);
  const overriddenResult = compile(overridden);

  assert.equal(originalResult.ok, true, JSON.stringify(originalResult.issues));
  assert.equal(overriddenResult.ok, true, JSON.stringify(overriddenResult.issues));
  assert.equal(overriddenResult.plan?.nodes.entry.native_adapter, 'qa-action-planner/v2');
  assert.notEqual(overriddenResult.plan?.plan_hash, originalResult.plan?.plan_hash);
});

test('V3 rejects legacy and unknown qa adapters even when a handler exists', async () => {
  for (const adapter of ['legacy-executor/v1', 'qa-made-up/v2']) {
    let calls = 0;
    const result = await executeWorkflowGraph(
      definition({ nodes: [node({ id: 'entry', adapter, outputs: ['success'], terminal: ['success'] })] }),
      { executionId: `execution-${adapter}`, caseId: 'case', context: {} },
      { [adapter]: async () => { calls += 1; return { status: 'SUCCESS', events: [], decision: { route: { outputPort: 'success' } } }; } },
    );
    assert.equal(result.status, 'BLOCKED');
    assert.equal(calls, 0);
    assert.equal(result.lastOutput?.decision?.graph_runtime_error_code, 'V3_COMPILE_FAILED');
    assert.ok((result.lastOutput?.decision?.compile_issues ?? []).some((issue: any) => issue.code === 'V3_ATOMIC_ADAPTER_REQUIRED'));
  }
});

test('V3 runtime dispatches only the adapter captured by the compiled plan', async () => {
  let contractCalls = 0;
  let overrideCalls = 0;
  const result = await executeWorkflowGraph(
    definition({ nodes: [node({
      id: 'entry',
      adapter: 'qa-execution-reporter/v2',
      outputs: ['planned'],
      terminal: ['planned'],
      config: { runtime_adapter: 'qa-action-planner/v2' },
    })] }),
    { executionId: 'adapter-plan', caseId: 'case', context: {} },
    {
      'qa-execution-reporter/v2': async () => {
        contractCalls += 1;
        return { status: 'SUCCESS', output_port: 'planned', reason_code: 'WRONG', data: {} } as any;
      },
      'qa-action-planner/v2': async () => {
        overrideCalls += 1;
        return { status: 'SUCCESS', output_port: 'planned', reason_code: 'PLANNED', data: {} } as any;
      },
    },
  );

  assert.equal(result.status, 'PASSED');
  assert.equal(contractCalls, 0);
  assert.equal(overrideCalls, 1);
  assert.equal(result.traces[0].metrics_json.implementation, 'qa-action-planner/v2');
  assert.match(String(result.traces[0].metrics_json.graph_plan_hash), /^[a-f0-9]{64}$/);
});

test('V3 runtime obeys the compiled retry ceiling instead of the raw node policy', async () => {
  let calls = 0;
  const result = await executeWorkflowGraph(
    definition({ nodes: [node({
      id: 'entry',
      adapter: 'qa-action-planner/v2',
      outputs: ['retry'],
      terminal: ['retry'],
      retry: { max_attempts: 25, retryable_reason_codes: ['TRANSIENT'] },
    })] }),
    { executionId: 'retry-plan', caseId: 'case', context: {} },
    {
      'qa-action-planner/v2': async () => {
        calls += 1;
        return { status: 'RETRYABLE', output_port: 'retry', reason_code: 'TRANSIENT', data: {} } as any;
      },
    },
  );

  assert.equal(calls, 10);
  assert.equal(result.status, 'FAILED');
  assert.equal(result.lastOutput?.decision?.technical_attempts, 10);
});

test('V3 runtime obeys the timeout bounded by the compiled plan', async () => {
  const started = Date.now();
  const result = await executeWorkflowGraph(
    definition({ nodes: [node({
      id: 'entry',
      adapter: 'qa-action-planner/v2',
      outputs: ['blocked'],
      terminal: ['blocked'],
      timeoutSec: 60,
    })] }),
    { executionId: 'timeout-plan', caseId: 'case', context: {} },
    { 'qa-action-planner/v2': async () => new Promise(() => {}) },
    { timeoutMs: 25 },
  );

  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.lastOutput?.decision?.reason_code, 'NODE_TIMEOUT');
  assert.ok(Date.now() - started < 500, 'compiled timeout was not enforced');
  assert.equal(result.traces[0].metrics_json.timeout_ms, 25);
});

test('V3 validates target ports, enabled entry, and declared terminal ports', () => {
  const targetPort = compile(definition({
    nodes: [
      node({ id: 'entry', adapter: 'qa-action-planner/v2', outputs: ['planned'] }),
      node({ id: 'end', inputs: ['input'], terminal: ['reported'] }),
    ],
    edges: [{
      id: 'edge', source_node_id: 'entry', target_node_id: 'end', source_handle: 'planned', target_handle: 'ghost',
      condition_type: 'output_port', condition_json: { output_port: 'planned' },
    }],
  }));
  const disabledEntry = compile(definition({ nodes: [node({ id: 'entry', enabled: false, terminal: ['reported'] })] }));
  const missingTerminal = compile(definition({ nodes: [node({ id: 'entry', terminal: [] })] }));
  const undeclaredTerminal = compile(definition({ nodes: [node({ id: 'entry', outputs: ['reported'], terminal: ['ghost'] })] }));

  assert.ok(targetPort.issues.some((issue) => issue.code === 'V3_TARGET_PORT_UNDECLARED'));
  assert.ok(disabledEntry.issues.some((issue) => issue.code === 'ENTRY_NODE_DISABLED'));
  assert.ok(missingTerminal.issues.some((issue) => issue.code === 'V3_TERMINAL_PORT_REQUIRED'));
  assert.ok(undeclaredTerminal.issues.some((issue) => issue.code === 'V3_TERMINAL_PORT_UNDECLARED'));
});

test('V3 blocks ambiguous matching edges with equal priority', async () => {
  let targetCalls = 0;
  const result = await executeWorkflowGraph(
    definition({
      nodes: [
        node({ id: 'entry', adapter: 'qa-action-planner/v2', outputs: ['planned'] }),
        node({ id: 'left', outputs: ['reported'], terminal: ['reported'] }),
        node({ id: 'right', outputs: ['reported'], terminal: ['reported'] }),
      ],
      edges: [
        { id: 'left-edge', source_node_id: 'entry', target_node_id: 'left', source_handle: 'planned', target_handle: 'input', priority: 5, condition_type: 'output_port', condition_json: { output_port: 'planned' } },
        { id: 'right-edge', source_node_id: 'entry', target_node_id: 'right', source_handle: 'planned', target_handle: 'input', priority: 5, condition_type: 'output_port', condition_json: { output_port: 'planned' } },
      ],
    }),
    { executionId: 'ambiguous-edge', caseId: 'case', context: {} },
    {
      'qa-action-planner/v2': async () => ({ status: 'SUCCESS', output_port: 'planned', reason_code: 'PLANNED', data: {} } as any),
      'qa-execution-reporter/v2': async () => {
        targetCalls += 1;
        return { status: 'SUCCESS', output_port: 'reported', reason_code: 'REPORTED', data: {} } as any;
      },
    },
  );

  assert.equal(result.status, 'BLOCKED');
  assert.equal(targetCalls, 0);
  assert.equal(result.lastOutput?.decision?.graph_runtime_error_code, 'AMBIGUOUS_EDGE_MATCH');
});
