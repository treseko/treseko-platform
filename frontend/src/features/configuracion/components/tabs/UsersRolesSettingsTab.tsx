import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Card, Col, Form, Row, Table } from 'react-bootstrap'
import { Edit, Key, RefreshCw, Search, Trash2, User } from 'lucide-react'
import { API_BASE } from '../../../../app/constants'

type UsersSettingsTabProps = {
  adConfig: any
  setAdConfig: (config: any) => void
  appUsers: any[]
  loggedUser: any
  canEditUsers: boolean
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  loadUsersFromBackend: () => Promise<void>
  openUserModal: (user?: any) => void
  handleDeactivateUser: (user: any) => void
}

export function UsersSettingsTab({
  adConfig,
  setAdConfig,
  appUsers,
  loggedUser,
  canEditUsers,
  fetchWithAuth,
  loadUsersFromBackend,
  openUserModal,
  handleDeactivateUser,
}: UsersSettingsTabProps) {
  const [userSearch, setUserSearch] = useState('')
  const [adConfigLoadError, setAdConfigLoadError] = useState('')
  const [adSyncLoading, setAdSyncLoading] = useState(false)
  const [adSyncSummary, setAdSyncSummary] = useState<any>(null)
  const [adSyncError, setAdSyncError] = useState('')
  const normalizedUserSearch = userSearch.trim().toLowerCase()
  const adModeLabel = (adConfig.mode || 'oidc').toString().toUpperCase()
  const adServer = adConfig.ldap_url || adConfig.server || adConfig.discovery_url || adConfig.issuer || ''
  const adDomain = adConfig.ldap_base_dn || adConfig.domain || (adConfig.allowed_domains || []).join(', ')
  const adProvisionedUsers = appUsers.filter(user => user.auth === 'AD').length

  useEffect(() => {
    let cancelled = false
    fetchWithAuth(`${API_BASE}/auth/ad/config/`)
      .then(async response => {
        if (!response.ok) throw new Error(`Backend respondio ${response.status}`)
        return response.json()
      })
      .then(payload => {
        if (!cancelled) {
          setAdConfig((current: any) => ({ ...current, ...payload }))
          setAdConfigLoadError('')
        }
      })
      .catch(() => {
        if (!cancelled) setAdConfigLoadError('La configuracion completa de AD no esta disponible para este usuario.')
      })
    return () => {
      cancelled = true
    }
  }, [fetchWithAuth, setAdConfig])

  const runAdSync = async () => {
    setAdSyncLoading(true)
    setAdSyncError('')
    setAdSyncSummary(null)
    try {
      const response = await fetchWithAuth(`${API_BASE}/usuarios/ad/sync/`, {
        method: 'POST',
        body: JSON.stringify({ deactivate_missing: true, limit: 500 }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.detail || `Backend respondio ${response.status}`)
      }
      setAdSyncSummary(payload)
      await loadUsersFromBackend()
    } catch (error: any) {
      setAdSyncError(error?.message || 'No se pudo sincronizar Active Directory.')
    } finally {
      setAdSyncLoading(false)
    }
  }

  const visibleUsers = useMemo(() => {
    if (!normalizedUserSearch) return appUsers
    return appUsers.filter(user => {
      const haystack = `${user.name || ''} ${user.email || ''} ${user.role || ''} ${user.baseRole || ''} ${user.status || ''} ${user.auth || ''}`.toLowerCase()
      return haystack.includes(normalizedUserSearch)
    })
  }, [appUsers, normalizedUserSearch])

  return (
    <div className="animate__animated animate__fadeIn">
      <h5 className="fw-bold text-secondary mb-3 text-uppercase small">Directorio y Autenticación</h5>

      {/* Active Directory Config */}
      <Card className="border-light-subtle shadow-sm rounded-4 bg-white mb-4">
        <Card.Body className="p-3">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div className="d-flex align-items-center gap-2">
              <div className="bg-primary bg-opacity-10 p-2 rounded text-primary"><Key size={20} /></div>
              <div>
                <h6 className="fw-bold m-0 text-dark">Integración Active Directory (AD / LDAP)</h6>
                <span className="text-muted x-small">Permite a los usuarios iniciar sesión con sus credenciales de red corporativas.</span>
              </div>
            </div>
            <Badge bg={adConfig.enabled ? 'primary' : 'secondary'} className="rounded-pill">
              {adConfig.enabled ? `${adModeLabel} activo` : 'Deshabilitado'}
            </Badge>
          </div>

          {adConfig.enabled && (
            <div className="bg-light p-3 rounded-3 border mt-3 animate__animated animate__fadeIn">
              <Row className="g-2">
                <Col md={6}>
                  <Form.Group>
                    <Form.Label className="x-small fw-bold text-muted">Servidor LDAP / AD</Form.Label>
                    <Form.Control size="sm" type="text" value={adServer} readOnly className="border-light-subtle font-monospace text-primary fw-bold" placeholder="Configurado en Active Directory" />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group>
                    <Form.Label className="x-small fw-bold text-muted">Dominio Base / Dominios Permitidos</Form.Label>
                    <Form.Control size="sm" type="text" value={adDomain} readOnly className="border-light-subtle" placeholder="Configurado en Active Directory" />
                  </Form.Group>
                </Col>
              </Row>
              <div className="small text-muted mt-3">
                Usuarios AD vinculados en Treseko: <strong>{adProvisionedUsers}</strong>. La tabla muestra usuarios creados o auto-provisionados en Treseko; no enumera todo el directorio externo.
              </div>
              {canEditUsers && (
                <div className="d-flex flex-wrap align-items-center gap-2 mt-3">
                  <Button type="button" size="sm" variant="outline-primary" className="fw-bold" onClick={runAdSync} disabled={adSyncLoading}>
                    <RefreshCw size={14} className="me-1" /> {adSyncLoading ? 'Sincronizando' : 'Sincronizar AD'}
                  </Button>
                  {adSyncSummary && (
                    <span className="small text-muted">
                      Sync: {adSyncSummary.total} revisados, {adSyncSummary.updated} actualizados, {adSyncSummary.deactivated} inactivados, {adSyncSummary.errors} errores.
                    </span>
                  )}
                </div>
              )}
              {adSyncError && <div className="small text-danger mt-2">{adSyncError}</div>}
              {adConfigLoadError && <div className="x-small text-muted mt-2">{adConfigLoadError}</div>}
            </div>
          )}
        </Card.Body>
      </Card>

      {/* ABM Usuarios */}
      <Card className="border-0 shadow-sm rounded-4 bg-white overflow-hidden">
        <Card.Header className="bg-white border-bottom py-3 px-4 d-flex justify-content-between align-items-center responsive-card-header">
          <div>
            <h6 className="fw-bold text-dark m-0">Directorio de Usuarios ({visibleUsers.length}/{appUsers.length})</h6>
            <span className="x-small text-muted">Usuarios registrados en Treseko. AD se usa para autenticar; los roles se asignan desde Treseko.</span>
          </div>
          <div className="d-flex align-items-center gap-2">
            {canEditUsers && (
              <Button variant="primary" size="sm" className="fw-bold rounded-pill px-3 shadow-sm" onClick={() => openUserModal()}>+ Nuevo Usuario Treseko</Button>
            )}
          </div>
        </Card.Header>
        <div className="px-4 py-3 border-bottom bg-light">
          <div className="input-group input-group-sm">
            <span className="input-group-text bg-white"><Search size={14} /></span>
            <Form.Control
              value={userSearch}
              onChange={(event) => setUserSearch(event.target.value)}
              placeholder="Buscar usuario..."
              aria-label="Buscar usuario"
            />
          </div>
        </div>
        <Table responsive hover className="mb-0 align-middle">
          <thead className="bg-light">
            <tr className="x-small text-muted text-uppercase">
              <th className="px-4 py-3 border-0">Usuario</th>
              <th className="border-0">Email</th>
              <th className="border-0">Rol Global</th>
              <th className="border-0">Autenticación</th>
              <th className="border-0">Estado</th>
              {canEditUsers && <th className="px-4 border-0 text-end">Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {visibleUsers.map(u => (
              <tr key={u.id} className="border-bottom">
                <td className="px-4 fw-bold text-dark d-flex align-items-center gap-2">
                  <User size={16} className="text-secondary" /> {u.name}
                </td>
                <td className="small text-muted">{u.email}</td>
                <td><Badge bg="light" text="dark" className="border fw-normal shadow-sm">{u.role}</Badge></td>
                <td>{u.auth === 'AD' ? <Badge bg="primary" className="x-small">AD vinculado</Badge> : <Badge bg="secondary" className="x-small">Local</Badge>}</td>
                <td><span className={`small fw-bold ${u.status === 'Activo' ? 'text-success' : 'text-danger'}`}>{u.status}</span></td>
                {canEditUsers && (
                  <td className="px-4 text-end d-flex gap-2 justify-content-end">
                    <Button variant="light" size="sm" className="p-1 text-secondary border shadow-sm hover-text-primary" onClick={() => openUserModal(u)}><Edit size={14} /></Button>
                    <Button variant="light" size="sm" className="p-1 text-secondary border shadow-sm hover-text-danger" disabled={u.email === loggedUser.email} title={u.email === loggedUser.email ? 'No puedes inactivar tu propia cuenta' : 'Inactivar usuario'} onClick={() => handleDeactivateUser(u)}><Trash2 size={14} /></Button>
                  </td>
                )}
              </tr>
            ))}
            {appUsers.length > 0 && visibleUsers.length === 0 && (
              <tr>
                <td colSpan={canEditUsers ? 6 : 5} className="text-center py-4 text-muted small">
                  No hay usuarios que coincidan con la busqueda.
                </td>
              </tr>
            )}
            {appUsers.length === 0 && (
              <tr>
                <td colSpan={canEditUsers ? 6 : 5} className="text-center py-4 text-muted small">
                  No hay usuarios cargados. Usa actualizar para recargar el directorio.
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  )
}

type RolesSettingsTabProps = {
  systemRoleItems: any[]
  customRoles: any[]
  canEditRoles: boolean
  openRoleModal: (role?: any) => void
  handleDeactivateRole: (role: any) => void
}

export function RolesSettingsTab({
  systemRoleItems,
  customRoles,
  canEditRoles,
  openRoleModal,
  handleDeactivateRole,
}: RolesSettingsTabProps) {
  return (
    <div className="animate__animated animate__fadeIn">
      <Card className="border-0 shadow-sm rounded-4 bg-white overflow-hidden">
        <Card.Header className="bg-white border-bottom py-3 px-4 d-flex justify-content-between align-items-center responsive-card-header">
          <div>
            <h6 className="fw-bold text-dark m-0">Roles ({systemRoleItems.length + customRoles.length})</h6>
            <span className="small text-muted">Edita QA Lead, Tester y Viewer. Admin queda fijo.</span>
          </div>
          {canEditRoles && (
            <Button variant="primary" size="sm" className="fw-bold rounded-pill px-3 shadow-sm" onClick={() => openRoleModal()}>+ Nuevo Rol</Button>
          )}
        </Card.Header>
        <Table responsive hover className="mb-0 align-middle">
          <thead className="bg-light">
            <tr className="x-small text-muted text-uppercase">
              <th className="px-4 py-3 border-0">Rol</th>
              <th className="border-0">Descripción</th>
              <th className="border-0">Módulos</th>
              <th className="border-0">Estado</th>
              {canEditRoles && <th className="px-4 border-0 text-end">Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {[...systemRoleItems, ...customRoles].map(role => (
              <tr key={role.id} className="border-bottom">
                <td className="px-4 fw-bold text-dark">{role.name}</td>
                <td className="small text-muted">{role.description || 'Sin descripción'}</td>
                <td className="small text-muted">{role.modules.length} asignados</td>
                <td><span className={`small fw-bold ${role.status === 'Activo' ? 'text-success' : 'text-danger'}`}>{role.status}</span></td>
                {canEditRoles && (
                  <td className="px-4 text-end d-flex gap-2 justify-content-end">
                    <Button variant="light" size="sm" className="p-1 text-secondary border shadow-sm hover-text-primary" onClick={() => openRoleModal(role)}><Edit size={14} /></Button>
                    {!role.systemRole && <Button variant="light" size="sm" className="p-1 text-secondary border shadow-sm hover-text-danger" onClick={() => handleDeactivateRole(role)}><Trash2 size={14} /></Button>}
                  </td>
                )}
              </tr>
            ))}
            {systemRoleItems.length + customRoles.length === 0 && (
              <tr><td colSpan={5} className="text-center py-4 text-muted small">No hay roles personalizados creados.</td></tr>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  )
}
