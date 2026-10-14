import { useCallback, useEffect, useRef, useState } from 'react'
import { createHistorialActions } from '../historialActions'
import { useI18n } from '../../../i18n'

type UseHistorialControllerParams = {
  activeTab: string
  currentProjectId: string
  currentBuildId: string
  projectsSource: 'local' | 'backend'
  initialRunHistory: any[]
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  setProjectSyncMessage: (message: string) => void
  showFeedback: (title: string, message: string, variant?: string) => void
  loadProjectMetrics: () => Promise<void> | void
  setActiveTab: (tab: string) => void
  canAccessCapability?: (capability: string, level?: string) => boolean
}

import { readHistoryLocation, writeHistoryLocation } from '../historyLocation'
export function useHistorialController(params: UseHistorialControllerParams) {
  const { activeTab, currentProjectId, currentBuildId, projectsSource, initialRunHistory,
    canAccessCapability = () => true, setActiveTab } = params
  const { t } = useI18n()
  const initial = useRef<ReturnType<typeof readHistoryLocation> | null>(null)
  if (!initial.current) initial.current = readHistoryLocation()
  const [runHistory, setRunHistory] = useState(initialRunHistory)
  const [historialInitialFilters, setHistorialInitialFilters] = useState<Record<string, any>>(initial.current.filters)
  const [pendingHistorialRunDetailId, setPendingHistorialRunDetailId] = useState(initial.current.runId)
  const [historyState, setHistoryState] = useState({ loading: false, error: '', total: 0,
    skip: initial.current.skip, limit: initial.current.limit, filters: initial.current.filters, projectId: currentProjectId })
  const applied = useRef<Record<string, any>>({ ...initial.current.filters, skip: initial.current.skip, limit: initial.current.limit })
  const generation = useRef(0)
  const context = useRef(currentProjectId)
  const latest = useRef({ ...params, t })
  latest.current = { ...params, t }
  // Invalidate old project responses before effects run.
  if (context.current !== currentProjectId) { context.current = currentProjectId; generation.current += 1 }

  const loadProjectRunHistory = useCallback(async (filters?: Record<string, any>) => {
    const options = latest.current
    if (!options.currentProjectId || options.projectsSource !== 'backend') return
    if (filters) applied.current = { ...filters, skip: Number(filters.skip || 0), limit: Number(filters.limit || 50) }
    const selected = { ...applied.current }
    const request = ++generation.current
    const project = options.currentProjectId
    const isCurrent = () => generation.current === request && context.current === project
    const { skip, limit, ...searchFilters } = selected
    setHistoryState(previous => ({ ...previous, loading: true, error: '', skip, limit, filters: searchFilters, projectId: project }))
    writeHistoryLocation(selected)
    try {
      if (searchFilters.date_from && searchFilters.date_to && searchFilters.date_from > searchFilters.date_to) throw new Error(options.t('historial.invalidDates'))
      if (searchFilters.version_executed && (!Number.isInteger(Number(searchFilters.version_executed)) || Number(searchFilters.version_executed) < 1)) throw new Error(options.t('historial.invalidVersion'))
      const actions = createHistorialActions({ ...options, setRunHistory: values => { if (isCurrent()) setRunHistory(values) } })
      const result = await actions.loadProjectRunHistory(selected)
      if (!isCurrent() || !result) return
      if (skip >= result.total && skip > 0) {
        return loadProjectRunHistory({ ...selected, skip: Math.max(0, Math.ceil(result.total / limit) - 1) * limit })
      }
      setHistoryState(previous => ({ ...previous, total: result.total, loading: false }))
    } catch (error: any) {
      if (isCurrent()) setHistoryState(previous => ({ ...previous, loading: false, error: error.message }))
    }
  }, [])

  const actions = createHistorialActions({ ...params, t, setRunHistory })
  useEffect(() => {
    if (historyState.projectId && historyState.projectId !== currentProjectId) {
      generation.current += 1
      setRunHistory([])
      applied.current = { skip: 0, limit: 50 } as any
      setHistorialInitialFilters({})
    }
    if (activeTab === 'historial' && canAccessCapability('historial.ver', 'read')) void loadProjectRunHistory()
    // Context/navigation initiates loading; realtime uses the same applied filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentProjectId, currentBuildId, projectsSource, JSON.stringify(historialInitialFilters)])
  useEffect(() => () => { generation.current += 1 }, [])

  const openHistorialRuns = (filters: Record<string, any> = {}, runId = '') => {
    applied.current = { ...filters, skip: 0, limit: applied.current.limit || 50 } as any
    setHistorialInitialFilters(filters)
    setPendingHistorialRunDetailId(runId)
    setActiveTab('historial')
  }

  return { runHistory, historyState, historialInitialFilters, pendingHistorialRunDetailId,
    setPendingHistorialRunDetailId, loadProjectRunHistory, loadTestRunDetail: actions.loadTestRunDetail,
    markHistorialAiReviewed: actions.markHistorialAiReviewed, openHistorialRuns }
}
