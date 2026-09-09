import type { Dispatch, SetStateAction } from 'react'
import { toDateTimeLocalInput } from '../../shared/utils/dateTime'
import type { TranslationKey } from '../../i18n/types'

type FeedbackVariant = 'success' | 'danger' | 'warning' | 'info'

type CreateExecutionSelectorActionsParams = {
  filteredTests: any[]
  selectedExecutionTests: any[]
  selectedExecutionDiscardedCount: number
  suiteBuildMissingCount: number
  suiteComponentMismatchCount: number
  executionModalTests: any[]
  setExecutionModalCaseIds: Dispatch<SetStateAction<string[] | null>>
  setExecutionModalCandidateCaseIds?: Dispatch<SetStateAction<string[] | null>>
  setSelectedExecutionTestIds?: Dispatch<SetStateAction<string[]>>
  setShowExecSelector: (show: boolean) => void
  setSelectedTest: Dispatch<SetStateAction<any>>
  setSelectedTestsForIa: Dispatch<SetStateAction<string[]>>
  setSchedulerSearch: (search: string) => void
  setExecName: (name: string) => void
  setScheduledTime: (time: string) => void
  setShowIaScheduler: (show: boolean) => void
  showFeedback: (title: string, message: string, variant?: FeedbackVariant) => void
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
}

export function createExecutionSelectorActions({
  filteredTests,
  selectedExecutionTests,
  selectedExecutionDiscardedCount,
  suiteBuildMissingCount,
  suiteComponentMismatchCount,
  executionModalTests,
  setExecutionModalCaseIds,
  setExecutionModalCandidateCaseIds,
  setSelectedExecutionTestIds,
  setShowExecSelector,
  setSelectedTest,
  setSelectedTestsForIa,
  setSchedulerSearch,
  setExecName,
  setScheduledTime,
  setShowIaScheduler,
  showFeedback,
  t
}: CreateExecutionSelectorActionsParams) {
  const openExecutionSelector = () => {
    // A suite/search filter only controls the visible slice. A batch may have
    // selected cases from other suites, so only an empty global selection is
    // a reason to stop here.
    if (selectedExecutionTests.length === 0) {
      if (suiteBuildMissingCount > 0) {
        showFeedback(t('ejecutarPruebas.noExecutableCases'), t('ejecutarPruebas.missingBuildCases', { count: suiteBuildMissingCount }), 'warning')
      } else if (suiteComponentMismatchCount > 0) {
        showFeedback(t('ejecutarPruebas.noExecutableCases'), t('ejecutarPruebas.componentMismatchCases', { count: suiteComponentMismatchCount }), 'warning')
      } else {
        showFeedback(t('ejecutarPruebas.noExecutableCases'), t('ejecutarPruebas.noExecutableCasesMessage'), 'warning')
      }
      return
    }
    // The selection is global to the execution batch. The suite/search filter
    // only controls what is visible and what "select all" affects; it must not
    // silently discard selected cases from other suites when opening the
    // execution modal.
    const selectedExecutableTestIds = selectedExecutionTests.map(test => test.id)
    if (selectedExecutableTestIds.length === 0) {
      showFeedback(t('ejecutarPruebas.selectionRequired'), t('ejecutarPruebas.selectionRequiredMessage'), 'warning')
      return
    }
    setExecutionModalCandidateCaseIds?.(selectedExecutableTestIds)
    setExecutionModalCaseIds(selectedExecutableTestIds)
    if (selectedExecutionDiscardedCount > 0) {
      showFeedback(t('ejecutarPruebas.selectionAdjusted'), t('ejecutarPruebas.selectionAdjustedMessage', { count: selectedExecutionDiscardedCount }), 'info')
    }
    setShowExecSelector(true)
  }

  const openSingleCaseExecutionSelector = (test: any) => {
    if (!test?.id) return
    setSelectedTest(test)
    setExecutionModalCandidateCaseIds?.([test.id])
    setExecutionModalCaseIds([test.id])
    setShowExecSelector(true)
  }

  const removeExecutionModalCase = (testId: string) => {
    setExecutionModalCaseIds(prev => prev ? prev.filter(id => String(id) !== String(testId)) : prev)
    setSelectedExecutionTestIds?.(prev => prev.filter(id => String(id) !== String(testId)))
  }

  const restoreExecutionModalCases = (testIds: string[]) => {
    const normalizedIds = testIds.map(String)
    setExecutionModalCaseIds(prev => Array.from(new Set([...(prev || []), ...normalizedIds])))
    setSelectedExecutionTestIds?.(prev => Array.from(new Set([...prev, ...normalizedIds])))
  }

  const closeExecutionSelector = () => {
    setExecutionModalCaseIds(null)
    setExecutionModalCandidateCaseIds?.(null)
    setShowExecSelector(false)
  }

  const openIaSchedulerFromExecutionSelector = () => {
    setShowExecSelector(false)
    setSelectedTestsForIa(executionModalTests.length > 0 ? executionModalTests.map(test => test.id) : filteredTests.map(test => test.id))
    setExecutionModalCaseIds(null)
    setSchedulerSearch('')
    setExecName(`${t('ejecutarPruebas.iaRunName')} - ${new Date().toISOString().slice(0, 10)}`)
    const now = new Date()
    now.setMinutes(now.getMinutes() + 5)
    setScheduledTime(toDateTimeLocalInput(now.toISOString()))
    setShowIaScheduler(true)
  }

  return {
    openExecutionSelector,
    openSingleCaseExecutionSelector,
    removeExecutionModalCase,
    restoreExecutionModalCases,
    closeExecutionSelector,
    openIaSchedulerFromExecutionSelector
  }
}
