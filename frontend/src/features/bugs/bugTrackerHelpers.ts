import { BUG_PRIORITY_OPTIONS } from './bugPresentation'

const severityVariant: Record<string, string> = {
  CRITICA: 'danger',
  ALTA: 'warning',
  MEDIA: 'primary',
  BAJA: 'secondary',
  COSMETICA: 'light',
}
const closedStates = new Set(['RESUELTO', 'CERRADO', 'DUPLICADO', 'NO_REPRODUCIBLE', 'NO_CORRESPONDE'])
const statusOptions = ['ABIERTO','TRIAGE','ASIGNADO','EN_PROGRESO','LISTO_PARA_RETEST','EN_RETEST','RESUELTO','REABIERTO','CERRADO','DUPLICADO','NO_REPRODUCIBLE','NO_CORRESPONDE','BLOQUEADO']
const bugStatusHelp = [
  { group: 'activeGroup', items: [
    ['ABIERTO', 'activeStatusDescription'],
    ['TRIAGE', 'triageStatusDescription'],
    ['ASIGNADO', 'assignedStatusDescription'],
    ['EN_PROGRESO', 'inProgressStatusDescription'],
    ['BLOQUEADO', 'blockedStatusDescription'],
    ['REABIERTO', 'reopenedStatusDescription'],
  ]},
  { group: 'retestGroup', items: [
    ['LISTO_PARA_RETEST', 'readyRetestStatusDescription'],
    ['EN_RETEST', 'retestStatusDescription'],
  ]},
  { group: 'closureGroup', items: [
    ['RESUELTO', 'resolvedStatusDescription'],
    ['CERRADO', 'closedStatusDescription'],
    ['DUPLICADO', 'duplicateStatusDescription'],
    ['NO_REPRODUCIBLE', 'notReproducibleStatusDescription'],
    ['NO_CORRESPONDE', 'notApplicableStatusDescription'],
  ]},
]
const severityOptions = ['CRITICA','ALTA','MEDIA','BAJA','COSMETICA']
const priorityOptions = BUG_PRIORITY_OPTIONS
const EXTERNAL_ISSUE_PROVIDERS = [
  { id: 'redmine', label: 'Redmine' },
  { id: 'jira', label: 'Jira' },
  { id: 'github_issues', label: 'GitHub Issues' },
  { id: 'gitlab_issues', label: 'GitLab Issues' },
  { id: 'azure_devops', label: 'Azure DevOps' },
  { id: 'youtrack', label: 'YouTrack' },
  { id: 'linear', label: 'Linear' },
  { id: 'servicenow', label: 'ServiceNow' },
]
const externalIssueLabel = (bug: any) => bug?.external_issue_id
  ? `${EXTERNAL_ISSUE_PROVIDERS.find(item => item.id === bug.external_provider)?.label || bug.external_provider || 'Externo'} #${bug.external_issue_id}`
  : ''
const compactUnique = (items: string[]) => Array.from(new Set(items.map(item => String(item || '').trim()).filter(Boolean)))
const bugBuildOriginLabel = (bug: any) => (
  bug?.metadata_json?.build_name ||
  bug?.version_app ||
  bug?.build_name ||
  bug?.build_code ||
  ''
)
const bugComponentLabel = (bug: any) => (
  bug?.metadata_json?.component_name ||
  bug?.modulo_funcional ||
  ''
)
const bugOccurrenceBuilds = (bug: any) => {
  const occurrences = bug?.metadata_json?.linked_execution_occurrences || []
  if (!Array.isArray(occurrences)) return []
  const origin = bugBuildOriginLabel(bug)
  return compactUnique(
    occurrences
      .map((item: any) => item?.build_name || item?.build_code || item?.build || '')
      .filter((item: string) => item && item !== origin)
  )
}
const bugTraceLabel = (bug: any, t: (key: any, params?: any) => string) => {
  const origin = bugBuildOriginLabel(bug) || t('bugs.noDataset')
  const occurrences = bugOccurrenceBuilds(bug)
  if (occurrences.length === 0) return t('bugs.detectedIn', { build: origin })
  return t('bugs.detectedInAndFollowing', { origin, occurrences: occurrences.join(', ') })
}
const apiErrorMessage = async (response: Response) => {
  const text = await response.text()
  try {
    const payload = JSON.parse(text)
    return payload?.detail || payload?.message || text
  } catch {
    return text
  }
}



export {
  EXTERNAL_ISSUE_PROVIDERS, bugBuildOriginLabel, bugComponentLabel, bugOccurrenceBuilds, bugStatusHelp,
  compactUnique,
  bugTraceLabel, closedStates, externalIssueLabel, priorityOptions, severityOptions, severityVariant, statusOptions,
  apiErrorMessage,
}
