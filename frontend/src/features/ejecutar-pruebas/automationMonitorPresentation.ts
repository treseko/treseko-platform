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

export const parsePlaywrightFailureDetails = (value?: string | null) => {
  const lines = String(value || '').split(/\r?\n/)
  const failureIndex = lines.findIndex(line => /^\s*-\s*(FAILED|TIMEDOUT|INTERRUPTED|UNEXPECTED)\s*\|/i.test(line))
  const titleMatch = failureIndex >= 0
    ? lines[failureIndex].match(/^\s*-\s*[^|]+\|\s*(.*?)\s*\|\s*\d+\s*ms\s*$/i)
    : null
  const errorsIndex = failureIndex >= 0
    ? lines.findIndex((line, index) => index > failureIndex && /^\s*errores?:\s*$/i.test(line))
    : -1
  const message = errorsIndex >= 0
    ? lines.slice(errorsIndex + 1).find(line => line.trim() && !/^\s*at\s/.test(line))?.trim().slice(0, 500) || ''
    : ''
  const stack = lines.slice(Math.max(failureIndex, 0)).join('\n')
  const locationMatch = stack.match(/(?:^|[(/\\])([^/\\\s()]+\.spec\.[cm]?[jt]sx?):(\d+):(\d+)\)?/m)

  if (!titleMatch && !message && !locationMatch) return null
  return {
    testTitle: titleMatch?.[1] || '',
    message,
    location: locationMatch ? { file: locationMatch[1], line: Number(locationMatch[2]), column: Number(locationMatch[3]) } : null,
  }
}

export const parseScriptFailureDetails = (value?: string | null) => {
  const text = String(value || '')
  const playwright = parsePlaywrightFailureDetails(text)
  if (playwright) return playwright
  const lines = text.split(/\r?\n/)
  const locationMatch = text.match(/File "([^"\n]+)", line (\d+)(?:, in ([^\n]+))?|(?:at\s+.*?\()?([^\s()]+\.(?:spec\.)?[cm]?[jt]sx?):(\d+):(\d+)\)?/m)
  const messageLine = [...lines].reverse().find(line => /^\s*(?:AssertionError|[A-Za-z_$][\w.$]*(?:Error|Exception)):\s*\S|^\s*(?:Error|AssertionError|Exception):\s*\S/i.test(line.trim()))
    || lines.find(line => /^\s*(?:FAIL|FAILED|✗|×)\b/i.test(line.trim()))
    || ''
  const message = messageLine.trim().slice(0, 500)
  const location = locationMatch
    ? locationMatch[1]
      ? { file: locationMatch[1].split(/[\\/]/).pop() || locationMatch[1], line: Number(locationMatch[2]), column: null as number | null, context: locationMatch[3] || '' }
      : { file: locationMatch[4].split(/[\\/]/).pop() || locationMatch[4], line: Number(locationMatch[5]), column: Number(locationMatch[6]), context: '' }
    : null
  if (!message && !location) return null
  return { testTitle: '', message, location }
}

export const automationFailurePresentation = (row: any, resultDetail: string, apiBase: string) => {
  const parsed: any = row.status !== 'PASSED' ? parseScriptFailureDetails(resultDetail || row.error) : null
  const metadata = row.detail?.metadata_resultado || row.metadata_resultado || {}
  const lineOffset = Number(metadata.script_line_offset)
  if (parsed?.location && Number.isInteger(lineOffset) && lineOffset !== 0) {
    const workerLocation = { ...parsed.location }
    parsed.location = {
      ...parsed.location,
      line: Math.max(1, parsed.location.line - lineOffset),
      workerLocation,
    }
  }
  const fallbackMessage = String(row.error || '').split(/\r?\n/).find(line => line.trim())?.trim().slice(0, 500)
  const failure = parsed || (row.status !== 'PASSED' && fallbackMessage ? { testTitle: '', message: fallbackMessage, location: null } : null)
  const artifact = (Array.isArray(row.artifacts) ? row.artifacts : Array.isArray(metadata.artifacts) ? metadata.artifacts : []).find((item: any) => String(item.content_type || '').startsWith('video/'))
  const href = artifact?.public_url?.startsWith('http') ? artifact.public_url : artifact?.public_url ? `${apiBase}${artifact.public_url}` : artifact?.base64 ? `data:${artifact.content_type};base64,${artifact.base64}` : ''
  return { failure, video: artifact && href ? { href, filename: artifact.filename || 'video.webm', contentType: artifact.content_type } : null }
}

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
