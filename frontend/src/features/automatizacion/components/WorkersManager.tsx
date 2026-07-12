import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Col, Row, Table } from 'react-bootstrap'
import { Activity, CheckCircle2, Cpu, HardDrive, RefreshCw, Server, ShieldOff, XCircle } from 'lucide-react'
import { isValidUUID } from '../../../app/validation'
import { dateTimeMs, formatDateTime } from '../../../shared/utils/dateTime'
import { languageLabel, normalizeAutomationLanguage } from '../../casos/caseUtils'

type WorkerRunner = {
  id: string
  nombre: string
  tipo: string
  estado: string
  capabilities: Record<string, any>
  activo: boolean
  ultimo_heartbeat?: string | null
  fecha_creacion?: string | null
}

type PairingRequest = {
  id: string
  code: string
  nombre: string
  tipo: string
  capabilities: Record<string, any>
  estado: string
  expires_at: string
  fecha_creacion?: string | null
}

type AutomationJob = {
  id: string
  test_run_id: string
  ejecucion_id: string
  caso_id: string
  build_id?: string | null
  runner_id?: string | null
  estado: string
  required_framework: string
  required_language?: string
  required_runtime?: string | null
  payload_congelado?: Record<string, any>
  logs?: string | null
  error_message?: string | null
  metadata_resultado?: Record<string, any>
  fecha_creacion?: string | null
  fecha_claim?: string | null
  fecha_inicio?: string | null
  fecha_fin?: string | null
}

type WorkersManagerProps = {
  currentProjectId: string
  currentCompId: string
  currentBuildId: string
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  showFeedback: (title: string, message: string, variant?: 'success' | 'danger' | 'warning' | 'info') => void
  canViewWorkers?: boolean
  canManageWorkers: boolean
  canViewJobs?: boolean
  multiWorkerEnabled?: boolean
  schedulerEnabled?: boolean
}

const isOffline = (runner: WorkerRunner) => {
  if (!runner.activo) return true
  if (!runner.ultimo_heartbeat) return true
  const lastSeen = dateTimeMs(runner.ultimo_heartbeat)
  return !lastSeen || Date.now() - lastSeen > 60_000
}

const effectiveStatus = (runner: WorkerRunner) => {
  if (!runner.activo) return 'DISABLED'
  if (isOffline(runner)) return 'OFFLINE'
  return runner.estado || 'ONLINE'
}

const statusVariant = (status: string) => {
  if (status === 'ONLINE') return 'success'
  if (status === 'BUSY' || status === 'RUNNING') return 'primary'
  if (status === 'DEGRADED') return 'warning'
  return 'secondary'
}

const isOnlineStatus = (status: string) => ['ONLINE', 'BUSY', 'RUNNING'].includes(status)

const formatLastSeen = (value?: string | null) => {
  if (!value) return 'Sin heartbeat'
  return formatDateTime(value) || 'Sin heartbeat'
}

const getFrameworks = (capabilities: Record<string, any>) => {
  const frameworks = capabilities.frameworks || capabilities.supported_frameworks || capabilities.framework
  if (Array.isArray(frameworks)) return frameworks.join(', ')
  return frameworks || 'No reportado'
}

const getFrameworkLanguageRows = (capabilities: Record<string, any>) => {
  const frameworksRaw = capabilities.frameworks || capabilities.supported_frameworks || capabilities.framework
  const frameworks = Array.isArray(frameworksRaw)
    ? frameworksRaw.map(item => String(item).toLowerCase())
    : frameworksRaw
      ? [String(frameworksRaw).toLowerCase()]
      : []
  const matrix = capabilities.framework_languages || capabilities.languages || capabilities.supported_languages || {}
  const fallback: Record<string, string[]> = {
    playwright: ['javascript', 'typescript'],
    puppeteer: ['javascript', 'typescript'],
    cypress: ['javascript', 'typescript'],
    selenium: ['python']
  }
  const keys = frameworks.length ? frameworks : Object.keys(matrix)
  if (keys.length === 0) return [{ framework: 'No reportado', languages: 'No reportado' }]
  return keys.map(framework => {
    const languages = Array.isArray(matrix?.[framework]) ? matrix[framework] : fallback[framework] || []
    return {
      framework,
      languages: languages.map((language: string) => languageLabel(normalizeAutomationLanguage(language))).join(', ') || 'No reportado'
    }
  })
}

const jobStatusVariant = (status: string) => {
  if (status === 'PASSED') return 'success'
  if (status === 'FAILED') return 'danger'
  if (status === 'ERROR' || status === 'TIMEOUT') return 'warning'
  if (status === 'RUNNING' || status === 'CLAIMED') return 'primary'
  if (status === 'BLOCKED' || status === 'BLOCKED_BY_RUNNER') return 'secondary'
  return 'light'
}

const formatDuration = (start?: string | null, end?: string | null) => {
  if (!start) return 'n/d'
  const startMs = dateTimeMs(start)
  const endMs = end ? dateTimeMs(end) : Date.now()
  if (!startMs || !endMs) return 'n/d'
  const seconds = Math.max(0, Math.round((endMs - startMs) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

export function WorkersManager({
  currentProjectId,
  currentCompId,
  currentBuildId,
  fetchWithAuth,
  showFeedback,
  canViewWorkers = true,
  canManageWorkers,
  canViewJobs = true,
  multiWorkerEnabled = true,
  schedulerEnabled = true
}: WorkersManagerProps) {
  const [runners, setRunners] = useState<WorkerRunner[]>([])
  const [pairingRequests, setPairingRequests] = useState<PairingRequest[]>([])
  const [jobs, setJobs] = useState<AutomationJob[]>([])
  const [loading, setLoading] = useState(false)
  const [pairingActionCode, setPairingActionCode] = useState<string | null>(null)

  const loadRunners = async (options?: { silent?: boolean }) => {
    if (!canViewWorkers) return
    const silent = Boolean(options?.silent)
    if (!silent) setLoading(true)
    try {
      const response = await fetchWithAuth('/api/automation-runners/')
      if (!response.ok) throw new Error(await response.text())
      setRunners(await response.json())
    } catch (error: any) {
      showFeedback('No se pudieron cargar workers', error?.message || 'Error consultando runners.', 'danger')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  const loadJobs = async () => {
    if (!canViewJobs) return
    try {
      const params = new URLSearchParams({ limit: '20' })
      if (isValidUUID(currentProjectId)) params.set('proyecto_id', currentProjectId)
      if (isValidUUID(currentCompId)) params.set('component_id', currentCompId)
      if (isValidUUID(currentBuildId)) params.set('build_id', currentBuildId)
      const response = await fetchWithAuth(`/api/automation-jobs/?${params.toString()}`)
      if (!response.ok) throw new Error(await response.text())
      setJobs(await response.json())
    } catch (error: any) {
      showFeedback('No se pudieron cargar jobs', error?.message || 'Error consultando jobs de automatizacion.', 'danger')
    }
  }

  const refreshAll = async (options?: { silent?: boolean }) => {
    await Promise.all([
      canViewWorkers ? loadRunners(options) : Promise.resolve(),
      canManageWorkers ? loadPairingRequests() : Promise.resolve(),
      canViewJobs ? loadJobs() : Promise.resolve(),
    ])
  }

  const loadPairingRequests = async () => {
    if (!canManageWorkers) return
    try {
      const response = await fetchWithAuth('/api/automation-runners/pairing-requests/')
      if (!response.ok) throw new Error(await response.text())
      setPairingRequests(await response.json())
    } catch (error: any) {
      showFeedback('No se pudieron cargar solicitudes', error?.message || 'Error consultando vinculaciones.', 'danger')
    }
  }

  useEffect(() => {
    refreshAll()
    const timer = window.setInterval(() => {
      refreshAll({ silent: true })
    }, 10000)
    return () => window.clearInterval(timer)
  }, [canViewWorkers, canManageWorkers, canViewJobs, currentProjectId, currentCompId, currentBuildId])

  const totals = useMemo(() => {
    const online = runners.filter(runner => isOnlineStatus(effectiveStatus(runner))).length
    const busy = runners.filter(runner => ['BUSY', 'RUNNING'].includes(effectiveStatus(runner))).length
    return { online, busy, total: runners.length }
  }, [runners])

  const approvePairing = async (request: PairingRequest) => {
    setPairingActionCode(request.code)
    try {
      const response = await fetchWithAuth(`/api/automation-runners/pairing-requests/${request.code}/approve`, { method: 'POST' })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.detail || 'No se pudo aprobar la vinculacion.')
      showFeedback('Worker aprobado', `${request.nombre} ya puede conectarse.`, 'success')
      await refreshAll()
    } catch (error: any) {
      showFeedback('No se pudo aprobar', error?.message || 'Backend rechazo la vinculacion.', 'danger')
    } finally {
      setPairingActionCode(null)
    }
  }

  const denyPairing = async (request: PairingRequest) => {
    setPairingActionCode(request.code)
    try {
      const response = await fetchWithAuth(`/api/automation-runners/pairing-requests/${request.code}/deny`, { method: 'POST' })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.detail || 'No se pudo rechazar la solicitud.')
      showFeedback('Solicitud rechazada', `${request.nombre} debera generar un nuevo codigo.`, 'warning')
      await refreshAll()
    } catch (error: any) {
      showFeedback('No se pudo rechazar', error?.message || 'Backend rechazo la accion.', 'danger')
    } finally {
      setPairingActionCode(null)
    }
  }

  const revokeRunner = async (runner: WorkerRunner) => {
    const response = await fetchWithAuth(`/api/automation-runners/${runner.id}/revoke`, { method: 'POST' })
    if (response.ok) {
      showFeedback('Worker deshabilitado', `${runner.nombre} ya no puede tomar jobs.`, 'success')
      refreshAll()
      return
    }
    const data = await response.json().catch(() => null)
    showFeedback('No se pudo deshabilitar', data?.detail || 'Backend rechazo la accion.', 'danger')
  }

  return (
    <Card className="border-0 shadow-sm rounded-4 bg-white p-4 mb-4">
      <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
        <div>
          <h6 className="fw-bold text-dark mb-1 d-flex align-items-center gap-2">
            <Server size={20} className="text-primary" />
            Workers de automatizacion
          </h6>
          <p className="small text-muted mb-0">
            Ejecutores dedicados que toman jobs por pull mode y reportan resultados a Treseko.
          </p>
        </div>
        <Button variant="outline-primary" size="sm" className="fw-bold" onClick={() => refreshAll()} disabled={loading}>
          <RefreshCw size={14} className="me-1" /> Actualizar
        </Button>
      </div>

      {canViewWorkers && <Row className="g-3 mb-3">
        <Col md={4}><div className="border rounded-3 p-3 bg-light"><div className="small text-muted">Registrados</div><div className="h4 mb-0">{totals.total}</div></div></Col>
        <Col md={4}><div className="border rounded-3 p-3 bg-light"><div className="small text-muted">Online</div><div className="h4 mb-0 text-success">{totals.online}</div></div></Col>
        <Col md={4}><div className="border rounded-3 p-3 bg-light"><div className="small text-muted">Ocupados</div><div className="h4 mb-0 text-primary">{totals.busy}</div></div></Col>
      </Row>}

      {canViewWorkers && !multiWorkerEnabled && (
        <Alert variant="info" className="border small">
          Community incluye un worker local basico. Si existen workers heredados, Treseko los muestra en lectura segura; la vinculacion, revocacion y administracion multi-worker requieren Premium.
        </Alert>
      )}

      {canViewWorkers && canManageWorkers ? (
        <div className="border rounded-3 p-3 mb-3">
          <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
            <div>
              <div className="fw-bold">Vinculacion asistida</div>
              <div className="small text-muted">
                Ejecuta <code>npm start</code> en <code>automation-worker/</code>. El worker mostrara un codigo corto para aprobar aqui.
              </div>
            </div>
            <Button variant="outline-primary" size="sm" className="fw-bold" onClick={loadPairingRequests}>
              <RefreshCw size={14} className="me-1" /> Solicitudes
            </Button>
          </div>
          {pairingRequests.length === 0 ? (
            <Alert variant="light" className="border small mb-0">
              No hay workers esperando vinculacion. Ejecuta <code>npm start</code> en <code>automation-worker/</code>.
            </Alert>
          ) : (
            <div className="d-flex flex-column gap-2">
              {pairingRequests.map(request => (
                <div key={request.id} className="border rounded-3 p-3 bg-light">
                  <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
                    <div>
                      <div className="d-flex align-items-center gap-2 mb-1">
                        <Badge bg="primary" className="fs-6">{request.code}</Badge>
                        <span className="fw-bold">{request.nombre}</span>
                      </div>
                      <div className="small text-muted">
                        Expira: {formatDateTime(request.expires_at)} · {getFrameworks(request.capabilities)}
                      </div>
                      <div className="small text-muted">
                        Node {request.capabilities?.node_version || 'n/d'} · Playwright {request.capabilities?.playwright_version || request.capabilities?.versions?.playwright || 'n/d'}
                      </div>
                    </div>
                    <div className="d-flex gap-2">
                      <Button
                        variant="success"
                        size="sm"
                        className="fw-bold"
                        onClick={() => approvePairing(request)}
                        disabled={pairingActionCode === request.code}
                      >
                        <CheckCircle2 size={14} className="me-1" /> Aprobar
                      </Button>
                      <Button
                        variant="outline-danger"
                        size="sm"
                        className="fw-bold"
                        onClick={() => denyPairing(request)}
                        disabled={pairingActionCode === request.code}
                      >
                        <XCircle size={14} className="me-1" /> Rechazar
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : canViewWorkers ? (
        <Alert variant="light" className="border small">
          Puedes consultar workers disponibles, pero necesitas permiso de edicion en automatizacion para vincular o revocar workers.
        </Alert>
      ) : null}

      {canViewWorkers && <Table hover responsive className="align-middle mb-0">
        <thead className="table-light">
          <tr>
            <th>Worker</th>
            <th>Estado</th>
            <th>Capacidades</th>
            <th>Recursos</th>
            <th>Ultimo heartbeat</th>
            <th className="text-end">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {runners.map(runner => {
            const status = effectiveStatus(runner)
            const resources = runner.capabilities?.resources || {}
            return (
              <tr key={runner.id}>
                <td>
                  <div className="fw-bold">{runner.nombre}</div>
                  <div className="small text-muted">{runner.tipo} · {runner.id.slice(0, 8)}</div>
                </td>
                <td><Badge bg={statusVariant(status)}>{status}</Badge></td>
                <td className="small">
                  <div className="d-flex flex-column gap-1">
                    {getFrameworkLanguageRows(runner.capabilities).map(row => (
                      <div key={row.framework}>
                        <Activity size={13} className="me-1" />
                        <span className="fw-semibold">{row.framework}</span>
                        <span className="text-muted">: {row.languages}</span>
                      </div>
                    ))}
                  </div>
                  <div className="text-muted">
                    Node {runner.capabilities?.node_version || 'n/d'} · Playwright {runner.capabilities?.playwright_version || runner.capabilities?.versions?.playwright || 'n/d'}
                  </div>
                  <div className="text-muted">{(runner.capabilities?.browsers || []).join(', ') || 'Browsers no reportados'}</div>
                </td>
                <td className="small">
                  <div><Cpu size={13} className="me-1" />Jobs activos: {runner.capabilities?.active_jobs ?? 0}</div>
                  <div><HardDrive size={13} className="me-1" />Disco libre: {resources.disk_free_mb ? `${resources.disk_free_mb} MB` : 'n/d'}</div>
                  <div className="text-muted">RAM usada: {resources.memory_used_mb ? `${resources.memory_used_mb} MB` : 'n/d'}</div>
                </td>
                <td className="small">{formatLastSeen(runner.ultimo_heartbeat)}</td>
                <td className="text-end">
                  {canManageWorkers ? (
                    <Button variant="outline-danger" size="sm" disabled={!runner.activo} onClick={() => revokeRunner(runner)}>
                      <ShieldOff size={14} className="me-1" /> Revocar
                    </Button>
                  ) : (
                    <span className="text-muted small">Solo lectura</span>
                  )}
                </td>
              </tr>
            )
          })}
          {runners.length === 0 && (
            <tr>
              <td colSpan={6} className="text-center text-muted py-4">
                No hay workers registrados en esta base. Inicia uno desde <code>automation-worker/</code> y aprueba su codigo en esta pantalla.
              </td>
            </tr>
          )}
        </tbody>
      </Table>}

      {canViewJobs && <div className="border-top mt-4 pt-3">
        <div className="d-flex justify-content-between align-items-start gap-3 mb-2">
          <div>
            <h6 className="fw-bold text-dark mb-1">Jobs recientes</h6>
            <p className="small text-muted mb-0">
              Ultimos trabajos enviados a workers. Usa esta tabla para ver si el job fue tomado, termino o fallo al reportar.
            </p>
          </div>
          <Button variant="outline-secondary" size="sm" className="fw-bold" onClick={loadJobs}>
            <RefreshCw size={14} className="me-1" /> Jobs
          </Button>
        </div>
        <Table hover responsive className="align-middle mb-0">
          <thead className="table-light">
            <tr>
              <th>Caso</th>
              <th>Estado</th>
              <th>Worker</th>
              <th>Framework</th>
              <th>Creado</th>
              <th>Tiempo</th>
              <th>Diagnostico</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map(job => {
              const payload = job.payload_congelado || {}
              const runner = runners.find(item => item.id === job.runner_id)
              const diagnostic = job.error_message || job.logs || ''
              return (
                <tr key={job.id}>
                  <td>
                    <div className="fw-bold">
                      <Badge bg="light" text="primary" className="border me-2">{payload.case_code || job.caso_id.slice(0, 8)}</Badge>
                      {payload.case_title || 'Caso automatizado'}
                    </div>
                    <div className="small text-muted">Job {job.id.slice(0, 8)}</div>
                  </td>
                  <td><Badge bg={jobStatusVariant(job.estado)} text={job.estado === 'PENDING' ? 'dark' : undefined}>{job.estado}</Badge></td>
                  <td className="small">
                    {runner ? (
                      <>
                        <div className="fw-semibold">{runner.nombre}</div>
                        <div className="text-muted">{runner.id.slice(0, 8)}</div>
                      </>
                    ) : (
                      <span className="text-muted">Sin asignar</span>
                    )}
                  </td>
                  <td className="small">
                    <div>{job.required_framework || payload.framework || 'n/d'} + {languageLabel(job.required_language || payload.language || 'javascript')}</div>
                    <div className="text-muted">{job.required_runtime || payload.framework_version || 'compatible'}</div>
                  </td>
                  <td className="small">{formatLastSeen(job.fecha_creacion)}</td>
                  <td className="small">{formatDuration(job.fecha_claim || job.fecha_creacion, job.fecha_fin)}</td>
                  <td className="small" style={{ minWidth: 260 }}>
                    {diagnostic ? (
                      <details>
                        <summary className="text-primary fw-semibold" role="button">Ver log/error</summary>
                        <pre className="bg-light border rounded-3 p-2 mt-2 mb-0 small text-wrap" style={{ maxHeight: 160, overflow: 'auto' }}>
                          {diagnostic}
                        </pre>
                      </details>
                    ) : (
                      <span className="text-muted">Sin diagnostico reportado</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-muted py-4">
                  Todavia no hay jobs automatizados. Inicia una ejecucion automatizada desde Ejecutar Pruebas.
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      </div>}
      {!schedulerEnabled && (
        <Alert variant="light" className="border small mt-4 mb-0">
          La cola de jobs y el scheduler quedan bloqueados en Community para evitar llamadas a endpoints Premium.
        </Alert>
      )}
    </Card>
  )
}
