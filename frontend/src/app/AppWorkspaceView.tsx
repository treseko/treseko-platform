import { useEffect } from 'react'
import { AppOverlayStack } from "./AppOverlayStack";
import { AppRouteContent } from "./AppRouteContent";
import { WorkspaceAccessEmptyState } from "./WorkspaceAccessEmptyState";
import { AppShell } from "../layout/AppShell";
import { sortBuildsNewestFirst as defaultSortBuildsNewestFirst } from './mappers'
import { allSidebarItems } from './navigationModel'
import { ADMIN_GUIDE_ACTION_EVENT, type AdminGuideAction } from '../features/onboarding/onboardingEvents'

export function AppWorkspaceView({ options }: { options: any }) {
  const { setCurrentExecutionCase } = options;
  const executionModalCandidateTests = options.executionModalCandidateTests || [];
  const { activeBuildResultsLoaded,activeBuildResultsLoading,activeExecutionTests,activeTab,addStepInput,adminUserRolesConfiguration,agents,aiDryRunRunning,aiEngineConfiguration,allAuthoringCases,allVisibleExecutionTestsSelected,appUsers,archivedAuthoringCases,assignPreviousFailedCases,assignableUsers,attachmentConfig,authoringInitialLoading,authoringRefreshing,automationMonitor,backToRelatedBugDecisionList,belongsToCurrentComponent,bugTrackerRefreshToken,buildActions,buildCaseDraftIds,buildCaseIds,buildCaseSearch,buildsList,canAccessCapability,canAccessModule,canEditCurrentProject,canRenderActiveModule,canSaveCaseEditor,caseArchiveView,caseEditorOpen,caseEditorSaving,caseVersions,closeConfirmDialog,closeExecutionRunDetail,closeExecutionSelector,closeRelatedBugDecision,collapsedSections,componentActions,componentForm,componentSearchQuery,componentsList,configTab,confirmAction,confirmDialog,consumeDeepLinkBug,copyToClipboard,creatingInternalBugContextId,currentAuthoringCases,currentBuildId,currentBuildIsReadOnly,currentCompId,currentComponentCases,currentComponentName,currentExecutionCase,currentExecutionRun,currentOrgId,currentProjectAgents,currentProjectCases,currentProjectCustomInventoryItems,currentProjectDevices,currentProjectEnvironments,currentProjectIaQueue,currentProjectId,currentProjectInventoryCategories,currentProjectRedmineBugs,currentProjectRunHistory,customInventoryItems,customRoles,deepLinkBugId,deferRedmineReportAndContinue,devices,duplicateStepInput,editingBuildCasesId,editingCasoMasterId,editingRoleId,editingSuiteId,editingUserId,environmentActions,environments,execName,executionBugDetailId,executionDatasetPreview,executionDatasetPreviewLoading,executionInitialLoading,executionLoading,executionModalDiscardedCount,executionModalTests,executionRefreshing,executionRunDetail,executionRunDetailError,executionRunDetailLoading,executionSnapshots,executionSuiteTree,expandedMetricSuites,feedbackModal,fetchWithAuth,filteredTests,firstRunLoaded,firstRunState,focusedExecutionId,folderConfig,generalConfiguration,generalExecutionAttachments,generalExecutionNote,generalExecutionSnapshot,generalExecutionStatus,generateBugDescription,getCasoVersionRows,getExecutionActionLabel,getExecutionCaseLabel,getExecutionCompletionPlan,getExecutionReferenceCount,getExecutionStatusKey,getSnapshotReferences,getSnapshotStatus,getSuiteDepth,handleAssignOrganizationMember,handleCloneCaso,handleCloneSuite,handleCompleteCase,handleComponentChange,handleCreateCaseFromStory,handleCreateInternalBugFromCaseHistory,handleCreateInternalBugFromExecution,handleCreateOrganization,handleCreateSuite,handleGeneralExecutionAttachmentUpload,handleInternalBugDraftChange,handleLaunchIaMission,handleLoggedUserPreferencesUpdated,handleLoggedUserUpdated,handleLogout,handleModuleNavigation,handleMoveCaso,handleMoveSuite,handleOpenLinkedCaseFromStory,handleOrgChange,handleProjectChange,handleRemoveGeneralExecutionAttachment,handleRemoveOrganizationMember,handleRemoveSnapshotAttachment,handleRunAiDryRunFromEditor,handleRunSavedAutomatedCaseFromEditor,handleSaveRole,handleSaveTest,handleSaveUser,handleSelectTestForExecution,handleSetOrganizationActive,handleSnapshotAttachmentUpload,handleSnapshotNoteBlur,handleSnapshotNoteChange,handleSnapshotStatusChange,handleStartExecution,handleStepInputChange,handleSubmitInternalBugReport,handleUpdateOrganization,handleUpdateSuite,handleUserCustomRoleChange,handleUserRoleChange,hasOrganizationAccess,hasSystemFeature,hasUnsavedCaseChanges,historialInitialFilters,iaExecutionStreams,iaLogs,iaProvider,iaStatus,internalBugAdditionalContext,internalBugDraft,internalBugEvidence,invModalConfig,inventoryCategories,isOutdatedExecutionCase,linkBugFromDecision,linkExecutionToExistingBug,loadCasosFromBackend,loadOrganizationsFromBackend,loadProjectMetrics,loadProjectRunHistory,loadRelatedBugsForSelectedCase,loadTestRunDetail,lockedBuildCaseIds,loggedUser,managingProjectId,markHistorialAiReviewed,metricsLoading,moveStepInput,moveSuiteParentId,movingSuiteId,newTestApiConfig,newTestComponent,newTestCriticality,newTestData,newTestDescription,newTestFormat,newTestFramework,newTestLanguage,newTestPost,newTestPre,newTestPriority,newTestScript,newTestStatus,newTestSteps,newTestSuite,newTestSuiteSub,newTestTags,newTestTitle,newTestType,openBugsByCase,openBugsLoading,openBuildCasesModal,openCreateSuiteModal,openExecutionRunDetail,openExecutionSelector,openHistorialRuns,openIaSchedulerFromExecutionSelector,openIaSchedulerFromWorkflowBuilder,openInternalBugReportFromPrompt,openManualInternalBugDrawer,openRedmineReportFromPrompt,openSingleCaseExecutionSelector,organizationMemberForm,organizationMembers,organizations,pendingHistorialRunDetailId,pendingTraceabilityStoryIds,persistAccessToken,projectActions,projectInnerTab,projectMemberActions,projectMemberForm,projectMemberRemoval,projectMembers,projectMetrics,projectSyncMessage,projectVersion,projectsList,projectsLoading,projectsSource,redmineUrl,refreshCurrentBuildExecutionStatus,relatedBugDecision,relatedCaseBugs,relatedCaseBugsLoading,removeStepInput,renderAuthoringSuiteTree,renderCaseReferences,renderExecutionSuiteTree,returnToExecutionList,roleForm,saveBuildCases,scheduledTime,schedulerSearch,scriptTestResult,scriptTesting,selectSuiteTarget,selectedCompareVersionId,selectedExecutionDatasetId,selectedExecutionEnvironmentId,selectedExecutionTestIds,selectedExecutionTests,selectedOrganizationId,selectedSuiteId,selectedTest,selectedTestsForIa,selectedWiki,sessionConfiguration,setActiveTab,setAgents,setAutomationMonitor,setBranding,setBugTrackerRefreshToken,setBuildCaseDraftIds,setBuildCaseSearch,setCaseArchiveView,setCaseEditorOpen,setCollapsedSections,setComponentForm,setComponentSearchQuery,setComponentsList,setConfigTab,setCurrentBuildId,setCustomInventoryItems,setDevices,setEditingCasoMasterId,setEditingSuiteId,setEnvironments,setExecName,setExecutionBugDetailId,setExpandedMetricSuites,setExpandedSuites,setFeedbackModal,setFirstRunState,setGeneralExecutionNote,setGeneralExecutionStatus,setIaExecutionStreams,setIaLogs,setIaQueue,setIaSchedulerOpenedFromBuilder,setInternalBugAdditionalContext,setInternalBugDraft,setInternalBugEvidence,setInvModalConfig,setInventoryCategories,setManagingProjectId,setMoveSuiteParentId,setMovingSuiteId,setNewTestApiConfig,setNewTestComponent,setNewTestCriticality,setNewTestData,setNewTestDescription,setNewTestFormat,setNewTestFramework,setNewTestLanguage,setNewTestPost,setNewTestPre,setNewTestPriority,setNewTestScript,setNewTestStatus,setNewTestTags,setNewTestTitle,setNewTestType,setOrganizationMemberForm,setPendingHistorialRunDetailId,setPendingTraceabilityStoryIds,setProjectInnerTab,setProjectMemberForm,setProjectMemberRemoval,setRoleCapabilityPermission,setRoleForm,setRoleModulePermission,setScheduledTime,setSchedulerSearch,setScriptTestResult,setScriptTesting,setSelectedCompareVersionId,setSelectedExecutionDatasetId,setSelectedExecutionEnvironmentId,setSelectedExecutionTestIds,setSelectedOrganizationId,setSelectedSubSuiteId,setSelectedTest,setSelectedTestsForIa,setSelectedWiki,setShowAddFolderModal,setShowBuildCasesModal,setShowComponentModal,setShowIaScheduler,setShowMoveSuiteModal,setShowProjectMemberModal,setShowRedmineDrawer,setShowRedminePrompt,setShowRoleModal,setShowSuiteModal,setShowUserModal,setShowVersionsModal,setSuiteForm,setTestSearchQuery,setUserForm,setWikiFormData,setWikiMode,setZoomImage,showAddFolderModal,showBuildCasesModal,showComponentModal,showExecSelector,showFeedback,showIaScheduler,showMoveSuiteModal,showProjectMemberModal,showRedmineDrawer,showRedminePrompt,showRoleModal,showSuiteModal,showUserModal,showVersionsModal,showWorkspaceAccessGate,snapshotAttachments,snapshotNotes,startSuiteExplorerResize,suiteExplorerWidth,suiteForm,suitesTree,systemEdition,testSearchQuery,toggleExecutionSelection,toggleVisibleExecutionSelection,traceabilityRefreshToken,updateMaintenanceState,updateStepAttachments,userForm,versionsCase,viewMode,viewRelatedBugFromDecision,visibleAuthoringCases,visibleAuthoringSuiteTree,visibleSuiteTree,wikiActions,wikiFormData,wikiMode,wikiPages,zoomImage
 } = options;
  const { sidebarCollapsed, setSidebarCollapsed, sidebarItems, sortBuildsNewestFirst: providedSortBuildsNewestFirst, branding } = options;
  const loadSuitesFromBackend = options.loadSuitesFromBackend;
  const findOpenBugForExecutionContext = options.findOpenBugForExecutionContext; const requestRelatedBugDecision = options.requestRelatedBugDecision;
  const sortBuildsNewestFirst = providedSortBuildsNewestFirst || defaultSortBuildsNewestFirst;
  const visibleSidebarItems = sidebarItems || allSidebarItems.filter(item => canAccessModule(item.id));

  useEffect(() => {
    const focusGuideTarget = (targetName: string) => {
      window.setTimeout(() => {
        const target = document.querySelector<HTMLElement>(`[data-onboarding-target="${targetName}"]`)
        const focusable = target?.matches('input,button,select,textarea')
          ? target
          : target?.querySelector<HTMLElement>('input,button,select,textarea')
        focusable?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        focusable?.focus({ preventScroll: true })
      }, 80)
    }

    const goToProjects = (targetName?: string) => {
      handleModuleNavigation('proyectos')
      setManagingProjectId(null)
      setProjectInnerTab('config')
      if (targetName) focusGuideTarget(targetName)
    }

    const handleGuideAction = (event: Event) => {
      const action = (event as CustomEvent<{ action?: AdminGuideAction }>).detail?.action
      if (!action) return

      const hasActiveOrganization = organizations.some((organization: any) => organization.active !== false)
      if (action === 'solution' || (action === 'project' && !hasActiveOrganization)) {
        handleModuleNavigation('configuracion')
        setConfigTab('clients')
        return
      }

      if (action === 'project') {
        goToProjects('project-create')
        return
      }

      if (action === 'component' || action === 'build') {
        if (!currentProjectId) {
          goToProjects('project-create')
          return
        }
        handleModuleNavigation('proyectos')
        setManagingProjectId(currentProjectId)
        setProjectInnerTab('components')
        focusGuideTarget(action === 'build' && currentCompId ? 'build-create' : 'component-create')
        return
      }

      if (action === 'suite' || action === 'case') {
        handleModuleNavigation('crear_pruebas')
        focusGuideTarget('suite-create')
        return
      }

      if (action === 'execution') {
        handleModuleNavigation('ejecutar')
        return
      }

      if (action === 'evidence') {
        handleModuleNavigation('historial')
        return
      }

      if (action === 'bug') {
        handleModuleNavigation('bugs')
        return
      }

      if (action === 'report') {
        handleModuleNavigation('reportes')
      }
    }

    window.addEventListener(ADMIN_GUIDE_ACTION_EVENT, handleGuideAction)
    return () => window.removeEventListener(ADMIN_GUIDE_ACTION_EVENT, handleGuideAction)
    // The workspace navigation callbacks are stable for the lifetime of the app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompId, currentProjectId, organizations])

  return (
    <>
      <AppShell
        sidebarCollapsed={sidebarCollapsed}
        setSidebarCollapsed={setSidebarCollapsed}
        sidebarItems={visibleSidebarItems}
        activeTab={activeTab}
        onModuleNavigation={handleModuleNavigation}
        organizations={organizations}
        currentOrgId={currentOrgId}
        onOrgChange={handleOrgChange}
        loggedUser={loggedUser}
        onLogout={handleLogout}
        projectsList={projectsList}
        currentProjectId={currentProjectId}
        onProjectChange={handleProjectChange}
        componentsList={componentsList}
        currentCompId={currentCompId}
        onComponentChange={handleComponentChange}
        buildsList={buildsList}
        currentBuildId={currentBuildId}
        sortBuildsNewestFirst={sortBuildsNewestFirst}
        onBuildChange={(build) => {
          setCurrentBuildId(build.id);
        }}
        canAccessConfig={canAccessModule("configuracion")}
        systemEdition={systemEdition}
        branding={branding}
      >
        {showWorkspaceAccessGate && (
          <WorkspaceAccessEmptyState
            userName={loggedUser.name}
            hasOrganizationAccess={hasOrganizationAccess}
          />
        )}
        {!showWorkspaceAccessGate && canRenderActiveModule && (
          <>
            <AppRouteContent options={{
              activeBuildResultsLoaded,
              activeBuildResultsLoading,
              activeExecutionTests,
              activeTab,
              addStepInput,
              adminUserRolesConfiguration,
              agents,
              aiDryRunRunning,
              aiEngineConfiguration,
              allAuthoringCases,
              allVisibleExecutionTestsSelected,
              appUsers,
              archivedAuthoringCases,
              attachmentConfig,
              authoringInitialLoading,
              authoringRefreshing,
              bugTrackerRefreshToken,
              buildActions,
              buildCaseIds,
              buildsList,
              canAccessCapability,
              canAccessModule,
              canEditCurrentProject,
              canSaveCaseEditor,
              caseArchiveView,
              caseEditorOpen,
              caseEditorSaving,
              closeExecutionRunDetail,
              collapsedSections,
              componentActions,
              componentSearchQuery,
              componentsList,
              configTab,
              confirmAction,
              consumeDeepLinkBug,
              copyToClipboard,
              creatingInternalBugContextId,
              currentAuthoringCases,
              currentBuildId,
              currentBuildIsReadOnly,
              currentCompId,
              currentComponentCases,
              currentComponentName,
              currentExecutionCase,
              currentExecutionRun,
              setCurrentExecutionCase: options.setCurrentExecutionCase,
              currentOrgId,
              currentProjectAgents,
              currentProjectCases,
              currentProjectCustomInventoryItems,
              currentProjectDevices,
              currentProjectEnvironments,
              currentProjectIaQueue,
              currentProjectId,
              currentProjectInventoryCategories,
              currentProjectRedmineBugs,
              currentProjectRunHistory,
              customInventoryItems,
              deepLinkBugId,
              devices,
              duplicateStepInput,
              editingCasoMasterId,
              environmentActions,
              environments,
              executionBugDetailId,
              executionInitialLoading,
              executionRefreshing,
              executionRunDetail,
              executionRunDetailError,
              executionRunDetailLoading,
              executionSnapshots,
              executionSuiteTree,
              expandedMetricSuites,
              fetchWithAuth,
              filteredTests,
              focusedExecutionId,
              generalConfiguration,
              generalExecutionAttachments,
              generalExecutionNote,
              generalExecutionSnapshot,
              generalExecutionStatus,
              getExecutionActionLabel,
              getExecutionCompletionPlan,
              getExecutionReferenceCount,
              getExecutionStatusKey,
              getSnapshotReferences,
              getSnapshotStatus,
              getSuiteDepth,
              handleAssignOrganizationMember,
              handleCloneCaso,
              handleCloneSuite,
              handleCompleteCase,
              handleCreateCaseFromStory,
              handleCreateInternalBugFromCaseHistory,
              handleCreateOrganization,
              handleGeneralExecutionAttachmentUpload,
              handleLoggedUserPreferencesUpdated,
              handleLoggedUserUpdated,
              handleMoveCaso,
              handleOpenLinkedCaseFromStory,
              handleProjectChange,
              handleComponentChange,
              handleRemoveGeneralExecutionAttachment,
              handleRemoveOrganizationMember,
              handleRemoveSnapshotAttachment,
              handleRunAiDryRunFromEditor,
              handleRunSavedAutomatedCaseFromEditor,
              handleSaveTest,
              handleSelectTestForExecution,
              handleSetOrganizationActive,
              handleStartExecution,
              handleSnapshotAttachmentUpload,
              handleSnapshotNoteBlur,
              handleSnapshotNoteChange,
              handleSnapshotStatusChange,
              handleStepInputChange,
              handleUpdateOrganization,
              hasSystemFeature,
              hasUnsavedCaseChanges,
              historialInitialFilters,
              iaExecutionStreams,
              iaLogs,
              iaStatus,
              inventoryCategories,
              isOutdatedExecutionCase,
              findOpenBugForExecutionContext, linkExecutionToExistingBug, loadCasosFromBackend, loadSuitesFromBackend,
              loadOrganizationsFromBackend,
              loadProjectMetrics,
              loadProjectRunHistory,
              loadRelatedBugsForSelectedCase,
              loadTestRunDetail,
              loggedUser,
              managingProjectId,
              markHistorialAiReviewed,
              metricsLoading,
              moveStepInput, newTestApiConfig, newTestChatbotConfig: options.newTestChatbotConfig,
              newTestComponent,
              newTestCriticality,
              newTestData,
              newTestDescription,
              newTestFormat,
              newTestFramework,
              newTestLanguage,
              newTestPost,
              newTestPre,
              newTestPriority,
              newTestScript,
              newTestStatus,
              newTestSteps,
              newTestSuite,
              newTestSuiteSub,
              newTestTags,
              newTestTitle,
              newTestType,
              openBugsByCase,
              openBugsLoading,
              openBuildCasesModal,
              openCreateSuiteModal,
              openExecutionRunDetail,
              openExecutionSelector,
              openHistorialRuns,
              openIaSchedulerFromWorkflowBuilder,
              openInternalBugReportFromPrompt,
              openManualInternalBugDrawer,
              openSingleCaseExecutionSelector,
              organizationMemberForm,
              organizationMembers,
              organizations,
              pendingHistorialRunDetailId,
              pendingTraceabilityStoryIds,
              projectActions,
              projectInnerTab,
              projectMemberActions,
              projectMembers,
              projectMetrics,
              projectSyncMessage,
              projectVersion,
              projectsList,
              projectsLoading,
              projectsSource,
              redmineUrl,
              relatedCaseBugs,
              relatedCaseBugsLoading,
              removeStepInput,
              renderAuthoringSuiteTree,
              renderCaseReferences,
              renderExecutionSuiteTree, requestRelatedBugDecision, returnToExecutionList,
              scriptTestResult,
              scriptTesting,
              selectSuiteTarget,
              selectedExecutionTestIds,
              selectedExecutionTests,
              selectedOrganizationId,
              selectedSuiteId,
              selectedTest,
              selectedWiki,
              sessionConfiguration,
              setActiveTab,
              setAgents,
              setBranding,
              setBugTrackerRefreshToken,
              setCaseArchiveView,
              setCaseEditorOpen,
              setCollapsedSections,
              setComponentForm,
              setComponentSearchQuery,
              setComponentsList,
              setConfigTab,
              setCustomInventoryItems,
              setDevices,
              setEditingCasoMasterId,
              setEnvironments,
              setExecutionBugDetailId,
              setExpandedMetricSuites,
              setExpandedSuites,
              setGeneralExecutionNote,
              setGeneralExecutionStatus,
              setIaExecutionStreams,
              setIaLogs,
              setIaQueue,
              setInvModalConfig,
              setInventoryCategories,
              setManagingProjectId, setNewTestApiConfig, setNewTestChatbotConfig: options.setNewTestChatbotConfig,
              setNewTestComponent,
              setNewTestCriticality,
              setNewTestData,
              setNewTestDescription,
              setNewTestFormat,
              setNewTestFramework,
              setNewTestLanguage,
              setNewTestPost,
              setNewTestPre,
              setNewTestPriority,
              setNewTestScript,
              setNewTestStatus,
              setNewTestTags,
              setNewTestTitle,
              setNewTestType,
              setOrganizationMemberForm,
              setPendingHistorialRunDetailId,
              setPendingTraceabilityStoryIds,
              setProjectInnerTab,
              setScriptTestResult,
              setScriptTesting,
              setSelectedExecutionTestIds,
              setSelectedOrganizationId,
              setSelectedSubSuiteId,
              setSelectedTest,
              setSelectedWiki,
              setShowComponentModal,
              setTestSearchQuery,
              setWikiFormData,
              setWikiMode,
              setZoomImage,
              showFeedback,
              snapshotAttachments,
              snapshotNotes,
              startSuiteExplorerResize,
              suiteExplorerWidth,
              suitesTree,
              testSearchQuery,
              toggleExecutionSelection,
              toggleVisibleExecutionSelection,
              traceabilityRefreshToken,
              updateStepAttachments,
              viewMode,
              visibleAuthoringCases,
              visibleAuthoringSuiteTree,
              visibleSuiteTree,
              wikiActions,
              wikiFormData,
              wikiMode,
              wikiPages,
            }} />
          </>
        )}
      </AppShell>
      <AppOverlayStack options={{
        removeExecutionModalCase: options.removeExecutionModalCase,
        restoreExecutionModalCases: options.restoreExecutionModalCases,
        agents,
        appUsers,
        assignPreviousFailedCases,
        assignableUsers,
        automationMonitor,
        backToRelatedBugDecisionList,
        belongsToCurrentComponent,
        buildCaseDraftIds,
        buildCaseSearch,
        buildsList,
        canAccessCapability,
        canAccessModule,
        caseVersions,
        closeConfirmDialog,
        closeExecutionSelector,
        closeRelatedBugDecision,
        componentActions,
        componentForm,
        componentsList,
        confirmDialog,
        creatingInternalBugContextId,
        currentAuthoringCases,
        currentBuildId,
        currentCompId,
        currentExecutionCase,
        currentProjectCases,
        currentProjectEnvironments,
        currentProjectId,
        currentProjectRedmineBugs,
        customInventoryItems,
        customRoles,
        deferRedmineReportAndContinue,
        devices,
        editingBuildCasesId,
        editingRoleId,
        editingSuiteId,
        editingUserId,
        environments,
        execName,
        executionDatasetPreview,
        executionDatasetPreviewLoading,
        executionLoading,
        executionModalDiscardedCount,
        executionModalCandidateTests,
        executionModalTests,
        feedbackModal,
        fetchWithAuth,
        firstRunLoaded,
        firstRunState,
        folderConfig,
        generateBugDescription,
        getCasoVersionRows,
        getExecutionCaseLabel,
        handleCreateInternalBugFromExecution,
        handleCreateSuite,
        handleInternalBugDraftChange,
        handleLaunchIaMission,
        handleLoggedUserPreferencesUpdated,
        handleMoveSuite,
        handleSaveRole,
        handleSaveUser,
        handleStartExecution,
        handleSubmitInternalBugReport,
        handleUpdateSuite,
        handleUserCustomRoleChange,
        handleUserRoleChange,
        hasSystemFeature,
        iaProvider,
        internalBugAdditionalContext,
        internalBugDraft,
        internalBugEvidence,
        invModalConfig,
        isOutdatedExecutionCase,
        linkBugFromDecision,
        lockedBuildCaseIds,
        loggedUser,
        managingProjectId,
        moveSuiteParentId,
        movingSuiteId,
        openHistorialRuns,
        openIaSchedulerFromExecutionSelector,
        openInternalBugReportFromPrompt,
        openManualInternalBugDrawer,
        openRedmineReportFromPrompt,
        persistAccessToken,
        projectMemberActions,
        projectMemberForm,
        projectMemberRemoval,
        projectsList,
        refreshCurrentBuildExecutionStatus,
        relatedBugDecision,
        roleForm,
        saveBuildCases,
        scheduledTime,
        schedulerSearch,
        selectedCompareVersionId,
        selectedExecutionDatasetId,
        selectedExecutionEnvironmentId,
        selectedTest,
        selectedTestsForIa,
        setActiveTab,
        setAgents,
        setAutomationMonitor,
        setBuildCaseDraftIds,
        setBuildCaseSearch,
        setComponentForm,
        setCustomInventoryItems,
        setDevices,
        setEditingSuiteId,
        setEnvironments,
        setExecName,
        setFeedbackModal,
        setFirstRunState,
        setIaSchedulerOpenedFromBuilder,
        setInternalBugAdditionalContext,
        setInternalBugDraft,
        setInternalBugEvidence,
        setInvModalConfig,
        setMoveSuiteParentId,
        setMovingSuiteId,
        setProjectMemberForm,
        setProjectMemberRemoval,
        setRoleCapabilityPermission,
        setRoleForm,
        setRoleModulePermission,
        setScheduledTime,
        setSchedulerSearch,
        setSelectedCompareVersionId,
        setSelectedExecutionDatasetId,
        setSelectedExecutionEnvironmentId,
        setSelectedTestsForIa,
        setShowAddFolderModal,
        setShowBuildCasesModal,
        setShowComponentModal,
        setShowIaScheduler,
        setShowMoveSuiteModal,
        setShowProjectMemberModal,
        setShowRedmineDrawer,
        setShowRedminePrompt,
        setShowRoleModal,
        setShowSuiteModal,
        setShowUserModal,
        setShowVersionsModal,
        setSuiteForm,
        setUserForm,
        setZoomImage,
        showAddFolderModal,
        showBuildCasesModal,
        showComponentModal,
        showExecSelector,
        showFeedback,
        showIaScheduler,
        showMoveSuiteModal,
        showProjectMemberModal,
        showRedmineDrawer,
        showRedminePrompt,
        showRoleModal,
        showSuiteModal,
        showUserModal,
        showVersionsModal,
        suiteForm,
        suitesTree,
        systemEdition,
        updateMaintenanceState,
        userForm,
        versionsCase,
        viewRelatedBugFromDecision,
        visibleSuiteTree,
        zoomImage,
      }} />
    </>
  );
}
