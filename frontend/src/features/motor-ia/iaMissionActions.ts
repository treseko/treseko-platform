import type { Dispatch, SetStateAction } from 'react'
import { API_BASE } from '../../app/constants'
import { isValidUUID } from '../../app/validation'
import { fromDateTimeLocalInput, formatDateTime } from '../../shared/utils/dateTime'

type FeedbackVariant = 'success' | 'danger' | 'warning' | 'info'

const iaLog = (level: string, message: string, extra: Record<string, any> = {}) => ({
  ts: new Date().toISOString(),
  level,
  source: String(level).toUpperCase(),
  message,
  ...extra,
})

type CreateIaMissionActionsParams = {
  projectsSource: 'local' | 'backend'
  currentProjectId: string
  currentBuildId: string
  buildsList: any[]
  currentProjectCases: any[]
  selectedTestsForIa: string[]
  execName: string
  scheduledTime: string
  aiMaxParallelRuns?: number
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  setProjectSyncMessage: (message: string) => void
  setIaQueue: Dispatch<SetStateAction<string[]>>
  setIaExecutionStreams: Dispatch<SetStateAction<any[]>>
  setIaLogs: Dispatch<SetStateAction<any[]>>
  setShowIaScheduler: (show: boolean) => void
  setActiveTab: (tab: string) => void
  showFeedback: (title: string, message: string, variant?: FeedbackVariant) => void
  navigateToMotorIaOnLaunch?: boolean
  onAfterLaunch?: () => void
}

export function createIaMissionActions({
  projectsSource,
  currentProjectId,
  currentBuildId,
  buildsList,
  currentProjectCases,
  selectedTestsForIa,
  execName,
  scheduledTime,
  aiMaxParallelRuns = 1,
  fetchWithAuth,
  setProjectSyncMessage,
  setIaQueue,
  setIaExecutionStreams,
  setIaLogs,
  setShowIaScheduler,
  setActiveTab,
  showFeedback,
  navigateToMotorIaOnLaunch = true,
  onAfterLaunch
}: CreateIaMissionActionsParams) {
  const waitForIaExecutionToFinish = async (runId: string, executionId: string, timeoutMs = 20 * 60 * 1000) => {
    const startedAt = Date.now()
    const finalStatuses = new Set(['PASO', 'FALLO', 'BLOQUEADO', 'ERROR', 'TIMEOUT'])
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise(resolve => window.setTimeout(resolve, 2000))
      const response = await fetchWithAuth(`${API_BASE}/test-runs/${runId}/ejecuciones/?limit=200`)
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

  const handleLaunchIaMission = async (mode: 'now' | 'scheduled' = 'now') => {
    if (selectedTestsForIa.length === 0) return
    const scheduledIso = fromDateTimeLocalInput(scheduledTime)
    if (mode === 'scheduled' && !scheduledIso) {
      showFeedback('Horario requerido', 'Selecciona fecha y hora para programar la misión IA.', 'warning')
      return
    }
    if (mode === 'scheduled' && scheduledIso) {
      const delayMs = new Date(scheduledIso).getTime() - Date.now()
      if (delayMs > 1000) {
        window.setTimeout(() => {
          handleLaunchIaMission('now')
        }, delayMs)
        setIaQueue(prev => [...new Set([...prev, ...selectedTestsForIa])])
        setShowIaScheduler(false)
        showFeedback(
          'Misión programada',
          `Misión "${execName}" programada para ${formatDateTime(scheduledIso)}. Se ejecutará si esta sesión sigue abierta.`,
          'success'
        )
        if (navigateToMotorIaOnLaunch) setActiveTab('motor_ia')
        onAfterLaunch?.()
        return
      }
    }

    if (projectsSource === 'backend' && isValidUUID(currentProjectId)) {
      try {
        const executionBuild = buildsList.find(build => build.id === currentBuildId)
        if (!executionBuild || !isValidUUID(executionBuild.id) || !executionBuild.active) {
          throw new Error('Selecciona una build activa para lanzar la ejecución IA')
        }
        const selectedIaTests = currentProjectCases.filter(test => selectedTestsForIa.includes(test.id))
        if (selectedIaTests.some(test => test.componentId && test.componentId !== executionBuild.componentId)) {
          throw new Error('La ejecución IA solo puede incluir casos del componente de la build activa')
        }
        setIaQueue(prev => [...new Set([...prev, ...selectedTestsForIa])])
        const response = await fetchWithAuth(`${API_BASE}/test-runs/`, {
          method: 'POST',
          body: JSON.stringify({
            proyecto_id: currentProjectId,
            build_id: executionBuild.id,
            nombre: execName || `Run IA - ${new Date().toISOString().slice(0, 10)}`,
            origen: 'IA',
            entorno: 'Staging (QA)',
            caso_ids: selectedTestsForIa.filter(isValidUUID)
          })
        })
        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(errorText || `Backend respondió ${response.status}`)
        }
        const run = await response.json()
        const ejecucionesResponse = await fetchWithAuth(`${API_BASE}/test-runs/${run.id}/ejecuciones/?limit=200`)
        if (ejecucionesResponse.ok) {
          let ejecuciones = await ejecucionesResponse.json()
          let lastExecutionPageSize = ejecuciones.length
          for (let skip = lastExecutionPageSize; lastExecutionPageSize === 200; skip += 200) {
            const pageResponse = await fetchWithAuth(`${API_BASE}/test-runs/${run.id}/ejecuciones/?skip=${skip}&limit=200`)
            if (!pageResponse.ok) break
            const page = await pageResponse.json()
            lastExecutionPageSize = page.length
            ejecuciones = [...ejecuciones, ...page]
          }
          const queuedStreams = ejecuciones.map((item: any) => {
            const test = selectedIaTests.find(candidate => candidate.id === item.caso_id)
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
          if (queuedStreams.length > 0) {
            setIaExecutionStreams(prev => {
              const byId = new Map(prev.map(item => [item.executionId, item]))
              queuedStreams.forEach(item => byId.set(item.executionId, item))
              return Array.from(byId.values())
            })
          }
          const maxParallelIa = Math.max(1, Math.min(5, Number(aiMaxParallelRuns || 1)))
          setIaLogs(prev => [
            ...prev,
            iaLog('run', `${run.nombre} en cola IA con ${queuedStreams.length} caso(s). Max paralelo: ${maxParallelIa}.`),
            ...queuedStreams.map(item => iaLog('queue', `${item.caseTitle}: esperando turno`, { caseCode: item.caseCode, executionId: item.executionId })),
          ])
          setProjectSyncMessage(`Ejecución ${run.nombre} creada para la build activa con ${selectedTestsForIa.length} casos.`)
          setShowIaScheduler(false)
          showFeedback('Ejecución IA iniciada', `Se iniciaron ${selectedTestsForIa.length} prueba(s) con IA ahora. Build: ${executionBuild.name || 'Sin build'}.`, 'success')
          if (navigateToMotorIaOnLaunch) setActiveTab('motor_ia')
          onAfterLaunch?.()

          const started: any[] = []
          let queueIndex = 0
          const runNextIaExecution = async () => {
            while (queueIndex < ejecuciones.length) {
              const item = ejecuciones[queueIndex++]
            const test = selectedIaTests.find(candidate => candidate.id === item.caso_id)
            setIaExecutionStreams(prev => prev.map(stream => stream.executionId === item.id
              ? { ...stream, status: 'EN_EJECUCION', startedAt: new Date().toISOString(), lastMessage: 'Ejecutando IA.' }
              : stream
            ))
            setIaLogs(prev => [...prev, iaLog('run', `${test?.code || test?.codigo || 'Caso IA'} inicia ejecucion IA.`, { caseCode: test?.code || test?.codigo, executionId: item.id })])
            const response = await fetchWithAuth(`${API_BASE}/ejecuciones/${item.id}/automatizar/`, { method: 'POST' })
            const payload = await response.json().catch(() => null)
            const result = {
              ok: response.ok,
              executionId: item.id,
              caseId: item.caso_id,
              caseCode: test?.code || test?.codigo || '',
              caseTitle: test?.title || test?.titulo || 'Caso IA',
              error: payload?.detail || `Backend respondio ${response.status}`,
            }
            started.push(result)
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
          }
          }
          Promise.all(Array.from({ length: Math.min(maxParallelIa, ejecuciones.length) }, () => runNextIaExecution()))
            .then(() => {
              setIaLogs(prev => [
                ...prev,
                iaLog('run', `${run.nombre} proceso IA secuencial completo para ${started.filter(item => item.ok).length}/${started.length} caso(s).`),
                ...started.filter(item => !item.ok).map(item => iaLog('error', `${item.caseTitle}: ${item.error}`, { caseCode: item.caseCode, executionId: item.executionId }))
              ])
              if (started.filter(item => item.ok).length === 0 && started.length > 0) {
                showFeedback('IA no pudo iniciar', started.find(item => !item.ok)?.error || 'No se pudo iniciar ningun caso IA', 'danger')
              }
            })
            .catch((error: any) => {
              const message = error?.message || 'No se pudo completar el lanzamiento IA'
              setProjectSyncMessage(`Error durante la ejecucion IA: ${message}`)
              setIaLogs(prev => [...prev, iaLog('error', `Error durante IA: ${message}`)])
              showFeedback('IA con error', message, 'danger')
            })
          return
        }
        setProjectSyncMessage(`Ejecución ${run.nombre} creada para la build activa con ${selectedTestsForIa.length} casos.`)
      } catch (error: any) {
        const message = error?.message || 'No se pudo iniciar la ejecucion IA'
        setProjectSyncMessage(`No se pudo crear la ejecución de build: ${message}`)
        setIaLogs(prev => [...prev, iaLog('error', `No se pudo iniciar IA: ${message}`)])
        setShowIaScheduler(false)
        if (navigateToMotorIaOnLaunch) setActiveTab('motor_ia')
        onAfterLaunch?.()
        showFeedback('IA no pudo iniciar', message, 'danger')
        return
      }
    }

    setIaQueue(prev => [...new Set([...prev, ...selectedTestsForIa])])
    setShowIaScheduler(false)
    showFeedback('Ejecución IA iniciada', `Se iniciaron ${selectedTestsForIa.length} prueba(s) con IA ahora. Build: ${buildsList.find(build => build.id === currentBuildId)?.name || 'Sin build'}.`, 'success')
    if (navigateToMotorIaOnLaunch) setActiveTab('motor_ia')
    onAfterLaunch?.()
  }

  return {
    handleLaunchIaMission
  }
}
