import type { Dispatch, SetStateAction } from 'react'

type CreateContextActionsParams = {
  activeTab: string
  projectsSource: 'local' | 'backend'
  currentProjectId: string
  currentCompId: string
  currentBuildId: string
  projectsList: any[]
  componentsList: any[]
  loadComponentsForProject: (projectId: string) => Promise<any[] | undefined>
  loadBuildsForProject: (projectId: string, componentsSnapshot?: any[], preferredComponentId?: string, preferredBuildId?: string) => Promise<any>
  loadSuitesFromBackend: (projectId: string, componentId?: string, options?: { silent?: boolean }) => Promise<any>
  loadCasosFromBackend: (projectId?: string, componentsSnapshot?: any[], options?: any) => Promise<any>
  loadBuildCases: (buildId: string, options?: { silent?: boolean }) => Promise<string[]>
  loadBuildCaseExecutionStatus: (buildId: string, assignedCaseIds?: string[], options?: { silent?: boolean }) => Promise<any>
  setCurrentOrgId: (id: string) => void
  setManagingProjectId: (id: string | null) => void
  setSelectedTest: Dispatch<SetStateAction<any>>
  setSelectedExecutionTestIds: Dispatch<SetStateAction<string[]>>
  setSelectedTestsForIa: Dispatch<SetStateAction<string[]>>
  setProjectMetrics: Dispatch<SetStateAction<any>>
  setCurrentProjectId: (id: string) => void
  setCurrentCompId: (id: string) => void
  setCurrentBuildId: (id: string) => void
  setViewMode: (mode: 'list' | 'manual_exec') => void
  setNewTestComponent: (componentId: string) => void
}

export function createContextActions({
  activeTab,
  projectsSource,
  currentProjectId,
  currentCompId,
  currentBuildId,
  projectsList,
  componentsList,
  loadComponentsForProject,
  loadBuildsForProject,
  loadSuitesFromBackend,
  loadCasosFromBackend,
  loadBuildCases,
  loadBuildCaseExecutionStatus,
  setCurrentOrgId,
  setManagingProjectId,
  setSelectedTest,
  setSelectedExecutionTestIds,
  setSelectedTestsForIa,
  setProjectMetrics,
  setCurrentProjectId,
  setCurrentCompId,
  setCurrentBuildId,
  setViewMode,
  setNewTestComponent
}: CreateContextActionsParams) {
  const resetExecutionSelection = () => {
    setSelectedTest(null)
    setSelectedExecutionTestIds([])
    setSelectedTestsForIa([])
    setViewMode('list')
  }

  const hydrateProjectContext = async (projectId = currentProjectId, preferredComponentId = currentCompId, options?: { silent?: boolean }) => {
    if (!projectId) return null

    if (projectsSource !== 'backend') {
      const projectComponents = componentsList.filter(component => component.projectId === projectId)
      const componentId = projectComponents.some(component => component.id === preferredComponentId)
        ? preferredComponentId
        : projectComponents[0]?.id || ''
      if (componentId) {
        setCurrentCompId(componentId)
        setNewTestComponent(componentId)
      } else {
        setCurrentCompId('')
        setNewTestComponent('Web')
        setCurrentBuildId('')
      }
      return { componentId, activeBuildId: '' }
    }

    const loadedComponents = await loadComponentsForProject(projectId)
    const projectComponents = loadedComponents?.length
      ? loadedComponents
      : componentsList.filter(component => component.projectId === projectId)
    const componentId = projectComponents.some(component => component.id === preferredComponentId)
      ? preferredComponentId
      : projectComponents[0]?.id || ''

    if (!componentId) {
      setCurrentCompId('')
      setNewTestComponent('')
      setCurrentBuildId('')
      await loadSuitesFromBackend(projectId, '', options)
      await loadCasosFromBackend(projectId, projectComponents, { preserveExecutionState: activeTab === 'ejecutar', buildId: '', silent: options?.silent })
      return { componentId: '', activeBuildId: '' }
    }

    setCurrentCompId(componentId)
    setNewTestComponent(componentId)
    const buildContext = await loadBuildsForProject(projectId, projectComponents, componentId, currentBuildId)
    const contextComponentId = buildContext?.componentId || componentId
    const activeBuildId = buildContext?.activeBuildId || ''
    await loadSuitesFromBackend(projectId, contextComponentId, options)
    await loadCasosFromBackend(projectId, projectComponents, { preserveExecutionState: activeTab === 'ejecutar', buildId: activeBuildId, silent: options?.silent })
    if (activeBuildId) {
      const ids = await loadBuildCases(activeBuildId, options)
      await loadBuildCaseExecutionStatus(activeBuildId, ids, options)
    }
    return { componentId: contextComponentId, activeBuildId }
  }

  const handleProjectChange = (projId: string) => {
    resetExecutionSelection()
    setProjectMetrics(null)
    // A component/build belongs to the previous project until the new context
    // finishes hydrating. Clear both selections first so dependent views do not
    // query the new project with a stale build id from the previous one.
    setCurrentCompId('')
    setCurrentBuildId('')
    setNewTestComponent('')
    setCurrentProjectId(projId)
    const proj = projectsList.find(p => p.id === projId)
    if (proj) {
      setCurrentOrgId(proj.orgId)
    }
    hydrateProjectContext(projId)
  }

  const handleOrgChange = (orgId: string) => {
    setCurrentOrgId(orgId)
    setManagingProjectId(null)
    resetExecutionSelection()
    setProjectMetrics(null)
    const filteredProjs = projectsList.filter(p => p.orgId === orgId)
    if (filteredProjs.length > 0) {
      handleProjectChange(filteredProjs[0].id)
    } else {
      setCurrentProjectId('')
      setCurrentCompId('')
      setCurrentBuildId('')
    }
  }

  const handleComponentChange = async (componentId: string) => {
    // Builds are scoped to a component. Do not let automation/reporting issue
    // a request with the previous component's build during the async refresh.
    setCurrentCompId(componentId)
    setCurrentBuildId('')
    setNewTestComponent(componentId || 'Web')
    resetExecutionSelection()
    await hydrateProjectContext(currentProjectId, componentId)
  }

  const refreshCurrentTestContext = async (componentId = currentCompId, options?: { silent?: boolean }) => {
    await hydrateProjectContext(currentProjectId, componentId, options)
  }

  const loadProjectTestContext = async () => {
    await hydrateProjectContext(currentProjectId, currentCompId)
  }

  return {
    handleOrgChange,
    handleProjectChange,
    handleComponentChange,
    hydrateProjectContext,
    refreshCurrentTestContext,
    loadProjectTestContext
  }
}
