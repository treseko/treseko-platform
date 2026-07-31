import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { Alert, Badge, Button, Col, Form, Modal, Row } from 'react-bootstrap'
import { Search, Save, ShieldCheck, Trash2, Users } from 'lucide-react'
import { API_BASE } from '../../app/constants'
import { RBAC_CAPABILITIES } from '../../app/rbac/rbacCatalog'
import { RequiredLabel } from '../../shared/ui/RequiredLabel'
import type { CapabilityId, PermissionLevel, RoleKey } from '../../app/types'
import { useI18n } from '../../i18n'
import { RoleModal } from './RoleModal'

type AdminModalsProps = {
  showRoleModal: boolean
  setShowRoleModal: (show: boolean) => void
  editingRoleId: string | null
  roleForm: any
  setRoleForm: Dispatch<SetStateAction<any>>
  setRoleModulePermission: (moduleId: string, permission: PermissionLevel) => void
  setRoleCapabilityPermission: (capabilityId: CapabilityId, permission: PermissionLevel) => void
  handleSaveRole: (event: FormEvent) => void
  showUserModal: boolean
  setShowUserModal: (show: boolean) => void
  editingUserId: string | null
  userForm: any
  setUserForm: Dispatch<SetStateAction<any>>
  customRoles: any[]
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  handleUserCustomRoleChange: (roleId: string) => void
  handleUserRoleChange: (role: RoleKey) => void
  handleSaveUser: (event: FormEvent) => void
  showProjectMemberModal: boolean
  setShowProjectMemberModal: (show: boolean) => void
  projectMemberForm: any
  setProjectMemberForm: Dispatch<SetStateAction<any>>
  handleSubmitProjectMember: (event: FormEvent) => void
  projectsList: any[]
  managingProjectId: string
  assignableUsers: any[]
  projectMemberRemoval: any
  setProjectMemberRemoval: (value: any) => void
  confirmRemoveProjectMember: () => void
}

export function AdminModals({
  showRoleModal,
  setShowRoleModal,
  editingRoleId,
  roleForm,
  setRoleForm,
  setRoleModulePermission,
  setRoleCapabilityPermission,
  handleSaveRole,
  showUserModal,
  setShowUserModal,
  editingUserId,
  userForm,
  setUserForm,
  customRoles,
  fetchWithAuth,
  handleUserCustomRoleChange,
  handleUserRoleChange,
  handleSaveUser,
  showProjectMemberModal,
  setShowProjectMemberModal,
  projectMemberForm,
  setProjectMemberForm,
  handleSubmitProjectMember,
  projectsList,
  managingProjectId,
  assignableUsers,
  projectMemberRemoval,
  setProjectMemberRemoval,
  confirmRemoveProjectMember
}: AdminModalsProps) {
  const { t } = useI18n()
  const [projectMemberUserText, setProjectMemberUserText] = useState('')
  const [rolePermissionGroupKey, setRolePermissionGroupKey] = useState('')
  const [adLookupQuery, setAdLookupQuery] = useState('')
  const [adLookupLoading, setAdLookupLoading] = useState(false)
  const [adLookupMessage, setAdLookupMessage] = useState('')
  const [adLookupResults, setAdLookupResults] = useState<any[]>([])
  const activeAssignableUsers = useMemo(() => assignableUsers.filter(user => user.status !== 'Inactivo'), [assignableUsers])
  const getAssignableUserLabel = (user: any) => `${user.name || user.email || user.id} - ${user.email || t('configuracion.noEmail')}${user.role || user.baseRole ? ` (${user.role || user.baseRole})` : ''}`
  const getCapabilityLabel = (capability: { id: string; label: string }) => {
    const bugLabels: Record<string, string> = {
      'bugs.ver': 'configuracion.rbacBugsView', 'bugs.crear': 'configuracion.rbacBugsCreate', 'bugs.editar': 'configuracion.rbacBugsEdit',
      'bugs.triage': 'configuracion.rbacBugsTriage', 'bugs.asignar': 'configuracion.rbacBugsAssign', 'bugs.comentar': 'configuracion.rbacBugsComment',
      'bugs.adjuntos': 'configuracion.rbacBugsEvidence', 'bugs.vincular_externo': 'configuracion.rbacBugsExternal', 'bugs.exportar': 'configuracion.rbacBugsExport', 'bugs.admin': 'configuracion.rbacBugsAdmin',
    }
    const projectLabels: Record<string, string> = {
      'proyectos.portfolio': 'configuracion.rbacProjectsPortfolio', 'proyectos.componentes': 'configuracion.rbacProjectsComponents', 'proyectos.builds': 'configuracion.rbacProjectsBuilds', 'proyectos.build_scope': 'configuracion.rbacProjectsBuildScope', 'proyectos.equipo': 'configuracion.rbacProjectsTeam', 'proyectos.ambientes': 'configuracion.rbacProjectsEnvironments', 'proyectos.datasets': 'configuracion.rbacProjectsDatasets', 'proyectos.wiki': 'configuracion.rbacProjectsWiki',
    }
    if (projectLabels[capability.id]) return t(projectLabels[capability.id] as any)
    const automationLabels: Record<string, string> = {
      'automatizacion.workers': 'configuracion.rbacAutomationWorkers', 'automatizacion.jobs': 'configuracion.rbacAutomationJobs', 'automatizacion.funciones': 'configuracion.rbacAutomationFunctions', 'automatizacion.validacion_scripts': 'configuracion.rbacAutomationScripts',
    }
    if (automationLabels[capability.id]) return t(automationLabels[capability.id] as any)
    const executionLabels: Record<string, string> = {
      'ejecutar.ver': 'configuracion.rbacExecutionView', 'ejecutar.manual': 'configuracion.rbacExecutionManual', 'ejecutar.automatizada': 'configuracion.rbacExecutionAutomated', 'ejecutar.ia': 'configuracion.rbacExecutionAi', 'ejecutar.evidencias': 'configuracion.rbacExecutionEvidence', 'ejecutar.historial_build': 'configuracion.rbacExecutionHistory',
      'crear_pruebas.suites': 'configuracion.rbacCasesSuites', 'crear_pruebas.casos': 'configuracion.rbacCasesCases', 'crear_pruebas.pasos': 'configuracion.rbacCasesSteps', 'crear_pruebas.versiones': 'configuracion.rbacCasesVersions', 'crear_pruebas.adjuntos': 'configuracion.rbacCasesAttachments', 'crear_pruebas.scripts': 'configuracion.rbacCasesScripts',
    }
    if (executionLabels[capability.id]) return t(executionLabels[capability.id] as any)
    const inventoryReportLabels: Record<string, string> = {
      'inventario.ambientes': 'configuracion.rbacInventoryEnvironments', 'inventario.dispositivos': 'configuracion.rbacInventoryDevices', 'inventario.nodos': 'configuracion.rbacInventoryNodes', 'inventario.categorias': 'configuracion.rbacInventoryCategories',
      'reportes.ver': 'configuracion.rbacReportsView', 'reportes.exportar': 'configuracion.rbacReportsExport', 'reportes.compartir': 'configuracion.rbacReportsShare', 'reportes.configurar': 'configuracion.rbacReportsConfigure',
    }
    if (inventoryReportLabels[capability.id]) return t(inventoryReportLabels[capability.id] as any)
    const integrationLabels: Record<string, string> = {
      'redmine.ver': 'configuracion.rbacRedmineView', 'redmine.configuracion': 'configuracion.rbacRedmineConfigure', 'redmine.reportar': 'configuracion.rbacRedmineReport', 'redmine.vinculos': 'configuracion.rbacRedmineLinks',
      'integraciones.catalogo': 'configuracion.rbacIntegrationsCatalog', 'integraciones.ver_estado': 'configuracion.rbacIntegrationsStatus', 'integraciones.test_conexion': 'configuracion.rbacIntegrationsTest', 'integraciones.configurar': 'configuracion.rbacIntegrationsConfigure', 'integraciones.secretos': 'configuracion.rbacIntegrationsSecrets', 'integraciones.webhooks': 'configuracion.rbacIntegrationsWebhooks', 'integraciones.auditoria': 'configuracion.rbacIntegrationsAudit',
    }
    if (integrationLabels[capability.id]) return t(integrationLabels[capability.id] as any)
    const remainingLabels: Record<string, string> = {
      'plugins.catalogo': 'configuracion.rbacPluginsCatalog', 'plugins.instalar': 'configuracion.rbacPluginsInstall', 'plugins.desinstalar': 'configuracion.rbacPluginsUninstall', 'plugins.habilitar': 'configuracion.rbacPluginsEnable', 'plugins.configurar': 'configuracion.rbacPluginsConfigure', 'plugins.gestionar_secretos': 'configuracion.rbacPluginsSecrets', 'plugins.auditoria': 'configuracion.rbacPluginsAudit',
      'historial.ver': 'configuracion.rbacHistoryView', 'historial.detalle': 'configuracion.rbacHistoryDetail', 'historial.evidencias': 'configuracion.rbacHistoryEvidence',
      'notificaciones.ver': 'configuracion.rbacNotificationsView', 'notificaciones.inbox': 'configuracion.rbacNotificationsInbox', 'notificaciones.configuracion': 'configuracion.rbacNotificationsConfigure', 'notificaciones.reglas': 'configuracion.rbacNotificationsRules', 'notificaciones.plantillas': 'configuracion.rbacNotificationsTemplates', 'notificaciones.auditoria': 'configuracion.rbacNotificationsAudit', 'notificaciones.admin': 'configuracion.rbacNotificationsAdmin',
    }
    if (remainingLabels[capability.id]) return t(remainingLabels[capability.id] as any)
    const aiLabels: Record<string, string> = {
      'motor_ia.ver': 'configuracion.rbacAiView', 'motor_ia.configuracion': 'configuracion.rbacAiConfigure', 'motor_ia.workflows': 'configuracion.rbacAiWorkflows', 'motor_ia.logs': 'configuracion.rbacAiLogs', 'motor_ia.scheduler': 'configuracion.rbacAiScheduler',
    }
    if (aiLabels[capability.id]) return t(aiLabels[capability.id] as any)
    const baseLabels: Record<string, string> = {
      'dashboard.ver': 'configuracion.rbacDashboardView', 'dashboard.personalizar': 'configuracion.rbacDashboardCustomize', 'configuracion.preferencias': 'configuracion.rbacConfigPreferences', 'configuracion.perfil': 'configuracion.rbacConfigProfile', 'configuracion.clientes': 'configuracion.rbacConfigClients', 'configuracion.usuarios': 'configuracion.rbacConfigUsers', 'configuracion.roles': 'configuracion.rbacConfigRoles', 'configuracion.integraciones': 'configuracion.rbacConfigIntegrations', 'configuracion.pruebas_ia': 'configuracion.rbacConfigAiTests', 'configuracion.monitor': 'configuracion.rbacConfigMonitor', 'configuracion.api_keys': 'configuracion.rbacConfigApiKeys', 'configuracion.sesion': 'configuracion.rbacConfigSession', 'configuracion.adjuntos': 'configuracion.rbacConfigAttachments', 'configuracion.licencia': 'configuracion.rbacConfigLicense',
    }
    if (baseLabels[capability.id]) return t(baseLabels[capability.id] as any)
    const providerLabels: Record<string, string> = {
      'plugins.provider.ai_case_generator.generar_casos': 'configuracion.rbacProviderGenerateCases', 'plugins.provider.case_portability.importar_casos': 'configuracion.rbacProviderPortableCases',
    }
    if (providerLabels[capability.id]) return t(providerLabels[capability.id] as any)
    return bugLabels[capability.id] ? t(bugLabels[capability.id] as any) : capability.label
  }
  const rolePermissionGroups = useMemo(
    () => RBAC_CAPABILITIES.map((group, index) => ({ ...group, groupKey: `${group.module}:${index}` })),
    []
  )
  const selectedRolePermissionGroup = rolePermissionGroups.find(group => group.groupKey === rolePermissionGroupKey) || rolePermissionGroups[0]

  useEffect(() => {
    if (!showProjectMemberModal) return
    setProjectMemberUserText('')
    setProjectMemberForm((current: any) => ({ ...current, userId: '' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showProjectMemberModal])

  useEffect(() => {
    if (!showRoleModal) return
    const firstWithAccess = rolePermissionGroups.find(group => (
      roleForm.permissions?.[group.module] ||
      group.capabilities.some(capability => roleForm.capabilities?.[capability.id] === 'read' || roleForm.capabilities?.[capability.id] === 'edit')
    ))
    setRolePermissionGroupKey((firstWithAccess || rolePermissionGroups[0])?.groupKey || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRoleModal, editingRoleId])

  useEffect(() => {
    if (!showUserModal) {
      setAdLookupQuery('')
      setAdLookupMessage('')
      setAdLookupResults([])
      setAdLookupLoading(false)
      return
    }
    setAdLookupQuery(userForm.email || '')
  }, [showUserModal, editingUserId])

  const applyAdLookupResult = (payload: any, queryFallback = '') => {
    setUserForm((current: any) => ({
      ...current,
      auth: 'AD',
      email: payload.email || current.email,
      name: payload.name || current.name,
      adLookupVerified: true,
      adLookupUsername: payload.username || '',
      adLookupGroups: payload.groups || [],
      saveError: '',
    }))
    setAdLookupQuery(payload.email || payload.username || queryFallback)
    setAdLookupResults([])
    setAdLookupMessage(t('configuracion.adSelected', { username: payload.username ? `: ${payload.username}` : '' }))
  }

  const lookupAdUser = async () => {
    const query = adLookupQuery.trim() || userForm.email.trim()
    if (!query) {
      setAdLookupMessage(t('configuracion.adLookupRequired'))
      return
    }
    setAdLookupLoading(true)
    setAdLookupMessage('')
    setAdLookupResults([])
    try {
      const response = await fetchWithAuth(`${API_BASE}/usuarios/ad/lookup/`, {
        method: 'POST',
        body: JSON.stringify({ query, limit: 8 }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.detail || t('configuracion.backendResponded', { status: response.status }))
      }
      const results = Array.isArray(payload?.results) ? payload.results : []
      if (payload?.found && payload.email) {
        applyAdLookupResult(payload, query)
        return
      }
      if (results.length > 0) {
        setUserForm((current: any) => ({ ...current, auth: 'AD', adLookupVerified: false }))
        setAdLookupResults(results)
        setAdLookupMessage(t('configuracion.adMatches', { count: results.length }))
        return
      }
      throw new Error(t('configuracion.adUserNotFound'))
    } catch (error: any) {
      setUserForm((current: any) => ({ ...current, adLookupVerified: false }))
      setAdLookupResults([])
      setAdLookupMessage(error?.message || t('configuracion.adLookupError'))
    } finally {
      setAdLookupLoading(false)
    }
  }

  return (
    <>
      <RoleModal options={{
        showRoleModal,
        setShowRoleModal,
        editingRoleId,
        roleForm,
        setRoleForm,
        setRoleModulePermission,
        setRoleCapabilityPermission,
        handleSaveRole,
        rolePermissionGroups,
        selectedRolePermissionGroup,
        setRolePermissionGroupKey,
        getCapabilityLabel,
      }} />

      <Modal show={showUserModal} onHide={() => setShowUserModal(false)} centered size="lg" backdrop="static">
        <Modal.Header closeButton className="bg-light border-bottom text-dark">
          <Modal.Title className="fw-bold fs-5 text-dark d-flex align-items-center gap-2">
            <Users size={20} className="text-primary" /> {editingUserId ? t('configuracion.editUser') : t('configuracion.newUser')}
          </Modal.Title>
        </Modal.Header>
        <Form onSubmit={handleSaveUser}>
          <Modal.Body className="p-4 text-start">
            {userForm.saveError && (
              <Alert variant="danger" className="small fw-semibold mb-3 py-2">
                {userForm.saveError}
              </Alert>
            )}
            <Row className="g-2">
              {userForm.auth === 'AD' && (
                <Col xs={12}>
                  <div className="p-3 rounded-3 border bg-light">
                    <Form.Label className="x-small fw-bold text-muted">{t('configuracion.searchAdUser')}</Form.Label>
                    <div className="d-flex gap-2">
                      <Form.Control
                        value={adLookupQuery}
                        onChange={(e) => {
                          setAdLookupQuery(e.target.value)
                          setAdLookupResults([])
                          setUserForm((current: any) => ({ ...current, adLookupVerified: false }))
                        }}
                        placeholder={t('configuracion.searchAdPlaceholder')}
                        className="bg-white shadow-sm"
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            lookupAdUser()
                          }
                        }}
                      />
                      <Button type="button" variant="outline-primary" className="fw-bold" onClick={lookupAdUser} disabled={adLookupLoading}>
                        <Search size={16} className="me-2" /> {adLookupLoading ? t('configuracion.searching') : t('configuracion.search')}
                      </Button>
                    </div>
                    {adLookupResults.length > 0 && (
                      <div className="mt-2 border rounded-3 overflow-hidden bg-white shadow-sm">
                        {adLookupResults.map((result, index) => (
                          <button
                            key={`${result.email || result.username || index}`}
                            type="button"
                            className="btn btn-link d-block w-100 text-start text-decoration-none text-dark border-bottom rounded-0 px-3 py-2"
                            onClick={() => applyAdLookupResult(result, adLookupQuery)}
                          >
                            <div className="fw-bold">{result.name || result.username || result.email}</div>
                            <div className="x-small text-muted">
                              {[result.email, result.username || result.upn].filter(Boolean).join(' · ')}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {adLookupMessage && (
                      <div className={`small mt-2 ${userForm.adLookupVerified ? 'text-success' : adLookupResults.length ? 'text-primary' : 'text-danger'}`}>{adLookupMessage}</div>
                    )}
                    {userForm.adLookupVerified && Array.isArray(userForm.adLookupGroups) && userForm.adLookupGroups.length > 0 && (
                      <div className="d-flex flex-wrap gap-1 mt-2">
                        {userForm.adLookupGroups.slice(0, 6).map((group: string) => (
                          <Badge key={group} bg="light" text="dark" className="border">{group}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </Col>
              )}
              <Col md={6}>
                <Form.Group>
                  <Form.Label className="x-small fw-bold text-muted">{t('configuracion.fullName')}</Form.Label>
                  <Form.Control value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value, saveError: '' })} className="bg-light shadow-sm" />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group>
                  <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>Email</RequiredLabel></Form.Label>
                  <Form.Control type="email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value, saveError: '' })} required className="bg-light shadow-sm" />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group>
                  <Form.Label className="x-small fw-bold text-muted">{t('configuracion.localPassword')}</Form.Label>
                  <Form.Control
                    type="password"
                    value={userForm.password}
                    onChange={(e) => setUserForm({ ...userForm, password: e.target.value, saveError: '' })}
                    disabled={userForm.auth === 'AD'}
                    className="bg-light shadow-sm"
                    placeholder={userForm.auth === 'AD' ? t('configuracion.adPasswordValidated') : editingUserId ? t('configuracion.passwordKeepExisting') : t('configuracion.initialPassword')}
                  />
                </Form.Group>
              </Col>
              {!editingUserId && <Col md={6} className="d-flex align-items-end">
                <Form.Check
                  type="switch"
                  id="send-welcome"
                  label={userForm.auth === 'AD' ? t('configuracion.sendCorporateAccessInstructions') : t('configuracion.sendWelcomePasswordLink')}
                  checked={!!userForm.sendWelcome}
                  onChange={(event) => setUserForm({ ...userForm, sendWelcome: event.target.checked, saveError: '' })}
                />
                <div className="x-small text-muted mt-1">{t('configuracion.passwordsNotEmailed')}</div>
              </Col>}
              <Col md={4}>
                <Form.Group>
                  <Form.Label className="x-small fw-bold text-muted">{t('configuracion.role')}</Form.Label>
                  <Form.Select
                    value={userForm.roleCustomId ? `custom:${userForm.roleCustomId}` : userForm.role}
                    onChange={(e) => {
                      const value = e.target.value
                      if (value.startsWith('custom:')) {
                        handleUserCustomRoleChange(value.replace('custom:', ''))
                      } else {
                        handleUserRoleChange(value as RoleKey)
                      }
                    }}
                    className="bg-light shadow-sm"
                  >
                    <option value="ADMIN">ADMIN (sistema)</option>
                    <option value="QA_LEAD">QA_LEAD (sistema)</option>
                    <option value="TESTER">TESTER (sistema)</option>
                    <option value="VIEWER">VIEWER (sistema)</option>
                    {customRoles.length > 0 && <option disabled>{t('configuracion.customRolesOption')}</option>}
                    {customRoles.filter(role => role.status === 'Activo').map(role => (
                      <option key={role.id} value={`custom:${role.id}`}>{role.name}</option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group>
                  <Form.Label className="x-small fw-bold text-muted">{t('configuracion.authentication')}</Form.Label>
                  <Form.Select value={userForm.auth} onChange={(e) => setUserForm({ ...userForm, auth: e.target.value, adLookupVerified: false })} className="bg-light shadow-sm">
                    <option value="Local">Local</option>
                    <option value="AD">Active Directory</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group>
                  <Form.Label className="x-small fw-bold text-muted">{t('configuracion.status')}</Form.Label>
                  <Form.Select value={userForm.status} onChange={(e) => setUserForm({ ...userForm, status: e.target.value })} className="bg-light shadow-sm">
                    <option value="Activo">{t('configuracion.active')}</option>
                    <option value="Inactivo">{t('configuracion.inactive')}</option>
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
            {userForm.auth === 'AD' && (
              <Alert variant="info" className="small mb-0 mt-3 py-2">
                {t('configuracion.adUserInfo')}
              </Alert>
            )}

          </Modal.Body>
          <Modal.Footer className="bg-light border-top-0 pt-0 px-4 pb-4">
            <Button variant="outline-secondary" onClick={() => setShowUserModal(false)} className="fw-bold shadow-none rounded-pill px-4">{t('configuracion.cancel')}</Button>
            <Button variant="primary" type="submit" className="fw-bold shadow-sm rounded-pill px-4" disabled={userForm.auth === 'AD' && !userForm.adLookupVerified}>
              <Save size={16} className="me-2" /> {t('configuracion.saveUser')}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={showProjectMemberModal} onHide={() => setShowProjectMemberModal(false)} centered backdrop="static">
        <Modal.Header closeButton className="bg-light border-bottom text-dark">
            <Modal.Title className="fw-bold fs-5 text-dark d-flex align-items-center gap-2">
            <Users size={20} className="text-primary" /> {t('configuracion.assignProjectUser')}
          </Modal.Title>
        </Modal.Header>
        <Form onSubmit={handleSubmitProjectMember}>
          <Modal.Body className="p-4 text-start">
            <div className="mb-3 p-3 rounded-3 bg-light border">
              <div className="x-small fw-bold text-muted text-uppercase">{t('configuracion.project')}</div>
              <div className="fw-bold text-dark">{projectsList.find(project => project.id === managingProjectId)?.name || t('configuracion.activeProject')}</div>
            </div>

            <Form.Group className="mb-3">
              <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>{t('configuracion.existingUser')}</RequiredLabel></Form.Label>
              <Form.Control
                list="project-member-user-options"
                value={projectMemberUserText}
                onChange={(event) => {
                  const value = event.target.value
                  setProjectMemberUserText(value)
                  const selectedUser = activeAssignableUsers.find(user => {
                    const label = getAssignableUserLabel(user)
                    return label === value || user.email === value || user.id === value
                  })
                  setProjectMemberForm({ ...projectMemberForm, userId: selectedUser?.id || '' })
                }}
                placeholder={t('configuracion.projectUserPlaceholder')}
                required
                className="bg-light shadow-sm"
              />
              <datalist id="project-member-user-options">
                {activeAssignableUsers.map(user => (
                  <option key={user.id} value={getAssignableUserLabel(user)} />
                ))}
              </datalist>
            </Form.Group>

            {assignableUsers.length === 0 && (
              <div className="small text-danger mt-3">{t('configuracion.noAssignableUsers')}</div>
            )}
          </Modal.Body>
          <Modal.Footer className="bg-light border-top-0 pt-0 px-4 pb-4">
            <Button variant="outline-secondary" onClick={() => setShowProjectMemberModal(false)} className="fw-bold shadow-none rounded-pill px-4">{t('configuracion.cancel')}</Button>
            <Button variant="primary" type="submit" className="fw-bold shadow-sm rounded-pill px-4" disabled={!projectMemberForm.userId}>
              <Users size={16} className="me-2" /> {t('configuracion.assignUser')}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={!!projectMemberRemoval} onHide={() => setProjectMemberRemoval(null)} centered>
        <Modal.Header closeButton className="bg-light border-bottom text-dark">
          <Modal.Title className="fw-bold fs-5 text-dark d-flex align-items-center gap-2">
            <Trash2 size={20} className="text-danger" /> Quitar miembro del proyecto
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="p-4 text-start">
          <p className="small text-muted mb-3">
            {t('configuracion.removeProjectMemberDescription')}
          </p>
          <div className="border rounded-3 bg-light p-3">
            <div className="fw-bold text-dark">{projectMemberRemoval?.user?.name || projectMemberRemoval?.userId || t('configuracion.selectedUser')}</div>
            <div className="x-small text-muted">{projectMemberRemoval?.user?.email || t('configuracion.projectMember')}</div>
          </div>
        </Modal.Body>
        <Modal.Footer className="bg-light border-top-0 pt-0 px-4 pb-4">
          <Button variant="outline-secondary" onClick={() => setProjectMemberRemoval(null)} className="fw-bold shadow-none rounded-pill px-4">
            {t('configuracion.cancel')}
          </Button>
          <Button variant="danger" onClick={confirmRemoveProjectMember} className="fw-bold shadow-sm rounded-pill px-4">
            {t('configuracion.removeUser')}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  )
}
