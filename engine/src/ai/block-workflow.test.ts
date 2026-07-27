import assert from 'node:assert/strict';
import test from 'node:test';
import { compileBlockWorkflow } from './block-workflow.ts';

test('V2 block workflows receive a contract marker without changing V1 graphs', () => {
  const legacy: any = { workflow: { id: 'legacy', workflow_format: 'legacy_v1' }, nodes: [{ id: 'a', name: 'Legacy', agent_key: 'CONTEXT_RESOLVER' }], edges: [] };
  assert.equal(compileBlockWorkflow(legacy), legacy);

  const blocks: any = { workflow: { id: 'blocks', workflow_format: 'block_v2' }, nodes: [{ id: 'a', name: 'Context', agent_key: 'BLOCK_CONTEXT_RESOLVER' }], edges: [] };
  assert.equal(compileBlockWorkflow(blocks).nodes[0].config_json?.block_contract_version, 'treseko.block/v1');
});

test('V2 rejects legacy keys so a conversion cannot silently run as V1', () => {
  const blocks: any = { workflow: { id: 'blocks', workflow_format: 'block_v2' }, nodes: [{ id: 'a', name: 'Context', agent_key: 'CONTEXT_RESOLVER' }], edges: [] };
  assert.throws(() => compileBlockWorkflow(blocks), /no declara un contrato/);
});
