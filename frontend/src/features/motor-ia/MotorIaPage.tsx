import { useEffect, useMemo, useRef, useState } from 'react'
import { Row, Col, Card, Badge, Button, ListGroup, Alert, Spinner } from 'react-bootstrap'
import { Cpu, LayoutList, PlugZap, Settings } from 'lucide-react'
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
  metrics?: Record<string, any>
}

type IaExecutionStream = {
  executionId: string
  caseId: string
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

const agentClass = (agent?: string) => {
  const value = String(agent || '').toUpperCase()
  if (value === 'QA_GUARD') return 'text-warning'
  if (value === 'AUDITOR') return 'text-info'
  if (value === 'AI_AGENT') return 'text-primary'
  if (value === 'SENTINEL') return 'text-light'
  if (value === 'BROWSER') return 'text-success'
  if (value === 'RECOVERY') return 'text-warning'
  return 'text-secondary'
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

  const [health, setHealth] = useState<any>(null)
  const [checking, setChecking] = useState(false)
  const [clockTick, setClockTick] = useState(0)
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
          const prefix = stream.caseCode || stream.caseTitle || stream.executionId
          const step = data.step || data.step_number || data.numero_paso || ''
          const text = data.text || data.message || data.detail || data.log || JSON.stringify(data)
          const isStepResult = eventType === 'STEP_RESULT' || Boolean(data.status)
          const nextStatus = isStepResult ? normalizeEngineStatus(data.status) : 'EN_EJECUCION'
          updateStream(stream.executionId, {
            status: nextStatus,
            startedAt: stream.startedAt || ts,
            endedAt: ['PASO', 'FALLO', 'BLOQUEADO', 'ERROR'].includes(nextStatus) && isStepResult ? ts : undefined,
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
              message: `${prefix}${step ? ` paso ${step}` : ''}${data.status ? ` [${data.status}]` : ''}: ${text}`,
              executionId: stream.executionId,
              caseCode: stream.caseCode,
              step,
              attempt: data.attempt,
              confidence: data.confidence,
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

  const checkHealth = async () => {
    setChecking(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/ai-engine/health`)
      if (!response.ok) throw new Error(`Backend respondio ${response.status}`)
      const data = await response.json()
      setHealth(data)
      pushLog('engine', `Motor IA -> ${data.status}${data.detail ? ` (${data.detail})` : ''}`)
    } catch (error: any) {
      setHealth({ status: 'error', detail: error.message || 'Motor IA no disponible' })
      pushLog('error', error.message || 'Motor IA no disponible')
      showFeedback('Motor IA', error.message || 'Motor IA no disponible.', 'danger')
    } finally {
      setChecking(false)
    }
  }

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

  const runningCount = queueItems.filter(item => item.status === 'EN_EJECUCION').length
  const healthStatus = health?.status || 'unknown'

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
            <Button variant="outline-primary" size="sm" className="fw-bold border-2 rounded-pill px-3 shadow-none" onClick={checkHealth} disabled={checking}>
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
              {logs.map((log, index) => (
                <div key={`${log.ts}-${index}`} className="text-light mb-1">
                  <span className="text-muted">[{formatLogTime(log.ts)}]</span>{' '}
                  {(log.agent || log.source) && <span className={agentClass(log.agent || log.source)}>[{log.agent || log.source}]</span>}{' '}
                  {log.caseCode && <span className="text-info">{log.caseCode}</span>}{' '}
                  <span className={logClass(log.level)}>{log.message}</span>
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
              ))}
            </Card.Body>
          </Card>
        </Col>}

        <Col md={canViewLogs ? 4 : 12} lg={canViewLogs ? 3 : 12} className="d-flex flex-column h-100 overflow-auto motor-ia-side-panel">
          {canViewStatus && <Card className="border-0 shadow-sm rounded-3 bg-white p-3 mb-3 text-start">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <h6 className="fw-bold text-secondary m-0 d-flex align-items-center gap-2">
                <PlugZap size={16} /> Estado del Motor IA
              </h6>
              <Badge bg={healthStatus === 'ok' ? 'success' : healthStatus === 'error' ? 'danger' : 'secondary'}>
                {healthStatus.toUpperCase()}
              </Badge>
            </div>
            <div className="x-small text-muted">
              Servicio interno gestionado por la aplicacion. La conexion y el puerto no se configuran desde esta pantalla.
            </div>
            {health?.detail && <Alert variant="warning" className="py-2 px-3 mt-2 mb-0 x-small">{health.detail}</Alert>}
          </Card>}

          {canViewWorkflows && <Card className="border-0 shadow-sm rounded-3 bg-white p-3 mb-3">
            <h6 className="fw-bold text-secondary mb-3 d-flex align-items-center gap-2 text-start">
              <LayoutList size={16} /> Cola de Ejecucion ({queueItems.length})
            </h6>
            {queueItems.length > 0 ? (
              <ListGroup variant="flush" className="small">
                {queueItems.map(item => {
                  const meta = statusMeta[item.status as IaRunStatus] || statusMeta.EN_ESPERA
                  return (
                    <ListGroup.Item key={`${item.executionId || 'waiting'}-${item.caseId}`} className="px-0 py-3 bg-transparent text-dark border-light">
                      <div className="d-flex justify-content-between align-items-start gap-2">
                        <div className="min-w-0">
                          <div className="fw-bold text-dark text-truncate">
                            <span className="text-primary me-1">{item.caseCode}</span>
                            {item.caseTitle}
                          </div>
                          {item.runName && <div className="x-small text-muted text-truncate">{item.runName}</div>}
                        </div>
                        <Badge bg={meta.bg} text={meta.text as any} className="flex-shrink-0">{meta.label}</Badge>
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
              <div className="text-muted text-center x-small py-4">No hay casos en la cola de ejecucion.</div>
            )}
            {queueItems.length > 0 && (
              <Button variant="outline-secondary" size="sm" className="mt-2 rounded-pill shadow-none" onClick={() => {
                setIaQueue((prev: string[]) => prev.filter(id => !currentProjectIaQueue.includes(id)))
                setIaExecutionStreams([])
              }}>
                Limpiar cola local
              </Button>
            )}
            {iaExecutionStreams.length > 0 && (
              <Button variant="outline-secondary" size="sm" className="mt-2 rounded-pill shadow-none" onClick={() => setIaExecutionStreams([])}>
                Desconectar streams
              </Button>
            )}
          </Card>}

          <Alert variant="info" className="small">
            Para ejecutar casos con IA usa <strong>Ejecutar Pruebas</strong> y selecciona <strong>IA Agent Engine</strong>.
            Para probar un caso sin historial usa <strong>Dry-run IA</strong> desde el editor de casos.
          </Alert>
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
