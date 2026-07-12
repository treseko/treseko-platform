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
    setStepResults({})
    setSnapshotNotes({})
    setGeneralExecutionStatus('SIN_CORRER')
    setGeneralExecutionNote('')
    setExecutionSnapshots([])
    setCurrentExecutionCase(null)
    if (!activeRun) {
      setCurrentExecutionRun(null)
      setExecutionMode(null)
    }

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
    setSelectedTest(hydratedTest)
    setCasosList(prev => prev.map(c => c.id === test.id ? { ...c, ...hydratedTest } : c))
    if (activeRun?.id) {
      await loadExecutionDetails(activeRun.id, test.id)
    }
  }

  return {
    handleSelectTestForExecution
  }
}
