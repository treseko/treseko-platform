import { useEffect, useRef, useState } from 'react'
import { updateAiWorkflow } from '../api/aiWorkflowApi'
import type { FetchWithAuth } from '../api/configuracionApi'
import type { AiAgentPreset, AiWorkflow, AiWorkflowEdge, AiWorkflowNode } from '../types/configuracion'
import type { Dispatch, SetStateAction } from 'react'
import { useI18n } from '../../../i18n'

type GraphOperationType = 'insert' | 'delete-node' | 'delete-edge' | 'connect' | 'move-node'

type GraphOperation = {
  id: string
  type: GraphOperationType
  apply: (workflow: AiWorkflow) => AiWorkflow
  undo?: (workflow: AiWorkflow) => AiWorkflow
  undoLabel?: string
}

const workflowDebug = Boolean((import.meta as any).env?.DEV)
  && typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('workflowDebug') === '1'

const logGraphOperation = (event: string, details: Record<string, unknown>) => {
  if (workflowDebug) console.info(`[workflow autosave] ${event}`, details)
}

type Params = {
  fetchWithAuth: FetchWithAuth
  workflowDraft: AiWorkflow | null
  setWorkflowDraft: (workflow: AiWorkflow) => void
  setAiWorkflows: Dispatch<SetStateAction<AiWorkflow[]>>
  syncFlowFromWorkflow: (workflow: AiWorkflow | null, options?: { manual?: boolean; reason?: string }) => void
  showFeedback: (title: string, message: string, variant?: string) => void
}

const applyOperations = (workflow: AiWorkflow, operations: GraphOperation[]) => {
  return operations.reduce((current, operation) => operation.apply(current), workflow)
}

export function useWorkflowGraphAutosave({
  fetchWithAuth,
  workflowDraft,
  setWorkflowDraft,
  setAiWorkflows,
  syncFlowFromWorkflow,
  showFeedback,
}: Params) {
  const { t } = useI18n()
  const confirmedRef = useRef<AiWorkflow | null>(null)
  const workflowIdRef = useRef<string | null>(null)
  const queueRef = useRef<GraphOperation[]>([])
  const processingRef = useRef(false)
  const activeOperationRef = useRef<string | null>(null)
  const undoOperationRef = useRef<GraphOperation | null>(null)
  const localRevisionRef = useRef(0)
  const confirmedRevisionRef = useRef(0)
  const undoTimerRef = useRef<number | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [undoAction, setUndoAction] = useState<{ operationId: string; label: string } | null>(null)

  const publishVisualGraph = (workflow: AiWorkflow) => {
    setWorkflowDraft(workflow)
    setAiWorkflows(previous => previous.map(item => item.id === workflow.id ? workflow : item))
    syncFlowFromWorkflow(workflow, { manual: true, reason: 'graph autosave' })
  }

  const clearUndoAction = () => {
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current)
    undoTimerRef.current = null
    undoOperationRef.current = null
    setUndoAction(null)
  }

  const publishQueuedGraph = () => {
    if (!confirmedRef.current) return
    publishVisualGraph(applyOperations(confirmedRef.current, queueRef.current))
  }

  const processQueue = async () => {
    if (processingRef.current || !confirmedRef.current || queueRef.current.length === 0) return
    const operation = queueRef.current[0]
    const confirmed = confirmedRef.current
    processingRef.current = true
    activeOperationRef.current = operation.id
    setSaveState('saving')
    logGraphOperation('persisting', {
      operationId: operation.id,
      type: operation.type,
      localRevision: localRevisionRef.current,
      confirmedRevision: confirmedRevisionRef.current,
    })
    try {
      const saved = await updateAiWorkflow(fetchWithAuth, operation.apply(confirmed))
      if (queueRef.current[0]?.id !== operation.id || workflowIdRef.current !== saved.id) {
        logGraphOperation('discarded stale response', { operationId: operation.id, type: operation.type })
        return
      }
      confirmedRef.current = saved
      queueRef.current.shift()
      confirmedRevisionRef.current += 1
      logGraphOperation('confirmed', {
        operationId: operation.id,
        type: operation.type,
        localRevision: localRevisionRef.current,
        confirmedRevision: confirmedRevisionRef.current,
      })
      publishQueuedGraph()
      setSaveState(queueRef.current.length > 0 ? 'saving' : 'saved')
      if (queueRef.current.length === 0) window.setTimeout(() => setSaveState('idle'), 1500)
    } catch (error: any) {
      if (queueRef.current[0]?.id === operation.id) queueRef.current.shift()
      logGraphOperation('failed', {
        operationId: operation.id,
        type: operation.type,
        message: error?.message || t('configuracion.workflowGraphSaveError'),
      })
      publishQueuedGraph()
      setSaveState('error')
      showFeedback(t('configuracion.workflowTitle'), error?.message || t('configuracion.workflowGraphSaveError'), 'danger')
    } finally {
      processingRef.current = false
      activeOperationRef.current = null
      if (queueRef.current.length > 0) void processQueue()
    }
  }

  const enqueue = (operation: GraphOperation) => {
    if (!confirmedRef.current || confirmedRef.current.status === 'ACTIVE') return false
    queueRef.current.push(operation)
    localRevisionRef.current += 1
    logGraphOperation('queued', {
      operationId: operation.id,
      type: operation.type,
      localRevision: localRevisionRef.current,
      confirmedRevision: confirmedRevisionRef.current,
      pending: queueRef.current.length,
    })
    publishQueuedGraph()
    void processQueue()
    return true
  }

  const registerUndo = (operation: GraphOperation) => {
    clearUndoAction()
    undoOperationRef.current = operation
    setUndoAction({ operationId: operation.id, label: operation.undoLabel || t('configuracion.workflowUndo') })
    undoTimerRef.current = window.setTimeout(clearUndoAction, 5000)
  }

  const enqueueInsert = (preset: AiAgentPreset, position: { x: number; y: number }) => {
    const node: AiWorkflowNode = {
      id: crypto.randomUUID(),
      type: preset.type,
      name: preset.name,
      agent_key: preset.key || `CUSTOM_${preset.type.toUpperCase()}`,
      agent_definition_id: preset.agent_definition_id || null,
      enabled: true,
      locked: false,
      prompt_template: preset.prompt_template || '',
      config_json: preset.config_json || {},
      position_x: Math.round(position.x),
      position_y: Math.round(position.y),
      timeout_sec: Number(preset.config_json?.timeout_sec || 60),
    }
    return enqueue({
      id: crypto.randomUUID(),
      type: 'insert',
      apply: workflow => ({ ...workflow, nodes: [...workflow.nodes, node] }),
      undo: workflow => ({ ...workflow, nodes: workflow.nodes.filter(item => item.id !== node.id), edges: workflow.edges.filter(edge => edge.source_node_id !== node.id && edge.target_node_id !== node.id) }),
    })
  }

  const enqueueDeleteNode = (nodeId: string) => {
    const current = confirmedRef.current ? applyOperations(confirmedRef.current, queueRef.current) : null
    const node = current?.nodes.find(item => item.id === nodeId)
    if (!node) return false
    const edges = current.edges.filter(edge => edge.source_node_id === nodeId || edge.target_node_id === nodeId)
    const operation: GraphOperation = {
      id: crypto.randomUUID(),
      type: 'delete-node',
      apply: workflow => ({ ...workflow, nodes: workflow.nodes.filter(item => item.id !== nodeId), edges: workflow.edges.filter(edge => edge.source_node_id !== nodeId && edge.target_node_id !== nodeId) }),
      undo: workflow => ({
        ...workflow,
        nodes: workflow.nodes.some(item => item.id === node.id) ? workflow.nodes : [...workflow.nodes, node],
        edges: [...workflow.edges, ...edges.filter(edge => !workflow.edges.some(item => item.id === edge.id))],
      }),
      undoLabel: `Deshacer eliminación de ${node.name}`,
    }
    const queued = enqueue(operation)
    if (queued) registerUndo(operation)
    return queued
  }

  const enqueueDeleteEdge = (edgeId: string) => {
    const current = confirmedRef.current ? applyOperations(confirmedRef.current, queueRef.current) : null
    const edge = current?.edges.find(item => item.id === edgeId)
    if (!edge) return false
    const operation: GraphOperation = {
      id: crypto.randomUUID(),
      type: 'delete-edge',
      apply: workflow => ({ ...workflow, edges: workflow.edges.filter(item => item.id !== edgeId) }),
      undo: workflow => workflow.edges.some(item => item.id === edge.id) ? workflow : { ...workflow, edges: [...workflow.edges, edge] },
      undoLabel: 'Deshacer eliminación de conexión',
    }
    const queued = enqueue(operation)
    if (queued) registerUndo(operation)
    return queued
  }

  const enqueueConnect = (edge: AiWorkflowEdge) => enqueue({
    id: crypto.randomUUID(),
    type: 'connect',
    apply: workflow => workflow.edges.some(item => item.id === edge.id) ? workflow : { ...workflow, edges: [...workflow.edges, edge] },
  })

  const enqueueMoveNode = (nodeId: string, position: { x: number; y: number }) => enqueue({
    id: crypto.randomUUID(),
    type: 'move-node',
    apply: workflow => ({
      ...workflow,
      nodes: workflow.nodes.map(node => node.id === nodeId
        ? { ...node, position_x: Math.round(position.x), position_y: Math.round(position.y) }
        : node),
    }),
  })

  const undoLastGraphOperation = () => {
    if (!undoAction || !confirmedRef.current) return
    const operation = queueRef.current.find(item => item.id === undoAction.operationId) || undoOperationRef.current
    clearUndoAction()
    if (!operation?.undo) return
    const index = queueRef.current.findIndex(item => item.id === operation.id)
    if (index > 0) {
      queueRef.current.splice(index, 1)
      localRevisionRef.current += 1
      logGraphOperation('undo cancelled queued operation', { operationId: operation.id, type: operation.type })
      publishQueuedGraph()
      return
    }
    // The first operation may already be in flight. Queue its inverse; the
    // reducer checks IDs, so it is safe whether the deletion succeeds or fails.
    const compensation = { id: crypto.randomUUID(), type: 'insert' as const, apply: operation.undo }
    queueRef.current.push(compensation)
    localRevisionRef.current += 1
    logGraphOperation('undo compensation queued', { operationId: compensation.id, originalOperationId: operation.id })
    publishQueuedGraph()
    void processQueue()
  }

  useEffect(() => {
    const workflowId = workflowDraft?.id || null
    if (workflowId !== workflowIdRef.current) {
      workflowIdRef.current = workflowId
      confirmedRef.current = workflowDraft
      queueRef.current = []
      processingRef.current = false
      activeOperationRef.current = null
      localRevisionRef.current = 0
      confirmedRevisionRef.current = 0
      clearUndoAction()
      setSaveState('idle')
      return
    }
    // Property edits use the explicit draft save path. Adopt them as the base
    // only when the graph queue is idle, never while graph changes are pending.
    if (!processingRef.current && queueRef.current.length === 0 && workflowDraft) confirmedRef.current = workflowDraft
  }, [workflowDraft])

  useEffect(() => () => {
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current)
  }, [])

  return {
    graphSaveState: saveState,
    pendingGraphOperations: queueRef.current.length + (processingRef.current ? 1 : 0),
    undoAction,
    undoLastGraphOperation,
    enqueueInsert,
    enqueueDeleteNode,
    enqueueDeleteEdge,
    enqueueConnect,
    enqueueMoveNode,
  }
}
