import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Modal, ProgressBar, Spinner, Table } from 'react-bootstrap'
import { Activity, CheckCircle2, CircleAlert, Clock, Clock3, XCircle } from 'lucide-react'
import { API_BASE } from '../../app/constants'
import { useI18n } from '../../i18n'

type ApiAutomationMonitorProps = {
  show: boolean
  run: any
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  setAutomationMonitor: (updater: any) => void
  onHide: () => void
  onOpenHistory?: () => void
}

// The API progress endpoint normally normalizes a finished run to COMPLETED,
// but older runs and transport failures can expose their concrete terminal
// state. None of those states should keep the floating monitor alive.
export const terminalStatuses = new Set([
  'COMPLETED',
  'FAILED',
  'ERROR',
  'BLOCKED',
  'CANCELLED',
  'ABORTED',
  'TIMEOUT',
])

export function isTerminalApiStatus(status: unknown) {
  return terminalStatuses.has(String(status || '').toUpperCase())
}

const statusLabelKey: Record<string, 'ejecutarPruebas.apiStatusPending' | 'ejecutarPruebas.apiStatusRunning' | 'ejecutarPruebas.apiStatusPassed' | 'ejecutarPruebas.apiStatusFailed' | 'ejecutarPruebas.apiStatusBlocked' | 'ejecutarPruebas.apiStatusError'> = {
  PENDING: 'ejecutarPruebas.apiStatusPending',
  RUNNING: 'ejecutarPruebas.apiStatusRunning',
  PASSED: 'ejecutarPruebas.apiStatusPassed',
  FAILED: 'ejecutarPruebas.apiStatusFailed',
  BLOCKED: 'ejecutarPruebas.apiStatusBlocked',
  ERROR: 'ejecutarPruebas.apiStatusError',
}

const statusVariant: Record<string, string> = {
  PENDING: 'secondary',
  RUNNING: 'primary',
  PASSED: 'success',
  FAILED: 'danger',
  BLOCKED: 'primary',
  ERROR: 'dark',
}

function compactDuration(durationMs: number | undefined) {
  if (!Number.isFinite(durationMs)) return '-'
  return `${Math.max(0, Math.round(Number(durationMs)))} ms`
}

function elapsedLabel(startedAt?: string, finishedAt?: string, now = Date.now()) {
  if (!startedAt) return '-'
  const start = Date.parse(startedAt)
  const end = finishedAt ? Date.parse(finishedAt) : now
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '-'
  const seconds = Math.max(0, Math.round((end - start) / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
}

export function ApiAutomationMonitorModal({ show, run, fetchWithAuth, setAutomationMonitor, onHide, onOpenHistory }: ApiAutomationMonitorProps) {
  const { t } = useI18n()
  const [progress, setProgress] = useState<any>(run || {})
  const [now, setNow] = useState(() => Date.now())
  const runId = String(run?.run_id || run?.id || '')

  useEffect(() => {
    setProgress(run || {})
    setNow(Date.now())
  }, [runId])

  useEffect(() => {
    if (!runId || isTerminalApiStatus(progress.status)) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [progress.status, runId])

  useEffect(() => {
    if (!runId) return
    let cancelled = false
    let shouldPoll = true

    const loadProgress = async () => {
      try {
        const response = await fetchWithAuth(`${API_BASE}/test-runs/${runId}/api-progress`)
        if (!response.ok) {
          // A missing/invalid run cannot make progress. Mark it terminal so
          // a stale API chip is not left spinning forever after a failed run.
          if (response.status === 404 || response.status === 409) {
            const payload = { status: 'ERROR', message: `${t('ejecutarPruebas.apiErrorRunLookup')} (${response.status})` }
            if (cancelled) return
            setProgress((previous: any) => ({ ...previous, ...payload }))
            setAutomationMonitor((previous: any) => ({
              ...previous,
              run: { ...(previous?.run || {}), ...payload },
              apiProgress: payload,
            }))
            shouldPoll = false
          }
          return
        }
        const payload = await response.json()
        if (cancelled) return
        setProgress((previous: any) => ({ ...previous, ...payload }))
        setAutomationMonitor((previous: any) => ({
          ...previous,
          run: { ...(previous?.run || {}), ...payload },
          apiProgress: payload,
        }))
        shouldPoll = !isTerminalApiStatus(payload.status)
      } catch (_) {
        // The monitor remains usable with the last known state; the next tick retries.
      }
    }

    loadProgress()
    const interval = window.setInterval(() => {
      if (shouldPoll) void loadProgress()
    }, 2500)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [fetchWithAuth, runId, setAutomationMonitor])

  const executions = Array.isArray(progress.executions) ? progress.executions : []
  const total = Number(progress.total ?? executions.length ?? 0)
  const completed = Number(progress.passed || 0) + Number(progress.failed || 0) + Number(progress.blocked || 0) + Number(progress.errors || 0)
  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0
  const finished = isTerminalApiStatus(progress.status)
  const title = progress.run_name || progress.nombre || t('ejecutarPruebas.apiMonitorTitle')
  const elapsed = elapsedLabel(progress.started_at, finished ? progress.finished_at : undefined, now)

  const counters = useMemo(() => [
    { label: t('ejecutarPruebas.total'), value: total, icon: Activity, className: 'text-primary' },
    { label: t('ejecutarPruebas.completed'), value: completed, icon: CheckCircle2, className: 'text-dark' },
    { label: t('ejecutarPruebas.passed'), value: Number(progress.passed || 0), icon: CheckCircle2, className: 'text-success' },
    { label: t('ejecutarPruebas.failed'), value: Number(progress.failed || 0), icon: XCircle, className: 'text-danger' },
    { label: t('ejecutarPruebas.blockedLabel'), value: Number(progress.blocked || 0), icon: CircleAlert, className: 'text-warning' },
  ], [completed, progress.blocked, progress.failed, progress.passed, t, total])

  return (
    <>
      {!show && runId && !finished && (
        <button
          type="button"
          className="btn btn-primary shadow d-flex align-items-center gap-2"
          aria-label={t('ejecutarPruebas.apiMonitorTitle')}
          style={{ position: 'fixed', right: 24, top: 86, zIndex: 1040 }}
          onClick={() => setAutomationMonitor((previous: any) => ({ ...previous, show: true }))}
        >
          <Spinner animation="border" size="sm" />
          {t('ejecutarPruebas.apiProgress', { completed, total })}
        </button>
      )}

      <Modal show={show} onHide={onHide} centered size="xl" backdrop="static">
        <Modal.Header closeButton className="border-0 pb-0">
          <Modal.Title className="fw-bold d-flex align-items-center gap-2">
            <Activity size={22} className="text-primary" />
            {t('ejecutarPruebas.apiMonitorTitle')}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="p-4">
          <Alert variant="info" className="small">
            {t('ejecutarPruebas.apiMonitorBackground')}
          </Alert>
          <div className="d-flex align-items-center justify-content-between gap-3 mb-2 small text-muted">
            <div>
              {t('ejecutarPruebas.apiRun')}: <strong>{title}</strong>
              <span className="ms-3 font-monospace">{runId}</span>
            </div>
            <div className="text-nowrap"><Clock size={14} className="me-1" /> {t('ejecutarPruebas.apiTime')}: <strong>{elapsed}</strong></div>
          </div>
          <div className="row g-2 mb-3">
            {counters.map(({ label, value, icon: Icon, className }) => (
              <div className="col" key={label}>
                <div className="border rounded-3 p-2 h-100 text-center">
                  <Icon size={16} className={className} />
                  <div className="small text-muted">{label}</div>
                  <div className="fs-5 fw-bold">{value}</div>
                </div>
              </div>
            ))}
          </div>
          <ProgressBar now={progressPercent} label={`${progressPercent}%`} className="mb-3" />

          <div className="border rounded-3 overflow-hidden">
            <div className="d-flex align-items-center justify-content-between bg-light px-3 py-2">
              <span className="fw-semibold">{t('ejecutarPruebas.apiResultsByCase')}</span>
              {!finished && <span className="small text-muted"><Clock3 size={14} /> {t('ejecutarPruebas.apiUpdating')}</span>}
            </div>
            <div style={{ maxHeight: 'min(48vh, 460px)', overflowY: 'auto', overflowX: 'auto' }}>
              {executions.length === 0 ? (
                <div className="p-4 text-center text-muted">{t('ejecutarPruebas.apiPreparingCases')}</div>
              ) : (
                <Table hover className="mb-0 align-middle" style={{ minWidth: 780 }}>
                  <thead className="bg-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                    <tr>
                      <th>{t('ejecutarPruebas.apiColumnCase')}</th>
                      <th>{t('ejecutarPruebas.apiColumnStatus')}</th>
                      <th>{t('ejecutarPruebas.apiColumnFramework')}</th>
                      <th>{t('ejecutarPruebas.apiColumnExecutor')}</th>
                      <th>{t('ejecutarPruebas.apiColumnTime')}</th>
                      <th>{t('ejecutarPruebas.apiColumnDetail')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {executions.map((item: any) => {
                      const status = String(item.status || 'PENDING').toUpperCase()
                      const assertions = `${Number(item.assertions_passed || 0)} aprobadas · ${Number(item.assertions_failed || 0)} fallidas`
                      return (
                        <tr key={item.case_id}>
                          <td>
                            <div className="fw-semibold text-nowrap">{item.case_code || t('ejecutarPruebas.apiCase')}</div>
                            <div className="small text-muted text-truncate" style={{ maxWidth: 290 }}>{item.case_title || t('ejecutarPruebas.apiNoTitle')}</div>
                          </td>
                          <td><Badge bg={statusVariant[status] || 'secondary'}>{statusLabelKey[status] ? t(statusLabelKey[status]) : status}</Badge></td>
                          <td className="small text-nowrap">{item.framework || 'HTTP/REST'}</td>
                          <td className="small text-nowrap">{item.executor || 'API runner'}</td>
                          <td className="small text-nowrap">{compactDuration(item.duration_ms)}</td>
                          <td className="small" style={{ minWidth: 190 }}>
                            <div>{item.http_status ? `HTTP ${item.http_status}` : t('ejecutarPruebas.apiNoHttpResponse')}</div>
                            <div className="text-muted">{t('ejecutarPruebas.apiAssertionsSummary', { passed: Number(item.assertions_passed || 0), failed: Number(item.assertions_failed || 0) })}</div>
                            {item.message && <div className="text-danger text-truncate" title={String(item.message)}>{String(item.message)}</div>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </Table>
              )}
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer className="border-0 pt-0">
          <Button variant="outline-secondary" onClick={onHide}>{t('ejecutarPruebas.apiStayOnScreen')}</Button>
          {finished && onOpenHistory && <Button variant="outline-primary" onClick={onOpenHistory}>{t('ejecutarPruebas.apiViewResult')}</Button>}
        </Modal.Footer>
      </Modal>
    </>
  )
}
