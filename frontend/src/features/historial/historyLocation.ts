import { emptyHistorialFilters } from './mappers/historialMappers'

export function readHistoryLocation() {
  const params = new URLSearchParams(window.location.search)
  const filters: Record<string, string> = {}
  if (params.get('tab') !== 'historial') return { filters, limit: 50, skip: 0, runId: '' }
  for (const key of Object.keys(emptyHistorialFilters)) {
    const value = params.get(`h_${key}`)
    if (value) filters[key] = value
  }
  const limit = Number(params.get('h_limit'))
  return { filters, limit: [25, 50, 100].includes(limit) ? limit : 50,
    skip: Math.max(0, Math.floor(Number(params.get('h_skip')) || 0)), runId: params.get('run_id') || '' }
}

export function writeHistoryLocation(filters: Record<string, any>, runId?: string) {
  if (new URLSearchParams(window.location.search).get('tab') !== 'historial') return
  const url = new URL(window.location.href)
  for (const key of [...Object.keys(emptyHistorialFilters), 'skip', 'limit']) {
    const value = filters[key]
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(`h_${key}`, String(value))
    else url.searchParams.delete(`h_${key}`)
  }
  if (runId !== undefined) {
    if (runId) url.searchParams.set('run_id', runId)
    else url.searchParams.delete('run_id')
  }
  window.history.replaceState(window.history.state, '', url)
}
