import type { Dispatch, SetStateAction } from 'react'
import { API_BASE } from '../../app/constants'
import { isValidUUID } from '../../app/validation'
import { fromDateTimeLocalInput, formatDateTime } from '../../shared/utils/dateTime'
import type { TranslationKey } from '../../i18n'
import { humanizeAiError } from '../../app/errorMessages'

type FeedbackVariant = 'success' | 'danger' | 'warning' | 'info'

const iaLog = (level: string, message: string, extra: Record<string, any> = {}) => ({
  ts: new Date().toISOString(),
  level,
  source: String(level).toUpperCase(),
  message,
  ...extra,
})

const FINAL_IA_STATUSES = ['PASO', 'FALLO', 'BLOQUEADO', 'ERROR', 'TIMEOUT', 'SKIPPED', 'CANCELLED', 'REQUIERE_REVISION', 'STREAM_CERRADO']

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
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
  navigateToMotorIaOnLaunch?: boolean
  onAfterLaunch?: () => void
  readOnlyBuild?: boolean
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
  t,
  navigateToMotorIaOnLaunch = true,
  onAfterLaunch,
  readOnlyBuild = false
}: CreateIaMissionActionsParams) {
  const waitForIaExecutionToFinish = async (runId: string, executionId: string, timeoutMs = 20 * 60 * 1000) => {
    const startedAt = Date.now()
    const finalStatuses = new Set(FINAL_IA_STATUSES)
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
    if (readOnlyBuild) {
      showFeedback(t('motorIa.executionStartFailed'), t('motorIa.historicalBuildReadOnly'), 'warning')
      return
    }
    if (selectedTestsForIa.length === 0) return
    const scheduledIso = fromDateTimeLocalInput(scheduledTime)
    if (mode === 'scheduled' && !scheduledIso) {
      showFeedback(t('motorIa.scheduleRequired'), t('motorIa.scheduleRequiredMessage'), 'warning')
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
          t('motorIa.missionScheduled'),
          t('motorIa.missionScheduledMessage', { name: execName, date: formatDateTime(scheduledIso) }),
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
          throw new Error(t('motorIa.selectActiveBuild'))
        }
        const selectedIaTests = currentProjectCases.filter(test => selectedTestsForIa.includes(test.id))
        if (selectedIaTests.some(test => test.componentId && test.componentId !== executionBuild.componentId)) {
          throw new Error(t('motorIa.componentBuildMismatch'))
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
          throw new Error(errorText || t('motorIa.backendResponded', { status: response.status }))
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
              runId: run.id,
              caseCode: test?.code || test?.codigo || '',
              caseTitle: test?.title || test?.titulo || t('motorIa.aiCase'),
              runName: run.nombre,
              status: 'EN_ESPERA',
              lastMessage: t('motorIa.queueWaitingExecution'),
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
            iaLog('run', t('motorIa.queueSummary', { name: run.nombre, count: queuedStreams.length, parallel: maxParallelIa })),
            ...queuedStreams.map(item => iaLog('queue', `${item.caseTitle}: ${t('motorIa.queueWaiting')}`, { caseCode: item.caseCode, executionId: item.executionId })),
          ])
          setProjectSyncMessage(t('motorIa.executionCreatedForBuild', { name: run.nombre, count: selectedTestsForIa.length }))
          setShowIaScheduler(false)
          const startedMessageKey = selectedTestsForIa.length === 1
            ? 'motorIa.executionStartedSingleMessage'
            : 'motorIa.executionStartedPluralMessage'
          showFeedback(t('motorIa.executionStarted'), t(startedMessageKey, { count: selectedTestsForIa.length, build: executionBuild.name || t('motorIa.noBuild') }), 'success')
          if (navigateToMotorIaOnLaunch) setActiveTab('motor_ia')
          onAfterLaunch?.()

          const started: any[] = []
          let queueIndex = 0
          const runNextIaExecution = async () => {
            while (queueIndex < ejecuciones.length) {
              const item = ejecuciones[queueIndex++]
            const test = selectedIaTests.find(candidate => candidate.id === item.caso_id)
            setIaExecutionStreams(prev => prev.map(stream => stream.executionId === item.id
              ? { ...stream, status: 'EN_EJECUCION', startedAt: new Date().toISOString(), lastMessage: t('motorIa.executionRunning') }
              : stream
            ))
            setIaLogs(prev => [...prev, iaLog('run', `${test?.code || test?.codigo || t('motorIa.aiCase')} ${t('motorIa.executionStarting')}`, { caseCode: test?.code || test?.codigo, executionId: item.id })])
            const response = await fetchWithAuth(`${API_BASE}/ejecuciones/${item.id}/automatizar/`, { method: 'POST' })
            const payload = await response.json().catch(() => null)
            const result = {
              ok: response.ok,
              executionId: item.id,
              caseId: item.caso_id,
              caseCode: test?.code || test?.codigo || '',
              caseTitle: test?.title || test?.titulo || t('motorIa.aiCase'),
              error: payload?.detail || t('motorIa.backendResponded', { status: response.status }),
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
                      lastMessage: finished.observaciones || t('motorIa.executionFinishedWithStatus', { status: finished.estado_resultado }),
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
                iaLog('run', t('motorIa.sequenceComplete', { name: run.nombre, passed: started.filter(item => item.ok).length, total: started.length })),
                ...started.filter(item => !item.ok).map(item => iaLog('error', `${item.caseTitle}: ${item.error}`, { caseCode: item.caseCode, executionId: item.executionId }))
              ])
              if (started.filter(item => item.ok).length === 0 && started.length > 0) {
                showFeedback(t('motorIa.executionStartFailed'), humanizeAiError(started.find(item => !item.ok)?.error) || t('motorIa.executionStartFailedMessage'), 'danger')
              }
            })
            .catch((error: any) => {
              const message = humanizeAiError(error) || t('motorIa.launchFailedMessage')
              setProjectSyncMessage(t('motorIa.executionErrorSync', { message }))
              setIaLogs(prev => [...prev, iaLog('error', t('motorIa.executionErrorSync', { message }))])
              showFeedback(t('motorIa.executionError'), message, 'danger')
            })
          return
        }
        setProjectSyncMessage(t('motorIa.executionCreatedForBuild', { name: run.nombre, count: selectedTestsForIa.length }))
      } catch (error: any) {
        const message = humanizeAiError(error) || t('motorIa.executionStartFailedMessage')
        setProjectSyncMessage(t('motorIa.buildExecutionCreationFailed', { message }))
        setIaLogs(prev => [...prev, iaLog('error', `${t('motorIa.executionStartFailed')}: ${message}`)])
        setShowIaScheduler(false)
        if (navigateToMotorIaOnLaunch) setActiveTab('motor_ia')
        onAfterLaunch?.()
        showFeedback(t('motorIa.executionStartFailed'), message, 'danger')
        return
      }
    }

    setIaQueue(prev => [...new Set([...prev, ...selectedTestsForIa])])
    setShowIaScheduler(false)
    const startedMessageKey = selectedTestsForIa.length === 1
      ? 'motorIa.executionStartedSingleMessage'
      : 'motorIa.executionStartedPluralMessage'
    showFeedback(t('motorIa.executionStarted'), t(startedMessageKey, { count: selectedTestsForIa.length, build: buildsList.find(build => build.id === currentBuildId)?.name || t('motorIa.noBuild') }), 'success')
    if (navigateToMotorIaOnLaunch) setActiveTab('motor_ia')
    onAfterLaunch?.()
  }

  return {
    handleLaunchIaMission
  }
}
