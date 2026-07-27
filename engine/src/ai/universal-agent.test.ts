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
