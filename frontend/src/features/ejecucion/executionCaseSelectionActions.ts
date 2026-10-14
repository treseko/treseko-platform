import { startTransition } from 'react'
import { hydrateExecutionHistory } from './executionHistoryState'
import type { Dispatch, SetStateAction } from 'react'

type CreateExecutionCaseSelectionActionsParams = {
  viewMode: 'list' | 'manual_exec' | 'chatbot_manual'
  currentExecutionRun: any
  loadCasoExecutionHistory: (caseId: string) => Promise<any[] & { total?: number; stats?: any }>
  loadExecutionDetails: (runId: string, caseId: string, options?: any) => Promise<any>
  beforeSelect?: () => Promise<boolean>
  executionGuardRef?: { current: { selection: number; context: string } }
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
  setCasosList,
  beforeSelect,
  executionGuardRef = { current: { selection: 0, context: '' } },
}: CreateExecutionCaseSelectionActionsParams) {
  const handleSelectTestForExecution = async (test: any) => {
    const generation = ++executionGuardRef.current.selection
    const context = executionGuardRef.current.context
    const isCurrent = () => generation === executionGuardRef.current.selection && context === executionGuardRef.current.context
    if (beforeSelect && !await beforeSelect()) return
    if (!isCurrent()) return
    const activeRun = (viewMode === 'manual_exec' || viewMode === 'chatbot_manual') ? currentExecutionRun : null

    // En una ejecución activa, conservar el caso visible hasta disponer de
    // todos los datos del nuevo caso. Si se limpian los estados antes de la
    // carga, la consola muestra brevemente SIN_CORRER y parece que la
    // ejecución anterior se perdió.
    if (activeRun?.id) {
      const history = await loadCasoExecutionHistory(test.id)
      const hydratedTest = hydrateExecutionHistory(test, history)
      if (!isCurrent()) return
      const loaded = await loadExecutionDetails(activeRun.id, test.id, { isCurrent })
      if (loaded === null) return
      if (!isCurrent()) return
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
    if (!isCurrent()) return
    const hydratedTest = hydrateExecutionHistory(test, history)
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
