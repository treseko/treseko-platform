import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE } from '../../app/constants'
import { formatTime } from '../../shared/utils/dateTime'
import {
  agentClass,
  agentDisplayName,
  formatConsoleMessage,
  formatElapsed,
  formatLogTime,
  formatMetrics,
  getStatusMeta,
  logClass,
  makeLog,
  normalizeEngineStatus,
  normalizeLog,
  nowIso,
  type AiEngineHealthState,
  type IaExecutionStream,
  type IaLogEntry,
  type IaLogLevel,
  type IaQueueItem,
  type IaRunStatus,
} from './MotorIaPage'

export function useMotorIaMonitorState({ options }: { options: any }) {
  const { currentProjectId, t, fetchWithAuth, showFeedback, canViewStatus, iaStatus, iaLogs, setIaLogs, currentProjectIaQueue, iaExecutionStreams, setIaExecutionStreams, setIaQueue, currentProjectCases } = options
  const [health, setHealth] = useState<AiEngineHealthState | null>(null)
  const [checking, setChecking] = useState(false)
  const [clockTick, setClockTick] = useState(0)
  const [lastHealthCheckedAt, setLastHealthCheckedAt] = useState('')
  const [healthRefreshError, setHealthRefreshError] = useState('')
  const [hiddenQueueItems, setHiddenQueueItems] = useState<Set<string>>(() => new Set())
  const [showQueueHelp, setShowQueueHelp] = useState(true)
  const [reportState, setReportState] = useState<{ show: boolean; loading: boolean; error: string; report: any | null }>({
    show: false,
    loading: false,
    error: '',
    report: null,
  })
  const consoleRef = useRef<HTMLDivElement | null>(null)
  const shouldAutoScrollRef = useRef(true)

  const pushLog = (level: IaLogLevel, message: string, extra: Partial<IaLogEntry> = {}) => {
    setIaLogs((prev: Array<IaLogEntry | string>) => [...prev, makeLog(level, message, extra)])
  }

  const updateStream = (executionId: string, patch: Partial<IaExecutionStream>) => {
    setIaExecutionStreams((prev: IaExecutionStream[]) => prev.map(stream => (
      stream.executionId === executionId
        ? {
          ...stream,
          ...patch,
          startedAt: stream.startedAt && patch.startedAt ? stream.startedAt : patch.startedAt ?? stream.startedAt,
          endedAt: stream.endedAt && patch.endedAt === undefined ? stream.endedAt : patch.endedAt ?? stream.endedAt,
        }
        : stream
    )))
  }

  const hasLiveEngineActivity = iaStatus === 'running' || iaExecutionStreams.some(stream => (
    ['EN_ESPERA', 'EN_EJECUCION'].includes(stream.status || '')
  ))

  useEffect(() => {
    const hasRunning = iaExecutionStreams.some(stream => stream.status === 'EN_EJECUCION')
    if (!hasRunning) return
    const timer = window.setInterval(() => setClockTick(value => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [iaExecutionStreams])

  useEffect(() => {
    if (!consoleRef.current || !shouldAutoScrollRef.current) return
    consoleRef.current.scrollTop = consoleRef.current.scrollHeight
  }, [iaLogs.length])

  // The operational monitor is server-backed. Every authorized project member
  // sees the same queue after refresh; this replaces the launcher's local-only
  // list as the source of truth.
  useEffect(() => {
    if (!currentProjectId || !canViewStatus) return
    let cancelled = false
    const loadSharedQueue = async () => {
      try {
        const response = await fetchWithAuth(`${API_BASE}/ai-engine/queue?proyecto_id=${encodeURIComponent(currentProjectId)}`)
        if (!response.ok) return
        const items = await response.json()
        if (cancelled || !Array.isArray(items)) return
        setIaExecutionStreams(items.map((item: any) => ({
          executionId: item.execution_id,
          caseId: item.case_id,
          runId: item.run_id,
          caseCode: item.case_code,
          caseTitle: item.case_title,
          runName: item.run_name,
          status: item.status,
          startedAt: item.started_at || item.queued_at,
          endedAt: item.ended_at,
          lastMessage: item.message || (item.queue_position ? t('motorIa.globalQueuePosition', { position: item.queue_position }) : undefined),
          confidence: item.confidence,
          consensus: item.consensus,
          humanReviewRequired: item.human_review_required,
        })))
      } catch {
        // Existing per-execution streams and polling remain usable on a brief outage.
      }
    }
    void loadSharedQueue()
    const interval = window.setInterval(() => void loadSharedQueue(), 2500)
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [canViewStatus, currentProjectId, fetchWithAuth, setIaExecutionStreams])

  useEffect(() => {
    const activeStreams = iaExecutionStreams.filter(stream => ['EN_ESPERA', 'EN_EJECUCION'].includes(stream.status || ''))
    if (!activeStreams.length) return
    const token = localStorage.getItem('qa_access_token')
    if (!token) return
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const sockets = activeStreams.map(stream => {
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/client-sync/${stream.executionId}`)
      ws.onopen = () => {
        if (token) ws.send(JSON.stringify({ type: 'auth', token }))
        updateStream(stream.executionId, {
          status: stream.status || 'EN_ESPERA',
          lastMessage: t('motorIa.streamConnected'),
        })
        pushLog('ws', `Conectado a ${stream.caseCode ? `${stream.caseCode} ` : ''}${stream.caseTitle || stream.executionId}`, {
          executionId: stream.executionId,
          caseCode: stream.caseCode,
        })
        ws.send('frontend-ready')
      }
      ws.onerror = () => {
        pushLog('warn', t('motorIa.streamOpenError', { execution: stream.caseCode || stream.executionId }), {
          executionId: stream.executionId,
          caseCode: stream.caseCode,
        })
      }
      ws.onmessage = (event) => {
        const ts = nowIso()
        try {
          const data = JSON.parse(event.data)
          const eventType = data.type || data.event || ''
          const agent = data.agent || data.source || eventType || 'ENGINE'
          const step = data.step || data.step_number || data.numero_paso || ''
          const text = data.text || data.message || data.detail || data.log || JSON.stringify(data)
          const finalEventTypes = new Set(['RUN_RESULT', 'RUN_FINISHED', 'EXECUTION_RESULT', 'FINAL_RESULT', 'AUDIT_RESULT', 'AUDITOR_RESULT'])
          const isFinalEvent = finalEventTypes.has(String(eventType).toUpperCase())
          const isStepResult = eventType === 'STEP_RESULT' || Boolean(data.status)
          const nextStatus = isFinalEvent ? normalizeEngineStatus(data.status) : 'EN_EJECUCION'
          updateStream(stream.executionId, {
            status: nextStatus,
            startedAt: stream.startedAt || ts,
            endedAt: ['PASO', 'FALLO', 'BLOQUEADO', 'ERROR'].includes(nextStatus) && isFinalEvent ? ts : undefined,
            lastMessage: text,
            lastStep: step || stream.lastStep,
              confidence: data.confidence ?? data.metadata?.confidence ?? stream.confidence,
            consensus: data.consensus ?? data.status ?? stream.consensus,
            humanReviewRequired: data.human_review_required ?? stream.humanReviewRequired,
          })
          setIaLogs((prev: Array<IaLogEntry | string>) => [
            ...prev,
            {
              ts,
              level: data.level?.toLowerCase?.() === 'error' ? 'error' : data.level?.toLowerCase?.() === 'warn' ? 'warn' : isStepResult ? (nextStatus === 'ERROR' || nextStatus === 'FALLO' ? 'error' : 'engine') : 'engine',
              source: eventType || 'ENGINE',
              agent,
              message: `${step ? `Paso ${step}: ` : ''}${data.status ? `[${data.status}] ` : ''}${text}`,
              executionId: stream.executionId,
              caseCode: stream.caseCode,
              step,
              attempt: data.attempt,
              confidence: data.confidence,
              reason: data.reason,
              metrics: data.metrics || data.metadata,
            }
          ])
        } catch {
          updateStream(stream.executionId, {
            status: 'EN_EJECUCION',
            startedAt: stream.startedAt || ts,
            lastMessage: String(event.data),
          })
          pushLog('engine', `${stream.caseCode || stream.executionId}: ${event.data}`, {
            executionId: stream.executionId,
            caseCode: stream.caseCode,
          })
        }
      }
      ws.onerror = () => {
        updateStream(stream.executionId, {
          status: 'ERROR',
          endedAt: nowIso(),
            lastMessage: t('motorIa.websocketNoResponse'),
        })
        pushLog('error', t('motorIa.websocketError', { execution: stream.caseCode || stream.executionId }), {
          executionId: stream.executionId,
          caseCode: stream.caseCode,
        })
      }
      ws.onclose = () => {
        const closedAt = nowIso()
        setIaExecutionStreams((prev: IaExecutionStream[]) => prev.map(current => {
          if (current.executionId !== stream.executionId) return current
          const finalStatus = current.status && ['PASO', 'FALLO', 'BLOQUEADO', 'ERROR'].includes(current.status)
          return {
            ...current,
            status: finalStatus ? current.status : 'STREAM_CERRADO',
            endedAt: current.endedAt || closedAt,
            lastMessage: finalStatus ? current.lastMessage : t('motorIa.streamClosed'),
          }
        }))
        pushLog('ws', t('motorIa.streamClosedFor', { execution: stream.caseCode || stream.executionId }), {
          executionId: stream.executionId,
          caseCode: stream.caseCode,
        })
      }
      return ws
    })
    return () => sockets.forEach(ws => ws.close())
  }, [iaExecutionStreams.filter(stream => ['EN_ESPERA', 'EN_EJECUCION'].includes(stream.status || '')).map(stream => stream.executionId).join('|')])

  useEffect(() => {
    const activeStreams = iaExecutionStreams.filter(stream => (
      stream.runId && !['PASO', 'FALLO', 'BLOQUEADO', 'ERROR', 'TIMEOUT'].includes(String(stream.status || '').toUpperCase())
    ))
    if (!activeStreams.length) return

    let cancelled = false
    const finalStatuses = new Set(['PASO', 'FALLO', 'BLOQUEADO', 'ERROR', 'TIMEOUT'])
    const pollExecutions = async () => {
      const runIds = [...new Set(activeStreams.map(stream => stream.runId).filter(Boolean))]
      for (const runId of runIds) {
        try {
          const response = await fetchWithAuth(`${API_BASE}/test-runs/${runId}/ejecuciones/?limit=500`)
          if (!response.ok) continue
          const executions = await response.json()
          if (cancelled || !Array.isArray(executions)) return
          setIaExecutionStreams((prev: IaExecutionStream[]) => prev.map(stream => {
            if (stream.runId !== runId) return stream
            const current = executions.find((item: any) => item.id === stream.executionId)
            if (!current?.estado_resultado) return stream
            const nextStatus = normalizeEngineStatus(current.estado_resultado)
            const isFinal = finalStatuses.has(String(current.estado_resultado).toUpperCase())
            const nextMessage = current.observaciones || `Estado actualizado: ${current.estado_resultado}`
            if (
              stream.status === nextStatus
              && stream.lastMessage === nextMessage
              && stream.confidence === current.ai_confidence
            ) {
              return stream
            }
            return {
              ...stream,
              status: nextStatus,
              startedAt: stream.startedAt || current.fecha_ejecucion || nowIso(),
              endedAt: isFinal ? (stream.endedAt || nowIso()) : stream.endedAt,
              lastMessage: nextMessage,
              confidence: current.ai_confidence ?? stream.confidence,
              consensus: current.ai_consensus ?? stream.consensus,
              humanReviewRequired: current.ai_human_review_required ?? stream.humanReviewRequired,
            }
          }))
        } catch {
          // El WebSocket sigue siendo la fuente primaria. Este polling solo evita UI congelada.
        }
      }
    }

    pollExecutions()
    const timer = window.setInterval(pollExecutions, 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [fetchWithAuth, iaExecutionStreams.map(stream => `${stream.executionId}:${stream.runId}:${stream.status}`).join('|')])

  const checkHealth = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setChecking(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/ai-engine/health`)
      if (!response.ok) throw new Error(t('motorIa.backendResponded', { status: response.status }))
      const data = await response.json()
      setHealth(data)
      setLastHealthCheckedAt(nowIso())
      setHealthRefreshError('')
      if (!options.silent) {
        pushLog('engine', t('motorIa.engineStatusLog', { status: data.status, detail: data.detail ? ` (${data.detail})` : '' }))
      }
    } catch (error: any) {
      const message = error.message || t('motorIa.engineUnavailable')
      setHealthRefreshError(message)
      setLastHealthCheckedAt(nowIso())
      setHealth((previous) => (options.silent && previous ? previous : { status: 'error', detail: message }))
      if (!options.silent) {
        pushLog('error', message)
        showFeedback(t('motorIa.pageTitle'), message, 'danger')
      }
    } finally {
      if (!options.silent) setChecking(false)
    }
  }, [fetchWithAuth, setIaLogs, showFeedback])

  useEffect(() => {
    if (!canViewStatus) return
    checkHealth({ silent: true })
    const intervalMs = hasLiveEngineActivity ? 3000 : 10000
    const timer = window.setInterval(() => checkHealth({ silent: true }), intervalMs)
    return () => window.clearInterval(timer)
  }, [canViewStatus, checkHealth, hasLiveEngineActivity])

  const openAiReport = async (executionId: string) => {
    if (!executionId) return
    setReportState({ show: true, loading: true, error: '', report: null })
    try {
      const response = await fetchWithAuth(`${API_BASE}/ejecuciones/${executionId}/ai-report/`)
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}))
        throw new Error(detail.detail || (response.status === 404
          ? t('motorIa.reportNotAvailable')
          : t('motorIa.reportLoadError', { status: response.status })))
      }
      const data = await response.json()
      setReportState({ show: true, loading: false, error: '', report: data })
    } catch (error: any) {
      setReportState({ show: true, loading: false, error: error.message || t('motorIa.reportLoadFailed'), report: null })
    }
  }

  const markAiReportReviewed = async (executionId: string) => {
    try {
      const response = await fetchWithAuth(`${API_BASE}/ejecuciones/${executionId}/ai-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: t('motorIa.reviewNote') }),
      })
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}))
        throw new Error(detail.detail || t('motorIa.reviewMarkError', { status: response.status }))
      }
      await openAiReport(executionId)
      showFeedback(t('motorIa.reviewTitle'), t('motorIa.reviewMarked'), 'success')
    } catch (error: any) {
      showFeedback(t('motorIa.reviewTitle'), error.message || t('motorIa.reviewMarkFailed'), 'danger')
    }
  }

  const logs = useMemo(() => iaLogs.map(normalizeLog), [iaLogs])

  const queueItems = useMemo(() => {
    const byCaseId = new Map<string, any>()
    currentProjectCases.forEach(test => byCaseId.set(test.id, test))
    const streamItems: IaQueueItem[] = iaExecutionStreams.map(stream => {
      const test = byCaseId.get(stream.caseId)
      return {
        caseId: stream.caseId,
        executionId: stream.executionId,
        runId: stream.runId,
        caseCode: stream.caseCode || test?.code || test?.codigo || stream.caseId,
        caseTitle: stream.caseTitle || test?.title || test?.titulo || t('motorIa.aiCase'),
        component: test?.component || test?.componente || t('motorIa.case'),
        runName: stream.runName,
        status: stream.status || 'EN_ESPERA',
        startedAt: stream.startedAt,
        endedAt: stream.endedAt,
        lastMessage: stream.lastMessage,
        lastStep: stream.lastStep,
        confidence: stream.confidence,
        consensus: stream.consensus,
        humanReviewRequired: stream.humanReviewRequired,
      }
    })
    const streamedCaseIds = new Set(streamItems.map(item => item.caseId))
    const waitingItems: IaQueueItem[] = currentProjectIaQueue
      .filter(caseId => !streamedCaseIds.has(caseId))
      .map(caseId => {
        const test = byCaseId.get(caseId)
        return {
          caseId,
          executionId: '',
          caseCode: test?.code || test?.codigo || caseId,
          caseTitle: test?.title || test?.titulo || t('motorIa.aiCase'),
          component: test?.component || test?.componente || t('motorIa.case'),
          status: 'EN_ESPERA' as IaRunStatus,
          lastMessage: t('motorIa.pendingStream'),
        }
      })
    return [...streamItems, ...waitingItems]
  }, [clockTick, currentProjectCases, currentProjectIaQueue, iaExecutionStreams, t])

  const getQueueItemKey = (item: Pick<IaQueueItem, 'executionId' | 'caseId'>) => item.executionId || `waiting:${item.caseId}`
  const finalQueueStatuses = useMemo(() => new Set<IaRunStatus>(['PASO', 'FALLO', 'BLOQUEADO', 'ERROR', 'STREAM_CERRADO']), [])
  const visibleQueueItems = useMemo(
    () => queueItems.filter(item => !hiddenQueueItems.has(getQueueItemKey(item))),
    [hiddenQueueItems, queueItems]
  )
  const hiddenFinishedCount = queueItems.length - visibleQueueItems.length
  const finishedQueueItemsCount = visibleQueueItems.filter(item => finalQueueStatuses.has(item.status)).length
  const runningCount = visibleQueueItems.filter(item => item.status === 'EN_EJECUCION').length
  const hideQueueItem = (item: IaQueueItem) => {
    setHiddenQueueItems(previous => {
      const next = new Set(previous)
      next.add(getQueueItemKey(item))
      return next
    })
  }
  const hideFinishedQueueItems = () => {
    setHiddenQueueItems(previous => {
      const next = new Set(previous)
      visibleQueueItems.forEach(item => {
        if (finalQueueStatuses.has(item.status)) next.add(getQueueItemKey(item))
      })
      return next
    })
  }
  const clearHiddenQueueItems = () => setHiddenQueueItems(new Set())
  const rawHealthStatusValue = String(health?.status || '').toLowerCase()
  const rawHealthStatus = ['unknown', 'desconocido'].includes(rawHealthStatusValue) ? '' : rawHealthStatusValue
  const enginePayload = health?.engine || null
  const directEnginePayload = enginePayload?.engine || enginePayload
  const engineProcessStatus = String(directEnginePayload?.status || enginePayload?.status || '').toLowerCase()
  const engineProcessOnline = ['ok', 'online', 'healthy'].includes(engineProcessStatus)
    || Boolean(directEnginePayload?.version || enginePayload?.version || directEnginePayload?.service)
  const llmStatusCode = health?.engine?.llm?.status_code
  const llmOnline = typeof llmStatusCode === 'number' ? llmStatusCode < 400 : rawHealthStatus === 'ok'
  const liveActivity = runningCount > 0 || hasLiveEngineActivity || iaExecutionStreams.length > 0
  const healthStatus = rawHealthStatus === 'ok'
    ? 'online'
    : engineProcessOnline
      ? 'degraded'
      : liveActivity
        ? 'active'
        : !health
        ? 'checking'
        : rawHealthStatus || 'checking'
  const healthBadgeVariant = healthStatus === 'online'
    ? 'success'
    : healthStatus === 'active'
      ? 'primary'
    : healthStatus === 'degraded' || healthStatus === 'checking'
      ? 'warning'
      : healthStatus === 'error'
        ? 'danger'
        : 'secondary'
  const healthLabel = healthStatus === 'online'
    ? t('motorIa.healthOnline')
    : healthStatus === 'active'
      ? t('motorIa.healthActive')
    : healthStatus === 'degraded'
      ? t('motorIa.healthDegraded')
      : healthStatus === 'checking'
        ? t('motorIa.healthChecking')
        : healthStatus.toUpperCase()

  return { health, checking, lastHealthCheckedAt, healthRefreshError, showQueueHelp, setShowQueueHelp, reportState, setReportState, consoleRef, shouldAutoScrollRef, checkHealth, openAiReport, markAiReportReviewed, enginePayload, directEnginePayload, iaStatus, iaExecutionStreams, queueItems, visibleQueueItems, finishedQueueItemsCount, hiddenFinishedCount, runningCount, hideFinishedQueueItems, clearHiddenQueueItems, hideQueueItem, logs, formatTime, formatElapsed, formatLogTime, formatConsoleMessage, formatMetrics, agentDisplayName, statusMeta: getStatusMeta(t), currentProjectIaQueue, liveActivity, engineProcessOnline, llmOnline, healthStatus, healthBadgeVariant, healthLabel, setHiddenQueueItems, makeLog, agentClass, logClass }
}
