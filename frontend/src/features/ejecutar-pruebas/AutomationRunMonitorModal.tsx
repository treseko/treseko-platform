import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Badge, Button, Modal, ProgressBar, Table } from 'react-bootstrap'
import { Activity, Clock, Download, ExternalLink, ServerCog } from 'lucide-react'
import { API_BASE } from '../../app/constants'
import { dateTimeMs, formatTime } from '../../shared/utils/dateTime'
import { languageLabel } from '../casos/caseUtils'

type MonitorJob = {
  jobId?: string
  executionId?: string
  caseId?: string
  caseCode?: string
  caseTitle?: string
  status?: string
  error?: string
  progressRunId?: string
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
  if (status === 'BLOQUEADO') return 'primary'
  if (SUCCESS_STATUSES.has(status)) return 'success'
  if (FAILED_STATUSES.has(status)) return status === 'BLOCKED' ? 'primary' : 'danger'
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

const failureCategoryLabel = (category?: string) => ({
  passed: 'Paso completado',
  required_element_not_found: 'Elemento requerido no encontrado',
  navigation_error: 'URL o navegación no disponible',
  expected_result_not_met: 'Resultado esperado no cumplido',
  browser_action_failed: 'Acción del navegador no ejecutada',
  model_blocked: 'La IA bloqueó la acción',
}[String(category || '')] || category || 'Sin clasificar')

const friendlyStepDiagnosis = (step: any) => {
  const category = String(step?.failure_category || '')
  if (category === 'expected_result_not_met') return 'La acción se ejecutó, pero el resultado esperado no apareció en la evidencia observada.'
  if (category === 'required_element_not_found') return 'No se encontró visible el elemento o texto requerido para continuar.'
  if (category === 'navigation_error') return 'La navegación inicial o la URL no pudo completarse.'
  if (category === 'browser_action_failed') return 'El navegador no pudo ejecutar la acción indicada.'
  if (category === 'model_blocked') return 'La IA bloqueó el paso porque faltaban datos o contexto.'
  return step?.status === 'PASO' ? 'El paso se completó según la evidencia disponible.' : 'El motor no pudo completar este paso.'
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
  const [selectedArtifact, setSelectedArtifact] = useState<{ href: string; label: string; filename?: string } | null>(null)
  const [aiLive, setAiLive] = useState<any>({ status: 'RUNNING', steps: [], artifacts: [], timeline: [], resolvedContext: [], provider: '-', model: '-', observations: '' })
  const settledNotificationKeyRef = useRef('')
  const isDryRun = mode === 'dry-run'

  const jobIds = useMemo(() => jobs.map(job => job.jobId).filter(Boolean) as string[], [jobs])
  const jobIdsKey = jobIds.join('|')
  const isAiDryRun = isDryRun && jobs.some(job => (job as any).framework === 'ia')

  useEffect(() => {
    if (!show) return
    setJobDetails({})
    setLastRefresh(null)
    setExpandedJobId(null)
    setSelectedArtifact(null)
    setAiLive({ status: 'RUNNING', steps: [], artifacts: [], timeline: [], resolvedContext: [], provider: '-', model: '-', observations: '' })
  }, [show, jobIdsKey])

  const aiRunId = isAiDryRun ? String((jobs[0] as any)?.progressRunId || jobs[0]?.jobId || '') : ''

  useEffect(() => {
    if (!show || !isAiDryRun || !aiRunId) return
    const token = localStorage.getItem('qa_access_token')
    if (!token) return
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws/ai-dry-run/${encodeURIComponent(aiRunId)}`)
    socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', token }))
    socket.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data || '{}')
        setAiLive((current: any) => {
          const next = { ...current, timeline: [...(current.timeline || [])] }
          if (event.type === 'STEP_RESULT') {
            const step = {
              number: event.step || event.step_number || next.steps.length + 1,
              status: event.status,
              observations: event.message || event.observations,
              error_log: event.error_message,
              screenshot_base64: event.screenshot,
              agent: event.agent,
              failure_category: event.failure_category,
              reason: event.reason || event.message,
              action_summary: event.action_summary,
              action_executed: event.action_executed,
              url: event.url
            }
            next.steps = [...(next.steps || []).filter((item: any) => !(item.number === step.number && item.attempt === event.attempt)), step]
            if (event.screenshot) next.artifacts = [...(next.artifacts || []), {
              type: 'screenshot',
              filename: `ai-paso-${step.number}.png`,
              content_type: 'image/png',
              base64: event.screenshot,
              step_number: step.number
            }]
          } else if (event.type === 'DRY_RUN_RESULT') {
            next.status = event.status || next.status
            next.observations = event.observations || next.observations
            next.error = event.error_message || next.error
            next.provider = event.metadata?.provider || next.provider
            next.model = event.metadata?.model || next.model
            next.aiReport = event.ai_report || {}
            next.steps = Array.isArray(event.steps) ? event.steps : next.steps
            if (event.final_screenshot_base64) next.artifacts = [...(next.artifacts || []), {
              type: 'screenshot final', filename: 'ai-final.png', content_type: 'image/png', base64: event.final_screenshot_base64
            }]
          } else if (event.type === 'STATUS' && event.resolved_context) {
            next.resolvedContext = [...(next.resolvedContext || []).filter((item: any) => item.step !== event.step), {
              step: event.step,
              attempt: event.attempt,
              ...event.resolved_context,
            }]
          } else if (event.type === 'EXECUTION_FINISHED') {
            next.status = event.status || next.status
            next.observations = event.message || event.observations || next.observations
            next.provider = event.provider || next.provider
            next.model = event.model || next.model
          } else if (event.type === 'ERROR') {
            next.status = 'FALLO'
            next.error = event.error_message || event.message || 'El Motor IA no pudo completar la prueba.'
          }
          if (event.message && event.type !== 'STEP_RESULT') next.timeline.push({ type: event.type, agent: event.agent, level: event.level, message: event.message, step: event.step })
          return next
        })
      } catch (_) {}
    }
    return () => socket.close()
  }, [aiRunId, isAiDryRun, show])

  useEffect(() => {
    if (!show || jobIds.length === 0 || isAiDryRun) return
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
  }, [isAiDryRun, show, jobIdsKey, fetchWithAuth])

  const rows = jobs.map(job => {
    const detail = job.jobId ? jobDetails[job.jobId] : null
    const payload = detail?.payload_congelado || {}
    const metadata = detail?.metadata_resultado || (job as any).metadata_resultado || {}
    return {
      ...job,
      detail,
      status: isAiDryRun ? aiLive.status : job.error ? 'ERROR' : detail?.estado || job.status || 'PENDING',
      caseCode: job.caseCode || payload.case_code || '-',
      caseTitle: job.caseTitle || payload.case_title || 'Caso automatizado',
      framework: detail?.required_framework || payload.framework || '-',
      language: detail?.required_language || payload.language || 'javascript',
      headless: metadata.headless ?? payload.headless ?? (payload.debug_mode ? false : undefined),
      debugMode: metadata.debug_mode ?? payload.debug_mode ?? false,
      artifacts: isAiDryRun ? aiLive.artifacts : (Array.isArray(metadata.artifacts) ? metadata.artifacts : []),
      provider: isAiDryRun ? aiLive.provider : metadata.provider || payload.provider || '-',
      model: isAiDryRun ? aiLive.model : metadata.model || payload.model || '-',
      observations: isAiDryRun ? aiLive.observations : metadata.observations || '',
      aiReport: isAiDryRun ? (aiLive.aiReport || {}) : metadata.ai_report || {},
      steps: isAiDryRun ? aiLive.steps : (Array.isArray(metadata.steps) ? metadata.steps : []),
      caseSteps: isAiDryRun ? ((job as any).caseSteps || payload.steps || []) : (payload.steps || []),
      timeline: isAiDryRun ? aiLive.timeline : [],
      resolvedContext: isAiDryRun ? (aiLive.resolvedContext || []) : [],
      runner: detail?.runner_id || '-',
      elapsed: elapsedLabel(detail?.fecha_creacion, detail?.fecha_fin),
      error: isAiDryRun ? aiLive.error : job.error || detail?.error_message || metadata.error_message || metadata.error,
      log: isAiDryRun ? (aiLive.observations || aiLive.error || aiLive.timeline?.at?.(-1)?.message) : detail?.logs || (job as any).logs || metadata.logs || metadata.observations || metadata.error_message
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
    <>
    <Modal show={show && !selectedArtifact} onHide={onHide} centered size="xl" backdrop="static">
      <Modal.Header closeButton className="border-0 pb-0">
        <Modal.Title className="fw-bold d-flex align-items-center gap-2">
          <Activity size={22} className="text-primary" />
          {isAiDryRun ? 'Prueba temporal con IA' : isDryRun ? 'Prueba temporal' : 'Seguimiento de ejecucion automatizada'}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="p-4">
        <Alert variant="info" className="small">
          {isAiDryRun
            ? 'No se guardara en historial ni cambios del caso. Revisa los pasos, observaciones y evidencias devueltas por el Motor IA.'
            : isDryRun
              ? 'No se guardara en historial, reportes ni build. Sirve para validar la prueba antes de guardar o asignar a una build.'
            : 'Ejecucion automatizada enviada al worker. Puedes cerrar este modal; la ejecucion continuara en segundo plano.'}
        </Alert>

        <div className="d-grid gap-3 mb-3" style={{ gridTemplateColumns: `repeat(${isAiDryRun ? 4 : 5}, minmax(0, 1fr))` }}>
          <div className="border rounded-3 p-3 bg-light"><div className="text-muted x-small">Total</div><div className="fs-4 fw-bold">{total}</div></div>
          <div className="border rounded-3 p-3 bg-light"><div className="text-muted x-small">Completados</div><div className="fs-4 fw-bold">{completed}</div></div>
          <div className="border rounded-3 p-3 bg-light"><div className="text-muted x-small">Pasados</div><div className="fs-4 fw-bold text-success">{passed}</div></div>
          <div className="border rounded-3 p-3 bg-light"><div className="text-muted x-small">{isAiDryRun ? 'Fallos' : 'Fallos funcionales'}</div><div className="fs-4 fw-bold text-danger">{functionalFailures}</div></div>
          {!isAiDryRun && <div className="border rounded-3 p-3 bg-light"><div className="text-muted x-small">Runner/infra</div><div className="fs-4 fw-bold text-dark">{runnerProblems}</div></div>}
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
                {isAiDryRun ? <><th>Pasos</th><th>Evidencia</th><th>Proveedor / modelo</th></> : <><th>Framework</th><th>Worker</th><th>Tiempo</th></>}
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const rowKey = row.jobId || row.executionId || row.caseId || row.caseCode
                const steps = Array.isArray(row.steps) ? row.steps : (Array.isArray(row.detail?.metadata_resultado?.steps) ? row.detail.metadata_resultado.steps : [])
                const artifacts = Array.isArray(row.artifacts) ? row.artifacts : []
                const hasLog = Boolean(row.error || row.detail?.logs || row.log || row.observations || Object.keys(row.aiReport || {}).length || steps.length || artifacts.length || isAiDryRun)
                const resultDetail = row.log || row.error || row.observations || (Object.keys(row.aiReport || {}).length ? JSON.stringify(row.aiReport, null, 2) : '') || 'El Motor IA no devolvio un detalle adicional para este fallo.'
                const scriptFormat = row.detail?.metadata_resultado?.script_format || row.detail?.payload_congelado?.script_format
                const responseLabel = isAiDryRun
                  ? 'resultado IA'
                  : scriptFormat === 'playwright_test'
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
                      {isAiDryRun ? <>
                        <td>{steps.length || '-'}</td>
                        <td>{artifacts.length ? `${artifacts.length} disponible${artifacts.length === 1 ? '' : 's'}` : 'Sin evidencia'}</td>
                        <td className="small">
                          <div className="fw-semibold">{row.provider}</div>
                          <div className="text-muted text-break">{row.model}</div>
                        </td>
                      </> : <>
                        <td className="font-monospace small">
                          <div>{row.framework} + {languageLabel(row.language)}</div>
                          <div className="text-muted">{row.headless === false ? 'headed/debug visual' : row.headless === true ? 'headless' : row.debugMode ? 'debug visual' : '-'}</div>
                        </td>
                        <td className="font-monospace small">{row.runner}</td>
                        <td>{row.elapsed}</td>
                      </>}
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
                        <td colSpan={isAiDryRun ? 6 : 6} className="bg-light">
                          {isBlockedByRunner && (
                            <Alert variant="warning" className="small mb-2">
                              No hay worker compatible para <strong>{row.framework} + {languageLabel(row.language)}</strong>. Inicia o vincula un worker que anuncie ese framework y lenguaje, y vuelve a ejecutar el dry-run o la prueba.
                            </Alert>
                          )}
                          {row.error && <Alert variant="danger" className="small mb-2">{row.error}</Alert>}
                          <div className="text-uppercase text-muted x-small fw-bold mb-2">{responseLabel}</div>
                          <pre className="bg-dark text-light rounded-3 p-3 small mb-2 overflow-auto" style={{ maxHeight: 260, whiteSpace: 'pre-wrap' }}>
                            {resultDetail}
                          </pre>
                          {isAiDryRun && row.timeline?.length > 0 && (
                            <div className="border rounded-3 bg-white p-2 mb-2">
                              <div className="text-uppercase text-muted x-small fw-bold mb-2">Actividad del Motor IA</div>
                              {row.timeline.map((item: any, index: number) => (
                                <div key={`${rowKey}-timeline-${index}`} className="small border-bottom py-1">
                                  <span className="text-muted me-2">{item.agent || item.type}</span>{item.message}
                                </div>
                              ))}
                            </div>
                          )}
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
                                  if (!href) return null
                                  const label = `${artifact.type || 'evidencia'}${artifact.step_number ? ` paso ${artifact.step_number}` : ''}`
                                  return (
                                    <div key={`${rowKey}-artifact-${artifact.id || index}`} className="border rounded-3 p-2 bg-light" style={{ width: 190 }}>
                                      {String(artifact.content_type || '').startsWith('image/') && (
                                        <img src={href} alt={label} className="d-block w-100 rounded-2 mb-2" style={{ height: 100, objectFit: 'contain', background: '#fff' }} />
                                      )}
                                      <div className="small fw-semibold text-truncate mb-2" title={artifact.filename || label}>{artifact.filename || label}</div>
                                      <div className="d-flex gap-1">
                    <Button
                      variant="outline-primary"
                      size="sm"
                      className="x-small flex-grow-1"
                      onClick={() => setSelectedArtifact({ href, label, filename: artifact.filename || label })}
                    >
                      Ver
                    </Button>
                                        <a href={href} download={artifact.filename || `evidencia-${index + 1}`} className="btn btn-outline-secondary btn-sm x-small" title="Descargar evidencia">
                                          <Download size={13} />
                                        </a>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                          {isAiDryRun && row.resolvedContext.length > 0 && (
                            <div className="border rounded-3 bg-white p-2 mb-2">
                              <div className="text-uppercase text-muted x-small fw-bold mb-2">Datos interpretados por el agente</div>
                              {row.resolvedContext.map((item: any, index: number) => (
                                <div key={`${rowKey}-context-${index}`} className="small border-bottom py-2">
                                  <strong>Paso {item.step ?? index + 1}:</strong>{' '}
                                  {item.inputs?.length ? item.inputs.join('; ') : '(sin datos estructurados)'}
                                  {item.ambiguities?.length > 0 && <div className="text-warning mt-1">Ambigüedad: {item.ambiguities.join(' | ')}</div>}
                                </div>
                              ))}
                            </div>
                          )}
                          {steps.length > 0 && (
                            <div className="border rounded-3 bg-white p-2">
                              <div className="text-uppercase text-muted x-small fw-bold mb-2">Steps devueltos por el script</div>
                              {steps.map((step: any, index: number) => (
                                <div key={`${rowKey}-step-${index}`} className="border-bottom py-2 small">
                                  {(() => {
                                    const caseStep = (Array.isArray(row.caseSteps) ? row.caseSteps : []).find((item: any) => Number(item.numero_paso ?? item.number) === Number(step.number ?? step.numero_paso ?? index + 1)) || {}
                                    return (
                                      <div className="bg-light rounded-2 p-2 mb-2">
                                        <div><strong>Acción del caso:</strong> {caseStep.accion || caseStep.action || 'No disponible'}</div>
                                        <div><strong>Datos usados:</strong> <span className="font-monospace">{caseStep.datos || caseStep.data || 'Sin datos'}</span></div>
                                        <div><strong>Resultado esperado:</strong> {caseStep.resultado_esperado || caseStep.expected || 'No definido'}</div>
                                        <div><strong>Qué observó la IA:</strong> {step.observations || step.reason || step.error_log || 'Sin observación adicional'}</div>
                                        <div className={step.status === 'PASO' ? 'text-success' : 'text-danger'}><strong>Diagnóstico:</strong> {friendlyStepDiagnosis(step)}</div>
                                      </div>
                                    )
                                  })()}
                                  <div className="d-flex justify-content-between gap-3">
                                    <span className="font-monospace">Paso {step.number ?? step.numero_paso ?? index + 1}</span>
                                    <Badge bg={statusVariant(step.status ?? step.estado)}>{statusLabel(step.status ?? step.estado)}</Badge>
                                  </div>
                                  <div className="mt-1"><strong>Agente:</strong> {step.agent || 'Motor IA'} <span className="ms-3"><strong>Categoría:</strong> {failureCategoryLabel(step.failure_category)}</span></div>
                                  <div><strong>Motivo:</strong> {step.reason || step.observations || step.observaciones || '-'}</div>
                                  <div><strong>Acción:</strong> {step.action_executed === false ? 'No ejecutada' : step.action_summary || 'No especificada'}</div>
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
    <Modal show={show && Boolean(selectedArtifact)} onHide={() => setSelectedArtifact(null)} centered size="xl" backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title className="fw-bold">{selectedArtifact?.label || 'Evidencia'}</Modal.Title>
      </Modal.Header>
      <Modal.Body className="text-center bg-dark">
        {selectedArtifact?.href ? (
          <img
            src={selectedArtifact.href}
            alt={selectedArtifact.label || 'Evidencia'}
            className="img-fluid rounded"
            style={{ maxHeight: '70vh', objectFit: 'contain' }}
          />
        ) : (
          <div className="text-white">No se pudo cargar la evidencia.</div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={() => setSelectedArtifact(null)}>Cerrar</Button>
        {selectedArtifact?.href && (
          <a
            href={selectedArtifact.href}
            download={selectedArtifact.filename || 'evidencia.png'}
            className="btn btn-primary"
          >
            Descargar
          </a>
        )}
      </Modal.Footer>
    </Modal>
    </>
  )
}
