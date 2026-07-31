import { createInitialLoadActions } from "./initialLoadActions";
import { createSuiteTreeRenderers } from "./AppSuiteTreeRenderers";
import { useAppAccessNavigation } from "./useAppAccessNavigation";
import { useAppSessionBootstrap } from "./useAppSessionBootstrap";
import { useWorkspaceNavigation } from "./useWorkspaceNavigation";

export function useAppNavigationRuntime(options: any): any {
  const {
    isAuthenticated,
    loggedUser,
    workspacePreferencesHydrated,
    setWorkspacePreferencesHydrated,
    workspacePreferencesHydratedRef,
    workspaceNavigationInitializedRef,
    workspaceNavigationPathRef,
    canAccessModule,
    setActiveTab,
    setSidebarCollapsed,
    setCollapsedSections,
    setConfigTab,
    setProjectInnerTab,
    setManagingProjectId,
    setCurrentOrgId,
    setSelectedOrganizationId,
    setCurrentProjectId,
    setCurrentCompId,
    setNewTestComponent,
    setCurrentBuildId,
    deepLinkBugId,
    setDeepLinkBugId,
    canAccessCapability,
    deepLinkPermissionNoticeRef,
    showFeedback,
    consumeDeepLinkBug,
    internalReportToken,
    activeTab,
    currentOrgId,
    currentProjectId,
    currentCompId,
    currentBuildId,
    configTab,
    managingProjectId,
    projectInnerTab,
    sidebarCollapsed,
    collapsedSections,
    organizations,
    loadOrganizationsFromBackend,
    projectActions,
    projectsSource,
    syncSessionFromBackend,
    setIsAuthenticated,
    initialBackendLoadKeyRef,
    organizationMembersLoadKeyRef,
    projectsLoading,
    projectsList,
    hydrateProjectContext,
    canAccessEntitledModule,
    setViewMode,
    setCaseEditorOpen,
    setEditingCasoMasterId,
    setSelectedTest,
    expandedSuites,
    selectedSuiteId,
    selectedSubSuiteId,
    selectedTest,
    visibleAuthoringCases,
    currentProjectCases,
    buildCaseIds,
    testSearchQuery,
    selectSuiteTarget,
    setExpandedSuites,
    openCreateCaseInSuite,
    openCreateSuiteModal,
    openEditSuiteModal,
    openMoveSuiteModal,
    updateSuiteArchiveStatus,
    handleDeleteSuite,
    openEditCase,
    updateCaseArchiveStatus,
    loadCasoVersions,
    handleDeleteCaso,
    getSuiteExecutionMetrics,
    handleSelectTestForExecution,
  } = options;

  useWorkspaceNavigation({
    isAuthenticated, loggedUser, workspacePreferencesHydrated,
    setWorkspacePreferencesHydrated, workspacePreferencesHydratedRef,
    workspaceNavigationInitializedRef, workspaceNavigationPathRef,
    canAccessModule, setActiveTab, setSidebarCollapsed, setCollapsedSections,
    setConfigTab, setProjectInnerTab, setManagingProjectId, setCurrentOrgId,
    setSelectedOrganizationId, setCurrentProjectId, setCurrentCompId,
    setNewTestComponent, setCurrentBuildId, deepLinkBugId, setDeepLinkBugId,
    canAccessCapability, deepLinkPermissionNoticeRef, showFeedback,
    consumeDeepLinkBug, internalReportToken, activeTab, currentOrgId,
    currentProjectId, currentCompId, currentBuildId, configTab, managingProjectId,
    projectInnerTab, sidebarCollapsed, collapsedSections,
  });

  const { loadInitialBackendData } = createInitialLoadActions({
    organizations,
    loadOrganizationsFromBackend,
    loadProjectsFromBackend: projectActions.loadProjectsFromBackend,
  });

  useAppSessionBootstrap({
    isAuthenticated, projectsSource, workspacePreferencesHydrated, loggedUser,
    syncSessionFromBackend, setIsAuthenticated, initialBackendLoadKeyRef,
    organizationMembersLoadKeyRef, loadInitialBackendData, projectsLoading,
    projectsList, currentProjectId, currentOrgId, setCurrentProjectId,
    setCurrentOrgId, setSelectedOrganizationId, setCurrentCompId,
    setCurrentBuildId, hydrateProjectContext,
  });

  const access = useAppAccessNavigation({
    isAuthenticated, projectsSource, workspacePreferencesHydrated, projectsLoading,
    organizations, loggedUser, activeTab, canAccessModule, canAccessEntitledModule,
    setActiveTab, setConfigTab, setManagingProjectId, setProjectInnerTab,
    setCurrentOrgId, setSelectedOrganizationId, setCurrentProjectId,
    setCurrentCompId, setNewTestComponent, setCurrentBuildId, setViewMode,
    setCaseEditorOpen, setEditingCasoMasterId, setSelectedTest,
  });

  const trees = createSuiteTreeRenderers({
    expandedSuites, selectedSuiteId, selectedSubSuiteId, selectedTest,
    visibleAuthoringCases, currentProjectCases, currentCompId, currentBuildId,
    buildCaseIds, testSearchQuery, canAccessCapability, selectSuiteTarget,
    setExpandedSuites, openCreateCaseInSuite, openCreateSuiteModal,
    openEditSuiteModal, openMoveSuiteModal, updateSuiteArchiveStatus,
    handleDeleteSuite, openEditCase, updateCaseArchiveStatus, loadCasoVersions,
    handleDeleteCaso, getSuiteExecutionMetrics, handleSelectTestForExecution,
    showFeedback,
  });

  return { ...access, ...trees };
}
