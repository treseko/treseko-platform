import type { Dispatch, SetStateAction } from 'react'
import { API_BASE } from '../../app/constants'
import { isValidUUID } from '../../app/validation'
import type { AttachmentMeta } from '../../EvidenceUpload'
import { formatDateTime } from '../../shared/utils/dateTime'
import type { TranslationKey } from '../../i18n'

type FeedbackVariant = 'success' | 'danger' | 'warning' | 'info'

type CreateManualExecutionActionsParams = {
  activeExecutionTests: any[]
  selectedTest: any
  currentExecutionRun: any
  currentExecutionCase: any
  currentBuildId: string
  buildCaseIds: Record<string, string[]>
  activeBuildCaseIds: string[]
  managingProjectId: string | null
  currentProjectId: string
  componentsList: any[]
  executionSnapshots: any[]
  stepResults: Record<number, string>
  snapshotNotes: Record<number, string>
  snapshotAttachments: Record<string, AttachmentMeta[]>
  attachmentConfig: any
  generalExecutionStatus: string
  generalExecutionNote: string
  generalExecutionSnapshot: any
  generalExecutionAttachments: AttachmentMeta[]
  redmineDecisionByExecution: Record<string, 'reported' | 'deferred'>
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  loadExecutionDetails: (runId: string, caseId: string) => Promise<any>
  loadCasoExecutionHistory: (caseId: string, buildId?: string) => Promise<any[]>
  loadCasosFromBackend: (projectId: string, knownComponents?: any[], options?: any) => Promise<void>
  loadBuildCases: (buildId: string) => Promise<string[]>
  loadBuildCaseExecutionStatus: (buildId: string, caseIds: string[]) => Promise<any>
  persistExecutionSnapshots: (snapshotsToSave: any[]) => Promise<any[]>
  getExecutionCompletionPlan: () => any
  getSnapshotStatus: (snapshot: any) => string
  returnToExecutionList: () => void
  setSelectedTest: Dispatch<SetStateAction<any>>
  setCasosList: Dispatch<SetStateAction<any[]>>
  setBuildCaseResultHistoryByBuild: Dispatch<SetStateAction<Record<string, Record<string, any[]>>>>
  setStepResults: Dispatch<SetStateAction<Record<number, string>>>
  setSnapshotNotes: Dispatch<SetStateAction<Record<number, string>>>
  setGeneralExecutionStatus: (status: string) => void
  setGeneralExecutionNote: (note: string) => void
  setExecutionSnapshots: Dispatch<SetStateAction<any[]>>
  setSnapshotAttachments: Dispatch<SetStateAction<Record<string, AttachmentMeta[]>>>
  setGeneralExecutionSnapshot: Dispatch<SetStateAction<any>>
  setGeneralExecutionAttachments: Dispatch<SetStateAction<AttachmentMeta[]>>
  setCurrentExecutionCase: Dispatch<SetStateAction<any>>
  setCurrentExecutionRun: Dispatch<SetStateAction<any>>
  setRedmineDecisionByExecution: Dispatch<SetStateAction<Record<string, 'reported' | 'deferred'>>>
  setShowRedminePrompt: (show: boolean) => void
  setShowRedmineDrawer: (show: boolean) => void
  setRedmineBugs: Dispatch<SetStateAction<any[]>>
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
  showFeedback: (title: string, message: string, variant?: FeedbackVariant) => void
}

export function createManualExecutionActions({
  activeExecutionTests,
  selectedTest,
  currentExecutionRun,
  currentExecutionCase,
  currentBuildId,
  buildCaseIds,
  activeBuildCaseIds,
  managingProjectId,
  currentProjectId,
  componentsList,
  executionSnapshots,
  snapshotNotes,
  snapshotAttachments,
  attachmentConfig,
  generalExecutionStatus,
  generalExecutionNote,
  generalExecutionSnapshot,
  generalExecutionAttachments,
  redmineDecisionByExecution,
  fetchWithAuth,
  loadExecutionDetails,
  loadCasoExecutionHistory,
  loadCasosFromBackend,
  loadBuildCases,
  loadBuildCaseExecutionStatus,
  persistExecutionSnapshots,
  getExecutionCompletionPlan,
  getSnapshotStatus,
  returnToExecutionList,
  setSelectedTest,
  setCasosList,
  setBuildCaseResultHistoryByBuild,
  setStepResults,
  setSnapshotNotes,
  setGeneralExecutionStatus,
  setGeneralExecutionNote,
  setExecutionSnapshots,
  setSnapshotAttachments,
  setGeneralExecutionSnapshot,
  setGeneralExecutionAttachments,
  setCurrentExecutionCase,
  setCurrentExecutionRun,
  setRedmineDecisionByExecution,
  setShowRedminePrompt,
  setShowRedmineDrawer,
  setRedmineBugs,
  t,
  showFeedback
}: CreateManualExecutionActionsParams) {
  const terminalExecutionStatuses = new Set(['PASO', 'FALLO', 'BLOQUEADO', 'ERROR', 'TIMEOUT'])
  const normalizeExecutionStatus = (status: unknown) => String(status || 'SIN_CORRER').toUpperCase()

  const markCurrentRunCaseAsCompleted = (caseId: string | undefined, status: string | undefined) => {
    if (!caseId || !status || typeof setCurrentExecutionRun !== 'function') return
    setCurrentExecutionRun((previous: any) => {
      if (!previous) return previous
      return {
        ...previous,
        execution_statuses_by_case_id: {
          ...(previous.execution_statuses_by_case_id || {}),
          [caseId]: status
        }
      }
    })
  }

  const isBatchCompleted = (completedCaseId?: string, completedStatus?: string) => {
    if (!currentExecutionRun?.id || activeExecutionTests.length === 0) return false
    const statuses = currentExecutionRun.execution_statuses_by_case_id || {}
    return activeExecutionTests.every(test => {
      const status = test.id === completedCaseId && completedStatus
        ? completedStatus
        : statuses[test.id]
      return terminalExecutionStatuses.has(normalizeExecutionStatus(status))
    })
  }

  const advanceToNextTest = async (completedCaseId?: string, completedStatus?: string) => {
    markCurrentRunCaseAsCompleted(completedCaseId, completedStatus)

    if (isBatchCompleted(completedCaseId, completedStatus)) {
      returnToExecutionList()
      showFeedback(t('ejecutarPruebas.manualBatchCompleted'), t('ejecutarPruebas.manualBatchCompletedMessage'), 'success')
      return
    }

    const currentIndex = activeExecutionTests.findIndex(t => t.id === selectedTest?.id)
    if (currentIndex !== -1 && currentIndex < activeExecutionTests.length - 1) {
      const nextTest = activeExecutionTests[currentIndex + 1]
      const historial = await loadCasoExecutionHistory(nextTest.id)
      const latestHistory = historial[0]
      const hydratedNextTest = latestHistory
        ? {
            ...nextTest,
            lastResult: latestHistory.status,
            lastExecutedAt: latestHistory.date,
            lastExecutedBy: latestHistory.executedBy,
            lastExecutedVersion: latestHistory.versionExecuted,
            history: historial
          }
        : { ...nextTest, lastResult: null, lastExecutedAt: null, lastExecutedBy: null, lastExecutedVersion: null, history: historial }

      // No limpiar el caso visible antes de cargar el siguiente. Durante ese
      // intervalo la consola pintaba SIN_CORRER aunque el caso anterior ya
      // estuviera finalizado. loadExecutionDetails deja listo el estado real
      // del siguiente caso y recién después cambiamos la selección visual.
      if (currentExecutionRun?.id) {
        await loadExecutionDetails(currentExecutionRun.id, nextTest.id)
      } else {
        setStepResults({})
        setSnapshotNotes({})
        setGeneralExecutionStatus('SIN_CORRER')
        setGeneralExecutionNote('')
        setExecutionSnapshots([])
        setSnapshotAttachments({})
        setGeneralExecutionSnapshot(null)
        setGeneralExecutionAttachments([])
        setCurrentExecutionCase(null)
      }
      setSelectedTest(hydratedNextTest)
      setCasosList(prev => prev.map(c => c.id === nextTest.id ? { ...c, ...hydratedNextTest } : c))
    } else {
      showFeedback(t('ejecutarPruebas.manualCaseCompleted'), t('ejecutarPruebas.manualCaseCompletedMessage'), 'info')
    }
  }

  const deferRedmineReportAndContinue = async () => {
    if (currentExecutionCase?.id) {
      setRedmineDecisionByExecution(prev => ({ ...prev, [currentExecutionCase.id]: 'deferred' }))
    }
    setShowRedminePrompt(false)
    setShowRedmineDrawer(false)
    showFeedback(t('ejecutarPruebas.internalBugReportPending'), t('ejecutarPruebas.internalBugReportPendingMessage'), 'info')
    await advanceToNextTest()
  }

  const openRedmineReportFromPrompt = () => {
    setShowRedminePrompt(false)
    setShowRedmineDrawer(true)
  }

  const finalizeExecutionResult = async (backendFinalStatus: string) => {
    const refreshedHistory = await loadCasoExecutionHistory(selectedTest.id, currentBuildId)
    const latestHistory = refreshedHistory[0]
    const executedAt = latestHistory?.date || formatDateTime(new Date().toISOString())
    const executedBy = latestHistory?.executedBy || selectedTest.lastExecutedBy || ''
    const executedVersion = latestHistory?.versionExecuted || currentExecutionCase?.version_ejecutada || selectedTest.version || null
    if (currentBuildId && isValidUUID(currentBuildId)) {
      setBuildCaseResultHistoryByBuild(prev => ({
        ...prev,
        [currentBuildId]: {
          ...(prev[currentBuildId] || {}),
          [selectedTest.id]: refreshedHistory
        }
      }))
    }
    setSelectedTest(prev => prev ? {
      ...prev,
      lastResult: backendFinalStatus,
      lastExecutedAt: executedAt,
      lastExecutedBy: executedBy,
      lastExecutedVersion: executedVersion,
      history: refreshedHistory
    } : prev)
    setCasosList(prev => prev.map(c => c.id === selectedTest.id ? {
      ...c,
      lastResult: backendFinalStatus,
      lastExecutedAt: executedAt,
      lastExecutedBy: executedBy,
      lastExecutedVersion: executedVersion,
      history: refreshedHistory
    } : c))
    const projectId = managingProjectId || currentProjectId
    if (projectId && isValidUUID(projectId)) {
      await loadCasosFromBackend(projectId, componentsList, { preserveExecutionState: true })
      if (currentBuildId && isValidUUID(currentBuildId)) {
        const reloadedBuildCaseIds = await loadBuildCases(currentBuildId)
        const ids = reloadedBuildCaseIds.length
          ? reloadedBuildCaseIds
          : buildCaseIds[currentBuildId]?.length
            ? buildCaseIds[currentBuildId]
            : activeBuildCaseIds
        await loadBuildCaseExecutionStatus(currentBuildId, ids)
      }
    }

    // Keep the current run map in sync before deciding whether the batch is
    // complete. This is especially important while a failure is waiting for
    // the user's Redmine decision.
    markCurrentRunCaseAsCompleted(selectedTest.id, backendFinalStatus)

    if (backendFinalStatus === 'FALLO' || backendFinalStatus === 'BLOQUEADO') {
      if (currentExecutionCase?.id && redmineDecisionByExecution[currentExecutionCase.id]) {
        showFeedback(t('ejecutarPruebas.executionCompleted'), t('ejecutarPruebas.executionCompletedWithBugDecision', { status: backendFinalStatus }), 'success')
        await advanceToNextTest(selectedTest.id, backendFinalStatus)
        return
      }
      setShowRedminePrompt(true)
    } else {
      showFeedback(t('ejecutarPruebas.executionCompleted'), t('ejecutarPruebas.executionCompletedMessage', { status: backendFinalStatus }), 'success')
      await advanceToNextTest(selectedTest.id, backendFinalStatus)
    }
  }

  const handleCompleteCase = async () => {
    if (!selectedTest || !currentExecutionCase) return
    const requireFailureDocumentation = attachmentConfig?.require_evidence_on_failure === true
    const isAutoBlockNote = (value?: string) =>
      String(value || '').trim().toLowerCase().startsWith('bloqueado autom')
    const hasUserDocumentationNote = (value?: string) => {
      const note = String(value || '').trim()
      return Boolean(note && !isAutoBlockNote(note))
    }
    const readApiError = async (response: Response) => {
      const text = await response.text()
      if (!text) return `Backend respondio ${response.status}`
      try {
        const parsed = JSON.parse(text)
        return parsed?.detail || text
      } catch {
        return text
      }
    }
    if (executionSnapshots.length === 0) {
      if (!generalExecutionStatus || generalExecutionStatus === 'SIN_CORRER') {
        showFeedback(t('ejecutarPruebas.verdictRequired'), t('ejecutarPruebas.verdictRequiredMessage'), 'warning')
        return
      }
      if (
        requireFailureDocumentation &&
        (generalExecutionStatus === 'FALLO' || generalExecutionStatus === 'BLOQUEADO') &&
        !generalExecutionNote.trim() &&
        generalExecutionAttachments.length === 0 &&
        !generalExecutionSnapshot?.evidencia_url
      ) {
        showFeedback(t('ejecutarPruebas.documentationRequired'), t('ejecutarPruebas.documentationRequiredMessage'), 'warning')
        return
      }
      try {
        const params = new URLSearchParams({ estado: generalExecutionStatus })
        if (generalExecutionNote.trim()) params.set('comentarios', generalExecutionNote.trim())
        const response = await fetchWithAuth(`${API_BASE}/ejecuciones/${currentExecutionCase.id}/?${params.toString()}`, { method: 'PATCH' })
        if (!response.ok) {
          const errorText = await readApiError(response)
          throw new Error(errorText || `Backend respondió ${response.status}`)
        }
        const savedExecution = await response.json()
        setCurrentExecutionCase(prev => prev ? { ...prev, ...savedExecution, estado_resultado: generalExecutionStatus } : savedExecution)
      } catch (error: any) {
        showFeedback(t('ejecutarPruebas.completionFailed'), error.message || t('ejecutarPruebas.saveExecutionError'), 'danger')
        return
      }
      await finalizeExecutionResult(generalExecutionStatus)
      return
    }

    const completionPlan = getExecutionCompletionPlan()
    if (!completionPlan.canComplete) {
      if (completionPlan.pendingBeforeConclusion) {
        showFeedback(t('ejecutarPruebas.incompleteExecution'), t('ejecutarPruebas.completePreviousSteps'), 'warning')
      } else {
        showFeedback(t('ejecutarPruebas.incompleteExecution'), t('ejecutarPruebas.completeAllSteps'), 'warning')
      }
      return
    }

    const backendFinalStatus = completionPlan.finalStatus
    const conclusiveSnapshot = completionPlan.firstConclusive?.snapshot
    const conclusiveStatus = completionPlan.firstConclusive?.status
    if (
      requireFailureDocumentation &&
      conclusiveSnapshot?.id &&
      (conclusiveStatus === 'FALLO' || conclusiveStatus === 'BLOQUEADO') &&
      !hasUserDocumentationNote(snapshotNotes[conclusiveSnapshot.numero_paso]) &&
      (snapshotAttachments[conclusiveSnapshot.id] || []).length === 0 &&
      !conclusiveSnapshot.evidencia_url
    ) {
      showFeedback(t('ejecutarPruebas.documentationRequired'), t('ejecutarPruebas.documentationRequiredMessage'), 'warning')
      return
    }

    try {
      const snapshotsToSave = executionSnapshots.map(snapshot => {
        const autoBlock = completionPlan.snapshotsToAutoBlock.some((item: any) => item.id === snapshot.id)
        const note = snapshotNotes[snapshot.numero_paso] || ''
        const autoBlockNote = completionPlan.firstConclusive
          ? `Bloqueado automáticamente por ${completionPlan.firstConclusive.status} en el paso ${completionPlan.firstConclusive.snapshot.numero_paso}.`
          : ''
        return {
          ...snapshot,
          nextEstado: autoBlock ? 'BLOQUEADO' : getSnapshotStatus(snapshot),
          nextComentarios: autoBlock && !note ? autoBlockNote : note
        }
      })
      await persistExecutionSnapshots(snapshotsToSave)
      const response = await fetchWithAuth(`${API_BASE}/ejecuciones/${currentExecutionCase.id}/?estado=${backendFinalStatus}`, { method: 'PATCH' })
      if (!response.ok) {
        const errorText = await readApiError(response)
        throw new Error(errorText || `Backend respondió ${response.status}`)
      }
      const savedExecution = await response.json()
      setCurrentExecutionCase(prev => prev ? { ...prev, ...savedExecution, estado_resultado: backendFinalStatus } : savedExecution)
    } catch (error: any) {
      showFeedback(t('ejecutarPruebas.completionFailed'), error.message || t('ejecutarPruebas.saveExecutionError'), 'danger')
      return
    }

    await finalizeExecutionResult(backendFinalStatus)
  }

  return {
    advanceToNextTest,
    deferRedmineReportAndContinue,
    openRedmineReportFromPrompt,
    handleCompleteCase,
  }
}
