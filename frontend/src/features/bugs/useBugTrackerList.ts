import { useEffect, useRef, useState } from 'react'
import { API_BASE } from '../../app/constants'
import { apiErrorMessage } from './bugTrackerHelpers'

export const emptyBugFilters = () => ({ q: '', estado: '', severidad: '', prioridad: '', tipo_contexto: '', build_id: '', build_scope: 'reported', scope: 'all', attention: '' })
export type BugFilters = ReturnType<typeof emptyBugFilters>

export function useBugTrackerList({ currentProjectId, currentUserId, canView, refreshToken, initialFilters, fetchWithAuth, t }: any) {
  const [bugs, setBugs] = useState<any[]>([])
  const [summary, setSummary] = useState<any>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [sort, setSort] = useState('newest')
  const [filters, setFilters] = useState<BugFilters>(() => ({ ...emptyBugFilters(), ...initialFilters }))
  const [appliedFilters, setAppliedFilters] = useState(filters)
  const sequence = useRef(0)
  const previousProject = useRef(currentProjectId)
  const options = useRef<any>(null)
  options.current = { currentProjectId, currentUserId, canView, fetchWithAuth, t }
  const listState = useRef<any>(null)
  listState.current = { appliedFilters, page, pageSize, sort }

  const loadBugs = async (settings?: { silent?: boolean }) => {
    const request = ++sequence.current
    const { currentProjectId: project, currentUserId: user, canView: allowed, fetchWithAuth: fetcher, t: translate } = options.current
    if (!project || !allowed) { setBugs([]); setSummary({}); setTotal(0); setLoading(false); return }
    if (!settings?.silent) setLoading(true)
    setError('')
    const state = listState.current
    const params = new URLSearchParams({ limit: String(state.pageSize), skip: String(state.page * state.pageSize), sort: state.sort, include_summary: 'true' })
    Object.entries(state.appliedFilters).forEach(([key, value]) => {
      if (key !== 'scope' && value) params.set(key, String(value))
    })
    if (state.appliedFilters.scope === 'mine') {
      if (!user) { setBugs([]); setSummary({}); setTotal(0); setLoading(false); return }
      params.set('asignado_a', user)
    }
    if (state.appliedFilters.scope === 'unassigned') params.set('sin_asignar', 'true')
    try {
      const response = await fetcher(`${API_BASE}/proyectos/${project}/bugs/?${params}`)
      if (!response.ok) throw new Error(await apiErrorMessage(response))
      const payload = await response.json()
      if (request !== sequence.current) return
      const nextTotal = Number(payload.total || 0)
      setBugs(payload.items || [])
      setSummary(payload.summary || {})
      setTotal(nextTotal)
      const lastPage = Math.max(0, Math.ceil(nextTotal / state.pageSize) - 1)
      if (state.page > lastPage) setPage(lastPage)
    } catch (cause: any) {
      if (request !== sequence.current) return
      setError(cause?.message || translate('bugs.errorLoading'))
    } finally {
      if (request === sequence.current) setLoading(false)
    }
  }
  const initialKey = JSON.stringify(initialFilters || {})
  useEffect(() => {
    if (previousProject.current !== currentProjectId) {
      setBugs([]); setSummary({}); setTotal(0)
      previousProject.current = currentProjectId
    }
    const next = { ...emptyBugFilters(), ...JSON.parse(initialKey) }
    setFilters(next); setAppliedFilters(next); setPage(0)
  }, [initialKey, currentProjectId])
  useEffect(() => {
    void loadBugs()
    return () => { sequence.current++ }
    // Requests read the latest auth functions without reloading on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId, currentUserId, canView, refreshToken, appliedFilters, page, pageSize, sort])
  const applyFilters = (next = filters) => { setFilters(next); setAppliedFilters({ ...next }); setPage(0) }
  const clearFilters = () => applyFilters(emptyBugFilters())
  return { bugs, setBugs, summary, loading, error, total, page, pageSize, sort, filters, appliedFilters, setFilters, loadBugs, applyFilters, clearFilters,
    setPage, setPageSize: (size: number) => { setPageSize(size); setPage(0) }, setSort: (value: string) => { setSort(value); setPage(0) } }
}
