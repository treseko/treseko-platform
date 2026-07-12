import { Modal } from 'react-bootstrap'
import type { AiAgentPreset, AiWorkflow, AiWorkflowEdge, AiWorkflowNode } from '../../types/configuracion'
import { WorkflowBuilderToolbar } from './WorkflowBuilderToolbar'
import { WorkflowCanvas } from './WorkflowCanvas'
import { WorkflowPropertiesPanel } from './WorkflowPropertiesPanel'
import { WorkflowRuntimePanel } from './WorkflowRuntimePanel'
import { WorkflowSidebar } from './WorkflowSidebar'

type Props = {
  show: boolean
  workflowDraft: AiWorkflow | null
  workflowLoading: boolean
  canEditAi: boolean
  onOpenIaScheduler?: () => void
  autoLayoutEnabled: boolean
  workflowStatusColor: (status?: string) => string
  saveWorkflowDraft: () => void
  publishWorkflowVersion: () => void
  executeCurrentWorkflow: () => void
  switchToAutoLayoutMode: () => void
  switchToManualMode: () => void
  reorderWorkflow: () => void
  postWorkflowAction: (action: 'duplicate' | 'archive' | 'restore-default') => void
  exportWorkflow: () => void
  importWorkflow: (file?: File) => void
  closeWorkflowBuilder: () => void
  refitWorkflow: (reason: string) => void
  workflowLoadError: string
  agentPresetsError: string
  activeWorkflows: AiWorkflow[]
  agentPresets: AiAgentPreset[]
  selectWorkflow: (workflow: AiWorkflow) => void
  addPresetToWorkflow: (preset: AiAgentPreset) => void
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
  canEditAi,
  onOpenIaScheduler,
  autoLayoutEnabled,
  workflowStatusColor,
  saveWorkflowDraft,
  publishWorkflowVersion,
  executeCurrentWorkflow,
  switchToAutoLayoutMode,
  switchToManualMode,
  reorderWorkflow,
  postWorkflowAction,
  exportWorkflow,
  importWorkflow,
  closeWorkflowBuilder,
  refitWorkflow,
  workflowLoadError,
  agentPresetsError,
  activeWorkflows,
  agentPresets,
  selectWorkflow,
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
  setWorkflowJsonError,
  closeWorkflowProperties,
  traceExecutionId,
  setTraceExecutionId,
  runtimeTraces,
  workflowRuntimeExpanded,
  setWorkflowRuntimeExpanded,
  loadRuntimeTraces,
}: Props) {
  return (
    <Modal
      show={show}
      onHide={closeWorkflowBuilder}
      onEntered={() => refitWorkflow('builder modal entered')}
      fullscreen
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
            publishWorkflowVersion={publishWorkflowVersion}
            executeCurrentWorkflow={executeCurrentWorkflow}
            switchToAutoLayoutMode={switchToAutoLayoutMode}
            switchToManualMode={switchToManualMode}
            reorderWorkflow={reorderWorkflow}
            postWorkflowAction={postWorkflowAction}
            exportWorkflow={exportWorkflow}
            importWorkflow={importWorkflow}
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

          <div className="workflow-engine-grid">
            <WorkflowSidebar
              activeWorkflows={activeWorkflows}
              workflowDraft={workflowDraft}
              agentPresets={agentPresets}
              canEditAi={canEditAi}
              workflowStatusColor={workflowStatusColor}
              selectWorkflow={selectWorkflow}
              addPresetToWorkflow={addPresetToWorkflow}
            />

            <WorkflowCanvas
              workflowDraft={workflowDraft}
              canEditAi={canEditAi}
              autoLayoutEnabled={autoLayoutEnabled}
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
        </div>
      </Modal.Body>
    </Modal>
  )
}
