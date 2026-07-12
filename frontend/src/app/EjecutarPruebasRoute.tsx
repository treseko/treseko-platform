import { useState } from 'react'
import { ConsolaManualPage } from '../features/ejecutar-pruebas/ConsolaManualPage'
import { EjecutarPruebasPage } from '../features/ejecutar-pruebas/EjecutarPruebasPage'
import { EvidenceViewerModal, type EvidenceViewerItem } from '../shared/components/EvidenceViewerModal'

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
  ...props
}: EjecutarPruebasRouteProps) {
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

  return null
}
