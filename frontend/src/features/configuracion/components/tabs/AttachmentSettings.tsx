import { Alert, Badge, Button, Card, Col, Form, Row } from 'react-bootstrap'
import { Save, ShieldCheck } from 'lucide-react'
import type { AttachmentMimeGroup, AttachmentMimeOption } from '../../hooks/useAttachmentMimeOptions'

type Props = {
  t: (key: string) => string
  attachmentConfig: any
  setAttachmentConfig: (config: any) => void
  attachmentConfigLoading: boolean
  saveAttachmentConfig: (config: any) => void
  attachmentMimeGroups: AttachmentMimeGroup[]
  toggleAttachmentMime: (option: AttachmentMimeOption, checked: boolean) => void
  canEditAttachments: boolean
  evidencePolicy: { sanitization_enabled: boolean; traceability_complete_enabled: boolean }
  evidencePolicyLoading: boolean
  evidencePolicySaving: boolean
  canManageEvidenceSanitization: boolean
  saveEvidencePolicy: (traceabilityEnabled: boolean) => void
}

export function AttachmentSettings({
  t, attachmentConfig, setAttachmentConfig, attachmentConfigLoading, saveAttachmentConfig,
  attachmentMimeGroups, toggleAttachmentMime, canEditAttachments, evidencePolicy,
  evidencePolicyLoading, evidencePolicySaving, canManageEvidenceSanitization, saveEvidencePolicy,
}: Props) {
  const isAttachmentOptionChecked = (option: AttachmentMimeOption) => {
    const enabledTypes = attachmentConfig.allowed_mime_types || []
    return [option.value, option.extra, ...(option.extras || [])].filter(Boolean).some(value => enabledTypes.includes(value))
  }

  return <Card className="border-0 shadow-sm rounded-4 bg-white p-4 mt-4">
    <div className="d-flex justify-content-between align-items-start mb-3">
      <div>
        <h6 className="fw-bold text-dark m-0 d-flex align-items-center gap-2"><ShieldCheck size={18} className="text-primary" /> {t('configuracion.attachmentsTitle')}</h6>
        <span className="small text-muted">{t('configuracion.attachmentsDesc')}</span>
      </div>
      <Badge bg="light" text="dark" className="border">{attachmentConfig.allowed_mime_types?.length || 0} {t('configuracion.attachmentsAllowedTypes')}</Badge>
    </div>
    <div className="border rounded-4 bg-light p-3 mb-4">
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-3">
        <div className="pe-lg-4">
          <div className="fw-bold text-dark">{t('configuracion.attachmentsModeTraceability')}</div>
          <div className="small text-muted">{t('configuracion.attachmentsModeTraceabilityDesc')}</div>
          {!canManageEvidenceSanitization && <div className="x-small text-muted mt-2">{t('configuracion.attachmentsPermissionNeeded')}</div>}
        </div>
        <div className="d-flex align-items-center gap-3">
          <Badge bg={evidencePolicy.traceability_complete_enabled ? 'warning' : 'success'} text={evidencePolicy.traceability_complete_enabled ? 'dark' : undefined} className="border">
            {evidencePolicy.traceability_complete_enabled ? t('configuracion.attachmentsModeTraceabilityBadge') : t('configuracion.attachmentsModeSafe')}
          </Badge>
          <Form.Check type="switch" id="evidence-traceability-mode" label={evidencePolicy.traceability_complete_enabled ? t('configuracion.attachmentsActive') : t('configuracion.attachmentsInactive')} checked={Boolean(evidencePolicy.traceability_complete_enabled)} disabled={!canManageEvidenceSanitization || evidencePolicyLoading || evidencePolicySaving} onChange={(event) => { void saveEvidencePolicy(event.target.checked) }} />
        </div>
      </div>
      {evidencePolicy.traceability_complete_enabled && <Alert variant="warning" className="small mb-0 mt-3 py-2">{t('configuracion.attachmentsTraceabilityAlert')}</Alert>}
    </div>
    <Form onSubmit={(e) => { e.preventDefault(); saveAttachmentConfig(attachmentConfig) }}>
      <Row className="g-3">
        <Col md={12}>
          <Form.Label className="fw-bold small text-muted">{t('configuracion.attachmentsAllowedTypes')}</Form.Label>
          <div className="d-grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {attachmentMimeGroups.map(group => <div key={group.label} className="border rounded-3 bg-light p-3">
              <div className="x-small fw-bold text-muted text-uppercase mb-2">{group.label}</div>
              <div className="d-flex flex-wrap gap-3">{group.options.map(option => <Form.Check key={option.value} type="checkbox" id={`mime-${option.value}`} label={option.label} checked={isAttachmentOptionChecked(option)} disabled={!canEditAttachments} onChange={(event) => toggleAttachmentMime(option, event.target.checked)} />)}</div>
            </div>)}
          </div>
          <div className="x-small text-muted mt-2">{t('configuracion.attachmentsVideoHint')}</div>
        </Col>
        <Col md={4}><Form.Label className="fw-bold small text-muted">{t('configuracion.attachmentsMaxSize')}</Form.Label><Form.Control name="a11y-attachmentsettings-maxsize" aria-label="Campo de formulario" type="number" min={1} max={100} value={attachmentConfig.max_file_size_mb} disabled={!canEditAttachments} onChange={(e) => setAttachmentConfig({ ...attachmentConfig, max_file_size_mb: Number(e.target.value) })} /></Col>
        <Col md={4}><Form.Label className="fw-bold small text-muted">{t('configuracion.attachmentsMaxPerStep')}</Form.Label><Form.Control name="a11y-attachmentsettings-perstep" aria-label="Campo de formulario" type="number" min={1} max={50} value={attachmentConfig.max_files_per_step} disabled={!canEditAttachments} onChange={(e) => setAttachmentConfig({ ...attachmentConfig, max_files_per_step: Number(e.target.value) })} /></Col>
        <Col md={4}><Form.Label className="fw-bold small text-muted">{t('configuracion.attachmentsMaxPerSnapshot')}</Form.Label><Form.Control name="a11y-attachmentsettings-persnapshot" aria-label="Campo de formulario" type="number" min={1} max={100} value={attachmentConfig.max_files_per_snapshot} disabled={!canEditAttachments} onChange={(e) => setAttachmentConfig({ ...attachmentConfig, max_files_per_snapshot: Number(e.target.value) })} /></Col>
        <Col md={6}><Form.Check type="switch" id="enable-paste" label={t('configuracion.attachmentsEnablePaste')} checked={attachmentConfig.enable_clipboard_paste} disabled={!canEditAttachments} onChange={(e) => setAttachmentConfig({ ...attachmentConfig, enable_clipboard_paste: e.target.checked })} /></Col>
        <Col md={6}><Form.Check type="switch" id="require-failure-evidence" label={t('configuracion.attachmentsRequireEvidenceOnFailure')} checked={attachmentConfig.require_evidence_on_failure} disabled={!canEditAttachments} onChange={(e) => setAttachmentConfig({ ...attachmentConfig, require_evidence_on_failure: e.target.checked })} /></Col>
      </Row>
      {canEditAttachments && <div className="text-end border-top pt-3 mt-3"><Button variant="primary" type="submit" className="px-4 fw-bold rounded-pill shadow-sm" disabled={attachmentConfigLoading}><Save size={16} className="me-2" /> {t('configuracion.attachmentsSave')}</Button></div>}
    </Form>
  </Card>
}
