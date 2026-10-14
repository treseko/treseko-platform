import { useState } from 'react'
import { Accordion, Alert, Badge, Button, Card, Col, Form, Modal, Row, Table } from 'react-bootstrap'
import { Copy, Plug, ShieldCheck } from 'lucide-react'
import { formatDateTime } from '../../../shared/utils/dateTime'
import { useI18n } from '../../../i18n'
import type { McpCredential, McpTool, McpScope } from '../api/configuracionApi'

type Props = {
  canEdit: boolean
  enabled?: boolean
  status?: 'available' | 'disabled'
  endpoint?: string
  tools: McpTool[]
  scopeCatalog?: McpScope[]
  effectiveCapabilities?: Record<string, 'read' | 'edit'>
  credentials: McpCredential[]
  loading: boolean
  error: string | null
  rawCredential: string | null
  onDismissRawCredential?: () => void
  copyToClipboard: (value: string, label?: string) => void
  onCreate: (name: string, scopes: string[], expiresAt?: string) => void | Promise<boolean | undefined>
  onRevoke: (credential: McpCredential) => void
  onSetState?: (credential: McpCredential, estado: 'ACTIVE' | 'PAUSED') => void
  onToggle?: (enabled: boolean) => void
}

const IMPORT_SCOPES = [
  { scope: 'mcp.cases.import.preview', operation: 'preview', write: false },
  { scope: 'mcp.cases.import.commit', operation: 'commit', write: true },
  { scope: 'mcp.cases.import.rollback', operation: 'rollback', write: true },
] as const

export function McpPanel({ canEdit, enabled = true, status = 'available', endpoint = '/api/mcp', tools, scopeCatalog = [], effectiveCapabilities = {}, credentials, loading, error, rawCredential, onDismissRawCredential = () => undefined, copyToClipboard, onCreate, onRevoke, onSetState = () => undefined, onToggle = () => undefined }: Props) {
  const { t } = useI18n()
  const mcpEnabled = enabled && status !== 'disabled'
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>([])
  const [expiresAt, setExpiresAt] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const authorizedToolNames = new Set(scopeCatalog.filter(item => item.selectable).flatMap(item => item.tools.map(tool => tool.name)))
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const created = await onCreate(name.trim() || t('configuracion.mcpDefaultName'), scopes, expiresAt ? new Date(expiresAt).toISOString() : undefined)
    if (created === true) { setShowCreateModal(false); setName(''); setScopes([]); setExpiresAt('') }
  }
  return (
    <Card className="border-0 shadow-sm rounded-4 bg-white p-4 mt-4" aria-busy={loading}>
      <div className="d-flex flex-column flex-md-row justify-content-between gap-3 mb-4">
        <div>
          <h6 className="fw-bold text-dark mb-1 d-flex align-items-center gap-2"><Plug size={19} className="text-primary" /> {t('configuracion.mcpTitle')}</h6>
          <p className="small text-muted mb-0">{t('configuracion.mcpDescription')}</p>
        </div>
        <div className="d-flex flex-column align-items-md-end gap-2">
          <Badge bg="light" text="dark" className="border">{t('configuracion.mcpStatus')}: {loading ? t('configuracion.loading') : error ? t('configuracion.error') : status === 'disabled' || !enabled ? t('configuracion.disabled') : t('configuracion.mcpAvailable')}</Badge>
          <Form.Check type="switch" id="mcp-enabled-switch" label={mcpEnabled ? t('configuracion.mcpEnabled') : t('configuracion.mcpDisabled')} checked={mcpEnabled} disabled={!canEdit || loading} onChange={event => onToggle(event.target.checked)} />
          <span className="x-small text-muted text-md-end">{canEdit ? t('configuracion.mcpActivationHint') : t('configuracion.mcpActivationPermissionHint')}</span>
        </div>
      </div>
      {error && <Alert variant="danger" role="alert">{error}</Alert>}
      {!error && loading && <div role="status" className="text-muted small mb-3">{t('configuracion.loading')}</div>}
      <div className="border rounded-3 bg-light p-3 mb-4">
        <div className="small text-muted">{t('configuracion.mcpEndpoint')}</div>
        <code className="d-block text-break">{endpoint}</code>
        <div className="small text-muted mt-2"><ShieldCheck size={14} className="me-1" />{t('configuracion.mcpAuthHint')}</div>
        <div className="small text-muted mt-1">{t('configuracion.mcpBrowserSession')}</div>
      </div>
      <Accordion className="mb-4 mcp-advanced-sections">
        <Accordion.Item eventKey="permissions" data-testid="mcp-effective-permissions">
          <Accordion.Header>{t('configuracion.mcpEffectivePermissionsTitle')}</Accordion.Header>
          <Accordion.Body>
            <p className="small text-muted mb-2">{t('configuracion.mcpEffectivePermissionsDescription')}</p>
            <div className="d-flex flex-wrap gap-2 mb-3">
              {Object.entries(effectiveCapabilities).map(([capability, level]) => <Badge key={capability} bg={level === 'edit' ? 'warning' : 'secondary'} text={level === 'edit' ? 'dark' : undefined}>{capability}: {level}</Badge>)}
              {Object.keys(effectiveCapabilities).length === 0 && <span className="small text-muted">{t('configuracion.mcpNoEffectivePermissions')}</span>}
            </div>
            <Table responsive hover size="sm" className="mb-0 align-middle">
              <thead><tr><th>{t('configuracion.mcpScope')}</th><th>{t('configuracion.mcpPermissionLevel')}</th><th>{t('configuracion.mcpScopeTools')}</th></tr></thead>
              <tbody>{scopeCatalog.map(item => <tr key={item.scope}><td><code>{item.scope}</code></td><td><Badge bg={item.selectable ? 'success' : 'secondary'}>{item.user_level}</Badge></td><td className="small">{item.tools.map(tool => `${tool.name} (${tool.required_level})`).join(', ')}</td></tr>)}
                {scopeCatalog.length === 0 && <tr><td colSpan={3} className="small text-muted">{t('configuracion.mcpNoScopeCatalog')}</td></tr>}</tbody>
            </Table>
          </Accordion.Body>
        </Accordion.Item>
        <Accordion.Item eventKey="tools">
          <Accordion.Header>{t('configuracion.mcpTools')}</Accordion.Header>
          <Accordion.Body>
            {tools.length === 0 && !loading ? <p className="small text-muted">{t('configuracion.mcpNoTools')}</p> : (
              <div className="d-grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                {tools.map(tool => {
                  const authorized = authorizedToolNames.has(tool.name)
                  return <div key={tool.name} className={`border rounded-3 p-3 ${authorized ? '' : 'bg-light'}`} aria-label={authorized ? tool.name : `${tool.name} — ${t('configuracion.mcpToolNotAuthorized')}`}>
                  <div className="d-flex flex-wrap justify-content-between gap-2 align-items-start"><code className="small">{tool.name}</code>{!authorized && <Badge bg="secondary">{t('configuracion.mcpToolNotAuthorized')}</Badge>}</div><div className="small text-muted mt-1">{tool.description}</div>
                  <div className="x-small mt-2"><strong>{t('configuracion.mcpCapability')}:</strong> {tool.capability}</div>
                  <div className="x-small"><strong>{t('configuracion.mcpScope')}:</strong> {tool.required_scope}</div>
                </div>})}
              </div>
            )}
          </Accordion.Body>
        </Accordion.Item>
        <Accordion.Item eventKey="imports" data-testid="mcp-import-permissions">
          <Accordion.Header>{t('configuracion.mcpImportPermissionsTitle')}</Accordion.Header>
          <Accordion.Body>
            <p className="small text-muted mb-2">{t('configuracion.mcpImportPermissionsDescription')}</p>
            <div className="d-grid gap-2">
              {IMPORT_SCOPES.map(({ scope, operation, write }) => <div key={scope} className="d-flex flex-wrap align-items-center justify-content-between gap-2 border rounded-2 px-2 py-2">
                <code>{scope}</code>
                <span className="small text-muted">{t(`configuracion.mcpImportOperation${operation[0].toUpperCase()}${operation.slice(1)}`)} · {write ? t('configuracion.mcpWritePermission') : t('configuracion.mcpReadOnlyPermission')}</span>
              </div>)}
            </div>
            <div className="small text-muted mt-2">{t('configuracion.mcpDenyByDefault')}</div>
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
      {canEdit && mcpEnabled && <div className="border-top pt-4 mb-4"><Button onClick={() => setShowCreateModal(true)} disabled={loading}>{t('configuracion.mcpCreate')}</Button></div>}
      <Modal show={showCreateModal} onHide={() => setShowCreateModal(false)} centered size="lg" aria-labelledby="mcp-create-modal-title">
        <Form onSubmit={event => { void submit(event) }}>
          <Modal.Header closeButton><Modal.Title id="mcp-create-modal-title">{t('configuracion.mcpCreateTitle')}</Modal.Title></Modal.Header>
          <Modal.Body>
            <Alert variant="info" className="small">{t('configuracion.mcpModalPermissionHint')}</Alert>
            <Row className="g-3">
              <Col md={6}><Form.Label htmlFor="mcp-name">{t('configuracion.mcpName')}</Form.Label><Form.Control id="mcp-name" value={name} onChange={e => setName(e.target.value)} autoFocus /></Col>
              <Col md={6}><Form.Label htmlFor="mcp-expiry">{t('configuracion.mcpExpiry')}</Form.Label><Form.Control id="mcp-expiry" type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} /></Col>
              <Col xs={12}><Form.Label>{t('configuracion.mcpSelectScopes')}</Form.Label><Accordion className="mcp-scope-selector">{scopeCatalog.map(item => <Accordion.Item key={item.scope} eventKey={item.scope} className={!item.selectable ? 'bg-light' : ''}>
  <div className="d-flex align-items-center">
    <Accordion.Header className="flex-grow-1">{item.scope}</Accordion.Header>
    <Form.Check
      type="checkbox"
      id={`mcp-scope-${item.scope}`}
      checked={scopes.includes(item.scope)}
      disabled={!item.selectable || loading}
      onChange={() => setScopes(current => current.includes(item.scope) ? current.filter(scope => scope !== item.scope) : [...current, item.scope])}
      label={<span><code className="small">{item.scope}</code> <Badge bg={item.selectable ? 'success' : 'secondary'}>{item.user_level}</Badge></span>}
      className="me-3"
    />
  </div>
  <Accordion.Body className="small text-muted">{item.tools.map(tool => `${tool.name} · ${tool.required_level}`).join(' · ')}</Accordion.Body>
</Accordion.Item>)}{scopeCatalog.length === 0 && <span className="small text-muted">{t('configuracion.mcpNoSelectableScopes')}</span>}</Accordion></Col>
            </Row>
          </Modal.Body>
          <Modal.Footer><Button variant="outline-secondary" onClick={() => setShowCreateModal(false)}>{t('configuracion.cancel')}</Button><Button type="submit" disabled={loading || scopes.length === 0}>{t('configuracion.mcpCreate')}</Button></Modal.Footer>
        </Form>
      </Modal>
      {mcpEnabled && rawCredential && <Alert variant="warning" role="alert"><div className="fw-bold">{t('configuracion.mcpCredentialWarning')}</div><div className="d-flex flex-column flex-sm-row gap-2 mt-2"><code className="bg-white p-2 rounded text-break flex-grow-1">{rawCredential}</code><Button variant="outline-dark" size="sm" onClick={() => copyToClipboard(rawCredential, t('configuracion.mcpTitle'))}><Copy size={14} className="me-1" />{t('configuracion.copy')}</Button><Button variant="outline-secondary" size="sm" onClick={onDismissRawCredential}>{t('configuracion.mcpDismissCredential')}</Button></div></Alert>}
      <Accordion className="mcp-advanced-sections">
        <Accordion.Item eventKey="credentials">
          <Accordion.Header>{t('configuracion.mcpCredentials')}</Accordion.Header>
          <Accordion.Body>
            <div className="small text-muted mb-2">{t('configuracion.mcpCredentialMetadataHint')}</div>
            <Table responsive hover size="sm" className="mb-0 align-middle"><thead><tr><th>{t('configuracion.name')}</th><th>{t('configuracion.prefix')}</th><th>{t('configuracion.mcpScope')}</th><th>{t('configuracion.status')}</th>{canEdit && <th className="text-end">{t('configuracion.action')}</th>}</tr></thead><tbody>
              {credentials.map(credential => <tr key={credential.id}><td>{credential.nombre}</td><td><code>{credential.key_prefix}...</code></td><td>{credential.scopes_json.join(', ')}</td><td><Badge bg={credential.estado === 'ACTIVE' || (!credential.estado && credential.activo) ? 'success' : credential.estado === 'PAUSED' ? 'warning' : 'secondary'} text={credential.estado === 'PAUSED' ? 'dark' : undefined}>{credential.estado === 'ACTIVE' || (!credential.estado && credential.activo) ? t('configuracion.active') : credential.estado === 'PAUSED' ? t('configuracion.paused') : t('configuracion.revoked')}</Badge>{credential.ultimo_uso && <div className="x-small text-muted">{formatDateTime(credential.ultimo_uso)}</div>}</td>{canEdit && <td className="text-end"><div className="d-flex justify-content-end gap-2 flex-wrap">{credential.estado !== 'REVOKED' && credential.activo && <Button variant="link" className="text-warning p-0" disabled={loading} onClick={() => onSetState(credential, 'PAUSED')}>{t('configuracion.pause')}</Button>}{credential.estado === 'PAUSED' && <Button variant="link" className="text-success p-0" disabled={loading} onClick={() => onSetState(credential, 'ACTIVE')}>{t('configuracion.activate')}</Button>}<Button variant="link" className="text-danger p-0" disabled={loading || credential.estado === 'REVOKED' || (!credential.estado && !credential.activo)} onClick={() => onRevoke(credential)}>{t('configuracion.revoke')}</Button></div></td>}</tr>)}
              {credentials.length === 0 && !loading && <tr><td colSpan={canEdit && mcpEnabled ? 5 : 4} className="text-center py-3 text-muted small">{t('configuracion.mcpNoCredentials')}</td></tr>}
            </tbody></Table>
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
    </Card>
  )
}
