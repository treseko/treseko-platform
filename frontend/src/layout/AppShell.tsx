import { useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeft,
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
import { useI18n } from '../i18n'
import { isBuildReadOnly } from '../app/buildState'
import { useAppNotifications } from './useAppNotifications'
import { NotificationInbox } from './NotificationInbox'

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
  const { t, locale } = useI18n()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const activeOrganizations = organizations.filter(org => org.active !== false)
  const currentOrg = activeOrganizations.find(org => org.id === currentOrgId)
  const currentProject = projectsList.find(project => project.id === currentProjectId)
  const currentComponent = componentsList.find(component => component.id === currentCompId)
  const currentBuild = buildsList.find(build => build.id === currentBuildId)
  const currentBuildReadOnly = isBuildReadOnly(currentBuild)
  const projectComponents = componentsList.filter(component => component.projectId === currentProjectId)
  const currentOrgIsActive = activeOrganizations.some(org => org.id === currentOrgId)
  const orgProjects = currentOrgIsActive ? projectsList.filter(project => project.orgId === currentOrgId) : []
  const visibleBuilds = buildsList.filter(build => build.projectId === currentProjectId && build.componentId === currentCompId && !build.hidden)
  const editionLabel = systemEdition === 'premium' ? 'Premium' : 'Community'
  const brandName = branding.effective_brand_name || DEFAULT_BRANDING.effective_brand_name
  const brandLogoUrl = resolveAssetUrl(branding.effective_logo_url) || DEFAULT_BRANDING.effective_logo_url
  const notificationState = useAppNotifications({ loggedUserId: loggedUser.id, loggedUserEmail: loggedUser.email, locale, t })

  const navigateMobile = (moduleId: ModuleId) => {
    onModuleNavigation(moduleId)
    setMobileMenuOpen(false)
  }

  return (
    <div className="app-shell vh-100 d-flex bg-light text-dark overflow-hidden font-sans">
      <div className="app-mobile-topbar bg-dark text-white border-bottom border-secondary">
        <Button
          variant="dark"
          className="app-mobile-menu-button border border-secondary shadow-none"
          onClick={() => setMobileMenuOpen(true)}
          aria-label={t('common.openMenu')}
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
          {currentProject?.name || t('common.noProject')} {currentBuild?.name ? `- ${currentBuild.name}` : ''}
          </div>
        </div>
      </div>

      {mobileMenuOpen && <button type="button" className="app-mobile-scrim" aria-label={t('common.closeMenu')} onClick={() => setMobileMenuOpen(false)} />}
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
          <Button variant="dark" size="sm" className="border border-secondary shadow-none" onClick={() => setMobileMenuOpen(false)} aria-label={t('common.closeMenu')}>
            <X size={18} />
          </Button>
        </div>

        <div className="p-3 border-bottom border-secondary">
          <div className="x-small text-secondary fw-bold text-uppercase mb-2">{t('common.context')}</div>
          <Dropdown className="mb-2">
            <Dropdown.Toggle variant="dark" className="w-100 border border-secondary d-flex justify-content-between align-items-center shadow-none">
              <span className="text-truncate">{currentOrg?.name || t('common.selectClient')}</span>
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
              <span className="text-truncate">{currentProject?.name || t('common.noProject')}</span>
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
              <span className="text-truncate">{currentBuild?.name || t('common.noBuild')}</span>
              {currentBuildReadOnly && <Badge bg="warning" text="dark" className="ms-1">{t('common.readOnly')}</Badge>}
            </Dropdown.Toggle>
            <Dropdown.Menu className="w-100">
              {sortBuildsNewestFirst(visibleBuilds).map(build => (
                <Dropdown.Item key={build.id} active={build.id === currentBuildId} onClick={() => onBuildChange(build)}>
                  {build.name}
                  {isBuildReadOnly(build) && <Badge bg="warning" text="dark" className="ms-2">{t('common.readOnly')}</Badge>}
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
                <span className="small fw-medium text-white">{t(`navigation.${item.id}`)}</span>
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
          <Button variant="link" className="text-secondary p-1 shadow-none" title={t('auth.logout')} aria-label={t('auth.logout')} onClick={onLogout}>
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
            title={sidebarCollapsed ? t('common.expandMenu') : t('common.collapseMenu')}
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
                title={t(`navigation.${item.id}`)}
                className={`border-0 d-flex align-items-center mb-1 p-2 shadow-none ${sidebarCollapsed ? 'justify-content-center' : 'text-start gap-3'}`}
              >
                <Icon size={18} /> {!sidebarCollapsed && <span className="small fw-medium text-white">{t(`navigation.${item.id}`)}</span>}
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
                    {currentOrg?.name || t('common.selectClient')}
                  </span>
                </div>
              </Dropdown.Toggle>
              <Dropdown.Menu className="sidebar-org-menu bg-dark border-secondary shadow-lg w-100 py-1" style={{ minWidth: '240px' }}>
                <div className="px-3 py-1 text-muted x-small uppercase fw-bold border-bottom border-secondary mb-1">{t('common.clientsCompanies')}</div>
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
                  <div className="px-3 py-2 text-muted x-small">{t('common.noClientsAvailable')}</div>
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
            <Button variant="link" className="text-secondary p-1 shadow-none" title={t('auth.logout')} aria-label={t('auth.logout')} onClick={onLogout}>
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
              <span className="text-dark fw-bold text-truncate" title={currentProject?.name || t('common.noProject')}>{currentProject?.name || t('common.noProject')}</span>
            </div>

            <Dropdown className="ms-3">
              <Dropdown.Toggle
                variant="light"
                size="sm"
                disabled={!currentProject || projectComponents.length === 0}
                className="border d-flex align-items-center gap-1 x-small fw-bold py-1 px-2 shadow-none text-dark bg-white"
              >
                <Layers size={12} className="text-secondary" />
                {t('common.component')}: <span className="text-primary">{currentComponent?.name || t('common.noComponent')}</span>
              </Dropdown.Toggle>
              <Dropdown.Menu className="shadow-lg py-1 border text-start">
                <div className="px-3 py-1 text-muted x-small fw-bold border-bottom mb-1">{t('common.projectComponents')}</div>
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
                  <div className="px-3 py-2 text-muted x-small">{t('common.noComponentsCreateInProjects')}</div>
                )}
              </Dropdown.Menu>
            </Dropdown>
          </div>

          <div className="app-shell-actions d-flex align-items-center gap-2">
            <Dropdown>
          <Dropdown.Toggle variant="light" size="sm" className="app-shell-project-toggle border d-flex align-items-center gap-1 small fw-bold py-1 px-3 rounded-pill shadow-sm text-dark bg-white shadow-none" title={currentProject?.name || t('common.none')}>
                <Folders size={14} className="text-primary" />
                {t('navigation.projects')}: <span className="text-dark text-truncate">{currentProject?.name || t('common.none')}</span>
              </Dropdown.Toggle>
              <Dropdown.Menu className="shadow-lg py-1 border text-start" align="end" style={{ minWidth: '220px' }}>
                <div className="px-3 py-1 text-muted x-small fw-bold border-bottom mb-1">{t('common.changeProject')}</div>
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
                {t('common.build')}: <span className="text-primary">{currentBuild?.name || t('common.noBuild')}</span>
                {currentBuildReadOnly && <Badge bg="warning" text="dark" className="ms-1">{t('common.readOnly')}</Badge>}
              </Dropdown.Toggle>
              <Dropdown.Menu className="shadow-lg py-1 border text-start" align="end" style={{ minWidth: '200px' }}>
                <div className="px-3 py-1 text-muted x-small fw-bold border-bottom mb-1">{t('common.buildInExecution')}</div>
                {sortBuildsNewestFirst(visibleBuilds).map(build => (
                  <Dropdown.Item
                    key={build.id}
                    onClick={() => onBuildChange(build)}
                    active={build.id === currentBuildId}
                    className={`small py-2 d-flex align-items-center gap-2 ${!build.active ? 'text-muted' : ''}`}
                  >
                    <Check size={12} className={build.id === currentBuildId ? 'text-primary' : 'text-transparent'} />
                    {build.name}
                    {!build.active && <Badge bg="light" text="secondary" className="ms-auto border">{t('common.inactive')}</Badge>}
                    {isBuildReadOnly(build) && <Badge bg="warning" text="dark" className="ms-auto">{t('common.readOnly')}</Badge>}
                  </Dropdown.Item>
                ))}
                {visibleBuilds.length === 0 && (
                  <div className="px-3 py-2 text-muted x-small">{t('common.noBuildsForComponent')}</div>
                )}
              </Dropdown.Menu>
            </Dropdown>

            <NotificationInbox state={notificationState} locale={locale} t={t} />
          </div>
        </header>

        <main className="app-content flex-grow-1 overflow-auto bg-white text-dark">
          {children}
        </main>
      </div>
    </div>
  )
}
