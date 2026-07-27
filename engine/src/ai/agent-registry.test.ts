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
