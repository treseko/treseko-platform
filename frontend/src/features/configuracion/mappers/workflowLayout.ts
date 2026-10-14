import type { Edge, Node } from '@xyflow/react'
import { WORKFLOW_LAYOUT_CONFIG } from '../../../modules/ai-workflow/config/workflow-layout.config'
import type { AiWorkflowEdge, AiWorkflowNode } from '../types/configuracion'
import { isFeedbackWorkflowEdge } from './configuracionMappers'

/** Stable layered layout for custom acyclic workflows; cyclic graphs keep user positions. */
export function applyWorkflowLayout(
  rawNodes: Node[],
  mappedEdges: Edge[],
  nodesById: Map<string, AiWorkflowNode>,
): Node[] {
  const nodeById = new Map(rawNodes.map((node, index) => [node.id, { node, index }]))
  const rank = new Map(rawNodes.map(node => [node.id, 0]))
  const incoming = new Map(rawNodes.map(node => [node.id, 0]))
  const outgoing = new Map(rawNodes.map(node => [node.id, [] as string[]]))

  mappedEdges.forEach(edge => {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) return
    if (isFeedbackWorkflowEdge(edge.data as AiWorkflowEdge, nodesById)) return
    outgoing.get(edge.source)?.push(edge.target)
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1)
  })

  const compareNodeIds = (leftId: string, rightId: string) => {
    const left = nodeById.get(leftId)!
    const right = nodeById.get(rightId)!
    return left.node.position.y - right.node.position.y
      || left.node.position.x - right.node.position.x
      || left.index - right.index
  }
  const ready = rawNodes.filter(node => incoming.get(node.id) === 0).map(node => node.id).sort(compareNodeIds)
  const ordered: string[] = []

  while (ready.length) {
    const sourceId = ready.shift()!
    ordered.push(sourceId)
    for (const targetId of outgoing.get(sourceId) || []) {
      rank.set(targetId, Math.max(rank.get(targetId) || 0, (rank.get(sourceId) || 0) + 1))
      const remainingIncoming = (incoming.get(targetId) || 0) - 1
      incoming.set(targetId, remainingIncoming)
      if (remainingIncoming === 0) {
        ready.push(targetId)
        ready.sort(compareNodeIds)
      }
    }
  }

  if (ordered.length !== rawNodes.length) return rawNodes

  const lanes = new Map<number, string[]>()
  ordered.forEach(id => {
    const depth = rank.get(id) || 0
    lanes.set(depth, [...(lanes.get(depth) || []), id])
  })
  const rankSize = WORKFLOW_LAYOUT_CONFIG.nodeWidth + WORKFLOW_LAYOUT_CONFIG.rankSeparation
  const laneSize = WORKFLOW_LAYOUT_CONFIG.nodeHeight + WORKFLOW_LAYOUT_CONFIG.nodeSeparation

  return rawNodes.map(node => {
    const depth = rank.get(node.id) || 0
    const lane = lanes.get(depth) || []
    const laneIndex = lane.indexOf(node.id)
    return {
      ...node,
      position: { x: depth * rankSize, y: laneIndex * laneSize },
    }
  }) as Node[]
}
