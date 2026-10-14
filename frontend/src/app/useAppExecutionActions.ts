import { useState, useRef, useEffect } from "react";
import { useExecutionPreparation } from "../features/ejecutar-pruebas/hooks/useExecutionPreparation";
import { createEjecucionActionBundle } from "../features/ejecucion/ejecucionActionBundle";
export function useAppExecutionActions({ options }: { options: any }) {
  const { canAccessCapability } = options;
  const executionGuardRef = useRef({ details: 0, selection: 0, context: '' });
  const executionDraftRef = useRef({ dirty: false, version: 0 });
  const contextKey = `${options.currentProjectId}:${options.currentBuildId}:${options.currentCompId}:${options.activeTab}`;
  if (executionGuardRef.current.context !== contextKey) {
    executionGuardRef.current.context = contextKey;
    executionGuardRef.current.details++;
    executionGuardRef.current.selection++;
  }
  const generalDraft = useRef({ id: '', status: '', note: '' });
  useEffect(() => {
    const next = { id: String(options.currentExecutionCase?.id || ''), status: options.generalExecutionStatus, note: options.generalExecutionNote };
    if (next.id === generalDraft.current.id && (next.status !== generalDraft.current.status || next.note !== generalDraft.current.note)) {
      executionDraftRef.current.dirty = true;
      executionDraftRef.current.version++;
    }
    if (next.id !== generalDraft.current.id || ['PASO', 'FALLO', 'BLOQUEADO'].includes(options.currentExecutionCase?.estado_resultado)) executionDraftRef.current.dirty = false;
    generalDraft.current = next;
  }, [options.currentExecutionCase?.id, options.currentExecutionCase?.estado_resultado, options.generalExecutionStatus, options.generalExecutionNote]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!executionDraftRef.current.dirty) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  // Keep the original batch local to the selector. The parent selection state
  // contains only cases that are currently enabled, so it cannot be used to
  // rebuild a format after the user temporarily deselects it.
  const [modalCandidateCaseIds, setModalCandidateCaseIds] = useState<string[] | null>(
    options.executionModalCandidateCaseIds || null,
  );
  const { activeExecutionCaseIds,activeTab,aiEngineConfig,attachmentConfig,buildCaseIds,buildCaseResultHistoryByBuild,buildCasesLoadingByBuild,buildsList,casosList,casosLoading,componentsList,currentBuildId,currentCompId,currentExecutionCase,currentExecutionRun,currentProjectCases,currentProjectId,executionDatasetPreview,executionModalCaseIds,executionModalCandidateCaseIds,executionSnapshots,fetchWithAuth,generalExecutionAttachments,generalExecutionNote,generalExecutionSnapshot,generalExecutionStatus,latestResultsLoadingByBuild,loadBuildCaseExecutionStatus,loadBuildCases,loadCasoExecutionHistory,loadCasosFromBackend,managingProjectId,mapBackendCasoToTest,redmineDecisionByExecution,selectSuiteTarget,selectedExecutionDatasetId,selectedExecutionEnvironmentId,selectedExecutionTestIds,selectedSubSuiteId,selectedSuiteId,selectedTest,setActiveExecutionCaseIds,setActiveTab,setAutomationMonitor,setBuildCaseIds,setBuildCaseResultHistoryByBuild,setCasosList,setCurrentExecutionCase,setCurrentExecutionRun,setExecName,setExecutionDatasetPreview,setExecutionDatasetPreviewLoading,setExecutionLoading,setExecutionModalCaseIds,setExecutionModalCandidateCaseIds,setExecutionMode,setExecutionSnapshots,setGeneralExecutionAttachments,setGeneralExecutionNote,setGeneralExecutionSnapshot,setGeneralExecutionStatus,setIaExecutionStreams,setIaLogs,setIaQueue,setProjectSyncMessage,setRedmineBugs,setRedmineDecisionByExecution,setScheduledTime,setSchedulerSearch,setSelectedExecutionTestIds,setSelectedSubSuiteId,setSelectedSuiteId,setSelectedTest,setSelectedTestsForIa,setShowExecSelector,setShowIaScheduler,setShowRedmineDrawer,setShowRedminePrompt,setSnapshotAttachments,setSnapshotNotes,setStepResults,setViewMode,showExecSelector,showFeedback,snapshotAttachments,snapshotNotes,stepResults,suitesLoading,suitesTree,t,testSearchQuery,viewMode,visibleSuiteTree
 } = options;
  const executionPreparation = useExecutionPreparation({
    activeTab,
    currentBuildId,
    currentCompId,
    currentProjectId,
    currentProjectCases,
    suitesTree,
    visibleSuiteTree,
    buildCaseIds,
    buildCaseResultHistoryByBuild,
    latestResultsLoadingByBuild,
    buildCasesLoadingByBuild,
    suitesLoading,
    casosLoading,
    selectedSubSuiteId,
    selectedSuiteId,
    testSearchQuery,
    selectedExecutionTestIds,
    executionModalCaseIds,
    executionModalCandidateCaseIds: modalCandidateCaseIds,
    activeExecutionCaseIds,
    selectedTest,
    showExecSelector,
    selectedExecutionEnvironmentId,
    selectedExecutionDatasetId,
    executionDatasetPreview,
    setExecutionDatasetPreview,
    setExecutionDatasetPreviewLoading,
    fetchWithAuth,
    casosList,
    selectSuiteTarget,
    setSelectedSuiteId,
    setSelectedSubSuiteId,
    setSelectedTest,
    setSelectedExecutionTestIds,
    setExecutionModalCaseIds,
    setExecutionModalCandidateCaseIds: setModalCandidateCaseIds,
    setShowExecSelector,
    setSelectedTestsForIa,
    setSchedulerSearch,
    setExecName,
    setScheduledTime,
    setShowIaScheduler,
    showFeedback,
  });

  const { activeBuildCaseIds, activeExecutionTests, executionModalTests, executionModalCandidateTests, executionModalDiscardedCount, isOutdatedExecutionCase, getExecutionCaseLabel } = executionPreparation;
  const executionActions = createEjecucionActionBundle({
    executionGuardRef, executionDraftRef, confirmAction: options.confirmAction,
    t,
    managingProjectId,
    currentProjectId,
    currentBuildId,
    currentCompId,
    selectedExecutionEnvironmentId,
    selectedExecutionDatasetId,
    buildsList,
    buildCaseIds,
    currentProjectCases,
    selectedTest,
    activeExecutionTests,
    currentExecutionRun,
    currentExecutionCase,
    activeBuildCaseIds,
    componentsList,
    executionSnapshots,
    stepResults,
    snapshotNotes,
    snapshotAttachments,
    attachmentConfig,
    generalExecutionStatus,
    generalExecutionNote,
    generalExecutionSnapshot,
    generalExecutionAttachments,
    redmineDecisionByExecution,
    viewMode,
    executionModalTests,
    executionModalCandidateTests,
    executionModalDiscardedCount,
    canUseAutomatedExecution:
      canAccessCapability("ejecutar.automatizada", "edit") &&
      canAccessCapability("automatizacion.workers", "read"),
    fetchWithAuth,
    mapBackendCasoToTest,
    isOutdatedExecutionCase,
    getExecutionCaseLabel,
    loadBuildCaseExecutionStatus,
    setCasosList,
    setBuildCaseResultHistoryByBuild,
    setBuildCaseIds,
    setCurrentExecutionCase,
    setExecutionSnapshots,
    setSnapshotAttachments,
    setGeneralExecutionSnapshot,
    setGeneralExecutionAttachments,
    setStepResults,
    setSnapshotNotes,
    setGeneralExecutionStatus,
    setGeneralExecutionNote,
    setExecutionLoading,
    setCurrentExecutionRun,
    setExecutionMode,
    setSelectedTest,
    setActiveExecutionCaseIds,
    setExecutionModalCaseIds,
    setShowExecSelector,
    setViewMode,
    setIaQueue,
    setIaExecutionStreams,
    setIaLogs,
    setActiveTab,
    setAutomationMonitor,
    aiEngineConfig,
    setProjectSyncMessage,
    loadCasoExecutionHistory,
    loadCasosFromBackend,
    loadBuildCases,
    setRedmineDecisionByExecution,
    setShowRedminePrompt,
    setShowRedmineDrawer,
    setRedmineBugs,
    showFeedback,
  });

  return { ...executionPreparation, ...executionActions };
}
