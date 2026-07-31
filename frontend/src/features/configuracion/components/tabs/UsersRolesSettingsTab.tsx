import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Card, Col, Form, Row, Table } from 'react-bootstrap'
import { Edit, Key, RefreshCw, Search, Trash2, User } from 'lucide-react'
import { API_BASE } from '../../../../app/constants'
import { useI18n } from '../../../../i18n'

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
  const { t } = useI18n()
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
        if (!cancelled) setAdConfigLoadError(t('configuracion.adConfigLoadError'))
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
        throw new Error(payload?.detail || t('configuracion.backendResponded', { status: response.status }))
      }
      setAdSyncSummary(payload)
      await loadUsersFromBackend()
    } catch (error: any) {
      setAdSyncError(error?.message || t('configuracion.adSyncError'))
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
      <h5 className="fw-bold text-secondary mb-3 text-uppercase small">{t('configuracion.usersDirectoryAuthTitle')}</h5>

      {/* Active Directory Config */}
      <Card className="border-light-subtle shadow-sm rounded-4 bg-white mb-4">
        <Card.Body className="p-3">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div className="d-flex align-items-center gap-2">
              <div className="bg-primary bg-opacity-10 p-2 rounded text-primary"><Key size={20} /></div>
              <div>
                <h6 className="fw-bold m-0 text-dark">{t('configuracion.adIntegrationTitle')}</h6>
                <span className="text-muted x-small">{t('configuracion.adIntegrationDesc')}</span>
              </div>
            </div>
            <Badge bg={adConfig.enabled ? 'primary' : 'secondary'} className="rounded-pill">
              {adConfig.enabled ? t('configuracion.adModeActive', { mode: adModeLabel }) : t('configuracion.disabled')}
            </Badge>
          </div>

          {adConfig.enabled && (
            <div className="bg-light p-3 rounded-3 border mt-3 animate__animated animate__fadeIn">
              <Row className="g-2">
                <Col md={6}>
                  <Form.Group>
                    <Form.Label className="x-small fw-bold text-muted">{t('configuracion.ldapAdServer')}</Form.Label>
                    <Form.Control size="sm" type="text" value={adServer} readOnly className="border-light-subtle font-monospace text-primary fw-bold" placeholder={t('configuracion.configuredInAd')} />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group>
                    <Form.Label className="x-small fw-bold text-muted">{t('configuracion.baseOrAllowedDomains')}</Form.Label>
                    <Form.Control size="sm" type="text" value={adDomain} readOnly className="border-light-subtle" placeholder={t('configuracion.configuredInAd')} />
                  </Form.Group>
                </Col>
              </Row>
              <div className="small text-muted mt-3">
                {t('configuracion.adLinkedUsersNotice', { count: adProvisionedUsers })}
              </div>
              {canEditUsers && (
                <div className="d-flex flex-wrap align-items-center gap-2 mt-3">
                  <Button type="button" size="sm" variant="outline-primary" className="fw-bold" onClick={runAdSync} disabled={adSyncLoading}>
                    <RefreshCw size={14} className="me-1" /> {adSyncLoading ? t('configuracion.syncing') : t('configuracion.syncAd')}
                  </Button>
                  {adSyncSummary && (
                    <span className="small text-muted">
                      {t('configuracion.adSyncSummary', { total: adSyncSummary.total, updated: adSyncSummary.updated, deactivated: adSyncSummary.deactivated, errors: adSyncSummary.errors })}
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
            <h6 className="fw-bold text-dark m-0">{t('configuracion.usersDirectoryTitle', { visible: visibleUsers.length, total: appUsers.length })}</h6>
            <span className="x-small text-muted">{t('configuracion.usersDirectoryDesc')}</span>
          </div>
          <div className="d-flex align-items-center gap-2">
            {canEditUsers && (
              <Button variant="primary" size="sm" className="fw-bold rounded-pill px-3 shadow-sm" onClick={() => openUserModal()}>{t('configuracion.newTresekoUser')}</Button>
            )}
          </div>
        </Card.Header>
        <div className="px-4 py-3 border-bottom bg-light">
          <div className="input-group input-group-sm">
            <span className="input-group-text bg-white"><Search size={14} /></span>
            <Form.Control
              value={userSearch}
              onChange={(event) => setUserSearch(event.target.value)}
              placeholder={t('configuracion.userSearchPlaceholder')}
              aria-label={t('configuracion.userSearchAriaLabel')}
            />
          </div>
        </div>
        <Table responsive hover className="mb-0 align-middle">
          <thead className="bg-light">
            <tr className="x-small text-muted text-uppercase">
              <th className="px-4 py-3 border-0">{t('configuracion.user')}</th>
              <th className="border-0">{t('configuracion.email')}</th>
              <th className="border-0">{t('configuracion.globalRole')}</th>
              <th className="border-0">{t('configuracion.authentication')}</th>
              <th className="border-0">{t('configuracion.status')}</th>
              {canEditUsers && <th className="px-4 border-0 text-end">{t('configuracion.actions')}</th>}
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
                <td>{u.auth === 'AD' ? <Badge bg="primary" className="x-small">{t('configuracion.adLinked')}</Badge> : <Badge bg="secondary" className="x-small">{t('configuracion.local')}</Badge>}</td>
                <td><span className={`small fw-bold ${u.status === 'Activo' ? 'text-success' : 'text-danger'}`}>{u.status}</span></td>
                {canEditUsers && (
                  <td className="px-4 text-end d-flex gap-2 justify-content-end">
                    <Button variant="light" size="sm" className="p-1 text-secondary border shadow-sm hover-text-primary" onClick={() => openUserModal(u)} title={t('configuracion.editUser')} aria-label={t('configuracion.editUser')}><Edit size={14} /></Button>
                    <Button variant="light" size="sm" className="p-1 text-secondary border shadow-sm hover-text-danger" disabled={u.email === loggedUser.email} title={u.email === loggedUser.email ? t('configuracion.cannotDeactivateOwnAccount') : t('configuracion.deactivateUser')} aria-label={u.email === loggedUser.email ? t('configuracion.cannotDeactivateOwnAccount') : t('configuracion.deactivateUser')} onClick={() => handleDeactivateUser(u)}><Trash2 size={14} /></Button>
                  </td>
                )}
              </tr>
            ))}
            {appUsers.length > 0 && visibleUsers.length === 0 && (
              <tr>
                <td colSpan={canEditUsers ? 6 : 5} className="text-center py-4 text-muted small">
                  {t('configuracion.noMatchingUsers')}
                </td>
              </tr>
            )}
            {appUsers.length === 0 && (
              <tr>
                <td colSpan={canEditUsers ? 6 : 5} className="text-center py-4 text-muted small">
                  {t('configuracion.noUsersLoaded')}
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
  const { t } = useI18n()
  return (
    <div className="animate__animated animate__fadeIn">
      <Card className="border-0 shadow-sm rounded-4 bg-white overflow-hidden">
        <Card.Header className="bg-white border-bottom py-3 px-4 d-flex justify-content-between align-items-center responsive-card-header">
          <div>
            <h6 className="fw-bold text-dark m-0">{t('configuracion.rolesTitle', { count: systemRoleItems.length + customRoles.length })}</h6>
            <span className="small text-muted">{t('configuracion.rolesDesc')}</span>
          </div>
          {canEditRoles && (
            <Button variant="primary" size="sm" className="fw-bold rounded-pill px-3 shadow-sm" onClick={() => openRoleModal()}>+ {t('configuracion.newRole')}</Button>
          )}
        </Card.Header>
        <Table responsive hover className="mb-0 align-middle">
          <thead className="bg-light">
            <tr className="x-small text-muted text-uppercase">
              <th className="px-4 py-3 border-0">{t('configuracion.role')}</th>
              <th className="border-0">{t('configuracion.description')}</th>
              <th className="border-0">{t('configuracion.modules')}</th>
              <th className="border-0">{t('configuracion.status')}</th>
              {canEditRoles && <th className="px-4 border-0 text-end">{t('configuracion.actions')}</th>}
            </tr>
          </thead>
          <tbody>
            {[...systemRoleItems, ...customRoles].map(role => (
              <tr key={role.id} className="border-bottom">
                <td className="px-4 fw-bold text-dark">{role.name}</td>
                <td className="small text-muted">{role.description || t('configuracion.noDescription')}</td>
                <td className="small text-muted">{t('configuracion.assignedModules', { count: role.modules.length })}</td>
                <td><span className={`small fw-bold ${role.status === 'Activo' ? 'text-success' : 'text-danger'}`}>{role.status}</span></td>
                {canEditRoles && (
                  <td className="px-4 text-end d-flex gap-2 justify-content-end">
                    <Button variant="light" size="sm" className="p-1 text-secondary border shadow-sm hover-text-primary" onClick={() => openRoleModal(role)} title={t('configuracion.editRole')} aria-label={t('configuracion.editRole')}><Edit size={14} /></Button>
                    {!role.systemRole && <Button variant="light" size="sm" className="p-1 text-secondary border shadow-sm hover-text-danger" onClick={() => handleDeactivateRole(role)}><Trash2 size={14} /></Button>}
                  </td>
                )}
              </tr>
            ))}
            {systemRoleItems.length + customRoles.length === 0 && (
              <tr><td colSpan={5} className="text-center py-4 text-muted small">{t('configuracion.noCustomRoles')}</td></tr>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  )
}
