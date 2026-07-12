import { Form } from 'react-bootstrap'
import { Network } from 'lucide-react'
import {
  Background,
  ConnectionLineType,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react'
import type { AiWorkflow } from '../../types/configuracion'

type Props = {
  workflowDraft: AiWorkflow | null
  canEditAi: boolean
  autoLayoutEnabled: boolean
  workflowChangelog: string
  setWorkflowChangelog: (value: string) => void
  updateWorkflowDraft: (patch: Partial<AiWorkflow>) => void
  renderFlowNodes: Node[]
  renderFlowEdges: Edge[]
  workflowNodeTypes: any
  workflowEdgeDebugEnabled: boolean
  onWorkflowNodesChange: OnNodesChange
  onWorkflowEdgesChange: OnEdgesChange
  onWorkflowNodeDragStop: (event: any, node: Node) => void
  onWorkflowConnect: OnConnect
  onWorkflowNodeContextMenu: (event: any, node: Node) => void
  onWorkflowEdgeContextMenu: (event: any, edge: Edge) => void
  selectWorkflowElement: (element: { type: 'node' | 'edge', id: string } | null) => void
  closeWorkflowProperties: () => void
}

export function WorkflowCanvas({
  workflowDraft,
  canEditAi,
  autoLayoutEnabled,
  workflowChangelog,
  setWorkflowChangelog,
  updateWorkflowDraft,
  renderFlowNodes,
  renderFlowEdges,
  workflowNodeTypes,
  workflowEdgeDebugEnabled,
  onWorkflowNodesChange,
  onWorkflowEdgesChange,
  onWorkflowNodeDragStop,
  onWorkflowConnect,
  onWorkflowNodeContextMenu,
  onWorkflowEdgeContextMenu,
  selectWorkflowElement,
  closeWorkflowProperties,
}: Props) {
  return (
    <section className="workflow-canvas-shell">
      <div className="workflow-canvas-header">
        <div className="workflow-canvas-title">
          <Network size={16} className="text-primary" />
          <Form.Control
            size="sm"
            className="workflow-name-input"
            value={workflowDraft?.name || ''}
            disabled={!canEditAi || !workflowDraft}
            onChange={(event) => updateWorkflowDraft({ name: event.target.value })}
          />
        </div>
        <div className="workflow-canvas-controls">
          <Form.Control
            size="sm"
            className="workflow-changelog-input"
            placeholder="Changelog para publicar/restaurar"
            value={workflowChangelog}
            disabled={!canEditAi || !workflowDraft}
            onChange={(event) => setWorkflowChangelog(event.target.value)}
          />
        </div>
      </div>
      <div className="workflow-canvas">
        <ReactFlow
          nodes={renderFlowNodes}
          edges={renderFlowEdges}
          nodeTypes={workflowEdgeDebugEnabled ? undefined : workflowNodeTypes}
          connectionLineType={ConnectionLineType.SmoothStep}
          defaultEdgeOptions={{ type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } }}
          snapToGrid
          snapGrid={[16, 16]}
          nodesDraggable={!autoLayoutEnabled}
          nodesConnectable={canEditAi}
          onNodesChange={onWorkflowNodesChange}
          onEdgesChange={onWorkflowEdgesChange}
          onNodeDragStop={onWorkflowNodeDragStop}
          onConnect={(connection: Connection) => onWorkflowConnect(connection)}
          onNodeClick={(_event, node) => selectWorkflowElement({ type: 'node', id: node.id })}
          onEdgeClick={(_event, edge) => selectWorkflowElement({ type: 'edge', id: edge.id })}
          onNodeContextMenu={onWorkflowNodeContextMenu}
          onEdgeContextMenu={onWorkflowEdgeContextMenu}
          onPaneClick={closeWorkflowProperties}
        >
          <MiniMap pannable zoomable nodeStrokeWidth={3} style={{ width: 160, height: 100 }} />
          <Controls />
          <Background gap={18} size={1.4} color="#D6DEE9" />
        </ReactFlow>
      </div>
    </section>
  )
}
