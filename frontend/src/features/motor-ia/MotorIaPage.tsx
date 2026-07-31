import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Row, Col, Card, Badge, Button, ListGroup, Alert, Spinner } from 'react-bootstrap'
import { Cpu, LayoutList, PlugZap, Settings, X } from 'lucide-react'
import { API_BASE } from '../../app/constants'
import { AiExecutionReportModal } from './AiExecutionReportModal'
import { formatTime } from '../../shared/utils/dateTime'
import { WorkspaceContextEmptyState } from '../../shared/components/WorkspaceContextEmptyState'
import { useI18n } from '../../i18n'
import { MotorIaView } from './MotorIaView'
import { useMotorIaMonitorState } from './useMotorIaMonitorState'

export type MotorIaTranslator = (key: any, params?: Record<string, string | number>) => string

export type IaLogLevel = 'error' | 'warn' | 'engine' | 'ws' | 'run' | 'system' | 'queue' | 'info'
export type IaRunStatus = 'EN_ESPERA' | 'EN_EJECUCION' | 'PASO' | 'FALLO' | 'BLOQUEADO' | 'ERROR' | 'STREAM_CERRADO'

export type IaLogEntry = {
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

export type IaExecutionStream = {
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

export type IaQueueItem = {
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

export type AiEngineHealthState = {
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
  currentProjectId?: string | null
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

export const nowIso = () => new Date().toISOString()

export const makeLog = (
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

export const normalizeLog = (log: IaLogEntry | string): IaLogEntry => {
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

export const formatLogTime = (ts: string) => {
  return formatTime(ts) || '--:--:--'
}

export const formatElapsed = (start?: string, end?: string, fallbackSeconds?: number) => {
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

export const getStatusMeta = (t: MotorIaTranslator): Record<IaRunStatus, { label: string; bg: string; text?: string }> => ({
  EN_ESPERA: { label: t('motorIa.statusEnEspera'), bg: 'secondary' },
  EN_EJECUCION: { label: t('motorIa.statusEnEjecucion'), bg: 'primary' },
  PASO: { label: t('motorIa.statusPaso'), bg: 'success' },
  FALLO: { label: t('motorIa.statusFallo'), bg: 'danger' },
  BLOQUEADO: { label: t('motorIa.statusBloqueado'), bg: 'primary' },
  ERROR: { label: t('motorIa.statusError'), bg: 'danger' },
  STREAM_CERRADO: { label: t('motorIa.statusStreamCerrado'), bg: 'secondary' },
})

export const logClass = (level: IaLogLevel) => {
  if (level === 'error') return 'text-danger'
  if (level === 'warn') return 'text-warning'
  if (level === 'engine') return 'text-success'
  if (level === 'ws') return 'text-info'
  if (level === 'run') return 'text-primary'
  if (level === 'queue') return 'text-light'
  return 'text-success'
}

const normalizeAgentKey = (agent?: string) => String(agent || '').replace(/\s+/g, '').toUpperCase()

export const agentDisplayName = (t: MotorIaTranslator, agent?: string) => {
  const raw = String(agent || '').trim()
  const value = normalizeAgentKey(raw)
  const labels: Record<string, string> = {
    SYSTEM: t('motorIa.agentSystem'),
    WORKFLOW: t('motorIa.agentWorkflow'),
    BROWSER: t('motorIa.agentBrowser'),
    AI_AGENT: t('motorIa.agentAi'),
    QAGUARD: t('motorIa.agentQaGuard'),
    QA_GUARD: t('motorIa.agentQaGuard'),
    SENTINEL: t('motorIa.agentSentinel'),
    VALIDATOR: t('motorIa.agentValidator'),
    OBSERVER: t('motorIa.agentObserver'),
    CONTEXTRESOLVER: t('motorIa.agentContextResolver'),
    PLANNER: t('motorIa.agentPlanner'),
    SECURITYGUARD: t('motorIa.agentSecurityGuard'),
    EXECUTOR: t('motorIa.agentExecutor'),
    RECOVERY: t('motorIa.agentRecovery'),
    AUDITOR: t('motorIa.agentAuditor'),
    REPORTER: t('motorIa.agentReporter'),
    AGENT_LOG: t('motorIa.agent'),
    STREAM_DOM_LOG: t('motorIa.stream'),
    EXECUTION_FINISHED: t('motorIa.executionFinished'),
  }
  return labels[value] || raw || t('motorIa.engineName')
}

export const agentClass = (agent?: string) => {
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

const summarizeStartMessage = (t: MotorIaTranslator, message: string) => {
  const match = message.match(/Iniciando tarea:\s*Ejecutar caso manual\s+([^:]+):\s*(.+?)(?:\s+Precondiciones:|$)/i)
  if (!match) return message
  return t('motorIa.startingTest', { code: match[1].trim(), title: match[2].trim() })
}

const humanizeWorkflowMessage = (t: MotorIaTranslator, message: string, reason?: string) => {
  const value = message.trim()
  if (/^Ejecutando workflow\s+/i.test(value)) {
    return value.replace(/^Ejecutando workflow\s+/i, `${t('motorIa.workflowStarted')}: `)
  }
  if (/^Context Resolver:\s*SUCCESS$/i.test(value)) return t('motorIa.contextResolved')
  if (/^Observer:\s*SUCCESS$/i.test(value)) return t('motorIa.observationCompleted')
  if (/^Observer:\s*BLOCKED$/i.test(value) && reason === 'no_more_steps') return t('motorIa.observationFinished')
  if (/^Observer:\s*sin mas pasos$/i.test(value)) return t('motorIa.observationFinished')
  if (/^Planner:\s*SUCCESS$/i.test(value)) return t('motorIa.actionPlanPrepared')
  if (/^Security Guard:\s*SUCCESS$/i.test(value)) return t('motorIa.actionApproved')
  if (/^Executor:\s*SUCCESS$/i.test(value)) return t('motorIa.stepsCompleted')
  if (/^Validator:\s*SUCCESS$/i.test(value)) return t('motorIa.resultValidated')
  if (/^Auditor:\s*SUCCESS$/i.test(value)) return t('motorIa.workflowAudited')
  if (/^Reporter:\s*SUCCESS$/i.test(value)) return t('motorIa.reportPrepared')
  if (/^Paso\s+\d+:\s*solicitando accion estricta/i.test(value)) {
    return value.replace(/solicitando accion estricta/i, t('motorIa.consultingModel'))
  }
  if (/^Paso\s+\d+:\s*Validacion funcional no requerida/i.test(value)) {
    return value.replace(/Validacion funcional no requerida/i, t('motorIa.functionalValidationSkipped'))
  }
  if (/^Test\s+[0-9a-f-]{20,}\s+finalizado\./i.test(value)) {
    return t('motorIa.technicalExecutionClosed')
  }
  return value
}

export const formatConsoleMessage = (t: MotorIaTranslator, log: IaLogEntry) => {
  const withoutPrefix = cleanDuplicateCasePrefix(log.message, log.caseCode)
  return humanizeWorkflowMessage(t, summarizeStartMessage(t, withoutPrefix), log.reason)
}

export const formatMetrics = (t: MotorIaTranslator, metrics?: Record<string, any>) => {
  if (!metrics) return ''
  const tokens = metrics.totalTokens ?? metrics.total_tokens
  const latency = metrics.latencyMs ?? metrics.latency_ms
  const cost = metrics.estimatedCost ?? metrics.estimated_cost
  const parts = []
  if (tokens !== undefined) parts.push(`${tokens} ${t('motorIa.tokensShort')}`)
  if (latency !== undefined) parts.push(`${latency}ms`)
  if (cost !== undefined) parts.push(`$${Number(cost || 0).toFixed(5)}`)
  return parts.join(' · ')
}

export const normalizeEngineStatus = (value?: string): IaRunStatus => {
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
  currentProjectId,
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
  const { t } = useI18n()
  const statusMeta = getStatusMeta(t)
  const canUseCapability = canAccessCapability || (() => true)
  const featureEnabled = hasSystemFeature || (() => true)
  const canViewStatus = canUseCapability('motor_ia.ver', 'read')
  const canEditConfig = canUseCapability('motor_ia.configuracion', 'edit')
  const canViewLogs = canUseCapability('motor_ia.logs', 'read')
  const canViewWorkflows = canUseCapability('motor_ia.workflows', 'read')
  const hasAiEngine = featureEnabled('ai.engine') || featureEnabled('ai.basic_execution')

  const monitor = useMotorIaMonitorState({
    options: {
      currentProjectId,
      t,
      fetchWithAuth,
      showFeedback,
      canViewStatus,
      iaStatus,
      iaLogs,
      setIaLogs,
      currentProjectIaQueue,
      iaExecutionStreams,
      setIaExecutionStreams,
      setIaQueue,
      currentProjectCases,
    },
  })

  if (!currentProjectId) {
    return (
      <WorkspaceContextEmptyState
        message={t('motorIa.noProjectSelected')}
        detail={t('motorIa.noProjectDetail')}
      />
    )
  }

  return <MotorIaView options={{
    ...monitor,
    t, canEditConfig, canViewLogs, canViewStatus, canViewWorkflows,
    setActiveTab, setConfigTab, setIaQueue, setIaExecutionStreams, setIaLogs,
    iaStatus, iaExecutionStreams, currentProjectIaQueue, hasAiEngine,
  }} />
}
