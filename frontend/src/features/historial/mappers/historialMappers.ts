export const emptyHistorialFilters = {
  case_query: '',
  case_code: '',
  build_id: '',
  component_id: '',
  status: '',
  origin: '',
  runner_id: '',
  environment_id: '',
  dataset_id: '',
  date_from: '',
  date_to: '',
  has_evidence: '',
  version_executed: '',
  ai_review_status: ''
}

export const getExecutionModeBadge = (mode?: string) => {
  const value = String(mode || '').toUpperCase()
  if (value === 'IA') return 'primary'
  if (value === 'AUTOMATIZADA') return 'info'
  if (value === 'EXTERNA') return 'success'
  if (value === 'MIXTO') return 'warning'
  return 'secondary'
}

export const getEffectiveRunExecutionMode = (run: any) => {
  const origin = String(run.origin || '').toUpperCase()
  if (origin === 'IA') return { summary: 'IA', label: 'IA', detail: '' }
  return {
    summary: run.executionModeSummary || 'MANUAL',
    label: run.executionModeLabel || 'Manual',
    detail: run.executionModeDetail || ''
  }
}

export const createHistoryComparisonData = (runHistory: any[], currentProjectId: string) => {
  return runHistory
    .filter(run => run.projectId === currentProjectId)
    .slice()
    .reverse()
    .map(run => ({ version: run.runId, passed: run.passed, failed: run.failed }))
}
