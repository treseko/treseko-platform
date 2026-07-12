import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { Alert, Badge, Button, Col, Form, Modal, Row } from 'react-bootstrap'
import { Search, Save, ShieldCheck, Trash2, Users } from 'lucide-react'
import { API_BASE } from '../../app/constants'
import { RBAC_CAPABILITIES } from '../../app/rbac/rbacCatalog'
import { RequiredLabel } from '../../shared/ui/RequiredLabel'
import type { CapabilityId, PermissionLevel, RoleKey } from '../../app/types'

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
  const [projectMemberUserText, setProjectMemberUserText] = useState('')
  const [rolePermissionGroupKey, setRolePermissionGroupKey] = useState('')
  const [adLookupQuery, setAdLookupQuery] = useState('')
  const [adLookupLoading, setAdLookupLoading] = useState(false)
  const [adLookupMessage, setAdLookupMessage] = useState('')
  const [adLookupResults, setAdLookupResults] = useState<any[]>([])
  const activeAssignableUsers = useMemo(() => assignableUsers.filter(user => user.status !== 'Inactivo'), [assignableUsers])
  const getAssignableUserLabel = (user: any) => `${user.name || user.email || user.id} - ${user.email || 'sin email'}${user.role || user.baseRole ? ` (${user.role || user.baseRole})` : ''}`
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
    setAdLookupMessage(`Usuario AD seleccionado${payload.username ? `: ${payload.username}` : ''}.`)
  }

  const lookupAdUser = async () => {
    const query = adLookupQuery.trim() || userForm.email.trim()
    if (!query) {
      setAdLookupMessage('Ingresa email, UPN o usuario de AD para buscar.')
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
        throw new Error(payload?.detail || `Backend respondio ${response.status}`)
      }
      const results = Array.isArray(payload?.results) ? payload.results : []
      if (payload?.found && payload.email) {
        applyAdLookupResult(payload, query)
        return
      }
      if (results.length > 0) {
        setUserForm((current: any) => ({ ...current, auth: 'AD', adLookupVerified: false }))
        setAdLookupResults(results)
        setAdLookupMessage(`Se encontraron ${results.length} coincidencia${results.length === 1 ? '' : 's'}. Selecciona una para vincularla.`)
        return
      }
      throw new Error('El usuario no existe en Active Directory/LDAP')
    } catch (error: any) {
      setUserForm((current: any) => ({ ...current, adLookupVerified: false }))
      setAdLookupResults([])
      setAdLookupMessage(error?.message || 'No se pudo buscar el usuario en AD.')
    } finally {
      setAdLookupLoading(false)
    }
  }

  return (
    <>
      <Modal show={showRoleModal} onHide={() => setShowRoleModal(false)} centered size="xl" backdrop="static" dialogClassName="role-editor-modal">
        <Modal.Header closeButton className="bg-light border-bottom text-dark">
          <Modal.Title className="fw-bold fs-5 text-dark d-flex align-items-center gap-2">
            <ShieldCheck size={20} className="text-primary" /> {editingRoleId ? 'Editar rol' : 'Nuevo rol'}
          </Modal.Title>
        </Modal.Header>
        <Form onSubmit={handleSaveRole}>
          <Modal.Body className="p-4 text-start">
            <Row className="g-2">
              <Col md={6}>
                <Form.Group>
                  <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>Nombre del rol</RequiredLabel></Form.Label>
                  <Form.Control value={roleForm.name} onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })} required disabled={editingRoleId?.startsWith('system:')} className="bg-light shadow-sm" placeholder="Ej: Auditor externo" />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group>
                  <Form.Label className="x-small fw-bold text-muted">Estado</Form.Label>
                  <Form.Select value={roleForm.status} onChange={(e) => setRoleForm({ ...roleForm, status: e.target.value })} disabled={editingRoleId?.startsWith('system:')} className="bg-light shadow-sm">
                    <option value="Activo">Activo</option>
                    <option value="Inactivo">Inactivo</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={12}>
                <Form.Group>
                  <Form.Label className="x-small fw-bold text-muted">Descripción</Form.Label>
                  <Form.Control as="textarea" rows={2} value={roleForm.description} onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })} className="bg-light shadow-sm" placeholder="Alcance funcional del rol..." />
                </Form.Group>
              </Col>
            </Row>
            <div className="mt-4">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div>
                  <div className="x-small fw-bold text-muted text-uppercase">Modulos y capacidades del rol</div>
                  <div className="small text-muted">El modulo muestra la seccion; cada capacidad habilita pantallas y acciones internas.</div>
                </div>
                <Badge bg="light" text="dark" className="border">
                  {Object.values(roleForm.capabilities || {}).filter(level => level === 'read' || level === 'edit').length} capacidades
                </Badge>
              </div>
              <div className="role-permission-workbench border rounded-3 bg-light p-2">
                <Row className="g-2">
                  <Col md={4} lg={3}>
                    <div className="role-permission-nav d-flex flex-column gap-1">
                      {rolePermissionGroups.map(group => {
                        const moduleLevel = roleForm.permissions[group.module] || 'none'
                        const assignedCount = group.capabilities.filter(capability => ['read', 'edit'].includes(roleForm.capabilities?.[capability.id] || '')).length
                        const isSelected = selectedRolePermissionGroup?.groupKey === group.groupKey
                        return (
                          <Button
                            key={group.groupKey}
                            type="button"
                            variant={isSelected ? 'primary' : 'light'}
                            className={`role-permission-nav-item text-start border d-flex justify-content-between align-items-center gap-2 ${isSelected ? 'text-white' : 'text-dark'}`}
                            onClick={() => setRolePermissionGroupKey(group.groupKey)}
                          >
                            <span className="min-w-0">
                              <span className="d-block fw-bold small text-truncate">{group.moduleLabel}</span>
                              <span className={`d-block x-small ${isSelected ? 'text-white-50' : 'text-muted'}`}>{moduleLevel === 'none' ? 'Modulo sin acceso' : `Modulo: ${moduleLevel === 'edit' ? 'Edicion' : 'Lectura'}`}</span>
                            </span>
                            <Badge bg={isSelected ? 'light' : assignedCount ? 'primary' : 'secondary'} text={isSelected ? 'primary' : undefined} className="flex-shrink-0">
                              {assignedCount}
                            </Badge>
                          </Button>
                        )
                      })}
                    </div>
                  </Col>
                  <Col md={8} lg={9}>
                    {selectedRolePermissionGroup && (() => {
                      const group = selectedRolePermissionGroup
                      const moduleLevel = roleForm.permissions[group.module] || 'none'
                      const childLevels = group.capabilities.map(capability => roleForm.capabilities?.[capability.id] || 'none')
                      const mixed = new Set(childLevels).size > 1
                      return (
                        <div className="role-permission-panel bg-white border rounded-3 p-3">
                          <div className="d-flex align-items-center justify-content-between gap-3 mb-3">
                            <div className="min-w-0">
                              <div className="fw-bold text-dark">{group.moduleLabel}</div>
                              <div className="x-small text-muted">{mixed ? 'Capacidades mixtas' : 'Capacidades uniformes'}</div>
                            </div>
                            <Form.Select
                              size="sm"
                              value={moduleLevel}
                              onChange={(e) => setRoleModulePermission(group.module, e.target.value as PermissionLevel)}
                              className="shadow-none flex-shrink-0"
                              style={{ maxWidth: 170 }}
                            >
                              <option value="none">Sin acceso</option>
                              <option value="read">Lectura</option>
                              <option value="edit">Edicion</option>
                            </Form.Select>
                          </div>
                          <Row className="g-2">
                            {group.capabilities.map(capability => (
                              <Col lg={6} key={capability.id}>
                                <div className="d-flex align-items-center justify-content-between gap-2 bg-light border rounded-2 p-2">
                                  <span className="small text-dark">{capability.label}</span>
                                  <Form.Select
                                    size="sm"
                                    value={roleForm.capabilities?.[capability.id] || 'none'}
                                    onChange={(e) => setRoleCapabilityPermission(capability.id, e.target.value as PermissionLevel)}
                                    className="shadow-none flex-shrink-0"
                                    style={{ width: 132 }}
                                  >
                                    <option value="none">Sin acceso</option>
                                    <option value="read">Lectura</option>
                                    <option value="edit">Edicion</option>
                                  </Form.Select>
                                </div>
                              </Col>
                            ))}
                          </Row>
                        </div>
                      )
                    })()}
                  </Col>
                </Row>
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer className="bg-light border-top-0 pt-0 px-4 pb-4">
            <Button variant="outline-secondary" onClick={() => setShowRoleModal(false)} className="fw-bold shadow-none rounded-pill px-4">Cancelar</Button>
            <Button variant="primary" type="submit" className="fw-bold shadow-sm rounded-pill px-4">
              <Save size={16} className="me-2" /> Guardar rol
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={showUserModal} onHide={() => setShowUserModal(false)} centered size="lg" backdrop="static">
        <Modal.Header closeButton className="bg-light border-bottom text-dark">
          <Modal.Title className="fw-bold fs-5 text-dark d-flex align-items-center gap-2">
            <Users size={20} className="text-primary" /> {editingUserId ? 'Editar usuario' : 'Nuevo usuario'}
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
                    <Form.Label className="x-small fw-bold text-muted">Buscar usuario en Active Directory</Form.Label>
                    <div className="d-flex gap-2">
                      <Form.Control
                        value={adLookupQuery}
                        onChange={(e) => {
                          setAdLookupQuery(e.target.value)
                          setAdLookupResults([])
                          setUserForm((current: any) => ({ ...current, adLookupVerified: false }))
                        }}
                        placeholder="Nombre, email, UPN o usuario. Ej: ana, carla"
                        className="bg-white shadow-sm"
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            lookupAdUser()
                          }
                        }}
                      />
                      <Button type="button" variant="outline-primary" className="fw-bold" onClick={lookupAdUser} disabled={adLookupLoading}>
                        <Search size={16} className="me-2" /> {adLookupLoading ? 'Buscando' : 'Buscar'}
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
                  <Form.Label className="x-small fw-bold text-muted">Nombre completo</Form.Label>
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
                  <Form.Label className="x-small fw-bold text-muted">Contraseña local</Form.Label>
                  <Form.Control
                    type="password"
                    value={userForm.password}
                    onChange={(e) => setUserForm({ ...userForm, password: e.target.value, saveError: '' })}
                    disabled={userForm.auth === 'AD'}
                    className="bg-light shadow-sm"
                    placeholder={userForm.auth === 'AD' ? 'Validada por Active Directory' : editingUserId ? 'Dejar vacía para conservar' : 'Contraseña inicial'}
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group>
                  <Form.Label className="x-small fw-bold text-muted">Rol</Form.Label>
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
                    {customRoles.length > 0 && <option disabled>--- Roles personalizados ---</option>}
                    {customRoles.filter(role => role.status === 'Activo').map(role => (
                      <option key={role.id} value={`custom:${role.id}`}>{role.name}</option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group>
                  <Form.Label className="x-small fw-bold text-muted">Autenticación</Form.Label>
                  <Form.Select value={userForm.auth} onChange={(e) => setUserForm({ ...userForm, auth: e.target.value, adLookupVerified: false })} className="bg-light shadow-sm">
                    <option value="Local">Local</option>
                    <option value="AD">Active Directory</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group>
                  <Form.Label className="x-small fw-bold text-muted">Estado</Form.Label>
                  <Form.Select value={userForm.status} onChange={(e) => setUserForm({ ...userForm, status: e.target.value })} className="bg-light shadow-sm">
                    <option value="Activo">Activo</option>
                    <option value="Inactivo">Inactivo</option>
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
            {userForm.auth === 'AD' && (
              <Alert variant="info" className="small mb-0 mt-3 py-2">
                Este registro vincula un usuario existente del directorio corporativo con roles de Treseko. Busca y valida el usuario en AD antes de guardar. La contrasena no se guarda ni se modifica en Treseko.
              </Alert>
            )}

          </Modal.Body>
          <Modal.Footer className="bg-light border-top-0 pt-0 px-4 pb-4">
            <Button variant="outline-secondary" onClick={() => setShowUserModal(false)} className="fw-bold shadow-none rounded-pill px-4">Cancelar</Button>
            <Button variant="primary" type="submit" className="fw-bold shadow-sm rounded-pill px-4" disabled={userForm.auth === 'AD' && !userForm.adLookupVerified}>
              <Save size={16} className="me-2" /> Guardar usuario
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={showProjectMemberModal} onHide={() => setShowProjectMemberModal(false)} centered backdrop="static">
        <Modal.Header closeButton className="bg-light border-bottom text-dark">
          <Modal.Title className="fw-bold fs-5 text-dark d-flex align-items-center gap-2">
            <Users size={20} className="text-primary" /> Asignar usuario al proyecto
          </Modal.Title>
        </Modal.Header>
        <Form onSubmit={handleSubmitProjectMember}>
          <Modal.Body className="p-4 text-start">
            <div className="mb-3 p-3 rounded-3 bg-light border">
              <div className="x-small fw-bold text-muted text-uppercase">Proyecto</div>
              <div className="fw-bold text-dark">{projectsList.find(project => project.id === managingProjectId)?.name || 'Proyecto activo'}</div>
            </div>

            <Form.Group className="mb-3">
              <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>Usuario existente</RequiredLabel></Form.Label>
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
                placeholder="Escribi nombre, email o rol..."
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
              <div className="small text-danger mt-3">No hay usuarios disponibles para asignar.</div>
            )}
          </Modal.Body>
          <Modal.Footer className="bg-light border-top-0 pt-0 px-4 pb-4">
            <Button variant="outline-secondary" onClick={() => setShowProjectMemberModal(false)} className="fw-bold shadow-none rounded-pill px-4">Cancelar</Button>
            <Button variant="primary" type="submit" className="fw-bold shadow-sm rounded-pill px-4" disabled={!projectMemberForm.userId}>
              <Users size={16} className="me-2" /> Asignar usuario
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
            El usuario dejará de ver este proyecto y sus componentes, builds, casos y ejecuciones asociadas.
          </p>
          <div className="border rounded-3 bg-light p-3">
            <div className="fw-bold text-dark">{projectMemberRemoval?.user?.name || projectMemberRemoval?.userId || 'Usuario seleccionado'}</div>
            <div className="x-small text-muted">{projectMemberRemoval?.user?.email || 'Miembro del proyecto'}</div>
          </div>
        </Modal.Body>
        <Modal.Footer className="bg-light border-top-0 pt-0 px-4 pb-4">
          <Button variant="outline-secondary" onClick={() => setProjectMemberRemoval(null)} className="fw-bold shadow-none rounded-pill px-4">
            Cancelar
          </Button>
          <Button variant="danger" onClick={confirmRemoveProjectMember} className="fw-bold shadow-sm rounded-pill px-4">
            Quitar usuario
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  )
}
