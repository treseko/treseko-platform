import { ProyectosPage } from '../features/proyectos/ProyectosPage'

type ProyectosRouteProps = {
  managingProjectId: string
  setManagingProjectId: (id: string) => void
  projectInnerTab: string
  setProjectInnerTab: (tab: any) => void
  canAccessModule: (moduleId: any, level?: any) => boolean
  canAccessCapability: (capabilityId: any, level?: any) => boolean
  hasSystemFeature: (featureId: string) => boolean
  setActiveTab: (tab: any) => void
  projectsState: any
  projectActions: any
  handleProjectChange: (projectId: string) => void
  componentState: any
  componentActions: any
  buildState: any
  buildActions: any
  sortBuildsNewestFirst: (builds: any[]) => any[]
  openBuildCasesModal: (buildId: string) => void
  environmentState: any
  environmentActions: any
  projectMemberState: any
  projectMemberActions: any
  wikiState: any
  wikiActions: any
  organizations: any[]
  projectsList: any[]
  currentOrgId: string
  currentProjectId: string
  componentsList: any[]
  buildsList: any[]
  canEditCurrentProject: boolean
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  showFeedback: (title: string, message: string, variant?: string) => void
}

export function ProyectosRoute({
  managingProjectId,
  setManagingProjectId,
  projectInnerTab,
  setProjectInnerTab,
  canAccessModule,
  canAccessCapability,
  hasSystemFeature,
  setActiveTab,
  projectsState,
  projectActions,
  handleProjectChange,
  componentState,
  componentActions,
  buildState,
  buildActions,
  sortBuildsNewestFirst,
  openBuildCasesModal,
  environmentState,
  environmentActions,
  projectMemberState,
  projectMemberActions,
  wikiState,
  wikiActions,
  organizations,
  projectsList,
  currentOrgId,
  currentProjectId,
  componentsList,
  buildsList,
  canEditCurrentProject,
  fetchWithAuth,
  showFeedback,
}: ProyectosRouteProps) {
  return (
    <ProyectosPage
      managingProjectId={managingProjectId}
      setManagingProjectId={setManagingProjectId}
      projectInnerTab={projectInnerTab}
      setProjectInnerTab={setProjectInnerTab}
      canAccessModule={canAccessModule}
      canAccessCapability={canAccessCapability}
      hasSystemFeature={hasSystemFeature}
      setActiveTab={setActiveTab}
      handleCreateProject={projectActions.handleCreateProject}
      organizations={organizations}
      projectsLoading={projectsState.projectsLoading}
      projectsList={projectsList}
      currentOrgId={currentOrgId}
      currentProjectId={currentProjectId}
      componentsList={componentsList}
      buildsList={buildsList}
      handleProjectChange={handleProjectChange}
      handleUpdateProject={projectActions.handleUpdateProject}
      canEditCurrentProject={canEditCurrentProject}
      projectMembers={projectMemberState.projectMembers}
      handleAddProjectMember={projectMemberActions.handleAddProjectMember}
      handleRemoveProjectMember={projectMemberActions.handleRemoveProjectMember}
      setComponentForm={componentState.setComponentForm}
      setShowComponentModal={componentState.setShowComponentModal}
      componentSearchQuery={componentState.componentSearchQuery}
      setComponentSearchQuery={componentState.setComponentSearchQuery}
      handleComponentChange={componentActions.handleComponentChange}
      currentCompId={componentState.currentCompId}
      handleDeleteComponent={componentActions.handleDeleteComponent}
      handleCreateBuild={buildActions.handleCreateBuild}
      sortBuildsNewestFirst={sortBuildsNewestFirst}
      openBuildCasesModal={openBuildCasesModal}
      buildCaseIds={buildState.buildCaseIds}
      handleSetActiveBuild={buildActions.handleSetActiveBuild}
      handleSetInactiveBuild={buildActions.handleSetInactiveBuild}
      handleToggleBuildHidden={buildActions.handleToggleBuildHidden}
      handleDeleteBuild={buildActions.handleDeleteBuild}
      handleUpdateBuildContext={buildActions.handleUpdateBuildContext}
      environments={environmentState.environments}
      handleSaveProjectEnvironment={environmentActions.handleSaveProjectEnvironment}
      handleEditProjectEnvironment={environmentActions.handleEditProjectEnvironment}
      handleDeleteProjectEnvironment={environmentActions.handleDeleteProjectEnvironment}
      handleSaveEnvironmentDataset={environmentActions.handleSaveEnvironmentDataset}
      handleUpdateEnvironmentDataset={environmentActions.handleUpdateEnvironmentDataset}
      handleSetDefaultEnvironmentDataset={environmentActions.handleSetDefaultEnvironmentDataset}
      handleDeleteEnvironmentDataset={environmentActions.handleDeleteEnvironmentDataset}
      wikiMode={wikiState.wikiMode}
      setWikiMode={wikiState.setWikiMode}
      selectedWiki={wikiState.selectedWiki}
      setSelectedWiki={wikiState.setSelectedWiki}
      wikiFormData={wikiState.wikiFormData}
      setWikiFormData={wikiState.setWikiFormData}
      wikiPages={wikiState.wikiPages}
      handleDeleteWikiPage={wikiActions.handleDeleteWikiPage}
      handleSaveWikiPage={wikiActions.handleSaveWikiPage}
      fetchWithAuth={fetchWithAuth}
      showFeedback={showFeedback}
    />
  )
}
