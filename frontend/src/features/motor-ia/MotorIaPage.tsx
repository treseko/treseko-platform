import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Row, Col, Card, Badge, Button, ListGroup, Alert, Spinner } from 'react-bootstrap'
import { Cpu, LayoutList, PlugZap, Settings, X } from 'lucide-react'
import { API_BASE } from '../../app/constants'
import { AiExecutionReportModal } from './AiExecutionReportModal'
import { formatTime } from '../../shared/utils/dateTime'

type IaLogLevel = 'error' | 'warn' | 'engine' | 'ws' | 'run' | 'system' | 'queue' | 'info'
type IaRunStatus = 'EN_ESPERA' | 'EN_EJECUCION' | 'PASO' | 'FALLO' | 'BLOQUEADO' | 'ERROR' | 'STREAM_CERRADO'

type IaLogEntry = {
  ts: string
  level: IaLogLevel
  source?: string
  agent?: string
  message: string
  executionId?: string
  caseCode?: string
  step?: string | number
  attempt?: string | number
  confidence?: number
  reason?: string
  metrics?: Record<string, any>
}

type IaExecutionStream = {
  executionId: string
  caseId: string
  runId?: string
  caseCode?: string
  caseTitle?: string
  runName?: string
  status?: IaRunStatus
  startedAt?: string
  endedAt?: string
  lastMessage?: string
  lastStep?: string | number
  confidence?: number
  consensus?: string
  humanReviewRequired?: boolean
}

type IaQueueItem = {
  caseId: string
  executionId: string
  runId?: string
  caseCode: string
  caseTitle: string
  component: string
  runName?: string
  status: IaRunStatus
  startedAt?: string
  endedAt?: string
  lastMessage?: string
  lastStep?: string | number
  confidence?: number
  consensus?: string
  humanReviewRequired?: boolean
}

type AiEngineHealthState = {
  status?: string
  detail?: string | null
  engine?: {
    status?: string
    service?: string
    version?: string
    engine?: {
      status?: string
      service?: string
      engine?: string
      version?: string
    }
    llm?: {
      endpoint?: string
      provider?: string
      model?: string
      status_code?: number
      model_response?: string | null
      requires_api_key?: boolean
      api_key_configured?: boolean
    }
  } | null
}

type MotorIaPageProps = {
  iaStatus: 'idle' | 'running' | string
  iaLogs: Array<IaLogEntry | string>
  setIaLogs: (updater: any) => void
  currentProjectIaQueue: string[]
  iaExecutionStreams: IaExecutionStream[]
  setIaExecutionStreams: (updater: any) => void
  setIaQueue: (updater: any) => void
  currentProjectCases: any[]
  fetchWithAuth: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  showFeedback: (title: string, message: string, variant?: 'success' | 'danger' | 'warning' | 'info') => void
  setActiveTab: (tab: any) => void
  setConfigTab: (tab: any) => void
  canAccessCapability?: (capabilityId: any, level?: any) => boolean
  hasSystemFeature?: (featureId: string) => boolean
}

const nowIso = () => new Date().toISOString()

const makeLog = (
  level: IaLogLevel,
  message: string,
  extra: Partial<IaLogEntry> = {}
): IaLogEntry => ({
  ts: nowIso(),
  level,
  source: extra.source || level.toUpperCase(),
  message,
  executionId: extra.executionId,
  caseCode: extra.caseCode,
  agent: extra.agent,
  step: extra.step,
  attempt: extra.attempt,
  confidence: extra.confidence,
  metrics: extra.metrics,
})

const detectLegacyLevel = (value: string): IaLogLevel => {
  const lower = value.toLowerCase()
  if (lower.includes('error')) return 'error'
  if (lower.includes('warn') || lower.includes('bloque')) return 'warn'
  if (value.includes('[WS]')) return 'ws'
  if (value.includes('[RUN]')) return 'run'
  if (value.includes('[QUEUE]')) return 'queue'
  if (value.includes('[ENGINE]')) return 'engine'
  if (value.includes('[SYSTEM]')) return 'system'
  return 'info'
}

const normalizeLog = (log: IaLogEntry | string): IaLogEntry => {
  if (typeof log !== 'string') {
    return {
      ...log,
      ts: log.ts || nowIso(),
      level: log.level || 'info',
      message: log.message || '',
    }
  }
  return {
    ts: '',
    level: detectLegacyLevel(log),
    source: 'LEGACY',
    message: log,
  }
}

const formatLogTime = (ts: string) => {
  return formatTime(ts) || '--:--:--'
}

const formatElapsed = (start?: string, end?: string, fallbackSeconds?: number) => {
  if (!start && typeof fallbackSeconds === 'number') {
    const minutes = Math.floor(fallbackSeconds / 60)
    const seconds = Math.max(0, Math.floor(fallbackSeconds % 60))
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  if (!start) return '00:00'
  const startMs = new Date(start).getTime()
  const endMs = end ? new Date(end).getTime() : Date.now()
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return '00:00'
  const totalSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

const statusMeta: Record<IaRunStatus, { label: string; bg: string; text?: string }> = {
  EN_ESPERA: { label: 'En espera', bg: 'secondary' },
  EN_EJECUCION: { label: 'En ejecucion', bg: 'primary' },
  PASO: { label: 'Paso', bg: 'success' },
  FALLO: { label: 'Fallo', bg: 'danger' },
  BLOQUEADO: { label: 'Bloqueado', bg: 'warning', text: 'dark' },
  ERROR: { label: 'Error', bg: 'danger' },
  STREAM_CERRADO: { label: 'Stream cerrado', bg: 'secondary' },
}

const logClass = (level: IaLogLevel) => {
  if (level === 'error') return 'text-danger'
  if (level === 'warn') return 'text-warning'
  if (level === 'engine') return 'text-success'
  if (level === 'ws') return 'text-info'
  if (level === 'run') return 'text-primary'
  if (level === 'queue') return 'text-light'
  return 'text-success'
}

const normalizeAgentKey = (agent?: string) => String(agent || '').replace(/\s+/g, '').toUpperCase()

const agentDisplayName = (agent?: string) => {
  const raw = String(agent || '').trim()
  const value = normalizeAgentKey(raw)
  const labels: Record<string, string> = {
    SYSTEM: 'Sistema',
    WORKFLOW: 'Workflow',
    BROWSER: 'Navegador',
    AI_AGENT: 'Agente IA',
    QAGUARD: 'QA Guard',
    QA_GUARD: 'QA Guard',
    SENTINEL: 'Sentinel',
    VALIDATOR: 'Validator',
    OBSERVER: 'Observer',
    CONTEXTRESOLVER: 'Context Resolver',
    PLANNER: 'Planner',
    SECURITYGUARD: 'Security Guard',
    EXECUTOR: 'Executor',
    RECOVERY: 'Recovery',
    AUDITOR: 'Auditor',
    REPORTER: 'Reporter',
    AGENT_LOG: 'Agente',
    STREAM_DOM_LOG: 'Stream',
    EXECUTION_FINISHED: 'Finalizacion',
  }
  return labels[value] || raw || 'Motor'
}

const agentClass = (agent?: string) => {
  const value = normalizeAgentKey(agent)
  if (value === 'QA_GUARD') return 'text-warning'
  if (value === 'QAGUARD') return 'text-warning'
  if (value === 'AUDITOR') return 'text-info'
  if (value === 'AI_AGENT') return 'text-primary'
  if (value === 'SENTINEL') return 'text-light'
  if (value === 'BROWSER') return 'text-success'
  if (value === 'RECOVERY') return 'text-warning'
  return 'text-secondary'
}

const cleanDuplicateCasePrefix = (message: string, caseCode?: string) => {
  let result = String(message || '').trim()
  const code = String(caseCode || '').trim()
  if (!code) return result
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  result = result.replace(new RegExp(`^${escaped}\\s+${escaped}:\\s*`, 'i'), '')
  result = result.replace(new RegExp(`^${escaped}:\\s*`, 'i'), '')
  result = result.replace(new RegExp(`^${escaped}\\s+`, 'i'), '')
  return result
}

const summarizeStartMessage = (message: string) => {
  const match = message.match(/Iniciando tarea:\s*Ejecutar caso manual\s+([^:]+):\s*(.+?)(?:\s+Precondiciones:|$)/i)
  if (!match) return message
  return `Iniciando prueba ${match[1].trim()}: ${match[2].trim()}`
}

const humanizeWorkflowMessage = (message: string, reason?: string) => {
  const value = message.trim()
  if (/^Ejecutando workflow\s+/i.test(value)) {
    return value.replace(/^Ejecutando workflow\s+/i, 'Workflow iniciado: ')
  }
  if (/^Context Resolver:\s*SUCCESS$/i.test(value)) return 'Contexto resuelto'
  if (/^Observer:\s*SUCCESS$/i.test(value)) return 'Observacion completada'
  if (/^Observer:\s*BLOCKED$/i.test(value) && reason === 'no_more_steps') return 'Observacion finalizada: no quedan pasos pendientes'
  if (/^Observer:\s*sin mas pasos$/i.test(value)) return 'Observacion finalizada: no quedan pasos pendientes'
  if (/^Planner:\s*SUCCESS$/i.test(value)) return 'Plan de accion preparado'
  if (/^Security Guard:\s*SUCCESS$/i.test(value)) return 'Accion aprobada por QA Guard'
  if (/^Executor:\s*SUCCESS$/i.test(value)) return 'Ejecucion de pasos completada'
  if (/^Validator:\s*SUCCESS$/i.test(value)) return 'Resultado validado'
  if (/^Auditor:\s*SUCCESS$/i.test(value)) return 'Auditoria de workflow completada'
  if (/^Reporter:\s*SUCCESS$/i.test(value)) return 'Reporte preparado'
  if (/^Paso\s+\d+:\s*solicitando accion estricta/i.test(value)) {
    return value.replace(/solicitando accion estricta/i, 'consultando al modelo')
  }
  if (/^Paso\s+\d+:\s*Validacion funcional no requerida/i.test(value)) {
    return value.replace(/Validacion funcional no requerida/i, 'Validacion funcional omitida')
  }
  if (/^Test\s+[0-9a-f-]{20,}\s+finalizado\./i.test(value)) {
    return 'Ejecucion tecnica cerrada'
  }
  return value
}

const formatConsoleMessage = (log: IaLogEntry) => {
  const withoutPrefix = cleanDuplicateCasePrefix(log.message, log.caseCode)
  return humanizeWorkflowMessage(summarizeStartMessage(withoutPrefix), log.reason)
}

const formatMetrics = (metrics?: Record<string, any>) => {
  if (!metrics) return ''
  const tokens = metrics.totalTokens ?? metrics.total_tokens
  const latency = metrics.latencyMs ?? metrics.latency_ms
  const cost = metrics.estimatedCost ?? metrics.estimated_cost
  const parts = []
  if (tokens !== undefined) parts.push(`${tokens} tok`)
  if (latency !== undefined) parts.push(`${latency}ms`)
  if (cost !== undefined) parts.push(`$${Number(cost || 0).toFixed(5)}`)
  return parts.join(' · ')
}

const normalizeEngineStatus = (value?: string): IaRunStatus => {
  const status = String(value || '').toUpperCase()
  if (status.includes('EJECUTANDO') || status.includes('RUNNING') || status.includes('EN_EJECUCION')) return 'EN_EJECUCION'
  if (status.includes('ESPERA') || status.includes('PENDING') || status.includes('SIN_CORRER')) return 'EN_ESPERA'
  if (status.includes('BLOQUE')) return 'BLOQUEADO'
  if (status.includes('FAIL') || status.includes('FALLO')) return 'FALLO'
  if (status.includes('ERROR')) return 'ERROR'
  if (status.includes('PASO') || status.includes('PASS')) return 'PASO'
  return 'EN_EJECUCION'
}

export function MotorIaPage({
  iaStatus,
  iaLogs,
  setIaLogs,
  currentProjectIaQueue,
  iaExecutionStreams,
  setIaExecutionStreams,
  setIaQueue,
  currentProjectCases,
  fetchWithAuth,
  showFeedback,
  setActiveTab,
  setConfigTab,
  canAccessCapability,
  hasSystemFeature,
}: MotorIaPageProps) {
  const canUseCapability = canAccessCapability || (() => true)
  const featureEnabled = hasSystemFeature || (() => true)
  const canViewStatus = canUseCapability('motor_ia.ver', 'read')
  const canEditConfig = canUseCapability('motor_ia.configuracion', 'edit')
  const canViewLogs = canUseCapability('motor_ia.logs', 'read')
  const canViewWorkflows = canUseCapability('motor_ia.workflows', 'read')
  const hasAdvancedEngine = featureEnabled('ai.engine')
  const hasBasicAiExecution = featureEnabled('ai.basic_execution')

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

  useEffect(() => {
    if (!iaExecutionStreams.length) return
    const token = localStorage.getItem('qa_access_token')
    if (!token) return
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const sockets = iaExecutionStreams.map(stream => {
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/client-sync/${stream.executionId}`)
      ws.onopen = () => {
        if (token) ws.send(JSON.stringify({ type: 'auth', token }))
        updateStream(stream.executionId, {
          status: stream.status || 'EN_ESPERA',
          lastMessage: 'Stream conectado. Esperando actividad del motor.',
        })
        pushLog('ws', `Conectado a ${stream.caseCode ? `${stream.caseCode} ` : ''}${stream.caseTitle || stream.executionId}`, {
          executionId: stream.executionId,
          caseCode: stream.caseCode,
        })
        ws.send('frontend-ready')
      }
      ws.onerror = () => {
        pushLog('warn', `No se pudo abrir el stream seguro para ${stream.caseCode || stream.executionId}. Verifica sesion y permisos.`, {
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
          lastMessage: 'WebSocket IA sin respuesta.',
        })
        pushLog('error', `WebSocket IA sin respuesta para ${stream.caseCode || stream.executionId}`, {
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
            lastMessage: finalStatus ? current.lastMessage : 'Stream cerrado.',
          }
        }))
        pushLog('ws', `Stream cerrado para ${stream.caseCode || stream.executionId}`, {
          executionId: stream.executionId,
          caseCode: stream.caseCode,
        })
      }
      return ws
    })
    return () => sockets.forEach(ws => ws.close())
  }, [iaExecutionStreams.map(stream => stream.executionId).join('|')])

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
      if (!response.ok) throw new Error(`Backend respondio ${response.status}`)
      const data = await response.json()
      setHealth(data)
      setLastHealthCheckedAt(nowIso())
      setHealthRefreshError('')
      if (!options.silent) {
        pushLog('engine', `Motor IA -> ${data.status}${data.detail ? ` (${data.detail})` : ''}`)
      }
    } catch (error: any) {
      const message = error.message || 'Motor IA no disponible'
      setHealthRefreshError(message)
      setLastHealthCheckedAt(nowIso())
      setHealth((previous) => (options.silent && previous ? previous : { status: 'error', detail: message }))
      if (!options.silent) {
        pushLog('error', message)
        showFeedback('Motor IA', message, 'danger')
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
          ? 'Reporte no disponible para esta ejecucion. Reinicia el backend si acabas de actualizar la aplicacion.'
          : `No se pudo cargar el reporte IA (${response.status})`))
      }
      const data = await response.json()
      setReportState({ show: true, loading: false, error: '', report: data })
    } catch (error: any) {
      setReportState({ show: true, loading: false, error: error.message || 'No se pudo cargar el reporte IA', report: null })
    }
  }

  const markAiReportReviewed = async (executionId: string) => {
    try {
      const response = await fetchWithAuth(`${API_BASE}/ejecuciones/${executionId}/ai-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: 'Revision humana confirmada desde reporte IA' }),
      })
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}))
        throw new Error(detail.detail || `No se pudo marcar la revision (${response.status})`)
      }
      await openAiReport(executionId)
      showFeedback('Revision IA', 'La ejecucion quedo marcada como revisada.', 'success')
    } catch (error: any) {
      showFeedback('Revision IA', error.message || 'No se pudo marcar la revision.', 'danger')
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
        caseTitle: stream.caseTitle || test?.title || test?.titulo || 'Caso IA',
        component: test?.component || test?.componente || 'Caso',
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
          caseTitle: test?.title || test?.titulo || 'Caso IA',
          component: test?.component || test?.componente || 'Caso',
          status: 'EN_ESPERA' as IaRunStatus,
          lastMessage: 'Pendiente de iniciar stream.',
        }
      })
    return [...streamItems, ...waitingItems]
  }, [clockTick, currentProjectCases, currentProjectIaQueue, iaExecutionStreams])

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
    ? 'ONLINE'
    : healthStatus === 'active'
      ? 'ACTIVO'
    : healthStatus === 'degraded'
      ? 'DEGRADADO'
      : healthStatus === 'checking'
        ? 'VERIFICANDO'
        : healthStatus.toUpperCase()

  return (
    <div className="p-4 h-100 d-flex flex-column animate__animated animate__fadeIn text-dark text-start">
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4">
        <div>
          <h4 className="fw-bold text-primary m-0 d-flex align-items-center gap-2">
            <Cpu size={24} /> Motor IA
          </h4>
          <div className="small text-muted">
            {hasAdvancedEngine
              ? 'Motor IA completo con configuracion avanzada, workflows, cola y trazas.'
              : 'Ejecucion IA basica incluida en Community, con cuota semanal y sin configuracion avanzada.'}
          </div>
        </div>
        <div className="d-flex flex-wrap gap-2">
          {canViewStatus && (
            <Button variant="outline-primary" size="sm" className="fw-bold border-2 rounded-pill px-3 shadow-none" onClick={() => checkHealth()} disabled={checking}>
              {checking ? <><Spinner size="sm" className="me-1" /> Verificando...</> : 'Verificar motor'}
            </Button>
          )}
          {canEditConfig && hasAdvancedEngine && (
            <Button
              variant="outline-secondary"
              size="sm"
              className="fw-bold border-2 rounded-pill px-3 shadow-none"
              onClick={() => {
                setConfigTab('ai')
                setActiveTab('configuracion')
              }}
            >
              <Settings size={14} className="me-1" /> Configuracion IA
            </Button>
          )}
          {canViewLogs && (
            <Button variant="outline-secondary" size="sm" className="fw-bold border-2 rounded-pill px-3 shadow-none" onClick={() => setIaLogs([makeLog('system', 'Consola limpia.')])}>
              Limpiar consola
            </Button>
          )}
        </div>
      </div>

      <Row className="g-3 mb-3 flex-grow-1 overflow-hidden motor-ia-workspace" style={{ minHeight: 0 }}>
        {!hasAdvancedEngine && hasBasicAiExecution && (
          <Col xs={12}>
            <Alert variant="info" className="small mb-0 border-0 shadow-sm">
              Community permite ejecutar pruebas con IA basica desde <strong>Ejecutar Pruebas</strong> y probar casos con <strong>Dry-run IA</strong>.
              La configuracion de proveedores, workflows, presets y trazas avanzadas se habilita con Treseko Premium.
            </Alert>
          </Col>
        )}
        {canViewLogs && <Col md={8} lg={9} className="d-flex flex-column h-100">
          <Card className="border-0 shadow-sm bg-dark text-white rounded-3 flex-grow-1 d-flex flex-column overflow-hidden h-100">
            <Card.Header className="bg-black bg-opacity-50 border-0 py-2 px-3 d-flex flex-wrap align-items-center justify-content-between gap-2">
              <div className="d-flex align-items-center gap-2">
                <Badge bg="dark" className="border border-secondary text-light">{logs.length} eventos</Badge>
                {runningCount > 0 && <Badge bg="primary">{runningCount} en ejecucion</Badge>}
              </div>
              <Badge bg={runningCount > 0 || iaStatus === 'running' ? 'danger animate-pulse' : 'success'} className="x-small">
                {runningCount > 0 || iaStatus === 'running' ? 'RUNNING' : 'IDLE'}
              </Badge>
            </Card.Header>
            <Card.Body
              ref={consoleRef}
              className="p-3 bg-black flex-grow-1 overflow-auto font-monospace small text-start"
              style={{ minHeight: 0 }}
              onScroll={(event) => {
                const element = event.currentTarget
                shouldAutoScrollRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 32
              }}
            >
              {logs.map((log, index) => {
                const agentLabel = agentDisplayName(log.agent || log.source)
                return (
                  <div key={`${log.ts}-${index}`} className="text-light mb-1">
                    <span className="text-muted">[{formatLogTime(log.ts)}]</span>{' '}
                    {(log.agent || log.source) && (
                      <span className={agentClass(log.agent || log.source)} title={log.agent || log.source}>
                        [{agentLabel}]
                      </span>
                    )}{' '}
                    {log.caseCode && <span className="text-info">{log.caseCode}</span>}{' '}
                    <span className={logClass(log.level)}>{formatConsoleMessage(log)}</span>
                    {(log.step || log.attempt || typeof log.confidence === 'number' || formatMetrics(log.metrics)) && (
                      <span className="text-muted">
                        {' '}({[
                          log.step ? `paso ${log.step}` : '',
                          log.attempt ? `intento ${log.attempt}` : '',
                          typeof log.confidence === 'number' ? `conf ${log.confidence}%` : '',
                          formatMetrics(log.metrics),
                        ].filter(Boolean).join(' · ')})
                      </span>
                    )}
                  </div>
                )
              })}
            </Card.Body>
          </Card>
        </Col>}

        <Col md={canViewLogs ? 4 : 12} lg={canViewLogs ? 3 : 12} className="d-flex flex-column h-100 overflow-auto motor-ia-side-panel">
          {canViewStatus && <Card className="border-0 shadow-sm rounded-3 bg-white p-3 mb-3 text-start">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <h6 className="fw-bold text-secondary m-0 d-flex align-items-center gap-2">
                <PlugZap size={16} /> Estado del Motor IA
              </h6>
              <Badge bg={healthBadgeVariant}>
                {healthLabel}
              </Badge>
            </div>
            <div className="x-small text-muted">
              {engineProcessOnline
                ? `Engine ${directEnginePayload?.version || enginePayload?.version || 'activo'}${llmOnline ? ' y modelo disponible.' : '; revisa el proveedor/modelo configurado.'}`
                : liveActivity
                  ? 'Hay una ejecucion activa. Verificando health del engine en segundo plano.'
                : 'Servicio interno gestionado por la aplicacion. La conexion y el puerto no se configuran desde esta pantalla.'}
            </div>
            <div className="x-small text-muted mt-1">
              Ultima verificacion: {lastHealthCheckedAt ? formatLogTime(lastHealthCheckedAt) : 'pendiente'}
            </div>
            {healthRefreshError && healthStatus !== 'error' && (
              <div className="x-small text-warning mt-1">Ultimo refresco: {healthRefreshError}</div>
            )}
            {health?.detail && <Alert variant="warning" className="py-2 px-3 mt-2 mb-0 x-small">{health.detail}</Alert>}
          </Card>}

          {canViewWorkflows && <Card className="border-0 shadow-sm rounded-3 bg-white p-3 mb-3">
            <div className="d-flex align-items-start justify-content-between gap-2 mb-3">
              <div>
                <h6 className="fw-bold text-secondary mb-1 d-flex align-items-center gap-2 text-start">
                  <LayoutList size={16} /> Cola de Ejecucion ({visibleQueueItems.length})
                </h6>
                <div className="x-small text-muted text-start">Vista temporal. Ocultar no elimina historial ni reportes.</div>
              </div>
              {hiddenFinishedCount > 0 && (
                <Button variant="link" size="sm" className="x-small p-0 text-decoration-none flex-shrink-0" onClick={clearHiddenQueueItems}>
                  Mostrar ocultas
                </Button>
              )}
            </div>
            {visibleQueueItems.length > 0 ? (
              <ListGroup variant="flush" className="small">
                {visibleQueueItems.map(item => {
                  const meta = statusMeta[item.status as IaRunStatus] || statusMeta.EN_ESPERA
                  return (
                    <ListGroup.Item key={`${item.executionId || 'waiting'}-${item.caseId}`} className="px-0 py-3 bg-transparent text-dark border-light position-relative pe-4">
                      <div className="d-flex justify-content-between align-items-start gap-2">
                        <div className="min-w-0">
                          <div className="fw-bold text-dark text-truncate">
                            <span className="text-primary me-1">{item.caseCode}</span>
                            {item.caseTitle}
                          </div>
                          {item.runName && <div className="x-small text-muted text-truncate">{item.runName}</div>}
                        </div>
                        <div className="d-flex align-items-center gap-1 flex-shrink-0">
                          <Badge bg={meta.bg} text={meta.text as any}>{meta.label}</Badge>
                          <Button
                            variant="link"
                            size="sm"
                            className="p-0 text-muted lh-1"
                            title="Quitar de esta cola"
                            aria-label={`Quitar ${item.caseCode} de la cola temporal`}
                            onClick={() => hideQueueItem(item)}
                          >
                            <X size={15} />
                          </Button>
                        </div>
                      </div>
                      <div className="d-flex flex-wrap gap-2 align-items-center mt-2 x-small text-muted">
                        <Badge bg="light" text="dark" className="border">{item.component}</Badge>
                        {item.startedAt && <span>Tiempo {formatElapsed(item.startedAt, item.endedAt)}</span>}
                        {item.lastStep && <span>Paso {item.lastStep}</span>}
                        {typeof item.confidence === 'number' && <span>Conf. {item.confidence}%</span>}
                        {item.consensus && <span>Consenso {item.consensus}</span>}
                      </div>
                      {item.humanReviewRequired && <Badge bg="danger" className="mt-2">Requiere revision humana</Badge>}
                      {item.lastMessage && <div className="x-small text-muted mt-2 text-truncate">{item.lastMessage}</div>}
                      {item.executionId && canViewLogs && (
                        <Button variant="outline-primary" size="sm" className="mt-2 rounded-pill x-small" onClick={() => openAiReport(item.executionId)}>
                          Ver reporte
                        </Button>
                      )}
                    </ListGroup.Item>
                  )
                })}
              </ListGroup>
            ) : (
              <div className="text-muted text-center x-small py-4">
                {queueItems.length > 0 ? 'Todas las ejecuciones estan ocultas en esta vista temporal.' : 'No hay casos en la cola de ejecucion.'}
              </div>
            )}
            {visibleQueueItems.length > 0 && (
              <div className="d-grid gap-2 mt-2">
                {finishedQueueItemsCount > 0 && (
                  <Button variant="outline-primary" size="sm" className="rounded-pill shadow-none" onClick={hideFinishedQueueItems}>
                    Limpiar finalizadas
                  </Button>
                )}
                <Button variant="outline-secondary" size="sm" className="rounded-pill shadow-none" onClick={() => {
                  setIaQueue((prev: string[]) => prev.filter(id => !currentProjectIaQueue.includes(id)))
                  setIaExecutionStreams([])
                  setHiddenQueueItems(new Set())
                }}>
                  Limpiar cola local
                </Button>
              </div>
            )}
            {iaExecutionStreams.length > 0 && (
              <Button variant="outline-secondary" size="sm" className="mt-2 rounded-pill shadow-none" onClick={() => setIaExecutionStreams([])}>
                Desconectar streams
              </Button>
            )}
          </Card>}

          {showQueueHelp && (
            <Alert variant="info" className="small position-relative pe-4">
              <Button
                variant="link"
                size="sm"
                className="position-absolute top-0 end-0 p-2 text-info"
                title="Ocultar ayuda"
                aria-label="Ocultar ayuda de Motor IA"
                onClick={() => setShowQueueHelp(false)}
              >
                <X size={14} />
              </Button>
              Para ejecutar casos con IA usa <strong>Ejecutar Pruebas</strong> y selecciona <strong>IA Agent Engine</strong>.
              Para probar un caso sin historial usa <strong>Dry-run IA</strong> desde el editor de casos.
            </Alert>
          )}
        </Col>
      </Row>
      <AiExecutionReportModal
        show={reportState.show}
        loading={reportState.loading}
        error={reportState.error}
        report={reportState.report}
        onHide={() => setReportState({ show: false, loading: false, error: '', report: null })}
        onMarkReviewed={markAiReportReviewed}
      />
    </div>
  )
}
