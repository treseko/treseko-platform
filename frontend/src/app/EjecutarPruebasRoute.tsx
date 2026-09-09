import { useState } from 'react'
import { ConsolaManualPage } from '../features/ejecutar-pruebas/ConsolaManualPage'
import { ChatbotManualConsolePage } from '../features/ejecutar-pruebas/ChatbotManualConsolePage'
import { ApiExecutionConsolePage } from '../features/ejecutar-pruebas/ApiExecutionConsolePage'
import { EjecutarPruebasPage } from '../features/ejecutar-pruebas/EjecutarPruebasPage'
import { EvidenceViewerModal, type EvidenceViewerItem } from '../shared/components/EvidenceViewerModal'
import { WorkspaceContextEmptyState } from '../shared/components/WorkspaceContextEmptyState'
import { useI18n } from '../i18n'

type EjecutarPruebasRouteProps = any

export function EjecutarPruebasRoute({
  activeTab,
  viewMode,
  selectedTest,
  setZoomImage,
  openHistorialRuns,
  openExecutionRunDetail,
  closeExecutionRunDetail,
  executionRunDetail,
  executionRunDetailLoading,
  executionRunDetailError,
  focusedExecutionId,
  ...props
}: EjecutarPruebasRouteProps) {
  const { t } = useI18n()
  const [viewerEvidence, setViewerEvidence] = useState<EvidenceViewerItem | null>(null)
  const openEvidence = (attachment: any) => {
    if (typeof attachment === 'string') {
      setViewerEvidence({ url: attachment, filename: 'Evidencia adjunta', contentType: null })
      return
    }
    if (!attachment?.public_url) return
    setViewerEvidence({
      url: attachment.public_url,
      filename: attachment.filename_original,
      contentType: attachment.content_type,
      available: attachment.available,
      missing_reason: attachment.missing_reason,
    })
  }

  if (activeTab === 'ejecutar' && viewMode === 'list') {
    if (!props.currentProjectId) {
      return <WorkspaceContextEmptyState message={t('ejecutarPruebas.selectSolutionAndProject')} detail={t('ejecutarPruebas.executableCasesProjectDetail')} />
    }
    if (!props.currentBuildId) {
      return <WorkspaceContextEmptyState message={t('ejecutarPruebas.selectActiveBuild')} detail={t('ejecutarPruebas.executableCasesBuildDetail')} />
    }
    return (
      <>
      <EjecutarPruebasPage
        suiteExplorerWidth={props.suiteExplorerWidth}
        startSuiteExplorerResize={props.startSuiteExplorerResize}
        executionInitialLoading={props.executionInitialLoading}
        executionRefreshing={props.executionRefreshing}
        executionSuiteTree={props.executionSuiteTree}
        renderExecutionSuiteTree={props.renderExecutionSuiteTree}
        currentBuildId={props.currentBuildId}
        readOnlyBuild={props.readOnlyBuild}
        currentCompId={props.currentCompId}
        suitesTree={props.suitesTree}
        selectedSuiteId={props.selectedSuiteId}
        testSearchQuery={props.testSearchQuery}
        setTestSearchQuery={props.setTestSearchQuery}
        setSelectedSubSuiteId={props.setSelectedSubSuiteId}
        setSelectedExecutionTestIds={props.setSelectedExecutionTestIds}
        setSelectedTest={props.setSelectedTest}
        filteredTests={props.filteredTests}
        getExecutionStatusKey={props.getExecutionStatusKey}
        selectedExecutionTests={props.selectedExecutionTests}
        openExecutionSelector={props.openExecutionSelector}
        allVisibleExecutionTestsSelected={props.allVisibleExecutionTestsSelected}
        toggleVisibleExecutionSelection={props.toggleVisibleExecutionSelection}
        selectedTest={selectedTest}
        loadCasoExecutionHistory={props.loadCasoExecutionHistory}
        handleSelectTestForExecution={props.handleSelectTestForExecution}
        selectedExecutionTestIds={props.selectedExecutionTestIds}
        toggleExecutionSelection={props.toggleExecutionSelection}
        activeBuildResultsLoading={props.activeBuildResultsLoading}
        activeBuildResultsLoaded={props.activeBuildResultsLoaded}
        isOutdatedExecutionCase={props.isOutdatedExecutionCase}
        openSingleCaseExecutionSelector={props.openSingleCaseExecutionSelector}
        setZoomImage={setZoomImage}
        getExecutionActionLabel={props.getExecutionActionLabel}
        buildsList={props.buildsList}
        showFeedback={props.showFeedback}
        onOpenBuildHistory={() => openHistorialRuns({ build_id: props.currentBuildId })}
        onOpenRunHistory={openExecutionRunDetail}
        runDetail={executionRunDetail}
        runDetailLoading={executionRunDetailLoading}
        runDetailError={executionRunDetailError}
        focusedExecutionId={focusedExecutionId}
        onCloseRunDetail={closeExecutionRunDetail}
        onOpenEvidence={openEvidence}
        canAccessCapability={props.canAccessCapability}
        onCreateInternalBugFromCase={props.onCreateInternalBugFromCase}
        creatingInternalBugContextId={props.creatingInternalBugContextId}
        openBugsByCase={props.openBugsByCase}
        openBugsLoading={props.openBugsLoading}
        onOpenBugTracker={props.onOpenBugTracker}
      />
      <EvidenceViewerModal evidence={viewerEvidence} onHide={() => setViewerEvidence(null)} />
      </>
    )
  }

  if (activeTab === 'ejecutar' && viewMode === 'manual_exec' && selectedTest) {
    return (
      <ConsolaManualPage
        selectedTest={selectedTest}
        activeExecutionTests={props.activeExecutionTests}
        currentExecutionRun={props.currentExecutionRun}
        currentProjectEnvironments={props.currentProjectEnvironments}
        currentExecutionCase={props.currentExecutionCase}
        executionSnapshots={props.executionSnapshots}
        snapshotNotes={props.snapshotNotes}
        snapshotAttachments={props.snapshotAttachments}
        generalExecutionSnapshot={props.generalExecutionSnapshot}
        generalExecutionAttachments={props.generalExecutionAttachments}
        generalExecutionStatus={props.generalExecutionStatus}
        setGeneralExecutionStatus={props.setGeneralExecutionStatus}
        generalExecutionNote={props.generalExecutionNote}
        setGeneralExecutionNote={props.setGeneralExecutionNote}
        attachmentConfig={props.attachmentConfig}
        returnToExecutionList={props.returnToExecutionList}
        handleSelectTestForExecution={props.handleSelectTestForExecution}
        getExecutionReferenceCount={props.getExecutionReferenceCount}
        getSnapshotStatus={props.getSnapshotStatus}
        getSnapshotReferences={props.getSnapshotReferences}
        renderCaseReferences={props.renderCaseReferences}
        handleSnapshotStatusChange={props.handleSnapshotStatusChange}
        handleSnapshotNoteChange={props.handleSnapshotNoteChange}
        handleSnapshotNoteBlur={props.handleSnapshotNoteBlur}
        handleSnapshotAttachmentUpload={props.handleSnapshotAttachmentUpload}
        handleRemoveSnapshotAttachment={props.handleRemoveSnapshotAttachment}
        handleGeneralExecutionAttachmentUpload={props.handleGeneralExecutionAttachmentUpload}
        handleRemoveGeneralExecutionAttachment={props.handleRemoveGeneralExecutionAttachment}
        getExecutionCompletionPlan={props.getExecutionCompletionPlan}
        handleCompleteCase={props.handleCompleteCase}
        relatedCaseBugs={props.relatedCaseBugs}
        relatedCaseBugsLoading={props.relatedCaseBugsLoading}
        currentComponentName={props.currentComponentName}
        onRefreshRelatedBugs={props.onRefreshRelatedBugs}
        onLinkExecutionToBug={props.onLinkExecutionToBug}
        onViewRelatedBug={props.onViewRelatedBug}
        onCreateInternalBugFromExecution={props.onCreateInternalBugFromExecution}
        creatingInternalBugContextId={props.creatingInternalBugContextId}
        setZoomImage={setZoomImage}
      />
    )
  }

  if (activeTab === 'ejecutar' && viewMode === 'api_exec') {
    return <ApiExecutionConsolePage
      selectedTest={selectedTest}
      apiExecutionResults={props.currentExecutionRun?.apiExecutionResults || props.currentExecutionRun}
      executionDatasetPreview={props.executionDatasetPreview}
      currentProjectEnvironments={props.currentProjectEnvironments}
      returnToExecutionList={props.returnToExecutionList}
      onExecuteRequest={async () => {
        if (typeof props.handleStartExecution !== 'function') {
          throw new Error('La consola API no pudo conectar el botón con el motor de ejecución. Volvé a abrir la prueba.')
        }
        if (!selectedTest?.id) {
          throw new Error('No hay un caso API seleccionado para ejecutar.')
        }
        return props.handleStartExecution('manual', {
          forceApi: true,
          executeRequest: true,
          runId: props.currentExecutionRun?.apiExecutionResults?.run_id,
          environmentId: props.currentExecutionRun?.apiExecutionResults?.environment_id,
          datasetId: props.currentExecutionRun?.apiExecutionResults?.dataset_id,
          tests: [selectedTest],
        })
      }}
      onAdvanceApiCase={props.onAdvanceApiCase}
      onDeferApiCase={props.onDeferApiCase}
      onSaveApiEvaluation={props.onSaveApiEvaluation}
      onApiVerdictSaved={props.onApiVerdictSaved}
      onRepeatExecution={() => { props.returnToExecutionList(); props.openSingleCaseExecutionSelector?.(selectedTest) }}
      relatedCaseBugs={props.relatedCaseBugs}
      relatedCaseBugsLoading={props.relatedCaseBugsLoading}
      onLoadRelatedBugs={props.onLoadRelatedBugs}
      onPrepareApiBug={props.onPrepareApiBug}
      onLinkApiExecutionToBug={props.onLinkApiExecutionToBug}
      onViewRelatedBug={props.onViewRelatedBug}
      canViewBugs={props.canAccessCapability?.('bugs.ver', 'read') !== false}
      canCreateBugs={props.canAccessCapability?.('bugs.crear', 'edit') !== false}
      showFeedback={props.showFeedback}
    />
  }

  if (activeTab === 'ejecutar' && viewMode === 'chatbot_manual' && selectedTest) {
    return (
      <ChatbotManualConsolePage
        selectedTest={selectedTest}
        currentProjectId={props.currentProjectId}
        activeExecutionTests={props.activeExecutionTests}
        currentComponentName={props.currentComponentName}
        currentExecutionRun={props.currentExecutionRun}
        currentExecutionCase={props.currentExecutionCase}
        setCurrentExecutionCase={props.setCurrentExecutionCase}
        syncExecutionCaseStatus={props.syncExecutionCaseStatus}
        currentProjectEnvironments={props.currentProjectEnvironments}
        selectedExecutionEnvironmentId={props.selectedExecutionEnvironmentId}
        selectedExecutionDatasetId={props.selectedExecutionDatasetId}
        fetchWithAuth={props.fetchWithAuth}
        returnToExecutionList={props.returnToExecutionList}
        handleSelectTestForExecution={props.handleSelectTestForExecution}
        advanceToNextTest={props.advanceToNextTest}
        showFeedback={props.showFeedback}
        relatedCaseBugs={props.relatedCaseBugs}
        relatedCaseBugsLoading={props.relatedCaseBugsLoading}
        onRefreshRelatedBugs={props.onRefreshRelatedBugs}
        onViewRelatedBug={props.onViewRelatedBug}
        onLinkExecutionToBug={props.onLinkExecutionToBug}
        findOpenBugForExecutionContext={props.findOpenBugForExecutionContext}
        requestRelatedBugDecision={props.requestRelatedBugDecision}
        openConversationalBugReport={props.openConversationalBugReport}
        reopenConversationalBugReport={props.reopenConversationalBugReport}
        internalBugDraft={props.internalBugDraft}
      />
    )
  }

  return null
}
