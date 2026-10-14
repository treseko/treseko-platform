import { emptyHistorialFilters } from './mappers/historialMappers'

export const historyFilterLabels: Record<string, string> = {
  case_query: 'searchCase', case_code: 'exactCode', build_id: 'build', component_id: 'component',
  status: 'caseStatus', run_result: 'runResult', origin: 'runOrigin', runner_id: 'executor',
  environment_id: 'environment', dataset_id: 'dataset', date_from: 'from', date_to: 'to',
  has_evidence: 'evidence', version_executed: 'executedVersion', ai_review_status: 'iaReview',
}
const basicKeys = new Set(['case_query', 'build_id', 'status', 'run_result'])
export function activeHistoryFilters(filters: Record<string, any> = {}) {
  return Object.keys(emptyHistorialFilters).filter(key => filters[key] !== '' && filters[key] != null)
    .map(key => ({ key, value: String(filters[key]), label: historyFilterLabels[key] }))
}
export function advancedHistoryFilterCount(filters: Record<string, any> = {}) {
  return activeHistoryFilters(filters).filter(filter => !basicKeys.has(filter.key)).length
}
