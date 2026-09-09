export const UPDATE_MAINTENANCE_STORAGE_KEY = 'treseko_update_maintenance_until'
export const UPDATE_MAINTENANCE_EVENT = 'treseko:update-maintenance'
export const UPDATE_MAINTENANCE_TIMEOUT_MS = 120 * 1000
export const TERMINAL_UPDATE_STATUSES = new Set(['done', 'failed'])

export type UpdateMaintenanceState = {
  active: boolean
  timedOut?: boolean
  until: number
  message: string
  targetVersion?: string
  lastCheckedAt?: number
  backendVersion?: string
  taskId?: string
}

type StoredUpdateMaintenanceSignal = {
  until: number
  targetVersion?: string
  taskId?: string
}

export function readUpdateMaintenanceSignal(): UpdateMaintenanceState {
  const raw = localStorage.getItem(UPDATE_MAINTENANCE_STORAGE_KEY) || ''
  let stored: StoredUpdateMaintenanceSignal = { until: Number(raw) }
  if (raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as Partial<StoredUpdateMaintenanceSignal>
      stored = {
        until: Number(parsed.until),
        targetVersion: typeof parsed.targetVersion === 'string' ? parsed.targetVersion : undefined,
        taskId: typeof parsed.taskId === 'string' ? parsed.taskId : undefined,
      }
    } catch {
      stored = { until: 0 }
    }
  }
  const until = stored.until
  const active = Number.isFinite(until) && until > Date.now()
  const timedOut = Boolean(raw && Number.isFinite(until) && until > 0 && until <= Date.now())
  if (!active && !timedOut && raw) {
    localStorage.removeItem(UPDATE_MAINTENANCE_STORAGE_KEY)
  }
  return {
    active,
    timedOut,
    until: active || timedOut ? until : 0,
    targetVersion: active || timedOut ? stored.targetVersion : undefined,
    taskId: active || timedOut ? stored.taskId : undefined,
    message: timedOut
      ? 'No se pudo confirmar el reinicio dentro del tiempo esperado. Reintenta o revisa el estado del backend.'
      : 'Treseko esta aplicando una actualizacion. El servicio puede tardar unos minutos en volver.',
  }
}

export function updateMaintenanceConnectionState(patch: Partial<Pick<UpdateMaintenanceState, 'message' | 'lastCheckedAt' | 'backendVersion'>>) {
  const current = readUpdateMaintenanceSignal()
  return {
    ...current,
    ...patch,
    active: current.active,
    until: current.until,
  }
}

export function announceUpdateMaintenance(durationMs = UPDATE_MAINTENANCE_TIMEOUT_MS, targetVersion?: string | null, taskId?: string | null) {
  const current = readUpdateMaintenanceSignal()
  const normalizedTargetVersion = targetVersion || current.targetVersion
  const normalizedTaskId = taskId || current.taskId
  if (current.active && current.targetVersion === normalizedTargetVersion && current.taskId === normalizedTaskId) {
    window.dispatchEvent(new CustomEvent(UPDATE_MAINTENANCE_EVENT))
    return current
  }
  const until = Date.now() + durationMs
  localStorage.setItem(UPDATE_MAINTENANCE_STORAGE_KEY, JSON.stringify({
    until,
    targetVersion: normalizedTargetVersion,
    taskId: normalizedTaskId,
  }))
  window.dispatchEvent(new CustomEvent(UPDATE_MAINTENANCE_EVENT))
  return readUpdateMaintenanceSignal()
}

export function isTerminalUpdateStatus(status?: unknown, stage?: unknown): boolean {
  if (status === 'failed') return true
  return status === 'done' && stage === 'applied'
}

export function clearUpdateMaintenanceSignal() {
  localStorage.removeItem(UPDATE_MAINTENANCE_STORAGE_KEY)
  window.dispatchEvent(new CustomEvent(UPDATE_MAINTENANCE_EVENT))
}
