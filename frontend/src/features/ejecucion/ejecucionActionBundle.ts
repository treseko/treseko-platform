import type { AttachmentMeta } from '../../EvidenceUpload'
import { API_BASE } from '../../app/constants'
import { createExecutionActions } from './executionActions'
import { createExecutionCaseSelectionActions } from './executionCaseSelectionActions'
import { createManualExecutionActions } from './manualExecutionActions'
import { createSnapshotActions } from './snapshotActions'
import {
  buildExecutionCompletionPlan,
  countExecutionReferences,
  getSnapshotReferencesByType,
  getSnapshotStatusValue,
} from './executionUtils'

export function createEjecucionActionBundle(params: any) {
  const returnToExecutionList = () => {
    params.setActiveExecutionCaseIds([])
    params.setGeneralExecutionSnapshot(null)
    params.setGeneralExecutionAttachments([])
    params.setViewMode('list')
  }

  const { loadExecutionDetails, handleStartExecution } = createExecutionActions({
    ...params,
    canUseAutomatedExecution: params.canUseAutomatedExecution,
    openAutomationMonitor: (monitor: any) => params.setAutomationMonitor({ show: true, run: monitor.run, jobs: monitor.jobs, mode: 'execution' }),
    aiMaxParallelRuns: Number(params.aiEngineConfig.max_parallel_ai_runs || 1),
  })

  const { handleSelectTestForExecution } = createExecutionCaseSelectionActions({
    viewMode: params.viewMode,
    currentExecutionRun: params.currentExecutionRun,
    loadCasoExecutionHistory: params.loadCasoExecutionHistory,
    loadExecutionDetails,
    setStepResults: params.setStepResults,
    setSnapshotNotes: params.setSnapshotNotes,
    setGeneralExecutionStatus: params.setGeneralExecutionStatus,
    setGeneralExecutionNote: params.setGeneralExecutionNote,
    setExecutionSnapshots: params.setExecutionSnapshots,
    setCurrentExecutionCase: params.setCurrentExecutionCase,
    setCurrentExecutionRun: params.setCurrentExecutionRun,
    setExecutionMode: params.setExecutionMode,
    setSelectedTest: params.setSelectedTest,
    setCasosList: params.setCasosList,
  })

  const snapshotActions = createSnapshotActions({
    currentExecutionCase: params.currentExecutionCase,
    stepResults: params.stepResults,
    snapshotNotes: params.snapshotNotes,
    fetchWithAuth: params.fetchWithAuth,
    setExecutionSnapshots: params.setExecutionSnapshots,
    setSnapshotAttachments: params.setSnapshotAttachments,
    setStepResults: params.setStepResults,
    setSnapshotNotes: params.setSnapshotNotes,
    showFeedback: params.showFeedback,
  })

  const ensureGeneralEvidenceSnapshot = async () => {
    if (params.generalExecutionSnapshot?.id) return params.generalExecutionSnapshot
    if (!params.currentExecutionCase?.id) throw new Error('No hay ejecucion activa para adjuntar evidencia')
    const response = await params.fetchWithAuth(`${API_BASE}/ejecuciones/${params.currentExecutionCase.id}/general-evidence-snapshot/`, { method: 'POST' })
    if (!response.ok) {
      const error = await response.json().catch(() => null)
      throw new Error(error?.detail || `Backend respondio ${response.status}`)
    }
    const snapshot = await response.json()
    params.setGeneralExecutionSnapshot(snapshot)
    return snapshot
  }

  const handleGeneralExecutionAttachmentUpload = async (attachment: AttachmentMeta) => {
    try {
      const snapshot = await ensureGeneralEvidenceSnapshot()
      const linked = await snapshotActions.handleSnapshotAttachmentUpload(snapshot, attachment)
      if (!linked) return
      params.setGeneralExecutionAttachments((prev: AttachmentMeta[]) =>
        prev.some(item => item.id === attachment.id) ? prev : [...prev, attachment]
      )
    } catch (error: any) {
      params.showFeedback('No se pudo vincular evidencia', error.message || 'Error al adjuntar evidencia general.', 'danger')
    }
  }

  const handleRemoveGeneralExecutionAttachment = async (attachment: AttachmentMeta) => {
    const snapshot = params.generalExecutionSnapshot
    if (!snapshot?.id || !attachment?.id) return
    await snapshotActions.handleRemoveSnapshotAttachment(snapshot, attachment)
    params.setGeneralExecutionAttachments((prev: AttachmentMeta[]) => prev.filter(item => item.id !== attachment.id))
  }

  const getSnapshotStatus = (snapshot: any) => getSnapshotStatusValue(snapshot, params.stepResults)
  const getSnapshotReferences = (snapshot: any, type: 'action' | 'expected') => getSnapshotReferencesByType(snapshot, type)
  const getExecutionReferenceCount = () => countExecutionReferences(params.executionSnapshots)
  const getExecutionCompletionPlan = () => buildExecutionCompletionPlan(params.executionSnapshots, params.stepResults)

  const manualActions = createManualExecutionActions({
    ...params,
    loadExecutionDetails,
    persistExecutionSnapshots: snapshotActions.persistExecutionSnapshots,
    getExecutionCompletionPlan,
    getSnapshotStatus,
    returnToExecutionList,
  })

  return {
    loadExecutionDetails,
    handleStartExecution,
    returnToExecutionList,
    handleSelectTestForExecution,
    ...snapshotActions,
    handleGeneralExecutionAttachmentUpload,
    handleRemoveGeneralExecutionAttachment,
    getSnapshotStatus,
    getSnapshotReferences,
    getExecutionReferenceCount,
    getExecutionCompletionPlan,
    ...manualActions,
  }
}
