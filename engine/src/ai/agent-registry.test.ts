import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkflowRuntime } from './agent-registry.ts';

test('allows the Treseko core workflow including the pre-execution analyst', () => {
  assert.deepEqual(validateWorkflowRuntime({
    workflow: { id: 'default', name: 'default', version: 1 },
    nodes: [
      { id: 'context', agent_key: 'CONTEXT_RESOLVER', type: 'ContextResolver', name: 'Context', enabled: true },
      { id: 'analyst', agent_key: 'PRE_EXECUTION_ANALYST', type: 'PreExecutionAnalyst', name: 'Analyst', enabled: true },
      { id: 'reporter', agent_key: 'REPORTER', type: 'Reporter', name: 'Reporter', enabled: true },
    ],
    edges: [],
  }), []);
});

test('rejects catalog-only blocks before they are implemented', () => {
  const result = validateWorkflowRuntime({
    workflow: { id: 'draft', name: 'draft', version: 1 },
    nodes: [{ id: 'vision', agent_key: 'VISION_AGENT', type: 'VisionAgent', name: 'Vision', enabled: true }],
    edges: [],
  });
  assert.equal(result.length, 1);
});

test('rejects a core definition wired to the wrong runtime handler', () => {
  const result = validateWorkflowRuntime({
    workflow: { id: 'invalid', name: 'invalid', version: 1 },
    nodes: [{ id: 'validator', agent_key: 'VALIDATOR', type: 'Auditor', name: 'Validator', enabled: true }],
    edges: [],
  });
  assert.equal(result.length, 1);
});

test('allows registered universal adapters even when their node type is custom', () => {
  const result = validateWorkflowRuntime({
    workflow: { id: 'universal', name: 'universal', version: 1, workflow_format: 'universal_v2' },
    nodes: [{
      id: 'transform', agent_key: 'CUSTOM_TRANSFORM', type: 'Transform', name: 'Transform', enabled: true,
      universal_agent: {
        version_id: 'v1', version: '1.0.0', contract: {
          contract_version: 'treseko.universal-agent/v1', key: 'transform', version: '1.0.0',
          implementation: { runtime_key: 'universal-agent-runtime/v1', native_adapter: 'universal-transform/v1', editable_strategy: 'mapping' },
          inputs: { schema: {}, mapping: {} }, instructions: { mode: 'deterministic', objective: 'Transformar' },
          capabilities: ['context.transform', 'memory.write'], output_contract: { schema: {}, publish: {}, required_evidence: [] },
          memory: { read_namespaces: ['execution'], write_namespaces: ['execution'] }, execution: { timeout_sec: 60, max_retries: 0, model: {} },
          ports: { control_inputs: ['input'], control_outputs: ['success', 'failed', 'blocked', 'retry'] },
          security: { allow_private_network: false, allow_filesystem: false, allow_shell: false, allow_arbitrary_code: false }, ui: { category: 'control' },
        },
      },
    }],
    edges: [],
  });
  assert.deepEqual(result, []);
});
