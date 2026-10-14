import type { Dispatch, SetStateAction } from 'react'

type CreateContextActionsParams = {
  activeTab: string
  projectsSource: 'local' | 'backend'
  managingProjectId: string | null
  contextHydrationVersionRef: { current: number }
  currentProjectId: string
  currentCompId: string
  currentBuildId: string
  projectsList: any[]
  componentsList: any[]
  loadComponentsForProject: (projectId: string, preferredComponentId?: string, isCurrent?: () => boolean) => Promise<any[] | undefined>
  loadBuildsForProject: (projectId: string, componentsSnapshot?: any[], preferredComponentId?: string, preferredBuildId?: string, isCurrent?: () => boolean) => Promise<any>
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
  setViewMode: (mode: 'list' | 'manual_exec' | 'chatbot_manual') => void
  setNewTestComponent: (componentId: string) => void
  setSuitesTree?: (items: any[]) => void
  setCasosList?: (items: any[]) => void
  setCasosSearchResults?: (items: any[] | null) => void
  setCasosTotal?: (total: number) => void
  setSuitesLoading?: (loading: boolean) => void
  setCasosLoading?: (loading: boolean) => void
}

export function createContextActions({
  activeTab,
  projectsSource,
  managingProjectId,
  contextHydrationVersionRef,
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
  setNewTestComponent,
  setSuitesTree, setCasosList, setSuitesLoading, setCasosLoading, setCasosSearchResults, setCasosTotal
}: CreateContextActionsParams) {
  const sameId = (left: unknown, right: unknown) => String(left ?? '') === String(right ?? '')

  const clearLoadedContext = () => {
    setSuitesTree?.([])
    setCasosList?.([])
    setCasosSearchResults?.(null)
    setCasosTotal?.(0)
    setSuitesLoading?.(false)
    setCasosLoading?.(false)
  }

  const resetExecutionSelection = () => {
    setSelectedTest(null)
    setSelectedExecutionTestIds([])
    setSelectedTestsForIa([])
    setViewMode('list')
  }

  const hydrateProjectContext = async (projectId = currentProjectId, preferredComponentId = currentCompId, options?: { silent?: boolean }) => {
    if (!projectId) return null
    const hydrationVersion = ++contextHydrationVersionRef.current
    const isCurrentHydration = () => contextHydrationVersionRef.current === hydrationVersion

    if (projectsSource !== 'backend') {
      const projectComponents = componentsList.filter(component => sameId(component.projectId, projectId))
      const componentId = projectComponents.some(component => sameId(component.id, preferredComponentId))
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

    const loadedComponents = await loadComponentsForProject(projectId, preferredComponentId, isCurrentHydration)
    if (!isCurrentHydration()) return null
    const projectComponents = loadedComponents?.length
      ? loadedComponents
      : componentsList.filter(component => sameId(component.projectId, projectId))
    const componentId = projectComponents.some(component => sameId(component.id, preferredComponentId))
      ? preferredComponentId
      : projectComponents[0]?.id || ''

    if (!componentId) {
      setCurrentCompId('')
      setNewTestComponent('')
      setCurrentBuildId('')
      await loadSuitesFromBackend(projectId, '', options)
      if (!isCurrentHydration()) return null
      await loadCasosFromBackend(projectId, projectComponents, { preserveExecutionState: activeTab === 'ejecutar', buildId: '', silent: options?.silent })
      if (!isCurrentHydration()) return null
      return { componentId: '', activeBuildId: '' }
    }

    setCurrentCompId(componentId)
    setNewTestComponent(componentId)
    const buildContext = await loadBuildsForProject(projectId, projectComponents, componentId, currentBuildId, isCurrentHydration)
    if (!isCurrentHydration()) return null
    const contextComponentId = buildContext?.componentId || componentId
    const activeBuildId = buildContext?.activeBuildId || ''
    await loadSuitesFromBackend(projectId, contextComponentId, options)
    if (!isCurrentHydration()) return null
    await loadCasosFromBackend(projectId, projectComponents, { preserveExecutionState: activeTab === 'ejecutar', buildId: activeBuildId, silent: options?.silent })
    if (!isCurrentHydration()) return null
    if (activeBuildId) {
      const ids = await loadBuildCases(activeBuildId, options)
      if (!isCurrentHydration()) return null
      await loadBuildCaseExecutionStatus(activeBuildId, ids, options)
    }
    return { componentId: contextComponentId, activeBuildId }
  }

  const handleProjectChange = (projId: string) => {
    clearLoadedContext()
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
    contextHydrationVersionRef.current += 1
    clearLoadedContext()
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
    clearLoadedContext()
    // Builds are scoped to a component. Do not let automation/reporting issue
    // a request with the previous component's build during the async refresh.
    setCurrentCompId(componentId)
    setCurrentBuildId('')
    setNewTestComponent(componentId || 'Web')
    resetExecutionSelection()
    const projectId = managingProjectId || currentProjectId
    await hydrateProjectContext(projectId, componentId)
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
