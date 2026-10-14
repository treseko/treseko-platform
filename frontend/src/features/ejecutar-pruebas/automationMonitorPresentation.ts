import { dateTimeMs } from '../../shared/utils/dateTime'
const SUCCESS_STATUSES = new Set(['PASSED'])
export const FAILED_STATUSES = new Set(['FAILED', 'BLOCKED'])
export const INFRA_STATUSES = new Set(['ERROR', 'TIMEOUT', 'CANCELLED', 'BLOCKED_BY_RUNNER'])
export const statusVariant = (status?: string) => {
  if (!status) return 'secondary'
  if (status === 'PASO') return 'success'
  if (status === 'FALLO') return 'danger'
  if (status === 'BLOQUEADO') return 'primary'
  if (SUCCESS_STATUSES.has(status)) return 'success'
  if (FAILED_STATUSES.has(status)) return status === 'BLOCKED' ? 'primary' : 'danger'
  if (INFRA_STATUSES.has(status)) return 'dark'
  if (status === 'RUNNING') return 'primary'
  if (status === 'CLAIMED') return 'info'
  return 'secondary'
}
export const statusLabel = (status: string | undefined, t: (key: any) => string) => {
  const labels: Record<string, string> = {
    PENDING: t('common.statusPending'), CLAIMED: t('common.statusClaimed'), RUNNING: t('common.statusRunning'), PASSED: t('common.statusPassed'), FAILED: t('common.statusFailed'), BLOCKED: t('common.statusBlocked'), PASO: t('common.statusPassed'), FALLO: t('common.statusFailed'), BLOQUEADO: t('common.statusBlocked'), ERROR: t('common.statusErrorRunner'), TIMEOUT: t('common.statusTimeout'), CANCELLED: t('common.statusCancelled'), BLOCKED_BY_RUNNER: t('common.statusNoWorker')
  }
  return status ? labels[status] || status : t('common.statusNoJob')
}
export const failureCategoryLabel = (category: string | undefined, t: (key: any) => string) => ({ passed: t('common.categoryPassed'), required_element_not_found: t('common.categoryElementMissing'), navigation_error: t('common.categoryNavigation'), expected_result_not_met: t('common.categoryExpectedMissing'), browser_action_failed: t('common.categoryBrowserAction'), model_blocked: t('common.categoryModelBlocked') }[String(category || '')] || category || t('common.categoryUnclassified'))

export const friendlyStepDiagnosis = (step: any, t: (key: any) => string) => {
  const category = String(step?.failure_category || '')
  if (category === 'expected_result_not_met') return t('common.diagnosisExpected')
  if (category === 'required_element_not_found') return t('common.diagnosisElement')
  if (category === 'navigation_error') return t('common.diagnosisNavigation')
  if (category === 'browser_action_failed') return t('common.diagnosisBrowser')
  if (category === 'model_blocked') return t('common.diagnosisBlocked')
  return step?.status === 'PASO' ? t('common.diagnosisPassed') : t('common.diagnosisFailed')
}

export const elapsedLabel = (from?: string, to?: string) => {
  if (!from) return '-'
  const start = dateTimeMs(from)
  const end = to ? dateTimeMs(to) : Date.now()
  if (!start || !end) return '-'
  const seconds = Math.max(0, Math.round((end - start) / 1000))
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`
}
