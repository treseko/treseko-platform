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

export function AppRouteModuleContent({ options }: { options: any }) {
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
      {/* INVENTARIO */}
      {activeTab === "inventario" && (
        <InventarioPage
          currentProjectId={currentProjectId}
          inventoryCategories={inventoryCategories}
          setInventoryCategories={setInventoryCategories}
          environments={environments}
          setEnvironments={setEnvironments}
          devices={devices}
          setDevices={setDevices}
          agents={agents}
          setAgents={setAgents}
          customInventoryItems={customInventoryItems}
          setCustomInventoryItems={setCustomInventoryItems}
          confirmAction={confirmAction}
          currentProjectInventoryCategories={
            currentProjectInventoryCategories
          }
          currentProjectEnvironments={currentProjectEnvironments}
          currentProjectDevices={currentProjectDevices}
          currentProjectCustomInventoryItems={
            currentProjectCustomInventoryItems
          }
          currentProjectAgents={currentProjectAgents}
          setInvModalConfig={setInvModalConfig}
          canAccessCapability={canAccessCapability}
          fetchWithAuth={fetchWithAuth}
        />
      )}

      {/* REPORTES Y METRICAS */}
      <ReportesRoute
        {...{
          activeTab,
          metricsLoading,
          projectMetrics,
          expandedMetricSuites,
          setExpandedMetricSuites,
          loadProjectMetrics,
          showFeedback,
          fetchWithAuth,
          currentProjectId,
          currentBuildId,
          openHistorialRuns,
          setZoomImage,
          canAccessCapability,
          hasSystemFeature,
          loggedUser,
          onPreferencesUpdated: handleLoggedUserPreferencesUpdated,
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

      {/* BUG TRACKER */}
      {activeTab === "bugs" && (
        <BugTrackerPage
          currentProjectId={currentProjectId}
          currentBuildId={currentBuildId}
          currentCompId={currentCompId}
          buildsList={buildsList}
          componentsList={componentsList}
          appUsers={appUsers}
          fetchWithAuth={fetchWithAuth}
          showFeedback={showFeedback}
          canAccessCapability={canAccessCapability}
          onOpenManualBugDrawer={openManualInternalBugDrawer}
          refreshToken={bugTrackerRefreshToken}
          onBugsChanged={() =>
            setBugTrackerRefreshToken((value) => value + 1)
          }
          deepLinkBugId={deepLinkBugId}
          onDeepLinkConsumed={consumeDeepLinkBug}
        />
      )}
      {executionBugDetailId && (
        <BugTrackerPage
          currentProjectId={currentProjectId}
          currentBuildId={currentBuildId}
          currentCompId={currentCompId}
          buildsList={buildsList}
          componentsList={componentsList}
          appUsers={appUsers}
          fetchWithAuth={fetchWithAuth}
          showFeedback={showFeedback}
          canAccessCapability={canAccessCapability}
          deepLinkBugId={executionBugDetailId}
          modalOnly
          onDetailClosed={() => setExecutionBugDetailId("")}
        />
      )}

      {/* MOTOR IA */}
      {activeTab === "motor_ia" && (
        <MotorIaPage
          currentProjectId={currentProjectId}
          iaStatus={iaStatus}
          iaLogs={iaLogs}
          setIaLogs={setIaLogs}
          currentProjectIaQueue={currentProjectIaQueue}
          iaExecutionStreams={iaExecutionStreams}
          setIaExecutionStreams={setIaExecutionStreams}
          setIaQueue={setIaQueue}
          currentProjectCases={currentProjectCases}
          fetchWithAuth={fetchWithAuth}
          showFeedback={showFeedback}
          setActiveTab={setActiveTab}
          setConfigTab={setConfigTab}
          canAccessCapability={canAccessCapability}
          hasSystemFeature={hasSystemFeature}
        />
      )}

      {/* INTEGRACION REDMINE */}
      {activeTab === "redmine" && (
        <RedminePage
          currentProjectRedmineBugs={currentProjectRedmineBugs}
          currentProjectCases={currentProjectCases}
          redmineUrl={redmineUrl}
          fetchWithAuth={fetchWithAuth}
          showFeedback={showFeedback}
          canAccessCapability={canAccessCapability}
          hasSystemFeature={hasSystemFeature}
          setActiveTab={setActiveTab}
          setConfigTab={setConfigTab}
        />
      )}

      {/* HISTORIAL RUNS */}
      <HistorialRoute
        {...{
          activeTab,
          currentProjectId,
          currentProjectRunHistory,
          getStatusColor,
          buildsList,
          componentsList,
          currentProjectEnvironments,
          appUsers,
          historialInitialFilters,
          pendingHistorialRunDetailId,
          setPendingHistorialRunDetailId,
          loadProjectRunHistory,
          loadTestRunDetail,
          markHistorialAiReviewed,
          setZoomImage,
          canAccessCapability,
          fetchWithAuth,
          showFeedback,
          setActiveTab,
        }}
      />

      {/* AUTOMATIZACION */}
      {activeTab === "automatizacion" && (
        <AutomatizacionPage
          currentProjectId={currentProjectId}
          currentOrgId={currentOrgId}
          currentCompId={currentCompId}
          currentBuildId={currentBuildId}
          organizations={organizations}
          projectsList={projectsList}
          componentsList={componentsList}
          buildsList={buildsList}
          buildCaseIds={buildCaseIds}
          currentProjectCases={currentProjectCases}
          currentComponentCases={currentComponentCases}
          projectsSource={projectsSource}
          fetchWithAuth={fetchWithAuth}
          showFeedback={showFeedback}
          copyToClipboard={copyToClipboard}
          confirmAction={confirmAction}
          canAccessModule={canAccessModule}
          canAccessCapability={canAccessCapability}
          hasSystemFeature={hasSystemFeature}
        />
      )}

      {/* CONFIGURACION */}
      {activeTab === "configuracion" && (
        <ConfiguracionRoute
          configTab={configTab}
          setConfigTab={setConfigTab}
          canAccessModule={canAccessModule}
          canAccessCapability={canAccessCapability}
          hasSystemFeature={hasSystemFeature}
          showFeedback={showFeedback}
          generalConfiguration={generalConfiguration}
          sessionConfiguration={sessionConfiguration}
          aiEngineConfiguration={aiEngineConfiguration}
          adminUserRolesConfiguration={adminUserRolesConfiguration}
          organizations={organizations}
          projectsList={projectsList}
          selectedOrganizationId={selectedOrganizationId}
          setSelectedOrganizationId={setSelectedOrganizationId}
          handleCreateOrganization={handleCreateOrganization}
          handleUpdateOrganization={handleUpdateOrganization}
          handleSetOrganizationActive={handleSetOrganizationActive}
          loadOrganizationsFromBackend={loadOrganizationsFromBackend}
          organizationMembers={organizationMembers}
          organizationMemberForm={organizationMemberForm}
          setOrganizationMemberForm={setOrganizationMemberForm}
          handleAssignOrganizationMember={handleAssignOrganizationMember}
          handleRemoveOrganizationMember={handleRemoveOrganizationMember}
          loggedUser={loggedUser}
          fetchWithAuth={fetchWithAuth}
          onLoggedUserUpdated={handleLoggedUserUpdated}
          onPreferencesUpdated={handleLoggedUserPreferencesUpdated}
          onBrandingUpdated={(nextBranding) =>
            setBranding(normalizeBrandingState(nextBranding))
          }
          setActiveTab={setActiveTab}
          onOpenIaScheduler={openIaSchedulerFromWorkflowBuilder}
        />
      )}

    </>
  )
}
