import { useEffect, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeft,
  Bell,
  BellOff,
  Building2,
  Check,
  ChevronRight,
  Folders,
  Layers,
  LogOut,
  Menu,
  PlayCircle,
  X
} from 'lucide-react'
import { Badge, Button, Dropdown, Nav } from 'react-bootstrap'
import type { ModuleId, SessionUser } from '../app/types'
import { DEFAULT_BRANDING, type BrandingState } from '../app/branding'
import { resolveAssetUrl } from '../shared/utils/assets'
import { API_BASE } from '../app/constants'

export type SidebarItem = {
  id: ModuleId
  label: string
  icon: LucideIcon
}

type AppShellProps = {
  children: ReactNode
  sidebarCollapsed: boolean
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>
  sidebarItems: SidebarItem[]
  activeTab: string
  onModuleNavigation: (moduleId: ModuleId) => void
  organizations: any[]
  currentOrgId: string
  onOrgChange: (orgId: string) => void
  loggedUser: SessionUser
  onLogout: () => void
  projectsList: any[]
  currentProjectId: string
  onProjectChange: (projectId: string) => void
  componentsList: any[]
  currentCompId: string
  onComponentChange: (componentId: string) => void
  buildsList: any[]
  currentBuildId: string
  sortBuildsNewestFirst: (builds: any[]) => any[]
  onBuildChange: (build: any) => void
  canAccessConfig: boolean
  systemEdition?: 'community' | 'premium'
  branding?: BrandingState
}

export function AppShell({
  children,
  sidebarCollapsed,
  setSidebarCollapsed,
  sidebarItems,
  activeTab,
  onModuleNavigation,
  organizations,
  currentOrgId,
  onOrgChange,
  loggedUser,
  onLogout,
  projectsList,
  currentProjectId,
  onProjectChange,
  componentsList,
  currentCompId,
  onComponentChange,
  buildsList,
  currentBuildId,
  sortBuildsNewestFirst,
  onBuildChange,
  canAccessConfig,
  systemEdition = 'community',
  branding = DEFAULT_BRANDING
}: AppShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [notifications, setNotifications] = useState<any[]>([])
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [notificationPreferences, setNotificationPreferences] = useState<any[]>([])
  const activeOrganizations = organizations.filter(org => org.active !== false)
  const currentOrg = activeOrganizations.find(org => org.id === currentOrgId)
  const currentProject = projectsList.find(project => project.id === currentProjectId)
  const currentComponent = componentsList.find(component => component.id === currentCompId)
  const currentBuild = buildsList.find(build => build.id === currentBuildId)
  const projectComponents = componentsList.filter(component => component.projectId === currentProjectId)
  const currentOrgIsActive = activeOrganizations.some(org => org.id === currentOrgId)
  const orgProjects = currentOrgIsActive ? projectsList.filter(project => project.orgId === currentOrgId) : []
  const visibleBuilds = buildsList.filter(build => build.projectId === currentProjectId && build.componentId === currentCompId && !build.hidden)
  const editionLabel = systemEdition === 'premium' ? 'Premium' : 'Community'
  const brandName = branding.effective_brand_name || DEFAULT_BRANDING.effective_brand_name
  const brandLogoUrl = resolveAssetUrl(branding.effective_logo_url) || DEFAULT_BRANDING.effective_logo_url
  const globalInAppPreference = notificationPreferences.find(item => !item.event_type && item.channel === 'in_app')
  const muteUntilValue = globalInAppPreference?.quiet_hours_json?.mute_until
  const muteUntil = muteUntilValue ? new Date(muteUntilValue) : null
  const notificationsDisabled = globalInAppPreference?.enabled === false || globalInAppPreference?.frequency === 'never'
  const notificationsMuted = !!muteUntil && muteUntil.getTime() > Date.now()

  const navigateMobile = (moduleId: ModuleId) => {
    onModuleNavigation(moduleId)
    setMobileMenuOpen(false)
  }

  const loadNotifications = async () => {
    const token = localStorage.getItem('qa_access_token')
    if (!token) return
    setNotificationsLoading(true)
    try {
      const response = await fetch(`${API_BASE}/notifications/inbox/?limit=10`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!response.ok) return
      setNotifications(await response.json())
    } catch {
    } finally {
      setNotificationsLoading(false)
    }
  }

  const loadNotificationPreferences = async () => {
    const token = localStorage.getItem('qa_access_token')
    if (!token) return
    try {
      const response = await fetch(`${API_BASE}/users/me/notification-preferences/`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!response.ok) return
      setNotificationPreferences(await response.json())
    } catch {
    }
  }

  const saveNotificationMute = async (hours: number | null) => {
    const token = localStorage.getItem('qa_access_token')
    if (!token) return
    const otherPreferences = notificationPreferences.filter(item => !(item.event_type === null && item.channel === 'in_app'))
    const muteUntilIso = hours ? new Date(Date.now() + hours * 60 * 60 * 1000).toISOString() : null
    const nextPreference = {
      event_type: null,
      channel: 'in_app',
      enabled: true,
      frequency: 'immediate',
      quiet_hours_json: muteUntilIso ? { mute_until: muteUntilIso } : {},
    }
    try {
      const response = await fetch(`${API_BASE}/users/me/notification-preferences/`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([...otherPreferences.map(({ event_type, channel, enabled, frequency, quiet_hours_json }: any) => ({
          event_type,
          channel,
          enabled,
          frequency,
          quiet_hours_json,
        })), nextPreference])
      })
      if (response.ok) {
        setNotificationPreferences(await response.json())
      }
    } catch {
    }
  }

  const setNotificationsDisabled = async (disabled: boolean) => {
    const token = localStorage.getItem('qa_access_token')
    if (!token) return
    const otherPreferences = notificationPreferences.filter(item => !(item.event_type === null && item.channel === 'in_app'))
    const nextPreference = {
      event_type: null,
      channel: 'in_app',
      enabled: !disabled,
      frequency: disabled ? 'never' : 'immediate',
      quiet_hours_json: {},
    }
    try {
      const response = await fetch(`${API_BASE}/users/me/notification-preferences/`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([...otherPreferences.map(({ event_type, channel, enabled, frequency, quiet_hours_json }: any) => ({
          event_type,
          channel,
          enabled,
          frequency,
          quiet_hours_json,
        })), nextPreference])
      })
      if (response.ok) {
        setNotificationPreferences(await response.json())
      }
    } catch {
    }
  }

  const markNotificationRead = async (notification: any) => {
    const token = localStorage.getItem('qa_access_token')
    if (!token || notification?.read_at) return
    try {
      const response = await fetch(`${API_BASE}/notifications/inbox/${notification.id}/read/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (response.ok) {
        await loadNotifications()
      }
    } catch {
    }
  }

  const markAllNotificationsRead = async () => {
    const token = localStorage.getItem('qa_access_token')
    if (!token) return
    try {
      const response = await fetch(`${API_BASE}/notifications/inbox/read-all/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (response.ok) {
        await loadNotifications()
      }
    } catch {
    }
  }

  useEffect(() => {
    void loadNotifications()
    void loadNotificationPreferences()
    const timer = window.setInterval(() => { void loadNotifications() }, 60000)
    return () => window.clearInterval(timer)
  }, [loggedUser.id, loggedUser.email])

  const unreadNotifications = notifications.filter(item => !item.read_at).length

  return (
    <div className="app-shell vh-100 d-flex bg-light text-dark overflow-hidden font-sans">
      <div className="app-mobile-topbar bg-dark text-white border-bottom border-secondary">
        <Button
          variant="dark"
          className="app-mobile-menu-button border border-secondary shadow-none"
          onClick={() => setMobileMenuOpen(true)}
          aria-label="Abrir menu"
        >
          <Menu size={20} />
        </Button>
        <span className="app-brand-mark app-brand-mark-sm flex-shrink-0" aria-hidden="true">
          <img src={brandLogoUrl} alt="" className="app-brand-icon" onError={(event) => { event.currentTarget.src = DEFAULT_BRANDING.effective_logo_url }} />
        </span>
        <div className="min-w-0">
          <div className="fw-bold text-white lh-sm text-truncate">{brandName}</div>
          <div className="app-edition-text text-truncate">{editionLabel}</div>
          <div className="x-small text-white-50 text-truncate">
            {currentProject?.name || 'Sin Proyecto'} {currentBuild?.name ? `- ${currentBuild.name}` : ''}
          </div>
        </div>
      </div>

      {mobileMenuOpen && <button type="button" className="app-mobile-scrim" aria-label="Cerrar menu" onClick={() => setMobileMenuOpen(false)} />}
      <div className={`app-mobile-drawer bg-dark text-white ${mobileMenuOpen ? 'is-open' : ''}`}>
        <div className="d-flex align-items-center justify-content-between p-3 border-bottom border-secondary">
          <div className="d-flex align-items-center gap-2 min-w-0">
            <span className="app-brand-mark app-brand-mark-sm flex-shrink-0" aria-hidden="true">
              <img src={brandLogoUrl} alt="" className="app-brand-icon" onError={(event) => { event.currentTarget.src = DEFAULT_BRANDING.effective_logo_url }} />
            </span>
            <div className="min-w-0">
              <div className="fw-bold text-white text-truncate">{brandName}</div>
              <div className="app-edition-text text-truncate">{editionLabel}</div>
            </div>
          </div>
          <Button variant="dark" size="sm" className="border border-secondary shadow-none" onClick={() => setMobileMenuOpen(false)} aria-label="Cerrar menu">
            <X size={18} />
          </Button>
        </div>

        <div className="p-3 border-bottom border-secondary">
          <div className="x-small text-secondary fw-bold text-uppercase mb-2">Contexto</div>
          <Dropdown className="mb-2">
            <Dropdown.Toggle variant="dark" className="w-100 border border-secondary d-flex justify-content-between align-items-center shadow-none">
              <span className="text-truncate">{currentOrg?.name || 'Seleccione cliente'}</span>
            </Dropdown.Toggle>
            <Dropdown.Menu className="w-100">
              {activeOrganizations.map(org => (
                <Dropdown.Item key={org.id} active={org.id === currentOrgId} onClick={() => onOrgChange(org.id)}>
                  {org.name}
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown>
          <Dropdown className="mb-2">
            <Dropdown.Toggle variant="dark" className="w-100 border border-secondary d-flex justify-content-between align-items-center shadow-none">
              <span className="text-truncate">{currentProject?.name || 'Sin Proyecto'}</span>
            </Dropdown.Toggle>
            <Dropdown.Menu className="w-100">
              {orgProjects.map(project => (
                <Dropdown.Item key={project.id} active={project.id === currentProjectId} onClick={() => onProjectChange(project.id)}>
                  {project.name}
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown>
          <Dropdown>
            <Dropdown.Toggle variant="dark" className="w-100 border border-secondary d-flex justify-content-between align-items-center shadow-none">
              <span className="text-truncate">{currentBuild?.name || 'Sin Build'}</span>
            </Dropdown.Toggle>
            <Dropdown.Menu className="w-100">
              {sortBuildsNewestFirst(visibleBuilds).map(build => (
                <Dropdown.Item key={build.id} active={build.id === currentBuildId} onClick={() => onBuildChange(build)}>
                  {build.name}
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown>
        </div>

        <Nav className="flex-column gap-1 p-3 app-mobile-drawer-nav">
          {sidebarItems.map(item => {
            const Icon = item.icon
            return (
              <Button
                key={item.id}
                variant={activeTab === item.id ? 'primary' : 'dark'}
                onClick={() => navigateMobile(item.id)}
                className="border-0 d-flex align-items-center text-start gap-3 p-2 shadow-none"
              >
                <Icon size={18} />
                <span className="small fw-medium text-white">{item.label}</span>
              </Button>
            )
          })}
        </Nav>

        <div className="mt-auto p-3 border-top border-secondary d-flex align-items-center gap-3">
          <div className="app-user-avatar rounded-circle bg-primary text-white d-flex justify-content-center align-items-center fw-bold flex-shrink-0 overflow-hidden position-relative" style={{ width: '38px', height: '38px' }}>
            <span>{loggedUser.avatar}</span>
            {loggedUser.avatarUrl ? (
              <img src={loggedUser.avatarUrl} alt={loggedUser.name} width={38} height={38} className="object-fit-cover position-absolute top-0 start-0" onError={(event) => { event.currentTarget.style.display = 'none' }} />
            ) : null}
          </div>
          <div className="min-w-0 flex-grow-1">
            <div className="text-white fw-bold small text-truncate">{loggedUser.name}</div>
            <div className="text-secondary x-small text-truncate">{loggedUser.roleLabel || loggedUser.role}</div>
          </div>
          <Button variant="link" className="text-secondary p-1 shadow-none" title="Cerrar sesión" onClick={onLogout}>
            <LogOut size={16} />
          </Button>
        </div>
      </div>

      <aside className="app-shell-sidebar bg-dark text-white d-flex flex-column shadow-lg transition-all" style={{ width: sidebarCollapsed ? '72px' : '260px', minWidth: sidebarCollapsed ? '72px' : '260px' }}>
        <div className={`border-bottom border-secondary d-flex align-items-center ${sidebarCollapsed ? 'justify-content-center p-3' : 'gap-2 p-4'}`}>
          <span className="app-brand-mark flex-shrink-0" aria-hidden="true">
            <img src={brandLogoUrl} alt="" className="app-brand-icon" onError={(event) => { event.currentTarget.src = DEFAULT_BRANDING.effective_logo_url }} />
          </span>
          {!sidebarCollapsed && (
            <div className="min-w-0">
              <div className="fw-bold fs-5 tracking-tight text-white lh-sm text-truncate">{brandName}</div>
              <div className="app-edition-text text-truncate">{editionLabel}</div>
            </div>
          )}
        </div>

        <div className="px-3 pt-3">
          <Button
            variant="dark"
            className="w-100 border border-secondary d-flex align-items-center justify-content-center shadow-none"
            title={sidebarCollapsed ? 'Expandir menú' : 'Contraer menú'}
            onClick={() => setSidebarCollapsed(prev => !prev)}
          >
            {sidebarCollapsed ? <ChevronRight size={18} /> : <ArrowLeft size={18} />}
          </Button>
        </div>

        <Nav className={`app-shell-nav flex-column ${sidebarCollapsed ? 'p-2' : 'p-3'} gap-1 flex-grow-1 overflow-auto`}>
          {sidebarItems.map(item => {
            const Icon = item.icon
            return (
              <Button
                key={item.id}
                variant={activeTab === item.id ? 'primary' : 'dark'}
                onClick={() => onModuleNavigation(item.id)}
                title={item.label}
                className={`border-0 d-flex align-items-center mb-1 p-2 shadow-none ${sidebarCollapsed ? 'justify-content-center' : 'text-start gap-3'}`}
              >
                <Icon size={18} /> {!sidebarCollapsed && <span className="small fw-medium text-white">{item.label}</span>}
              </Button>
            )
          })}
        </Nav>

        {!sidebarCollapsed && (
          <div className="p-2 bg-black bg-opacity-25 border-top border-secondary small text-white">
            <Dropdown className="w-100" align="end">
              <Dropdown.Toggle variant="transparent" className="border-0 text-white w-100 text-start d-flex align-items-center justify-content-between p-2 shadow-none small">
                <div className="d-flex align-items-center gap-2 text-truncate">
                  <Building2 size={16} className="text-primary" />
                  <span className="fw-bold text-truncate text-white small">
                    {currentOrg?.name || 'Seleccione cliente'}
                  </span>
                </div>
              </Dropdown.Toggle>
              <Dropdown.Menu className="sidebar-org-menu bg-dark border-secondary shadow-lg w-100 py-1" style={{ minWidth: '240px' }}>
                <div className="px-3 py-1 text-muted x-small uppercase fw-bold border-bottom border-secondary mb-1">CLIENTES / EMPRESAS</div>
                {activeOrganizations.map(org => (
                  <Dropdown.Item
                    key={org.id}
                    onClick={() => onOrgChange(org.id)}
                    active={org.id === currentOrgId}
                    className={`sidebar-org-item text-white small py-2 d-flex align-items-center gap-2 ${org.id === currentOrgId ? 'bg-primary' : ''}`}
                  >
                    <Building2 size={14} />
                    <span>{org.name}</span>
                  </Dropdown.Item>
                ))}
                {activeOrganizations.length === 0 && (
                  <div className="px-3 py-2 text-muted x-small">Sin clientes disponibles.</div>
                )}
              </Dropdown.Menu>
            </Dropdown>
          </div>
        )}

        <div className={`border-top border-secondary d-flex align-items-center ${sidebarCollapsed ? 'justify-content-center p-2' : 'gap-3 p-3'}`}>
          <div className="app-user-avatar rounded-circle bg-primary text-white d-flex justify-content-center align-items-center fw-bold flex-shrink-0 shadow-sm overflow-hidden position-relative" style={{ width: '38px', height: '38px' }}>
            <span>{loggedUser.avatar}</span>
            {loggedUser.avatarUrl ? (
              <img src={loggedUser.avatarUrl} alt={loggedUser.name} width={38} height={38} className="object-fit-cover position-absolute top-0 start-0" onError={(event) => { event.currentTarget.style.display = 'none' }} />
            ) : null}
          </div>
          {!sidebarCollapsed && (
            <div className="overflow-hidden flex-grow-1">
              <div className="text-white fw-bold small text-truncate m-0 lh-1 mb-1">{loggedUser.name}</div>
              <div className="text-secondary fw-semibold x-small text-truncate m-0 lh-1">{loggedUser.roleLabel || loggedUser.role}</div>
            </div>
          )}
          {!sidebarCollapsed && (
            <Button variant="link" className="text-secondary p-1 shadow-none" title="Cerrar sesión" onClick={onLogout}>
              <LogOut size={16} />
            </Button>
          )}
        </div>
      </aside>

      <div className="app-shell-body flex-grow-1 d-flex flex-column overflow-hidden">
        <header className="app-shell-header bg-white border-bottom p-3 d-flex justify-content-between align-items-center shadow-sm z-1 text-dark">
          <div className="app-shell-context d-flex align-items-center gap-2 text-dark">
            <div className="d-flex align-items-center small text-muted">
              <Building2 size={14} className="text-muted me-1" />
              <span>{currentOrg?.name}</span>
              <span className="mx-2 text-muted opacity-50">/</span>
              <Folders size={14} className="text-primary me-1" />
              <span className="text-dark fw-bold">{currentProject?.name || 'Sin Proyecto'}</span>
            </div>

            <Dropdown className="ms-3">
              <Dropdown.Toggle
                variant="light"
                size="sm"
                disabled={!currentProject || projectComponents.length === 0}
                className="border d-flex align-items-center gap-1 x-small fw-bold py-1 px-2 shadow-none text-dark bg-white"
              >
                <Layers size={12} className="text-secondary" />
                Componente: <span className="text-primary">{currentComponent?.name || 'Sin Componente'}</span>
              </Dropdown.Toggle>
              <Dropdown.Menu className="shadow-lg py-1 border text-start">
                <div className="px-3 py-1 text-muted x-small fw-bold border-bottom mb-1">COMPONENTES DEL PROYECTO</div>
                {projectComponents.map(component => (
                  <Dropdown.Item
                    key={component.id}
                    onClick={() => onComponentChange(component.id)}
                    active={component.id === currentCompId}
                    className="x-small py-1 d-flex align-items-center gap-2"
                  >
                    <Layers size={12} />
                    {component.name}
                  </Dropdown.Item>
                ))}
                {projectComponents.length === 0 && (
                  <div className="px-3 py-2 text-muted x-small">Sin componentes. Créalos en Proyectos.</div>
                )}
              </Dropdown.Menu>
            </Dropdown>
          </div>

          <div className="app-shell-actions d-flex align-items-center gap-2">
            <Dropdown>
              <Dropdown.Toggle variant="light" size="sm" className="border d-flex align-items-center gap-1 small fw-bold py-1 px-3 rounded-pill shadow-sm text-dark bg-white shadow-none">
                <Folders size={14} className="text-primary" />
                Proyecto: <span className="text-dark">{currentProject?.name || 'Ninguno'}</span>
              </Dropdown.Toggle>
              <Dropdown.Menu className="shadow-lg py-1 border text-start" align="end" style={{ minWidth: '220px' }}>
                <div className="px-3 py-1 text-muted x-small fw-bold border-bottom mb-1">CAMBIAR DE PROYECTO</div>
                {orgProjects.map(project => (
                  <Dropdown.Item
                    key={project.id}
                    onClick={() => onProjectChange(project.id)}
                    active={project.id === currentProjectId}
                    className="small py-2 d-flex align-items-center gap-2"
                  >
                    <Folders size={12} />
                    {project.name}
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown>

            <Dropdown>
              <Dropdown.Toggle variant="light" size="sm" className="border d-flex align-items-center gap-1 small fw-bold py-1 px-3 rounded-pill shadow-sm text-dark bg-white shadow-none">
                <PlayCircle size={14} className="text-warning" />
                Build: <span className="text-primary">{currentBuild?.name || 'Sin Build'}</span>
              </Dropdown.Toggle>
              <Dropdown.Menu className="shadow-lg py-1 border text-start" align="end" style={{ minWidth: '200px' }}>
                <div className="px-3 py-1 text-muted x-small fw-bold border-bottom mb-1">BUILD EN EJECUCIÓN (TESTLINK)</div>
                {sortBuildsNewestFirst(visibleBuilds).map(build => (
                  <Dropdown.Item
                    key={build.id}
                    onClick={() => onBuildChange(build)}
                    active={build.id === currentBuildId}
                    className={`small py-2 d-flex align-items-center gap-2 ${!build.active ? 'text-muted' : ''}`}
                  >
                    <Check size={12} className={build.id === currentBuildId ? 'text-primary' : 'text-transparent'} />
                    {build.name}
                    {!build.active && <Badge bg="light" text="secondary" className="ms-auto border">Inactiva</Badge>}
                  </Dropdown.Item>
                ))}
                {visibleBuilds.length === 0 && (
                  <div className="px-3 py-2 text-muted x-small">Sin builds visibles para este componente.</div>
                )}
              </Dropdown.Menu>
            </Dropdown>

            <Dropdown onToggle={(isOpen) => { if (isOpen) { void loadNotifications(); void loadNotificationPreferences() } }}>
                <Dropdown.Toggle
                  variant="link"
                  size="sm"
                  className="p-0 border-0 shadow-none position-relative d-inline-flex align-items-center text-decoration-none"
                  title="Notificaciones"
                >
                  {notificationsMuted || notificationsDisabled ? (
                    <BellOff size={18} className="text-muted cursor-pointer ms-1 hover-text-primary transition-all" />
                  ) : (
                    <Bell size={18} className={unreadNotifications ? 'text-primary cursor-pointer ms-1 transition-all' : 'text-muted cursor-pointer ms-1 hover-text-primary transition-all'} />
                  )}
                  {unreadNotifications > 0 && !notificationsMuted && !notificationsDisabled && (
                    <Badge bg="danger" pill className="position-absolute top-0 start-100 translate-middle x-small">
                      {unreadNotifications > 9 ? '9+' : unreadNotifications}
                    </Badge>
                  )}
                </Dropdown.Toggle>
                <Dropdown.Menu className="shadow-lg border text-start p-0" align="end" style={{ minWidth: '360px', maxWidth: '420px' }}>
                  <div className="px-3 py-2 border-bottom d-flex justify-content-between align-items-center">
                    <div>
                      <div className="fw-bold small">Notificaciones</div>
                      <div className="x-small text-muted">
                        {notificationsDisabled
                          ? 'Desactivadas'
                          : notificationsMuted && muteUntil
                            ? `Silenciadas hasta ${muteUntil.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                            : `${unreadNotifications} sin leer`}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="link"
                      className="p-0 text-decoration-none"
                      disabled={!unreadNotifications}
                      onClick={markAllNotificationsRead}
                    >
                      Marcar leidas
                    </Button>
                  </div>
                  <div className="px-3 py-2 border-bottom bg-light">
                    <div className="x-small fw-bold text-muted text-uppercase mb-2">Silenciar nuevas notificaciones</div>
                    <div className="d-flex flex-wrap gap-2">
                      <Button size="sm" variant="outline-secondary" disabled={notificationsDisabled} onClick={() => saveNotificationMute(1)}>1 h</Button>
                      <Button size="sm" variant="outline-secondary" disabled={notificationsDisabled} onClick={() => saveNotificationMute(8)}>8 h</Button>
                      <Button size="sm" variant="outline-secondary" disabled={notificationsDisabled} onClick={() => saveNotificationMute(24)}>24 h</Button>
                      <Button size="sm" variant={notificationsDisabled ? 'primary' : 'outline-danger'} onClick={() => setNotificationsDisabled(!notificationsDisabled)}>
                        {notificationsDisabled ? 'Activar' : 'Desactivar'}
                      </Button>
                    </div>
                    {notificationsDisabled && (
                      <div className="x-small text-muted mt-2">No se enviaran nuevas notificaciones internas hasta volver a activar.</div>
                    )}
                  </div>
                  <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
                    {notificationsLoading && (
                      <div className="px-3 py-3 small text-muted">Cargando notificaciones...</div>
                    )}
                    {!notificationsLoading && notifications.length === 0 && (
                      <div className="px-3 py-3 small text-muted">No tenes notificaciones internas.</div>
                    )}
                    {!notificationsLoading && notifications.map(notification => (
                      <button
                        key={notification.id}
                        type="button"
                        className={`btn btn-link w-100 text-start text-decoration-none border-bottom rounded-0 px-3 py-2 ${notification.read_at ? 'bg-white text-muted' : 'bg-light text-dark'}`}
                        onClick={() => markNotificationRead(notification)}
                      >
                        <div className="d-flex justify-content-between gap-2">
                          <span className="fw-semibold text-truncate">{notification.title}</span>
                          {!notification.read_at && <Badge bg="primary">Nueva</Badge>}
                        </div>
                        <div className="small text-muted text-wrap">{notification.message}</div>
                      </button>
                    ))}
                  </div>
                </Dropdown.Menu>
            </Dropdown>
          </div>
        </header>

        <main className="app-content flex-grow-1 overflow-auto bg-white text-dark">
          {children}
        </main>
        <footer className="app-shell-footer bg-dark border-top border-secondary d-flex align-items-center justify-content-center px-3 py-1" style={{ minHeight: '32px' }}>
          <span className="x-small text-white-50">
            <a href="https://treseko.com/terminos-y-condiciones" className="text-white-50 text-decoration-none hover-text-primary transition-all">T&eacute;rminos y Condiciones</a>
          </span>
        </footer>
      </div>
    </div>
  )
}
