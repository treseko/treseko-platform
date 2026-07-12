import { getSuiteAndDescendantIds as getSuiteAndDescendantIdsFromTree } from '../../testRepositoryUtils'

type BuildExecutionViewModelParams = {
  currentBuildId: string
  currentCompId: string
  currentProjectCases: any[]
  suitesTree: any[]
  visibleSuiteTree: any[]
  buildCaseIds: Record<string, string[]>
  buildCaseResultHistoryByBuild: Record<string, Record<string, any[]>>
  latestResultsLoadingByBuild: Record<string, boolean>
  buildCasesLoadingByBuild: Record<string, boolean>
  suitesLoading: boolean
  casosLoading: boolean
  selectedSubSuiteId: string | null
  selectedSuiteId: string
  testSearchQuery: string
  selectedExecutionTestIds: string[]
  executionModalCaseIds: string[] | null
  activeExecutionCaseIds: string[]
}

export function filterSuiteTreeByIds(suites: any[], suiteIds: Set<string>): any[] {
  return suites
    .map(suite => {
      const children = filterSuiteTreeByIds(suite.children || [], suiteIds)
      return suiteIds.has(suite.id) || children.length > 0 ? { ...suite, children } : null
    })
    .filter(Boolean)
}

const getExecutionStatusKey = (test: any) => {
  const raw = String(test?.lastResult || test?.status || '').toLowerCase()
  if (['passed', 'ok', 'paso'].includes(raw)) return 'passed'
  if (['failed', 'fallido', 'fallo'].includes(raw)) return 'failed'
  if (['blocked', 'bloqueado'].includes(raw)) return 'blocked'
  return 'pending'
}

const getExecutionCaseLabel = (test: any) =>
  test?.code || (test?.id ? test.id.slice(0, 8).toUpperCase() : 'caso')

const isOutdatedExecutionCase = (test: any) =>
  Boolean(test?.isOutdatedVersion && test?.latestCaseId && test.latestCaseId !== test.id)

export function buildExecutionViewModel({
  currentBuildId,
  currentCompId,
  currentProjectCases,
  suitesTree,
  visibleSuiteTree,
  buildCaseIds,
  buildCaseResultHistoryByBuild,
  latestResultsLoadingByBuild,
  buildCasesLoadingByBuild,
  suitesLoading,
  casosLoading,
  selectedSubSuiteId,
  selectedSuiteId,
  testSearchQuery,
  selectedExecutionTestIds,
  executionModalCaseIds,
  activeExecutionCaseIds
}: BuildExecutionViewModelParams) {
  const belongsToCurrentComponent = (test: any) => !currentCompId || test.componentId === currentCompId
  const activeBuildCaseIds = currentBuildId ? (buildCaseIds[currentBuildId] || []) : []
  const activeBuildCaseSet = new Set(activeBuildCaseIds)
  const activeBuildResultHistory = currentBuildId ? (buildCaseResultHistoryByBuild[currentBuildId] || {}) : {}
  const activeBuildResultsLoaded = currentBuildId
    ? Object.prototype.hasOwnProperty.call(buildCaseResultHistoryByBuild, currentBuildId)
    : false
  const activeBuildResultsLoading = currentBuildId ? Boolean(latestResultsLoadingByBuild[currentBuildId]) : false
  const activeBuildCasesLoading = currentBuildId ? Boolean(buildCasesLoadingByBuild[currentBuildId]) : false
  const hydrateTestWithActiveBuildResult = (test: any) => {
    if (!currentBuildId || !activeBuildCaseSet.has(test.id)) return test
    if (!Object.prototype.hasOwnProperty.call(activeBuildResultHistory, test.id)) return test
    const history = activeBuildResultHistory[test.id] || []
    const latest = history[0]
    return {
      ...test,
      lastResult: latest?.status || null,
      lastExecutedAt: latest?.date || null,
      lastExecutedBy: latest?.executedBy || null,
      lastExecutedVersion: latest?.versionExecuted || null,
      history
    }
  }

  const currentExecutionCaseSource = currentProjectCases
    .filter(test => test.caseStatus !== 'ARCHIVADO')
    .map(hydrateTestWithActiveBuildResult)
  const currentExecutionCases = currentExecutionCaseSource.filter(test =>
    belongsToCurrentComponent(test) && (!currentBuildId || activeBuildCaseSet.has(test.id))
  )
  const executionSuiteIds = new Set(currentExecutionCases.map(test => test.suiteId).filter(Boolean))
  const executionSuiteTree = currentBuildId
    ? filterSuiteTreeByIds(suitesTree, executionSuiteIds)
    : visibleSuiteTree
  const executionInitialLoading = (suitesLoading || casosLoading || activeBuildCasesLoading) && executionSuiteTree.length === 0 && currentExecutionCases.length === 0
  const executionRefreshing = (suitesLoading || casosLoading || activeBuildCasesLoading || activeBuildResultsLoading) && !executionInitialLoading

  const selectedSuiteTarget = selectedSubSuiteId || selectedSuiteId
  const selectedSuiteAndDescendantIds = selectedSuiteTarget
    ? getSuiteAndDescendantIdsFromTree(suitesTree, selectedSuiteTarget)
    : []
  const query = testSearchQuery.trim().toLowerCase()
  const matchesCaseQuery = (test: any) => (
    test.title.toLowerCase().includes(query) ||
    test.id.toLowerCase().includes(query) ||
    (test.code || '').toLowerCase().includes(query) ||
    (test.tags || []).some((tag: string) => tag.toLowerCase().includes(query))
  )
  const filteredTests = currentExecutionCaseSource.filter(test => {
    const belongsToComponent = belongsToCurrentComponent(test)
    const belongsToCurrentBuild = currentBuildId && activeBuildCaseSet.has(test.id)
    if (query) {
      return belongsToComponent && belongsToCurrentBuild && (
        matchesCaseQuery(test)
      )
    }
    return belongsToComponent && belongsToCurrentBuild && selectedSuiteAndDescendantIds.includes(test.suiteId)
  })

  const suiteCandidateTests = currentExecutionCaseSource.filter(test =>
    selectedSuiteAndDescendantIds.includes(test.suiteId) &&
    (!query || matchesCaseQuery(test))
  )
  const suiteComponentMismatchCount = suiteCandidateTests.filter(test => !belongsToCurrentComponent(test)).length
  const suiteBuildMissingCount = suiteCandidateTests.filter(test => belongsToCurrentComponent(test) && !activeBuildCaseSet.has(test.id)).length

  const executionSelectableTests = currentExecutionCaseSource.filter(test =>
    belongsToCurrentComponent(test) && activeBuildCaseSet.has(test.id)
  )
  const allExecutionTestsById = new Map(currentExecutionCaseSource.map(test => [test.id, test]))
  const executionTestsById = new Map(executionSelectableTests.map(test => [test.id, test]))
  const resolveExecutionCandidate = (testId: string) => {
    const selectable = executionTestsById.get(testId)
    if (selectable) return selectable
    const candidate = allExecutionTestsById.get(testId)
    if (candidate && belongsToCurrentComponent(candidate) && isOutdatedExecutionCase(candidate)) return candidate
    return null
  }

  const selectedExecutionTests = selectedExecutionTestIds
    .map(resolveExecutionCandidate)
    .filter(Boolean)
  const selectedExecutionDiscardedCount = selectedExecutionTestIds.length - selectedExecutionTests.length
  const executionModalTestIds = executionModalCaseIds || []
  const executionModalTests = executionModalTestIds
    .map(resolveExecutionCandidate)
    .filter(Boolean)
  const executionModalDiscardedCount = executionModalTestIds.length - executionModalTests.length
  const activeExecutionTests = (activeExecutionCaseIds.length > 0 ? activeExecutionCaseIds : selectedExecutionTestIds)
    .map(testId => executionTestsById.get(testId))
    .filter(Boolean)
  const filteredExecutionTestIds = filteredTests.map(test => test.id)
  const allVisibleExecutionTestsSelected = filteredTests.length > 0 && filteredTests.every(test => selectedExecutionTestIds.includes(test.id))

  const getSuiteExecutionMetrics = (suiteId: string) => {
    const suiteIds = getSuiteAndDescendantIdsFromTree(suitesTree, suiteId)
    const suiteTests = currentExecutionCaseSource.filter(test =>
      suiteIds.includes(test.suiteId) &&
      belongsToCurrentComponent(test) &&
      activeBuildCaseSet.has(test.id)
    )
    return {
      total: suiteTests.length,
      passed: suiteTests.filter(test => getExecutionStatusKey(test) === 'passed').length,
      failed: suiteTests.filter(test => getExecutionStatusKey(test) === 'failed').length,
      blocked: suiteTests.filter(test => getExecutionStatusKey(test) === 'blocked').length,
      pending: suiteTests.filter(test => getExecutionStatusKey(test) === 'pending').length
    }
  }

  const getLatestCaseForExecution = (test: any) =>
    currentProjectCases.find(item => item.id === test?.latestCaseId) || null

  const getExecutionActionLabel = (test: any) => {
    if (!isOutdatedExecutionCase(test)) return `Ejecutar ${getExecutionCaseLabel(test)}`
    const latestVersion = test.latestVersion || 'nueva'
    return `Actualizar y ejecutar ${getExecutionCaseLabel(test)} v${latestVersion}`
  }

  return {
    activeBuildCaseIds,
    activeBuildResultsLoaded,
    activeBuildResultsLoading,
    activeBuildCasesLoading,
    currentExecutionCaseSource,
    currentExecutionCases,
    executionSuiteTree,
    executionInitialLoading,
    executionRefreshing,
    filteredTests,
    suiteComponentMismatchCount,
    suiteBuildMissingCount,
    isOutdatedExecutionCase,
    selectedExecutionTests,
    selectedExecutionDiscardedCount,
    executionModalTests,
    executionModalDiscardedCount,
    activeExecutionTests,
    filteredExecutionTestIds,
    allVisibleExecutionTestsSelected,
    getExecutionStatusKey,
    getSuiteExecutionMetrics,
    getExecutionCaseLabel,
    getLatestCaseForExecution,
    getExecutionActionLabel
  }
}
