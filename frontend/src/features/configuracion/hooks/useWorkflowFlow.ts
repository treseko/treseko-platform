import { useEffect, useMemo, useRef, useState } from 'react'
import { MarkerType, useReactFlow, useUpdateNodeInternals, type Edge, type Node } from '@xyflow/react'
import { WorkflowNodeCard } from '../components/workflow/WorkflowNodeCard'
import {
  applyDefaultWorkflowLayout,
  applyElkWorkflowLayout,
  createWorkflowElkGraph,
  createWorkflowNodesById,
  mapWorkflowEdgesToFlowEdges,
  mapWorkflowNodesToFlowNodes,
} from '../mappers/workflowFlowMappers'
import { hasDefaultWorkflowTypes } from '../mappers/configuracionMappers'
import type { AiWorkflow, AiWorkflowNode } from '../types/configuracion'
import { useWorkflowDebugTrace } from './useWorkflowDebugTrace'
import type { Dispatch, SetStateAction } from 'react'

let elkInstance: Promise<InstanceType<typeof import('elkjs/lib/elk.bundled.js')['default']>> | null = null

function getElkInstance() {
  elkInstance ??= import('elkjs/lib/elk.bundled.js').then(({ default: ELK }) => new ELK())
  return elkInstance
}

const workflowDebugAllowed = Boolean((import.meta as any).env?.DEV)
const workflowEdgeDebugEnabled = workflowDebugAllowed && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('workflowEdgeDebug') === '1'
const workflowDebug = workflowDebugAllowed && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('workflowDebug') === '1'
const workflowDebugLog = (...args: unknown[]) => {
  if (workflowDebugAllowed) console.log(...args)
}
const workflowDebugTable = (data: unknown) => {
  if (workflowDebugAllowed) console.table(data)
}
const minimalEdgeTestNodes: Node[] = [
  { id: 'debug-a', position: { x: 80, y: 120 }, data: { label: 'Debug A' } },
  { id: 'debug-b', position: { x: 360, y: 120 }, data: { label: 'Debug B' } },
]
const minimalEdgeTestEdges: Edge[] = [
  { id: 'debug-edge-a-b', source: 'debug-a', target: 'debug-b', type: 'smoothstep', label: 'debug edge', markerEnd: { type: MarkerType.ArrowClosed } },
]

type UseWorkflowFlowParams = {
  workflowDraft: AiWorkflow | null
  setWorkflowDraft: (workflow: AiWorkflow | null) => void
  setAiWorkflows: Dispatch<SetStateAction<AiWorkflow[]>>
}

export function useWorkflowFlow({
  workflowDraft,
  setWorkflowDraft,
  setAiWorkflows,
}: UseWorkflowFlowParams) {
  const [flowNodes, setFlowNodes] = useState<Node[]>([])
  const [flowEdges, setFlowEdges] = useState<Edge[]>([])
  const [selectedWorkflowElement, setSelectedWorkflowElement] = useState<{ type: 'node' | 'edge', id: string } | null>(null)
  const [workflowPropertiesTab, setWorkflowPropertiesTab] = useState('general')
  const [autoLayoutEnabled, setAutoLayoutEnabled] = useState(false)
  const [workflowBuilderOpen, setWorkflowBuilderOpen] = useState(false)
  const syncRevisionRef = useRef(0)
  const updateNodeInternals = useUpdateNodeInternals()
  const reactFlowInstance = useReactFlow()
  const workflowNodeTypes = useMemo(() => ({ workflowNode: WorkflowNodeCard }), [])
  const renderFlowNodes = workflowEdgeDebugEnabled ? minimalEdgeTestNodes : flowNodes
  const renderFlowEdges = useMemo(() => {
    if (workflowEdgeDebugEnabled) return minimalEdgeTestEdges
    return flowEdges
  }, [flowEdges])

  useWorkflowDebugTrace({
    workflowDebug,
    workflowBuilderOpen,
    workflowEdgeDebugEnabled,
    renderFlowNodes,
    renderFlowEdges,
  })

  const workflowNodesById = useMemo(() => {
    const map = new Map<string, AiWorkflowNode>()
    ;(workflowDraft?.nodes || []).forEach(node => map.set(node.id, node))
    return map
  }, [workflowDraft])
  const selectedWorkflowNode = selectedWorkflowElement?.type === 'node'
    ? workflowNodesById.get(selectedWorkflowElement.id) || null
    : null
  const selectedWorkflowEdge = selectedWorkflowElement?.type === 'edge'
    ? (workflowDraft?.edges || []).find(edge => edge.id === selectedWorkflowElement.id) || null
    : null

  const refitWorkflow = (reason: string, nodes: Node[] = flowNodes) => {
    requestAnimationFrame(() => {
      nodes.forEach(node => updateNodeInternals(node.id))
      requestAnimationFrame(() => {
        reactFlowInstance.fitView({
          padding: 0.18,
          includeHiddenNodes: false,
          duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 300,
        })
        if (workflowDebug) {
          workflowDebugLog('workflow refit', reason, 'nodes', nodes.length, 'edge paths', document.querySelectorAll('.react-flow__edge-path').length)
        }
      })
    })
  }

  const openWorkflowBuilder = () => {
    setSelectedWorkflowElement(null)
    setWorkflowBuilderOpen(true)
  }

  const closeWorkflowProperties = () => {
    setSelectedWorkflowElement(null)
  }

  const selectWorkflowElement = (element: { type: 'node' | 'edge', id: string }) => {
    setSelectedWorkflowElement(element)
  }

  const persistWorkflowNodePositions = (workflow: AiWorkflow, layoutedNodes: Node[]) => {
    const positions = new Map(layoutedNodes.map(node => [node.id, node.position]))
    const next = {
      ...workflow,
      nodes: workflow.nodes.map(node => {
        const position = positions.get(node.id)
        return position ? { ...node, position_x: Math.round(position.x), position_y: Math.round(position.y) } : node
      }),
    }
    setWorkflowDraft(next)
    setAiWorkflows(prev => prev.map(item => item.id === next.id ? next : item))
    return next
  }

  const switchToManualMode = () => {
    if (workflowDraft && flowNodes.length > 0) {
      persistWorkflowNodePositions(workflowDraft, flowNodes)
      setFlowNodes(nodes => nodes.map(node => ({ ...node, draggable: true })))
    }
    setAutoLayoutEnabled(false)
  }

  const prepareManualPlacement = () => {
    // A palette drop intentionally changes the interaction mode, but never
    // triggers a layout or a viewport adjustment.
    setAutoLayoutEnabled(false)
    setFlowNodes(nodes => nodes.map(node => ({ ...node, draggable: true })))
  }

  const switchToAutoLayoutMode = () => {
    setAutoLayoutEnabled(true)
    if (workflowDraft) {
      syncFlowFromWorkflow(workflowDraft, {
        forceLayout: true,
        persistPositions: true,
        autoLayout: true,
        reason: 'auto layout requested',
      })
    }
  }

  const syncFlowFromWorkflow = (
    workflow: AiWorkflow | null,
    options: { forceLayout?: boolean, manual?: boolean, persistPositions?: boolean, autoLayout?: boolean, reason?: string } = {},
  ) => {
    const syncRevision = ++syncRevisionRef.current
    if (!workflow) {
      setFlowNodes([])
      setFlowEdges([])
      return
    }
    const layoutMode = options.manual ? false : (options.autoLayout ?? autoLayoutEnabled)
    // Layout is an explicit command. Synchronizing a saved or remotely updated
    // workflow must preserve the user's graph positions and viewport.
    const shouldLayout = !options.manual && Boolean(options.forceLayout)
    const nodesByIdForEdges = createWorkflowNodesById(workflow)
    const rawNodes = mapWorkflowNodesToFlowNodes(workflow, layoutMode)
    if (workflowDebug) workflowDebugLog('raw edges', (workflow.edges || []).length, workflow.edges || [])
    const mappedEdges = mapWorkflowEdgesToFlowEdges(workflow, nodesByIdForEdges)
    if (workflowDebug) workflowDebugLog('reactflow edges', mappedEdges.length, mappedEdges)
    setFlowEdges(mappedEdges)
    if (!shouldLayout) {
      if (workflowDebug) {
        workflowDebugLog('layout disabled nodes/edges')
        workflowDebugTable(rawNodes.map(node => ({ id: node.id, type: node.type, x: node.position?.x, y: node.position?.y })))
        workflowDebugTable(mappedEdges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle })))
        workflowDebugLog('layout disabled edge node id validation', mappedEdges.every(edge =>
          rawNodes.some(node => node.id === edge.source) &&
          rawNodes.some(node => node.id === edge.target)
        ))
      }
      setFlowNodes(rawNodes as Node[])
      return
    }
    if (hasDefaultWorkflowTypes(workflow.nodes || [])) {
      const layoutedNodes = applyDefaultWorkflowLayout(rawNodes)
      if (workflowDebug) {
        workflowDebugLog('canonical default workflow layout nodes/edges')
        workflowDebugTable(layoutedNodes.map(node => ({ id: node.id, type: node.type, x: node.position?.x, y: node.position?.y })))
      }
      setFlowNodes(layoutedNodes)
      if (options.persistPositions) persistWorkflowNodePositions(workflow, layoutedNodes)
      return
    }
    const graph = createWorkflowElkGraph(rawNodes, mappedEdges, nodesByIdForEdges)
    getElkInstance()
      .then(elk => elk.layout(graph as any))
      .then(layouted => {
        if (syncRevision !== syncRevisionRef.current) return
        const layoutedNodes = applyElkWorkflowLayout(rawNodes, layouted)
        if (workflowDebug) {
          workflowDebugLog('after layout nodes/edges')
          workflowDebugTable(layoutedNodes.map(node => ({ id: node.id, type: node.type, x: node.position?.x, y: node.position?.y })))
          workflowDebugTable(mappedEdges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle })))
          workflowDebugLog('after layout edge node id validation', mappedEdges.every(edge =>
            layoutedNodes.some(node => node.id === edge.source) &&
            layoutedNodes.some(node => node.id === edge.target)
          ))
        }
        setFlowNodes(layoutedNodes)
        if (options.persistPositions) persistWorkflowNodePositions(workflow, layoutedNodes)
      })
      .catch(() => {
        if (syncRevision !== syncRevisionRef.current) return
        setFlowNodes(rawNodes as Node[])
      })
  }

  useEffect(() => {
    if (workflowDraft) {
      setFlowNodes(nodes => nodes.map(node => ({ ...node, draggable: !autoLayoutEnabled })))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLayoutEnabled])

  return {
    flowNodes,
    setFlowNodes,
    setFlowEdges,
    selectedWorkflowElement,
    setSelectedWorkflowElement,
    workflowPropertiesTab,
    setWorkflowPropertiesTab,
    autoLayoutEnabled,
    workflowBuilderOpen,
    setWorkflowBuilderOpen,
    workflowNodeTypes,
    workflowEdgeDebugEnabled,
    renderFlowNodes,
    renderFlowEdges,
    selectedWorkflowNode,
    selectedWorkflowEdge,
    refitWorkflow,
    openWorkflowBuilder,
    closeWorkflowProperties,
    selectWorkflowElement,
    switchToManualMode,
    prepareManualPlacement,
    switchToAutoLayoutMode,
    syncFlowFromWorkflow,
  }
}
