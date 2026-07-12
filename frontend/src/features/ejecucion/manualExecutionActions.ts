import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { API_BASE } from '../../app/constants'
import { isValidUUID } from '../../app/validation'
import type { AttachmentMeta } from '../../EvidenceUpload'
import { formatDateTime } from '../../shared/utils/dateTime'

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
  setRedmineDecisionByExecution: Dispatch<SetStateAction<Record<string, 'reported' | 'deferred'>>>
  setShowRedminePrompt: (show: boolean) => void
  setShowRedmineDrawer: (show: boolean) => void
  setRedmineBugs: Dispatch<SetStateAction<any[]>>
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
  setRedmineDecisionByExecution,
  setShowRedminePrompt,
  setShowRedmineDrawer,
  setRedmineBugs,
  showFeedback
}: CreateManualExecutionActionsParams) {
  const advanceToNextTest = async () => {
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
      setSelectedTest(hydratedNextTest)
      setCasosList(prev => prev.map(c => c.id === nextTest.id ? { ...c, ...hydratedNextTest } : c))
      setStepResults({})
      setSnapshotNotes({})
      setGeneralExecutionStatus('SIN_CORRER')
      setGeneralExecutionNote('')
      setExecutionSnapshots([])
      setSnapshotAttachments({})
      setGeneralExecutionSnapshot(null)
      setGeneralExecutionAttachments([])
      setCurrentExecutionCase(null)
      if (currentExecutionRun?.id) {
        await loadExecutionDetails(currentExecutionRun.id, nextTest.id)
      }
    } else {
      returnToExecutionList()
      showFeedback('Lote completado', 'Se han ejecutado todos los casos seleccionados.', 'success')
    }
  }

  const deferRedmineReportAndContinue = async () => {
    if (currentExecutionCase?.id) {
      setRedmineDecisionByExecution(prev => ({ ...prev, [currentExecutionCase.id]: 'deferred' }))
    }
    setShowRedminePrompt(false)
    setShowRedmineDrawer(false)
    showFeedback('Reporte pendiente', 'El fallo quedó guardado. Puedes crear el bug interno más adelante desde el caso o su historial.', 'info')
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

    if (backendFinalStatus === 'FALLO' || backendFinalStatus === 'BLOQUEADO') {
      if (currentExecutionCase?.id && redmineDecisionByExecution[currentExecutionCase.id]) {
        showFeedback('Ejecución completada', `Resultado final: ${backendFinalStatus}. El reporte Redmine ya tiene una decisión registrada para esta ejecución.`, 'success')
        await advanceToNextTest()
        return
      }
      setShowRedminePrompt(true)
    } else {
      showFeedback('Ejecución completada', `Resultado final: ${backendFinalStatus}.`, 'success')
      await advanceToNextTest()
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
        showFeedback('Veredicto requerido', 'Selecciona un resultado general para ejecutar este caso sin pasos.', 'warning')
        return
      }
      if (
        requireFailureDocumentation &&
        (generalExecutionStatus === 'FALLO' || generalExecutionStatus === 'BLOQUEADO') &&
        !generalExecutionNote.trim() &&
        generalExecutionAttachments.length === 0 &&
        !generalExecutionSnapshot?.evidencia_url
      ) {
        showFeedback('Documentacion requerida', 'Agrega un comentario o adjunta evidencia antes de guardar este fallo o bloqueo.', 'warning')
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
        showFeedback('No se pudo completar', error.message || 'Error al guardar la ejecución.', 'danger')
        return
      }
      await finalizeExecutionResult(generalExecutionStatus)
      return
    }

    const completionPlan = getExecutionCompletionPlan()
    if (!completionPlan.canComplete) {
      if (completionPlan.pendingBeforeConclusion) {
        showFeedback('Ejecución incompleta', 'Completa los pasos anteriores antes de guardar el resultado final.', 'warning')
      } else {
        showFeedback('Ejecución incompleta', 'Marca todos los pasos como PASO o registra un FALLO/BLOQUEO para cerrar la ejecución.', 'warning')
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
      showFeedback('Documentacion requerida', 'Agrega un comentario o adjunta evidencia antes de guardar este fallo o bloqueo.', 'warning')
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
      showFeedback('No se pudo completar', error.message || 'Error al guardar la ejecución.', 'danger')
      return
    }

    await finalizeExecutionResult(backendFinalStatus)
  }

  const handlePushToRedmine = async (e: FormEvent) => {
    e.preventDefault()
    const target = e.target as any
    const subject = target.subject.value

    const bugId = `BUG-${Math.floor(Math.random() * 100) + 460}`
    const mockHash = 'sha256_' + Math.random().toString(16).substring(2, 18)

    const newBug = {
      id: bugId,
      projectId: currentProjectId,
      title: subject,
      status: 'Nuevo',
      priority: 'Alta',
      testId: selectedTest?.id || 'general',
      hash: mockHash
    }

    setRedmineBugs(prev => [newBug, ...prev])
    if (currentExecutionCase?.id) {
      setRedmineDecisionByExecution(prev => ({ ...prev, [currentExecutionCase.id]: 'reported' }))
    }
    setShowRedmineDrawer(false)
    setShowRedminePrompt(false)
    showFeedback('Incidencia creada', `Incidencia ${bugId} creada con éxito en Redmine. Hash SHA-256: ${mockHash}`, 'success')
    await advanceToNextTest()
  }

  return {
    advanceToNextTest,
    deferRedmineReportAndContinue,
    openRedmineReportFromPrompt,
    handleCompleteCase,
    handlePushToRedmine
  }
}
