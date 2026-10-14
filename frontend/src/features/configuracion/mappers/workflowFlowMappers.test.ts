import test from 'node:test'
import assert from 'node:assert/strict'
import { mapWorkflowEdgesToFlowEdges } from './workflowFlowMappers'
import { applyWorkflowLayout } from './workflowLayout'

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

test('lays out custom acyclic workflow nodes in stable left-to-right ranks', () => {
  const nodes: any[] = [
    { id: 'start', position: { x: 400, y: 240 }, data: { node: { id: 'start', type: 'Custom' } } },
    { id: 'left', position: { x: 0, y: 0 }, data: { node: { id: 'left', type: 'Custom' } } },
    { id: 'right', position: { x: 0, y: 400 }, data: { node: { id: 'right', type: 'Custom' } } },
    { id: 'join', position: { x: 900, y: 240 }, data: { node: { id: 'join', type: 'Custom' } } },
  ]
  const edges: any[] = [
    { id: 'start-left', source: 'start', target: 'left', data: { source_node_id: 'start', target_node_id: 'left' } },
    { id: 'start-right', source: 'start', target: 'right', data: { source_node_id: 'start', target_node_id: 'right' } },
    { id: 'left-join', source: 'left', target: 'join', data: { source_node_id: 'left', target_node_id: 'join' } },
    { id: 'right-join', source: 'right', target: 'join', data: { source_node_id: 'right', target_node_id: 'join' } },
  ]
  const nodesById = new Map(nodes.map(node => [node.id, node.data.node]))
  const result = applyWorkflowLayout(nodes, edges, nodesById)
  const positions = Object.fromEntries(result.map(node => [node.id, node.position]))

  assert.deepEqual(positions, {
    start: { x: 0, y: 0 },
    left: { x: 520, y: 0 },
    right: { x: 520, y: 200 },
    join: { x: 1040, y: 0 },
  })
})

test('preserves current workflow positions when a non-feedback cycle prevents layering', () => {
  const nodes: any[] = [
    { id: 'a', position: { x: 30, y: 70 }, data: { node: { id: 'a', type: 'Custom' } } },
    { id: 'b', position: { x: 210, y: 140 }, data: { node: { id: 'b', type: 'Custom' } } },
  ]
  const edges: any[] = [
    { id: 'a-b', source: 'a', target: 'b', data: { source_node_id: 'a', target_node_id: 'b' } },
    { id: 'b-a', source: 'b', target: 'a', data: { source_node_id: 'b', target_node_id: 'a' } },
  ]

  assert.equal(applyWorkflowLayout(nodes, edges, new Map()).every((node, index) => node === nodes[index]), true)
})
