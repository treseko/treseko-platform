import { useEffect, useState } from 'react'
import { Accordion, Alert, Badge, Button, Col, Form, Modal, Row } from 'react-bootstrap'
import { Info, Save } from 'lucide-react'
import { RequiredLabel } from '../../shared/ui/RequiredLabel'
import { chatbotProfilePresets, normalizeReusableProfiles } from '../casos/chatbotConfig'

export function ProjectModals({
  t, showProjectStatusHelp, setShowProjectStatusHelp, projectStatusHelpItems, projectStatusVariant,
  showEnvironmentModal, closeEnvironmentModal, editingEnvironment, submitEnvironmentModal,
  environmentVariablesText,
}: any) {
  const chatbot = editingEnvironment?.chatbotConfig || {}
  const connection = chatbot.connection || {}
  const jsonText = (value: any) => {
    if (value == null || (Array.isArray(value) && value.length === 0) || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)) return ''
    return JSON.stringify(value, null, 2)
  }
  const [profilesText, setProfilesText] = useState('[]')
  const [defaultProfile, setDefaultProfile] = useState('')
  const configuredProfiles = normalizeReusableProfiles(chatbot.profiles)
  const reusableProfiles = configuredProfiles.length ? configuredProfiles : chatbotProfilePresets
  let profileOptions = reusableProfiles
  try {
    profileOptions = normalizeReusableProfiles(JSON.parse(profilesText))
  } catch {
    // Keep the last valid catalog while the author is editing JSON.
  }

  useEffect(() => {
    setProfilesText(jsonText(reusableProfiles))
    setDefaultProfile(String(chatbot.default_profile || reusableProfiles[0]?.id || ''))
  }, [editingEnvironment?.id, editingEnvironment?.chatbotConfig])

  const loadSuggestedProfiles = () => {
    setProfilesText(jsonText(chatbotProfilePresets))
    setDefaultProfile(chatbotProfilePresets[0]?.id || '')
  }
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
          <Col md={6}><Form.Label className="x-small fw-bold text-muted">{t('proyectos.envStatus')}</Form.Label><Form.Select name="envStatus" defaultValue={editingEnvironment?.status || 'Online'}><option value="Online">{t('proyectos.environmentOnline')}</option><option value="Offline">{t('proyectos.environmentOffline')}</option><option value="Maintenance">{t('proyectos.environmentMaintenance')}</option><option value="Unknown">{t('proyectos.environmentUnknown')}</option></Form.Select></Col>
          <Col xs={12}><Form.Label className="x-small fw-bold text-muted">{t('proyectos.envBaseVariables')}</Form.Label><Form.Control as="textarea" rows={6} name="envVariables" className="font-monospace small" defaultValue={environmentVariablesText(editingEnvironment)} placeholder={t('proyectos.envBaseVariablesPlaceholder')} /><div className="small text-muted mt-2">{t('proyectos.variablesHint')}</div></Col>
          <Col xs={12}>
            <Accordion className="project-chatbot-config-accordion">
              <Accordion.Item eventKey="chatbot">
                <Accordion.Header><span className="fw-bold">{t('proyectos.chatbotEnvironmentTitle')}</span><Badge bg={chatbot.connection ? 'success' : 'light'} text={chatbot.connection ? undefined : 'dark'} className="border ms-2">{chatbot.connection ? t('proyectos.chatbotConfigured') : t('proyectos.chatbotOptional')}</Badge></Accordion.Header>
                <Accordion.Body>
                  <Alert variant="info" className="small py-2">{t('proyectos.chatbotEnvironmentHint')}</Alert>
                  <Row className="g-2">
                    <Col md={3}><Form.Label className="x-small fw-bold text-muted">{t('proyectos.chatbotAdapter')}</Form.Label><Form.Select size="sm" name="chatbotAdapter" defaultValue={connection.adapter || 'http'}><option value="http">{t('proyectos.adapterHttpJson')}</option><option value="openai_compatible">{t('proyectos.adapterOpenAiCompatible')}</option></Form.Select></Col>
                    <Col md={6}><Form.Label className="x-small fw-bold text-muted">{t('proyectos.chatbotEndpoint')}</Form.Label><Form.Control size="sm" name="chatbotEndpoint" defaultValue={connection.endpoint || ''} placeholder="{{ENV.CHATBOT_URL}}/api/chat" /></Col>
                    <Col md={3}><Form.Label className="x-small fw-bold text-muted">{t('proyectos.chatbotMethod')}</Form.Label><Form.Select size="sm" name="chatbotMethod" defaultValue={connection.method || 'POST'}>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(method => <option key={method} value={method}>{method}</option>)}</Form.Select></Col>
                    <Col md={6}><Form.Label className="x-small fw-bold text-muted">{t('proyectos.chatbotHeaders')}</Form.Label><Form.Control as="textarea" rows={3} name="chatbotHeaders" className="font-monospace small" defaultValue={jsonText(connection.headers)} placeholder={'{"Content-Type":"application/json"}'} /></Col>
                    <Col md={6}><Form.Label className="x-small fw-bold text-muted">{t('proyectos.chatbotRequestTemplate')}</Form.Label><Form.Control as="textarea" rows={3} name="chatbotRequestTemplate" className="font-monospace small" defaultValue={jsonText(connection.request_template)} placeholder={'{"message":"{{turn.message}}"}'} /></Col>
                    <Col md={6}><Form.Label className="x-small fw-bold text-muted">{t('proyectos.chatbotResponseMapping')}</Form.Label><Form.Control as="textarea" rows={3} name="chatbotResponseMapping" className="font-monospace small" defaultValue={jsonText(connection.response_mapping)} placeholder={'{"message_path":"$.answer","session_id_path":"$.session_id"}'} /></Col>
                    <Col md={6}><Form.Label className="x-small fw-bold text-muted">{t('proyectos.chatbotProfileBindings')}</Form.Label><Form.Control as="textarea" rows={3} name="chatbotProfileBindings" className="font-monospace small" defaultValue={jsonText(chatbot.profile_bindings)} placeholder={'{"age":"edad","tone":"tono_usuario"}'} /></Col>
                    <Col xs={12}>
                      <div className="d-flex justify-content-between align-items-center gap-2 mb-1">
                        <Form.Label className="x-small fw-bold text-muted mb-0">{t('proyectos.reusableProfiles')}</Form.Label>
                        <Button type="button" variant="outline-primary" size="sm" onClick={loadSuggestedProfiles}>{t('proyectos.loadSuggestedProfiles')}</Button>
                      </div>
                      <Form.Control as="textarea" rows={5} name="chatbotProfiles" className="font-monospace small" value={profilesText} onChange={event => setProfilesText(event.target.value)} placeholder={'[{"id":"usuario_mayor","name":"Usuario mayor","profile":{"age":65}}]'} />
                      <Form.Text>{t('proyectos.reusableProfilesHint')}</Form.Text>
                    </Col>
                    <Col md={6}><Form.Label className="x-small fw-bold text-muted">{t('proyectos.defaultProfile')}</Form.Label><Form.Select size="sm" name="chatbotDefaultProfile" value={defaultProfile} onChange={event => setDefaultProfile(event.target.value)}><option value="">{t('proyectos.noDefaultProfile')}</option>{profileOptions.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</Form.Select></Col>
                    <Col md={3}><Form.Label className="x-small fw-bold text-muted">{t('proyectos.chatbotTimeout')}</Form.Label><Form.Control size="sm" type="number" min={500} name="chatbotTimeout" defaultValue={connection.timeout_ms || 30000} /></Col>
                    <Col md={3}><Form.Label className="x-small fw-bold text-muted">{t('proyectos.chatbotRetries')}</Form.Label><Form.Control size="sm" type="number" min={0} max={3} name="chatbotRetries" defaultValue={connection.retries || 0} /></Col>
                  </Row>
                </Accordion.Body>
              </Accordion.Item>
            </Accordion>
          </Col>
        </Row></Modal.Body>
        <Modal.Footer><Button type="button" variant="outline-secondary" onClick={closeEnvironmentModal}>{t('proyectos.cancel')}</Button><Button type="submit" variant="primary" className="fw-bold"><Save size={16} className="me-1" /> {t('proyectos.saveEnvironment')}</Button></Modal.Footer>
      </Form>
    </Modal>
  </>
}
