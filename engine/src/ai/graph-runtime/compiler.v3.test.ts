import assert from 'node:assert/strict';
import test from 'node:test';
import { compileWorkflowSnapshot } from './compiler.ts';

const universalContract = (adapter: string, outputs: string[]) => ({
  contract_version: 'treseko.universal-agent/v1',
  version: '1',
  implementation: { native_adapter: adapter },
  ports: { control_inputs: ['input'], control_outputs: outputs },
});

test('compiles the real persisted universal_v3 DB shape', () => {
  const result = compileWorkflowSnapshot({
    workflow: {
      id: 'wf-v3', version: 3, workflow_format: 'universal_v3', workflow_purpose: 'test_execution',
      decision_policy_json: { runtime_mode: 'graph_native', source_of_truth: 'persisted_graph', legacy_step_runner_allowed: false, entry_node_id: 'start' },
    },
    nodes: [
      { id: 'start', type: 'Planner', prompt_template: 'Prompt real', config_json: { terminal_ports: [] }, universal_agent: { contract: universalContract('qa-action-planner/v2', ['planned', 'failed']) } },
      { id: 'end', type: 'Reporter', config_json: { terminal_ports: ['reported'] }, universal_agent: { contract: universalContract('qa-execution-reporter/v2', ['reported', 'failed']) } },
    ],
    edges: [{ id: 'planned', source_node_id: 'start', target_node_id: 'end', source_handle: 'planned', target_handle: 'input', condition_type: 'output_port', condition_json: { output_port: 'planned' }, data_mapping_json: [{ source: 'outputs.action', target: 'inputs.action' }] }],
  } as any);

  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.plan?.format, 'universal_v3');
  assert.equal(result.plan?.purpose, 'test_execution');
  assert.equal(result.plan?.runtime_mode, 'graph_native');
  assert.equal(result.plan?.entry_node_id, 'start');
  assert.deepEqual(result.plan?.nodes.start.output_ports, ['planned', 'failed']);
  assert.deepEqual(result.plan?.edges[0].data_mapping, [{ source: 'outputs.action', target: 'inputs.action' }]);
});

test('rejects V3 legacy fallback and untyped edges', () => {
  const result = compileWorkflowSnapshot({
    workflow: { id: 'bad', workflow_format: 'universal_v3', workflow_purpose: 'test_execution', decision_policy_json: { runtime_mode: 'legacy', source_of_truth: 'persisted_graph', legacy_step_runner_allowed: false, entry_node_id: 'a' } },
    nodes: [
      { id: 'a', type: 'Planner', output_ports: ['success'] },
      { id: 'b', type: 'Reporter', output_ports: ['success'], universal_agent: { contract: universalContract('qa-execution-reporter/v2', ['success']) } },
    ],
    edges: [{ id: 'edge', source_node_id: 'a', target_node_id: 'b', condition_type: 'always' }],
  } as any);

  assert.equal(result.ok, false);
  const codes = result.issues.map((issue) => issue.code);
  assert.ok(codes.includes('V3_REQUIRES_GRAPH_NATIVE'));
  assert.ok(codes.includes('NATIVE_ADAPTER_MISSING'));
  assert.ok(codes.includes('V3_SOURCE_PORT_REQUIRED'));
});
