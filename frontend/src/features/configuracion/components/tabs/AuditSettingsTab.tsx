import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Col, Form, Modal, Row, Spinner, Table } from 'react-bootstrap'
import { ClipboardCheck, Download, Eye, Filter, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { API_BASE } from '../../../../app/constants'
import { useI18n } from '../../../../i18n'
import { formatDateTime } from '../../../../shared/utils/dateTime'

type AuditSettingsTabProps = {
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  showFeedback: (title: string, message: string, variant?: string) => void
}

type AuditLogRow = {
  id: string
  usuario_id?: string | null
  usuario_email?: string | null
  usuario_nombre?: string | null
  accion: string
  recurso: string
  recurso_id?: string | null
  detalles?: Record<string, any> | null
  ip_address?: string | null
  origen?: string | null
  fecha: string
}

const ACTION_LABELS: Record<string, string> = {
  CREATE: 'auditActionCreate',
  UPDATE: 'auditActionUpdate',
  DELETE: 'auditActionDelete',
  LOGIN: 'auditActionLogin',
  LOGOUT: 'auditActionLogout',
  AD_LOGIN: 'auditActionAdLogin',
  AD_LDAP_LOGIN: 'auditActionAdLdapLogin',
  AD_LOGIN_FAILED: 'auditActionAdLoginFailed',
  AD_LDAP_LOGIN_FAILED: 'auditActionAdLdapLoginFailed',
  AD_TOKEN_EXCHANGE: 'auditActionAdTokenExchange',
  DISABLE: 'auditActionDisable',
  ENABLE: 'auditActionEnable',
  PASSWORD_RESET: 'auditActionPasswordReset',
  SYSTEM_FIRST_RUN_COMPLETED: 'auditActionSystemFirstRunCompleted',
}

const RESOURCE_LABELS: Record<string, string> = {
  auth: 'auditResourceAuth', usuario: 'auditResourceUser', usuarios: 'auditResourceUsers', rol: 'auditResourceRole',
  rol_personalizado: 'auditResourceCustomRole', roles: 'auditResourceRoles', project: 'auditResourceProject', proyecto: 'auditResourceProject',
  suite: 'auditResourceSuite', case: 'auditResourceTestCase', caso: 'auditResourceTestCase', build: 'auditResourceBuild', bug: 'auditResourceBug',
  execution: 'auditResourceExecution', report: 'auditResourceReport', notification_rule: 'auditResourceNotificationRule',
  notification_template: 'auditResourceNotificationTemplate', system: 'auditResourceSystem', auth_ad_config: 'auditResourceAdConfig',
}

async function readJsonResponse(response: Response, t: (key: string) => string) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data?.detail || t('configuracion.auditOperationFailed'))
  }
  return data
}

function compactId(value: string | null | undefined, t: (key: string) => string) {
  if (!value) return t('configuracion.noDataShort')
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value
}

function prettifyKey(value: string | null | undefined, t: (key: string) => string) {
  if (!value) return t('configuracion.noDataShort')
  if (RESOURCE_LABELS[value]) return t(`configuracion.${RESOURCE_LABELS[value]}`)
  return value
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase())
}

function actionLabel(value: string | null | undefined, t: (key: string) => string) {
  if (!value) return t('configuracion.noDataShort')
  return ACTION_LABELS[value] ? t(`configuracion.${ACTION_LABELS[value]}`) : prettifyKey(value, t)
}

function resourceLabel(value: string | null | undefined, t: (key: string) => string) {
  return prettifyKey(value, t)
}

function actorLabel(row: AuditLogRow, t: (key: string) => string) {
  if (row.usuario_nombre?.trim()) return row.usuario_nombre.trim()
  if (row.usuario_email?.trim()) return row.usuario_email.trim()
  if (row.usuario_id) return compactId(row.usuario_id, t)
  return t('configuracion.auditSystem')
}

function actorSecondary(row: AuditLogRow, t: (key: string) => string) {
  if (row.usuario_email && row.usuario_nombre && row.usuario_email !== row.usuario_nombre) return row.usuario_email
  if (row.usuario_id) return `ID ${compactId(row.usuario_id, t)}`
  return t('configuracion.auditAutomaticEvent')
}

function originLabel(value: string | null | undefined, t: (key: string) => string) {
  if (value === 'trusted_proxy') return t('configuracion.auditOriginProxy')
  if (value === 'http_client') return t('configuracion.auditOriginHttp')
  if (value === 'internal_worker') return t('configuracion.auditOriginInternal')
  return t('configuracion.auditOriginUnknown')
}

function ipLabel(row: AuditLogRow, t: (key: string) => string) {
  return row.ip_address || (row.origen === 'internal_worker'
    ? t('configuracion.auditIpInternal')
    : t('configuracion.auditIpNotRecorded'))
}

function flattenDetails(value: Record<string, any> | null | undefined, t: (key: string) => string): Array<[string, any]> | string {
  if (!value || Object.keys(value).length === 0) return t('configuracion.auditNoDetails')
  const pairs: Array<[string, any]> = []
  const collect = (prefix: string, item: any) => {
    if (pairs.length >= 4 || item === null || item === undefined || item === '') return
    if (Array.isArray(item)) {
      pairs.push([prefix, `${item.length} elementos`])
      return
    }
    if (typeof item === 'object') {
      Object.entries(item).forEach(([key, nested]) => collect(prefix ? `${prefix}.${key}` : key, nested))
      return
    }
    pairs.push([prefix, item])
  }
  Object.entries(value).forEach(([key, item]) => collect(key, item))
  return pairs
}

function safeDetailsPreview(value: Record<string, any> | null | undefined, t: (key: string) => string) {
  const details = flattenDetails(value, t)
  if (typeof details === 'string') return details
  return details.map(([key, item]) => `${prettifyKey(key, t)}: ${String(item)}`).join(' · ')
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
  const { t } = useI18n()
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
      const data = await readJsonResponse(response, t)
      setRows(Array.isArray(data) ? data : [])
    } catch (error: any) {
      showFeedback(t('configuracion.auditTitle'), error?.message || t('configuracion.auditLoadFailed'), 'danger')
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
        actionLabel(row.accion, t),
        row.recurso,
        resourceLabel(row.recurso, t),
        row.recurso_id,
        row.usuario_id,
        row.usuario_email,
        row.usuario_nombre,
        row.ip_address,
        row.origen,
        safeDetailsPreview(row.detalles, t),
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
          <h5 className="fw-bold text-secondary text-uppercase small m-0">{t('configuracion.auditTitle')}</h5>
          <span className="small text-muted">{t('configuracion.auditDesc')}</span>
        </div>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" size="sm" className="fw-bold" onClick={() => downloadAuditJson(filteredRows)} disabled={filteredRows.length === 0}>
            <Download size={14} className="me-1" /> {t('configuracion.export')}
          </Button>
          <Button variant="outline-primary" size="sm" className="fw-bold" onClick={loadAuditLogs} disabled={loading}>
            {loading ? <Spinner size="sm" className="me-1" /> : <RefreshCw size={14} className="me-1" />}
            {t('configuracion.refresh')}
          </Button>
        </div>
      </div>

      <Row className="g-3 mb-3">
        <Col md={3}><Card className="border-0 shadow-sm rounded-4 bg-white p-3"><div className="small text-muted">{t('configuracion.loadedEvents')}</div><div className="h4 mb-0">{totals.events}</div></Card></Col>
        <Col md={3}><Card className="border-0 shadow-sm rounded-4 bg-white p-3"><div className="small text-muted">{t('configuracion.resources')}</div><div className="h4 mb-0">{totals.resources}</div></Card></Col>
        <Col md={3}><Card className="border-0 shadow-sm rounded-4 bg-white p-3"><div className="small text-muted">{t('configuracion.actors')}</div><div className="h4 mb-0">{totals.actors}</div></Card></Col>
        <Col md={3}><Card className="border-0 shadow-sm rounded-4 bg-white p-3"><div className="small text-muted">{t('configuracion.ips')}</div><div className="h4 mb-0">{totals.ips}</div></Card></Col>
      </Row>

      <Card className="border-0 shadow-sm rounded-4 bg-white p-4 mb-3">
        <div className="d-flex align-items-center gap-2 mb-3">
          <Filter size={18} className="text-primary" />
          <h6 className="fw-bold mb-0">{t('configuracion.filters')}</h6>
        </div>
        <Row className="g-3">
          <Col lg={4}>
            <div className="position-relative">
              <Search size={15} className="position-absolute text-muted" style={{ left: 12, top: 10 }} />
              <Form.Control size="sm" className="ps-5" placeholder={t('configuracion.auditSearch')} value={search} onChange={event => setSearch(event.target.value)} />
            </div>
          </Col>
          <Col lg={3}>
            <Form.Select size="sm" value={resourceFilter} onChange={event => setResourceFilter(event.target.value)}>
              <option value="">{t('configuracion.allResources')}</option>
              {resources.map(resource => <option key={resource} value={resource}>{resourceLabel(resource, t)}</option>)}
            </Form.Select>
          </Col>
          <Col lg={3}>
            <Form.Select size="sm" value={actionFilter} onChange={event => setActionFilter(event.target.value)}>
              <option value="">{t('configuracion.allActions')}</option>
              {actions.map(action => <option key={action} value={action}>{actionLabel(action, t)}</option>)}
            </Form.Select>
          </Col>
          <Col lg={2}>
            <Form.Select size="sm" value={limit} onChange={event => setLimit(Number(event.target.value))}>
              <option value={50}>50 {t('configuracion.events')}</option>
              <option value={100}>100 {t('configuracion.events')}</option>
              <option value={250}>250 {t('configuracion.events')}</option>
              <option value={500}>500 {t('configuracion.events')}</option>
            </Form.Select>
          </Col>
        </Row>
      </Card>

      <Card className="border-0 shadow-sm rounded-4 bg-white p-4">
        <div className="d-flex align-items-center gap-2 mb-3">
          <ShieldCheck size={18} className="text-primary" />
          <h6 className="fw-bold mb-0">{t('configuracion.recentEvents')}</h6>
          <Badge bg="light" text="dark" className="border">{filteredRows.length} {t('configuracion.visible')}</Badge>
        </div>
        {loading ? (
          <Alert variant="light" className="border small mb-0"><Spinner size="sm" className="me-2" />{t('configuracion.loadingEvents')}</Alert>
        ) : filteredRows.length === 0 ? (
          <Alert variant="light" className="border small mb-0">{t('configuracion.noFilteredEvents')}</Alert>
        ) : (
          <Table hover responsive className="align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th>{t('configuracion.date')}</th><th>{t('configuracion.action')}</th><th>{t('configuracion.auditResourceLabel')}</th>
                <th>{t('configuracion.actor')}</th><th>{t('configuracion.ip')}</th><th>{t('configuracion.detail')}</th><th className="text-end">{t('configuracion.view')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(row => (
                <tr key={row.id}>
                  <td className="small text-nowrap">{formatDateTime(row.fecha)}</td>
                  <td><Badge bg="primary" className="text-nowrap">{actionLabel(row.accion, t)}</Badge></td>
                  <td>
                    <div className="fw-bold">{resourceLabel(row.recurso, t)}</div>
                    <div className="small text-muted">{compactId(row.recurso_id, t)}</div>
                  </td>
                  <td style={{ minWidth: 190 }}>
                    <div className="fw-semibold text-truncate" style={{ maxWidth: 220 }} title={actorLabel(row, t)}>{actorLabel(row, t)}</div>
                    <div className="small text-muted text-truncate" style={{ maxWidth: 220 }} title={actorSecondary(row, t)}>{actorSecondary(row, t)}</div>
                  </td>
                  <td className="small">
                    <div>{ipLabel(row, t)}</div>
                    <div className="text-muted text-nowrap">{originLabel(row.origen, t)}</div>
                  </td>
                  <td className="small text-muted" style={{ minWidth: 320, maxWidth: 520 }}>{safeDetailsPreview(row.detalles, t)}</td>
                  <td className="text-end">
                    <Button variant="outline-secondary" size="sm" onClick={() => setSelected(row)}>
                      <Eye size={14} className="me-1" /> {t('configuracion.detail')}
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
            <ClipboardCheck size={20} /> {t('configuracion.auditDetail')}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selected && (
            <div className="d-flex flex-column gap-3">
              <Row className="g-2">
                <Col md={6}><div className="border rounded-3 p-2"><div className="small text-muted">{t('configuracion.event')}</div><code>{selected.id}</code></div></Col>
                <Col md={6}><div className="border rounded-3 p-2"><div className="small text-muted">{t('configuracion.date')}</div><strong>{formatDateTime(selected.fecha)}</strong></div></Col>
                <Col md={4}><div className="border rounded-3 p-2"><div className="small text-muted">{t('configuracion.action')}</div><strong>{actionLabel(selected.accion, t)}</strong><div className="small text-muted">{selected.accion}</div></div></Col>
                <Col md={4}><div className="border rounded-3 p-2"><div className="small text-muted">{t('configuracion.auditResourceLabel')}</div><strong>{resourceLabel(selected.recurso, t)}</strong><div className="small text-muted">{selected.recurso}</div></div></Col>
                <Col md={4}><div className="border rounded-3 p-2"><div className="small text-muted">{t('configuracion.ip')}</div><strong>{ipLabel(selected, t)}</strong><div className="small text-muted">{originLabel(selected.origen, t)}</div></div></Col>
                <Col md={6}><div className="border rounded-3 p-2"><div className="small text-muted">{t('configuracion.user')}</div><strong>{actorLabel(selected, t)}</strong><div className="small text-muted">{selected.usuario_email || t('configuracion.noEmailAssociated')}</div><code>{selected.usuario_id || t('configuracion.noDataShort')}</code></div></Col>
                <Col md={6}><div className="border rounded-3 p-2"><div className="small text-muted">{t('configuracion.resourceId')}</div><code>{selected.recurso_id || t('configuracion.noDataShort')}</code></div></Col>
              </Row>
              <div className="border rounded-3 p-3 bg-light">
                <div className="small text-muted fw-bold mb-1">{t('configuracion.readableSummary')}</div>
                <div>{safeDetailsPreview(selected.detalles, t)}</div>
              </div>
              <div>
                <div className="small text-muted fw-bold mb-1">{t('configuracion.sanitizedDetails')}</div>
                <pre className="bg-light border rounded-3 p-3 small mb-0 text-wrap">{JSON.stringify(selected.detalles || {}, null, 2)}</pre>
              </div>
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setSelected(null)}>{t('configuracion.close')}</Button>
        </Modal.Footer>
      </Modal>
    </div>
  )
}
