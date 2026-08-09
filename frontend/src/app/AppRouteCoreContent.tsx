import { AnadirPruebasPage } from '../features/casos/AnadirPruebasPage'
import { AutomatizacionPage } from '../features/automatizacion/AutomatizacionPage'
import { BugTrackerPage } from '../features/bugs/BugTrackerPage'
import { ConfiguracionRoute } from './ConfiguracionRoute'
import { DashboardRoute } from './DashboardRoute'
import { EjecutarPruebasRoute } from './EjecutarPruebasRoute'
import { HistorialRoute } from './HistorialRoute'
import { InventarioPage } from '../features/inventario/InventarioPage'
import { MotorIaPage } from '../features/motor-ia/MotorIaPage'
import { ProyectosRoute } from './ProyectosRoute'
import { RedminePage } from '../features/redmine/RedminePage'
import { ReportesRoute } from './ReportesRoute'
import { sortBuildsNewestFirst } from './mappers'
import { normalizeBrandingState } from './branding'
import { getStatusColor } from '../features/ejecucion/executionUtils'

export function AppRouteCoreContent({ options }: { options: any }) {
  const {
    activeBuildResultsLoaded, activeBuildResultsLoading, activeExecutionTests, activeTab, addStepInput, adminUserRolesConfiguration, agents, aiDryRunRunning,
    aiEngineConfiguration, allAuthoringCases, allVisibleExecutionTestsSelected, appUsers, archivedAuthoringCases, attachmentConfig, authoringInitialLoading, authoringRefreshing,
    bugTrackerRefreshToken, buildActions, buildCaseIds, buildsList, canAccessCapability, canAccessModule, canEditCurrentProject, canSaveCaseEditor,
    caseArchiveView, caseEditorOpen, caseEditorSaving, closeExecutionRunDetail, collapsedSections, componentActions, componentSearchQuery, componentsList,
    configTab, confirmAction, consumeDeepLinkBug, copyToClipboard, creatingInternalBugContextId, currentAuthoringCases, currentBuildId, currentBuildIsReadOnly,
    currentCompId, currentComponentCases, currentComponentName, currentExecutionCase, currentExecutionRun, currentOrgId, currentProjectAgents, currentProjectCases,
    currentProjectCustomInventoryItems, currentProjectDevices, currentProjectEnvironments, currentProjectIaQueue, currentProjectId, currentProjectInventoryCategories, currentProjectRedmineBugs, currentProjectRunHistory,
    customInventoryItems, deepLinkBugId, devices, duplicateStepInput, editingCasoMasterId, environmentActions, environments, executionBugDetailId,
    executionInitialLoading, executionRefreshing, executionRunDetail, executionRunDetailError, executionRunDetailLoading, executionSnapshots, executionSuiteTree, expandedMetricSuites,
    fetchWithAuth, filteredTests, focusedExecutionId, generalConfiguration, generalExecutionAttachments, generalExecutionNote, generalExecutionSnapshot, generalExecutionStatus,
    getExecutionActionLabel, getExecutionCompletionPlan, getExecutionReferenceCount, getExecutionStatusKey, getSnapshotReferences, getSnapshotStatus, getSuiteDepth, handleAssignOrganizationMember,
    handleCloneCaso, handleCloneSuite, handleCompleteCase, handleCreateCaseFromStory, handleCreateInternalBugFromCaseHistory, handleCreateOrganization, handleGeneralExecutionAttachmentUpload, handleLoggedUserPreferencesUpdated,
    handleLoggedUserUpdated, handleMoveCaso, handleOpenLinkedCaseFromStory, handleProjectChange, handleRemoveGeneralExecutionAttachment, handleRemoveOrganizationMember, handleRemoveSnapshotAttachment, handleRunAiDryRunFromEditor,
    handleRunSavedAutomatedCaseFromEditor, handleSaveTest, handleSelectTestForExecution, handleSetOrganizationActive, handleSnapshotAttachmentUpload, handleSnapshotNoteBlur, handleSnapshotNoteChange, handleSnapshotStatusChange,
    handleStepInputChange, handleUpdateOrganization, hasSystemFeature, hasUnsavedCaseChanges, historialInitialFilters, iaExecutionStreams, iaLogs, iaStatus,
    inventoryCategories, isOutdatedExecutionCase, linkExecutionToExistingBug, loadCasosFromBackend, loadOrganizationsFromBackend, loadProjectMetrics, loadProjectRunHistory, loadRelatedBugsForSelectedCase,
    loadTestRunDetail, loggedUser, managingProjectId, markHistorialAiReviewed, metricsLoading, moveStepInput, newTestComponent, newTestCriticality,
    newTestData, newTestDescription, newTestFramework, newTestLanguage, newTestPost, newTestPre, newTestPriority, newTestScript,
    newTestStatus, newTestSteps, newTestSuite, newTestSuiteSub, newTestTags, newTestTitle, newTestType, openBugsByCase,
    openBugsLoading, openBuildCasesModal, openCreateSuiteModal, openExecutionRunDetail, openExecutionSelector, openHistorialRuns, openIaSchedulerFromWorkflowBuilder, openInternalBugReportFromPrompt,
    openManualInternalBugDrawer, openSingleCaseExecutionSelector, organizationMemberForm, organizationMembers, organizations, pendingHistorialRunDetailId, pendingTraceabilityStoryIds, projectActions,
    projectInnerTab, projectMemberActions, projectMembers, projectMetrics, projectSyncMessage, projectVersion, projectsList, projectsLoading,
    projectsSource, redmineUrl, relatedCaseBugs, relatedCaseBugsLoading, removeStepInput, renderAuthoringSuiteTree, renderCaseReferences, renderExecutionSuiteTree,
    returnToExecutionList, scriptTestResult, scriptTesting, selectSuiteTarget, selectedExecutionTestIds, selectedExecutionTests, selectedOrganizationId, selectedSuiteId,
    selectedTest, selectedWiki, sessionConfiguration, setActiveTab, setAgents, setBranding, setBugTrackerRefreshToken, setCaseArchiveView,
    setCaseEditorOpen, setCollapsedSections, setComponentForm, setComponentSearchQuery, setComponentsList, setConfigTab, setCustomInventoryItems, setDevices,
    setEditingCasoMasterId, setEnvironments, setExecutionBugDetailId, setExpandedMetricSuites, setExpandedSuites, setGeneralExecutionNote, setGeneralExecutionStatus, setIaExecutionStreams,
    setIaLogs, setIaQueue, setInvModalConfig, setInventoryCategories, setManagingProjectId, setNewTestComponent, setNewTestCriticality, setNewTestData,
    setNewTestDescription, setNewTestFramework, setNewTestLanguage, setNewTestPost, setNewTestPre, setNewTestPriority, setNewTestScript, setNewTestStatus,
    setNewTestTags, setNewTestTitle, setNewTestType, setOrganizationMemberForm, setPendingHistorialRunDetailId, setPendingTraceabilityStoryIds, setProjectInnerTab, setScriptTestResult,
    setScriptTesting, setSelectedExecutionTestIds, setSelectedOrganizationId, setSelectedSubSuiteId, setSelectedTest, setSelectedWiki, setShowComponentModal, setTestSearchQuery,
    setWikiFormData, setWikiMode, setZoomImage, showFeedback, snapshotAttachments, snapshotNotes, startSuiteExplorerResize, suiteExplorerWidth,
    suitesTree, testSearchQuery, toggleExecutionSelection, toggleVisibleExecutionSelection, traceabilityRefreshToken, updateStepAttachments, viewMode, visibleAuthoringCases,
    visibleAuthoringSuiteTree, visibleSuiteTree, wikiActions, wikiFormData, wikiMode, wikiPages,
  } = options
  return (
    <>
      {/* DASHBOARD */}
      <DashboardRoute
        {...{
          activeTab,
          currentProjectId,
          currentBuildId,
          currentCompId,
          projectVersion,
          loggedUser,
          fetchWithAuth,
          showFeedback,
          handleLoggedUserPreferencesUpdated,
          canAccessCapability,
        }}
      />

      {/* LISTADO EJECUCIÓN */}
      {activeTab === "ejecutar" && viewMode === "list" && (
        <EjecutarPruebasRoute
          {...{
            activeTab,
            viewMode,
            currentProjectId,
            selectedTest,
            setZoomImage,
            openHistorialRuns,
            canAccessCapability,
            openExecutionRunDetail,
            closeExecutionRunDetail,
            executionRunDetail,
            executionRunDetailLoading,
            executionRunDetailError,
            focusedExecutionId,
            suiteExplorerWidth,
            startSuiteExplorerResize,
            executionInitialLoading,
            executionRefreshing,
            executionSuiteTree,
            renderExecutionSuiteTree,
            currentBuildId,
            readOnlyBuild: currentBuildIsReadOnly,
            currentCompId,
            suitesTree,
            selectedSuiteId,
            testSearchQuery,
            setTestSearchQuery,
            setSelectedSubSuiteId,
            setSelectedExecutionTestIds,
            setSelectedTest,
            filteredTests,
            getExecutionStatusKey,
            selectedExecutionTests,
            openExecutionSelector,
            allVisibleExecutionTestsSelected,
            toggleVisibleExecutionSelection,
            handleSelectTestForExecution,
            selectedExecutionTestIds,
            toggleExecutionSelection,
            activeBuildResultsLoading,
            activeBuildResultsLoaded,
            isOutdatedExecutionCase,
            openSingleCaseExecutionSelector,
            getExecutionActionLabel,
            buildsList,
            showFeedback,
            onCreateInternalBugFromCase:
              handleCreateInternalBugFromCaseHistory,
            creatingInternalBugContextId,
            openBugsByCase,
            openBugsLoading,
            onOpenBugTracker: (bug: any) => {
              if (!canAccessCapability('bugs.ver', 'read')) {
                showFeedback('Bug Tracker', 'No tienes permiso para ver bugs.', 'warning');
                return;
              }
              const bugId = bug?.id ? String(bug.id) : "";
              if (bugId) {
                setExecutionBugDetailId(bugId);
                return;
              }
              setActiveTab("bugs");
            },
          }}
        />
      )}

      {/* EJECUCIÓN MANUAL (Hito 11.2) */}
      {activeTab === "ejecutar" &&
        viewMode === "manual_exec" &&
        selectedTest && (
          <EjecutarPruebasRoute
            {...{
              activeTab,
              viewMode,
              currentProjectId,
              selectedTest,
              setZoomImage,
              activeExecutionTests,
              currentExecutionRun,
              currentExecutionCase,
              executionSnapshots,
              snapshotNotes,
              snapshotAttachments,
              generalExecutionSnapshot,
              generalExecutionAttachments,
              generalExecutionStatus,
              setGeneralExecutionStatus,
              generalExecutionNote,
              setGeneralExecutionNote,
              attachmentConfig,
              returnToExecutionList,
              handleSelectTestForExecution,
              getExecutionReferenceCount,
              getSnapshotStatus,
              getSnapshotReferences,
              renderCaseReferences,
              handleSnapshotStatusChange,
              handleSnapshotNoteChange,
              handleSnapshotNoteBlur,
              handleSnapshotAttachmentUpload,
              handleRemoveSnapshotAttachment,
              handleGeneralExecutionAttachmentUpload,
              handleRemoveGeneralExecutionAttachment,
              getExecutionCompletionPlan,
              handleCompleteCase,
              fetchWithAuth,
              showFeedback,
              canAccessCapability,
              setActiveTab,
              relatedCaseBugs,
              relatedCaseBugsLoading,
              currentComponentName,
              onRefreshRelatedBugs: () =>
                loadRelatedBugsForSelectedCase(selectedTest.id, {
                  silent: true,
                }),
              onLinkExecutionToBug: linkExecutionToExistingBug,
              onViewRelatedBug: (bug: any) => setExecutionBugDetailId(String(bug?.id || "")),
              onCreateInternalBugFromExecution:
                openInternalBugReportFromPrompt,
              creatingInternalBugContextId,
            }}
          />
        )}

      {/* AÑADIR PRUEBAS */}
      {activeTab === "crear_pruebas" && (
        <AnadirPruebasPage
          suiteExplorerWidth={suiteExplorerWidth}
          setSelectedSubSuiteId={setSelectedSubSuiteId}
          setTestSearchQuery={setTestSearchQuery}
          setCaseEditorOpen={setCaseEditorOpen}
          setEditingCasoMasterId={setEditingCasoMasterId}
          setSelectedTest={setSelectedTest}
          testSearchQuery={testSearchQuery}
          openCreateSuiteModal={openCreateSuiteModal}
          authoringInitialLoading={authoringInitialLoading}
          visibleSuiteTree={visibleAuthoringSuiteTree}
          authoringRefreshing={authoringRefreshing}
          renderAuthoringSuiteTree={renderAuthoringSuiteTree}
          startSuiteExplorerResize={startSuiteExplorerResize}
          loadCasosFromBackend={loadCasosFromBackend}
          handleCloneCaso={handleCloneCaso}
          handleMoveCaso={handleMoveCaso}
          handleCloneSuite={handleCloneSuite}
          setExpandedSuites={setExpandedSuites}
          authoringCases={visibleAuthoringCases}
          caseArchiveView={caseArchiveView}
          setCaseArchiveView={setCaseArchiveView}
          caseArchiveCounts={{
            active: currentAuthoringCases.length,
            archived: archivedAuthoringCases.length,
            all: allAuthoringCases.length,
          }}
          caseEditorOpen={caseEditorOpen}
          editingCasoMasterId={editingCasoMasterId}
          handleSaveTest={handleSaveTest}
          collapsedSections={collapsedSections}
          setCollapsedSections={setCollapsedSections}
          newTestSuiteSub={newTestSuiteSub}
          newTestSuite={newTestSuite}
          selectSuiteTarget={selectSuiteTarget}
          suitesTree={suitesTree}
          getSuiteDepth={getSuiteDepth}
          newTestTitle={newTestTitle}
          setNewTestTitle={setNewTestTitle}
          newTestComponent={newTestComponent}
          setNewTestComponent={setNewTestComponent}
          componentsList={componentsList}
          currentProjectId={currentProjectId}
          newTestDescription={newTestDescription}
          setNewTestDescription={setNewTestDescription}
          newTestPriority={newTestPriority}
          setNewTestPriority={setNewTestPriority}
          newTestCriticality={newTestCriticality}
          setNewTestCriticality={setNewTestCriticality}
          newTestStatus={newTestStatus}
          setNewTestStatus={setNewTestStatus}
          newTestType={newTestType}
          setNewTestType={setNewTestType}
          newTestPre={newTestPre}
          setNewTestPre={setNewTestPre}
          newTestPost={newTestPost}
          setNewTestPost={setNewTestPost}
          newTestData={newTestData}
          setNewTestData={setNewTestData}
          newTestTags={newTestTags}
          setNewTestTags={setNewTestTags}
          showFeedback={showFeedback}
          newTestSteps={newTestSteps}
          addStepInput={addStepInput}
          handleStepInputChange={handleStepInputChange}
          attachmentConfig={attachmentConfig}
          updateStepAttachments={updateStepAttachments}
          removeStepInput={removeStepInput}
          duplicateStepInput={duplicateStepInput}
          moveStepInput={moveStepInput}
          newTestFramework={newTestFramework}
          setNewTestFramework={setNewTestFramework}
          newTestLanguage={newTestLanguage}
          setNewTestLanguage={setNewTestLanguage}
          confirmAction={confirmAction}
          newTestScript={newTestScript}
          setNewTestScript={setNewTestScript}
          scriptTestResult={scriptTestResult}
          setScriptTesting={setScriptTesting}
          setScriptTestResult={setScriptTestResult}
          fetchWithAuth={fetchWithAuth}
          scriptTesting={scriptTesting}
          onRunSavedAutomatedCase={handleRunSavedAutomatedCaseFromEditor}
          onRunAiDryRunFromEditor={handleRunAiDryRunFromEditor}
          aiDryRunRunning={aiDryRunRunning}
          canSaveCaseEditor={canSaveCaseEditor}
          caseEditorSaving={caseEditorSaving}
          hasUnsavedCaseChanges={hasUnsavedCaseChanges}
          environments={environments}
          setEnvironments={setEnvironments}
          setComponentsList={setComponentsList}
          pendingTraceabilityStoryIds={pendingTraceabilityStoryIds}
          setPendingTraceabilityStoryIds={setPendingTraceabilityStoryIds}
          canAccessCapability={canAccessCapability}
        />
      )}

      {/* PROYECTOS */}
      {activeTab === "proyectos" && (
        <ProyectosRoute
          {...{
            managingProjectId,
            setManagingProjectId,
            projectInnerTab,
            setProjectInnerTab,
            canAccessModule,
            canAccessCapability,
            hasSystemFeature,
            setActiveTab,
            componentActions,
            buildActions,
            environmentActions,
            projectMemberActions,
            wikiActions,
            organizations,
            projectsList,
            currentOrgId,
            currentProjectId,
            componentsList,
            buildsList,
            canEditCurrentProject,
            traceabilityRefreshToken,
            fetchWithAuth,
            showFeedback,
            confirmAction,
            onCreateCaseFromStory: handleCreateCaseFromStory,
            onOpenLinkedCase: handleOpenLinkedCaseFromStory,
          }}
          projectsState={{
            projectsLoading,
            projectsSource,
            projectSyncMessage,
          }}
          projectActions={{ ...projectActions, handleProjectChange }}
          readOnlyBuild={currentBuildIsReadOnly}
          handleProjectChange={handleProjectChange}
          componentState={{
            setComponentForm,
            setShowComponentModal,
            componentSearchQuery,
            setComponentSearchQuery,
            currentCompId,
          }}
          buildState={{ buildCaseIds }}
          sortBuildsNewestFirst={sortBuildsNewestFirst}
          openBuildCasesModal={openBuildCasesModal}
          environmentState={{ environments }}
          projectMemberState={{ projectMembers }}
          wikiState={{
            wikiMode,
            setWikiMode,
            selectedWiki,
            setSelectedWiki,
            wikiFormData,
            setWikiFormData,
            wikiPages,
          }}
        />
      )}


    </>
  )
}
