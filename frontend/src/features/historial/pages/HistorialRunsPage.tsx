import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../../i18n'
import { Alert, Button, Form, Spinner } from 'react-bootstrap'
import { History, Search, X } from 'lucide-react'
import { HistorialFilters } from '../components/HistorialFilters'
import { HistorialRunsTable } from '../components/HistorialRunsTable'
import { RunDetailModal } from '../RunDetailModal'
import { writeHistoryLocation } from '../historyLocation'
import { activeHistoryFilters, advancedHistoryFilterCount } from '../historyFilters'
import { emptyHistorialFilters } from '../mappers/historialMappers'
import type { HistorialFilters as HistorialFiltersState } from '../types/historial'
import { WorkspaceContextEmptyState } from '../../../shared/components/WorkspaceContextEmptyState'

type HistorialRunsPageProps = {
  currentProjectId?: string | null
  currentProjectRunHistory: any[]
  getStatusColor: (status: string) => string
  onOpenEvidence: (attachment: any) => void
  isEvidenceViewerOpen?: boolean
  buildsList: any[]
  componentsList: any[]
  environments: any[]
  appUsers: any[]
  initialFilters: HistorialFiltersState
  pendingRunDetailId: string
  onPendingRunDetailConsumed: () => void
  onLoadHistory: (filters?: HistorialFiltersState) => Promise<void>
  historyState?: any
  onLoadRunDetail: (runId: string, view?: string) => Promise<any>
  onMarkAiReviewed?: (executionId: string, note?: string) => Promise<void>
  canViewDetail?: boolean
  canViewEvidence?: boolean
  fetchWithAuth?: (url: string, options?: any) => Promise<Response>
  showFeedback?: (title: string, message: string, variant?: string) => void
  canAccessCapability?: (capabilityId: string, level?: string) => boolean
  setActiveTab?: (tab: any) => void
}

export function HistorialRunsPage({
  currentProjectId,
  currentProjectRunHistory,
  getStatusColor,
  onOpenEvidence,
  isEvidenceViewerOpen = false,
  buildsList,
  componentsList,
  environments,
  appUsers,
  initialFilters,
  historyState,
  pendingRunDetailId,
  onPendingRunDetailConsumed,
  onLoadHistory,
  onLoadRunDetail,
  onMarkAiReviewed,
  canViewDetail = true,
  canViewEvidence = true,
  fetchWithAuth,
  showFeedback,
  canAccessCapability,
  setActiveTab
}: HistorialRunsPageProps) {
  const [filters, setFilters] = useState<HistorialFiltersState>({ ...emptyHistorialFilters, ...(historyState?.filters || initialFilters) })
  const loading = Boolean(historyState?.loading)
  const appliedFilters = historyState?.filters || initialFilters
  const appliedAdvancedCount = advancedHistoryFilterCount(appliedFilters)
  const [advanced, setAdvanced] = useState(() => appliedAdvancedCount > 0)
  const detailRequest = useRef(0)
  const lastRun = useRef('')
  const context = useRef(currentProjectId)
  if (context.current !== currentProjectId) { context.current = currentProjectId; detailRequest.current += 1 }
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [detail, setDetail] = useState<any | null>(null)
  const { t } = useI18n()

  const datasets = useMemo(() => {
    return environments.filter((env: any) => !filters.environment_id || String(env.id) === String(filters.environment_id)).flatMap((env: any) => (env.datasets || []).map((dataset: any) => ({
      ...dataset,
      environmentName: env.name || env.nombre
    })))
  }, [environments, filters.environment_id])

  const applyFilters = async (nextFilters = filters, skip = 0, limit = historyState?.limit || 50) => {
    await onLoadHistory({ ...nextFilters, skip, limit })
  }

  const closeDetail = () => {
    detailRequest.current += 1
    setDetailLoading(false)
    setDetail(null)
    setDetailError('')
    writeHistoryLocation({ ...historyState?.filters, skip: historyState?.skip, limit: historyState?.limit }, '')
  }

  const openRunDetail = async (runId: string) => {
    if (!canViewDetail) return
    const request = ++detailRequest.current
    lastRun.current = runId
    setDetailError('')
    setDetailLoading(true)
    setDetail(null)
    writeHistoryLocation({ ...historyState?.filters, skip: historyState?.skip, limit: historyState?.limit }, runId)
    try {
      const data = await onLoadRunDetail(runId, 'historial')
      if (request === detailRequest.current) setDetail(data)
    } catch (error: any) {
      if (request === detailRequest.current) setDetailError(error.message || t('historial.couldNotLoadDetail'))
    } finally {
      if (request === detailRequest.current) setDetailLoading(false)
    }
  }

  const handleMarkAiReviewed = async (executionId: string, note?: string) => {
    if (!onMarkAiReviewed) return
    await onMarkAiReviewed(executionId, note)
    if (detail?.id) {
      await openRunDetail(detail.id)
    }
    await onLoadHistory()
  }

  useEffect(() => {
    setFilters({ ...emptyHistorialFilters, ...(historyState?.filters || initialFilters) })
    if (advancedHistoryFilterCount(historyState?.filters || initialFilters)) setAdvanced(true)
  }, [JSON.stringify(historyState?.filters || initialFilters)])

  useEffect(() => {
    detailRequest.current += 1
    setDetail(null)
    setDetailError('')
    setDetailLoading(false)
    return () => { detailRequest.current += 1 }
  }, [currentProjectId])

  useEffect(() => {
    if (!pendingRunDetailId) return
    openRunDetail(pendingRunDetailId)
    onPendingRunDetailConsumed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRunDetailId])

  const updateFilter = (key: string, value: any) => setFilters(current => ({ ...current, [key]: value, ...(key === 'environment_id' ? { dataset_id: '' } : {}) }))
  const resetFilters = () => {
    setFilters(emptyHistorialFilters)
    applyFilters(emptyHistorialFilters)
  }

  if (!currentProjectId) {
    return (
      <WorkspaceContextEmptyState
        message={t('historial.selectSolutionAndProject')}
        detail={t('historial.historyWillAppear')}
      />
    )
  }

  return (
    <div className="p-4 text-dark text-start history-page">
      <div className="d-flex align-items-center justify-content-between mb-4 gap-3 flex-wrap">
        <h4 className="fw-bold text-primary d-flex align-items-center gap-2 m-0">
          <History size={24} /> {t('historial.pageTitle')}
        </h4>
        <Button variant="outline-primary" size="sm" className="d-flex align-items-center gap-2" onClick={() => applyFilters()} disabled={loading}>
          {loading ? <Spinner size="sm" /> : <Search size={15} />} {t('historial.search')}
        </Button>
      </div>

      {historyState?.error && <Alert variant="danger" role="alert" className="d-flex flex-wrap align-items-center justify-content-between gap-2">
        <div>{historyState.error}<div className="small">{t('historial.previousResults')}</div></div>
        <Button variant="outline-danger" size="sm" onClick={() => onLoadHistory()}>{t('historial.retry')}</Button>
      </Alert>}
      {loading && <div className="small text-muted mb-2" role="status"><Spinner size="sm" className="me-2" />{t('historial.loadingHistory')}</div>}
      <Form onSubmit={event => { event.preventDefault(); void applyFilters() }}>
      <HistorialFilters
        advanced={advanced}
        activeAdvancedCount={appliedAdvancedCount}
        onToggleAdvanced={() => setAdvanced(value => !value)}
        filters={filters}
        buildsList={buildsList}
        componentsList={componentsList}
        environments={environments}
        appUsers={appUsers}
        datasets={datasets}
        onUpdateFilter={updateFilter}
        onResetFilters={resetFilters}
      />

      <button type="submit" hidden tabIndex={-1}>{t('historial.search')}</button>
      </Form>
      {activeHistoryFilters(appliedFilters).length > 0 && <div className="d-flex flex-wrap gap-2 mb-3" aria-label={t('historial.activeFilters')}>
        {activeHistoryFilters(appliedFilters).map(({ key, value, label }) => {
          const options: Record<string, any[]> = { build_id: buildsList, component_id: componentsList, runner_id: appUsers, environment_id: environments, dataset_id: datasets }
          const option = options[key]?.find(item => String(item.id) === value)
          const names: Record<string, string> = { PASO: 'pass', FALLO: 'fail', BLOQUEADO: 'blocked', SIN_CORRER: 'notRun', EJECUTANDO_AI: 'aiInProgress', EN_PROGRESO: 'inProgress', MANUAL: 'manual', AUTOMATIZADA: 'automated', IA: 'ia', EXTERNA: 'externalLabel', REQUIERE_REVISION: 'pendingReview', REVISADA: 'reviewed', NO_REQUIERE_REVISION: 'noReview' }
          const displayValue = option ? option.name || option.nombre || option.nombre_completo || option.email : key === 'has_evidence' ? t(value === 'true' ? 'historial.withEvidence' : 'historial.withoutEvidence') : names[value] ? t(`historial.${names[value]}` as any) : value
          const text = `${t(`historial.${label}` as any)}: ${displayValue}`
          return <Button key={key} size="sm" variant="outline-secondary" className="d-inline-flex align-items-center gap-1 text-break" disabled={loading} aria-label={t('historial.removeFilter', { filter: text })} onClick={() => applyFilters({ ...appliedFilters, [key]: '', ...(key === 'environment_id' ? { dataset_id: '' } : {}) })}>
            {text}<X size={13} aria-hidden="true" />
          </Button>
        })}
      </div>}
      <HistorialRunsTable
        runs={currentProjectRunHistory}
        loading={loading}
        getStatusColor={getStatusColor}
        onOpenEvidence={onOpenEvidence}
        onOpenRunDetail={openRunDetail}
        canViewDetail={canViewDetail}
        canViewEvidence={canViewEvidence}
      />

      <div className="history-pagination d-flex align-items-center justify-content-between flex-wrap gap-2 mt-3" aria-label={t('historial.pagination')}>
        <span className="small" aria-live="polite">{t('historial.resultsCount', { count: historyState?.total ?? currentProjectRunHistory.length })}</span>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <Form.Select size="sm" className="history-page-size" aria-label={t('historial.pageSize')} value={historyState?.limit || 50} disabled={loading} onChange={event => applyFilters(historyState?.filters || filters, 0, Number(event.target.value))}>
            {[25, 50, 100].map(size => <option key={size} value={size}>{t('historial.perPage', { count: size })}</option>)}
          </Form.Select>
          <Button size="sm" variant="outline-secondary" disabled={loading || !historyState?.skip} onClick={() => applyFilters(historyState?.filters || filters, Math.max(0, historyState.skip - historyState.limit))}>{t('historial.previous')}</Button>
          <span className="small">{t('historial.pageNumber', { page: Math.floor((historyState?.skip || 0) / (historyState?.limit || 50)) + 1, pages: Math.max(1, Math.ceil((historyState?.total || 0) / (historyState?.limit || 50))) })}</span>
          <Button size="sm" variant="outline-secondary" disabled={loading || (historyState?.skip || 0) + (historyState?.limit || 50) >= (historyState?.total || 0)} onClick={() => applyFilters(historyState?.filters || filters, historyState.skip + historyState.limit)}>{t('historial.next')}</Button>
        </div>
      </div>
      <RunDetailModal
        detail={detail}
        detailLoading={detailLoading}
        detailError={detailError}
        getStatusColor={getStatusColor}
        onHide={closeDetail}
        onRetry={() => openRunDetail(lastRun.current)}
        onOpenEvidence={onOpenEvidence}
        isExternalChildModalOpen={isEvidenceViewerOpen}
        onMarkAiReviewed={onMarkAiReviewed ? handleMarkAiReviewed : undefined}
        canViewEvidence={canViewEvidence}
        fetchWithAuth={fetchWithAuth}
        showFeedback={showFeedback}
        canAccessCapability={canAccessCapability}
        setActiveTab={setActiveTab}
      />
    </div>
  )
}
