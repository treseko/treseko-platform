import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Col, Form, Modal, Row, Spinner, Table } from 'react-bootstrap'
import { ClipboardCheck, Download, Eye, Filter, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { API_BASE } from '../../../../app/constants'
import { formatDateTime } from '../../../../shared/utils/dateTime'

type AuditSettingsTabProps = {
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  showFeedback: (title: string, message: string, variant?: string) => void
}

type AuditLogRow = {
  id: string
  usuario_id?: string | null
  accion: string
  recurso: string
  recurso_id?: string | null
  detalles?: Record<string, any> | null
  ip_address?: string | null
  fecha: string
}

async function readJsonResponse(response: Response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data?.detail || 'No se pudo completar la operacion')
  }
  return data
}

function compactId(value?: string | null) {
  if (!value) return 'n/d'
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value
}

function safeDetailsPreview(value?: Record<string, any> | null) {
  if (!value || Object.keys(value).length === 0) return 'Sin detalles'
  const text = JSON.stringify(value)
  return text.length > 120 ? `${text.slice(0, 120)}...` : text
}

function downloadAuditJson(rows: AuditLogRow[]) {
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `treseko-auditoria-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function AuditSettingsTab({ fetchWithAuth, showFeedback }: AuditSettingsTabProps) {
  const [rows, setRows] = useState<AuditLogRow[]>([])
  const [loading, setLoading] = useState(false)
  const [limit, setLimit] = useState(100)
  const [search, setSearch] = useState('')
  const [resourceFilter, setResourceFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [selected, setSelected] = useState<AuditLogRow | null>(null)

  const loadAuditLogs = async () => {
    setLoading(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/audit/logs/?limit=${limit}`)
      const data = await readJsonResponse(response)
      setRows(Array.isArray(data) ? data : [])
    } catch (error: any) {
      showFeedback('Auditoria', error?.message || 'No se pudieron cargar los eventos de auditoria.', 'danger')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAuditLogs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit])

  const resources = useMemo(
    () => Array.from(new Set(rows.map(row => row.recurso).filter(Boolean))).sort(),
    [rows],
  )
  const actions = useMemo(
    () => Array.from(new Set(rows.map(row => row.accion).filter(Boolean))).sort(),
    [rows],
  )
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(row => {
      if (resourceFilter && row.recurso !== resourceFilter) return false
      if (actionFilter && row.accion !== actionFilter) return false
      if (!q) return true
      return [
        row.accion,
        row.recurso,
        row.recurso_id,
        row.usuario_id,
        row.ip_address,
        safeDetailsPreview(row.detalles),
      ].some(value => String(value || '').toLowerCase().includes(q))
    })
  }, [actionFilter, resourceFilter, rows, search])

  const totals = useMemo(() => ({
    events: rows.length,
    resources: resources.length,
    actors: new Set(rows.map(row => row.usuario_id).filter(Boolean)).size,
    ips: new Set(rows.map(row => row.ip_address).filter(Boolean)).size,
  }), [resources.length, rows])

  return (
    <div className="animate__animated animate__fadeIn">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h5 className="fw-bold text-secondary text-uppercase small m-0">Auditoria avanzada</h5>
          <span className="small text-muted">Eventos globales de seguridad, configuracion y cambios sensibles registrados por Treseko.</span>
        </div>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" size="sm" className="fw-bold" onClick={() => downloadAuditJson(filteredRows)} disabled={filteredRows.length === 0}>
            <Download size={14} className="me-1" /> Exportar
          </Button>
          <Button variant="outline-primary" size="sm" className="fw-bold" onClick={loadAuditLogs} disabled={loading}>
            {loading ? <Spinner size="sm" className="me-1" /> : <RefreshCw size={14} className="me-1" />}
            Actualizar
          </Button>
        </div>
      </div>

      <Row className="g-3 mb-3">
        <Col md={3}><Card className="border-0 shadow-sm rounded-4 bg-white p-3"><div className="small text-muted">Eventos cargados</div><div className="h4 mb-0">{totals.events}</div></Card></Col>
        <Col md={3}><Card className="border-0 shadow-sm rounded-4 bg-white p-3"><div className="small text-muted">Recursos</div><div className="h4 mb-0">{totals.resources}</div></Card></Col>
        <Col md={3}><Card className="border-0 shadow-sm rounded-4 bg-white p-3"><div className="small text-muted">Actores</div><div className="h4 mb-0">{totals.actors}</div></Card></Col>
        <Col md={3}><Card className="border-0 shadow-sm rounded-4 bg-white p-3"><div className="small text-muted">IPs</div><div className="h4 mb-0">{totals.ips}</div></Card></Col>
      </Row>

      <Card className="border-0 shadow-sm rounded-4 bg-white p-4 mb-3">
        <div className="d-flex align-items-center gap-2 mb-3">
          <Filter size={18} className="text-primary" />
          <h6 className="fw-bold mb-0">Filtros</h6>
        </div>
        <Row className="g-3">
          <Col lg={4}>
            <div className="position-relative">
              <Search size={15} className="position-absolute text-muted" style={{ left: 12, top: 10 }} />
              <Form.Control size="sm" className="ps-5" placeholder="Buscar accion, recurso, usuario, IP o detalles" value={search} onChange={event => setSearch(event.target.value)} />
            </div>
          </Col>
          <Col lg={3}>
            <Form.Select size="sm" value={resourceFilter} onChange={event => setResourceFilter(event.target.value)}>
              <option value="">Todos los recursos</option>
              {resources.map(resource => <option key={resource} value={resource}>{resource}</option>)}
            </Form.Select>
          </Col>
          <Col lg={3}>
            <Form.Select size="sm" value={actionFilter} onChange={event => setActionFilter(event.target.value)}>
              <option value="">Todas las acciones</option>
              {actions.map(action => <option key={action} value={action}>{action}</option>)}
            </Form.Select>
          </Col>
          <Col lg={2}>
            <Form.Select size="sm" value={limit} onChange={event => setLimit(Number(event.target.value))}>
              <option value={50}>50 eventos</option>
              <option value={100}>100 eventos</option>
              <option value={250}>250 eventos</option>
              <option value={500}>500 eventos</option>
            </Form.Select>
          </Col>
        </Row>
      </Card>

      <Card className="border-0 shadow-sm rounded-4 bg-white p-4">
        <div className="d-flex align-items-center gap-2 mb-3">
          <ShieldCheck size={18} className="text-primary" />
          <h6 className="fw-bold mb-0">Eventos recientes</h6>
          <Badge bg="light" text="dark" className="border">{filteredRows.length} visibles</Badge>
        </div>
        {loading ? (
          <Alert variant="light" className="border small mb-0"><Spinner size="sm" className="me-2" />Cargando eventos...</Alert>
        ) : filteredRows.length === 0 ? (
          <Alert variant="light" className="border small mb-0">No hay eventos para los filtros seleccionados.</Alert>
        ) : (
          <Table hover responsive className="align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th>Fecha</th>
                <th>Accion</th>
                <th>Recurso</th>
                <th>Actor</th>
                <th>IP</th>
                <th>Detalle</th>
                <th className="text-end">Ver</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(row => (
                <tr key={row.id}>
                  <td className="small text-nowrap">{formatDateTime(row.fecha)}</td>
                  <td><Badge bg="primary">{row.accion}</Badge></td>
                  <td>
                    <div className="fw-bold">{row.recurso}</div>
                    <div className="small text-muted">{compactId(row.recurso_id)}</div>
                  </td>
                  <td><code className="small">{compactId(row.usuario_id)}</code></td>
                  <td className="small">{row.ip_address || 'n/d'}</td>
                  <td className="small text-muted" style={{ minWidth: 260 }}>{safeDetailsPreview(row.detalles)}</td>
                  <td className="text-end">
                    <Button variant="outline-secondary" size="sm" onClick={() => setSelected(row)}>
                      <Eye size={14} className="me-1" /> Detalle
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal show={Boolean(selected)} onHide={() => setSelected(null)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title className="d-flex align-items-center gap-2">
            <ClipboardCheck size={20} /> Detalle de auditoria
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selected && (
            <div className="d-flex flex-column gap-3">
              <Row className="g-2">
                <Col md={6}><div className="border rounded-3 p-2"><div className="small text-muted">Evento</div><code>{selected.id}</code></div></Col>
                <Col md={6}><div className="border rounded-3 p-2"><div className="small text-muted">Fecha</div><strong>{formatDateTime(selected.fecha)}</strong></div></Col>
                <Col md={4}><div className="border rounded-3 p-2"><div className="small text-muted">Accion</div><strong>{selected.accion}</strong></div></Col>
                <Col md={4}><div className="border rounded-3 p-2"><div className="small text-muted">Recurso</div><strong>{selected.recurso}</strong></div></Col>
                <Col md={4}><div className="border rounded-3 p-2"><div className="small text-muted">IP</div><strong>{selected.ip_address || 'n/d'}</strong></div></Col>
                <Col md={6}><div className="border rounded-3 p-2"><div className="small text-muted">Usuario</div><code>{selected.usuario_id || 'n/d'}</code></div></Col>
                <Col md={6}><div className="border rounded-3 p-2"><div className="small text-muted">Recurso ID</div><code>{selected.recurso_id || 'n/d'}</code></div></Col>
              </Row>
              <div>
                <div className="small text-muted fw-bold mb-1">Detalles sanitizados</div>
                <pre className="bg-light border rounded-3 p-3 small mb-0 text-wrap">{JSON.stringify(selected.detalles || {}, null, 2)}</pre>
              </div>
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setSelected(null)}>Cerrar</Button>
        </Modal.Footer>
      </Modal>
    </div>
  )
}
