import type { Dispatch, SetStateAction } from 'react'
import type { AttachmentMeta } from '../../EvidenceUpload'
import { API_BASE } from '../../app/constants'
import { isValidUUID } from '../../app/validation'
import { mergeCasesById } from '../casos/caseUtils'

type ExecutionMode = 'manual' | 'automated' | 'ia'
type FeedbackVariant = 'success' | 'danger' | 'warning' | 'info'

const iaLog = (level: string, message: string, extra: Record<string, any> = {}) => ({
  ts: new Date().toISOString(),
  level,
  source: String(level).toUpperCase(),
  message,
  ...extra,
})

type CreateExecutionActionsParams = {
  managingProjectId: string | null
  currentProjectId: string
  currentBuildId: string
  currentCompId: string
  selectedExecutionEnvironmentId: string
  selectedExecutionDatasetId: string
  buildsList: any[]
  buildCaseIds: Record<string, string[]>
  currentProjectCases: any[]
  selectedTest: any
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
  setViewMode: Dispatch<SetStateAction<'list' | 'manual_exec'>>
  setIaQueue: Dispatch<SetStateAction<string[]>>
  setIaExecutionStreams: Dispatch<SetStateAction<any[]>>
  setIaLogs: Dispatch<SetStateAction<any[]>>
  setActiveTab: (tab: string) => void
  openAutomationMonitor: (monitor: { run: any; jobs: any[] }) => void
  automationDebugMode?: boolean
  aiMaxParallelRuns?: number
  setProjectSyncMessage: (message: string) => void
  showFeedback: (title: string, message: string, variant?: FeedbackVariant) => void
}

export function createExecutionActions({
  managingProjectId,
  currentProjectId,
  currentBuildId,
  currentCompId,
  selectedExecutionEnvironmentId,
  selectedExecutionDatasetId,
  buildsList,
  buildCaseIds,
  currentProjectCases,
  selectedTest,
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
  setIaQueue,
  setIaExecutionStreams,
  setIaLogs,
  setActiveTab,
  openAutomationMonitor,
  automationDebugMode = false,
  aiMaxParallelRuns = 1,
  setProjectSyncMessage,
  showFeedback
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
        throw new Error(`No se encontró la versión v${test.latestVersion || ''} de ${getExecutionCaseLabel(test)} para actualizar la build`)
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
          throw new Error(error?.detail || `Backend respondió ${response.status}`)
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

  const createExecutionRun = async (mode: ExecutionMode, tests: any[], assignedIdsOverride?: string[]) => {
    const projectId = managingProjectId || currentProjectId
    if (!projectId || !isValidUUID(projectId)) throw new Error('Proyecto no válido')
    if (tests.length === 0) throw new Error('No hay casos seleccionados para ejecutar')
    const executionBuild = buildsList.find(build => build.id === currentBuildId)
    if (!executionBuild || !isValidUUID(executionBuild.id)) {
      throw new Error('Selecciona una build activa para ejecutar pruebas')
    }
    if (!executionBuild.active) {
      throw new Error('La build seleccionada está inactiva. Activa una build del componente antes de ejecutar')
    }
    const assignedIds = assignedIdsOverride || buildCaseIds[executionBuild.id] || []
    if (assignedIds.length === 0) {
      throw new Error('La build no tiene casos asignados. Asigna casos desde Proyectos > Componentes y Builds')
    }
    if (currentCompId && executionBuild.componentId !== currentCompId) {
      throw new Error('La build seleccionada no pertenece al componente activo')
    }
    const invalidTest = tests.find(test => test.componentId && test.componentId !== executionBuild.componentId)
    if (invalidTest) {
      throw new Error('Solo puedes ejecutar casos del componente asociado a la build activa')
    }
    if (tests.some(test => !assignedIds.includes(test.id))) {
      throw new Error('Solo puedes ejecutar casos asignados a la build activa')
    }
    const response = await fetchWithAuth(`${API_BASE}/test-runs/`, {
      method: 'POST',
      body: JSON.stringify({
        proyecto_id: projectId,
        build_id: executionBuild.id,
        nombre: `${mode === 'manual' ? 'Run Manual' : mode === 'automated' ? 'Run Automatizado' : 'Run IA'} - ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
        origen: mode === 'manual' ? 'MANUAL' : mode === 'automated' ? 'AUTOMATIZADA_WORKER' : 'IA',
        entorno: 'QA',
        entorno_id: selectedExecutionEnvironmentId || null,
        dataset_id: selectedExecutionDatasetId || null,
        caso_ids: tests.map(test => test.id).filter(isValidUUID)
      })
    })
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(errorText || `Backend respondió ${response.status}`)
    }
    return response.json()
  }

  const loadExecutionDetails = async (runId: string, caseId: string) => {
    const ejecucionesResponse = await fetchWithAuth(`${API_BASE}/test-runs/${runId}/ejecuciones/?limit=200`)
    if (!ejecucionesResponse.ok) throw new Error(`Backend respondió ${ejecucionesResponse.status}`)
    let ejecuciones = await ejecucionesResponse.json()
    let lastExecutionPageSize = ejecuciones.length
    for (let skip = lastExecutionPageSize; lastExecutionPageSize === 200; skip += 200) {
      const pageResponse = await fetchWithAuth(`${API_BASE}/test-runs/${runId}/ejecuciones/?skip=${skip}&limit=200`)
      if (!pageResponse.ok) throw new Error(`Backend respondió ${pageResponse.status}`)
      const page = await pageResponse.json()
      lastExecutionPageSize = page.length
      ejecuciones = [...ejecuciones, ...page]
    }
    const ejecucion = ejecuciones.find((item: any) => item.caso_id === caseId) || ejecuciones[0]
    if (!ejecucion) throw new Error('La ejecución no tiene casos asociados')
    const snapshotsResponse = await fetchWithAuth(`${API_BASE}/ejecuciones/${ejecucion.id}/snapshots/`)
    if (!snapshotsResponse.ok) throw new Error(`Backend respondió ${snapshotsResponse.status}`)
    const snapshots = await snapshotsResponse.json()
    const stepSnapshots = snapshots.filter((snap: any) => Number(snap.numero_paso) > 0)
    const generalSnapshot = snapshots.find((snap: any) => Number(snap.numero_paso) === 0) || null
    const snapshotAttachmentEntries = await Promise.all(snapshots.map(async (snap: any) => {
      try {
        const attachmentsResponse = await fetchWithAuth(`${API_BASE}/snapshots/${snap.id}/attachments/`)
        if (!attachmentsResponse.ok) return [snap.id, []]
        const links = await attachmentsResponse.json()
        return [snap.id, links.map((link: any) => link.attachment)]
      } catch {
        return [snap.id, []]
      }
    }))
    const attachmentsBySnapshot = Object.fromEntries(snapshotAttachmentEntries)
    const isFreshExecution = !ejecucion.estado_resultado || ejecucion.estado_resultado === 'SIN_CORRER'
    const isAutoBlockNote = (value?: string) =>
      String(value || '').trim().toLowerCase().startsWith('bloqueado autom')
    setCurrentExecutionCase(ejecucion)
    setExecutionSnapshots(stepSnapshots)
    setGeneralExecutionSnapshot(generalSnapshot)
    setSnapshotAttachments(attachmentsBySnapshot)
    setGeneralExecutionAttachments(generalSnapshot ? (attachmentsBySnapshot[generalSnapshot.id] || []) : [])
    setStepResults(Object.fromEntries(stepSnapshots.map((snap: any) => [snap.numero_paso, isFreshExecution ? 'SIN_CORRER' : snap.estado_paso])))
    setSnapshotNotes(Object.fromEntries(stepSnapshots.map((snap: any) => [
      snap.numero_paso,
      isFreshExecution || isAutoBlockNote(snap.comentarios) ? '' : (snap.comentarios || '')
    ])))
    setGeneralExecutionStatus(ejecucion.estado_resultado && ejecucion.estado_resultado !== 'SIN_CORRER' ? ejecucion.estado_resultado : 'SIN_CORRER')
    setGeneralExecutionNote(ejecucion.observaciones || '')
    return { ejecucion, snapshots: stepSnapshots, ejecuciones, generalSnapshot }
  }

  const waitForIaExecutionToFinish = async (runId: string, executionId: string, timeoutMs = 20 * 60 * 1000) => {
    const startedAt = Date.now()
    let delayMs = 2000
    const finalStatuses = new Set(['PASO', 'FALLO', 'BLOQUEADO', 'ERROR', 'TIMEOUT'])
    while (Date.now() - startedAt < timeoutMs) {
      const jitterMs = Math.floor(Math.random() * 500)
      await new Promise(resolve => window.setTimeout(resolve, delayMs + jitterMs))
      const response = await fetchWithAuth(`${API_BASE}/test-runs/${runId}/ejecuciones/?limit=200`)
      delayMs = Math.min(Math.round(delayMs * (response.ok ? 1.25 : 1.6)), 15000)
      if (!response.ok) continue
      let ejecuciones = await response.json()
      let lastExecutionPageSize = ejecuciones.length
      for (let skip = lastExecutionPageSize; lastExecutionPageSize === 200; skip += 200) {
        const pageResponse = await fetchWithAuth(`${API_BASE}/test-runs/${runId}/ejecuciones/?skip=${skip}&limit=200`)
        if (!pageResponse.ok) break
        const page = await pageResponse.json()
        lastExecutionPageSize = page.length
        ejecuciones = [...ejecuciones, ...page]
      }
      const current = ejecuciones.find((item: any) => item.id === executionId)
      if (!current || finalStatuses.has(String(current.estado_resultado || '').toUpperCase())) {
        return current
      }
    }
    return null
  }

  const handleStartExecution = async (mode: ExecutionMode) => {
    if (mode === 'automated' && !canUseAutomatedExecution) {
      showFeedback(
        'Permiso requerido',
        'Necesitas permiso de ejecucion y acceso a automatizacion para enviar pruebas a workers.',
        'warning'
      )
      return
    }
    const tests = executionModalTests.length > 0
      ? executionModalTests
      : (selectedTest ? [selectedTest] : [])
    if (tests.length === 0) {
      const message = executionModalDiscardedCount > 0
        ? 'Los casos seleccionados no pertenecen al componente/build activos o no están asignados a la build.'
        : 'Selecciona al menos un caso de prueba para ejecutar.'
      showFeedback('Selección requerida', message, 'warning')
      return
    }
    setExecutionLoading(true)
    try {
      const { tests: executableTests, assignedIds } = await promoteOutdatedCasesForExecution(tests)
      const executionCaseIds = executableTests.map(test => test.id)
      const run = await createExecutionRun(mode, executableTests, assignedIds)
      setCurrentExecutionRun(run)
      setExecutionMode(mode)
      setSelectedTest(prev => prev?.id === executableTests[0].id ? prev : executableTests[0])
      const { snapshots, ejecuciones } = await loadExecutionDetails(run.id, executableTests[0].id)
      setActiveExecutionCaseIds(mode === 'manual' ? executionCaseIds : [])
      setExecutionModalCaseIds(null)
      setShowExecSelector(false)
      if (mode === 'manual') {
        if (snapshots.length === 0) {
          showFeedback('Caso sin pasos', 'El caso fue congelado para ejecución, pero aún no tiene pasos definidos.', 'warning')
        }
        setViewMode('manual_exec')
      } else if (mode === 'ia') {
        const pendingStreams = ejecuciones.map((item: any) => {
          const test = executableTests.find(candidate => candidate.id === item.caso_id)
          return {
            executionId: item.id,
            caseId: item.caso_id,
            caseCode: test?.code || test?.codigo || '',
            caseTitle: test?.title || test?.titulo || 'Caso IA',
            runName: run.nombre,
            status: 'EN_ESPERA',
            lastMessage: 'Esperando turno para ejecutar IA.',
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
          iaLog('run', `${run.nombre} en cola IA con ${pendingStreams.length} caso(s). Max paralelo: ${maxParallelIa}.`),
          ...pendingStreams.map(item => iaLog('queue', `${item.caseTitle}: esperando turno`, { caseCode: item.caseCode, executionId: item.executionId }))
        ])

        const iaResults: any[] = []
        let queueIndex = 0
        const runNextIaExecution = async () => {
          while (queueIndex < ejecuciones.length) {
            const item = ejecuciones[queueIndex++]
          const test = executableTests.find(candidate => candidate.id === item.caso_id)
          setIaExecutionStreams(prev => prev.map(stream => stream.executionId === item.id
            ? { ...stream, status: 'EN_EJECUCION', startedAt: new Date().toISOString(), lastMessage: 'Ejecutando IA.' }
            : stream
          ))
          setIaLogs(prev => [...prev, iaLog('run', `${test?.code || test?.codigo || 'Caso IA'} inicia ejecucion IA.`, { caseCode: test?.code || test?.codigo, executionId: item.id })])
          try {
            const response = await fetchWithAuth(`${API_BASE}/ejecuciones/${item.id}/automatizar/`, { method: 'POST' })
            const payload = await response.json().catch(async () => ({ detail: await response.text().catch(() => '') }))
            const result = {
              ok: response.ok,
              executionId: item.id,
              caseId: item.caso_id,
              caseCode: test?.code || test?.codigo,
              caseTitle: test?.title || test?.titulo || 'Caso IA',
              message: payload?.detail || payload?.message || `Backend respondio ${response.status}`
            }
            iaResults.push(result)
            if (response.ok) {
              const finished = await waitForIaExecutionToFinish(run.id, item.id)
              if (finished?.estado_resultado) {
                setIaExecutionStreams(prev => prev.map(stream => stream.executionId === item.id
                  ? {
                      ...stream,
                      status: finished.estado_resultado === 'PASO' ? 'PASO' : finished.estado_resultado,
                      endedAt: new Date().toISOString(),
                      lastMessage: finished.observaciones || `Finalizo con estado ${finished.estado_resultado}.`,
                    }
                  : stream
                ))
              }
            }
          } catch (error: any) {
            iaResults.push({
              ok: false,
              executionId: item.id,
              caseId: item.caso_id,
              caseCode: test?.code || test?.codigo,
              caseTitle: test?.title || test?.titulo || 'Caso IA',
              message: error?.message || 'No se pudo iniciar IA'
            })
          }
        }
        }
        await Promise.all(Array.from({ length: Math.min(maxParallelIa, ejecuciones.length) }, () => runNextIaExecution()))
        const failedIa = iaResults.filter(result => !result.ok)
        const startedIa = iaResults.filter(result => result.ok)
        if (failedIa.length > 0) {
          const firstError = failedIa[0]
          const message = failedIa.length === iaResults.length
            ? firstError.message
            : `${failedIa.length}/${iaResults.length} casos no iniciaron. ${firstError.caseCode ? `${firstError.caseCode}: ` : ''}${firstError.message}`
          showFeedback(startedIa.length === 0 ? 'IA no pudo iniciar' : 'IA iniciada parcialmente', message, startedIa.length === 0 ? 'danger' : 'warning')
          setProjectSyncMessage(`${startedIa.length === 0 ? 'IA no pudo iniciar' : 'IA iniciada parcialmente'}: ${message}`)
          setIaLogs(prev => [
            ...prev,
            iaLog('error', `${startedIa.length === 0 ? 'IA no pudo iniciar' : 'IA iniciada parcialmente'}: ${message}`),
            ...failedIa.map(result => iaLog('error', `${result.caseTitle}: ${result.message}`, { caseCode: result.caseCode, executionId: result.executionId }))
          ])
          setActiveTab('motor_ia')
          await loadExecutionDetails(run.id, executableTests[0].id).catch(() => null)
          if (startedIa.length === 0) return
        }
        if (startedIa.length > 0) {
          setIaLogs(prev => [
            ...prev,
            iaLog('run', `${run.nombre} proceso IA secuencial completo para ${startedIa.length} caso(s) iniciado(s).`)
          ])
        }
        if (failedIa.length > 0) {
          setIaLogs(prev => [
            ...prev,
            ...failedIa.map(result => iaLog('error', `${result.caseTitle}: ${result.message}`, { caseCode: result.caseCode, executionId: result.executionId }))
          ])
        }
        if (failedIa.length === 0) {
        showFeedback(
          mode === 'ia' ? 'Ejecución IA iniciada' : 'Job automatizado creado',
          mode === 'ia'
            ? `Se creó ${run.nombre} con ${tests.length} caso(s) y snapshots congelados.`
            : `Se envió ${run.nombre} a la cola del worker dedicado.`,
          'success'
        )
        }
        setActiveTab('motor_ia')
      } else {
        const jobs = await Promise.all(ejecuciones.map(async (item: any) => {
          const test = executableTests.find(candidate => candidate.id === item.caso_id)
          const baseJob = {
            executionId: item.id,
            caseId: item.caso_id,
            caseCode: test?.code,
            caseTitle: test?.title
          }
          try {
            const response = await fetchWithAuth(`${API_BASE}/ejecuciones/${item.id}/automatizar/`, {
              method: 'POST',
              body: JSON.stringify({ debug_mode: Boolean(automationDebugMode) })
            })
            const payload = await response.json().catch(() => null)
            if (!response.ok) {
              return {
                ...baseJob,
                status: 'ERROR',
                error: payload?.detail || `Backend respondio ${response.status}`
              }
            }
            return {
              ...baseJob,
              jobId: payload?.job_id,
              status: payload?.status || 'PENDING'
            }
          } catch (error: any) {
            return {
              ...baseJob,
              status: 'ERROR',
              error: error?.message || 'No se pudo crear el job automatizado'
            }
          }
        }))
        openAutomationMonitor({ run, jobs })
        const failedJobs = jobs.filter((job: any) => job.status === 'ERROR')
        if (failedJobs.length === jobs.length) {
          showFeedback(
            'No se pudo enviar al worker',
            failedJobs[0]?.error || 'La cola de automatizacion rechazo todos los jobs.',
            'danger'
          )
          setProjectSyncMessage(`No se pudo enviar al worker: ${failedJobs[0]?.error || 'jobs rechazados'}`)
          return
        }
        if (failedJobs.length > 0) {
          showFeedback(
            'Automatizacion enviada parcialmente',
            `${failedJobs.length}/${jobs.length} job(s) no se pudieron crear. ${failedJobs[0]?.error || ''}`,
            'warning'
          )
        } else {
          showFeedback(
            'Ejecucion automatizada enviada al worker',
            `Se envio ${run.nombre} a la cola del worker dedicado.`,
            'success'
          )
        }
      }
      setProjectSyncMessage(`Ejecución creada: ${run.nombre}`)
    } catch (error: any) {
      showFeedback('No se pudo iniciar ejecución', error.message || 'Error al crear la ejecución.', 'danger')
      setProjectSyncMessage(`No se pudo iniciar ejecución: ${error.message}`)
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
