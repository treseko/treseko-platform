type Translate = (key: string) => string

const systemStatusKeys: Record<string, string> = {
  ONLINE: 'systemStatusOnline',
  BUSY: 'systemStatusBusy',
  RUNNING: 'systemStatusRunning',
  OFFLINE: 'systemStatusOffline',
  DISABLED: 'systemStatusDisabled',
  DEGRADED: 'systemStatusDegraded',
  NOT_CONFIGURED: 'systemStatusNotConfigured',
}

const updateStatusKeys: Record<string, string> = {
  idle: 'updateStateIdle',
  queued: 'updateStateQueued',
  in_progress: 'updateStateInProgress',
  restarting: 'updateStateRestarting',
  done: 'updateStateDone',
  failed: 'updateStateFailed',
  interrupted: 'updateStateInterrupted',
}

const updateStageKeys: Record<string, string> = {
  started: 'updateStageStarted',
  queued: 'updateStageQueued',
  validating: 'updateStageValidating',
  preflight: 'updateStagePreflight',
  downloading: 'updateStageDownloading',
  verifying: 'updateStageVerifying',
  backing_up_code: 'updateStageBackingUpCode',
  backing_up_db: 'updateStageBackingUpDatabase',
  backing_up_database: 'updateStageBackingUpDatabase',
  extracting: 'updateStageExtracting',
  prepared: 'updateStagePrepared',
  ready_to_restart: 'updateStageReadyToRestart',
  apply_pending: 'updateStageApplyPending',
  prepare_pending: 'updateStagePreparePending',
  restarting: 'updateStageRestarting',
  applying: 'updateStageApplying',
  migrating: 'updateStageMigrating',
  interrupted: 'updateStageInterrupted',
  rolling_back: 'updateStageRollingBack',
  rollback: 'updateStageRollingBack',
  rollback_restored: 'updateStageCodeRestored',
  rollback_db_restored: 'updateStageDatabaseRestored',
  rolled_back: 'updateStageRolledBack',
  applied: 'updateStageApplied',
  failed: 'updateStageFailed',
}

const label = (value: unknown, keys: Record<string, string>, t: Translate) => {
  const raw = String(value ?? '').trim()
  return keys[raw] ? t(`configuracion.${keys[raw]}`) : raw
}

export const systemStatusLabel = (status: unknown, t: Translate) =>
  label(typeof status === 'string' ? status.toUpperCase() : status, systemStatusKeys, t)

export const updateStatusLabel = (status: unknown, t: Translate) =>
  label(typeof status === 'string' ? status.toLowerCase() : status, updateStatusKeys, t)

export const updateStageLabel = (stage: unknown, t: Translate) =>
  label(typeof stage === 'string' ? stage.toLowerCase() : stage, updateStageKeys, t)

export const systemMonitorDetailLabel = (detail: unknown, t: Translate) => {
  const raw = String(detail ?? '')
  return /all connection attempts failed/i.test(raw)
    ? t('configuracion.systemMonitorAiConnectionFailed')
    : raw
}
