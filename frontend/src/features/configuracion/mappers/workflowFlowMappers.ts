import { MarkerType, type Edge, type Node } from '@xyflow/react'
import { getEdgeUiMeta } from '../../../modules/ai-workflow/config/edge-ui.config'
import { WORKFLOW_LAYOUT_CONFIG } from '../../../modules/ai-workflow/config/workflow-layout.config'
import type { AiWorkflow, AiWorkflowEdge, AiWorkflowNode } from '../types/configuracion'
import {
  defaultWorkflowPositions,
  isFeedbackWorkflowEdge,
  shouldShowWorkflowEdgeLabel,
} from './configuracionMappers'

export const createWorkflowNodesById = (workflow: AiWorkflow) => {
  return new Map((workflow.nodes || []).map(node => [node.id, node]))
}

export const mapWorkflowNodesToFlowNodes = (workflow: AiWorkflow, autoLayoutEnabled: boolean) => {
  return (workflow.nodes || []).map((node, index) => ({
    id: node.id,
    type: 'workflowNode',
    position: { x: Number(node.position_x || 0), y: Number(node.position_y || 0) },
    data: { node, index },
    draggable: !autoLayoutEnabled,
    selectable: true,
  })) as Node[]
}

export const mapWorkflowEdgesToFlowEdges = (
  workflow: AiWorkflow,
  nodesByIdForEdges: Map<string, AiWorkflowNode>,
) => {
  return (workflow.edges || []).map(edge => {
    const meta = getEdgeUiMeta(edge, nodesByIdForEdges)
    const feedbackEdge = isFeedbackWorkflowEdge(edge, nodesByIdForEdges)
    const targetNode = nodesByIdForEdges.get(edge.target_node_id)
    const sourceHandle = feedbackEdge || targetNode?.type === 'Recovery' ? 'source-bottom' : 'source-right'
    const targetHandle = feedbackEdge ? 'target-bottom' : targetNode?.type === 'Recovery' ? 'target-top' : 'target-left'
    const label = shouldShowWorkflowEdgeLabel(edge, meta.label, feedbackEdge) ? meta.label : ''

    return {
      id: edge.id,
      source: edge.source_node_id,
      target: edge.target_node_id,
      sourceHandle,
      targetHandle,
      type: 'smoothstep',
      label,
      animated: feedbackEdge || meta.animated,
      className: `workflow-flow-edge is-${String(meta.label || 'default').replace(/[^a-z0-9_-]+/gi, '-')}`,
      markerEnd: { type: MarkerType.ArrowClosed, color: meta.color, width: 18, height: 18 },
      style: {
        stroke: meta.color,
        strokeWidth: feedbackEdge ? 2 : meta.strokeWidth,
        ...(feedbackEdge ? { strokeDasharray: '6 6' } : {}),
      },
      labelStyle: { fill: meta.color, fontWeight: 800, fontSize: 12 },
      labelBgStyle: { fill: '#fff', fillOpacity: 0.95 },
      labelBgPadding: [8, 4] as [number, number],
      labelBgBorderRadius: 8,
      zIndex: feedbackEdge ? 0 : 1,
      data: edge,
    }
  }) as Edge[]
}

export const applyDefaultWorkflowLayout = (rawNodes: Node[]) => {
  return rawNodes.map(node => {
    const workflowNode = (node.data as any).node as AiWorkflowNode
    return {
      ...node,
      position: defaultWorkflowPositions[workflowNode.type] || node.position,
    }
  }) as Node[]
}

export const createWorkflowElkGraph = (
  rawNodes: Node[],
  mappedEdges: Edge[],
  nodesByIdForEdges: Map<string, AiWorkflowNode>,
) => {
  const layoutEdges = mappedEdges.filter(edge => !isFeedbackWorkflowEdge(edge.data as AiWorkflowEdge, nodesByIdForEdges))
  return {
    id: 'workflow',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': WORKFLOW_LAYOUT_CONFIG.direction,
      'elk.spacing.nodeNode': String(WORKFLOW_LAYOUT_CONFIG.nodeSeparation),
      'elk.spacing.edgeEdge': String(WORKFLOW_LAYOUT_CONFIG.edgeSeparation),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(WORKFLOW_LAYOUT_CONFIG.rankSeparation),
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.edgeRouting': 'ORTHOGONAL',
    },
    children: rawNodes.map(node => ({ id: node.id, width: WORKFLOW_LAYOUT_CONFIG.nodeWidth, height: WORKFLOW_LAYOUT_CONFIG.nodeHeight })),
    edges: layoutEdges.map(edge => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  }
}

export const applyElkWorkflowLayout = (rawNodes: Node[], layouted: any) => {
  const positions = new Map((layouted.children || []).map((child: any) => [child.id, { x: child.x || 0, y: child.y || 0 }]))
  return rawNodes.map(node => ({ ...node, position: positions.get(node.id) || node.position })) as Node[]
}

export const createWorkflowDraftFromSource = (source?: AiWorkflow | null) => {
  const idMap = new Map<string, string>()
  const nodes = (source?.nodes || []).map(node => {
    const id = crypto.randomUUID()
    idMap.set(node.id, id)
    return { ...node, id, locked: false, name: node.name, workflow_id: undefined }
  })
  const edges = (source?.edges || []).map(edge => ({
    ...edge,
    id: crypto.randomUUID(),
    workflow_id: undefined,
    source_node_id: idMap.get(edge.source_node_id) || edge.source_node_id,
    target_node_id: idMap.get(edge.target_node_id) || edge.target_node_id,
  }))

  return { name: 'Nuevo workflow IA', version: 1, status: 'DRAFT', is_default: false, nodes, edges }
}
