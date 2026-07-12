import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Col, Modal, ProgressBar, Row, Table } from 'react-bootstrap'
import { Activity, Clock, Copy, Cpu, Database, HardDrive, Monitor, RefreshCw, RotateCcw, Server, WifiOff } from 'lucide-react'
import { dateTimeMs, formatDateTime } from '../../../../shared/utils/dateTime'
import { fetchSystemMonitorSummary, type FetchWithAuth, type SystemMonitorComponent, type SystemMonitorSummary, type SystemMonitorWorker } from '../../api/configuracionApi'

type SystemMonitorTabProps = {
  fetchWithAuth: FetchWithAuth
  showFeedback: (title: string, message: string, variant?: 'success' | 'danger' | 'warning' | 'info') => void
  copyToClipboard: (text: string, label?: string) => void
}

const statusVariant = (status: string) => {
  if (status === 'ONLINE') return 'success'
  if (status === 'BUSY' || status === 'RUNNING') return 'primary'
  if (status === 'DEGRADED' || status === 'NOT_CONFIGURED') return 'warning'
  if (status === 'OFFLINE' || status === 'DISABLED') return 'danger'
  return 'secondary'
}

const componentIcon = (component: SystemMonitorComponent) => {
  if (component.type === 'DATABASE') return Database
  if (component.type === 'CACHE') return HardDrive
  if (component.type === 'AI_ENGINE') return Cpu
  if (component.id === 'frontend') return Monitor
  return Server
}

const formatDuration = (seconds?: number | null) => {
  if (!seconds && seconds !== 0) return 'n/d'
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

const formatLastSeen = (value?: string | null) => {
  if (!value) return 'Sin heartbeat'
  const ms = dateTimeMs(value)
  if (!ms) return 'Sin heartbeat'
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (seconds < 60) return `Hace ${seconds}s`
  if (seconds < 3600) return `Hace ${Math.floor(seconds / 60)}m`
  return formatDateTime(value)
}

const workerFrameworks = (worker: SystemMonitorWorker) => {
  const frameworks = worker.capabilities?.frameworks
  return Array.isArray(frameworks) && frameworks.length ? frameworks.join(', ') : 'No reportado'
}

export function SystemMonitorTab({ fetchWithAuth, showFeedback, copyToClipboard }: SystemMonitorTabProps) {
  const [summary, setSummary] = useState<SystemMonitorSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedRestart, setSelectedRestart] = useState<{ name: string; command: string } | null>(null)

  const loadSummary = async (options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent)
    if (!silent) setLoading(true)
    try {
      const data = await fetchSystemMonitorSummary(fetchWithAuth)
      setSummary(data)
    } catch (error: any) {
      showFeedback('Monitor no disponible', error?.message || 'No se pudo consultar el estado de plataforma.', 'danger')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    loadSummary()
    const timer = window.setInterval(() => loadSummary({ silent: true }), 10000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totals = useMemo(() => {
    const components = summary?.components || []
    return {
      online: components.filter(component => component.status === 'ONLINE').length,
      degraded: components.filter(component => component.status === 'DEGRADED' || component.status === 'NOT_CONFIGURED').length,
      offline: components.filter(component => component.status === 'OFFLINE').length,
      workersOnline: (summary?.workers || []).filter(worker => worker.status === 'ONLINE' || worker.status === 'BUSY').length,
    }
  }, [summary])

  return (
    <div className="animate__animated animate__fadeIn">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h5 className="fw-bold text-secondary text-uppercase small m-0">Monitor de plataforma</h5>
          <span className="small text-muted">Estado operativo de servicios locales, motor IA y workers registrados.</span>
        </div>
        <Button variant="outline-primary" size="sm" className="fw-bold" onClick={() => loadSummary()} disabled={loading}>
          <RefreshCw size={14} className="me-1" /> Actualizar
        </Button>
      </div>

      <div className="border-0 shadow-sm rounded-4 bg-white p-4 mb-4">
        <Row className="g-3 align-items-stretch">
          <Col lg={4}>
            <div className="border rounded-3 p-3 h-100 bg-light">
              <div className="d-flex justify-content-between align-items-start mb-2">
                <div>
                  <div className="small text-muted">Disponibilidad</div>
                  <div className="display-6 fw-bold lh-1">{summary?.uptime_percent ?? 0}%</div>
                </div>
                <Badge bg={statusVariant(summary?.overall_status || 'OFFLINE')}>{summary?.overall_status || 'CARGANDO'}</Badge>
              </div>
              <ProgressBar now={summary?.uptime_percent || 0} variant={summary?.overall_status === 'ONLINE' ? 'success' : 'warning'} style={{ height: 8 }} />
              <div className="small text-muted mt-2">
                Ultimo chequeo: {summary?.checked_at ? formatDateTime(summary.checked_at) : 'pendiente'}
              </div>
            </div>
          </Col>
          <Col lg={8}>
            <Row className="g-3 h-100">
              <Col sm={3}><div className="border rounded-3 p-3 bg-light h-100"><div className="small text-muted">Online</div><div className="h4 text-success mb-0">{totals.online}</div></div></Col>
              <Col sm={3}><div className="border rounded-3 p-3 bg-light h-100"><div className="small text-muted">Atencion</div><div className="h4 text-warning mb-0">{totals.degraded}</div></div></Col>
              <Col sm={3}><div className="border rounded-3 p-3 bg-light h-100"><div className="small text-muted">Offline</div><div className="h4 text-danger mb-0">{totals.offline}</div></div></Col>
              <Col sm={3}><div className="border rounded-3 p-3 bg-light h-100"><div className="small text-muted">Workers online</div><div className="h4 text-primary mb-0">{totals.workersOnline}</div></div></Col>
            </Row>
          </Col>
        </Row>
      </div>

      <div className="border-0 shadow-sm rounded-4 bg-white p-4 mb-4">
        <div className="d-flex align-items-center gap-2 mb-3">
          <Activity size={18} className="text-primary" />
          <h6 className="fw-bold mb-0">Componentes</h6>
        </div>
        <Table hover responsive className="align-middle mb-0">
          <thead className="table-light">
            <tr>
              <th>Componente</th>
              <th>Estado</th>
              <th>IP / URL</th>
              <th>Latencia</th>
              <th>Detalle</th>
              <th className="text-end">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {(summary?.components || []).map(component => {
              const Icon = componentIcon(component)
              return (
                <tr key={component.id}>
                  <td>
                    <div className="fw-bold d-flex align-items-center gap-2"><Icon size={16} /> {component.name}</div>
                    <div className="small text-muted">{component.type}</div>
                  </td>
                  <td><Badge bg={statusVariant(component.status)}>{component.status}</Badge></td>
                  <td className="small text-break">{component.target || 'n/d'}</td>
                  <td className="small">{component.latency_ms ?? 0} ms</td>
                  <td className="small" style={{ minWidth: 220 }}>{component.detail || 'Sin detalle'}</td>
                  <td className="text-end">
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      disabled={!component.restart_hint}
                      onClick={() => component.restart_hint && setSelectedRestart({ name: component.name, command: component.restart_hint })}
                    >
                      <RotateCcw size={14} className="me-1" /> Reiniciar
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </div>

      <div className="border-0 shadow-sm rounded-4 bg-white p-4">
        <div className="d-flex align-items-center gap-2 mb-3">
          <Server size={18} className="text-primary" />
          <h6 className="fw-bold mb-0">Workers registrados</h6>
        </div>
        {(summary?.workers || []).length === 0 ? (
          <Alert variant="light" className="border small mb-0">
            No hay workers registrados. Inicia <code>npm start</code> en <code>automation-worker/</code> y vincula el codigo desde Automatizacion.
          </Alert>
        ) : (
          <Table hover responsive className="align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th>Worker</th>
                <th>Estado</th>
                <th>Host / IP</th>
                <th>Capacidades</th>
                <th>Recursos</th>
                <th>Heartbeat</th>
                <th className="text-end">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.workers || []).map(worker => (
                <tr key={worker.runner_id}>
                  <td>
                    <div className="fw-bold">{worker.name}</div>
                    <div className="small text-muted">{worker.type} · {worker.runner_id.slice(0, 8)} · PID {worker.pid || 'n/d'}</div>
                    <div className="small text-muted">{worker.tags.join(', ') || 'Sin tags'}</div>
                  </td>
                  <td><Badge bg={statusVariant(worker.status)}>{worker.status}</Badge></td>
                  <td className="small">
                    <div>{worker.hostname || 'Host no reportado'}</div>
                    <div className="text-muted">{worker.local_ips.join(', ') || 'IP no reportada'}</div>
                  </td>
                  <td className="small">
                    <div>{workerFrameworks(worker)}</div>
                    <div className="text-muted">Node {worker.capabilities?.node_version || 'n/d'} · Playwright {worker.capabilities?.playwright_version || worker.capabilities?.versions?.playwright || 'n/d'}</div>
                    <div className="text-muted">{(worker.capabilities?.browsers || []).join(', ') || 'Browsers no reportados'}</div>
                  </td>
                  <td className="small">
                    <div><Cpu size={13} className="me-1" />Jobs activos: {worker.active_jobs}</div>
                    <div><HardDrive size={13} className="me-1" />Disco libre: {worker.resources?.disk_free_mb ? `${worker.resources.disk_free_mb} MB` : 'n/d'}</div>
                    <div className="text-muted">RAM usada: {worker.resources?.memory_used_mb ? `${worker.resources.memory_used_mb} MB` : 'n/d'}</div>
                    <div className="text-muted"><Clock size={13} className="me-1" />Uptime: {formatDuration(worker.uptime_seconds)}</div>
                  </td>
                  <td className="small">{formatLastSeen(worker.last_heartbeat)}</td>
                  <td className="text-end">
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => setSelectedRestart({ name: worker.name, command: summary?.restart_hints?.worker || 'cd automation-worker; npm start' })}
                    >
                      <RotateCcw size={14} className="me-1" /> Reiniciar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      <Modal show={Boolean(selectedRestart)} onHide={() => setSelectedRestart(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="h6">Reinicio manual</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Alert variant="warning" className="small d-flex gap-2">
            <WifiOff size={18} className="flex-shrink-0 mt-1" />
            <div>Por seguridad, la plataforma no ejecuta reinicios desde la web. Ejecuta este comando en la terminal correspondiente.</div>
          </Alert>
          <div className="small text-muted mb-2">Componente: <span className="fw-bold text-dark">{selectedRestart?.name}</span></div>
          <pre className="bg-light border rounded-3 p-3 small mb-0 text-wrap">{selectedRestart?.command}</pre>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setSelectedRestart(null)}>Cerrar</Button>
          <Button
            variant="primary"
            onClick={() => {
              if (selectedRestart?.command) copyToClipboard(selectedRestart.command, 'Comando de reinicio')
            }}
          >
            <Copy size={14} className="me-1" /> Copiar comando
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  )
}
