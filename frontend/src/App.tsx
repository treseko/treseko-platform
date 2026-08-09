import {
  useState,
  useEffect,
  Fragment,
  useRef,
  useMemo,
  type FormEvent,
} from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";
import { BuildCaseSelector } from "./BuildCaseSelector";
import { ScriptEditor } from "./ScriptEditor";
import { EvidenceUpload, type AttachmentMeta } from "./EvidenceUpload";
import { flattenSuites } from "./testRepositoryUtils";
import type {
  ConfirmDialogOptions,
  ConfirmDialogState,
} from "./shared/components/ConfirmDialog";
import { ConfiguracionRoute } from "./app/ConfiguracionRoute";
import { ProyectosRoute } from "./app/ProyectosRoute";
import { AppModals } from "./app/AppModals";
import { EjecutarPruebasRoute } from "./app/EjecutarPruebasRoute";
import { DashboardRoute } from "./app/DashboardRoute";
import { ReportesRoute } from "./app/ReportesRoute";
import { HistorialRoute } from "./app/HistorialRoute";
import { RedminePage } from "./features/redmine/RedminePage";
import { MotorIaPage } from "./features/motor-ia/MotorIaPage";
import { BugTrackerPage } from "./features/bugs/BugTrackerPage";
import { InventarioPage } from "./features/inventario/InventarioPage";
import { useExecutionRunDetail } from "./features/historial/hooks/useExecutionRunDetail";
import { useHistorialController } from "./features/historial/hooks/useHistorialController";
import { createHistoryComparisonData } from "./features/historial/mappers/historialMappers";
import { useAiEngineConfig } from "./features/configuracion/hooks/useAiEngineConfig";
import { useAdminUserRolesConfig } from "./features/configuracion/hooks/useAdminUserRolesConfig";
import { useConfigurationPreload } from "./features/configuracion/hooks/useConfigurationPreload";
import { useGeneralConfiguration } from "./features/configuracion/hooks/useGeneralConfiguration";
import { useSessionConfig } from "./features/configuracion/hooks/useSessionConfig";
import { UpdateMaintenanceOverlay } from "./features/configuracion/components/UpdateMaintenanceOverlay";
import {
  UPDATE_MAINTENANCE_EVENT,
  announceUpdateMaintenance,
  clearUpdateMaintenanceSignal,
  readUpdateMaintenanceSignal,
  updateMaintenanceConnectionState,
  type UpdateMaintenanceState,
} from "./features/configuracion/updateMaintenance";
import {
  defaultAiEngineConfig,
  defaultAttachmentConfig,
  normalizeAiAgentWorkflow,
} from "./features/configuracion/mappers/configuracionMappers";
import { createOrganizationActions } from "./features/configuracion/organizationActions";
import { AutomatizacionPage } from "./features/automatizacion/AutomatizacionPage";
import { humanizePremiumError } from "./features/premium/featureAccess";
import { useReportesMetrics } from "./features/reportes/hooks/useReportesMetrics";
import { LoginPage } from "./features/auth/LoginPage";
import { FirstRunOnboarding } from "./features/onboarding/FirstRunOnboarding";
import { ForcePasswordChangeModal } from "./features/onboarding/ForcePasswordChangeModal";
import { AnadirPruebasPage } from "./features/casos/AnadirPruebasPage";
import { AuthoringSuiteTreeView } from "./features/casos/AuthoringSuiteTreeView";
import { CaseVersionsModal } from "./features/casos/CaseVersionsModal";
import { createCaseActions } from "./features/casos/caseActions";
import { createCaseEditorActions } from "./features/casos/caseEditorActions";
import { createSuiteActions } from "./features/casos/suiteActions";
import { CaseReferenceList } from "./features/ejecutar-pruebas/CaseReferenceList";
import { ExecutionSuiteTreeView } from "./features/ejecutar-pruebas/ExecutionSuiteTreeView";
import { useExecutionPreparation } from "./features/ejecutar-pruebas/hooks/useExecutionPreparation";
import { createExecutionDryRunActions } from "./features/ejecucion/dryRunActions";
import { createEjecucionActionBundle } from "./features/ejecucion/ejecucionActionBundle";
import { createBuildExecutionStatusActions } from "./features/proyectos/buildExecutionStatusActions";
import { createBuildScopeActions } from "./features/proyectos/buildScopeActions";
import { AppShell } from "./layout/AppShell";
import { isBuildReadOnly } from "./app/buildState";
import { useI18n } from "./i18n";
import {
  ALLOW_LOCAL_FALLBACK,
  API_BASE,
  DEV_ADMIN_EMAIL,
  DEV_ADMIN_PASSWORD,
  IS_DEV_ENV,
  MODULE_PERMISSIONS,
  ROLE_ACCESS,
} from "./app/constants";
import {
  DEFAULT_BRANDING,
  normalizeBrandingState,
  type BrandingState,
} from "./app/branding";
import { createContextActions } from "./app/contextActions";
import { allSidebarItems } from "./app/navigationModel";
import { buildProjectViewModel } from "./app/projectViewModel";
import {
  navigationFromCurrentUri,
  readWorkspacePreferences,
  saveWorkspacePreferences,
  uriForWorkspaceState,
} from "./app/workspacePreferences";
import { useLiveRefresh } from "./shared/hooks/useLiveRefresh";
import { useProjectRealtime } from "./shared/realtime/useProjectRealtime";
import type { RealtimeEvent } from "./shared/realtime/realtimeTypes";
import {
  initialAdConfig,
  initialAgents,
  initialAppUsers,
  initialBuilds,
  initialComponents,
  initialCustomInventoryItems,
  initialDevices,
  initialEnvironments,
  initialIaLogs,
  initialInventoryCategories,
  initialOrganizations,
  initialProjects,
  initialRedmineBugs,
  initialRedmineSettings,
  initialRunHistory,
  initialWikiPages,
} from "./app/seedData";
import { isValidUUID } from "./app/validation";
import type {
  AuthMode,
  ModuleId,
  PermissionLevel,
  RoleKey,
  SessionUser,
} from "./app/types";
import {
  buildCaseEditorSnapshot,
  createSessionUser,
  firstUrlFromText,
  mapBackendOrganizationMemberToItem,
  mapBackendOrganizationToItem,
  mapBackendProjectToCard,
  modulesFromPermissions,
  sortBuildsNewestFirst,
} from "./app/mappers";
import {
  canAccessCapability as canAccessCapabilityForUser,
  canAccessModule as canAccessModuleForUser,
} from "./app/rbac/permissions";
import { mapBackendCasoToTest as mapBackendCasoToTestBase } from "./features/casos/caseUtils";
import {
  buildBugDescription,
  getExecutionHistoryStats,
  getStatusColor,
  mapBackendExecutionStatus,
  normalizeExecutionHistory,
} from "./features/ejecucion/executionUtils";
import { isOpenBugState, readInternalReportTokenFromLocation, readStoredAuthentication } from "./app/runtime/appEntryPresentation";
import { WorkspaceAccessEmptyState } from "./app/WorkspaceAccessEmptyState";
import { InternalReportView } from "./app/InternalReportView";
import { AppRouteContent } from "./app/AppRouteContent";
import { AppOverlayStack } from "./app/AppOverlayStack";
import { AppWorkspaceView } from "./app/AppWorkspaceView";
import { createInternalBugWorkflow } from "./app/appInternalBugWorkflow";
import { useAppLiveRuntime } from "./app/useAppLiveRuntime";
import { useAppExecutionActions } from "./app/useAppExecutionActions";
import { useAppConfigurationState } from "./app/useAppConfigurationState";
import { useAppFoundationState } from "./app/useAppFoundationState";
import { useAppMaintenanceState } from "./app/useAppMaintenanceState";
import { useAppNavigationRuntime } from "./app/useAppNavigationRuntime";
import { useCaseArchiveActions } from "./app/useCaseArchiveActions";
import { useAppPresentationRuntime } from "./app/useAppPresentationRuntime";
import { useAppBugRuntime } from "./app/useAppBugRuntime";
import { useStoryCaseActions } from "./app/useStoryCaseActions";
import { useAppActionServices } from "./app/useAppActionServices";
import { useAppAuthRuntime } from "./app/useAppAuthRuntime";
import { usePublicAdConfig } from "./app/usePublicAdConfig";
import { useCaseEditorState } from "./app/useCaseEditorState";
import { useAppSessionState } from "./app/useAppSessionState";
import { useAppRepositoryState } from "./app/useAppRepositoryState";
import { useAppWorkspaceState } from "./app/useAppWorkspaceState";
import { readBackendError, stringifyFeedbackMessage } from "./app/errorMessages";
import { useAppRealtime } from "./app/useAppRealtime";
import { useAppExecutionState } from "./app/useAppExecutionState";
import { attachmentIds, getLatestFailureExecutionContext, isExecutionHistoryItemFromBuild, isFailureStatus, uniqueAttachmentList } from "./app/runtime/bugRuntimeHelpers";
import { buildInternalBugPayload as buildInternalBugPayloadFromContext } from "./app/bugPayloadPayload";

export default function App() {
  const { t, setLocale } = useI18n();
  const translationRef = useRef(t);
  translationRef.current = t;
  const { activeExecutionCaseIds,activeTab,addTestSuccess,aiDryRunInFlightRef,aiDryRunRunning,authMode,automationMonitor,bugTrackerRefreshToken,buildCaseDraftIds,buildCaseIds,buildCaseResultHistoryByBuild,buildCaseSearch,buildCasesLoadingByBuild,buildsList,canSaveCaseEditor,caseArchiveView,caseEditorBaseline,caseEditorOpen,caseEditorSaving,caseVersions,casosFilterCriticidad,casosFilterEstado,casosFilterEtiqueta,casosFilterPrioridad,casosFilterSuite,casosList,casosLoading,casosPage,casosPageSize,casosSearchQuery,casosSearchResults,casosTotal,collapsedSections,componentForm,componentSearchQuery,componentsList,confirmDialog,confirmResolverRef,creatingInternalBugContextId,currentBuildId,currentCaseEditorSnapshot,currentCompId,currentComponentName,currentExecutionCase,currentExecutionRun,currentOrgId,currentProjectId,deepLinkBugId,deepLinkPermissionNoticeRef,editingBuildCasesId,editingCasoMasterId,editingSuiteId,execName,executionBugDetailId,executionDatasetPreview,executionDatasetPreviewLoading,executionLoading,executionModalCaseIds,executionMode,executionSnapshots,expandedSubSuites,expandedSuites,feedbackModal,folderConfig,generalExecutionAttachments,generalExecutionNote,generalExecutionSnapshot,generalExecutionStatus,hasUnsavedCaseChanges,iaSchedulerOpenedFromBuilder,initialBackendLoadKeyRef,internalBugAdditionalContext,internalBugDraft,internalBugEvidence,internalReportError,internalReportHtml,internalReportLoading,internalReportToken,isAuthenticated,lastRelatedCaseIdRef,latestResultsLoadingByBuild,latestResultsRequestRef,loadCasosFromBackendRef,lockedBuildCaseIds,loggedUser,loginError,loginForm,loginLoading,managingProjectId,moveSuiteParentId,movingSuiteId,newTestComponent,newTestCriticality,newTestData,newTestDescription,newTestFramework,newTestLanguage,newTestPost,newTestPre,newTestPriority,newTestScript,newTestStatus,newTestSteps,newTestSuite,newTestSuiteSub,newTestTags,newTestTitle,newTestType,openBugsByCase,openBugsLoading,organizationMemberForm,organizationMembers,organizationMembersLoadKeyRef,organizations,pendingTraceabilityStoryIds,projectInnerTab,projectSyncMessage,projectsList,projectsLoading,projectsSource,redmineDecisionByExecution,relatedBugDecision,relatedBugDecisionResolverRef,relatedCaseBugs,relatedCaseBugsLoading,scheduledTime,schedulerSearch,scriptTestResult,scriptTesting,selectedCompareVersionId,selectedExecutionDatasetId,selectedExecutionEnvironmentId,selectedExecutionTestIds,selectedOrganizationId,selectedSubSuiteId,selectedSuiteId,selectedTest,selectedTestsForIa,selectedWiki,setActiveExecutionCaseIds,setActiveTab,setAddTestSuccess,setAiDryRunRunning,setAuthMode,setAutomationMonitor,setBugTrackerRefreshToken,setBuildCaseDraftIds,setBuildCaseIds,setBuildCaseResultHistoryByBuild,setBuildCaseSearch,setBuildCasesLoadingByBuild,setBuildsList,setCaseArchiveView,setCaseEditorBaseline,setCaseEditorOpen,setCaseEditorSaving,setCaseVersions,setCasosFilterCriticidad,setCasosFilterEstado,setCasosFilterEtiqueta,setCasosFilterPrioridad,setCasosFilterSuite,setCasosList,setCasosLoading,setCasosPage,setCasosSearchQuery,setCasosSearchResults,setCasosTotal,setCollapsedSections,setComponentForm,setComponentSearchQuery,setComponentsList,setConfirmDialog,setCreatingInternalBugContextId,setCurrentBuildId,setCurrentCompId,setCurrentExecutionCase,setCurrentExecutionRun,setCurrentOrgId,setCurrentProjectId,setDeepLinkBugId,setEditingBuildCasesId,setEditingCasoMasterId,setEditingSuiteId,setExecName,setExecutionBugDetailId,setExecutionDatasetPreview,setExecutionDatasetPreviewLoading,setExecutionLoading,setExecutionModalCaseIds,setExecutionMode,setExecutionSnapshots,setExpandedSubSuites,setExpandedSuites,setFeedbackModal,setFolderConfig,setGeneralExecutionAttachments,setGeneralExecutionNote,setGeneralExecutionSnapshot,setGeneralExecutionStatus,setIaSchedulerOpenedFromBuilder,setInternalBugAdditionalContext,setInternalBugDraft,setInternalBugEvidence,setInternalReportError,setInternalReportHtml,setInternalReportLoading,setInternalReportToken,setIsAuthenticated,setLatestResultsLoadingByBuild,setLockedBuildCaseIds,setLoggedUser,setLoginError,setLoginForm,setLoginLoading,setManagingProjectId,setMoveSuiteParentId,setMovingSuiteId,setNewTestComponent,setNewTestCriticality,setNewTestData,setNewTestDescription,setNewTestFramework,setNewTestLanguage,setNewTestPost,setNewTestPre,setNewTestPriority,setNewTestScript,setNewTestStatus,setNewTestSteps,setNewTestSuite,setNewTestSuiteSub,setNewTestTags,setNewTestTitle,setNewTestType,setOpenBugsByCase,setOpenBugsLoading,setOrganizationMemberForm,setOrganizationMembers,setOrganizations,setPendingTraceabilityStoryIds,setProjectInnerTab,setProjectSyncMessage,setProjectsList,setProjectsLoading,setProjectsSource,setRedmineDecisionByExecution,setRelatedBugDecision,setRelatedCaseBugs,setRelatedCaseBugsLoading,setScheduledTime,setSchedulerSearch,setScriptTestResult,setScriptTesting,setSelectedCompareVersionId,setSelectedExecutionDatasetId,setSelectedExecutionEnvironmentId,setSelectedExecutionTestIds,setSelectedOrganizationId,setSelectedSubSuiteId,setSelectedSuiteId,setSelectedTest,setSelectedTestsForIa,setSelectedWiki,setShowAddFolderModal,setShowBuildCasesModal,setShowCasoModal,setShowComponentModal,setShowExecSelector,setShowIaScheduler,setShowMoveSuiteModal,setShowRedmineDrawer,setShowRedminePrompt,setShowSuiteModal,setShowVersionsModal,setSidebarCollapsed,setSnapshotAttachments,setSnapshotNotes,setStepResults,setSuiteExplorerWidth,setSuiteForm,setSuitesLoading,setSuitesTree,setTestSearchQuery,setTraceabilityRefreshToken,setUpdateMaintenanceState,setVersionsCase,setViewMode,setWikiFormData,setWikiMode,setWikiPages,setWorkspacePreferencesHydrated,setZoomImage,showAddFolderModal,showBuildCasesModal,showCasoModal,showComponentModal,showExecSelector,showIaScheduler,showMoveSuiteModal,showRedmineDrawer,showRedminePrompt,showSuiteModal,showVersionsModal,sidebarCollapsed,snapshotAttachments,snapshotNotes,stepResults,suiteExplorerResizeCleanupRef,suiteExplorerWidth,suiteForm,suitesLoading,suitesTree,testSearchQuery,traceabilityRefreshToken,updateMaintenanceState,versionsCase,viewMode,wikiFormData,wikiMode,wikiPages,workspaceNavigationInitializedRef,workspaceNavigationPathRef,workspacePreferencesHydrated,workspacePreferencesHydratedRef,zoomImage } = useAppFoundationState({ t, setLocale });
  const projectVersion = "v2.8.5-STABLE";

  const { loginWithPassword, loginWithAdPassword, authHeaders, fetchWithAuth, persistAccessToken, persistSession, syncSessionFromBackend, canAccessModule, canAccessCapability, systemFeatureIds, systemFeaturesLoaded, systemEdition, firstRunState, setFirstRunState, firstRunLoaded, branding, setBranding, canAccessEntitledModule, hasSystemFeature, loadComponentsForProject, loadBuildsForProject, loadBuildCaseIdsForBuilds, loadBuildCaseIdsForProject } = useAppAuthRuntime({ t, translationRef, loggedUser, isAuthenticated, setLoggedUser, setIsAuthenticated, setLoginError, projectsSource, currentCompId, componentsList, setComponentsList, setBuildsList, setBuildCaseIds, setCurrentCompId, setNewTestComponent, setCurrentBuildId, setProjectSyncMessage, setLoginLoading, setActiveTab });
  useAppMaintenanceState({ options: { fetchWithAuth, updateMaintenanceState, setUpdateMaintenanceState, t } });
  const { handleLoggedUserUpdated, handleLoggedUserPreferencesUpdated, startSuiteExplorerResize, showFeedback, consumeDeepLinkBug, openBugTrackerDetail, closeInternalReportViewer, closeConfirmDialog, confirmAction } = useAppPresentationRuntime({ t, isAuthenticated, internalReportToken, fetchWithAuth, setInternalReportLoading, setInternalReportError, setInternalReportHtml, setLoggedUser, setDeepLinkBugId, canAccessCapability, setActiveTab, setInternalReportToken, activeTab, setFeedbackModal, confirmResolverRef, setConfirmDialog, suiteExplorerResizeCleanupRef, suiteExplorerWidth, setSuiteExplorerWidth });


  const { loadOrganizationsFromBackend, handleCreateOrganization, loadAllOrganizationMembers, handleUpdateOrganization, handleSetOrganizationActive, handleAssignOrganizationMember, handleRemoveOrganizationMember } = createOrganizationActions({ t,projectsSource,organizations,selectedOrganizationId,organizationMemberForm,fetchWithAuth,setOrganizations,setCurrentOrgId,setSelectedOrganizationId,setProjectsList,setCurrentProjectId,setCurrentCompId,setCurrentBuildId,setOrganizationMembers,setOrganizationMemberForm,setProjectSyncMessage,showFeedback,confirmAction });
  // FUNCIONES PARA MANEJAR SUITES
  const { loadSuitesFromBackend, handleCreateSuite, handleUpdateSuite, handleDeleteSuite, handleCloneSuite, handleMoveSuite, handleReorderSuite, openCreateSuiteModal, openEditSuiteModal, openMoveSuiteModal } = createSuiteActions({ t,projectsSource,currentCompId,managingProjectId,currentProjectId,componentsList,suiteForm,editingSuiteId,movingSuiteId,moveSuiteParentId,fetchWithAuth,reloadCasosAfterSuiteClone: (projectId, componentsSnapshot) => loadCasosFromBackendRef.current?.(projectId, componentsSnapshot),setSuitesLoading,setSuitesTree,setProjectSyncMessage,setShowSuiteModal,setSuiteForm,setEditingSuiteId,setShowMoveSuiteModal,setMovingSuiteId,setMoveSuiteParentId,setSelectedSuiteId,setSelectedSubSuiteId,setExpandedSuites,setNewTestSuite,setNewTestSuiteSub,showFeedback,confirmAction,readOnlyBuild: isBuildReadOnly(buildsList.find((item) => item.id === currentBuildId)) });

  const mapBackendCasoToTest = (
    caso: any,
    componentsSnapshot = componentsList,
  ) => mapBackendCasoToTestBase(caso, componentsSnapshot, currentProjectId);

  const { loadCasosFromBackend, searchCasos, handleCreateCaso, handleUpdateCaso, handleDeleteCaso, handleCloneCaso, handleMoveCaso, loadCasoVersions, loadCasoExecutionHistory } = createCaseActions({ t,projectsSource,managingProjectId,currentProjectId,currentBuildId,componentsList,casosPage,casosPageSize,casosSearchQuery,casosFilterSuite,casosFilterPrioridad,casosFilterCriticidad,casosFilterEstado,casosFilterEtiqueta,selectedTest,buildCaseResultHistoryByBuild,fetchWithAuth,mapBackendCasoToTest,setCasosLoading,setCasosList,setCasosSearchResults,setCasosTotal,setShowCasoModal,setProjectSyncMessage,setCaseVersions,setVersionsCase,setSelectedCompareVersionId,setShowVersionsModal,showFeedback,confirmAction,readOnlyBuild: isBuildReadOnly(buildsList.find((item) => item.id === currentBuildId)) });
  const { updateCaseArchiveStatus, updateSuiteArchiveStatus, getCasoVersionRows, getRootSuiteId, getSuiteDepth, selectSuiteTarget, getSubSuites } = useCaseArchiveActions({ t, currentProjectId, currentCompId, currentBuildId, buildsList, componentsList, suitesTree, selectedTest, fetchWithAuth, confirmAction, showFeedback, loadCasosFromBackend, loadSuitesFromBackend, setSelectedTest, setCaseEditorOpen, setEditingCasoMasterId, setSelectedSuiteId, setSelectedSubSuiteId, setNewTestSuite, setNewTestSuiteSub });
  const currentBuildIsReadOnly = isBuildReadOnly(
    buildsList.find((item) => item.id === currentBuildId),
  );

  const { loadBuildCaseExecutionStatus } = createBuildExecutionStatusActions({
    projectsSource,
    latestResultsRequestRef,
    fetchWithAuth,
    setLatestResultsLoadingByBuild,
    setLockedBuildCaseIds,
    setBuildCaseResultHistoryByBuild,
    setCasosList,
    setSelectedTest,
    setProjectSyncMessage,
  });

  const {
    projectMetrics,
    setProjectMetrics,
    metricsLoading,
    expandedMetricSuites,
    setExpandedMetricSuites,
    loadProjectMetrics,
  } = useReportesMetrics({
    activeTab,
    currentProjectId,
    currentBuildId,
    projectsSource,
    fetchWithAuth,
    setProjectSyncMessage,
  });

  const { loadBuildCases, openBuildCasesModal, saveBuildCases, assignPreviousFailedCases } = createBuildScopeActions({ projectsSource,buildsList,buildCaseIds,editingBuildCasesId,buildCaseDraftIds,fetchWithAuth,mapBackendCasoToTest,loadBuildCaseExecutionStatus,setBuildCasesLoadingByBuild,setCasosList,setBuildCaseIds,setEditingBuildCasesId,setBuildCaseDraftIds,setBuildCaseSearch,setShowBuildCasesModal,setProjectSyncMessage,showFeedback,t });

  const { handleOrgChange, handleProjectChange, handleComponentChange, hydrateProjectContext, refreshCurrentTestContext, loadProjectTestContext } = createContextActions({ activeTab,projectsSource,currentProjectId,currentCompId,currentBuildId,projectsList,componentsList,loadComponentsForProject,loadBuildsForProject,loadSuitesFromBackend,loadCasosFromBackend,loadBuildCases,loadBuildCaseExecutionStatus,setCurrentOrgId,setManagingProjectId,setSelectedTest,setSelectedExecutionTestIds,setSelectedTestsForIa,setProjectMetrics,setCurrentProjectId,setCurrentCompId,setCurrentBuildId,setViewMode,setNewTestComponent });

  useEffect(() => {
    // Restore URL/user preferences before the first backend hydration.  Without
    // this gate, the initial empty build id makes the loader choose the active
    // build and overwrite a historical build selected in the URL.
    if (!workspacePreferencesHydrated) return;
    loadProjectTestContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId, projectsSource, workspacePreferencesHydrated]);

  useEffect(() => {
    let cancelled = false;
    if (currentBuildId && isValidUUID(currentBuildId)) {
      loadBuildCases(currentBuildId).then((ids) => {
        if (cancelled) return;
        setSelectedExecutionTestIds((prev) =>
          prev.filter((testId) => ids.includes(testId)),
        );
        loadBuildCaseExecutionStatus(currentBuildId, ids);
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBuildId, projectsSource]);

  useEffect(() => {
    const shouldRefresh =
      activeTab === "crear_pruebas" ||
      activeTab === "ejecutar" ||
      (activeTab === "proyectos" && projectInnerTab === "components");
    if (!shouldRefresh) return;
    refreshCurrentTestContext(currentCompId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTab,
    projectInnerTab,
    currentCompId,
    currentProjectId,
    projectsSource,
  ]);

  useEffect(() => {
    if (
      activeTab !== "proyectos" ||
      !managingProjectId ||
      projectsSource !== "backend"
    )
      return;
    hydrateProjectContext(managingProjectId, currentCompId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, managingProjectId, projectInnerTab, projectsSource]);

  const { configTab,setConfigTab,inventoryCategories,setInventoryCategories,environments,setEnvironments,devices,setDevices,agents,setAgents,customInventoryItems,setCustomInventoryItems,invModalConfig,setInvModalConfig,redmineBugs,setRedmineBugs,runHistory,historialInitialFilters,pendingHistorialRunDetailId,setPendingHistorialRunDetailId,loadProjectRunHistory,loadTestRunDetail,markHistorialAiReviewed,openHistorialRuns,executionRunDetail,executionRunDetailLoading,executionRunDetailError,focusedExecutionId,openExecutionRunDetail,closeExecutionRunDetail,iaStatus,setIaStatus,iaLogs,setIaLogs,iaQueue,setIaQueue,iaExecutionStreams,setIaExecutionStreams,redmineUrl,setRedmineUrl,redmineToken,setRedmineToken,redmineProjKey,setRedmineProjKey,useShaDedup,setUseShaDedup,iaProvider,setIaProvider,iaApiKey,setIaApiKey,iaTemp,setIaTemp,aiEngineConfiguration,aiEngineConfig,loadAiEngineConfig,iaMaxSteps,setIaMaxSteps,generalConfiguration,attachmentConfig,copyToClipboard,loadAttachmentConfig,loadApiKeys,sessionConfiguration,loadSessionConfig,adminUserRolesConfiguration,adConfig,setAdConfig,appUsers,assignableUsers,customRoles,systemRoleItems,showRoleModal,setShowRoleModal,editingRoleId,roleForm,setRoleForm,showUserModal,setShowUserModal,editingUserId,userForm,setUserForm,loadUsersFromBackend,loadRolesFromBackend,handleUserRoleChange,handleUserCustomRoleChange,handleSaveUser,setRoleModulePermission,setRoleCapabilityPermission,handleSaveRole,projectMembers,setProjectMembers,showProjectMemberModal,setShowProjectMemberModal,projectMemberForm,setProjectMemberForm,projectMemberRemoval,setProjectMemberRemoval,historyComparisonData } = useAppConfigurationState({ options: { isAuthenticated, activeTab, projectsSource, loadOrganizationsFromBackend, selectedOrganizationId, organizationMembersLoadKeyRef, loadAllOrganizationMembers, getEnvironmentActions: () => environmentActions, getWikiActions: () => wikiActions, getProjectMemberActions: () => projectMemberActions, currentProjectId, currentBuildId, selectedTest, setSelectedTest, setViewMode, fetchWithAuth, setProjectSyncMessage, showFeedback, loadProjectMetrics, setActiveTab, t, setIsAuthenticated, setLoginError, canAccessCapability, hasSystemFeature, loadCasosFromBackendRef, loadCasosFromBackend, confirmAction } });
  usePublicAdConfig(isAuthenticated, setAdConfig);
  const {
    currentProjectCases,
    allAuthoringCases,
    archivedAuthoringCases,
    currentAuthoringCases,
    canEditCurrentProject,
    currentProjectEnvironments,
    currentProjectDevices,
    currentProjectAgents,
    currentProjectInventoryCategories,
    currentProjectCustomInventoryItems,
    currentProjectRedmineBugs,
    currentProjectRunHistory,
    currentProjectIaQueue,
    belongsToCurrentComponent,
    currentComponentCases,
    visibleSuiteTree,
    allVisibleSuiteTree,
    authoringInitialLoading,
    authoringRefreshing,
    getSubSuiteStats,
    getSuiteStats,
  } = buildProjectViewModel({
    currentProjectId,
    currentCompId,
    managingProjectId,
    loggedUser,
    projectsSource,
    casosList,
    projectMembers,
    environments,
    devices,
    agents,
    inventoryCategories,
    customInventoryItems,
    redmineBugs,
    runHistory,
    iaQueue,
    suitesTree,
    suitesLoading,
    casosLoading,
    canEditProjects: canAccessModule("proyectos", "edit"),
  });
  const visibleAuthoringCases =
    caseArchiveView === "archived"
      ? archivedAuthoringCases
      : caseArchiveView === "all"
        ? allAuthoringCases
        : currentAuthoringCases;
  const visibleAuthoringSuiteTree = useMemo(() => {
    const visibleCaseSuiteIds = new Set(
      visibleAuthoringCases.map((test: any) => test.suiteId).filter(Boolean),
    );
    const filterByArchiveView = (suites: any[]): any[] =>
      suites
        .map((suite) => {
          const children = filterByArchiveView(suite.children || []);
          const isArchived = Boolean(suite.archivado);
          const hasVisibleCases = visibleCaseSuiteIds.has(suite.id);
          if (
            caseArchiveView === "all" ||
            (caseArchiveView === "active" && !isArchived) ||
            (caseArchiveView === "archived" &&
              (isArchived || hasVisibleCases || children.length > 0))
          ) {
            return { ...suite, children };
          }
          return null;
        })
        .filter(Boolean);
    return filterByArchiveView(allVisibleSuiteTree);
  }, [allVisibleSuiteTree, caseArchiveView, visibleAuthoringCases]);

  useEffect(() => {
    if (
      selectedExecutionEnvironmentId &&
      currentProjectEnvironments.some(
        (env) => env.id === selectedExecutionEnvironmentId,
      )
    )
      return;
    const defaultEnvironment =
      currentProjectEnvironments.find(
        (env) => String(env.name || "").toLowerCase() === "qa",
      ) || currentProjectEnvironments[0];
    setSelectedExecutionEnvironmentId(defaultEnvironment?.id || "");
  }, [currentProjectEnvironments, selectedExecutionEnvironmentId]);

  useEffect(() => {
    const selectedEnvironment = currentProjectEnvironments.find(
      (env) => env.id === selectedExecutionEnvironmentId,
    );
    if (!selectedEnvironment) {
      if (selectedExecutionDatasetId) setSelectedExecutionDatasetId("");
      return;
    }
    const datasets = selectedEnvironment.datasets || [];
    if (
      selectedExecutionDatasetId &&
      datasets.some((dataset: any) => dataset.id === selectedExecutionDatasetId)
    )
      return;
    const defaultDataset =
      datasets.find((dataset: any) => dataset.isDefault) || datasets[0];
    setSelectedExecutionDatasetId(defaultDataset?.id || "");
  }, [
    currentProjectEnvironments,
    selectedExecutionEnvironmentId,
    selectedExecutionDatasetId,
  ]);

  useEffect(() => {
    if (suitesLoading || casosLoading) return;
    const visibleSuites = flattenSuites(visibleSuiteTree);
    const selectedSuite = selectedSubSuiteId || selectedSuiteId;
    if (visibleSuites.length === 0) {
      if (selectedSuite) {
        setSelectedSuiteId("");
        setSelectedSubSuiteId(null);
      }
      return;
    }
    if (
      !selectedSuite ||
      !visibleSuites.some((suite) => suite.id === selectedSuite)
    ) {
      selectSuiteTarget(visibleSuites[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentCompId,
    currentProjectId,
    suitesTree,
    casosList,
    suitesLoading,
    casosLoading,
  ]);

  const { activeBuildCaseIds,activeBuildCasesLoading,activeBuildResultsLoaded,activeBuildResultsLoading,activeExecutionTests,allVisibleExecutionTestsSelected,closeExecutionSelector,currentExecutionCaseSource,currentExecutionCases,executionInitialLoading,executionModalDiscardedCount,executionModalTests,executionRefreshing,executionSuiteTree,filteredExecutionTestIds,filteredTests,getExecutionActionLabel,getExecutionCaseLabel,getExecutionStatusKey,getLatestCaseForExecution,getSuiteExecutionMetrics,isOutdatedExecutionCase,openExecutionSelector,openIaSchedulerFromExecutionSelector,openSingleCaseExecutionSelector,selectedExecutionDiscardedCount,selectedExecutionTests,suiteBuildMissingCount,suiteComponentMismatchCount,toggleExecutionSelection,toggleVisibleExecutionSelection,advanceToNextTest,deferRedmineReportAndContinue,getExecutionCompletionPlan,getExecutionReferenceCount,getSnapshotReferences,getSnapshotStatus,handleCompleteCase,handleGeneralExecutionAttachmentUpload,handleRemoveGeneralExecutionAttachment,handleRemoveSnapshotAttachment,handleSelectTestForExecution,handleSnapshotAttachmentUpload,handleSnapshotNoteBlur,handleSnapshotNoteChange,handleSnapshotStatusChange,handleStartExecution,loadExecutionDetails,openRedmineReportFromPrompt,persistExecutionSnapshots,returnToExecutionList } = useAppExecutionActions({ options: { activeExecutionCaseIds,activeTab,aiEngineConfig,attachmentConfig,buildCaseIds,buildCaseResultHistoryByBuild,buildCasesLoadingByBuild,buildsList,casosList,casosLoading,componentsList,currentBuildId,currentCompId,currentExecutionCase,currentExecutionRun,currentProjectCases,currentProjectId,executionModalCaseIds,executionSnapshots,fetchWithAuth,generalExecutionAttachments,generalExecutionNote,generalExecutionSnapshot,generalExecutionStatus,latestResultsLoadingByBuild,loadBuildCaseExecutionStatus,loadBuildCases,loadCasoExecutionHistory,loadCasosFromBackend,managingProjectId,mapBackendCasoToTest,redmineDecisionByExecution,selectSuiteTarget,selectedExecutionDatasetId,selectedExecutionEnvironmentId,selectedExecutionTestIds,selectedSubSuiteId,selectedSuiteId,selectedTest,setActiveExecutionCaseIds,setActiveTab,setAutomationMonitor,setBuildCaseIds,setBuildCaseResultHistoryByBuild,setCasosList,setCurrentExecutionCase,setCurrentExecutionRun,setExecName,setExecutionDatasetPreview,setExecutionDatasetPreviewLoading,setExecutionLoading,setExecutionModalCaseIds,setExecutionMode,setExecutionSnapshots,setGeneralExecutionAttachments,setGeneralExecutionNote,setGeneralExecutionSnapshot,setGeneralExecutionStatus,setIaExecutionStreams,setIaLogs,setIaQueue,setProjectSyncMessage,setRedmineBugs,setRedmineDecisionByExecution,setScheduledTime,setSchedulerSearch,setSelectedExecutionTestIds,setSelectedSubSuiteId,setSelectedSuiteId,setSelectedTest,setSelectedTestsForIa,setShowExecSelector,setShowIaScheduler,setShowRedmineDrawer,setShowRedminePrompt,setSnapshotAttachments,setSnapshotNotes,setStepResults,setViewMode,showExecSelector,showFeedback,snapshotAttachments,snapshotNotes,stepResults,suitesLoading,suitesTree,t,testSearchQuery,viewMode,visibleSuiteTree, canAccessCapability } });
  const bugRuntime = useAppBugRuntime({ loadBuildCaseExecutionStatus, currentBuildId, activeBuildCaseIds, buildCaseIds, setBuildCaseResultHistoryByBuild, currentProjectId, activeTab, setActiveTab, setExecutionBugDetailId, showFeedback, t, fetchWithAuth, authHeaders, API_BASE, loggedUser, selectedTest, currentExecutionCase, currentExecutionRun, generalExecutionStatus, generalExecutionNote, generalExecutionSnapshot, isValidUUID, getLatestFailureExecutionContext, isFailureStatus, buildInternalBugPayloadFromContext, setCreatingInternalBugContextId, setOpenBugsByCase, setOpenBugsLoading, openBugsByCase, relatedCaseBugs, setRelatedCaseBugs, setRelatedCaseBugsLoading, getStatusColor, normalizeExecutionHistory, uniqueAttachmentList, attachmentIds, setSnapshotAttachments, setSnapshotNotes, snapshotNotes, setGeneralExecutionAttachments, setGeneralExecutionNote, setGeneralExecutionStatus, setGeneralExecutionSnapshot, setShowRedminePrompt, setRedmineDecisionByExecution, setInternalBugDraft, setInternalBugAdditionalContext, setInternalBugEvidence, internalBugDraft, internalBugAdditionalContext, internalBugEvidence, canAccessCapability, setBugTrackerRefreshToken, setRelatedBugDecision, relatedBugDecision, setCurrentExecutionCase, setShowRedmineDrawer, setExecutionMode, setAutomationMonitor, aiDryRunInFlightRef, setAiDryRunRunning, setIaLogs, stringifyFeedbackMessage, readBackendError, isOpenBugState, buildsList, projectsList, componentsList, currentCompId, currentProjectEnvironments, selectedExecutionEnvironmentId, executionDatasetPreview, stepResults, executionSnapshots, snapshotAttachments, generalExecutionAttachments, getExecutionCompletionPlan, advanceToNextTest, relatedBugDecisionResolverRef, createExecutionDryRunActions, generateBugDescription: () => generateBugDescription(), loadCasoExecutionHistory, isExecutionHistoryItemFromBuild, setZoomImage });
  const { refreshCurrentBuildExecutionStatus, handleRunSavedAutomatedCaseFromEditor, handleRunAiDryRunFromEditor, getCurrentBuildFailureContext, buildInternalBugPayload, createInternalBugForExecution, findOpenBugForExecutionContext, loadOpenBugsForCase, getActiveExecutionBugEvidence, loadSnapshotBugEvidence, linkExecutionToExistingBug, enrichBugDisplayContext, enrichBugsDisplayContext, closeRelatedBugDecision, requestRelatedBugDecision, viewRelatedBugFromDecision, backToRelatedBugDecisionList, linkBugFromDecision, confirmNewBugWhenCaseHasOpenBugs, handleCreateInternalBugFromExecution, openInternalBugReportFromPrompt, openInternalBugReportFromCase, handleInternalBugDraftChange, openManualInternalBugDrawer, createManualInternalBug, handleSubmitInternalBugReport, handleCreateInternalBugFromCaseHistory, renderCaseReferences } = bugRuntime;
  const generateBugDescription = () =>
    buildBugDescription({
      selectedTest,
      buildName:
        buildsList.find((build) => build.id === currentBuildId)?.name || "N/A",
      executionSnapshots,
      stepResults,
      snapshotNotes,
      generalExecutionStatus,
      generalExecutionNote,
    });

  const { addStepInput, removeStepInput, duplicateStepInput, moveStepInput, handleStepInputChange, updateStepAttachments, openCreateCaseInSuite, openEditCase, handleSaveTest } = createCaseEditorActions({ caseEditorSaving,casosList,componentsList,currentCaseEditorSnapshot,currentCompId,currentProjectId,editingCasoMasterId,fetchWithAuth,handleCreateCaso,handleUpdateCaso,newTestComponent,newTestCriticality,newTestData,newTestDescription,newTestFramework,newTestLanguage,newTestPost,newTestPre,newTestPriority,newTestScript,newTestStatus,newTestSteps,newTestSuite,newTestSuiteSub,newTestTags,newTestTitle,newTestType,pendingTraceabilityStoryIds,projectsSource,selectSuiteTarget,selectedTest,setActiveTab,setAddTestSuccess,setCaseEditorBaseline,setCaseEditorOpen,setCaseEditorSaving,setCasosList,setCurrentCompId,setEditingCasoMasterId,setExpandedSuites,setNewTestComponent,setNewTestCriticality,setNewTestData,setNewTestDescription,setNewTestFramework,setNewTestLanguage,setNewTestPost,setNewTestPre,setNewTestPriority,setNewTestScript,setNewTestStatus,setNewTestSteps,setNewTestSuite,setNewTestSuiteSub,setNewTestTags,setNewTestTitle,setNewTestType,setPendingTraceabilityStoryIds,setProjectSyncMessage,setSelectedTest,showFeedback,suitesTree,t });
  const { handleCreateCaseFromStory, handleOpenLinkedCaseFromStory } = useStoryCaseActions({ setEditingCasoMasterId, setSelectedTest, setNewTestSuite, setNewTestSuiteSub, setNewTestTitle, setNewTestDescription, setNewTestPre, setNewTestPost, setNewTestData, setNewTestTags, setNewTestPriority, setNewTestCriticality, setNewTestStatus, setNewTestType, setNewTestSteps, setNewTestComponent, setNewTestScript, setNewTestFramework, setNewTestLanguage, setPendingTraceabilityStoryIds, setCaseEditorBaseline, setCaseEditorOpen, setActiveTab, setProjectSyncMessage, casosList, currentProjectId, fetchWithAuth, mapBackendCasoToTest, setCasosList, openEditCase, showFeedback, t });
  const { projectActions, componentActions, buildActions, environmentActions, projectMemberActions, wikiActions, handleLaunchIaMission, handleModuleNavigation, openIaSchedulerFromWorkflowBuilder, handleLogin, handleLogout } = useAppActionServices({ canEditCurrentProject, canEditProjectBuilds: canAccessCapability('proyectos.builds', 'edit'), canAccessCapability, canAccessModule, projectsSource, currentOrgId, currentProjectId, managingProjectId, organizations, projectsList, fetchWithAuth, setProjectsLoading, setProjectsList, setCurrentProjectId, setCurrentOrgId, setSelectedOrganizationId, setCurrentCompId, setCurrentBuildId, setProjectsSource, setProjectSyncMessage, showFeedback, componentForm, componentsList, setComponentsList, setNewTestComponent, setShowComponentModal, setComponentForm, currentCompId, currentBuildId, buildsList, setBuildsList, setBuildCaseIds, environments, setEnvironments, projectMemberForm, projectMemberRemoval, assignableUsers, projectMembers, setProjectMemberForm, setShowProjectMemberModal, setProjectMembers, setProjectMemberRemoval, selectedWiki, wikiFormData, wikiPages, setWikiPages, setSelectedWiki, setWikiMode, confirmAction, t, readOnlyBuild: isBuildReadOnly(buildsList.find((item) => item.id === currentBuildId)), currentProjectCases, selectedTestsForIa, execName, scheduledTime, aiMaxParallelRuns: Number(aiEngineConfig.max_parallel_ai_runs || 1), setIaQueue, setIaExecutionStreams, setIaLogs, setShowIaScheduler, setActiveTab, iaSchedulerOpenedFromBuilder, setIaSchedulerOpenedFromBuilder, loadProjectMetrics, loadProjectRunHistory, setViewMode, setCaseEditorOpen, setEditingCasoMasterId, setSelectedTest, belongsToCurrentComponent, setSelectedTestsForIa, setSchedulerSearch, setExecName, setScheduledTime, authMode, loginForm, adConfig, loginWithPassword, loginWithAdPassword, authHeaders, persistSession, setLoginError, setLoginLoading, setOrganizations, setIsAuthenticated });

  const { loadOpenBugsByCase, loadRelatedBugsForSelectedCase, refreshExecutionLiveData, refreshProjectBuildLiveData, refreshReportesLiveData, livePollingFallbackActive } = useAppLiveRuntime({ options: { activeBuildCaseIds, activeTab, bugTrackerRefreshToken, buildCaseIds, canAccessCapability, currentBuildId, currentCompId, currentProjectId, enrichBugDisplayContext, enrichBugsDisplayContext, environmentActions, fetchWithAuth, filteredTests, hasSystemFeature, hasUnsavedCaseChanges, historialInitialFilters, isAuthenticated, isOpenBugState, isValidUUID, lastRelatedCaseIdRef, loadBuildCaseExecutionStatus, loadBuildCases, loadProjectMetrics, loadProjectRunHistory, loggedUser, projectInnerTab, projectsSource, refreshCurrentTestContext, runHistory, selectedTest, setBugTrackerRefreshToken, setOpenBugsByCase, setOpenBugsLoading, setProjectSyncMessage, setRelatedCaseBugs, setRelatedCaseBugsLoading, setTraceabilityRefreshToken, viewMode } });
  const { renderAuthoringSuiteTree, renderExecutionSuiteTree, canRenderActiveModule, showWorkspaceAccessGate, isAdminSession, hasOrganizationAccess } = useAppNavigationRuntime({ isAuthenticated, loggedUser, workspacePreferencesHydrated, setWorkspacePreferencesHydrated, workspacePreferencesHydratedRef, workspaceNavigationInitializedRef, workspaceNavigationPathRef, canAccessModule, setActiveTab, setSidebarCollapsed, setCollapsedSections, setConfigTab, setProjectInnerTab, setManagingProjectId, setCurrentOrgId, setSelectedOrganizationId, setCurrentProjectId, setCurrentCompId, setNewTestComponent, setCurrentBuildId, deepLinkBugId, setDeepLinkBugId, canAccessCapability, deepLinkPermissionNoticeRef, showFeedback, consumeDeepLinkBug, internalReportToken, activeTab, currentOrgId, currentProjectId, currentCompId, currentBuildId, configTab, managingProjectId, projectInnerTab, sidebarCollapsed, collapsedSections, organizations, loadOrganizationsFromBackend, projectActions, projectsSource, syncSessionFromBackend, setIsAuthenticated, initialBackendLoadKeyRef, organizationMembersLoadKeyRef, projectsLoading, projectsList, hydrateProjectContext, canAccessEntitledModule, setViewMode, setCaseEditorOpen, setEditingCasoMasterId, setSelectedTest, expandedSuites, selectedSuiteId, selectedSubSuiteId, selectedTest, visibleAuthoringCases, currentProjectCases, buildCaseIds, testSearchQuery, selectSuiteTarget, setExpandedSuites, openCreateCaseInSuite, openCreateSuiteModal, openEditSuiteModal, openMoveSuiteModal, updateSuiteArchiveStatus, handleDeleteSuite, openEditCase, updateCaseArchiveStatus, loadCasoVersions, handleDeleteCaso, getSuiteExecutionMetrics, handleSelectTestForExecution });
  if (!isAuthenticated) {
    return (
      <LoginPage
        authMode={authMode}
        setAuthMode={setAuthMode}
        showAdLogin={Boolean(adConfig?.enabled)}
        adMode={adConfig?.mode || "oidc"}
        loginForm={loginForm}
        setLoginForm={setLoginForm}
        loginError={loginError}
        loginLoading={loginLoading}
        handleLogin={handleLogin}
        branding={branding}
      />
    );
  }

  if (internalReportToken) {
    return (
      <InternalReportView
        token={internalReportToken}
        html={internalReportHtml}
        loading={internalReportLoading}
        error={internalReportError}
        onClose={closeInternalReportViewer}
        t={t}
      />
    );
  }

  return <AppWorkspaceView options={{ sidebarCollapsed,setSidebarCollapsed,activeBuildResultsLoaded,activeBuildResultsLoading,activeExecutionTests,activeTab,addStepInput,adminUserRolesConfiguration,agents,aiDryRunRunning,aiEngineConfiguration,allAuthoringCases,allVisibleExecutionTestsSelected,appUsers,archivedAuthoringCases,assignPreviousFailedCases,assignableUsers,attachmentConfig,authoringInitialLoading,authoringRefreshing,automationMonitor,backToRelatedBugDecisionList,belongsToCurrentComponent,bugTrackerRefreshToken,buildActions,buildCaseDraftIds,buildCaseIds,buildCaseSearch,buildsList,canAccessCapability,canAccessModule,canEditCurrentProject,canRenderActiveModule,canSaveCaseEditor,caseArchiveView,caseEditorOpen,caseEditorSaving,caseVersions,closeConfirmDialog,closeExecutionRunDetail,closeExecutionSelector,closeRelatedBugDecision,collapsedSections,componentActions,componentForm,componentSearchQuery,componentsList,configTab,confirmAction,confirmDialog,consumeDeepLinkBug,copyToClipboard,creatingInternalBugContextId,currentAuthoringCases,currentBuildId,currentBuildIsReadOnly,currentCompId,currentComponentCases,currentComponentName,currentExecutionCase,currentExecutionRun,currentOrgId,currentProjectAgents,currentProjectCases,currentProjectCustomInventoryItems,currentProjectDevices,currentProjectEnvironments,currentProjectIaQueue,currentProjectId,currentProjectInventoryCategories,currentProjectRedmineBugs,currentProjectRunHistory,customInventoryItems,customRoles,deepLinkBugId,deferRedmineReportAndContinue,devices,duplicateStepInput,editingBuildCasesId,editingCasoMasterId,editingRoleId,editingSuiteId,editingUserId,environmentActions,environments,execName,executionBugDetailId,executionDatasetPreview,executionDatasetPreviewLoading,executionInitialLoading,executionLoading,executionModalDiscardedCount,executionModalTests,executionRefreshing,executionRunDetail,executionRunDetailError,executionRunDetailLoading,executionSnapshots,executionSuiteTree,expandedMetricSuites,feedbackModal,fetchWithAuth,filteredTests,firstRunLoaded,firstRunState,focusedExecutionId,folderConfig,generalConfiguration,generalExecutionAttachments,generalExecutionNote,generalExecutionSnapshot,generalExecutionStatus,generateBugDescription,getCasoVersionRows,getExecutionActionLabel,getExecutionCaseLabel,getExecutionCompletionPlan,getExecutionReferenceCount,getExecutionStatusKey,getSnapshotReferences,getSnapshotStatus,getSuiteDepth,handleAssignOrganizationMember,handleCloneCaso,handleCloneSuite,handleCompleteCase,handleComponentChange,handleCreateCaseFromStory,handleCreateInternalBugFromCaseHistory,handleCreateInternalBugFromExecution,handleCreateOrganization,handleCreateSuite,handleGeneralExecutionAttachmentUpload,handleInternalBugDraftChange,handleLaunchIaMission,handleLoggedUserPreferencesUpdated,handleLoggedUserUpdated,handleLogout,handleModuleNavigation,handleMoveCaso,handleMoveSuite,handleOpenLinkedCaseFromStory,handleOrgChange,handleProjectChange,handleRemoveGeneralExecutionAttachment,handleRemoveOrganizationMember,handleRemoveSnapshotAttachment,handleRunAiDryRunFromEditor,handleRunSavedAutomatedCaseFromEditor,handleSaveRole,handleSaveTest,handleSaveUser,handleSelectTestForExecution,handleSetOrganizationActive,handleSnapshotAttachmentUpload,handleSnapshotNoteBlur,handleSnapshotNoteChange,handleSnapshotStatusChange,handleStartExecution,handleStepInputChange,handleSubmitInternalBugReport,handleUpdateOrganization,handleUpdateSuite,handleUserCustomRoleChange,handleUserRoleChange,hasOrganizationAccess,hasSystemFeature,hasUnsavedCaseChanges,historialInitialFilters,iaExecutionStreams,iaLogs,iaProvider,iaStatus,internalBugAdditionalContext,internalBugDraft,internalBugEvidence,invModalConfig,inventoryCategories,isOutdatedExecutionCase,linkBugFromDecision,linkExecutionToExistingBug,loadCasosFromBackend,loadOrganizationsFromBackend,loadProjectMetrics,loadProjectRunHistory,loadRelatedBugsForSelectedCase,loadTestRunDetail,lockedBuildCaseIds,loggedUser,managingProjectId,markHistorialAiReviewed,metricsLoading,moveStepInput,moveSuiteParentId,movingSuiteId,newTestComponent,newTestCriticality,newTestData,newTestDescription,newTestFramework,newTestLanguage,newTestPost,newTestPre,newTestPriority,newTestScript,newTestStatus,newTestSteps,newTestSuite,newTestSuiteSub,newTestTags,newTestTitle,newTestType,openBugsByCase,openBugsLoading,openBuildCasesModal,openCreateSuiteModal,openExecutionRunDetail,openExecutionSelector,openHistorialRuns,openIaSchedulerFromExecutionSelector,openIaSchedulerFromWorkflowBuilder,openInternalBugReportFromPrompt,openManualInternalBugDrawer,openRedmineReportFromPrompt,openSingleCaseExecutionSelector,organizationMemberForm,organizationMembers,organizations,pendingHistorialRunDetailId,pendingTraceabilityStoryIds,persistAccessToken,projectActions,projectInnerTab,projectMemberActions,projectMemberForm,projectMemberRemoval,projectMembers,projectMetrics,projectSyncMessage,projectVersion,projectsList,projectsLoading,projectsSource,redmineUrl,refreshCurrentBuildExecutionStatus,relatedBugDecision,relatedCaseBugs,relatedCaseBugsLoading,removeStepInput,renderAuthoringSuiteTree,renderCaseReferences,renderExecutionSuiteTree,returnToExecutionList,roleForm,saveBuildCases,scheduledTime,schedulerSearch,scriptTestResult,scriptTesting,selectSuiteTarget,selectedCompareVersionId,selectedExecutionDatasetId,selectedExecutionEnvironmentId,selectedExecutionTestIds,selectedExecutionTests,selectedOrganizationId,selectedSuiteId,selectedTest,selectedTestsForIa,selectedWiki,sessionConfiguration,setActiveTab,setAgents,setAutomationMonitor,setBranding,setBugTrackerRefreshToken,setBuildCaseDraftIds,setBuildCaseSearch,setCaseArchiveView,setCaseEditorOpen,setCollapsedSections,setComponentForm,setComponentSearchQuery,setComponentsList,setConfigTab,setCurrentBuildId,setCustomInventoryItems,setDevices,setEditingCasoMasterId,setEditingSuiteId,setEnvironments,setExecName,setExecutionBugDetailId,setExpandedMetricSuites,setExpandedSuites,setFeedbackModal,setFirstRunState,setGeneralExecutionNote,setGeneralExecutionStatus,setIaExecutionStreams,setIaLogs,setIaQueue,setIaSchedulerOpenedFromBuilder,setInternalBugAdditionalContext,setInternalBugDraft,setInternalBugEvidence,setInvModalConfig,setInventoryCategories,setManagingProjectId,setMoveSuiteParentId,setMovingSuiteId,setNewTestComponent,setNewTestCriticality,setNewTestData,setNewTestDescription,setNewTestFramework,setNewTestLanguage,setNewTestPost,setNewTestPre,setNewTestPriority,setNewTestScript,setNewTestStatus,setNewTestTags,setNewTestTitle,setNewTestType,setOrganizationMemberForm,setPendingHistorialRunDetailId,setPendingTraceabilityStoryIds,setProjectInnerTab,setProjectMemberForm,setProjectMemberRemoval,setRoleCapabilityPermission,setRoleForm,setRoleModulePermission,setScheduledTime,setSchedulerSearch,setScriptTestResult,setScriptTesting,setSelectedCompareVersionId,setSelectedExecutionDatasetId,setSelectedExecutionEnvironmentId,setSelectedExecutionTestIds,setSelectedOrganizationId,setSelectedSubSuiteId,setSelectedTest,setSelectedTestsForIa,setSelectedWiki,setShowAddFolderModal,setShowBuildCasesModal,setShowComponentModal,setShowIaScheduler,setShowMoveSuiteModal,setShowProjectMemberModal,setShowRedmineDrawer,setShowRedminePrompt,setShowRoleModal,setShowSuiteModal,setShowUserModal,setShowVersionsModal,setSuiteForm,setTestSearchQuery,setUserForm,setWikiFormData,setWikiMode,setZoomImage,showAddFolderModal,showBuildCasesModal,showComponentModal,showExecSelector,showFeedback,showIaScheduler,showMoveSuiteModal,showProjectMemberModal,showRedmineDrawer,showRedminePrompt,showRoleModal,showSuiteModal,showUserModal,showVersionsModal,showWorkspaceAccessGate,snapshotAttachments,snapshotNotes,startSuiteExplorerResize,suiteExplorerWidth,suiteForm,suitesTree,systemEdition,testSearchQuery,toggleExecutionSelection,toggleVisibleExecutionSelection,traceabilityRefreshToken,updateMaintenanceState,updateStepAttachments,userForm,versionsCase,viewMode,viewRelatedBugFromDecision,visibleAuthoringCases,visibleAuthoringSuiteTree,visibleSuiteTree,wikiActions,wikiFormData,wikiMode,wikiPages,zoomImage }} />;
}
