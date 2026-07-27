import { Modal } from 'react-bootstrap'
import { useEffect, useState, type PointerEvent } from 'react'
import type { AiAgentPreset, AiWorkflow, AiWorkflowEdge, AiWorkflowNode } from '../../types/configuracion'
import { WorkflowBuilderToolbar } from './WorkflowBuilderToolbar'
import { WorkflowCanvas } from './WorkflowCanvas'
import { WorkflowPropertiesPanel } from './WorkflowPropertiesPanel'
import { WorkflowRuntimePanel } from './WorkflowRuntimePanel'
import { WorkflowSidebar } from './WorkflowSidebar'
import { UniversalAgentCreatorModal } from './UniversalAgentCreatorModal'

type Props = {
  show: boolean
  workflowDraft: AiWorkflow | null
  workflowLoading: boolean
  graphSaveState: 'idle' | 'saving' | 'saved' | 'error'
  workflowUndoAction: { operationId: string; label: string } | null
  undoLastGraphOperation: () => void
  canEditAi: boolean
  onOpenIaScheduler?: () => void
  autoLayoutEnabled: boolean
  workflowStatusColor: (status?: string) => string
  saveWorkflowDraft: () => void
  validateWorkflow: () => void
  publishWorkflowVersion: () => void
  executeCurrentWorkflow: () => void
  switchToAutoLayoutMode: () => void
  switchToManualMode: () => void
  prepareManualPlacement: () => void
  reorderWorkflow: () => void
  postWorkflowAction: (action: 'duplicate' | 'archive' | 'restore-default') => void
  copyWorkflowAsBlocks: () => void
  copyWorkflowAsUniversal: () => void
  exportUniversalWorkflow: () => void
  importUniversalWorkflow: (file?: File) => void
  createUniversalAgent: (payload: Record<string, any>) => Promise<any>
  closeWorkflowBuilder: () => void
  refitWorkflow: (reason: string) => void
  workflowLoadError: string
  agentPresetsError: string
  activeWorkflows: AiWorkflow[]
  agentPresets: AiAgentPreset[]
  selectWorkflow: (workflow: AiWorkflow) => void
  createWorkflow: () => void
  addPresetToWorkflow: (preset: AiAgentPreset, position?: { x: number; y: number }) => Promise<boolean>
  workflowChangelog: string
  setWorkflowChangelog: (value: string) => void
  updateWorkflowDraft: (patch: Partial<AiWorkflow>) => void
  renderFlowNodes: any[]
  renderFlowEdges: any[]
  workflowNodeTypes: any
  workflowEdgeDebugEnabled: boolean
  onWorkflowNodesChange: any
  onWorkflowEdgesChange: any
  onWorkflowNodeDragStop: any
  onWorkflowConnect: any
  onWorkflowNodeContextMenu: any
  onWorkflowEdgeContextMenu: any
  selectedWorkflowElement: { type: 'node' | 'edge', id: string } | null
  selectedWorkflowNode: AiWorkflowNode | null
  selectedWorkflowEdge: AiWorkflowEdge | null
  selectWorkflowElement: (element: { type: 'node' | 'edge', id: string } | null) => void
  workflowPropertiesTab: string
  setWorkflowPropertiesTab: (tab: string) => void
  updateWorkflowNode: (nodeId: string, patch: Partial<AiWorkflowNode>) => void
  updateWorkflowNodeConfig: (nodeId: string, patch: Record<string, any>) => void
  updateWorkflowEdge: (edgeId: string, patch: Partial<AiWorkflowEdge>) => void
  workflowJsonError: string
  workflowValidationIssues: any[]
  setWorkflowJsonError: (error: string) => void
  closeWorkflowProperties: () => void
  traceExecutionId: string
  setTraceExecutionId: (value: string) => void
  runtimeTraces: any[]
  workflowRuntimeExpanded: boolean
  setWorkflowRuntimeExpanded: (expanded: boolean) => void
  loadRuntimeTraces: () => void
}

export function WorkflowBuilderModal({
  show,
  workflowDraft,
  workflowLoading,
  graphSaveState,
  workflowUndoAction,
  undoLastGraphOperation,
  canEditAi,
  onOpenIaScheduler,
  autoLayoutEnabled,
  workflowStatusColor,
  saveWorkflowDraft,
  validateWorkflow,
  publishWorkflowVersion,
  executeCurrentWorkflow,
  switchToAutoLayoutMode,
  switchToManualMode,
  prepareManualPlacement,
  reorderWorkflow,
  postWorkflowAction,
  copyWorkflowAsBlocks,
  copyWorkflowAsUniversal,
  exportUniversalWorkflow,
  importUniversalWorkflow,
  createUniversalAgent,
  closeWorkflowBuilder,
  refitWorkflow,
  workflowLoadError,
  agentPresetsError,
  activeWorkflows,
  agentPresets,
  selectWorkflow,
  createWorkflow,
  addPresetToWorkflow,
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
  selectedWorkflowElement,
  selectedWorkflowNode,
  selectedWorkflowEdge,
  selectWorkflowElement,
  workflowPropertiesTab,
  setWorkflowPropertiesTab,
  updateWorkflowNode,
  updateWorkflowNodeConfig,
  updateWorkflowEdge,
  workflowJsonError,
  workflowValidationIssues,
  setWorkflowJsonError,
  closeWorkflowProperties,
  traceExecutionId,
  setTraceExecutionId,
  runtimeTraces,
  workflowRuntimeExpanded,
  setWorkflowRuntimeExpanded,
  loadRuntimeTraces,
}: Props) {
  const [placementPreset, setPlacementPreset] = useState<AiAgentPreset | null>(null)
  const [universalCreatorOpen, setUniversalCreatorOpen] = useState(false)
  const [validationSummaryDismissed, setValidationSummaryDismissed] = useState(false)
  const validationSummary = Object.values(workflowValidationIssues.reduce<Record<string, { severity?: string; message: string; count: number }>>((summary, issue) => {
    const severity = issue?.severity === 'error' ? 'error' : 'warning'
    const message = String(issue?.message || 'Diagnostico de validacion sin detalle.')
    const key = `${severity}:${message}`
    summary[key] = summary[key]
      ? { ...summary[key], count: summary[key].count + 1 }
      : { severity, message, count: 1 }
    return summary
  }, {}))

  useEffect(() => {
    setValidationSummaryDismissed(false)
  }, [workflowValidationIssues])

  const beginPresetPlacement = (preset: AiAgentPreset, event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !canEditAi || !workflowDraft || workflowDraft.status === 'ACTIVE') return
    event.preventDefault()
    if ((import.meta as any).env?.DEV && new URLSearchParams(window.location.search).get('workflowDebug') === '1') {
      console.info('[workflow placement] started', { preset: preset.name, workflowId: workflowDraft.id })
    }
    setPlacementPreset(preset)
  }

  return (
    <Modal
      show={show}
      onHide={closeWorkflowBuilder}
      onEntered={() => refitWorkflow('builder modal entered')}
      fullscreen
      className="workflow-builder-modal-root"
      dialogClassName="workflow-builder-modal"
      contentClassName="workflow-builder-content"
    >
      <Modal.Body className="workflow-builder-body p-0">
        <div className="workflow-engine workflow-builder">
          <WorkflowBuilderToolbar
            workflowDraft={workflowDraft}
            workflowLoading={workflowLoading}
            canEditAi={canEditAi}
            onOpenIaScheduler={onOpenIaScheduler}
            autoLayoutEnabled={autoLayoutEnabled}
            workflowStatusColor={workflowStatusColor}
            saveWorkflowDraft={saveWorkflowDraft}
            validateWorkflow={validateWorkflow}
            publishWorkflowVersion={publishWorkflowVersion}
            executeCurrentWorkflow={executeCurrentWorkflow}
            switchToAutoLayoutMode={switchToAutoLayoutMode}
            switchToManualMode={switchToManualMode}
            reorderWorkflow={reorderWorkflow}
            postWorkflowAction={postWorkflowAction}
            copyWorkflowAsBlocks={copyWorkflowAsBlocks}
            copyWorkflowAsUniversal={copyWorkflowAsUniversal}
            exportUniversalWorkflow={exportUniversalWorkflow}
            importUniversalWorkflow={importUniversalWorkflow}
            closeWorkflowBuilder={closeWorkflowBuilder}
          />

          {(workflowLoadError || agentPresetsError) && (
            <div className="workflow-load-warnings">
              {workflowLoadError && (
                <div className="workflow-load-warning">
                  <span className="fw-bold">Workflows IA:</span> {workflowLoadError}
                </div>
              )}
              {agentPresetsError && (
                <div className="workflow-load-warning">
                  <span className="fw-bold">Presets IA:</span> {agentPresetsError}
                </div>
              )}
            </div>
          )}
          {validationSummary.length > 0 && !validationSummaryDismissed && (
            <div className="workflow-validation-summary" role="alert">
              <div className="workflow-validation-summary-header">
                <div>
                  <strong>Validacion del workflow</strong>
                  <span>{workflowValidationIssues.length} hallazgo{workflowValidationIssues.length === 1 ? '' : 's'} ({validationSummary.length} tipo{validationSummary.length === 1 ? '' : 's'})</span>
                </div>
                <button type="button" className="workflow-validation-dismiss" onClick={() => setValidationSummaryDismissed(true)} aria-label="Ocultar resumen de validacion">
                  Ocultar resumen
                </button>
              </div>
              <div className="workflow-validation-summary-items">
                {validationSummary.slice(0, 3).map((issue, index) => (
                  <div key={`${issue.severity}-${issue.message}-${index}`} className="workflow-load-warning">
                    <span className="fw-bold text-uppercase">{issue.severity === 'error' ? 'Error' : 'Advertencia'}:</span> {issue.message}
                    {issue.count > 1 && <span className="workflow-validation-count">{issue.count} agentes</span>}
                  </div>
                ))}
                {validationSummary.length > 3 && <div className="workflow-validation-more">Y {validationSummary.length - 3} tipo(s) adicional(es). Corrige o desactiva los agentes no conectados antes de publicar.</div>}
              </div>
            </div>
          )}

          <div className="workflow-engine-grid">
            <WorkflowSidebar
              activeWorkflows={activeWorkflows}
              workflowDraft={workflowDraft}
              agentPresets={agentPresets}
              canEditAi={canEditAi}
              workflowStatusColor={workflowStatusColor}
              selectWorkflow={selectWorkflow}
              createWorkflow={createWorkflow}
              createBlockWorkflow={copyWorkflowAsBlocks}
              createUniversalWorkflow={copyWorkflowAsUniversal}
              openUniversalAgentCreator={() => setUniversalCreatorOpen(true)}
              cloneWorkflow={() => postWorkflowAction('duplicate')}
              onBeginPresetPlacement={beginPresetPlacement}
            />

            <WorkflowCanvas
              workflowDraft={workflowDraft}
              canEditAi={canEditAi}
              autoLayoutEnabled={autoLayoutEnabled}
              graphSaveState={graphSaveState}
              workflowUndoAction={workflowUndoAction}
              undoLastGraphOperation={undoLastGraphOperation}
              workflowChangelog={workflowChangelog}
              setWorkflowChangelog={setWorkflowChangelog}
              updateWorkflowDraft={updateWorkflowDraft}
              renderFlowNodes={renderFlowNodes}
              renderFlowEdges={renderFlowEdges}
              workflowNodeTypes={workflowNodeTypes}
              workflowEdgeDebugEnabled={workflowEdgeDebugEnabled}
              onWorkflowNodesChange={onWorkflowNodesChange}
              onWorkflowEdgesChange={onWorkflowEdgesChange}
              onWorkflowNodeDragStop={onWorkflowNodeDragStop}
              onWorkflowConnect={onWorkflowConnect}
              onWorkflowNodeContextMenu={onWorkflowNodeContextMenu}
              onWorkflowEdgeContextMenu={onWorkflowEdgeContextMenu}
              placementPreset={placementPreset}
              onPlacementFinished={() => setPlacementPreset(null)}
              prepareManualPlacement={prepareManualPlacement}
              onInsertPresetAt={addPresetToWorkflow}
              selectWorkflowElement={selectWorkflowElement}
              closeWorkflowProperties={closeWorkflowProperties}
            />

            <WorkflowPropertiesPanel
              selectedWorkflowElement={selectedWorkflowElement}
              selectedWorkflowNode={selectedWorkflowNode}
              selectedWorkflowEdge={selectedWorkflowEdge}
              canEditAi={canEditAi}
              workflowPropertiesTab={workflowPropertiesTab}
              setWorkflowPropertiesTab={setWorkflowPropertiesTab}
              updateWorkflowNode={updateWorkflowNode}
              updateWorkflowNodeConfig={updateWorkflowNodeConfig}
              agentDefinitions={agentPresets.filter(item => Boolean(item.agent_definition_id))}
              updateWorkflowEdge={updateWorkflowEdge}
              workflowJsonError={workflowJsonError}
              setWorkflowJsonError={setWorkflowJsonError}
              closeWorkflowProperties={closeWorkflowProperties}
            />
          </div>

          <WorkflowRuntimePanel
            traceExecutionId={traceExecutionId}
            setTraceExecutionId={setTraceExecutionId}
            runtimeTraces={runtimeTraces}
            workflowRuntimeExpanded={workflowRuntimeExpanded}
            setWorkflowRuntimeExpanded={setWorkflowRuntimeExpanded}
            loadRuntimeTraces={loadRuntimeTraces}
          />
          <UniversalAgentCreatorModal show={universalCreatorOpen} onHide={() => setUniversalCreatorOpen(false)} onCreate={createUniversalAgent} />
        </div>
      </Modal.Body>
    </Modal>
  )
}
