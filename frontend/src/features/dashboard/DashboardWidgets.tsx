import { Badge, ListGroup, ProgressBar } from 'react-bootstrap'
import { Clock } from 'lucide-react'
import { formatDateTime } from '../../shared/utils/dateTime'
import { useI18n } from '../../i18n'

const statusColor = (status?: string) => status === 'PASO' ? 'success' : status === 'FALLO' ? 'danger' : status === 'BLOQUEADO' ? 'primary' : 'secondary'

export function Kpi({ icon, label, value, detail }: { icon: any, label: string, value: any, detail?: string }) {
  return (
    <div className="dashboard-kpi d-flex align-items-center gap-3">
      <div className="dashboard-kpi-icon bg-primary bg-opacity-10 text-primary rounded-3 p-2 d-flex">{icon}</div>
      <div className="dashboard-kpi-content">
        <div className="dashboard-kpi-label small text-muted fw-bold" title={label}>{label}</div>
        <div className="h3 fw-bold text-dark mb-0">{value}</div>
        {detail && <div className="dashboard-kpi-detail x-small text-muted" title={detail}>{detail}</div>}
      </div>
    </div>
  )
}

export function BuildWindowSummary({ win }: { win: any }) {
  const { t } = useI18n()
  const statusLabel = win.status === 'vencida'
    ? t('common.windowExpired')
    : win.status === 'en_curso'
      ? t('common.windowInProgress')
      : win.status === 'no_iniciada'
        ? t('common.windowNotStarted')
        : t('common.windowNoDates')
  const statusVariant = win.status === 'vencida'
    ? 'danger'
    : win.status === 'en_curso'
      ? 'success'
      : win.status === 'no_iniciada'
        ? 'info'
        : 'secondary'
  const startLabel = win.fecha_inicio ? formatDateTime(win.fecha_inicio) : t('common.noStart')
  const endLabel = win.fecha_fin ? formatDateTime(win.fecha_fin) : t('common.noEnd')
  const remainingLabel = typeof win.remaining_days === 'number'
    ? t('common.daysRemaining', { count: win.remaining_days })
    : t('common.noEstimate')

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between gap-2">
        <Badge bg={statusVariant}>{statusLabel}</Badge>
        <span className="x-small text-muted">{remainingLabel}</span>
      </div>
      <h5 className="fw-bold mt-3 mb-3">{win.build_name}</h5>
      <div className="d-grid gap-2 small">
        <div>
          <div className="x-small fw-bold text-muted text-uppercase">{t('common.start')}</div>
          <div className="text-dark">{startLabel}</div>
        </div>
        <div>
          <div className="x-small fw-bold text-muted text-uppercase">{t('common.end')}</div>
          <div className="text-dark">{endLabel}</div>
        </div>
      </div>
      {win.progress_percent !== null && win.progress_percent !== undefined && (
        <>
          <ProgressBar now={win.progress_percent} className="mt-3" />
          <div className="x-small text-muted mt-2">{t('common.windowElapsed', { percent: Math.round(win.progress_percent) })}</div>
        </>
      )}
    </div>
  )
}

export function TrendByBuildList({ items }: { items: any[] }) {
  const { t } = useI18n()
  const maxTotal = Math.max(1, ...items.map(item => item.ejecutados || item.total_asignados || 0))
  return (
    <div className="dashboard-trend-list">
      {items.map((item, index) => {
        const executed = item.ejecutados || 0
        const assigned = item.total_asignados || 0
        const passed = item.pasados || 0
        const failed = item.fallados || 0
        const blocked = item.bloqueados || 0
        const executedWidth = Math.max(3, Math.min(100, (executed / maxTotal) * 100))
        return (
          <div className="dashboard-trend-row" key={item.build_id || item.build_name || `trend-${index}`}>
            <div className="d-flex justify-content-between gap-2 align-items-start">
              <div>
                <div className="fw-bold text-dark">{item.build_name}</div>
                <div className="x-small text-muted">
                  {t('common.executedAssignedCoverage', { executed, assigned, percent: Math.round(item.cobertura_porcentaje || 0) })}
                </div>
              </div>
              <div className="d-flex gap-1 flex-wrap justify-content-end">
                <Badge bg="success">{passed} PASO</Badge>
                <Badge bg="danger">{failed} FALLO</Badge>
                <Badge bg="primary">{blocked} BLOQUEADO</Badge>
              </div>
            </div>
            <div className="dashboard-trend-track mt-2" aria-hidden="true">
              <div className="dashboard-trend-executed" style={{ width: `${executedWidth}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

const EXECUTION_TYPE_META: Record<string, { label: string, color: string }> = {
  manual: { label: 'Manual', color: '#0d6efd' },
  automatizada: { label: 'Automatizada', color: '#198754' },
  ia: { label: 'IA', color: '#6f42c1' },
  externa: { label: 'Externa', color: '#0dcaf0' },
}

export function normalizeExecutionTypeDistribution(distribution: Record<string, any>) {
  return Object.entries(EXECUTION_TYPE_META).map(([key, meta]) => ({
    key,
    label: meta.label,
    color: meta.color,
    value: Number(distribution?.[key] || 0),
  }))
}

export function ExecutionTypeDistribution({ items }: { items: Array<{ key: string, label: string, color: string, value: number }> }) {
  const { t } = useI18n()
  const total = items.reduce((sum, item) => sum + item.value, 0)
  return (
    <div className="dashboard-execution-types">
      <div className="dashboard-execution-types-total">
        <span className="h4 fw-bold mb-0 text-dark">{total}</span>
        <span className="small text-muted">{t('common.classifiedExecutions')}</span>
      </div>
      <div className="dashboard-execution-types-list">
        {items.map(item => {
          const percent = total > 0 ? Math.round((item.value / total) * 100) : 0
          return (
            <div className="dashboard-execution-type-row" key={item.key}>
              <div className="d-flex justify-content-between align-items-center gap-2">
                <span className="dashboard-execution-type-label">
                  <span className="dashboard-execution-type-dot" style={{ backgroundColor: item.color }} />
                  {item.label}
                </span>
                <span className="dashboard-execution-type-value">{item.value}</span>
              </div>
              <div className="dashboard-execution-type-track" aria-hidden="true">
                <div
                  className="dashboard-execution-type-bar"
                  style={{ width: `${percent}%`, backgroundColor: item.color }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function EmptyWidget({ message }: { message: string }) {
  return (
    <div className="h-100 d-flex align-items-center justify-content-center text-center small text-muted px-3">
      {message}
    </div>
  )
}

export function ExecutionList({ items }: { items: any[] }) {
  const { t } = useI18n()
  return (
    <ListGroup variant="flush" className="small">
      {items.slice(0, 8).map(item => (
        <ListGroup.Item key={item.execution_id} className="dashboard-execution-row px-0 bg-transparent d-flex justify-content-between gap-3">
          <div className="dashboard-execution-main">
            <div className="dashboard-execution-title fw-bold text-dark" title={`${item.case_code} - ${item.case_title}`}>{item.case_code} - {item.case_title}</div>
            <div className="dashboard-execution-meta x-small text-muted" title={`${item.executed_at ? formatDateTime(item.executed_at) : t('common.noDate')} · ${item.duration_seconds}s`}><Clock size={12} className="me-1" />{item.executed_at ? formatDateTime(item.executed_at) : t('common.noDate')} · {item.duration_seconds}s</div>
          </div>
          <Badge bg={statusColor(item.status)} className="align-self-start">{item.status}</Badge>
        </ListGroup.Item>
      ))}
      {items.length === 0 && <ListGroup.Item className="px-0 bg-transparent text-muted text-center">{t('common.noData')}</ListGroup.Item>}
    </ListGroup>
  )
}
