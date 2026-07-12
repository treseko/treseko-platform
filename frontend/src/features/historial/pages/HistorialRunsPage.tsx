import { useEffect, useMemo, useState } from 'react'
import { Button, Spinner } from 'react-bootstrap'
import { History, Search } from 'lucide-react'
import { HistorialFilters } from '../components/HistorialFilters'
import { HistorialRunsTable } from '../components/HistorialRunsTable'
import { RunDetailModal } from '../RunDetailModal'
import { emptyHistorialFilters } from '../mappers/historialMappers'
import type { HistorialFilters as HistorialFiltersState } from '../types/historial'

type HistorialRunsPageProps = {
  currentProjectRunHistory: any[]
  getStatusColor: (status: string) => string
  onOpenEvidence: (attachment: any) => void
  buildsList: any[]
  componentsList: any[]
  environments: any[]
  appUsers: any[]
  initialFilters: HistorialFiltersState
  pendingRunDetailId: string
  onPendingRunDetailConsumed: () => void
  onLoadHistory: (filters?: HistorialFiltersState) => Promise<void>
  onLoadRunDetail: (runId: string) => Promise<any>
  onMarkAiReviewed?: (executionId: string, note?: string) => Promise<void>
  canViewDetail?: boolean
  canViewEvidence?: boolean
  fetchWithAuth?: (url: string, options?: any) => Promise<Response>
  showFeedback?: (title: string, message: string, variant?: string) => void
  canAccessCapability?: (capabilityId: string, level?: string) => boolean
  setActiveTab?: (tab: any) => void
}

export function HistorialRunsPage({
  currentProjectRunHistory,
  getStatusColor,
  onOpenEvidence,
  buildsList,
  componentsList,
  environments,
  appUsers,
  initialFilters,
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
  const [filters, setFilters] = useState<HistorialFiltersState>({ ...emptyHistorialFilters, ...initialFilters })
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [detail, setDetail] = useState<any | null>(null)

  const datasets = useMemo(() => {
    return environments.flatMap((env: any) => (env.datasets || []).map((dataset: any) => ({
      ...dataset,
      environmentName: env.name || env.nombre
    })))
  }, [environments])

  const applyFilters = async (nextFilters = filters) => {
    setLoading(true)
    try {
      await onLoadHistory(nextFilters)
    } finally {
      setLoading(false)
    }
  }

  const openRunDetail = async (runId: string) => {
    if (!canViewDetail) return
    setDetailError('')
    setDetailLoading(true)
    setDetail(null)
    try {
      const data = await onLoadRunDetail(runId)
      setDetail(data)
    } catch (error: any) {
      setDetailError(error.message || 'No se pudo cargar el detalle del run')
    } finally {
      setDetailLoading(false)
    }
  }

  const handleMarkAiReviewed = async (executionId: string, note?: string) => {
    if (!onMarkAiReviewed) return
    await onMarkAiReviewed(executionId, note)
    if (detail?.id) {
      await openRunDetail(detail.id)
    }
    await applyFilters()
  }

  useEffect(() => {
    const nextFilters = { ...emptyHistorialFilters, ...initialFilters }
    setFilters(nextFilters)
    applyFilters(nextFilters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initialFilters)])

  useEffect(() => {
    if (!pendingRunDetailId) return
    openRunDetail(pendingRunDetailId)
    onPendingRunDetailConsumed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRunDetailId])

  const updateFilter = (key: string, value: any) => setFilters(current => ({ ...current, [key]: value }))
  const resetFilters = () => {
    setFilters(emptyHistorialFilters)
    applyFilters(emptyHistorialFilters)
  }

  return (
    <div className="p-4 animate__animated animate__fadeIn text-dark text-start">
      <div className="d-flex align-items-center justify-content-between mb-4 gap-3 flex-wrap">
        <h4 className="fw-bold text-primary d-flex align-items-center gap-2 m-0">
          <History size={24} /> Historial de Ejecuciones
        </h4>
        <Button variant="outline-primary" size="sm" className="d-flex align-items-center gap-2" onClick={() => applyFilters()} disabled={loading}>
          {loading ? <Spinner size="sm" /> : <Search size={15} />} Buscar
        </Button>
      </div>

      <HistorialFilters
        filters={filters}
        buildsList={buildsList}
        componentsList={componentsList}
        environments={environments}
        appUsers={appUsers}
        datasets={datasets}
        onUpdateFilter={updateFilter}
        onResetFilters={resetFilters}
      />

      <HistorialRunsTable
        runs={currentProjectRunHistory}
        getStatusColor={getStatusColor}
        onOpenEvidence={onOpenEvidence}
        onOpenRunDetail={openRunDetail}
        canViewDetail={canViewDetail}
        canViewEvidence={canViewEvidence}
      />

      <RunDetailModal
        detail={detail}
        detailLoading={detailLoading}
        detailError={detailError}
        getStatusColor={getStatusColor}
        onHide={() => { setDetail(null); setDetailError('') }}
        onOpenEvidence={onOpenEvidence}
        onMarkAiReviewed={handleMarkAiReviewed}
        canViewEvidence={canViewEvidence}
        fetchWithAuth={fetchWithAuth}
        showFeedback={showFeedback}
        canAccessCapability={canAccessCapability}
        setActiveTab={setActiveTab}
      />
    </div>
  )
}
