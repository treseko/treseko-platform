import { useEffect } from 'react'
import { API_BASE } from '../../../app/constants'
import { flattenSuites } from '../../../testRepositoryUtils'
import { createExecutionSelectorActions } from '../executionSelectorActions'
import { buildExecutionViewModel } from '../executionViewModel'

export function useExecutionPreparation(params: any) {
  const viewModel = buildExecutionViewModel({
    currentBuildId: params.currentBuildId,
    currentCompId: params.currentCompId,
    currentProjectCases: params.currentProjectCases,
    suitesTree: params.suitesTree,
    visibleSuiteTree: params.visibleSuiteTree,
    buildCaseIds: params.buildCaseIds,
    buildCaseResultHistoryByBuild: params.buildCaseResultHistoryByBuild,
    latestResultsLoadingByBuild: params.latestResultsLoadingByBuild,
    buildCasesLoadingByBuild: params.buildCasesLoadingByBuild,
    suitesLoading: params.suitesLoading,
    casosLoading: params.casosLoading,
    selectedSubSuiteId: params.selectedSubSuiteId,
    selectedSuiteId: params.selectedSuiteId,
    testSearchQuery: params.testSearchQuery,
    selectedExecutionTestIds: params.selectedExecutionTestIds,
    executionModalCaseIds: params.executionModalCaseIds,
    activeExecutionCaseIds: params.activeExecutionCaseIds,
  })

  const executionDatasetPreviewCaseId = viewModel.executionModalTests[0]?.id || params.selectedTest?.id || ''

  useEffect(() => {
    if (!params.showExecSelector || !executionDatasetPreviewCaseId) {
      params.setExecutionDatasetPreview(null)
      return
    }
    let cancelled = false
    params.setExecutionDatasetPreviewLoading(true)
    params.fetchWithAuth(`${API_BASE}/casos/${executionDatasetPreviewCaseId}/dataset/resolve`, {
      method: 'POST',
      body: JSON.stringify({
        build_id: params.currentBuildId || null,
        entorno_id: params.selectedExecutionEnvironmentId || null,
        dataset_id: params.selectedExecutionDatasetId || null
      })
    })
      .then((response: Response) => response.ok ? response.json() : null)
      .then((data: any) => {
        if (!cancelled) params.setExecutionDatasetPreview(data)
      })
      .catch(() => {
        if (!cancelled) params.setExecutionDatasetPreview(null)
      })
      .finally(() => {
        if (!cancelled) params.setExecutionDatasetPreviewLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    params.showExecSelector,
    executionDatasetPreviewCaseId,
    params.selectedExecutionEnvironmentId,
    params.selectedExecutionDatasetId,
    params.currentBuildId,
  ])

  useEffect(() => {
    if (params.activeTab !== 'ejecutar' || params.suitesLoading || params.casosLoading || viewModel.activeBuildCasesLoading) return
    const executableSuites = flattenSuites(viewModel.executionSuiteTree)
    const selectedSuite = params.selectedSubSuiteId || params.selectedSuiteId
    if (executableSuites.length === 0) {
      if (selectedSuite) {
        params.setSelectedSuiteId('')
        params.setSelectedSubSuiteId(null)
        params.setSelectedTest(null)
      }
      return
    }
    if (!selectedSuite || !executableSuites.some((suite: any) => suite.id === selectedSuite)) {
      params.selectSuiteTarget(executableSuites[0].id)
      params.setSelectedTest(null)
    }
  }, [
    params.activeTab,
    params.currentCompId,
    params.currentProjectId,
    params.currentBuildId,
    params.suitesTree,
    params.casosList,
    viewModel.activeBuildCaseIds.join('|'),
    params.suitesLoading,
    params.casosLoading,
    viewModel.activeBuildCasesLoading,
  ])

  const toggleExecutionSelection = (testId: string) => {
    params.setSelectedExecutionTestIds((prev: string[]) =>
      prev.includes(testId) ? prev.filter(id => id !== testId) : [...prev, testId]
    )
  }

  const toggleVisibleExecutionSelection = (checked: boolean) => {
    params.setSelectedExecutionTestIds((prev: string[]) => {
      if (checked) return [...new Set([...prev, ...viewModel.filteredExecutionTestIds])]
      return prev.filter(testId => !viewModel.filteredExecutionTestIds.includes(testId))
    })
  }

  const selectorActions = createExecutionSelectorActions({
    filteredTests: viewModel.filteredTests,
    filteredExecutionTestIds: viewModel.filteredExecutionTestIds,
    selectedExecutionTestIds: params.selectedExecutionTestIds,
    selectedExecutionDiscardedCount: viewModel.selectedExecutionDiscardedCount,
    suiteBuildMissingCount: viewModel.suiteBuildMissingCount,
    suiteComponentMismatchCount: viewModel.suiteComponentMismatchCount,
    executionModalTests: viewModel.executionModalTests,
    setExecutionModalCaseIds: params.setExecutionModalCaseIds,
    setShowExecSelector: params.setShowExecSelector,
    setSelectedTest: params.setSelectedTest,
    setSelectedTestsForIa: params.setSelectedTestsForIa,
    setSchedulerSearch: params.setSchedulerSearch,
    setExecName: params.setExecName,
    setScheduledTime: params.setScheduledTime,
    setShowIaScheduler: params.setShowIaScheduler,
    showFeedback: params.showFeedback,
  })

  return {
    ...viewModel,
    toggleExecutionSelection,
    toggleVisibleExecutionSelection,
    ...selectorActions,
  }
}
