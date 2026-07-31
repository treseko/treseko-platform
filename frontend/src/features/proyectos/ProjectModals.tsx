import { Badge, Button, Col, Form, Modal, Row } from 'react-bootstrap'
import { Info, Save } from 'lucide-react'
import { RequiredLabel } from '../../shared/ui/RequiredLabel'

export function ProjectModals({
  t, showProjectStatusHelp, setShowProjectStatusHelp, projectStatusHelpItems, projectStatusVariant,
  showEnvironmentModal, closeEnvironmentModal, editingEnvironment, submitEnvironmentModal,
  environmentVariablesText,
}: any) {
  return <>
    <Modal show={showProjectStatusHelp} onHide={() => setShowProjectStatusHelp(false)} centered size="lg">
      <Modal.Header closeButton><Modal.Title className="fw-bold d-flex align-items-center gap-2"><Info size={20} className="text-primary" />{t('proyectos.statusesTitle')}</Modal.Title></Modal.Header>
      <Modal.Body>
        <div className="project-status-help-list">{projectStatusHelpItems.map((item: any) => {
          const variant = projectStatusVariant(item.status)
          return <div key={item.status} className="project-status-help-item"><div className="d-flex align-items-center gap-2 flex-wrap mb-1"><Badge bg={variant} text={variant === 'light' ? 'secondary' : undefined} className={variant === 'light' ? 'border' : ''}>{item.status}</Badge><span className="fw-bold small text-dark">{item.summary}</span></div><div className="small text-muted">{item.restriction}</div></div>
        })}</div>
        <div className="small text-secondary bg-light border rounded-3 p-3 mt-3">{t('proyectos.versionNote')}</div>
      </Modal.Body>
      <Modal.Footer><Button variant="primary" onClick={() => setShowProjectStatusHelp(false)}>{t('proyectos.understood')}</Button></Modal.Footer>
    </Modal>
    <Modal show={showEnvironmentModal} onHide={closeEnvironmentModal} centered size="lg">
      <Form key={editingEnvironment?.id || 'new-environment'} onSubmit={submitEnvironmentModal}>
        <Modal.Header closeButton><Modal.Title className="fw-bold">{editingEnvironment ? t('proyectos.editEnvironment') : t('proyectos.newEnvironment')}</Modal.Title></Modal.Header>
        <Modal.Body><Row className="g-3">
          <Col md={6}><Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>{t('proyectos.environmentName')}</RequiredLabel></Form.Label><Form.Control name="envName" defaultValue={editingEnvironment?.name || ''} placeholder={t('proyectos.environmentNamePlaceholder')} required /></Col>
          <Col md={6}><Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>{t('proyectos.environmentUrl')}</RequiredLabel></Form.Label><Form.Control name="envUrl" type="url" defaultValue={editingEnvironment?.url || ''} placeholder={t('proyectos.environmentUrlPlaceholder')} required /></Col>
          <Col md={6}><Form.Label className="x-small fw-bold text-muted">{t('proyectos.deployedVersion')}</Form.Label><Form.Control name="envVersion" defaultValue={editingEnvironment?.version || ''} placeholder={t('proyectos.envVersionPlaceholder')} /></Col>
          <Col md={6}><Form.Label className="x-small fw-bold text-muted">{t('proyectos.envStatus')}</Form.Label><Form.Select name="envStatus" defaultValue={editingEnvironment?.status || 'Online'}><option value="Online">Online</option><option value="Offline">Offline</option><option value="Maintenance">Maintenance</option><option value="Unknown">Unknown</option></Form.Select></Col>
          <Col xs={12}><Form.Label className="x-small fw-bold text-muted">{t('proyectos.envBaseVariables')}</Form.Label><Form.Control as="textarea" rows={6} name="envVariables" className="font-monospace small" defaultValue={environmentVariablesText(editingEnvironment)} placeholder={t('proyectos.envBaseVariablesPlaceholder')} /><div className="small text-muted mt-2">{t('proyectos.variablesHint')}</div></Col>
        </Row></Modal.Body>
        <Modal.Footer><Button type="button" variant="outline-secondary" onClick={closeEnvironmentModal}>{t('proyectos.cancel')}</Button><Button type="submit" variant="primary" className="fw-bold"><Save size={16} className="me-1" /> {t('proyectos.saveEnvironment')}</Button></Modal.Footer>
      </Form>
    </Modal>
  </>
}
