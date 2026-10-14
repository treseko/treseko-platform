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
  iaMissionSubmissionRef?: { current: boolean }
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
  iaMissionSubmissionRef = { current: false },
  readOnlyBuild = false
}: CreateIaMissionActionsParams) {
  const launchIaMission = async (mode: 'now' | 'scheduled' = 'now', options: { recordVideo?: boolean } = {}) => {
    if (readOnlyBuild) {
      showFeedback(t('motorIa.executionStartFailed'), t('motorIa.historicalBuildReadOnly'), 'warning')
      return
    }
    if (selectedTestsForIa.length === 0) return
    const scheduledIso = fromDateTimeLocalInput(scheduledTime)
    if (mode === 'scheduled' && (!scheduledIso || new Date(scheduledIso).getTime() <= Date.now())) {
      showFeedback(t('motorIa.scheduleRequired'), t('motorIa.scheduleRequiredMessage'), 'warning')
      return
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
        const response = await fetchWithAuth(`${API_BASE}/${mode === 'scheduled' ? 'ai-schedules' : 'ai-missions'}/`, {
          method: 'POST',
          body: JSON.stringify({
            proyecto_id: currentProjectId,
            record_video: options.recordVideo !== false,
            build_id: executionBuild.id,
            nombre: execName || `Run IA - ${new Date().toISOString().slice(0, 10)}`,
            ...(mode === 'scheduled' ? { scheduled_at: scheduledIso } : {}),
            caso_ids: selectedTestsForIa.filter(isValidUUID)
          })
        })
        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(errorText || t('motorIa.backendResponded', { status: response.status }))
        }
        const run = await response.json()
        if (mode === 'scheduled') {
          setShowIaScheduler(false)
          showFeedback(t('motorIa.missionScheduled'), t('motorIa.missionScheduledMessage', { name: execName, date: formatDateTime(scheduledIso) }), 'success')
          if (navigateToMotorIaOnLaunch) setActiveTab('motor_ia')
          onAfterLaunch?.()
          return
        }

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

          return
        }
        setProjectSyncMessage(t('motorIa.executionCreatedForBuild', { name: run.nombre, count: selectedTestsForIa.length }))
      } catch (error: any) {
        const message = humanizeAiError(error) || t('motorIa.executionStartFailedMessage')
        setProjectSyncMessage(t('motorIa.buildExecutionCreationFailed', { message }))
        setIaLogs(prev => [...prev, iaLog('error', `${t('motorIa.executionStartFailed')}: ${message}`)])
        if (mode === 'now') {
          setShowIaScheduler(false)
          if (navigateToMotorIaOnLaunch) setActiveTab('motor_ia')
          onAfterLaunch?.()
        }
        showFeedback(t('motorIa.executionStartFailed'), message, 'danger')
        return
      }
    }

    showFeedback(t('motorIa.executionStartFailed'), t('motorIa.executionStartFailedMessage'), 'danger')

  }

  const handleLaunchIaMission = async (mode: 'now' | 'scheduled' = 'now', options: { recordVideo?: boolean } = {}) => {
    if (iaMissionSubmissionRef.current) return
    iaMissionSubmissionRef.current = true
    try { await launchIaMission(mode, options) }
    finally { iaMissionSubmissionRef.current = false }
  }

  return {
    handleLaunchIaMission
  }
}
