import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Badge, Button, Modal, ProgressBar, Table } from 'react-bootstrap'
import { Activity, Clock, ExternalLink, ServerCog } from 'lucide-react'
import { API_BASE } from '../../app/constants'
import { dateTimeMs, formatTime } from '../../shared/utils/dateTime'
import { openInNewTab } from '../../shared/utils/openExternal'
import { languageLabel } from '../casos/caseUtils'

type MonitorJob = {
  jobId?: string
  executionId?: string
  caseId?: string
  caseCode?: string
  caseTitle?: string
  status?: string
  error?: string
}

type AutomationRunMonitorModalProps = {
  show: boolean
  onHide: () => void
  mode?: 'execution' | 'dry-run'
  run: any
  jobs: MonitorJob[]
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  canViewHistory: boolean
  onOpenWorkers: () => void
  onOpenHistory: () => void
  onExecutionResultsSettled?: () => void | Promise<void>
}

const ACTIVE_STATUSES = new Set(['PENDING', 'CLAIMED', 'RUNNING'])
const SUCCESS_STATUSES = new Set(['PASSED'])
const FAILED_STATUSES = new Set(['FAILED', 'BLOCKED'])
const INFRA_STATUSES = new Set(['ERROR', 'TIMEOUT', 'CANCELLED', 'BLOCKED_BY_RUNNER'])

const statusVariant = (status?: string) => {
  if (!status) return 'secondary'
  if (status === 'PASO') return 'success'
  if (status === 'FALLO') return 'danger'
  if (status === 'BLOQUEADO') return 'warning'
  if (SUCCESS_STATUSES.has(status)) return 'success'
  if (FAILED_STATUSES.has(status)) return status === 'BLOCKED' ? 'warning' : 'danger'
  if (INFRA_STATUSES.has(status)) return 'dark'
  if (status === 'RUNNING') return 'primary'
  if (status === 'CLAIMED') return 'info'
  return 'secondary'
}

const statusLabel = (status?: string) => {
  const labels: Record<string, string> = {
    PENDING: 'Pendiente',
    CLAIMED: 'Tomado',
    RUNNING: 'Ejecutando',
    PASSED: 'Paso',
    FAILED: 'Fallo',
    BLOCKED: 'Bloqueado',
    PASO: 'Paso',
    FALLO: 'Fallo',
    BLOQUEADO: 'Bloqueado',
    ERROR: 'Error runner',
    TIMEOUT: 'Timeout',
    CANCELLED: 'Cancelado',
    BLOCKED_BY_RUNNER: 'Sin worker compatible'
  }
  return status ? labels[status] || status : 'Sin job'
}

const elapsedLabel = (from?: string, to?: string) => {
  if (!from) return '-'
  const start = dateTimeMs(from)
  const end = to ? dateTimeMs(to) : Date.now()
  if (!start || !end) return '-'
  const seconds = Math.max(0, Math.round((end - start) / 1000))
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`
}

export function AutomationRunMonitorModal({
  show,
  onHide,
  mode = 'execution',
  run,
  jobs,
  fetchWithAuth,
  canViewHistory,
  onOpenWorkers,
  onOpenHistory,
  onExecutionResultsSettled
}: AutomationRunMonitorModalProps) {
  const [jobDetails, setJobDetails] = useState<Record<string, any>>({})
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null)
  const settledNotificationKeyRef = useRef('')
  const isDryRun = mode === 'dry-run'

  const jobIds = useMemo(() => jobs.map(job => job.jobId).filter(Boolean) as string[], [jobs])
  const jobIdsKey = jobIds.join('|')

  useEffect(() => {
    if (!show) return
    setJobDetails({})
    setLastRefresh(null)
    setExpandedJobId(null)
  }, [show, jobIdsKey])

  useEffect(() => {
    if (!show || jobIds.length === 0) return
    let cancelled = false
    let shouldPoll = true

    const loadJobs = async () => {
      const responses = await Promise.all(jobIds.map(async jobId => {
        try {
          const response = await fetchWithAuth(`${API_BASE}/automation-jobs/${jobId}`)
          if (!response.ok) {
            return [jobId, { id: jobId, estado: 'ERROR', error_message: `Backend respondio ${response.status}` }]
          }
          return [jobId, await response.json()]
        } catch (error: any) {
          return [jobId, { id: jobId, estado: 'ERROR', error_message: error?.message || 'No se pudo consultar el job' }]
        }
      }))
      if (cancelled) return
      const nextDetails = Object.fromEntries(responses)
      setJobDetails(nextDetails)
      setLastRefresh(new Date())
      shouldPoll = Object.values(nextDetails).some((job: any) => ACTIVE_STATUSES.has(job.estado))
    }

    loadJobs()
    const interval = window.setInterval(() => {
      if (shouldPoll) loadJobs()
    }, 2500)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [show, jobIdsKey, fetchWithAuth])

  const rows = jobs.map(job => {
    const detail = job.jobId ? jobDetails[job.jobId] : null
    const payload = detail?.payload_congelado || {}
    const metadata = detail?.metadata_resultado || (job as any).metadata_resultado || {}
    return {
      ...job,
      detail,
      status: job.error ? 'ERROR' : detail?.estado || job.status || 'PENDING',
      caseCode: job.caseCode || payload.case_code || '-',
      caseTitle: job.caseTitle || payload.case_title || 'Caso automatizado',
      framework: detail?.required_framework || payload.framework || '-',
      language: detail?.required_language || payload.language || 'javascript',
      headless: metadata.headless ?? payload.headless ?? (payload.debug_mode ? false : undefined),
      debugMode: metadata.debug_mode ?? payload.debug_mode ?? false,
      artifacts: Array.isArray(metadata.artifacts) ? metadata.artifacts : [],
      runner: detail?.runner_id || '-',
      elapsed: elapsedLabel(detail?.fecha_creacion, detail?.fecha_fin),
      error: job.error || detail?.error_message,
      log: detail?.logs || (job as any).logs
    }
  })

  const total = rows.length
  const completed = rows.filter(row => !ACTIVE_STATUSES.has(row.status)).length
  const passed = rows.filter(row => row.status === 'PASSED').length
  const functionalFailures = rows.filter(row => FAILED_STATUSES.has(row.status)).length
  const runnerProblems = rows.filter(row => INFRA_STATUSES.has(row.status)).length
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0
  const oldestCreation = rows.map(row => row.detail?.fecha_creacion).filter(Boolean).sort()[0]
  const completionKey = rows
    .map(row => `${row.jobId || row.executionId || row.caseId || row.caseCode}:${row.status}`)
    .join('|')

  useEffect(() => {
    if (!show || isDryRun || total === 0 || completed !== total) return
    const notificationKey = `${run?.id || run?.nombre || 'run'}:${completionKey}`
    if (settledNotificationKeyRef.current === notificationKey) return
    settledNotificationKeyRef.current = notificationKey
    onExecutionResultsSettled?.()
  }, [completed, completionKey, isDryRun, onExecutionResultsSettled, run?.id, run?.nombre, show, total])

  return (
    <Modal show={show} onHide={onHide} centered size="xl" backdrop="static">
      <Modal.Header closeButton className="border-0 pb-0">
        <Modal.Title className="fw-bold d-flex align-items-center gap-2">
          <Activity size={22} className="text-primary" />
          {isDryRun ? 'Prueba temporal' : 'Seguimiento de ejecucion automatizada'}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="p-4">
        <Alert variant="info" className="small">
          {isDryRun
            ? 'No se guardara en historial, reportes ni build. Sirve para validar la prueba antes de guardar o asignar a una build.'
            : 'Ejecucion automatizada enviada al worker. Puedes cerrar este modal; la ejecucion continuara en segundo plano.'}
        </Alert>

        <div className="d-grid gap-3 mb-3" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
          <div className="border rounded-3 p-3 bg-light"><div className="text-muted x-small">Total</div><div className="fs-4 fw-bold">{total}</div></div>
          <div className="border rounded-3 p-3 bg-light"><div className="text-muted x-small">Completados</div><div className="fs-4 fw-bold">{completed}</div></div>
          <div className="border rounded-3 p-3 bg-light"><div className="text-muted x-small">Pasados</div><div className="fs-4 fw-bold text-success">{passed}</div></div>
          <div className="border rounded-3 p-3 bg-light"><div className="text-muted x-small">Fallos funcionales</div><div className="fs-4 fw-bold text-danger">{functionalFailures}</div></div>
          <div className="border rounded-3 p-3 bg-light"><div className="text-muted x-small">Runner/infra</div><div className="fs-4 fw-bold text-dark">{runnerProblems}</div></div>
        </div>

        <div className="d-flex align-items-center justify-content-between gap-3 mb-2">
          <div className="small text-muted">
            Run: <strong>{run?.nombre || run?.id || 'Automatizado'}</strong>
            <span className="ms-3"><Clock size={14} /> Tiempo: {elapsedLabel(oldestCreation)}</span>
          </div>
          <div className="small text-muted">Ultima actualizacion: {formatTime(lastRefresh) || '-'}</div>
        </div>
        <ProgressBar now={progress} label={`${progress}%`} className="mb-3" />

        <div className="border rounded-3 overflow-hidden">
          <Table hover responsive className="mb-0 align-middle">
            <thead className="bg-light">
              <tr>
                <th>Caso</th>
                <th>Estado</th>
                <th>Framework</th>
                <th>Worker</th>
                <th>Tiempo</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const rowKey = row.jobId || row.executionId || row.caseId || row.caseCode
                const steps = Array.isArray(row.detail?.metadata_resultado?.steps) ? row.detail.metadata_resultado.steps : []
                const artifacts = Array.isArray(row.artifacts) ? row.artifacts : []
                const hasLog = Boolean(row.error || row.detail?.logs || steps.length || artifacts.length)
                const scriptFormat = row.detail?.metadata_resultado?.script_format || row.detail?.payload_congelado?.script_format
                const responseLabel = scriptFormat === 'playwright_test'
                  ? 'respuesta Playwright'
                  : row.framework && row.framework !== '-'
                    ? `log ${String(row.framework).toUpperCase()}`
                    : 'log'
                const isBlockedByRunner = row.status === 'BLOCKED_BY_RUNNER'
                return (
                  <Fragment key={rowKey}>
                    <tr key={rowKey}>
                      <td>
                        <Badge bg="light" text="primary" className="border font-monospace me-2">{row.caseCode}</Badge>
                        <span className="fw-semibold">{row.caseTitle}</span>
                      </td>
                      <td><Badge bg={statusVariant(row.status)}>{statusLabel(row.status)}</Badge></td>
                      <td className="font-monospace small">
                        <div>{row.framework} + {languageLabel(row.language)}</div>
                        <div className="text-muted">{row.headless === false ? 'headed/debug visual' : row.headless === true ? 'headless' : row.debugMode ? 'debug visual' : '-'}</div>
                      </td>
                      <td className="font-monospace small">{row.runner}</td>
                      <td>{row.elapsed}</td>
                      <td className="small">
                        {hasLog ? (
                          <Button
                            variant="link"
                            size="sm"
                            className="p-0 fw-bold text-decoration-none"
                            onClick={() => setExpandedJobId(expandedJobId === rowKey ? null : String(rowKey))}
                          >
                            {expandedJobId === rowKey
                              ? `Ocultar ${responseLabel}`
                              : `Ver ${responseLabel}`}
                          </Button>
                        ) : (
                          <span className="text-muted">Sin log reportado</span>
                        )}
                      </td>
                    </tr>
                    {expandedJobId === rowKey && (
                      <tr key={`${rowKey}-detail`}>
                        <td colSpan={6} className="bg-light">
                          {isBlockedByRunner && (
                            <Alert variant="warning" className="small mb-2">
                              No hay worker compatible para <strong>{row.framework} + {languageLabel(row.language)}</strong>. Inicia o vincula un worker que anuncie ese framework y lenguaje, y vuelve a ejecutar el dry-run o la prueba.
                            </Alert>
                          )}
                          {row.error && <Alert variant="danger" className="small mb-2">{row.error}</Alert>}
                          <div className="text-uppercase text-muted x-small fw-bold mb-2">{responseLabel}</div>
                          <pre className="bg-dark text-light rounded-3 p-3 small mb-2 overflow-auto" style={{ maxHeight: 260, whiteSpace: 'pre-wrap' }}>
                            {row.log || row.detail?.error_message || 'Sin log reportado.'}
                          </pre>
                          {artifacts.length > 0 && (
                            <div className="border rounded-3 bg-white p-2 mb-2">
                              <div className="text-uppercase text-muted x-small fw-bold mb-2">Evidencias temporales</div>
                              <div className="d-flex flex-wrap gap-2">
                                {artifacts.map((artifact: any, index: number) => {
                                  const href = artifact.public_url?.startsWith('http')
                                    ? artifact.public_url
                                    : artifact.public_url
                                      ? `${API_BASE}${artifact.public_url}`
                                      : artifact.base64
                                        ? `data:${artifact.content_type || 'image/png'};base64,${artifact.base64}`
                                        : ''
                                  return href ? (
                                    <Button
                                      key={`${rowKey}-artifact-${artifact.id || index}`}
                                      variant="outline-primary"
                                      size="sm"
                                      className="x-small"
                                      onClick={() => openInNewTab(href)}
                                    >
                                      Ver {artifact.type || 'evidencia'} {artifact.step_number ? `paso ${artifact.step_number}` : ''}
                                    </Button>
                                  ) : null
                                })}
                              </div>
                            </div>
                          )}
                          {steps.length > 0 && (
                            <div className="border rounded-3 bg-white p-2">
                              <div className="text-uppercase text-muted x-small fw-bold mb-2">Steps devueltos por el script</div>
                              {steps.map((step: any, index: number) => (
                                <div key={`${rowKey}-step-${index}`} className="d-flex justify-content-between gap-3 border-bottom py-1 small">
                                  <span className="font-monospace">Paso {step.number ?? step.numero_paso ?? index + 1}</span>
                                  <Badge bg={statusVariant(step.status ?? step.estado)}>{statusLabel(step.status ?? step.estado)}</Badge>
                                  <span className="flex-grow-1">{step.observations || step.observaciones || '-'}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </Table>
        </div>

        {!canViewHistory && (
          <Alert variant="secondary" className="small mt-3 mb-0">
            Podras revisar el resultado desde esta ejecucion o desde Automatizacion si tienes acceso.
          </Alert>
        )}
      </Modal.Body>
      <Modal.Footer className="border-0 pt-0">
        <Button variant="outline-secondary" onClick={onHide}>Seguir en esta pantalla</Button>
        <Button variant="outline-primary" onClick={onOpenWorkers}>
          <ServerCog size={16} className="me-1" />
          Ver workers
        </Button>
        {canViewHistory && !isDryRun && (
          <Button variant="primary" onClick={onOpenHistory}>
            <ExternalLink size={16} className="me-1" />
            Ver historial
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  )
}
