import { useEffect } from 'react'
import type { Edge, Node } from '@xyflow/react'

type UseWorkflowDebugTraceParams = {
  workflowDebug: boolean
  workflowBuilderOpen: boolean
  workflowEdgeDebugEnabled: boolean
  renderFlowNodes: Node[]
  renderFlowEdges: Edge[]
}

const workflowDebugAllowed = Boolean((import.meta as any).env?.DEV)
const workflowDebugLog = (...args: unknown[]) => {
  if (workflowDebugAllowed) console.log(...args)
}
const workflowDebugTable = (data: unknown) => {
  if (workflowDebugAllowed) console.table(data)
}

export function useWorkflowDebugTrace({
  workflowDebug,
  workflowBuilderOpen,
  workflowEdgeDebugEnabled,
  renderFlowNodes,
  renderFlowEdges,
}: UseWorkflowDebugTraceParams) {
  useEffect(() => {
    if (!workflowDebug) return
    if (!workflowBuilderOpen && !workflowEdgeDebugEnabled) return
    workflowDebugLog('reactflow render nodes/edges', renderFlowNodes.length, renderFlowEdges.length)
    workflowDebugTable(renderFlowNodes.map(node => ({ id: node.id, type: node.type, x: node.position?.x, y: node.position?.y })))
    workflowDebugTable(renderFlowEdges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle })))
    workflowDebugLog('reactflow edge node id validation', renderFlowEdges.every(edge =>
      renderFlowNodes.some(node => node.id === edge.source) &&
      renderFlowNodes.some(node => node.id === edge.target)
    ))
    const timer = window.setTimeout(() => {
      workflowDebugLog('react-flow__edge-path count', document.querySelectorAll('.react-flow__edge-path').length)
      workflowDebugLog('edge paths', document.querySelectorAll('.react-flow__edge-path').length)
      workflowDebugLog('edge svgs', document.querySelectorAll('.react-flow__edge').length)
      workflowDebugLog('edges pane', document.querySelector('.react-flow__edges')?.getBoundingClientRect())
      const firstPath = document.querySelector('.react-flow__edge-path') as SVGPathElement | null
      workflowDebugLog('first edge path d', firstPath?.getAttribute('d'))
      workflowDebugLog('first edge path stroke attr', firstPath?.getAttribute('stroke'))
      workflowDebugLog('first edge path exists', Boolean(firstPath))
      try {
        workflowDebugLog('first edge path bbox', firstPath?.getBBox())
      } catch (error) {
        workflowDebugLog('first edge path bbox error', error)
      }
      workflowDebugLog('first edge path rect', firstPath?.getBoundingClientRect())
      const edgesSvg = document.querySelector('.react-flow__edges') as SVGElement | null
      workflowDebugLog('edges svg rect', edgesSvg?.getBoundingClientRect())
      workflowDebugLog('edges svg overflow', edgesSvg ? getComputedStyle(edgesSvg).overflow : null)
      workflowDebugLog('edges svg width attr', edgesSvg?.getAttribute('width'))
      workflowDebugLog('edges svg height attr', edgesSvg?.getAttribute('height'))
      workflowDebugLog('edges svg style width', edgesSvg ? getComputedStyle(edgesSvg).width : null)
      workflowDebugLog('edges svg style height', edgesSvg ? getComputedStyle(edgesSvg).height : null)
      workflowDebugLog('workflow canvas rect', document.querySelector('.workflow-canvas')?.getBoundingClientRect())
      workflowDebugLog('react-flow rect', document.querySelector('.workflow-canvas .react-flow')?.getBoundingClientRect())
      workflowDebugLog('react-flow renderer rect', document.querySelector('.workflow-canvas .react-flow__renderer')?.getBoundingClientRect())
      if (firstPath) {
        const firstPathStyle = getComputedStyle(firstPath)
        workflowDebugLog('first edge path computed stroke', firstPathStyle.stroke)
        workflowDebugLog('first edge path computed opacity', firstPathStyle.opacity)
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [renderFlowEdges, renderFlowNodes, workflowBuilderOpen, workflowDebug, workflowEdgeDebugEnabled])
}
