import test from 'node:test'
import assert from 'node:assert/strict'
import { mapWorkflowEdgesToFlowEdges } from './workflowFlowMappers'

test('maps legacy handles to declared universal ports so edges remain visible', () => {
  const edges = mapWorkflowEdgesToFlowEdges({
    nodes: [
      { id: 'source', type: 'Custom', name: 'Source', agent_key: 'SOURCE', enabled: true, universal_agent: { version_id: 'v1', version: '1.0.0', contract: { ports: { control_outputs: ['success', 'failed'] } } } },
      { id: 'target', type: 'Custom', name: 'Target', agent_key: 'TARGET', enabled: true, universal_agent: { version_id: 'v2', version: '1.0.0', contract: { ports: { control_inputs: ['input'] } } } },
    ],
    edges: [{ id: 'edge', source_node_id: 'source', target_node_id: 'target', source_handle: 'source-right', target_handle: 'target-left', condition_type: 'always' }],
  } as any, new Map([
    ['source', { id: 'source', type: 'Custom', name: 'Source', agent_key: 'SOURCE', enabled: true, universal_agent: { version_id: 'v1', version: '1.0.0', contract: { ports: { control_outputs: ['success', 'failed'] } } } } as any],
    ['target', { id: 'target', type: 'Custom', name: 'Target', agent_key: 'TARGET', enabled: true, universal_agent: { version_id: 'v2', version: '1.0.0', contract: { ports: { control_inputs: ['input'] } } } } as any],
  ]))
  assert.equal(edges[0].sourceHandle, 'success')
  assert.equal(edges[0].targetHandle, 'input')
  assert.equal((edges[0].markerEnd as any)?.type, 'arrowclosed')
})
