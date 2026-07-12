import { addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type Edge, type Node, type OnConnect, type OnEdgesChange, type OnNodesChange } from '@xyflow/react'
import type { Dispatch, SetStateAction } from 'react'
import type { AiWorkflow, AiWorkflowEdge, AiWorkflowNode } from '../types/configuracion'

type UseWorkflowLocalEditsParams = {
  workflowDraft: AiWorkflow | null
  canEditAi: boolean
  autoLayoutEnabled: boolean
  setWorkflowDraft: (workflow: AiWorkflow) => void
  setAiWorkflows: Dispatch<SetStateAction<AiWorkflow[]>>
  setFlowNodes: Dispatch<SetStateAction<Node[]>>
  setFlowEdges: Dispatch<SetStateAction<Edge[]>>
  setSelectedWorkflowElement: (element: { type: 'node' | 'edge', id: string } | null) => void
  syncFlowFromWorkflow: (workflow: AiWorkflow | null) => void
  showFeedback: (title: string, message: string, variant?: string) => void
}

export function useWorkflowLocalEdits({
  workflowDraft,
  canEditAi,
  autoLayoutEnabled,
  setWorkflowDraft,
  setAiWorkflows,
  setFlowNodes,
  setFlowEdges,
  setSelectedWorkflowElement,
  syncFlowFromWorkflow,
  showFeedback,
}: UseWorkflowLocalEditsParams) {
  const updateWorkflowDraft = (patch: Partial<AiWorkflow>) => {
    if (!workflowDraft) return
    const next = { ...workflowDraft, ...patch }
    setWorkflowDraft(next)
    setAiWorkflows(prev => prev.map(item => item.id === next.id ? next : item))
  }

  const updateWorkflowNode = (nodeId: string, patch: Partial<AiWorkflowNode>) => {
    if (!workflowDraft) return
    const next = {
      ...workflowDraft,
      nodes: workflowDraft.nodes.map(node => node.id === nodeId ? { ...node, ...patch } : node),
    }
    setWorkflowDraft(next)
    syncFlowFromWorkflow(next)
  }

  const updateWorkflowNodeConfig = (nodeId: string, patch: Record<string, any>) => {
    const node = workflowDraft?.nodes.find(item => item.id === nodeId)
    updateWorkflowNode(nodeId, { config_json: { ...(node?.config_json || {}), ...patch } })
  }

  const updateWorkflowEdge = (edgeId: string, patch: Partial<AiWorkflowEdge>) => {
    if (!workflowDraft) return
    const next = {
      ...workflowDraft,
      edges: workflowDraft.edges.map(edge => edge.id === edgeId ? { ...edge, ...patch } : edge),
    }
    setWorkflowDraft(next)
    syncFlowFromWorkflow(next)
  }

  const deleteWorkflowNode = (nodeId: string) => {
    if (!workflowDraft || !canEditAi) return
    const node = workflowDraft.nodes.find(item => item.id === nodeId)
    if (!node) return
    if (node.locked) {
      showFeedback('Workflow IA', 'Este nodo base esta bloqueado y no se puede eliminar.', 'warning')
      return
    }
    const next = {
      ...workflowDraft,
      nodes: workflowDraft.nodes.filter(item => item.id !== nodeId),
      edges: workflowDraft.edges.filter(edge => edge.source_node_id !== nodeId && edge.target_node_id !== nodeId),
    }
    setSelectedWorkflowElement(null)
    setWorkflowDraft(next)
    setAiWorkflows(prev => prev.map(item => item.id === next.id ? next : item))
    syncFlowFromWorkflow(next)
  }

  const deleteWorkflowEdge = (edgeId: string) => {
    if (!workflowDraft || !canEditAi) return
    const next = {
      ...workflowDraft,
      edges: workflowDraft.edges.filter(edge => edge.id !== edgeId),
    }
    setSelectedWorkflowElement(null)
    setWorkflowDraft(next)
    setAiWorkflows(prev => prev.map(item => item.id === next.id ? next : item))
    syncFlowFromWorkflow(next)
  }

  const onWorkflowNodeContextMenu = (event: any, node: Node) => {
    event.preventDefault()
    deleteWorkflowNode(node.id)
  }

  const onWorkflowEdgeContextMenu = (event: any, edge: Edge) => {
    event.preventDefault()
    deleteWorkflowEdge(edge.id)
  }

  const onWorkflowNodesChange: OnNodesChange = (changes) => {
    setFlowNodes(nodes => applyNodeChanges(changes, nodes))
  }

  const onWorkflowEdgesChange: OnEdgesChange = (changes) => {
    setFlowEdges(edges => applyEdgeChanges(changes, edges))
  }

  const onWorkflowNodeDragStop = (_event: any, node: Node) => {
    if (autoLayoutEnabled) return
    if (!workflowDraft) return
    const next = {
      ...workflowDraft,
      nodes: workflowDraft.nodes.map(item => item.id === node.id
        ? { ...item, position_x: Math.round(node.position.x), position_y: Math.round(node.position.y) }
        : item),
    }
    setWorkflowDraft(next)
    setAiWorkflows(prev => prev.map(item => item.id === next.id ? next : item))
    setFlowNodes(nodes => nodes.map(item => item.id === node.id ? { ...item, position: node.position } : item))
  }

  const onWorkflowConnect: OnConnect = (connection: Connection) => {
    if (!workflowDraft || !connection.source || !connection.target) return
    const edge: AiWorkflowEdge = {
      id: crypto.randomUUID(),
      source_node_id: connection.source,
      target_node_id: connection.target,
      condition_type: 'always',
      condition_json: {},
      priority: 10,
      max_passes: 1,
    }
    const next = { ...workflowDraft, edges: [...workflowDraft.edges, edge] }
    setWorkflowDraft(next)
    setFlowEdges(edges => addEdge({ id: edge.id, source: edge.source_node_id, target: edge.target_node_id, label: edge.condition_type }, edges))
    syncFlowFromWorkflow(next)
  }

  return {
    updateWorkflowDraft,
    updateWorkflowNode,
    updateWorkflowNodeConfig,
    updateWorkflowEdge,
    onWorkflowNodeContextMenu,
    onWorkflowEdgeContextMenu,
    onWorkflowNodesChange,
    onWorkflowEdgesChange,
    onWorkflowNodeDragStop,
    onWorkflowConnect,
  }
}
