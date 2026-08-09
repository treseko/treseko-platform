import { startTransition } from 'react'
import type { Dispatch, SetStateAction } from 'react'

type CreateExecutionCaseSelectionActionsParams = {
  viewMode: 'list' | 'manual_exec'
  currentExecutionRun: any
  loadCasoExecutionHistory: (caseId: string) => Promise<any[]>
  loadExecutionDetails: (runId: string, caseId: string) => Promise<any>
  setStepResults: Dispatch<SetStateAction<Record<number, string>>>
  setSnapshotNotes: Dispatch<SetStateAction<Record<number, string>>>
  setGeneralExecutionStatus: (status: string) => void
  setGeneralExecutionNote: (note: string) => void
  setExecutionSnapshots: Dispatch<SetStateAction<any[]>>
  setCurrentExecutionCase: Dispatch<SetStateAction<any>>
  setCurrentExecutionRun: Dispatch<SetStateAction<any>>
  setExecutionMode: Dispatch<SetStateAction<'manual' | 'automated' | 'ia' | null>>
  setSelectedTest: Dispatch<SetStateAction<any>>
  setCasosList: Dispatch<SetStateAction<any[]>>
}

export function createExecutionCaseSelectionActions({
  viewMode,
  currentExecutionRun,
  loadCasoExecutionHistory,
  loadExecutionDetails,
  setStepResults,
  setSnapshotNotes,
  setGeneralExecutionStatus,
  setGeneralExecutionNote,
  setExecutionSnapshots,
  setCurrentExecutionCase,
  setCurrentExecutionRun,
  setExecutionMode,
  setSelectedTest,
  setCasosList
}: CreateExecutionCaseSelectionActionsParams) {
  const handleSelectTestForExecution = async (test: any) => {
    const activeRun = viewMode === 'manual_exec' ? currentExecutionRun : null

    // En una ejecución activa, conservar el caso visible hasta disponer de
    // todos los datos del nuevo caso. Si se limpian los estados antes de la
    // carga, la consola muestra brevemente SIN_CORRER y parece que la
    // ejecución anterior se perdió.
    if (activeRun?.id) {
      const history = await loadCasoExecutionHistory(test.id)
      const latestHistory = history[0]
      const hydratedTest = latestHistory
        ? {
            ...test,
            lastResult: latestHistory.status,
            lastExecutedAt: latestHistory.date,
            lastExecutedBy: latestHistory.executedBy,
            lastExecutedVersion: latestHistory.versionExecuted,
            history
          }
        : { ...test, lastResult: null, lastExecutedAt: null, lastExecutedBy: null, lastExecutedVersion: null, history }
      await loadExecutionDetails(activeRun.id, test.id)
      startTransition(() => {
        setSelectedTest(hydratedTest)
        setCasosList(prev => prev.map(c => c.id === test.id ? { ...c, ...hydratedTest } : c))
      })
      return
    }

    setSelectedTest(test)
    startTransition(() => {
      setStepResults({})
      setSnapshotNotes({})
      if (typeof setGeneralExecutionStatus === 'function') {
        setGeneralExecutionStatus('SIN_CORRER')
      }
      setGeneralExecutionNote('')
      setExecutionSnapshots([])
      setCurrentExecutionCase(null)
      setCurrentExecutionRun(null)
      setExecutionMode(null)
    })

    // Fuera de una ejecución activa, la selección no necesita esperar al
    // backend: el historial sólo enriquece el caso mostrado.
    const history = await loadCasoExecutionHistory(test.id)
    const latestHistory = history[0]
    const hydratedTest = latestHistory
      ? {
          ...test,
          lastResult: latestHistory.status,
          lastExecutedAt: latestHistory.date,
          lastExecutedBy: latestHistory.executedBy,
          lastExecutedVersion: latestHistory.versionExecuted,
          history
        }
      : { ...test, lastResult: null, lastExecutedAt: null, lastExecutedBy: null, lastExecutedVersion: null, history }
    startTransition(() => {
      setSelectedTest(hydratedTest)
      setCasosList(prev => prev.map(c => c.id === test.id ? { ...c, ...hydratedTest } : c))
    })
    if (activeRun?.id) {
      await loadExecutionDetails(activeRun.id, test.id)
    }
  }

  return {
    handleSelectTestForExecution
  }
}
