import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { Badge, Button, Card, Col, Form, Row, Table } from 'react-bootstrap'
import { ArchiveX, Building2 } from 'lucide-react'
import { RequiredLabel } from '../../../../shared/ui/RequiredLabel'
import { useI18n } from '../../../../i18n'

type Props = {
  organizations: any[]
  projectsList: any[]
  selectedOrganizationId: string | null
  setSelectedOrganizationId: (id: string) => void
  handleCreateOrganization: (event: any) => void
  handleUpdateOrganization: (event: any, orgId: string) => void
  handleSetOrganizationActive: (orgId: string, active: boolean) => Promise<any>
  loadOrganizationsFromBackend: (options?: { includeInactive?: boolean }) => Promise<any[]>
  organizationMembers: any[]
  organizationMemberForm: any
  setOrganizationMemberForm: (form: any) => void
  assignableUsers: any[]
  handleAssignOrganizationMember: (event: any) => void
  handleRemoveOrganizationMember: (userId: string) => void
  canAccessModule: (moduleId: any, level?: any) => boolean
  isAdmin: boolean
}

export function OrganizationsSettingsTab({
  organizations,
  projectsList,
  selectedOrganizationId,
  setSelectedOrganizationId,
  handleCreateOrganization,
  handleUpdateOrganization,
  handleSetOrganizationActive,
  loadOrganizationsFromBackend,
  organizationMembers,
  organizationMemberForm,
  setOrganizationMemberForm,
  assignableUsers,
  handleAssignOrganizationMember,
  handleRemoveOrganizationMember,
  canAccessModule,
  isAdmin,
}: Props) {
  const { t } = useI18n()
  const canEditClients = canAccessModule('clientes', 'edit')
  const canViewInactiveOrganizations = isAdmin
  const [organizationSearch, setOrganizationSearch] = useState('')
  const [showInactiveOrganizations, setShowInactiveOrganizations] = useState(false)
  const [inactiveToggleLoading, setInactiveToggleLoading] = useState(false)
  const [userAutocompleteText, setUserAutocompleteText] = useState('')
  const normalizedOrganizationSearch = organizationSearch.trim().toLowerCase()
  const visibleOrganizations = useMemo(() => {
    const scopedOrganizations = showInactiveOrganizations
      ? organizations.filter(org => org.active === false)
      : organizations.filter(org => org.active !== false)
    if (!normalizedOrganizationSearch) return scopedOrganizations
    return scopedOrganizations.filter(org => {
      const haystack = `${org.name || ''} ${org.type || ''} ${org.id || ''}`.toLowerCase()
      return haystack.includes(normalizedOrganizationSearch)
    })
  }, [normalizedOrganizationSearch, organizations, showInactiveOrganizations])
  const activeAssignableUsers = useMemo(() => assignableUsers.filter(user => user.status === 'Activo'), [assignableUsers])
  const getAssignableUserLabel = (user: any) => `${user.name || user.email || user.id} - ${user.email || 'sin email'}${user.roleLabel || user.role ? ` (${user.roleLabel || user.role})` : ''}`
  const selectedOrganization = useMemo(
    () => organizations.find(org => org.id === selectedOrganizationId),
    [organizations, selectedOrganizationId]
  )
  const inactiveCount = useMemo(() => organizations.filter(org => org.active === false).length, [organizations])

  const toggleInactiveOrganizations = async (checked: boolean) => {
    if (!canViewInactiveOrganizations) return
    setShowInactiveOrganizations(checked)
    setInactiveToggleLoading(true)
    try {
      await loadOrganizationsFromBackend({ includeInactive: checked })
    } finally {
      setInactiveToggleLoading(false)
    }
  }

  const deactivateOrganization = async (event: MouseEvent, org: any) => {
    event.stopPropagation()
    const updated = await handleSetOrganizationActive(org.id, false)
    if (updated?.active === false) {
      setShowInactiveOrganizations(false)
      setInactiveToggleLoading(true)
      try {
        await loadOrganizationsFromBackend({ includeInactive: false })
      } finally {
        setInactiveToggleLoading(false)
      }
    }
  }

  const reactivateOrganization = async (event: MouseEvent, org: any) => {
    event.stopPropagation()
    const updated = await handleSetOrganizationActive(org.id, true)
    if (updated?.active === true && showInactiveOrganizations) {
      setInactiveToggleLoading(true)
      try {
        const refreshedOrganizations = await loadOrganizationsFromBackend({ includeInactive: true })
        const nextInactiveOrganization = refreshedOrganizations.find(item => item.active === false)
        setSelectedOrganizationId(nextInactiveOrganization?.id || '')
      } finally {
        setInactiveToggleLoading(false)
      }
    }
  }

  useEffect(() => {
    if (!organizationMemberForm.userId) return
    const selectedUser = activeAssignableUsers.find(user => user.id === organizationMemberForm.userId)
    if (selectedUser) setUserAutocompleteText(getAssignableUserLabel(selectedUser))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAssignableUsers, organizationMemberForm.userId])

  useEffect(() => {
    setUserAutocompleteText('')
  }, [selectedOrganizationId])
  const selectedOrganizationMembers = useMemo(
    () => organizationMembers.filter(member => member.orgId === selectedOrganizationId),
    [organizationMembers, selectedOrganizationId]
  )

  return (
    <div className="animate__animated animate__fadeIn">
      <Card className="border-0 shadow-sm rounded-4 bg-white overflow-hidden">
        <Card.Header className="bg-white border-bottom py-3 px-4 d-flex justify-content-between align-items-center responsive-card-header">
          <div>
            <h6 className="fw-bold text-dark m-0">{t('configuracion.organizationsTitle')} ({visibleOrganizations.length})</h6>
            <span className="small text-muted">{t('configuracion.organizationsEditorHint')}</span>
          </div>
          {canViewInactiveOrganizations && (
            <Form.Check
              type="switch"
              id="show-inactive-organizations"
              label={inactiveToggleLoading ? t('configuracion.loading') : `${t('configuracion.showInactive')}${inactiveCount ? ` (${inactiveCount})` : ''}`}
              checked={showInactiveOrganizations}
              disabled={inactiveToggleLoading}
              onChange={(event) => toggleInactiveOrganizations(event.currentTarget.checked)}
              className="small fw-semibold text-muted"
            />
          )}
        </Card.Header>
        <Card.Body className="p-4">
          {canEditClients && (
            <Form className="bg-light border rounded-3 p-3 mb-3" onSubmit={handleCreateOrganization}>
              <Row className="g-2 align-items-end">
                <Col md={9}>
                  <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>{t('configuracion.name')}</RequiredLabel></Form.Label>
                  <Form.Control name="organizationName" placeholder={t('configuracion.organizationNamePlaceholder')} required />
                </Col>
                <Col md={3}>
                  <Button type="submit" variant="primary" className="w-100 fw-bold">
                    {t('configuracion.create')}
                  </Button>
                </Col>
              </Row>
            </Form>
          )}
          <Row className="g-3">
            <Col lg={5}>
              <div className="d-flex flex-column gap-2">
                <Form.Control
                  size="sm"
                  value={organizationSearch}
                  onChange={(event) => setOrganizationSearch(event.target.value)}
                  placeholder={t('configuracion.organizationSearchPlaceholder')}
                  aria-label={t('configuracion.organizationSearchAriaLabel')}
                  className="mb-1"
                />
                {visibleOrganizations.map(org => (
                  <Form key={org.id} className={`border rounded-3 p-3 ${selectedOrganizationId === org.id ? 'border-primary bg-primary bg-opacity-10' : 'bg-light'} ${org.active === false ? 'opacity-75' : ''}`} onClick={() => setSelectedOrganizationId(org.id)} onSubmit={(e) => handleUpdateOrganization(e, org.id)}>
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <Button type="button" variant="link" className="p-0 text-start fw-bold text-decoration-none" onClick={() => setSelectedOrganizationId(org.id)}>
                        <Building2 size={14} className="me-2" />{org.name}
                      </Button>
                      <div className="d-flex align-items-center gap-2">
                        <Badge bg="light" text="dark" className="border">{projectsList.filter(project => project.orgId === org.id).length} {t('configuracion.projects')}</Badge>
                        {org.active === false && <Badge bg="secondary">{t('configuracion.inactive')}</Badge>}
                        {selectedOrganizationId === org.id && <Badge bg="primary">{t('configuracion.selected')}</Badge>}
                      </div>
                    </div>
                    <Row className="g-2">
                      <Col md={6}>
                        <Form.Control name="organizationName" size="sm" defaultValue={org.name} disabled={!canEditClients || org.active === false} required />
                      </Col>
                      <Col md={3}>
                        <Form.Select name="organizationType" size="sm" defaultValue={org.type || 'Cliente'} disabled={!canEditClients || org.active === false}>
                          <option value="Cliente">{t('configuracion.organizationTypeClient')}</option>
                          <option value="Solucion">{t('configuracion.organizationTypeSolution')}</option>
                          <option value="Empresa">{t('configuracion.organizationTypeCompany')}</option>
                        </Form.Select>
                      </Col>
                      <Col md={2}>
                        {org.active === false && canEditClients && isAdmin ? (
                          <Button type="button" size="sm" variant="outline-success" className="w-100" onClick={(event) => reactivateOrganization(event, org)}>
                            {t('configuracion.reactivate')}
                          </Button>
                        ) : (
                          canEditClients && <Button type="submit" size="sm" variant="outline-primary" className="w-100">{t('configuracion.ok')}</Button>
                        )}
                      </Col>
                      <Col md={1}>
                        {org.active !== false && canEditClients && isAdmin && (
                          <Button type="button" size="sm" variant="outline-danger" className="w-100" title={t('configuracion.deactivateSolution')} aria-label={t('configuracion.deactivateOrganizationAria', { name: org.name })} onClick={(event) => deactivateOrganization(event, org)}>
                            <ArchiveX size={14} />
                          </Button>
                        )}
                      </Col>
                    </Row>
                  </Form>
                ))}
                {visibleOrganizations.length === 0 && (
                  <div className="border rounded-3 bg-light p-4 text-center text-muted small">
                    {t('configuracion.noOrganizationsFound')}
                  </div>
                )}
              </div>
            </Col>
            <Col lg={7}>
              <Card className="border bg-light h-100">
                <Card.Header className="bg-white d-flex justify-content-between align-items-center responsive-card-header">
                  <div>
                    <div className="fw-bold text-dark">{selectedOrganization?.name || t('configuracion.selectOrganization')}</div>
                    <div className="x-small text-muted">{t('configuracion.organizationMembersHint')}</div>
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    {selectedOrganization?.active === false && <Badge bg="secondary">{t('configuracion.inactive')}</Badge>}
                    <Badge bg="primary">{selectedOrganizationMembers.length}</Badge>
                  </div>
                </Card.Header>
                <Card.Body>
                  {canEditClients && selectedOrganization?.active !== false && (
                    <Form className="border rounded-3 p-3 bg-white mb-3" onSubmit={handleAssignOrganizationMember}>
                      <Row className="g-2 align-items-end">
                        <Col md={9}>
                          <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>{t('configuracion.user')}</RequiredLabel></Form.Label>
                          <Form.Control name="a11y-organizationssettingstabtsx-239" aria-label="Campo de formulario"
                            list="organization-member-user-options"
                            value={userAutocompleteText}
                            onChange={(event) => {
                              const value = event.target.value
                              setUserAutocompleteText(value)
                              const selectedUser = activeAssignableUsers.find(user => {
                                const label = getAssignableUserLabel(user)
                                return label === value || user.email === value || user.id === value
                              })
                              setOrganizationMemberForm({ ...organizationMemberForm, userId: selectedUser?.id || '' })
                            }}
                            placeholder={t('configuracion.organizationUserPlaceholder')}
                            disabled={!selectedOrganizationId}
                            required
                          />
                          <datalist id="organization-member-user-options">
                            {activeAssignableUsers.map(user => (
                              <option key={user.id} value={getAssignableUserLabel(user)} />
                            ))}
                          </datalist>
                        </Col>
                        <Col md={3}>
                          <Button type="submit" variant="primary" className="w-100 fw-bold" disabled={!selectedOrganizationId || !organizationMemberForm.userId}>{t('configuracion.assign')}</Button>
                        </Col>
                      </Row>
                    </Form>
                  )}
                  <Table responsive hover className="mb-0 align-middle">
                    <tbody>
                      {selectedOrganizationMembers.map(member => (
                        <tr key={member.id}>
                          <td className="fw-bold text-dark">{member.user?.name || member.userId}</td>
                          <td className="small text-muted">{member.user?.email || ''}</td>
                          <td className="text-end">
                            {canEditClients && <Button variant="link" size="sm" className="text-danger p-0" onClick={() => handleRemoveOrganizationMember(member.userId)}>{t('configuracion.remove')}</Button>}
                          </td>
                        </tr>
                      ))}
                      {selectedOrganizationMembers.length === 0 && (
                        <tr><td colSpan={3} className="text-center py-4 text-muted small">{t('configuracion.noAssignedUsers')}</td></tr>
                      )}
                    </tbody>
                  </Table>
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </Card.Body>
      </Card>
    </div>
  )
}
