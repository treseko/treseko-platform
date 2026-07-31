import { Badge, Button, Col, Form, Modal, Row } from 'react-bootstrap'
import { Save, ShieldCheck } from 'lucide-react'
import { RequiredLabel } from '../../shared/ui/RequiredLabel'
import type { PermissionLevel } from '../../app/types'
import { useI18n } from '../../i18n'

export function RoleModal({ options }: { options: any }) {
  const { t } = useI18n()
  const { showRoleModal, setShowRoleModal, editingRoleId, roleForm, setRoleForm, setRoleModulePermission, setRoleCapabilityPermission, handleSaveRole, rolePermissionGroups, selectedRolePermissionGroup, setRolePermissionGroupKey, getCapabilityLabel } = options
  return (
<Modal show={showRoleModal} onHide={() => setShowRoleModal(false)} centered size="xl" backdrop="static" dialogClassName="role-editor-modal">
  <Modal.Header closeButton className="bg-light border-bottom text-dark">
    <Modal.Title className="fw-bold fs-5 text-dark d-flex align-items-center gap-2">
      <ShieldCheck size={20} className="text-primary" /> {editingRoleId ? t('configuracion.editRole') : t('configuracion.newRole')}
    </Modal.Title>
  </Modal.Header>
  <Form onSubmit={handleSaveRole}>
    <Modal.Body className="p-4 text-start">
      <Row className="g-2">
        <Col md={6}>
          <Form.Group>
            <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>{t('configuracion.roleName')}</RequiredLabel></Form.Label>
            <Form.Control value={roleForm.name} onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })} required disabled={editingRoleId?.startsWith('system:')} className="bg-light shadow-sm" placeholder={t('configuracion.roleNamePlaceholder')} />
          </Form.Group>
        </Col>
        <Col md={6}>
          <Form.Group>
            <Form.Label className="x-small fw-bold text-muted">{t('configuracion.status')}</Form.Label>
            <Form.Select value={roleForm.status} onChange={(e) => setRoleForm({ ...roleForm, status: e.target.value })} disabled={editingRoleId?.startsWith('system:')} className="bg-light shadow-sm">
              <option value="Activo">{t('configuracion.active')}</option>
              <option value="Inactivo">{t('configuracion.inactive')}</option>
            </Form.Select>
          </Form.Group>
        </Col>
        <Col md={12}>
          <Form.Group>
            <Form.Label className="x-small fw-bold text-muted">{t('configuracion.description')}</Form.Label>
            <Form.Control as="textarea" rows={2} value={roleForm.description} onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })} className="bg-light shadow-sm" placeholder={t('configuracion.roleDescriptionPlaceholder')} />
          </Form.Group>
        </Col>
      </Row>
      <div className="mt-4">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <div>
            <div className="x-small fw-bold text-muted text-uppercase">{t('configuracion.rolePermissionsTitle')}</div>
            <div className="small text-muted">{t('configuracion.rolePermissionsDesc')}</div>
          </div>
          <Badge bg="light" text="dark" className="border">
            {Object.values(roleForm.capabilities || {}).filter(level => level === 'read' || level === 'edit').length} {t('configuracion.capabilities')}
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
                        <span className="d-block fw-bold small text-truncate">{t(`navigation.${group.module}` as any)}</span>
                        <span className={`d-block x-small ${isSelected ? 'text-white-50' : 'text-muted'}`}>{moduleLevel === 'none' ? t('configuracion.moduleNoAccess') : t('configuracion.moduleLevel', { level: moduleLevel === 'edit' ? t('configuracion.edit') : t('configuracion.read') })}</span>
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
                        <div className="fw-bold text-dark">{t(`navigation.${group.module}` as any)}</div>
                        <div className="x-small text-muted">{mixed ? t('configuracion.mixedCapabilities') : t('configuracion.uniformCapabilities')}</div>
                      </div>
                      <Form.Select
                        size="sm"
                        value={moduleLevel}
                        onChange={(e) => setRoleModulePermission(group.module, e.target.value as PermissionLevel)}
                        className="shadow-none flex-shrink-0"
                        style={{ maxWidth: 170 }}
                      >
                        <option value="none">{t('configuracion.noAccess')}</option>
                        <option value="read">{t('configuracion.read')}</option>
                        <option value="edit">{t('configuracion.edit')}</option>
                      </Form.Select>
                    </div>
                    <Row className="g-2">
                      {group.capabilities.map(capability => (
                        <Col lg={6} key={capability.id}>
                          <div className="d-flex align-items-center justify-content-between gap-2 bg-light border rounded-2 p-2">
                            <span className="small text-dark">{getCapabilityLabel(capability)}</span>
                            <Form.Select
                              size="sm"
                              value={roleForm.capabilities?.[capability.id] || 'none'}
                              onChange={(e) => setRoleCapabilityPermission(capability.id, e.target.value as PermissionLevel)}
                              className="shadow-none flex-shrink-0"
                              style={{ width: 132 }}
                            >
                              <option value="none">{t('configuracion.noAccess')}</option>
                              <option value="read">{t('configuracion.read')}</option>
                              <option value="edit">{t('configuracion.edit')}</option>
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
      <Button variant="outline-secondary" onClick={() => setShowRoleModal(false)} className="fw-bold shadow-none rounded-pill px-4">{t('configuracion.cancel')}</Button>
      <Button variant="primary" type="submit" className="fw-bold shadow-sm rounded-pill px-4">
        <Save size={16} className="me-2" /> {t('configuracion.saveRole')}
      </Button>
    </Modal.Footer>
  </Form>
</Modal>
  )
}
