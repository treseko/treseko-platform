import type { Dispatch, SetStateAction } from 'react'
import type { AttachmentMeta } from '../../EvidenceUpload'
import { API_BASE } from '../../app/constants'
import { isValidUUID } from '../../app/validation'
import { mergeCasesById } from '../casos/caseUtils'
import type { TranslationKey } from '../../i18n'
import { createIaLog as iaLog, type ExecutionMode, type FeedbackVariant } from './executionPresentation'
import { getExecutionStatusesByCaseId } from './executionRunStatus'
import { isBuildExecutable } from '../../app/buildState'
import { readBackendError } from '../../app/errorMessages'
import { executeApiSelection } from './apiExecutionActions'
import { resolveExecutionProjectId } from './executionProject'
type CreateExecutionActionsParams = {
  managingProjectId: string | null
  currentProjectId: string
  currentBuildId: string
  currentCompId: string
  selectedExecutionEnvironmentId: string
  selectedExecutionDatasetId: string
  executionDatasetPreview?: any
  buildsList: any[]
  buildCaseIds: Record<string, string[]>
  currentProjectCases: any[]
  selectedTest: any
  currentExecutionRun: any
  executionModalTests: any[]
  executionModalDiscardedCount: number
  canUseAutomatedExecution: boolean
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  mapBackendCasoToTest: (caso: any) => any
  isOutdatedExecutionCase: (test: any) => boolean
  getExecutionCaseLabel: (test: any) => string
  loadBuildCaseExecutionStatus: (buildId: string, caseIds: string[]) => Promise<any>
  setCasosList: Dispatch<SetStateAction<any[]>>
  setBuildCaseIds: Dispatch<SetStateAction<Record<string, string[]>>>
  setCurrentExecutionCase: Dispatch<SetStateAction<any>>
  setExecutionSnapshots: Dispatch<SetStateAction<any[]>>
  setSnapshotAttachments: Dispatch<SetStateAction<Record<string, AttachmentMeta[]>>>
  setGeneralExecutionSnapshot: Dispatch<SetStateAction<any>>
  setGeneralExecutionAttachments: Dispatch<SetStateAction<AttachmentMeta[]>>
  setStepResults: Dispatch<SetStateAction<Record<number, string>>>
  setSnapshotNotes: Dispatch<SetStateAction<Record<number, string>>>
  setGeneralExecutionStatus: (status: string) => void
  setGeneralExecutionNote: (note: string) => void
  setExecutionLoading: (loading: boolean) => void
  setCurrentExecutionRun: Dispatch<SetStateAction<any>>
  setExecutionMode: Dispatch<SetStateAction<ExecutionMode | null>>
  setSelectedTest: Dispatch<SetStateAction<any>>
  setActiveExecutionCaseIds: Dispatch<SetStateAction<string[]>>
  setExecutionModalCaseIds: Dispatch<SetStateAction<string[] | null>>
  setShowExecSelector: (show: boolean) => void
  setViewMode: Dispatch<SetStateAction<'list' | 'manual_exec' | 'chatbot_manual' | 'api_exec'>>
  setAutomationMonitor: Dispatch<SetStateAction<any>>
  setIaQueue: Dispatch<SetStateAction<string[]>>
  setIaExecutionStreams: Dispatch<SetStateAction<any[]>>
  setIaLogs: Dispatch<SetStateAction<any[]>>
  setActiveTab: (tab: string) => void
  openAutomationMonitor: (monitor: { run: any; jobs: any[] }) => void
  aiMaxParallelRuns?: number
  setProjectSyncMessage: (message: string) => void
  showFeedback: (title: string, message: string, variant?: FeedbackVariant) => void
  executionGuardRef?: { current: { details: number; selection: number; context: string } }
  executionDraftRef?: { current: { dirty: boolean; version: number } }
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
}
export function createExecutionActions({
  managingProjectId,
  currentProjectId,
  currentBuildId,
  currentCompId,
  selectedExecutionEnvironmentId,
  selectedExecutionDatasetId,
  executionDatasetPreview,
  buildsList,
  buildCaseIds,
  currentProjectCases,
  selectedTest,
  currentExecutionRun,
  executionModalTests,
  executionModalDiscardedCount,
  canUseAutomatedExecution,
  fetchWithAuth,
  mapBackendCasoToTest,
  isOutdatedExecutionCase,
  getExecutionCaseLabel,
  loadBuildCaseExecutionStatus,
  setCasosList,
  setBuildCaseIds,
  setCurrentExecutionCase,
  setExecutionSnapshots,
  setSnapshotAttachments,
  setGeneralExecutionSnapshot,
  setGeneralExecutionAttachments,
  setStepResults,
  setSnapshotNotes,
  setGeneralExecutionStatus,
  setGeneralExecutionNote,
  setExecutionLoading,
  setCurrentExecutionRun,
  setExecutionMode,
  setSelectedTest,
  setActiveExecutionCaseIds,
  setExecutionModalCaseIds,
  setShowExecSelector,
  setViewMode,
  setAutomationMonitor,
  setIaQueue,
  setIaExecutionStreams,
  setIaLogs,
  setActiveTab,
  openAutomationMonitor,
  aiMaxParallelRuns = 1,
  setProjectSyncMessage,
  showFeedback,
  t,
  executionGuardRef = { current: { details: 0, selection: 0, context: '' } },
  executionDraftRef,
}: CreateExecutionActionsParams) {
  const getLatestCaseForExecution = (test: any) =>
    currentProjectCases.find(item => item.id === test?.latestCaseId) || null
  const promoteOutdatedCasesForExecution = async (tests: any[]) => {
    if (!currentBuildId || !isValidUUID(currentBuildId)) {
      return { tests, assignedIds: undefined as string[] | undefined }
    }
    const outdatedTests = tests.filter(isOutdatedExecutionCase)
    if (outdatedTests.length === 0) {
      return { tests, assignedIds: buildCaseIds[currentBuildId] || [] }
    }

    let latestAssignedIds = buildCaseIds[currentBuildId] || []
    let promotedCases: any[] = []
    for (const test of outdatedTests) {
      const latestCase = getLatestCaseForExecution(test)
      if (!latestCase) {
        throw new Error(t('ejecutarPruebas.executionCaseVersionMissing', { version: test.latestVersion || '', case: getExecutionCaseLabel(test) }))
      }
      if (!latestAssignedIds.includes(latestCase.id)) {
        const response = await fetchWithAuth(`${API_BASE}/builds/${currentBuildId}/casos/promote-version/`, {
          method: 'POST',
          body: JSON.stringify({
            old_caso_id: test.id,
            new_caso_id: latestCase.id
          })
        })
        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.detail || t('configuracion.backendResponded', { status: response.status }))
        }
        const updatedBuildCases = await response.json()
        promotedCases = updatedBuildCases.map((item: any) => mapBackendCasoToTest(item))
        latestAssignedIds = updatedBuildCases.map((item: any) => item.id)
        setCasosList(prev => mergeCasesById(prev, promotedCases))
        setBuildCaseIds(prev => ({ ...prev, [currentBuildId]: latestAssignedIds }))
      }
    }
    await loadBuildCaseExecutionStatus(currentBuildId, latestAssignedIds)

    const executableTests = tests.map(test => {
      if (!isOutdatedExecutionCase(test)) return test
      return promotedCases.find(item => item.id === test.latestCaseId) || getLatestCaseForExecution(test) || test
    })
    return { tests: executableTests, assignedIds: latestAssignedIds }
  }
  const createExecutionRun = async (mode: ExecutionMode, tests: any[], assignedIdsOverride?: string[], executionOptions: any = {}) => {
    const projectId = resolveExecutionProjectId({ buildsList, currentBuildId, currentProjectId, managingProjectId })
    if (!projectId || !isValidUUID(projectId)) throw new Error(t('ejecutarPruebas.executionProjectInvalid'))
    if (tests.length === 0) throw new Error(t('ejecutarPruebas.executionNoCasesSelected'))
    const executionBuild = buildsList.find(build => build.id === currentBuildId)
    if (!executionBuild || !isValidUUID(executionBuild.id)) {
      throw new Error(t('ejecutarPruebas.executionSelectActiveBuild'))
    }
    if (!isBuildExecutable(executionBuild)) {
      throw new Error(t('ejecutarPruebas.executionBuildInactive'))
    }
    const assignedIds = assignedIdsOverride || buildCaseIds[executionBuild.id] || []
    if (assignedIds.length === 0) {
      throw new Error(t('ejecutarPruebas.executionBuildNoCases'))
    }
    if (currentCompId && executionBuild.componentId !== currentCompId) {
      throw new Error(t('ejecutarPruebas.executionBuildComponentMismatch'))
    }
    const invalidTest = tests.find(test => test.componentId && test.componentId !== executionBuild.componentId)
    if (invalidTest) {
      throw new Error(t('ejecutarPruebas.executionCaseComponentMismatch'))
    }
    if (tests.some(test => !assignedIds.includes(test.id))) {
      throw new Error(t('ejecutarPruebas.executionCaseNotAssigned'))
    }
    const response = await fetchWithAuth(`${API_BASE}${mode === 'manual' ? '/test-runs/' : '/execution-batches/'}`, {
      method: 'POST',
      body: JSON.stringify({
        proyecto_id: projectId,
        build_id: executionBuild.id,
        nombre: `${mode === 'manual' ? 'Run Manual' : mode === 'automated' ? 'Run Automatizado' : 'Run IA'} - ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
        origen: mode === 'manual' ? 'MANUAL' : mode === 'automated' ? 'AUTOMATIZADA_WORKER' : 'IA',
        entorno: 'QA',
        entorno_id: selectedExecutionEnvironmentId || null,
        dataset_id: selectedExecutionDatasetId || null,
        caso_ids: tests.map(test => test.id).filter(isValidUUID),
        ...(mode !== 'manual' ? { record_video: executionOptions.recordVideo !== false } : {})
      })
    })
    if (!response.ok) {
      throw new Error(await readBackendError(response, t('configuracion.backendResponded', { status: response.status })))
    }
    return response.json()
  }

  const loadExecutionDetails = async (runId: string, caseId: string, options: { isCurrent?: () => boolean; replaceDraft?: boolean } = {}) => {
    if (!options.replaceDraft && executionDraftRef?.current.dirty) return null
    const draftVersion = executionDraftRef?.current.version
    const generation = ++executionGuardRef.current.details
    const context = executionGuardRef.current.context
    const isCurrent = () => generation === executionGuardRef.current.details && context === executionGuardRef.current.context && (!options.isCurrent || options.isCurrent())
    const runDetailResponse = await fetchWithAuth(`${API_BASE}/test-runs/${runId}/detalle/`)
    const runDetail = runDetailResponse.ok ? await runDetailResponse.json().catch(() => null) : null
    const ejecucionesResponse = await fetchWithAuth(`${API_BASE}/test-runs/${runId}/ejecuciones/?limit=200`)
    if (!ejecucionesResponse.ok) throw new Error(t('configuracion.backendResponded', { status: ejecucionesResponse.status }))
    let ejecuciones = await ejecucionesResponse.json()
    let lastExecutionPageSize = ejecuciones.length
    for (let skip = lastExecutionPageSize; lastExecutionPageSize === 200; skip += 200) {
      const pageResponse = await fetchWithAuth(`${API_BASE}/test-runs/${runId}/ejecuciones/?skip=${skip}&limit=200`)
      if (!pageResponse.ok) throw new Error(t('configuracion.backendResponded', { status: pageResponse.status }))
      const page = await pageResponse.json()
      lastExecutionPageSize = page.length
      ejecuciones = [...ejecuciones, ...page]
    }
    const ejecucion = ejecuciones.find((item: any) => String(item.caso_id) === String(caseId))
    if (!ejecucion) throw new Error(t('ejecutarPruebas.executionNoAssociatedCases'))
    const snapshotsResponse = await fetchWithAuth(`${API_BASE}/ejecuciones/${ejecucion.id}/snapshots/`)
    if (!snapshotsResponse.ok) throw new Error(t('configuracion.backendResponded', { status: snapshotsResponse.status }))
    const snapshots = await snapshotsResponse.json()
    const stepSnapshots = snapshots.filter((snap: any) => Number(snap.numero_paso) > 0)
    const generalSnapshot = snapshots.find((snap: any) => Number(snap.numero_paso) === 0) || null
    const attachmentsResponse = await fetchWithAuth(`${API_BASE}/ejecuciones/${ejecucion.id}/snapshot-attachments/`)
    if (!attachmentsResponse.ok) throw new Error(t('ejecutarPruebas.executionEvidenceLoadFailed', { status: attachmentsResponse.status }))
    const attachmentLinksBySnapshot = await attachmentsResponse.json()
    const attachmentsBySnapshot = Object.fromEntries(
      snapshots.map((snap: any) => [snap.id, (attachmentLinksBySnapshot[String(snap.id)] || []).map((link: any) => link.attachment)])
    )
    if (!isCurrent() || (!options.replaceDraft && executionDraftRef && executionDraftRef.current.version !== draftVersion)) return null
    if (runDetail) {
      setCurrentExecutionRun((previous: any) => ({
        ...(previous || {}),
        dataset_nombre: runDetail.dataset?.nombre || previous?.dataset_nombre || null,
        dataset_name: runDetail.dataset?.nombre || previous?.dataset_name || null,
        entorno: runDetail.entorno?.nombre || previous?.entorno,
        datasets_resueltos: runDetail.datasets_resueltos || previous?.datasets_resueltos || {},
        variables_resueltas: runDetail.variables_resueltas || previous?.variables_resueltas || {},
      }))
    }
    setCurrentExecutionRun((previous: any) => ({ ...(previous || {}), execution_statuses_by_case_id: getExecutionStatusesByCaseId(ejecuciones) }))
    const isAutoBlockNote = (value?: string) =>
      String(value || '').trim().toLowerCase().startsWith('bloqueado autom')
    setCurrentExecutionCase(ejecucion)
    setExecutionSnapshots(stepSnapshots)
    setGeneralExecutionSnapshot(generalSnapshot)
    setSnapshotAttachments(attachmentsBySnapshot)
    setGeneralExecutionAttachments(generalSnapshot ? (attachmentsBySnapshot[generalSnapshot.id] || []) : [])
    setStepResults(Object.fromEntries(stepSnapshots.map((snap: any) => [snap.numero_paso, snap.estado_paso || 'SIN_CORRER'])))
    setSnapshotNotes(Object.fromEntries(stepSnapshots.map((snap: any) => [
      snap.numero_paso,
      isAutoBlockNote(snap.comentarios) ? '' : (snap.comentarios || '')
    ])))
    setGeneralExecutionStatus(ejecucion.estado_resultado && ejecucion.estado_resultado !== 'SIN_CORRER' ? ejecucion.estado_resultado : (generalSnapshot?.estado_paso || 'SIN_CORRER'))
    setGeneralExecutionNote(generalSnapshot?.comentarios || ejecucion.observaciones || '')
    return { ejecucion, snapshots: stepSnapshots, ejecuciones, generalSnapshot }
  }
  const handleStartExecution = async (mode: ExecutionMode, executionOptions: any = {}) => {
    const requestedTests = Array.isArray(executionOptions?.tests) ? executionOptions.tests.filter(Boolean) : []
    const tests = requestedTests.length > 0 ? requestedTests : (executionModalTests.length > 0 ? executionModalTests : (selectedTest ? [selectedTest] : []))
    const isApiSelection = Boolean(executionOptions?.forceApi) || (tests.length > 0 && tests.every(test => String(test?.format || test?.formato_prueba || '').toUpperCase() === 'API'))
    if (isApiSelection) return executeApiSelection({ mode, executeRequest: executionOptions?.executeRequest === true, executeNow: executionOptions?.executeNow === true, canUseAutomatedExecution, selectedExecutionEnvironmentId, executionEnvironmentId: executionOptions?.environmentId || currentExecutionRun?.apiExecutionResults?.environment_id, executionDatasetPreview: executionDatasetPreview || currentExecutionRun?.apiExecutionResults?.dataset_preview, executionRunId: executionOptions?.runId || currentExecutionRun?.apiExecutionResults?.run_id, executionTests: currentExecutionRun?.apiExecutionResults?.tests || tests, currentExecutionRun, selectedExecutionDatasetId, executionDatasetId: executionOptions?.datasetId || currentExecutionRun?.apiExecutionResults?.dataset_id, setExecutionLoading, managingProjectId, currentProjectId, currentBuildId, buildsList, fetchWithAuth, setCurrentExecutionRun, setSelectedTest, setExecutionMode, setExecutionModalCaseIds, setShowExecSelector, setActiveExecutionCaseIds, setViewMode, setAutomationMonitor, showFeedback, t }, tests)
    if (mode === 'automated' && !canUseAutomatedExecution) {
      showFeedback(
        t('ejecutarPruebas.manualPermissionRequired'),
        t('ejecutarPruebas.executionPermission'),
        'warning'
      )
      return
    }
    if (tests.length === 0) {
      const message = executionModalDiscardedCount > 0
        ? t('ejecutarPruebas.selectionDiscardedMessage')
        : t('ejecutarPruebas.selectionRequiredMessage')
      showFeedback(t('ejecutarPruebas.selectionRequired'), message, 'warning')
      return
    }
    setExecutionLoading(true)
    try {
      const { tests: executableTests, assignedIds } = await promoteOutdatedCasesForExecution(tests)
      const executionCaseIds = executableTests.map(test => test.id)
      const run = await createExecutionRun(mode, executableTests, assignedIds, executionOptions)
      setCurrentExecutionRun(run)
      setExecutionMode(mode)
      setSelectedTest(prev => prev?.id === executableTests[0].id ? prev : executableTests[0])
      const loaded = await loadExecutionDetails(run.id, executableTests[0].id, { replaceDraft: true })
      if (!loaded) return
      const { snapshots, ejecuciones } = loaded
      setActiveExecutionCaseIds(mode === 'manual' ? executionCaseIds : [])
      setExecutionModalCaseIds(null)
      setShowExecSelector(false)
      const isChatbotSelection = executableTests.length > 0 && executableTests.every(test =>
        String(test?.format || test?.formato_prueba || '').toUpperCase() === 'CONVERSACIONAL'
      )
      if (mode === 'manual') {
        if (snapshots.length === 0 && !isChatbotSelection) {
          showFeedback(t('ejecutarPruebas.caseWithoutSteps'), t('ejecutarPruebas.caseWithoutStepsMessage'), 'warning')
        }
        setViewMode(isChatbotSelection ? 'chatbot_manual' : 'manual_exec')
      } else if (mode === 'ia' || isChatbotSelection) {
        const chatbotAutomated = isChatbotSelection && mode === 'automated'
        const pendingStreams = ejecuciones.map((item: any) => {
          const test = executableTests.find(candidate => candidate.id === item.caso_id)
          return {
            executionId: item.id,
            caseId: item.caso_id,
            runId: run.id,
            caseCode: test?.code || test?.codigo || '',
            caseTitle: test?.title || test?.titulo || (chatbotAutomated ? t('ejecutarPruebas.iaChatbotCase') : t('ejecutarPruebas.iaCase')),
            runName: run.nombre,
            status: 'EN_ESPERA',
            lastMessage: chatbotAutomated ? t('ejecutarPruebas.iaChatbotWaiting') : t('ejecutarPruebas.iaWaiting'),
          }
        })
        setIaQueue(prev => [...new Set([...prev, ...executableTests.map(test => test.id)])])
        setIaExecutionStreams(prev => {
          const byId = new Map(prev.map(item => [item.executionId, item]))
          pendingStreams.forEach(item => byId.set(item.executionId, item))
          return Array.from(byId.values())
        })
        const maxParallelIa = Math.max(1, Math.min(5, Number(aiMaxParallelRuns || 1)))
        setIaLogs(prev => [
          ...prev,
          iaLog('run', t('ejecutarPruebas.iaQueueSummary', { run: run.nombre, kind: chatbotAutomated ? t('ejecutarPruebas.chatbotAutomatedStarted') : t('ejecutarPruebas.iaCase'), count: pendingStreams.length, max: maxParallelIa })),
          ...pendingStreams.map(item => iaLog('queue', t('ejecutarPruebas.iaWaitingTurn', { case: item.caseTitle }), { caseCode: item.caseCode, executionId: item.executionId }))
        ])

        showFeedback(
          mode === 'ia' ? t('ejecutarPruebas.aiExecutionStarted') : t('ejecutarPruebas.chatbotAutomatedStarted'),
          mode === 'ia' ? t('ejecutarPruebas.iaRunCreatedMessage', { run: run.nombre, count: tests.length }) : t('ejecutarPruebas.chatbotRunCreatedMessage', { run: run.nombre }),
          'success'
        )
        setActiveTab('motor_ia')
      } else {
        const jobs = (run.jobs || []).map((job: any) => {
          const test = executableTests.find(candidate => candidate.id === job.caseId)
          return { ...job, caseCode: test?.code, caseTitle: test?.title }
        })
        openAutomationMonitor({ run, jobs })
        const failedJobs = jobs.filter((job: any) => job.status === 'ERROR' || String(job.status).startsWith('BLOCKED'))
        if (failedJobs.length === jobs.length) {
          showFeedback(
            t('ejecutarPruebas.workerSubmitFailed'),
            failedJobs[0]?.error || t('ejecutarPruebas.workerRejectedAll'),
            'danger'
          )
          setProjectSyncMessage(t('ejecutarPruebas.workerSubmitMessage', { detail: failedJobs[0]?.error || t('ejecutarPruebas.workerRejectedJobs') }))
          return
        }
        if (failedJobs.length > 0) {
          showFeedback(
            t('ejecutarPruebas.automationPartial'),
            `${t('ejecutarPruebas.workerPartialJobs', { failed: failedJobs.length, total: jobs.length })} ${failedJobs[0]?.error || ''}`,
            'warning'
          )
        } else {
          showFeedback(
            t('ejecutarPruebas.automationSent'),
            t('ejecutarPruebas.workerQueueMessage', { run: run.nombre }),
            'success'
          )
        }
      }
      setProjectSyncMessage(t('ejecutarPruebas.executionCreatedMessage', { run: run.nombre }))
    } catch (error: any) {
      showFeedback(t('ejecutarPruebas.executionStartFailed'), error.message || t('ejecutarPruebas.executionCreateError'), 'danger')
      setProjectSyncMessage(t('ejecutarPruebas.executionStartMessage', { error: error.message || t('ejecutarPruebas.executionCreateError') }))
    } finally {
      setExecutionLoading(false)
    }
  }

  return {
    promoteOutdatedCasesForExecution,
    createExecutionRun,
    loadExecutionDetails,
    handleStartExecution
  }
}
