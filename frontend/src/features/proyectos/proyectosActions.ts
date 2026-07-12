import { createBuildActions } from './buildActions'
import { createComponentActions } from './componentActions'
import { createEnvironmentActions } from './environmentActions'
import { createProjectMemberActions } from './projectMemberActions'
import { createProjectActions } from './projectActions'
import { createWikiActions } from './wikiActions'

export function createProyectosActions(params: any) {
  const projectActions = createProjectActions({
    canEditCurrentProject: params.canEditCurrentProject,
    projectsSource: params.projectsSource,
    currentOrgId: params.currentOrgId,
    currentProjectId: params.currentProjectId,
    managingProjectId: params.managingProjectId,
    organizations: params.organizations,
    projectsList: params.projectsList,
    fetchWithAuth: params.fetchWithAuth,
    setProjectsLoading: params.setProjectsLoading,
    setProjectsList: params.setProjectsList,
    setCurrentProjectId: params.setCurrentProjectId,
    setCurrentOrgId: params.setCurrentOrgId,
    setSelectedOrganizationId: params.setSelectedOrganizationId,
    setCurrentCompId: params.setCurrentCompId,
    setCurrentBuildId: params.setCurrentBuildId,
    setProjectsSource: params.setProjectsSource,
    setProjectSyncMessage: params.setProjectSyncMessage,
    showFeedback: params.showFeedback,
  })

  const componentActions = createComponentActions({
    canEditCurrentProject: params.canEditCurrentProject,
    projectsSource: params.projectsSource,
    managingProjectId: params.managingProjectId,
    currentProjectId: params.currentProjectId,
    componentForm: params.componentForm,
    componentsList: params.componentsList,
    fetchWithAuth: params.fetchWithAuth,
    setComponentsList: params.setComponentsList,
    setCurrentCompId: params.setCurrentCompId,
    setNewTestComponent: params.setNewTestComponent,
    setCurrentBuildId: params.setCurrentBuildId,
    setShowComponentModal: params.setShowComponentModal,
    setComponentForm: params.setComponentForm,
    setProjectSyncMessage: params.setProjectSyncMessage,
    showFeedback: params.showFeedback,
    confirmAction: params.confirmAction,
  })

  const buildActions = createBuildActions({
    canEditCurrentProject: params.canEditCurrentProject,
    projectsSource: params.projectsSource,
    managingProjectId: params.managingProjectId,
    currentCompId: params.currentCompId,
    currentBuildId: params.currentBuildId,
    componentsList: params.componentsList,
    buildsList: params.buildsList,
    fetchWithAuth: params.fetchWithAuth,
    setBuildsList: params.setBuildsList,
    setBuildCaseIds: params.setBuildCaseIds,
    setCurrentBuildId: params.setCurrentBuildId,
    setProjectSyncMessage: params.setProjectSyncMessage,
    showFeedback: params.showFeedback,
    confirmAction: params.confirmAction,
  })

  const environmentActions = createEnvironmentActions({
    projectsSource: params.projectsSource,
    managingProjectId: params.managingProjectId,
    environments: params.environments,
    fetchWithAuth: params.fetchWithAuth,
    setEnvironments: params.setEnvironments,
    setProjectSyncMessage: params.setProjectSyncMessage,
  })

  const projectMemberActions = createProjectMemberActions({
    projectsSource: params.projectsSource,
    managingProjectId: params.managingProjectId,
    projectMemberForm: params.projectMemberForm,
    projectMemberRemoval: params.projectMemberRemoval,
    assignableUsers: params.assignableUsers,
    projectMembers: params.projectMembers,
    fetchWithAuth: params.fetchWithAuth,
    setProjectMemberForm: params.setProjectMemberForm,
    setShowProjectMemberModal: params.setShowProjectMemberModal,
    setProjectSyncMessage: params.setProjectSyncMessage,
    setProjectMembers: params.setProjectMembers,
    setProjectsList: params.setProjectsList,
    setProjectMemberRemoval: params.setProjectMemberRemoval,
  })

  const wikiActions = createWikiActions({
    projectsSource: params.projectsSource,
    managingProjectId: params.managingProjectId,
    selectedWiki: params.selectedWiki,
    wikiFormData: params.wikiFormData,
    wikiPages: params.wikiPages,
    fetchWithAuth: params.fetchWithAuth,
    setWikiPages: params.setWikiPages,
    setSelectedWiki: params.setSelectedWiki,
    setWikiMode: params.setWikiMode,
    setProjectSyncMessage: params.setProjectSyncMessage,
    showFeedback: params.showFeedback,
    confirmAction: params.confirmAction,
  })

  return {
    projectActions,
    componentActions,
    buildActions,
    environmentActions,
    projectMemberActions,
    wikiActions,
  }
}
