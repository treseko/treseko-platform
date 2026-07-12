import type { Dispatch, SetStateAction } from 'react'
import { toDateTimeLocalInput } from '../../shared/utils/dateTime'

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
  showFeedback
}: CreateExecutionSelectorActionsParams) {
  const openExecutionSelector = () => {
    if (filteredTests.length === 0) {
      if (suiteBuildMissingCount > 0) {
        showFeedback('Sin casos ejecutables', `${suiteBuildMissingCount} caso(s) de esta suite no están asignados a la build activa. Asígnalos desde Proyectos > Componentes y Builds.`, 'warning')
      } else if (suiteComponentMismatchCount > 0) {
        showFeedback('Sin casos ejecutables', `${suiteComponentMismatchCount} caso(s) pertenecen a otro componente. Cambia el componente o la build activa.`, 'warning')
      } else {
        showFeedback('Sin casos ejecutables', 'La suite seleccionada no tiene casos ejecutables para la build activa.', 'warning')
      }
      return
    }
    const selectedExecutableTestIds = selectedExecutionTestIds.filter(testId => filteredExecutionTestIds.includes(testId))
    if (selectedExecutableTestIds.length === 0) {
      showFeedback('Selección requerida', 'Selecciona al menos un caso ejecutable antes de iniciar la ejecución.', 'warning')
      return
    }
    setExecutionModalCaseIds(selectedExecutableTestIds)
    if (selectedExecutionDiscardedCount > 0) {
      showFeedback('Selección ajustada', `${selectedExecutionDiscardedCount} caso(s) fueron omitidos porque no pertenecen al componente/build activos.`, 'info')
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
    setExecName(`Run IA - ${new Date().toISOString().slice(0, 10)}`)
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
