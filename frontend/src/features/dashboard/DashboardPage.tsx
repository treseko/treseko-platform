import { Component, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Card, Form, ListGroup, ProgressBar, Spinner } from 'react-bootstrap'
import { BarChart3, Bug, Clock, Grip, LayoutDashboard, RefreshCw, RotateCcw, Save, Settings2, Timer, UserCheck } from 'lucide-react'
import { Responsive, WidthProvider } from 'react-grid-layout/legacy'
import type { LayoutItem, ResponsiveLayouts } from 'react-grid-layout'
const ResponsiveGridLayout = WidthProvider(Responsive)
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { API_BASE } from '../../app/constants'
import { formatDateTime } from '../../shared/utils/dateTime'
import { useI18n } from '../../i18n'
import { BuildWindowSummary, EmptyWidget, ExecutionList, ExecutionTypeDistribution, Kpi, normalizeExecutionTypeDistribution, TrendByBuildList } from './DashboardWidgets'

type DashboardPageProps = {
  currentProjectId: string
  currentBuildId: string
  currentCompId: string
  projectVersion: string
  loggedUser: any
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  showFeedback: (title: string, message: string, variant?: string) => void
  onPreferencesUpdated: (preferences: any) => void
  canAccessCapability?: (capabilityId: any, level?: any) => boolean
}

const WIDGETS = [
  { id: 'quality_summary', titleKey: 'qualitySummary' },
  { id: 'my_tests_today', titleKey: 'myTestsToday' },
  { id: 'build_executions', titleKey: 'buildExecutions' },
  { id: 'recent_executions', titleKey: 'recentExecutions' },
  { id: 'build_window', titleKey: 'buildWindow' },
  { id: 'trend_by_build', titleKey: 'trendByBuild' },
  { id: 'open_bugs', titleKey: 'openBugs' },
  { id: 'average_duration', titleKey: 'averageDuration' },
  { id: 'execution_type_distribution', titleKey: 'executionTypes' },
  { id: 'recent_failed_cases', titleKey: 'recentFailedCases' },
]

const DEFAULT_WIDGETS = WIDGETS.map(widget => widget.id)
const DASHBOARD_SUMMARY_CACHE_TTL_MS = 15000
const dashboardSummaryCache = new Map<string, { data: any, serialized: string, timestamp: number }>()

const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }
const COLS = { lg: 12, md: 6, sm: 6, xs: 4, xxs: 2 }
const BREAKPOINT_KEYS = Object.keys(BREAKPOINTS) as Array<keyof typeof BREAKPOINTS>

const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: 'quality_summary', x: 0, y: 0, w: 6, h: 3, minW: 3, minH: 2 },
  { i: 'my_tests_today', x: 6, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
  { i: 'build_executions', x: 9, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
  { i: 'build_window', x: 0, y: 3, w: 4, h: 4, minW: 3, minH: 3 },
  { i: 'trend_by_build', x: 4, y: 3, w: 5, h: 4, minW: 4, minH: 3 },
  { i: 'open_bugs', x: 9, y: 3, w: 3, h: 4, minW: 2, minH: 2 },
  { i: 'recent_executions', x: 0, y: 7, w: 6, h: 5, minW: 4, minH: 3 },
  { i: 'recent_failed_cases', x: 6, y: 7, w: 6, h: 5, minW: 4, minH: 3 },
  { i: 'average_duration', x: 0, y: 12, w: 3, h: 3, minW: 2, minH: 2 },
  { i: 'execution_type_distribution', x: 3, y: 12, w: 5, h: 4, minW: 4, minH: 3 },
]

const cloneLayoutItem = (item: LayoutItem): LayoutItem => ({ ...item })

const fitItemToCols = (item: LayoutItem, cols: number): LayoutItem => {
  const w = Math.max(1, Math.min(item.w || 1, cols))
  const x = Math.max(0, Math.min(item.x || 0, Math.max(0, cols - w)))
  return { ...item, x, w }
}

const defaultLayouts = (): ResponsiveLayouts<string> => ({
  lg: DEFAULT_LAYOUT.map(cloneLayoutItem),
  md: DEFAULT_LAYOUT.map(item => fitItemToCols({ ...item, w: Math.min(item.w, 6), x: item.x % 6 }, 6)),
  sm: DEFAULT_LAYOUT.map(item => fitItemToCols({ ...item, w: 6, x: 0 }, 6)),
  xs: DEFAULT_LAYOUT.map(item => fitItemToCols({ ...item, w: 4, x: 0 }, 4)),
  xxs: DEFAULT_LAYOUT.map(item => fitItemToCols({ ...item, w: 2, x: 0 }, 2)),
})

const sanitizeLayoutItem = (item: LayoutItem & Record<string, any>): LayoutItem => {
  const sanitized = { ...item }
  delete sanitized.isDraggable
  delete sanitized.isResizable
  delete sanitized.isBounded
  delete sanitized.resizeHandles
  delete sanitized.moved
  delete sanitized.maxH
  delete sanitized.maxW
  return sanitized
}

const sanitizeLayouts = (layouts: ResponsiveLayouts<string>): ResponsiveLayouts<string> =>
  Object.fromEntries(
    Object.entries(layouts).map(([breakpoint, layout]) => [
      breakpoint,
      (layout || []).map(item => sanitizeLayoutItem(item as LayoutItem & Record<string, any>))
    ])
  )

const withDashboardItemFlags = (layouts: ResponsiveLayouts<string>, editing: boolean): ResponsiveLayouts<string> =>
  Object.fromEntries(
    Object.entries(layouts).map(([breakpoint, layout]) => [
      breakpoint,
      (layout || []).map(item => ({
        ...item,
        isDraggable: editing,
        isResizable: editing,
        isBounded: true,
        resizeHandles: ['se']
      }))
    ])
  )

const ensureLayoutsForWidgets = (layouts: ResponsiveLayouts<string>, widgetIds: string[]): ResponsiveLayouts<string> => {
  const sourceLayouts = Object.keys(layouts || {}).length ? layouts : defaultLayouts()
  const fallbackLayouts = defaultLayouts()

  return Object.fromEntries(
    BREAKPOINT_KEYS.map(breakpoint => {
      const cols = COLS[breakpoint]
      const existingLayout = sourceLayouts[breakpoint] || fallbackLayouts[breakpoint] || []
      const itemsById = new Map(existingLayout.map(item => [item.i, sanitizeLayoutItem(item as LayoutItem & Record<string, any>)]))
      const fallbackById = new Map((fallbackLayouts[breakpoint] || []).map(item => [item.i, item]))

      const nextLayout = widgetIds.map((id, index) => {
        const existingItem = itemsById.get(id)
        const fallbackItem = fallbackById.get(id)
        const item = existingItem || fallbackItem || { i: id, x: 0, y: index * 3, w: Math.min(3, cols), h: 3 }
        return fitItemToCols(item, cols)
      })

      return [breakpoint, nextLayout]
    })
  )
}

const mergeChangedLayouts = (current: ResponsiveLayouts<string>, changed: ResponsiveLayouts<string>): ResponsiveLayouts<string> =>
  Object.fromEntries(
    BREAKPOINT_KEYS.map(breakpoint => {
      const currentLayout = current?.[breakpoint] || []
      const changedLayout = changed?.[breakpoint] || []
      const changedIds = new Set(changedLayout.map(item => item.i))
      const hiddenOrMissingItems = currentLayout.filter(item => !changedIds.has(item.i))
      return [breakpoint, [...changedLayout, ...hiddenOrMissingItems]]
    })
  )

const statusColor = (status?: string) => status === 'PASO' ? 'success' : status === 'FALLO' ? 'danger' : status === 'BLOQUEADO' ? 'primary' : 'secondary'

class WidgetErrorBoundary extends Component<{ children: ReactNode, errorText: string }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidUpdate(previousProps: { children: ReactNode }) {
    if (previousProps.children !== this.props.children && this.state.hasError) {
      this.setState({ hasError: false })
    }
  }

  render() {
    if (this.state.hasError) {
      return <div className="small text-danger">{this.props.errorText}</div>
    }
    return this.props.children
  }
}

export function DashboardPage({
  currentProjectId,
  currentBuildId,
  currentCompId,
  loggedUser,
  fetchWithAuth,
  showFeedback,
  onPreferencesUpdated,
  canAccessCapability,
}: DashboardPageProps) {
  const { t } = useI18n()
  const profileSettings = loggedUser.profileSettings || {}
  const canPersonalizeDashboard = canAccessCapability ? canAccessCapability('dashboard.personalizar', 'edit') : true
  const [editing, setEditing] = useState(false)
  const [layouts, setLayouts] = useState<ResponsiveLayouts<string>>(() => sanitizeLayouts(profileSettings.dashboard_layout || defaultLayouts()))
  const [enabledWidgets, setEnabledWidgets] = useState<string[]>(() => profileSettings.dashboard_widgets || DEFAULT_WIDGETS)
  const [summary, setSummary] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const summaryRequestSeq = useRef(0)
  const summaryRef = useRef<any>(null)
  const summaryAbortRef = useRef<AbortController | null>(null)
  const inFlightSummaryKeyRef = useRef('')
  const loadedSummaryKeyRef = useRef('')
  const summarySerializedRef = useRef('')
  const fetchWithAuthRef = useRef(fetchWithAuth)

  useEffect(() => {
    summaryRef.current = summary
  }, [summary])

  useEffect(() => {
    fetchWithAuthRef.current = fetchWithAuth
  }, [fetchWithAuth])

  useEffect(() => {
    setLayouts(sanitizeLayouts(profileSettings.dashboard_layout || defaultLayouts()))
    setEnabledWidgets(profileSettings.dashboard_widgets || DEFAULT_WIDGETS)
  }, [loggedUser.id])

  useEffect(() => {
    if (!canPersonalizeDashboard && editing) {
      setEditing(false)
    }
  }, [canPersonalizeDashboard, editing])

  const summaryContextKey = useMemo(
    () => [currentProjectId || '', currentBuildId || '', currentCompId || ''].join('|'),
    [currentProjectId, currentBuildId, currentCompId]
  )

  const loadSummary = useCallback(async (options?: { force?: boolean }) => {
    if (!currentProjectId) {
      summaryAbortRef.current?.abort()
      summaryAbortRef.current = null
      inFlightSummaryKeyRef.current = ''
      loadedSummaryKeyRef.current = ''
      summarySerializedRef.current = ''
      setSummary(null)
      setLoading(false)
      setRefreshing(false)
      return
    }

    if (!options?.force && loadedSummaryKeyRef.current === summaryContextKey && summaryRef.current !== null) {
      setLoading(false)
      setRefreshing(false)
      return
    }

    const cachedSummary = dashboardSummaryCache.get(summaryContextKey)
    if (!options?.force && cachedSummary && Date.now() - cachedSummary.timestamp < DASHBOARD_SUMMARY_CACHE_TTL_MS) {
      loadedSummaryKeyRef.current = summaryContextKey
      summarySerializedRef.current = cachedSummary.serialized
      summaryRef.current = cachedSummary.data
      setSummary(cachedSummary.data)
      setLoading(false)
      setRefreshing(false)
      setError('')
      return
    }

    if (!options?.force && inFlightSummaryKeyRef.current === summaryContextKey) return

    summaryAbortRef.current?.abort()
    const controller = new AbortController()
    summaryAbortRef.current = controller
    inFlightSummaryKeyRef.current = summaryContextKey
    const requestId = ++summaryRequestSeq.current
    const hasExistingSummary = summaryRef.current !== null
    setLoading(!hasExistingSummary)
    setRefreshing(hasExistingSummary)
    setError('')
    try {
      const params = new URLSearchParams({ proyecto_id: currentProjectId })
      if (currentBuildId) params.set('build_id', currentBuildId)
      if (currentCompId) params.set('component_id', currentCompId)
      const response = await fetchWithAuthRef.current(`${API_BASE}/dashboard/summary?${params.toString()}`, { signal: controller.signal })
      if (!response.ok) throw new Error(await response.text())
      const data = await response.json()
      if (controller.signal.aborted || requestId !== summaryRequestSeq.current) return
      const serialized = JSON.stringify(data)
      loadedSummaryKeyRef.current = summaryContextKey
      dashboardSummaryCache.set(summaryContextKey, { data, serialized, timestamp: Date.now() })
      if (summarySerializedRef.current !== serialized) {
        summarySerializedRef.current = serialized
        setSummary(data)
      }
    } catch (err: any) {
      if (controller.signal.aborted || requestId !== summaryRequestSeq.current) return
      setError(err?.message || t('dashboard.dashboardLoadError'))
    } finally {
      if (!controller.signal.aborted && requestId === summaryRequestSeq.current) {
        setLoading(false)
        setRefreshing(false)
        summaryAbortRef.current = null
        inFlightSummaryKeyRef.current = ''
      }
    }
  }, [currentProjectId, currentBuildId, currentCompId, summaryContextKey])

  useEffect(() => {
    if (loadedSummaryKeyRef.current && loadedSummaryKeyRef.current !== summaryContextKey) {
      loadedSummaryKeyRef.current = ''
      summaryRef.current = null
      summarySerializedRef.current = ''
      setSummary(null)
      setError('')
    }
    loadSummary()
    return () => { summaryAbortRef.current?.abort(); summaryAbortRef.current = null; inFlightSummaryKeyRef.current = '' }
  }, [loadSummary, summaryContextKey])

  const visibleWidgets = useMemo(() => WIDGETS.filter(widget => enabledWidgets.includes(widget.id)), [enabledWidgets])
  const visibleWidgetIds = useMemo(() => visibleWidgets.map(widget => widget.id), [visibleWidgets])
  const gridLayouts = useMemo(() => ensureLayoutsForWidgets(layouts, visibleWidgetIds), [layouts, visibleWidgetIds])
  const editableLayouts = useMemo(() => withDashboardItemFlags(gridLayouts, editing), [gridLayouts, editing])

  const saveDashboard = async () => {
    try {
      const nextSettings = {
        ...profileSettings,
        dashboard_layout: sanitizeLayouts(ensureLayoutsForWidgets(layouts, DEFAULT_WIDGETS)),
        dashboard_widgets: enabledWidgets,
        dashboard_filters: { scope: 'current_project_build_component' },
      }
      const response = await fetchWithAuth(`${API_BASE}/users/me/preferences`, {
        method: 'PATCH',
        body: JSON.stringify({ profile_settings: nextSettings }),
      })
      if (!response.ok) throw new Error(await response.text())
      const preferences = await response.json()
      onPreferencesUpdated(preferences)
      setEditing(false)
      showFeedback(t('dashboard.saveSuccessTitle'), t('dashboard.saveSuccessMessage'), 'success')
    } catch (err: any) {
      showFeedback(t('dashboard.saveErrorTitle'), err?.message || t('dashboard.saveErrorMessage'), 'danger')
    }
  }

  const resetDashboard = () => {
    setLayouts(defaultLayouts())
    setEnabledWidgets(DEFAULT_WIDGETS)
  }

  const toggleWidget = (id: string, checked: boolean) => {
    setEnabledWidgets(prev => checked ? Array.from(new Set([...prev, id])) : prev.filter(item => item !== id))
  }

  const metricCards = [
    { label: t('dashboard.passed'), value: summary?.quality_summary?.pasados ?? 0, color: 'success' },
    { label: t('dashboard.failed'), value: summary?.quality_summary?.fallados ?? 0, color: 'danger' },
    { label: t('dashboard.blocked'), value: summary?.quality_summary?.bloqueados ?? 0, color: 'primary' },
    { label: t('dashboard.notRun'), value: summary?.quality_summary?.pendientes ?? 0, color: 'secondary' },
  ]

  const buildExecutionDetail = () => {
    const failed = summary?.build_executions?.status_counts?.FALLO || 0
    return t('dashboard.failedExecutions', { count: failed })
  }
  const trendData = (summary?.trend_by_build || []).map((item: any) => ({
    ...item,
    pasados: Number(item.pasados || 0),
    fallados: Number(item.fallados || 0),
    bloqueados: Number(item.bloqueados || 0),
    ejecutados: Number(item.ejecutados || 0),
    total_asignados: Number(item.total_asignados || 0),
    cobertura_porcentaje: Number(item.cobertura_porcentaje || 0),
  }))
  const hasTrendData = trendData.some((item: any) => item.pasados > 0 || item.fallados > 0 || item.bloqueados > 0)

  const renderWidget = (id: string) => {
    if (loading && !summary) return <div className="h-100 d-flex align-items-center justify-content-center"><Spinner size="sm" /></div>
    if (error && !summary) return <div className="small text-danger">{error}</div>
    if (!summary) return <div className="small text-muted">{t('dashboard.noData')}</div>
    switch (id) {
      case 'quality_summary':
        return <div className="dashboard-quality-grid">{metricCards.map(card => <div className={`dashboard-quality-card border-start border-4 border-${card.color} bg-light rounded-3`} key={card.label}><div className="dashboard-quality-label x-small fw-bold text-muted" title={card.label}>{card.label}</div><div className={`dashboard-quality-value fw-bold text-${card.color}`}>{card.value}</div></div>)}</div>
      case 'my_tests_today':
        return <Kpi icon={<UserCheck />} label={t('dashboard.todayExecutions')} value={summary.my_tests_today?.count ?? 0} />
      case 'build_executions':
        return <Kpi icon={<LayoutDashboard />} label={t('dashboard.executionsInBuild')} value={summary.build_executions?.count || 0} detail={buildExecutionDetail()} />
      case 'build_window': {
        const win = summary.build_window
        if (!win) return <div className="small text-muted">{t('dashboard.activeBuild')}</div>
        return <BuildWindowSummary win={win} />
      }
      case 'trend_by_build':
        if (!hasTrendData) return <EmptyWidget message={t('dashboard.noTrendExecutions')} />
        return <TrendByBuildList items={trendData} />
      case 'open_bugs':
        return <div><Kpi icon={<Bug />} label="Bugs abiertos" value={summary.open_bugs?.total || 0} />{Object.entries(summary.open_bugs?.by_severity || {}).map(([key, value]) => <Badge bg="light" text="dark" className="border me-1 mt-2" key={key}>{key}: {String(value)}</Badge>)}</div>
      case 'average_duration':
        return <Kpi icon={<Timer />} label="Duracion promedio" value={`${summary.average_duration?.seconds || 0}s`} detail={`${summary.average_duration?.sample_size || 0} ejecuciones`} />
      case 'execution_type_distribution': {
        const data = normalizeExecutionTypeDistribution(summary.execution_type_distribution || {})
        if (!data.some(item => item.value > 0)) {
          return <EmptyWidget message={t('dashboard.noTypeExecutions')} />
        }
        return <ExecutionTypeDistribution items={data} />
      }
      case 'recent_executions':
        return <ExecutionList items={summary.recent_executions || []} />
      case 'recent_failed_cases':
        return <ExecutionList items={summary.recent_failed_cases || []} />
      default:
        return <div className="small text-muted">{t('dashboard.unavailableWidget')}</div>
    }
  }

  const renderWidgetCard = (widget: { id: string, titleKey: string }, mobile = false) => (
    <Card className={`dashboard-widget-card border-0 shadow-sm rounded-3 h-100 overflow-hidden ${mobile ? 'dashboard-mobile-card' : ''}`}>
      <Card.Header className={`bg-white border-0 d-flex justify-content-between align-items-center py-3 ${!mobile ? 'dashboard-widget-header' : ''}`}>
        <span className="dashboard-widget-title fw-bold text-secondary d-flex align-items-center gap-2" title={t(`dashboard.${widget.titleKey}` as any)}><BarChart3 size={16} /> {t(`dashboard.${widget.titleKey}` as any)}</span>
        {editing && !mobile && (
          <span className="dashboard-drag-handle d-inline-flex align-items-center justify-content-center text-muted" title={t('dashboard.dragWidget')}>
            <Grip size={16} />
          </span>
        )}
      </Card.Header>
      <Card.Body className={`dashboard-widget-body dashboard-widget-body-${widget.id} pt-0 h-100 ${widget.id === 'quality_summary' ? 'overflow-hidden' : 'overflow-auto'}`}>
        {renderWidget(widget.id)}
      </Card.Body>
    </Card>
  )

  return (
    <div className={`app-page dashboard-page text-dark ${editing ? 'is-editing' : ''}`}>
      <div className="app-page-header mb-4">
        <div>
          <h4 className="fw-bold text-primary text-decoration-none d-flex align-items-center gap-2 mb-1">
            <LayoutDashboard size={24} /> {t('navigation.dashboard')}
          </h4>
        </div>
        <div className="app-toolbar d-flex gap-2 flex-wrap justify-content-end">
          <Button variant="outline-secondary" size="sm" className="fw-bold" onClick={() => loadSummary({ force: true })} disabled={loading || refreshing}>
            {refreshing ? <Spinner size="sm" className="me-1" /> : <RefreshCw size={14} className="me-1" />}
            {refreshing ? t('dashboard.refreshing') : t('dashboard.refresh')}
          </Button>
          {canPersonalizeDashboard && <Button variant={editing ? 'primary' : 'outline-primary'} size="sm" className="fw-bold" onClick={() => setEditing(!editing)}><Settings2 size={14} className="me-1" /> {editing ? t('dashboard.editing') : t('dashboard.editDashboard')}</Button>}
          {editing && <Button variant="outline-secondary" size="sm" className="fw-bold" onClick={resetDashboard}><RotateCcw size={14} className="me-1" /> {t('dashboard.restore')}</Button>}
          {editing && <Button variant="success" size="sm" className="fw-bold" onClick={saveDashboard}><Save size={14} className="me-1" /> {t('dashboard.save')}</Button>}
        </div>
      </div>

      {editing && (
        <Card className="border-0 shadow-sm rounded-3 p-3 mb-3">
          <div className="fw-bold small text-muted text-uppercase mb-2">{t('dashboard.visibleWidgets')}</div>
          <div className="d-flex flex-wrap gap-3">
            {WIDGETS.map(widget => (
              <Form.Check key={widget.id} type="checkbox" id={`widget-${widget.id}`} label={t(`dashboard.${widget.titleKey}` as any)} checked={enabledWidgets.includes(widget.id)} onChange={(event) => toggleWidget(widget.id, event.target.checked)} />
            ))}
          </div>
        </Card>
      )}

      <div className="dashboard-grid-host">
        <ResponsiveGridLayout
          key={editing ? 'dashboard-grid-editing' : 'dashboard-grid-view'}
          className="layout dashboard-desktop-grid"
          layouts={editableLayouts}
          breakpoints={BREAKPOINTS}
          cols={COLS}
          rowHeight={72}
          isDraggable={editing}
          isResizable={editing}
          isBounded={true}
          draggableHandle=".dashboard-widget-header"
          draggableCancel=".dashboard-widget-body, button, a, input, textarea, select, .form-check"
          compactType="vertical"
          onLayoutChange={(_, allLayouts) => {
            if (!editing) return
            setLayouts(prev => mergeChangedLayouts(prev, allLayouts))
          }}
        >
          {visibleWidgets.map(widget => (
            <div key={widget.id} className="dashboard-grid-item">
              <WidgetErrorBoundary errorText={t('dashboard.widgetError')}>{renderWidgetCard(widget)}</WidgetErrorBoundary>
            </div>
          ))}
        </ResponsiveGridLayout>
      </div>
    </div>
  )
}
