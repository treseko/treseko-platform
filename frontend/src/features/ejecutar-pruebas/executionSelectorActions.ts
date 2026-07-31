import type { Dispatch, SetStateAction } from 'react'
import { toDateTimeLocalInput } from '../../shared/utils/dateTime'
import type { TranslationKey } from '../../i18n/types'

type FeedbackVariant = 'success' | 'danger' | 'warning' | 'info'

type CreateExecutionSelectorActionsParams = {
  filteredTests: any[]
  filteredExecutionTestIds: string[]
  selectedExecutionTestIds: string[]
  selectedExecutionDiscardedCount: number
  suiteBuildMissingCount: number
  suiteComponentMismatchCount: number
  executionModalTests: any[]
  setExecutionModalCaseIds: Dispatch<SetStateAction<string[] | null>>
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
  filteredExecutionTestIds,
  selectedExecutionTestIds,
  selectedExecutionDiscardedCount,
  suiteBuildMissingCount,
  suiteComponentMismatchCount,
  executionModalTests,
  setExecutionModalCaseIds,
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
    if (filteredTests.length === 0) {
      if (suiteBuildMissingCount > 0) {
        showFeedback(t('ejecutarPruebas.noExecutableCases'), t('ejecutarPruebas.missingBuildCases', { count: suiteBuildMissingCount }), 'warning')
      } else if (suiteComponentMismatchCount > 0) {
        showFeedback(t('ejecutarPruebas.noExecutableCases'), t('ejecutarPruebas.componentMismatchCases', { count: suiteComponentMismatchCount }), 'warning')
      } else {
        showFeedback(t('ejecutarPruebas.noExecutableCases'), t('ejecutarPruebas.noExecutableCasesMessage'), 'warning')
      }
      return
    }
    const selectedExecutableTestIds = selectedExecutionTestIds.filter(testId => filteredExecutionTestIds.includes(testId))
    if (selectedExecutableTestIds.length === 0) {
      showFeedback(t('ejecutarPruebas.selectionRequired'), t('ejecutarPruebas.selectionRequiredMessage'), 'warning')
      return
    }
    setExecutionModalCaseIds(selectedExecutableTestIds)
    if (selectedExecutionDiscardedCount > 0) {
      showFeedback(t('ejecutarPruebas.selectionAdjusted'), t('ejecutarPruebas.selectionAdjustedMessage', { count: selectedExecutionDiscardedCount }), 'info')
    }
    setShowExecSelector(true)
  }

  const openSingleCaseExecutionSelector = (test: any) => {
    if (!test?.id) return
    setSelectedTest(test)
    setExecutionModalCaseIds([test.id])
    setShowExecSelector(true)
  }

  const closeExecutionSelector = () => {
    setExecutionModalCaseIds(null)
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
    closeExecutionSelector,
    openIaSchedulerFromExecutionSelector
  }
}
