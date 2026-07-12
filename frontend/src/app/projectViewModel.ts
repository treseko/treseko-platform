import { filterSuiteTreeByIds } from '../features/ejecutar-pruebas/executionViewModel'

type BuildProjectViewModelParams = {
  currentProjectId: string
  currentCompId: string
  managingProjectId: string | null
  loggedUser: any
  projectsSource: 'local' | 'backend'
  casosList: any[]
  projectMembers: any[]
  environments: any[]
  devices: any[]
  agents: any[]
  inventoryCategories: any[]
  customInventoryItems: any[]
  redmineBugs: any[]
  runHistory: any[]
  iaQueue: string[]
  suitesTree: any[]
  suitesLoading: boolean
  casosLoading: boolean
  canEditProjects: boolean
}

const countCaseStatus = (tests: any[]) => ({
  passed: tests.filter(t => t.status === 'passed' || t.status === 'ok' || t.status === 'OK').length,
  failed: tests.filter(t => t.status === 'failed' || t.status === 'fallido' || t.status === 'FALLIDO').length,
  blocked: tests.filter(t => t.status === 'blocked' || t.status === 'bloqueado' || t.status === 'BLOQUEADO').length
})

const filterArchivedSuites = (suites: any[], includeArchived: boolean): any[] =>
  suites
    .filter(suite => includeArchived || !suite.archivado)
    .map(suite => ({
      ...suite,
      children: filterArchivedSuites(suite.children || [], includeArchived)
    }))

export function buildProjectViewModel({
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
  canEditProjects
}: BuildProjectViewModelParams) {
  const allProjectCases = currentProjectId ? casosList.filter(test => test.projectId === currentProjectId) : []
  const isArchivedCase = (test: any) => test.caseStatus === 'ARCHIVADO'
  const currentProjectCases = allProjectCases.filter(test => !isArchivedCase(test))
  const allAuthoringCases = allProjectCases.filter(test => !test.isHistoricalBuildVersion)
  const archivedAuthoringCases = allAuthoringCases.filter(isArchivedCase)
  const currentAuthoringCases = allAuthoringCases.filter(test => !isArchivedCase(test))
  const effectiveProjectId = managingProjectId || currentProjectId
  const currentProjectMember = projectMembers.find(member =>
    member.projectId === effectiveProjectId &&
    (
      (loggedUser.id && member.userId === loggedUser.id) ||
      member.user?.email === loggedUser.email
    )
  )
  const canEditCurrentProject = canEditProjects && (
    loggedUser.role === 'ADMIN' ||
    !!currentProjectMember
  )
  const currentProjectEnvironments = currentProjectId ? environments.filter(item => item.projectId === currentProjectId) : []
  const currentProjectDevices = currentProjectId ? devices.filter(item => item.projectId === currentProjectId) : []
  const currentProjectAgents = currentProjectId ? agents.filter(item => item.projectId === currentProjectId) : []
  const currentProjectInventoryCategories = inventoryCategories.filter(cat =>
    cat.type !== 'env' && (cat.type !== 'custom' || cat.projectId === currentProjectId)
  )
  const currentProjectCustomInventoryItems = currentProjectId ? customInventoryItems.filter(item => item.projectId === currentProjectId) : []
  const currentProjectRedmineBugs = currentProjectId ? redmineBugs.filter(item => item.projectId === currentProjectId) : []
  const currentProjectRunHistory = currentProjectId ? runHistory.filter(item => item.projectId === currentProjectId) : []
  const currentProjectIaQueue = iaQueue.filter(testId => currentProjectCases.some(test => test.id === testId))
  const belongsToCurrentComponent = (test: any) => !currentCompId || test.componentId === currentCompId
  const currentComponentCases = currentAuthoringCases.filter(belongsToCurrentComponent)
  const currentComponentSuiteIds = new Set(currentComponentCases.map(test => test.suiteId).filter(Boolean))
  const allVisibleSuiteTree = projectsSource === 'backend'
    ? suitesTree
    : (currentCompId ? filterSuiteTreeByIds(suitesTree, currentComponentSuiteIds) : suitesTree)
  const visibleSuiteTree = filterArchivedSuites(allVisibleSuiteTree, false)
  const authoringInitialLoading = (suitesLoading || casosLoading) && visibleSuiteTree.length === 0 && currentAuthoringCases.length === 0
  const authoringRefreshing = (suitesLoading || casosLoading) && !authoringInitialLoading

  const getSubSuiteStats = (subSuiteId: string) => countCaseStatus(
    currentComponentCases.filter(t => t.subSuiteId === subSuiteId)
  )

  const getSuiteStats = (suiteId: string) => countCaseStatus(
    currentComponentCases.filter(t => t.suiteId === suiteId)
  )

  return {
    currentProjectCases,
    allProjectCases,
    allAuthoringCases,
    archivedAuthoringCases,
    currentAuthoringCases,
    effectiveProjectId,
    currentProjectMember,
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
    getSuiteStats
  }
}
