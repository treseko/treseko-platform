import { useState } from 'react'
import { Badge, Button, Col, Form, Modal, Row } from 'react-bootstrap'
import { Save, Search, ShieldCheck } from 'lucide-react'
import { RequiredLabel } from '../../shared/ui/RequiredLabel'
import type { PermissionLevel } from '../../app/types'
import { useI18n } from '../../i18n'

const NAVIGATION_SECTION: Record<string, { label: string; order: number }> = {
  dashboard: { label: 'Dashboard', order: 10 },
  ejecutar: { label: 'Ejecutar Pruebas', order: 20 },
  crear_pruebas: { label: 'Añadir Pruebas', order: 30 },
  automatizacion: { label: 'Automatización', order: 40 },
  proyectos: { label: 'Proyectos', order: 50 },
  inventario: { label: 'Inventario', order: 60 },
  reportes: { label: 'Reportes y Métricas', order: 70 },
  bugs: { label: 'Bug Tracker', order: 80 },
  incidencias: { label: 'Centro de Incidencias', order: 90 },
  motor_ia: { label: 'Motor IA', order: 100 },
  redmine: { label: 'Complementos', order: 110 },
  plugins: { label: 'Complementos', order: 110 },
  historial: { label: 'Historial Runs', order: 120 },
  configuracion: { label: 'Configuración', order: 130 },
  notificaciones: { label: 'Configuración', order: 130 },
  integraciones: { label: 'Configuración', order: 130 },
}

export function RoleModal({ options }: { options: any }) {
  const { t } = useI18n()
  const { showRoleModal, setShowRoleModal, editingRoleId, roleForm, setRoleForm, setRoleModulePermission, setRoleCapabilityPermission, applyRolePreset, handleSaveRole, rolePermissionGroups, selectedRolePermissionGroup, setRolePermissionGroupKey, getCapabilityLabel, affectedUserCount = 0 } = options
  const [permissionSearch, setPermissionSearch] = useState('')
  const effectiveCapabilityLevel = (group: any, capability: any): PermissionLevel =>
    roleForm.capabilities?.[capability.id] || roleForm.permissions?.[group.module] || 'none'
  const effectiveCapabilityEntries = rolePermissionGroups.flatMap((group: any) =>
    group.capabilities.map((capability: any) => ({ group, capability, level: effectiveCapabilityLevel(group, capability) })),
  )
  const navigationGroups = (Object.entries(rolePermissionGroups.reduce((groups: Record<string, { label: string; order: number; items: any[] }>, group: any) => {
    const section = NAVIGATION_SECTION[group.module] || { label: group.moduleLabel, order: 999 }
    const current = groups[section.label] || { label: section.label, order: section.order, items: [] }
    current.items.push(group)
    groups[section.label] = current
    return groups
  }, {}))) as Array<[string, { label: string; order: number; items: any[] }]>
  navigationGroups.sort(([, left], [, right]) => left.order - right.order)
  const navigationSections = navigationGroups.map(([sectionLabel, section]) => {
    if (sectionLabel !== 'Complementos' || section.items.length <= 1) return { sectionLabel, ...section }
    return {
      sectionLabel,
      label: section.label,
      order: section.order,
      items: [{
        ...section.items[0],
        groupKey: `section:${sectionLabel}`,
        moduleLabel: 'Complementos',
        moduleDescription: 'Trackers externos, integraciones y extensiones instalables.',
        isComposite: true,
        sourceGroups: section.items,
      }],
    }
  })
  return (
<Modal show={showRoleModal} onHide={() => setShowRoleModal(false)} centered size="xl" backdrop="static" dialogClassName="role-editor-modal">
  <Modal.Header closeButton closeLabel={t('configuracion.close')} className="bg-light border-bottom text-dark">
    <Modal.Title className="fw-bold fs-5 text-dark d-flex align-items-center gap-2">
      <ShieldCheck size={20} className="text-primary" /> {editingRoleId ? t('configuracion.editRole') : t('configuracion.newRole')}
    </Modal.Title>
  </Modal.Header>
  <Form onSubmit={handleSaveRole} className="role-editor-form">
    <Modal.Body className="p-4 text-start">
      <Row className="g-2">
        <Col md={6}>
          <Form.Group>
            <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>{t('configuracion.roleName')}</RequiredLabel></Form.Label>
            <Form.Control name="a11y-rolemodaltsx-23" aria-label={t('configuracion.roleName')} value={roleForm.name} onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })} required disabled={editingRoleId?.startsWith('system:')} className="bg-light shadow-sm" placeholder={t('configuracion.roleNamePlaceholder')} />
          </Form.Group>
        </Col>
        <Col md={6}>
          <Form.Group>
            <Form.Label className="x-small fw-bold text-muted">{t('configuracion.status')}</Form.Label>
            <Form.Select name="a11y-rolemodaltsx-29" aria-label={t('configuracion.status')} value={roleForm.status} onChange={(e) => setRoleForm({ ...roleForm, status: e.target.value })} disabled={editingRoleId?.startsWith('system:')} className="bg-light shadow-sm">
              <option value="Activo">{t('configuracion.active')}</option>
              <option value="Inactivo">{t('configuracion.inactive')}</option>
            </Form.Select>
          </Form.Group>
        </Col>
        <Col md={12}>
          <Form.Group>
            <Form.Label className="x-small fw-bold text-muted">{t('configuracion.description')}</Form.Label>
            <Form.Control name="a11y-rolemodaltsx-38" aria-label={t('configuracion.description')} as="textarea" rows={2} value={roleForm.description} onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })} className="bg-light shadow-sm" placeholder={t('configuracion.roleDescriptionPlaceholder')} />
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
            {effectiveCapabilityEntries.filter(({ level }: any) => level === 'read' || level === 'edit').length} {t('configuracion.capabilities')}
          </Badge>
        </div>
        <div className="role-permission-summary d-flex flex-wrap gap-2 mb-2" aria-live="polite">
          <Badge bg="white" text="dark" className="border">
            {Object.values(roleForm.permissions || {}).filter(level => level === 'read' || level === 'edit').length} {t('configuracion.modules')}
          </Badge>
          <Badge bg="white" text="dark" className="border">
            {effectiveCapabilityEntries.filter(({ level }: any) => level === 'read').length} {t('configuracion.read')}
          </Badge>
          <Badge bg="white" text="dark" className="border">
            {effectiveCapabilityEntries.filter(({ level }: any) => level === 'edit').length} {t('configuracion.edit')}
          </Badge>
        </div>
        {editingRoleId?.startsWith('system:') && (
          <div className="alert alert-warning small py-2 mb-2">
            {t('configuracion.systemRoleWarning', { count: affectedUserCount })}
          </div>
        )}
        {!editingRoleId && (
          <div className="d-flex flex-wrap gap-2 mb-2">
            <span className="small text-muted align-self-center">{t('configuracion.rolePreset')}:</span>
            <Button type="button" size="sm" variant="outline-secondary" onClick={() => applyRolePreset('none')}>{t('configuracion.presetNone')}</Button>
            <Button type="button" size="sm" variant="outline-secondary" onClick={() => applyRolePreset('read')}>{t('configuracion.presetRead')}</Button>
            <Button type="button" size="sm" variant="outline-secondary" onClick={() => applyRolePreset('edit')}>{t('configuracion.presetEdit')}</Button>
          </div>
        )}
        <div className="input-group input-group-sm mb-2">
          <span className="input-group-text bg-white"><Search size={14} /></span>
          <Form.Control
            value={permissionSearch}
            onChange={event => setPermissionSearch(event.target.value)}
            placeholder={t('configuracion.permissionSearchPlaceholder')}
            aria-label={t('configuracion.permissionSearchAria')}
          />
        </div>
        <div className="role-permission-workbench border rounded-3 bg-light p-2">
          <Row className="g-2">
            <Col md={4} lg={3}>
              <div className="role-permission-nav d-flex flex-column gap-1">
                {navigationSections.map(section => <div key={section.sectionLabel} className="mb-2">
                  {(() => {
                    const sectionItems = section.items
                    const selectedInSection = sectionItems.some((item: any) => selectedRolePermissionGroup?.groupKey === item.groupKey || item.sourceGroups?.some((source: any) => source.groupKey === selectedRolePermissionGroup?.groupKey))
                    return <>
                  <div className="x-small fw-bold text-uppercase text-muted px-2 pt-2 pb-1">{section.label}</div>
                  {sectionItems.map((group: any) => {
                  const moduleLevel = roleForm.permissions[group.module] || 'none'
                  const sourceGroups = group.sourceGroups || [group]
                    const assignedCount = sourceGroups.reduce((total: number, source: any) => total + source.capabilities.filter((capability: any) => ['read', 'edit'].includes(effectiveCapabilityLevel(source, capability))).length, 0)
                  const totalCount = sourceGroups.reduce((total: number, source: any) => total + source.capabilities.length, 0)
                  const isSelected = group.isComposite ? selectedInSection : selectedRolePermissionGroup?.groupKey === group.groupKey
                  const showItemLabel = sectionItems.length > 1
                  return (
                    <Button
                      key={group.groupKey}
                      type="button"
                      variant={isSelected ? 'primary' : 'light'}
                      className={`role-permission-nav-item text-start border d-flex justify-content-between align-items-start gap-2 ${isSelected ? 'text-white' : 'text-dark'}`}
                      onClick={() => setRolePermissionGroupKey(group.isComposite ? group.sourceGroups[0].groupKey : group.groupKey)}
                    >
                        <span className="min-w-0">
                          {showItemLabel && <span className="d-block fw-bold small">{group.moduleLabel}</span>}
                          <span className={`role-permission-nav-description d-block x-small ${isSelected ? 'text-white-50' : 'text-muted'}`}>{group.moduleDescription}</span>
                          <span className={`d-block x-small ${isSelected ? 'text-white-50' : 'text-muted'}`}>{group.isComposite ? 'Trackers y extensiones' : moduleLevel === 'none' ? t('configuracion.moduleNoAccess') : t('configuracion.moduleLevel', { level: sourceGroups.some((source: any) => source.capabilities.some((capability: any) => effectiveCapabilityLevel(source, capability) !== moduleLevel)) ? t('configuracion.mixedLevel') : moduleLevel === 'edit' ? t('configuracion.edit') : t('configuracion.read') })}</span>
                      </span>
                      <Badge bg={isSelected ? 'light' : assignedCount ? 'primary' : 'secondary'} text={isSelected ? 'primary' : undefined} className="flex-shrink-0">
                        {assignedCount}/{totalCount}
                      </Badge>
                    </Button>
                  )
                  })}
                    </>
                  })()}
                </div>)}
              </div>
            </Col>
            <Col md={8} lg={9}>
              {selectedRolePermissionGroup && (() => {
                const complementSection = navigationSections.find(section => section.sectionLabel === 'Complementos')
                const isComplementSelection = ['redmine', 'plugins'].includes(selectedRolePermissionGroup.module)
                const panelGroups: any[] = isComplementSelection
                  ? (complementSection?.items[0]?.sourceGroups || [selectedRolePermissionGroup])
                  : [selectedRolePermissionGroup]
                return (
                  <div className="d-flex flex-column gap-3">
                  {panelGroups.map(group => {
                    const moduleLevel = roleForm.permissions[group.module] || 'none'
                    const childLevels = group.capabilities.map((capability: any) => effectiveCapabilityLevel(group, capability))
                    const mixed = new Set(childLevels).size > 1
                    const normalizedSearch = permissionSearch.trim().toLowerCase()
                    const visibleCapabilities = group.capabilities.filter((capability: any) => !normalizedSearch || `${getCapabilityLabel(capability)} ${capability.impact || capability.route || ''}`.toLowerCase().includes(normalizedSearch))
                    if (normalizedSearch && visibleCapabilities.length === 0) return null
                    return (<div key={group.groupKey} className="role-permission-panel bg-white border rounded-3 p-3">
                    <div className="d-flex align-items-center justify-content-between gap-3 mb-3">
                      <div className="min-w-0">
                        <div className="fw-bold text-dark">{group.moduleLabel}</div>
                        <div className="small text-muted">{group.moduleDescription}</div>
                        <div className="x-small text-muted">{mixed ? t('configuracion.mixedCapabilities') : t('configuracion.uniformCapabilities')}</div>
                      </div>
                      <Form.Select name="a11y-rolemodaltsx-93" aria-label={t('configuracion.moduleLevel', { level: t(`navigation.${group.module}` as any) })}
                        size="sm"
                        value={moduleLevel}
                        onChange={(e) => setRoleModulePermission(group.module, e.target.value as PermissionLevel, group.capabilities.map(capability => capability.id))}
                        className="shadow-none flex-shrink-0"
                        style={{ maxWidth: 170 }}
                      >
                        <option value="none">{t('configuracion.noAccess')}</option>
                        <option value="read">{t('configuracion.read')}</option>
                        <option value="edit">{t('configuracion.edit')}</option>
                      </Form.Select>
                    </div>
                    {(() => {
                      const sections: string[] = Array.from(new Set<string>(group.capabilities.map(capability => capability.subsection || 'Permisos del módulo')))
                      return sections.map(section => <div key={section} className="mb-3">
                        <div className="small fw-bold text-uppercase text-muted mb-2">{section}</div>
                        <Row className="g-2">
                      {visibleCapabilities.filter(capability => (capability.subsection || 'Permisos del módulo') === section && capability.scope !== 'action').map(capability => (
                        <Col lg={6} key={capability.id}>
                          <div className="d-flex align-items-center justify-content-between gap-2 bg-light border rounded-2 p-2">
                            <span className="min-w-0">
                              <span className="small text-dark d-block">{getCapabilityLabel(capability)}</span>
                              <span className="x-small text-muted d-block">{capability.purpose || capability.impact || capability.route || 'Pantalla del módulo.'}</span>
                              {capability.compatibility_note && <span className="x-small text-warning-emphasis d-block">{capability.compatibility_note}</span>}
                            </span>
                            <Form.Select name="a11y-rolemodaltsx-110" aria-label={getCapabilityLabel(capability)}
                              size="sm"
                              value={effectiveCapabilityLevel(group, capability)}
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
                      </div>)
                    })()}
                    {group.capabilities.some(capability => capability.scope === 'action') && <>
                      <div className="small fw-bold text-uppercase text-muted mb-2">Acciones</div>
                      <Row className="g-2">
                        {visibleCapabilities.filter(capability => capability.scope === 'action').map(capability => (
                          <Col lg={6} key={capability.id}>
                            <div className="d-flex align-items-center justify-content-between gap-2 bg-light border rounded-2 p-2">
                              <span className="min-w-0">
                                <span className="small text-dark d-block">{getCapabilityLabel(capability)}</span>
                                <span className="x-small text-muted d-block">{capability.purpose || capability.impact || capability.route || 'Acción del módulo.'}</span>
                              </span>
                              <Form.Select name="a11y-rolemodaltsx-110" aria-label={getCapabilityLabel(capability)} size="sm" value={roleForm.capabilities?.[capability.id] || 'none'} onChange={(e) => setRoleCapabilityPermission(capability.id, e.target.value as PermissionLevel)} className="shadow-none flex-shrink-0" style={{ width: 132 }}>
                                <option value="none">{t('configuracion.noAccess')}</option><option value="read">{t('configuracion.read')}</option><option value="edit">{t('configuracion.edit')}</option>
                              </Form.Select>
                            </div>
                          </Col>
                        ))}
                      </Row>
                    </>}
                  </div>)
                  })}
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
