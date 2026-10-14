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
  const returnToExecutionList = async () => {
    if (params.executionDraftRef?.current.dirty) {
      if (!await saveExecutionProgress()) return
    }
    if (params.executionGuardRef) {
      params.executionGuardRef.current.selection++
      params.executionGuardRef.current.details++
    }
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

  const snapshotActions = createSnapshotActions({
    executionDraftRef: params.executionDraftRef,
    currentExecutionCase: params.currentExecutionCase,
    stepResults: params.stepResults,
    snapshotNotes: params.snapshotNotes,
    fetchWithAuth: params.fetchWithAuth,
    setExecutionSnapshots: params.setExecutionSnapshots,
    setSnapshotAttachments: params.setSnapshotAttachments,
    setStepResults: params.setStepResults,
    setSnapshotNotes: params.setSnapshotNotes,
    showFeedback: params.showFeedback,
    t: params.t,
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
      params.showFeedback(params.t('ejecutarPruebas.evidenceLinkFailed'), error.message || params.t('ejecutarPruebas.generalEvidenceAttachFailed'), 'danger')
    }
  }

  const handleRemoveGeneralExecutionAttachment = async (attachment: AttachmentMeta) => {
    const snapshot = params.generalExecutionSnapshot
    if (!snapshot?.id || !attachment?.id) return
    await snapshotActions.handleRemoveSnapshotAttachment(snapshot, attachment)
    params.setGeneralExecutionAttachments((prev: AttachmentMeta[]) => prev.filter(item => item.id !== attachment.id))
  }

  const saveExecutionProgress = async () => {
    if (!params.currentExecutionCase?.id || !params.executionDraftRef?.current.dirty) return true
    const version = params.executionDraftRef.current.version
    try {
      if (params.executionSnapshots.length) {
        const prefix: any[] = []
        for (const snapshot of params.executionSnapshots) {
          const status = params.stepResults[snapshot.numero_paso] || snapshot.estado_paso || 'SIN_CORRER'
          prefix.push({ ...snapshot, nextEstado: status, nextComentarios: params.snapshotNotes[snapshot.numero_paso] ?? snapshot.comentarios ?? '' })
          if (status === 'SIN_CORRER') break
        }
        await snapshotActions.persistExecutionSnapshots(prefix)
      } else {
        const snapshot = await ensureGeneralEvidenceSnapshot()
        const response = await params.fetchWithAuth(`${API_BASE}/ejecuciones/${params.currentExecutionCase.id}/snapshots/`, {
          method: 'PATCH', body: JSON.stringify({ snapshots: [{ id: snapshot.id, estado: params.generalExecutionStatus || 'SIN_CORRER', comentarios: params.generalExecutionNote || '' }] })
        })
        if (!response.ok) throw new Error(await response.text())
        const saved = (await response.json()).find((item: any) => item.id === snapshot.id)
        if (saved) params.setGeneralExecutionSnapshot(saved)
      }
      if (version !== params.executionDraftRef.current.version) return false
      params.executionDraftRef.current.dirty = false
      return true
    } catch (error: any) {
      params.showFeedback(params.t('ejecutarPruebas.progressSaveError'), error.message, 'danger')
      return false
    }
  }

  const { handleSelectTestForExecution } = createExecutionCaseSelectionActions({
    executionGuardRef: params.executionGuardRef,
    beforeSelect: params.viewMode === 'manual_exec' ? saveExecutionProgress : undefined,
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
    saveExecutionProgress,
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
