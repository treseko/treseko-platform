import { dateTimeMs, formatDateTime } from '../../../shared/utils/dateTime'
import { languageLabel, normalizeAutomationLanguage } from '../../casos/caseUtils'

export type WorkerRunner = {
  id: string
  nombre: string
  tipo: string
  estado: string
  capabilities: Record<string, any>
  activo: boolean
  ultimo_heartbeat?: string | null
  fecha_creacion?: string | null
}

export type PairingRequest = {
  id: string
  code: string
  nombre: string
  tipo: string
  capabilities: Record<string, any>
  estado: string
  expires_at: string
  fecha_creacion?: string | null
}

export type AutomationJob = {
  id: string
  test_run_id: string
  ejecucion_id: string
  caso_id: string
  build_id?: string | null
  runner_id?: string | null
  estado: string
  required_framework: string
  required_language?: string
  required_runtime?: string | null
  payload_congelado?: Record<string, any>
  logs?: string | null
  error_message?: string | null
  metadata_resultado?: Record<string, any>
  fecha_creacion?: string | null
  fecha_claim?: string | null
  fecha_inicio?: string | null
  fecha_fin?: string | null
}

export const isOffline = (runner: WorkerRunner) => {
  if (!runner.activo || !runner.ultimo_heartbeat) return true
  const lastSeen = dateTimeMs(runner.ultimo_heartbeat)
  return !lastSeen || Date.now() - lastSeen > 60_000
}

export const effectiveStatus = (runner: WorkerRunner) => {
  if (!runner.activo) return 'DISABLED'
  return isOffline(runner) ? 'OFFLINE' : runner.estado || 'ONLINE'
}

export const statusVariant = (status: string) => {
  if (status === 'ONLINE') return 'success'
  if (status === 'BUSY' || status === 'RUNNING') return 'primary'
  if (status === 'DEGRADED') return 'warning'
  return 'secondary'
}

export const isOnlineStatus = (status: string) => ['ONLINE', 'BUSY', 'RUNNING'].includes(status)

export const formatLastSeen = (value?: string | null) => value ? formatDateTime(value) || 'Sin heartbeat' : 'Sin heartbeat'

export const getFrameworks = (capabilities: Record<string, any>) => {
  const frameworks = capabilities.frameworks || capabilities.supported_frameworks || capabilities.framework
  return Array.isArray(frameworks) ? frameworks.join(', ') : frameworks || 'No reportado'
}

export const getFrameworkLanguageRows = (capabilities: Record<string, any>) => {
  const frameworksRaw = capabilities.frameworks || capabilities.supported_frameworks || capabilities.framework
  const frameworks = Array.isArray(frameworksRaw) ? frameworksRaw.map(item => String(item).toLowerCase()) : frameworksRaw ? [String(frameworksRaw).toLowerCase()] : []
  const matrix = capabilities.framework_languages || capabilities.languages || capabilities.supported_languages || {}
  const fallback: Record<string, string[]> = { playwright: ['javascript', 'typescript'], puppeteer: ['javascript', 'typescript'], cypress: ['javascript', 'typescript'], selenium: ['python'] }
  const keys = frameworks.length ? frameworks : Object.keys(matrix)
  if (!keys.length) return [{ framework: 'No reportado', languages: 'No reportado' }]
  return keys.map(framework => ({
    framework,
    languages: (Array.isArray(matrix?.[framework]) ? matrix[framework] : fallback[framework] || []).map((language: string) => languageLabel(normalizeAutomationLanguage(language))).join(', ') || 'No reportado'
  }))
}

export const jobStatusVariant = (status: string) => {
  if (status === 'PASSED') return 'success'
  if (status === 'FAILED') return 'danger'
  if (status === 'ERROR' || status === 'TIMEOUT') return 'warning'
  if (status === 'RUNNING' || status === 'CLAIMED') return 'primary'
  if (status === 'BLOCKED' || status === 'BLOCKED_BY_RUNNER') return 'secondary'
  return 'light'
}

export const formatDuration = (start?: string | null, end?: string | null) => {
  if (!start) return 'n/d'
  const startMs = dateTimeMs(start)
  const endMs = end ? dateTimeMs(end) : Date.now()
  if (!startMs || !endMs) return 'n/d'
  const seconds = Math.max(0, Math.round((endMs - startMs) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
