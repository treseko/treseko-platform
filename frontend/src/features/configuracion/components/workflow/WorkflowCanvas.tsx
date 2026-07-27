import { Button, Form } from 'react-bootstrap'
import { Network } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
  useReactFlow,
} from '@xyflow/react'
import type { AiAgentPreset, AiWorkflow } from '../../types/configuracion'

const workflowDebug = Boolean((import.meta as any).env?.DEV)
  && typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('workflowDebug') === '1'

const logPlacement = (event: string, details: Record<string, unknown>) => {
  if (workflowDebug) console.info(`[workflow placement] ${event}`, details)
}

type Props = {
  workflowDraft: AiWorkflow | null
  canEditAi: boolean
  autoLayoutEnabled: boolean
  graphSaveState: 'idle' | 'saving' | 'saved' | 'error'
  workflowUndoAction: { operationId: string; label: string } | null
  undoLastGraphOperation: () => void
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
  placementPreset: AiAgentPreset | null
  onPlacementFinished: () => void
  onInsertPresetAt: (preset: AiAgentPreset, position: { x: number; y: number }) => Promise<boolean>
  prepareManualPlacement: () => void
  selectWorkflowElement: (element: { type: 'node' | 'edge', id: string } | null) => void
  closeWorkflowProperties: () => void
}

export function WorkflowCanvas({
  workflowDraft,
  canEditAi,
  autoLayoutEnabled,
  graphSaveState,
  workflowUndoAction,
  undoLastGraphOperation,
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
  placementPreset,
  onPlacementFinished,
  onInsertPresetAt,
  prepareManualPlacement,
  selectWorkflowElement,
  closeWorkflowProperties,
}: Props) {
  const reactFlowInstance = useReactFlow()
  const canvasRef = useRef<HTMLDivElement>(null)
  const insertingRef = useRef(false)
  const [dropPreview, setDropPreview] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === 'undefined') return
    let animationFrame = 0
    let previousWidth = 0
    let previousHeight = 0
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width)
      const height = Math.round(entry.contentRect.height)
      if (!width || !height || (width === previousWidth && height === previousHeight)) return
      previousWidth = width
      previousHeight = height
      cancelAnimationFrame(animationFrame)
      animationFrame = requestAnimationFrame(() => {
        reactFlowInstance.fitView({
          padding: 0.18,
          includeHiddenNodes: false,
          duration: 0,
        })
      })
    })
    observer.observe(canvas)
    return () => {
      cancelAnimationFrame(animationFrame)
      observer.disconnect()
    }
  }, [reactFlowInstance])

  useEffect(() => {
    if (!placementPreset) {
      setDropPreview(null)
      return
    }
    const getPosition = (event: PointerEvent) => {
      const bounds = canvasRef.current?.getBoundingClientRect()
      if (!bounds || event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return null
      return {
        screen: { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        flow: reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: true }),
      }
    }
    const handleMove = (event: PointerEvent) => {
      const position = getPosition(event)
      setDropPreview(position?.screen || null)
    }
    const handleEnd = async (event: PointerEvent) => {
      const position = getPosition(event)
      setDropPreview(null)
      onPlacementFinished()
      if (!position || insertingRef.current || !canEditAi) {
        logPlacement('cancelled', {
          preset: placementPreset.name,
          hasPosition: Boolean(position),
          alreadyInserting: insertingRef.current,
          canEditAi,
        })
        return
      }
      insertingRef.current = true
      try {
        logPlacement('drop accepted', {
          preset: placementPreset.name,
          screen: position.screen,
          flow: position.flow,
          autoLayoutEnabled,
        })
        if (autoLayoutEnabled) prepareManualPlacement()
        const inserted = await onInsertPresetAt(placementPreset, position.flow)
        logPlacement('request completed', { preset: placementPreset.name, inserted })
      } finally {
        insertingRef.current = false
      }
    }
    const handleCancel = () => {
      setDropPreview(null)
      onPlacementFinished()
    }
    document.addEventListener('pointermove', handleMove, true)
    document.addEventListener('pointerup', handleEnd, true)
    document.addEventListener('pointercancel', handleCancel, true)
    return () => {
      document.removeEventListener('pointermove', handleMove, true)
      document.removeEventListener('pointerup', handleEnd, true)
      document.removeEventListener('pointercancel', handleCancel, true)
    }
  }, [autoLayoutEnabled, canEditAi, onInsertPresetAt, onPlacementFinished, placementPreset, prepareManualPlacement, reactFlowInstance])

  return (
    <section className="workflow-canvas-shell">
      <div className="workflow-canvas-header">
        <div className="workflow-canvas-title">
          <Network size={16} className="text-primary" />
          <Form.Control
            size="sm"
            className="workflow-name-input"
            aria-label="Nombre del workflow"
            value={workflowDraft?.name || ''}
            disabled={!canEditAi || !workflowDraft}
            onChange={(event) => updateWorkflowDraft({ name: event.target.value })}
          />
        </div>
        <div className="workflow-canvas-controls">
          {graphSaveState !== 'idle' && (
            <span className={`workflow-graph-save-state is-${graphSaveState}`} aria-live="polite">
              {graphSaveState === 'saving' && 'Guardando diagrama...'}
              {graphSaveState === 'saved' && 'Diagrama guardado'}
              {graphSaveState === 'error' && 'No se pudo guardar'}
            </span>
          )}
          {workflowUndoAction && (
            <Button size="sm" variant="outline-warning" className="workflow-undo-button" onClick={undoLastGraphOperation} title={workflowUndoAction.label}>
              Deshacer
            </Button>
          )}
          <Form.Control
            size="sm"
            className="workflow-changelog-input"
            aria-label="Descripción del cambio"
            autoComplete="off"
            placeholder="Descripción del cambio…"
            value={workflowChangelog}
            disabled={!canEditAi || !workflowDraft}
            onChange={(event) => setWorkflowChangelog(event.target.value)}
          />
        </div>
      </div>
      <div
        ref={canvasRef}
        className="workflow-canvas"
        data-placement-active={Boolean(placementPreset)}
      >
        <ReactFlow
          nodes={renderFlowNodes}
          edges={renderFlowEdges}
          nodeTypes={workflowEdgeDebugEnabled ? undefined : workflowNodeTypes}
          connectionLineType={ConnectionLineType.SmoothStep}
          defaultEdgeOptions={{ type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } }}
          snapToGrid
          snapGrid={[16, 16]}
          minZoom={0.2}
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
        {placementPreset && (
          <div className={`workflow-drop-status ${dropPreview ? 'is-valid' : ''}`} aria-live="polite">
            {dropPreview ? `Soltá para agregar: ${placementPreset.name}` : `Arrastrá ${placementPreset.name} a una zona vacía del diagrama`}
          </div>
        )}
        {placementPreset && dropPreview && (
          <div className="workflow-drop-preview" style={{ left: dropPreview.x, top: dropPreview.y }} aria-hidden="true">
            <span>{placementPreset.name}</span>
            <small>{placementPreset.type}</small>
          </div>
        )}
      </div>
    </section>
  )
}
