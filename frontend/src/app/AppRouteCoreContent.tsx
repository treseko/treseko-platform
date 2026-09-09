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
import { API_BASE } from './constants'

export function AppRouteCoreContent({ options }: { options: any }) {
  const {
    activeBuildResultsLoaded, activeBuildResultsLoading, activeExecutionTests, activeTab, addStepInput, adminUserRolesConfiguration, agents, aiDryRunRunning,
    aiEngineConfiguration, allAuthoringCases, allVisibleExecutionTestsSelected, appUsers, archivedAuthoringCases, attachmentConfig, authoringInitialLoading, authoringRefreshing,
    bugTrackerRefreshToken, buildActions, buildCaseIds, buildsList, canAccessCapability, canAccessModule, canEditCurrentProject, canSaveCaseEditor,
    caseArchiveView, caseEditorOpen, caseEditorSaving, closeExecutionRunDetail, collapsedSections, componentActions, componentSearchQuery, componentsList,
    configTab, confirmAction, consumeDeepLinkBug, copyToClipboard, creatingInternalBugContextId, currentAuthoringCases, currentBuildId, currentBuildIsReadOnly,
    currentCompId, currentComponentCases, currentComponentName, currentExecutionCase, currentExecutionRun, currentOrgId, currentProjectAgents, currentProjectCases,
    currentProjectCustomInventoryItems, currentProjectDevices, currentProjectEnvironments, currentProjectIaQueue, currentProjectId, currentProjectInventoryCategories, currentProjectRedmineBugs, currentProjectRunHistory,
    customInventoryItems, deepLinkBugId, bugTrackerInitialFilters, devices, duplicateStepInput, editingCasoMasterId, environmentActions, environments, executionDatasetPreview, executionBugDetailId,
    executionInitialLoading, executionRefreshing, executionRunDetail, executionRunDetailError, executionRunDetailLoading, executionSnapshots, executionSuiteTree, expandedMetricSuites,
    fetchWithAuth, filteredTests, findOpenBugForExecutionContext, focusedExecutionId, generalConfiguration, generalExecutionAttachments, generalExecutionNote, generalExecutionSnapshot, generalExecutionStatus, internalBugDraft,
    getExecutionActionLabel, getExecutionCompletionPlan, getExecutionReferenceCount, getExecutionStatusKey, getSnapshotReferences, getSnapshotStatus, getSuiteDepth, handleAssignOrganizationMember,
    handleCloneCaso, handleCloneSuite, handleCompleteCase, handleCreateCaseFromStory, handleCreateInternalBugFromCaseHistory, handleCreateOrganization, handleGeneralExecutionAttachmentUpload, handleLoggedUserPreferencesUpdated, handleStartExecution,
    handleLoggedUserUpdated, handleMoveCaso, handleOpenLinkedCaseFromStory, handleProjectChange, handleComponentChange, handleRemoveGeneralExecutionAttachment, handleRemoveOrganizationMember, handleRemoveSnapshotAttachment, handleRunAiDryRunFromEditor,
    handleRunSavedAutomatedCaseFromEditor, handleSaveTest, handleSelectTestForExecution, handleSetOrganizationActive, handleSnapshotAttachmentUpload, handleSnapshotNoteBlur, handleSnapshotNoteChange, handleSnapshotStatusChange,
    handleStepInputChange, handleUpdateOrganization, hasSystemFeature, hasUnsavedCaseChanges, historialInitialFilters, iaExecutionStreams, iaLogs, iaStatus,
    inventoryCategories, isOutdatedExecutionCase, linkExecutionToExistingBug, loadCasosFromBackend, loadOrganizationsFromBackend, loadProjectMetrics, loadProjectRunHistory, loadRelatedBugsForSelectedCase,
    loadCasoExecutionHistory, loadTestRunDetail, loggedUser, managingProjectId, markHistorialAiReviewed, metricsLoading, moveStepInput, newTestApiConfig, newTestChatbotConfig, newTestComponent, newTestCriticality,
    newTestData, newTestDescription, newTestFormat, newTestFramework, newTestLanguage, newTestPost, newTestPre, newTestPriority, newTestScript,
    newTestStatus, newTestSteps, newTestSuite, newTestSuiteSub, newTestTags, newTestTitle, newTestType, openBugsByCase,
    openBugsLoading, openBuildCasesModal, openCreateSuiteModal, openExecutionRunDetail, openExecutionSelector, openHistorialRuns, openIaSchedulerFromWorkflowBuilder, openInternalBugReportFromPrompt,
    openManualInternalBugDrawer, openSingleCaseExecutionSelector, organizationMemberForm, organizationMembers, organizations, pendingHistorialRunDetailId, pendingTraceabilityStoryIds, projectActions,
    projectInnerTab, projectMemberActions, projectMembers, projectMetrics, projectSyncMessage, projectVersion, projectsList, projectsLoading,
    projectsSource, redmineUrl, relatedCaseBugs, relatedCaseBugsLoading, removeStepInput, renderAuthoringSuiteTree, renderCaseReferences, renderExecutionSuiteTree,
    requestRelatedBugDecision, returnToExecutionList, scriptTestResult, scriptTesting, selectSuiteTarget, selectedExecutionTestIds, selectedExecutionTests, selectedOrganizationId, selectedSuiteId, syncExecutionCaseStatus,
    selectedTest, selectedWiki, sessionConfiguration, setActiveTab, setAgents, setBranding, setBugTrackerRefreshToken, setCaseArchiveView,
    setCaseEditorOpen, setCollapsedSections, setComponentForm, setComponentSearchQuery, setComponentsList, setConfigTab, setCustomInventoryItems, setDevices, setBugTrackerInitialFilters,
    setEditingCasoMasterId, setEnvironments, setExecutionBugDetailId, setCurrentExecutionCase, setExpandedMetricSuites, setExpandedSuites, setGeneralExecutionNote, setGeneralExecutionStatus, setIaExecutionStreams, setNewTestApiConfig, setNewTestChatbotConfig,
    setIaLogs, setIaQueue, setInvModalConfig, setInventoryCategories, setManagingProjectId, setNewTestComponent, setNewTestCriticality, setNewTestData, setShowRedmineDrawer,
    setNewTestDescription, setNewTestFormat, setNewTestFramework, setNewTestLanguage, setNewTestPost, setNewTestPre, setNewTestPriority, setNewTestScript, setNewTestStatus,
    setNewTestTags, setNewTestTitle, setNewTestType, setOrganizationMemberForm, setPendingHistorialRunDetailId, setPendingTraceabilityStoryIds, setProjectInnerTab, setScriptTestResult,
    setScriptTesting, setSelectedExecutionTestIds, setSelectedOrganizationId, setSelectedSubSuiteId, setSelectedTest, setSelectedWiki, setShowComponentModal, setTestSearchQuery,
    setWikiFormData, setWikiMode, setViewMode, setZoomImage, showFeedback, snapshotAttachments, snapshotNotes, startSuiteExplorerResize, suiteExplorerWidth,
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
            loadCasoExecutionHistory,
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
            onOpenBugTracker: (bug: any, options?: { buildId?: string; scope?: 'reported' | 'historical' }) => {
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
              setBugTrackerInitialFilters(options?.buildId ? { build_id: options.buildId, build_scope: options.scope || 'reported' } : {});
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
              setCurrentExecutionCase,
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

      {activeTab === "ejecutar" && viewMode === "api_exec" && (
        <EjecutarPruebasRoute
          {...{
            activeTab,
            viewMode,
            selectedTest,
            currentExecutionRun,
            apiExecutionResults: currentExecutionRun?.apiExecutionResults || currentExecutionRun,
            executionDatasetPreview,
            currentProjectEnvironments,
            returnToExecutionList,
            openSingleCaseExecutionSelector,
            handleStartExecution,
            relatedCaseBugs,
            relatedCaseBugsLoading,
            onLoadRelatedBugs: (caseId: string) => loadRelatedBugsForSelectedCase(caseId, { silent: true }),
            onPrepareApiBug: async (test: any, result: any) => {
              setSelectedTest(test)
              setCurrentExecutionCase({
                id: result?.execution_id || null,
                caso_id: test?.id || null,
                estado_resultado: result?.status || result?.result?.status || 'FALLO',
                api_resultado: result?.result || {},
              })
              return openInternalBugReportFromPrompt({
                apiExecutionId: result?.execution_id || null,
                apiTest: test,
                apiExecutionResult: result,
                skipRelatedBugDecision: result?.skip_related_bug_decision === true,
                forceNewBug: result?.force_new_bug === true,
              })
            },
            onSaveApiEvaluation: async (result: any, status: string, notes: string) => {
              const response = await fetchWithAuth(`${API_BASE}/api-tests/executions/${result?.execution_id}/manual-evaluation`, {
                method: 'POST',
                body: JSON.stringify({ status, notes: notes || null }),
              })
              const payload = await response.json().catch(() => ({}))
              if (!response.ok) throw new Error(payload?.detail?.message || payload?.detail || payload?.message || `No se pudo guardar el veredicto (${response.status})`)
              showFeedback('Veredicto guardado', 'La evaluación manual de la prueba API quedó registrada.', 'success')
              return payload
            },
            onApiVerdictSaved: async (result: any, status: string, notes: string, test: any) => {
              if (!['FALLO', 'BLOQUEADO'].includes(String(status || '').toUpperCase())) return
              const executionId = result?.execution_id || null
              setSelectedTest(test)
              setCurrentExecutionCase({
                id: executionId,
                caso_id: test?.id || null,
                estado_resultado: status,
                api_resultado: result?.result || {},
              })
              const bugs = await loadRelatedBugsForSelectedCase(test?.id, { silent: true })
              return { relatedBugs: Array.isArray(bugs) ? bugs : [] }
            },
            onAdvanceApiCase: async (caseId: string, tests: any[]) => {
              const apiResults = currentExecutionRun?.apiExecutionResults || currentExecutionRun || {}
              const executionByCase = new Map((apiResults.executions || []).map((item: any) => [String(item.case_id), item]))
              const currentIndex = tests.findIndex((test: any) => String(test?.id) === String(caseId))
              const next = tests.slice(Math.max(currentIndex + 1, 0)).find((test: any) => {
                const item = executionByCase.get(String(test?.id)) as any
                return !item?.manual_evaluation?.status && !item?.result?.manual_evaluation?.status
              }) || null
              if (next) {
                setSelectedTest(next)
                showFeedback('Caso aprobado', 'La respuesta cumple el veredicto. Continuás con la siguiente prueba API.', 'success')
              } else {
                returnToExecutionList()
                showFeedback('Lote API completo', 'No quedan más pruebas API seleccionadas para evaluar.', 'success')
              }
              return next || null
            },
            onDeferApiCase: async (caseId: string, tests: any[]) => {
              const currentIndex = tests.findIndex((test: any) => String(test?.id) === String(caseId))
              const next = tests.slice(Math.max(currentIndex + 1, 0)).find((test: any) => String(test?.id) !== String(caseId)) || null
              if (next) {
                setSelectedTest(next)
                showFeedback('Caso guardado', 'El caso quedó registrado y podés continuar con la siguiente prueba API.', 'info')
              } else {
                returnToExecutionList()
                showFeedback('Lote API completo', 'No quedan más pruebas API seleccionadas.', 'success')
              }
              return next
            },
            onLinkApiExecutionToBug: async (bug: any, test: any, result: any) => {
              setSelectedTest(test)
              return linkExecutionToExistingBug(bug, 'La falla API continúa en esta ejecución.', undefined, {
                executionId: result?.execution_id || null,
                test,
                api: true,
              })
            },
            onViewRelatedBug: (bug: any) => setExecutionBugDetailId(String(bug?.id || '')),
            canAccessCapability,
            showFeedback,
          }}
        />
      )}

      {/* CONSOLA MANUAL CHATBOT */}
      {activeTab === "ejecutar" &&
        viewMode === "chatbot_manual" &&
        selectedTest && (
          <EjecutarPruebasRoute
            {...{
              activeTab,
              viewMode,
              currentProjectId,
              selectedTest,
              activeExecutionTests,
              relatedCaseBugs,
              relatedCaseBugsLoading,
              currentExecutionRun,
              currentExecutionCase,
              currentProjectEnvironments,
              currentComponentName,
              onRefreshRelatedBugs: () =>
                loadRelatedBugsForSelectedCase(selectedTest.id, { silent: true }),
              onLinkExecutionToBug: linkExecutionToExistingBug,
              onViewRelatedBug: (bug: any) => setExecutionBugDetailId(String(bug?.id || "")),
              findOpenBugForExecutionContext,
              requestRelatedBugDecision,
              openConversationalBugReport: openInternalBugReportFromPrompt,
              reopenConversationalBugReport: () => setShowRedmineDrawer(true),
              internalBugDraft,
              syncExecutionCaseStatus,
              selectedExecutionEnvironmentId: options.selectedExecutionEnvironmentId,
              selectedExecutionDatasetId: options.selectedExecutionDatasetId,
              fetchWithAuth,
              showFeedback,
              returnToExecutionList,
              handleSelectTestForExecution,
            }}
          />
        )}

      {/* AÑADIR PRUEBAS */}
      {activeTab === "crear_pruebas" && (
        <AnadirPruebasPage
          buildsList={buildsList}
          selectedTest={selectedTest}
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
          allAuthoringCases={allAuthoringCases}
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
          newTestFormat={newTestFormat}
          setNewTestFormat={setNewTestFormat}
          newTestChatbotConfig={newTestChatbotConfig}
          setNewTestChatbotConfig={setNewTestChatbotConfig}
          newTestApiConfig={newTestApiConfig}
          setNewTestApiConfig={setNewTestApiConfig}
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
          onRunChatbotCase={openSingleCaseExecutionSelector}
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
            loadCasosFromBackend,
            loadSuitesFromBackend: options.loadSuitesFromBackend,
          }}
          projectsState={{
            projectsLoading,
            projectsSource,
            projectSyncMessage,
          }}
          projectActions={{ ...projectActions, handleProjectChange }}
          readOnlyBuild={currentBuildIsReadOnly}
          handleProjectChange={handleProjectChange}
          handleComponentChange={handleComponentChange}
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
