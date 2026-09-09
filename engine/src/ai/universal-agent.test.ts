import test from 'node:test';
import assert from 'node:assert/strict';
import { executeWorkflowGraph, type WorkflowDefinition } from './workflow.ts';
import { validateUniversalAgentContract } from './universal-agent.ts';

const contract = {
  contract_version: 'treseko.universal-agent/v1',
  key: 'test-agent', version: '1.0.0',
  implementation: { runtime_key: 'universal-agent-runtime/v1', native_adapter: 'legacy-reporter/v1', editable_strategy: 'none' },
  inputs: { schema: {}, mapping: {} }, instructions: { mode: 'deterministic', objective: 'Probar contrato' },
  capabilities: ['report.generate'], output_contract: { schema: {}, publish: {}, required_evidence: [] },
  memory: { read_namespaces: ['execution'], write_namespaces: ['execution'] },
  execution: { timeout_sec: 60, max_retries: 0, model: {} },
  ports: { control_inputs: ['input'], control_outputs: ['success', 'failed', 'blocked', 'retry'] },
  security: { allow_private_network: false, allow_filesystem: false, allow_shell: false, allow_arbitrary_code: false },
  ui: { category: 'reporting' },
};

const v3Contract = {
  ...contract,
  implementation: { ...contract.implementation, native_adapter: 'qa-execution-reporter/v2' },
};

test('validates a safe universal contract and rejects host access', () => {
  assert.doesNotThrow(() => validateUniversalAgentContract(contract));
  assert.throws(() => validateUniversalAgentContract({ ...contract, security: { ...contract.security, allow_shell: true } }));
});

test('executes a universal node through its registered handler and records contract metadata', async () => {
  const definition: WorkflowDefinition = {
    workflow: { id: 'workflow', name: 'Universal', version: 1, workflow_format: 'universal_v2' },
    nodes: [{ id: 'report', name: 'Reporte', type: 'Reporter', agent_key: 'UNIVERSAL_REPORTER', enabled: true, universal_agent: { version_id: 'version-1', version: '1.0.0', contract } }],
    edges: [],
  };
  const result = await executeWorkflowGraph(definition, { executionId: 'e-1', caseId: 'c-1', context: {} }, {
    Reporter: async () => ({ status: 'SUCCESS', reason: 'ok', confidence: 100, events: [], sharedMemoryPatch: { report: 'done' } }),
  });
  assert.equal(result.status, 'PASSED');
  assert.equal(result.sharedMemory.report, 'done');
  assert.equal((result.lastOutput?.decision?.universal_result?.outputs as any)?.report, 'done');
  assert.equal(result.traces[0].metrics_json.workflow_format, 'universal_v2');
  assert.equal(result.traces[0].metrics_json.implementation, 'legacy-reporter/v1');
});

test('graph mode dispatches by persisted native adapter, not visual node type', async () => {
  const definition: WorkflowDefinition = {
    workflow: { id: 'workflow', name: 'Graph authoritative', version: 1, workflow_format: 'universal_v2', runtime_mode: 'graph_compat' },
    nodes: [{ id: 'planner', name: 'Planner', type: 'Executor', agent_key: 'WRONG_KEY', enabled: true, universal_agent: {
      version_id: 'version-1', version: '1.0.0', contract: { ...contract, implementation: { ...contract.implementation, native_adapter: 'legacy-planner/v1' } },
    } }],
    edges: [],
  };
  const result = await executeWorkflowGraph(definition, { executionId: 'e-graph', caseId: 'c-graph', context: {} }, {
    Planner: async () => ({ status: 'SUCCESS', reason: 'native adapter selected', events: [] }),
    Executor: async () => ({ status: 'FAILED', reason: 'wrong visual handler selected', events: [] }),
  });
  assert.equal(result.status, 'PASSED');
  assert.equal(result.lastOutput?.reason, 'native adapter selected');
});

test('graph mode persists and dispatches a node-level adapter override', async () => {
  const definition: WorkflowDefinition = {
    workflow: { id: 'workflow', name: 'Graph override', version: 1, workflow_format: 'universal_v2', runtime_mode: 'graph_native' },
    nodes: [{ id: 'planner', name: 'Planner', type: 'Reporter', agent_key: 'WRONG_KEY', enabled: true,
      config_json: { runtime_adapter: 'legacy-planner/v1' },
      universal_agent: { version_id: 'version-1', version: '1.0.0', contract },
    }],
    edges: [],
  };
  const result = await executeWorkflowGraph(definition, { executionId: 'e-override', caseId: 'c-override', context: {} }, {
    Planner: async () => ({ status: 'SUCCESS', reason: 'override selected', events: [] }),
    Reporter: async () => ({ status: 'FAILED', reason: 'stored contract selected', events: [] }),
  });
  assert.equal(result.status, 'PASSED');
  assert.equal(result.lastOutput?.reason, 'override selected');
  assert.equal(result.traces[0].metrics_json.implementation, 'legacy-planner/v1');
});

test('graph mode blocks a universal node without a native adapter', async () => {
  const definition: WorkflowDefinition = {
    workflow: { id: 'workflow', name: 'Graph invalid', version: 1, workflow_format: 'universal_v2', runtime_mode: 'graph_native' },
    nodes: [{ id: 'broken', name: 'Broken', type: 'Reporter', agent_key: 'UNIVERSAL_REPORTER', enabled: true, universal_agent: {
      version_id: 'version-1', version: '1.0.0', contract: { ...contract, implementation: { ...contract.implementation, native_adapter: '' } },
    } }],
    edges: [],
  };
  const result = await executeWorkflowGraph(definition, { executionId: 'e-invalid', caseId: 'c-invalid', context: {} }, {
    Reporter: async () => ({ status: 'SUCCESS', events: [] }),
  });
  assert.equal(result.status, 'BLOCKED');
  assert.match(result.lastOutput?.reason || '', /contrato universal/i);
});

test('universal_v3 executes only the persisted adapter and records its compiled plan', async () => {
  const definition: WorkflowDefinition = {
    workflow: {
      id: 'workflow-v3', name: 'Graph V3', version: 3, workflow_format: 'universal_v3', workflow_purpose: 'test_execution',
      decision_policy_json: { runtime_mode: 'graph_native', source_of_truth: 'persisted_graph', legacy_step_runner_allowed: false, entry_node_id: 'report' },
    },
    nodes: [{
      id: 'report', name: 'Reporte V3', type: 'Executor', agent_key: 'WRONG_VISUAL_KEY', enabled: true,
      config_json: { terminal_ports: ['success'] },
      universal_agent: { version_id: 'version-v3', version: '1.0.0', contract: v3Contract },
    }],
    edges: [],
  };
  const result = await executeWorkflowGraph(definition, { executionId: 'e-v3', caseId: 'c-v3', context: {} }, {
    Reporter: async () => ({ status: 'SUCCESS', reason: 'persisted adapter executed', events: [] }),
    Executor: async () => ({ status: 'FAILED', reason: 'visual type executed', events: [] }),
  });
  assert.equal(result.status, 'PASSED');
  assert.equal(result.lastOutput?.reason, 'persisted adapter executed');
  assert.equal(result.traces[0].metrics_json.workflow_format, 'universal_v3');
  assert.match(String(result.traces[0].metrics_json.graph_plan_hash), /^[a-f0-9]{64}$/);
});

test('universal_v3 refuses to execute when graph_native is not persisted', async () => {
  const definition: WorkflowDefinition = {
    workflow: {
      id: 'workflow-v3-invalid', name: 'Invalid V3', version: 3, workflow_format: 'universal_v3', workflow_purpose: 'test_execution',
      decision_policy_json: { runtime_mode: 'legacy', source_of_truth: 'persisted_graph', legacy_step_runner_allowed: false, entry_node_id: 'report' },
    },
    nodes: [{
      id: 'report', name: 'Reporte V3', type: 'Reporter', agent_key: 'REPORTER', enabled: true,
      config_json: { terminal_ports: ['success'] },
      universal_agent: { version_id: 'version-v3', version: '1.0.0', contract: v3Contract },
    }],
    edges: [],
  };
  const result = await executeWorkflowGraph(definition, { executionId: 'e-v3-invalid', caseId: 'c-v3-invalid', context: {} }, {
    Reporter: async () => ({ status: 'SUCCESS', reason: 'must not run', events: [] }),
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.lastOutput?.decision?.graph_runtime_error_code, 'V3_COMPILE_FAILED');
  assert.match(result.lastOutput?.reason || '', /V3_REQUIRES_GRAPH_NATIVE/);
});

test('blocks a universal agent that requests a disabled capability', async () => {
  const definition: WorkflowDefinition = {
    workflow: { id: 'workflow', name: 'Universal', version: 1, workflow_format: 'universal_v2' },
    nodes: [{ id: 'report', name: 'Reporte', type: 'Reporter', agent_key: 'UNIVERSAL_REPORTER', enabled: true, universal_agent: { version_id: 'version-1', version: '1.0.0', contract: { ...contract, capabilities: ['agent.a2a_remote'] } } }],
    edges: [],
  };
  const result = await executeWorkflowGraph(definition, { executionId: 'e-1', caseId: 'c-1', context: {} }, { Reporter: async () => ({ status: 'SUCCESS', events: [] }) });
  assert.equal(result.status, 'BLOCKED');
});

test('routes a universal decision only through a declared output port', async () => {
  const routedContract = { ...contract, ports: { ...contract.ports, control_outputs: ['draft_ready', 'blocked', 'failed'] } };
  const definition: WorkflowDefinition = {
    workflow: { id: 'workflow', name: 'Typed', version: 1, workflow_format: 'universal_v2' },
    nodes: [
      { id: 'author', name: 'Autor', type: 'Author', agent_key: 'UNIVERSAL_AUTHOR', enabled: true, universal_agent: { version_id: 'v1', version: '1.0.0', contract: routedContract } },
      { id: 'good', name: 'Borrador', type: 'Reporter', agent_key: 'UNIVERSAL_REPORTER', enabled: true, universal_agent: { version_id: 'v1', version: '1.0.0', contract } },
      { id: 'bad', name: 'Incorrecto', type: 'Reporter', agent_key: 'UNIVERSAL_REPORTER', enabled: true, universal_agent: { version_id: 'v1', version: '1.0.0', contract } },
    ],
    edges: [
      { id: 'e1', source_node_id: 'author', target_node_id: 'good', source_handle: 'draft_ready', condition_type: 'output_port', condition_json: { value: 'draft_ready' } },
      { id: 'e2', source_node_id: 'author', target_node_id: 'bad', source_handle: 'failed', condition_type: 'output_port', condition_json: { value: 'failed' } },
    ],
  };
  const result = await executeWorkflowGraph(definition, { executionId: 'e', caseId: 'c', context: {} }, {
    Author: async () => ({ status: 'SUCCESS', confidence: 90, decision: { route: { outputPort: 'draft_ready' } }, events: [] }),
    Reporter: async (node) => ({ status: 'SUCCESS', reason: node.id, events: [] }),
  });
  assert.equal(result.lastOutput?.reason, 'good');
});

test('blocks undeclared ports and ignores arbitrary next in universal v2', async () => {
  const definition: WorkflowDefinition = {
    workflow: { id: 'workflow', name: 'Typed', version: 1, workflow_format: 'universal_v2' },
    nodes: [{ id: 'author', name: 'Autor', type: 'Reporter', agent_key: 'UNIVERSAL_REPORTER', enabled: true, universal_agent: { version_id: 'v1', version: '1.0.0', contract } }], edges: [],
  };
  const result = await executeWorkflowGraph(definition, { executionId: 'e', caseId: 'c', context: {} }, {
    Reporter: async () => ({ status: 'SUCCESS', next: 'missing', decision: { route: { outputPort: 'shell' } }, events: [] }),
  });
  assert.equal(result.status, 'BLOCKED');
  assert.match(result.lastOutput?.reason || '', /puerto no declarado/i);
});

test('passes declarative node input mappings to the node context', async () => {
  const definition: WorkflowDefinition = {
    workflow: { id: 'workflow', name: 'Mapped', version: 1 },
    nodes: [{
      id: 'review', name: 'Review', type: 'Reviewer', agent_key: 'REVIEWER', enabled: true,
      config_json: { input_mapping: { target_url: 'sharedMemory.base_url', goal: 'context.goal' } },
    }],
    edges: [],
  };
  let received: Record<string, any> = {};
  await executeWorkflowGraph(definition, {
    executionId: 'e', caseId: 'c', context: { goal: 'Confirmar compra' },
    sharedMemory: { base_url: 'https://example.test' },
  }, {
    Reviewer: async (_node, input) => {
      received = input.context.workflow_inputs;
      return { status: 'SUCCESS', events: [] };
    },
  });
  assert.deepEqual(received, { target_url: 'https://example.test', goal: 'Confirmar compra' });
});

test('publishes declarative node output mappings into shared memory', async () => {
  const definition: WorkflowDefinition = {
    workflow: { id: 'workflow', name: 'Output mapped', version: 1 },
    nodes: [{
      id: 'producer', name: 'Producer', type: 'Producer', agent_key: 'PRODUCER', enabled: true,
      config_json: { output_mapping: JSON.parse('{"sharedMemory.review_status":"decision.status","__proto__":"decision.reason"}') },
    }],
    edges: [],
  };
  const result = await executeWorkflowGraph(definition, { executionId: 'e', caseId: 'c', context: {} }, {
    Producer: async () => ({ status: 'SUCCESS', decision: { status: 'APPROVED' }, events: [] }),
  });
  assert.equal(result.sharedMemory.review_status, 'APPROVED');
  assert.equal((result.sharedMemory as any).polluted, undefined);
});

test('delivers universal edge mappings to the target node inputs', async () => {
  const universal = (key: string, adapter: string) => ({
    version_id: `v-${key}`, version: '1.0.0', contract: {
      ...contract, key, implementation: { ...contract.implementation, native_adapter: adapter },
      capabilities: ['memory.read', 'memory.write'],
    },
  });
  const definition: WorkflowDefinition = {
    workflow: { id: 'workflow', name: 'Mapped edge', version: 1, workflow_format: 'universal_v2' },
    nodes: [
      { id: 'source', name: 'Source', type: 'Source', agent_key: 'SOURCE', enabled: true, universal_agent: universal('source', 'universal-reporter/v1') },
      { id: 'target', name: 'Target', type: 'Target', agent_key: 'TARGET', enabled: true, universal_agent: universal('target', 'universal-transform/v1') },
    ],
    edges: [{ id: 'edge', source_node_id: 'source', target_node_id: 'target', condition_type: 'always', condition_json: {}, data_mapping_json: [{ source: 'outputs.result', target: 'inputs.source_result' }] }],
  };
  let received: Record<string, any> = {};
  const result = await executeWorkflowGraph(definition, { executionId: 'e', caseId: 'c', context: {} }, {
    Source: async () => ({ status: 'SUCCESS', decision: { outputs: { result: 'from-source' } }, events: [] }),
    Target: async (_node, input) => {
      received = input.context.workflow_inputs;
      return { status: 'SUCCESS', events: [] };
    },
  });
  assert.equal(result.status, 'PASSED');
  assert.deepEqual(received, { source_result: 'from-source' });
});

test('routes a rule agent through the configured output port', async () => {
  const definition: WorkflowDefinition = {
    workflow: { id: 'workflow', name: 'Router', version: 1, workflow_format: 'universal_v2' },
    nodes: [
      { id: 'router', name: 'Router', type: 'Router', agent_key: 'ROUTER', enabled: true, config_json: { rules: [{ path: 'context.kind', op: 'eq', value: 'review', outputPort: 'review' }] }, universal_agent: { version_id: 'v1', version: '1.0.0', contract: { ...contract, key: 'router', implementation: { ...contract.implementation, native_adapter: 'universal-rules/v1' }, ports: { ...contract.ports, control_outputs: ['success', 'failed', 'blocked', 'retry', 'review'] } } } },
      { id: 'review', name: 'Review', type: 'Reporter', agent_key: 'UNIVERSAL_REPORTER', enabled: true, universal_agent: { version_id: 'v1', version: '1.0.0', contract } },
    ],
    edges: [{ id: 'route-review', source_node_id: 'router', target_node_id: 'review', source_handle: 'review', condition_type: 'output_port', condition_json: { value: 'review' } }],
  };
  const result = await executeWorkflowGraph(definition, { executionId: 'e', caseId: 'c', context: { kind: 'review' } }, {
    Router: async (node, input) => {
      const { runRuleAgent } = await import('./custom-agents.ts');
      return runRuleAgent(node, input);
    },
    Reporter: async (node) => ({ status: 'SUCCESS', reason: node.id, events: [] }),
  });
  assert.equal(result.lastOutput?.reason, 'review');
});

test('does not treat a typed universal edge as a fallback when no port is published', async () => {
  const definition: WorkflowDefinition = {
    workflow: { id: 'workflow', name: 'Typed fallback', version: 1, workflow_format: 'universal_v2' },
    nodes: [
      { id: 'router', name: 'Router', type: 'Router', agent_key: 'ROUTER', enabled: true, universal_agent: { version_id: 'v1', version: '1.0.0', contract: { ...contract, key: 'router', ports: { ...contract.ports, control_outputs: ['success', 'failed', 'blocked', 'retry', 'review'] } } } },
      { id: 'review', name: 'Review', type: 'Reporter', agent_key: 'UNIVERSAL_REPORTER', enabled: true, universal_agent: { version_id: 'v1', version: '1.0.0', contract } },
    ],
    edges: [{ id: 'route-review', source_node_id: 'router', target_node_id: 'review', source_handle: 'review', condition_type: 'always', condition_json: {} }],
  };
  const result = await executeWorkflowGraph(definition, { executionId: 'e', caseId: 'c', context: {} }, {
    Router: async () => ({ status: 'SUCCESS', reason: 'router', events: [] }),
    Reporter: async (node) => ({ status: 'SUCCESS', reason: node.id, events: [] }),
  });
  assert.equal(result.status, 'PASSED');
  assert.equal(result.traces.length, 1);
  assert.equal(result.lastOutput?.reason, 'router');
});

test('executes a bounded universal subworkflow and returns its shared memory', async () => {
  const subworkflowContract = {
    ...contract,
    key: 'subworkflow',
    implementation: { ...contract.implementation, native_adapter: 'universal-subworkflow/v1' },
    capabilities: ['workflow.invoke', 'memory.read', 'memory.write', 'trace.write'],
  };
  const child: WorkflowDefinition = {
    workflow: { id: 'child', name: 'Child', version: 2, workflow_format: 'universal_v2' },
    nodes: [{ id: 'child-node', name: 'Child transform', type: 'Transform', agent_key: 'CHILD', enabled: true, universal_agent: { version_id: 'child-version', version: '1.0.0', contract: { ...contract, key: 'child-transform', implementation: { ...contract.implementation, native_adapter: 'universal-transform/v1' }, capabilities: ['context.transform', 'memory.write'] } } }],
    edges: [],
  };
  const definition: WorkflowDefinition = {
    workflow: { id: 'parent', name: 'Parent', version: 1, workflow_format: 'universal_v2' },
    nodes: [{ id: 'parent-node', name: 'Subworkflow', type: 'Subworkflow', agent_key: 'PARENT', enabled: true, universal_agent: { version_id: 'parent-version', version: '1.0.0', contract: subworkflowContract }, config_json: { subworkflow_definition: child } }],
    edges: [],
  };
  const result = await executeWorkflowGraph(definition, { executionId: 'e', caseId: 'c', context: {}, sharedMemory: { input: 'ok' } }, {
    Transform: async () => ({ status: 'SUCCESS', reason: 'child complete', events: [], sharedMemoryPatch: { child_output: 'done' } }),
  });
  assert.equal(result.status, 'PASSED');
  assert.equal(result.sharedMemory.child_output, 'done');
  assert.equal(result.lastOutput?.decision?.subworkflow?.workflow_version, 2);
});

test('blocks recursive universal subworkflows at the configured depth limit', async () => {
  const recursive: any = { workflow: { id: 'recursive', name: 'Recursive', version: 1, workflow_format: 'universal_v2' }, nodes: [], edges: [] };
  recursive.nodes = [{ id: 'recursive-node', name: 'Recursive', type: 'Subworkflow', agent_key: 'RECURSIVE', enabled: true, universal_agent: { version_id: 'recursive-version', version: '1.0.0', contract: { ...contract, key: 'subworkflow', implementation: { ...contract.implementation, native_adapter: 'universal-subworkflow/v1' }, capabilities: ['workflow.invoke', 'memory.read', 'memory.write', 'trace.write'] } }, config_json: { subworkflow_definition: recursive } }];
  const result = await executeWorkflowGraph(recursive, { executionId: 'e', caseId: 'c', context: {}, sharedMemory: { __workflow_depth: 5 } }, {});
  assert.equal(result.status, 'BLOCKED');
  assert.match(result.lastOutput?.reason || '', /profundidad maxima/i);
});
