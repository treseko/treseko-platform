import { useEffect, useMemo, useState } from 'react'
import { Card, Form, Button } from 'react-bootstrap'
import { Save } from 'lucide-react'
import { AiAgentPromptModal } from './AiAgentPromptModal'
import { AiEngineSettingsCards } from './AiEngineSettingsCards'
import { WorkflowBuilderModal } from '../workflow/WorkflowBuilderModal'
import { fetchAiWorkflows } from '../../api/aiWorkflowApi'
import { useAgentWorkflowConfig } from '../../hooks/useAgentWorkflowConfig'
import { useAiModelConfig } from '../../hooks/useAiModelConfig'
import { useWorkflowActions } from '../../hooks/useWorkflowActions'
import { useWorkflowGraphAutosave } from '../../hooks/useWorkflowGraphAutosave'
import { useWorkflowFlow } from '../../hooks/useWorkflowFlow'
import { useWorkflowLocalEdits } from '../../hooks/useWorkflowLocalEdits'
import { useWorkflowPresets } from '../../hooks/useWorkflowPresets'
import { useWorkflowRuntimeTraces } from '../../hooks/useWorkflowRuntimeTraces'
import { useWorkflowVersions } from '../../hooks/useWorkflowVersions'
import type { AiWorkflow } from '../../types/configuracion'
import { agentActionOptions, capabilityVariant, formatWorkflowDate, workflowStatusColor } from '../../mappers/configuracionMappers'

type AiSettingsSectionProps = {
  configTab: string
  hasAiEngineAccess: boolean
  canAccessModule: (...args: any[]) => boolean
  canAccessCapability: (...args: any[]) => boolean
  aiEngineConfig: any
  setAiEngineConfig: any
  aiEngineConfigLoading: boolean
  aiEngineHealth: any
  checkAiEngineHealth: (options?: any) => Promise<any>
  saveAiEngineConfig: (config: any) => void
  fetchWithAuth: any
  showFeedback: any
  t: (key: any, params?: any) => string
  onOpenIaScheduler?: (...args: any[]) => void
  setActiveTab: (tab: string) => void
}

export function AiSettingsSection({
  configTab,
  hasAiEngineAccess,
  canAccessModule,
  canAccessCapability,
  aiEngineConfig,
  setAiEngineConfig,
  aiEngineConfigLoading,
  aiEngineHealth,
  checkAiEngineHealth,
  saveAiEngineConfig,
  fetchWithAuth,
  showFeedback,
  t,
  onOpenIaScheduler,
  setActiveTab,
}: AiSettingsSectionProps) {
  const [promptAgentIndex, setPromptAgentIndex] = useState<number | null>(null)
  const [aiWorkflows, setAiWorkflows] = useState<AiWorkflow[]>([])
  const [workflowDraft, setWorkflowDraft] = useState<AiWorkflow | null>(null)
  const [workflowLoading, setWorkflowLoading] = useState(false)
  const [workflowLoadError, setWorkflowLoadError] = useState('')
  const [workflowJsonError, setWorkflowJsonError] = useState('')
  const {
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
  } = useWorkflowFlow({
    workflowDraft,
    setWorkflowDraft,
    setAiWorkflows,
  })
  const activeWorkflows = useMemo(() => aiWorkflows.filter(workflow => workflow.status === 'ACTIVE'), [aiWorkflows])
  const loadAiWorkflows = async () => {
    if (!canAccessModule('motor_ia', 'read') && !canAccessModule('configuracion', 'read')) return
    setWorkflowLoading(true)
    try {
      setWorkflowLoadError('')
      const workflows = await fetchAiWorkflows(fetchWithAuth)
      setAiWorkflows(workflows)
      const activeId = aiEngineConfig.active_workflow_id || workflows.find((item: AiWorkflow) => item.status === 'ACTIVE')?.id || workflows[0]?.id
      const selected = workflows.find((item: AiWorkflow) => item.id === activeId) || workflows[0] || null
      setWorkflowDraft(selected)
      syncFlowFromWorkflow(selected)
      if (selected?.id) loadWorkflowVersions(selected.id)
    } catch (error: any) {
      setAiWorkflows([])
      setWorkflowDraft(null)
      syncFlowFromWorkflow(null)
      setWorkflowLoadError(error?.message || 'No se pudieron cargar los workflows.')
    } finally {
      setWorkflowLoading(false)
    }
  }

  const {
    workflowChangelog,
    setWorkflowChangelog,
    workflowVersions,
    selectedWorkflowVersion,
    workflowValidationIssues,
    loadWorkflowVersions,
    publishWorkflowVersion,
    validateWorkflow,
    activateWorkflowVersion,
    rollbackWorkflow,
  } = useWorkflowVersions({
    fetchWithAuth,
    workflowDraft,
    setWorkflowDraft,
    setAiWorkflows,
    setWorkflowLoading,
    setWorkflowJsonError,
    syncFlowFromWorkflow,
    loadAiWorkflows,
    showFeedback,
    t,
  })

  const { agentPresets, agentPresetsError, loadAgentPresets } = useWorkflowPresets({ fetchWithAuth })

  useEffect(() => {
    if (configTab === 'ai' && hasAiEngineAccess) {
      loadAiWorkflows()
      loadAgentPresets()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configTab, hasAiEngineAccess])

  const selectWorkflow = (workflow: AiWorkflow) => {
    setWorkflowDraft(workflow)
    setSelectedWorkflowElement(null)
    syncFlowFromWorkflow(workflow)
    loadWorkflowVersions(workflow.id)
  }

  const canEditAi = canAccessCapability('configuracion.pruebas_ia', 'edit')
    || canAccessCapability('motor_ia.configuracion', 'edit')
    || canAccessCapability('motor_ia.workflow_drafts', 'edit')
  const {
    graphSaveState,
    undoAction: workflowUndoAction,
    undoLastGraphOperation,
    enqueueInsert,
    enqueueDeleteNode,
    enqueueDeleteEdge,
    enqueueConnect,
    enqueueMoveNode,
  } = useWorkflowGraphAutosave({
    fetchWithAuth,
    workflowDraft,
    setWorkflowDraft,
    setAiWorkflows,
    syncFlowFromWorkflow,
    showFeedback,
  })
  const {
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
  } = useWorkflowLocalEdits({
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
    t,
    enqueueDeleteNode,
    enqueueDeleteEdge,
    enqueueConnect,
    enqueueMoveNode,
  })


  const {
    saveWorkflowDraft,
    executeCurrentWorkflow,
    addPresetToWorkflow,
    createWorkflow,
    postWorkflowAction,
    copyWorkflowAsBlocks,
    copyWorkflowAsUniversal,
    exportUniversalWorkflow,
    importUniversalWorkflow,
    createUniversalAgent,
  } = useWorkflowActions({
    fetchWithAuth,
    workflowDraft,
    aiWorkflows,
    canEditAi,
    onOpenIaScheduler,
    setWorkflowDraft,
    setAiWorkflows,
    setWorkflowLoading,
    syncFlowFromWorkflow,
    enqueueInsert,
    loadWorkflowVersions,
    loadAiWorkflows,
    loadAgentPresets,
    selectWorkflow,
    showFeedback,
  })
  const {
    traceExecutionId,
    setTraceExecutionId,
    runtimeTraces,
    workflowRuntimeExpanded,
    setWorkflowRuntimeExpanded,
    loadRuntimeTraces,
  } = useWorkflowRuntimeTraces({
    fetchWithAuth,
    showFeedback,
    t,
  })

  const {
    aiProviderOptions,
    modelScanLoading,
    modelScanError,
    selectedRuntimeProvider,
    selectedProviderMeta,
    modelCatalog,
    activeModelCapabilities,
    updateAiRuntimeProvider,
    updateActiveModelCapability,
    scanAiModels,
  } = useAiModelConfig({
    aiEngineConfig,
    setAiEngineConfig,
    fetchWithAuth,
    showFeedback,
    t,
  })
  const {
    updateAgentWorkflowItem,
    restoreAgentPrompt,
    promptAgent,
  } = useAgentWorkflowConfig({
    aiEngineConfig,
    setAiEngineConfig,
    promptAgentIndex,
  })


  useEffect(() => {
    if (configTab !== 'ai' || !hasAiEngineAccess) return
    checkAiEngineHealth({ silent: true })
    const timer = window.setInterval(() => checkAiEngineHealth({ silent: true }), 5000)
    return () => window.clearInterval(timer)
  }, [configTab, hasAiEngineAccess, checkAiEngineHealth])

  return (
    <>
          {configTab === 'ai' && hasAiEngineAccess && (
            <div className="animate__animated animate__fadeIn">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <div>
                  <h5 className="fw-bold text-secondary text-uppercase small m-0">{t('configuracion.aiSectionTitle')}</h5>
                  <span className="small text-muted">{t('configuracion.aiSectionDesc')}</span>
                </div>
              </div>

              <Card className="border-0 shadow-sm rounded-4 bg-white p-4">
                <Form onSubmit={(e) => { e.preventDefault(); saveAiEngineConfig(aiEngineConfig) }}>
                  <AiEngineSettingsCards
                    aiEngineConfig={aiEngineConfig}
                    setAiEngineConfig={setAiEngineConfig}
                    canEditAi={canEditAi}
                    modelScanLoading={modelScanLoading}
                    scanAiModels={scanAiModels}
                    selectedRuntimeProvider={selectedRuntimeProvider}
                    updateAiRuntimeProvider={updateAiRuntimeProvider}
                    aiProviderOptions={aiProviderOptions}
                    selectedProviderMeta={selectedProviderMeta}
                    modelCatalog={modelCatalog}
                    modelScanError={modelScanError}
                    activeModelCapabilities={activeModelCapabilities}
                    capabilityVariant={capabilityVariant}
                    updateActiveModelCapability={updateActiveModelCapability}
                    aiEngineHealth={aiEngineHealth}
                    checkAiEngineHealth={checkAiEngineHealth}
                    aiWorkflows={aiWorkflows}
                    onSelectWorkflow={(workflowId) => {
                      const workflow = aiWorkflows.find(item => item.id === workflowId)
                      if (workflow) selectWorkflow(workflow)
                    }}
                    workflowLoadError={workflowLoadError}
                    agentPresetsError={agentPresetsError}
                    workflowStatusColor={workflowStatusColor}
                    formatWorkflowDate={formatWorkflowDate}
                    onOpenWorkflowBuilder={openWorkflowBuilder}
                    onOpenLogs={() => setActiveTab('motor_ia')}
                    fetchWithAuth={fetchWithAuth}
                    showFeedback={showFeedback}
                  />

                  <WorkflowBuilderModal
                    show={workflowBuilderOpen}
                    workflowDraft={workflowDraft}
                    workflowLoading={workflowLoading || graphSaveState === 'saving'}
                    graphSaveState={graphSaveState}
                    workflowUndoAction={workflowUndoAction}
                    undoLastGraphOperation={undoLastGraphOperation}
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
                    prepareManualPlacement={prepareManualPlacement}
                    reorderWorkflow={() => {
                      if (!workflowDraft) return
                      syncFlowFromWorkflow(workflowDraft, { forceLayout: true, persistPositions: true, reason: 'manual reorder' })
                    }}
                    postWorkflowAction={postWorkflowAction}
                    copyWorkflowAsBlocks={copyWorkflowAsBlocks}
                    copyWorkflowAsUniversal={copyWorkflowAsUniversal}
                    exportUniversalWorkflow={exportUniversalWorkflow}
                    importUniversalWorkflow={importUniversalWorkflow}
                    createUniversalAgent={createUniversalAgent}
                    closeWorkflowBuilder={() => {
                      setSelectedWorkflowElement(null)
                      setWorkflowBuilderOpen(false)
                    }}
                    refitWorkflow={refitWorkflow}
                    workflowLoadError={workflowLoadError}
                    agentPresetsError={agentPresetsError}
                    activeWorkflows={aiWorkflows}
                    agentPresets={agentPresets}
                    selectWorkflow={selectWorkflow}
                    createWorkflow={createWorkflow}
                    addPresetToWorkflow={addPresetToWorkflow}
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
                    selectedWorkflowElement={selectedWorkflowElement}
                    selectedWorkflowNode={selectedWorkflowNode}
                    selectedWorkflowEdge={selectedWorkflowEdge}
                    selectWorkflowElement={selectWorkflowElement}
                    workflowPropertiesTab={workflowPropertiesTab}
                    setWorkflowPropertiesTab={setWorkflowPropertiesTab}
                    updateWorkflowNode={updateWorkflowNode}
                    updateWorkflowNodeConfig={updateWorkflowNodeConfig}
                    updateWorkflowEdge={updateWorkflowEdge}
                    workflowJsonError={workflowJsonError}
                    workflowValidationIssues={workflowValidationIssues}
                    setWorkflowJsonError={setWorkflowJsonError}
                    closeWorkflowProperties={closeWorkflowProperties}
                    traceExecutionId={traceExecutionId}
                    setTraceExecutionId={setTraceExecutionId}
                    runtimeTraces={runtimeTraces}
                    workflowRuntimeExpanded={workflowRuntimeExpanded}
                    setWorkflowRuntimeExpanded={setWorkflowRuntimeExpanded}
                    loadRuntimeTraces={loadRuntimeTraces}
                  />
                  {canEditAi && (
                    <div className="d-flex justify-content-end gap-2 border-top pt-3 mt-3">
                      <Button
                        variant="primary"
                        type="submit"
                        className="fw-bold rounded-pill"
                        disabled={aiEngineConfigLoading}
                      >
                        <Save size={16} className="me-2" /> {t('configuracion.aiSave')}
                      </Button>
                    </div>
                  )}
                </Form>
              </Card>
            </div>
          )}


    <AiAgentPromptModal
      promptAgentIndex={promptAgentIndex}
      promptAgent={promptAgent}
      canEditAi={canEditAi}
      agentActionOptions={agentActionOptions}
      setPromptAgentIndex={setPromptAgentIndex}
      updateAgentWorkflowItem={updateAgentWorkflowItem}
      restoreAgentPrompt={restoreAgentPrompt}
    />
    </>
  )
}
