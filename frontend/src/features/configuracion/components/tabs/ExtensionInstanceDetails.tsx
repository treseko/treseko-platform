import { Badge, Button, Col, Form, Row } from 'react-bootstrap'
import { KeyRound, Power, RefreshCw, Settings2, ShieldCheck } from 'lucide-react'
import { PremiumGate } from '../../../premium/PremiumGate'
import { useI18n } from '../../../../i18n'
import type { ExtensionItem } from './IntegrationsSettingsTab'

type Draft = { url: string, project_key: string, notes: string }
type AuditEvent = { id: string, accion: string, usuario_email?: string, fecha?: string, detalles?: Record<string, any> }

type Props = {
  selected: ExtensionItem
  premiumBlocked: boolean
  hasSystemFeature?: (feature: string) => boolean
  configDraft: Draft
  setConfigDraft: (value: Draft | ((previous: Draft) => Draft)) => void
  secretDraft: string
  setSecretDraft: (value: string) => void
  storeAudit: AuditEvent[]
  saving: boolean
  canConfigure: boolean
  canManageSecrets: boolean
  canToggle: boolean
  canAccessCapability: (capabilityId: any, level?: any) => boolean
  onSave: () => void
  onTest: () => void
  onSaveSecret: () => void
  onToggle: () => void
  onUninstall: () => void
  onLoadAudit: () => void
}

export function ExtensionInstanceDetails({
  selected, premiumBlocked, hasSystemFeature, configDraft, setConfigDraft, secretDraft, setSecretDraft,
  storeAudit, saving, canConfigure, canManageSecrets, canToggle, canAccessCapability,
  onSave, onTest, onSaveSecret, onToggle, onUninstall, onLoadAudit,
}: Props) {
  const { t } = useI18n()
  const instance = selected.instance
  if (!instance) return null
  const isStorePlugin = selected.id.startsWith('com.treseko.')

  return <div className="d-grid gap-4">
    {premiumBlocked && selected.premium_feature && <PremiumGate
      feature={selected.premium_feature}
      hasFeature={hasSystemFeature}
      title={t('configuracion.extensionPremiumTitle')}
      description={t('configuracion.extensionPremiumDescription')}
      mode="card"
    />}

    <section>
      <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
        <h6 className="fw-bold text-secondary small text-uppercase m-0"><Settings2 size={14} className="me-1" /> {t('configuracion.extensionConfiguration')}</h6>
        {instance.last_error && <Badge bg="danger">{instance.last_error}</Badge>}
      </div>
      <Row className="g-2">
        <Col md={7}><Form.Label className="small fw-bold text-muted">{t('configuracion.extensionServiceUrl')}</Form.Label><Form.Control size="sm" value={configDraft.url} placeholder="https://service.example.local" onChange={event => setConfigDraft(previous => ({ ...previous, url: event.target.value }))} disabled={!canConfigure || premiumBlocked} /></Col>
        <Col md={5}><Form.Label className="small fw-bold text-muted">{t('configuracion.extensionProjectKey')}</Form.Label><Form.Control size="sm" value={configDraft.project_key} placeholder="QA, APP, DEMO..." onChange={event => setConfigDraft(previous => ({ ...previous, project_key: event.target.value }))} disabled={!canConfigure || premiumBlocked} /></Col>
        <Col xs={12}><Form.Label className="small fw-bold text-muted">{t('configuracion.extensionInternalNotes')}</Form.Label><Form.Control as="textarea" rows={2} size="sm" value={configDraft.notes} placeholder={t('configuracion.extensionNotesPlaceholder')} onChange={event => setConfigDraft(previous => ({ ...previous, notes: event.target.value }))} disabled={!canConfigure || premiumBlocked} /></Col>
      </Row>
      <div className="d-flex flex-wrap gap-2 mt-2">
        <Button size="sm" variant="primary" className="app-save-button" onClick={onSave} disabled={saving || !canConfigure || premiumBlocked}>{t('common.save')}</Button>
        <Button size="sm" variant="outline-secondary" className="fw-bold" onClick={onTest} disabled={saving || premiumBlocked}><RefreshCw size={14} className="me-1" /> {t('configuracion.extensionTest')}</Button>
      </div>
    </section>

    <section>
      <h6 className="fw-bold text-secondary small text-uppercase"><KeyRound size={14} className="me-1" /> {t('configuracion.extensionSecrets')}</h6>
      <div className="d-flex flex-column flex-md-row gap-2"><Form.Control size="sm" type="password" value={secretDraft} placeholder={t('configuracion.extensionSecretPlaceholder')} onChange={event => setSecretDraft(event.target.value)} disabled={!canManageSecrets || premiumBlocked} /><Button size="sm" variant="outline-primary" className="app-save-button text-nowrap" onClick={onSaveSecret} disabled={saving || !canManageSecrets || !secretDraft.trim() || premiumBlocked}>{t('configuracion.extensionSaveSecret')}</Button></div>
      <div className="d-flex flex-wrap gap-1 mt-2">
        {Object.entries(instance.secrets_configured || {}).map(([key, value]: any) => <Badge key={key} bg="light" text="dark" className="border">{key}: {value?.fingerprint ? `huella ...${value.fingerprint}` : 'configurado'}</Badge>)}
        {Object.keys(instance.secrets_configured || {}).length === 0 && <span className="small text-muted">Sin secretos configurados.</span>}
      </div>
    </section>

    <section className="d-flex flex-wrap gap-2">
      <Button variant={instance.enabled ? 'outline-danger' : 'success'} size="sm" className="fw-bold" onClick={onToggle} disabled={saving || !canToggle || premiumBlocked}><Power size={14} className="me-1" /> {instance.enabled ? 'Deshabilitar' : 'Habilitar'}</Button>
      {isStorePlugin && <Button variant="outline-danger" size="sm" onClick={onUninstall} disabled={saving || !canAccessCapability('plugins.instalar', 'edit')}>Desinstalar</Button>}
    </section>

    <section>
      <div className="d-flex justify-content-between align-items-center gap-2 mb-2"><h6 className="fw-bold text-secondary small text-uppercase m-0"><ShieldCheck size={14} className="me-1" /> Auditoria reciente</h6>{isStorePlugin && <Button size="sm" variant="outline-secondary" onClick={onLoadAudit} disabled={saving || !canAccessCapability('plugins.auditoria', 'read')}>Ver historial</Button>}</div>
      <div className="small text-muted d-grid gap-1">
        {storeAudit.map(event => <div key={event.id} className="border rounded-3 px-2 py-1 bg-light"><strong>{event.accion}</strong> por {event.usuario_email || 'sistema'} · {event.fecha || 'sin fecha'}</div>)}
        {(instance.audit_events || []).slice(0, 5).map((event, index) => <div key={`${event.at}-${index}`} className="border rounded-3 px-2 py-1 bg-light"><strong>{event.action}</strong> por {event.actor || 'sistema'} · {event.at || 'sin fecha'}</div>)}
        {(instance.audit_events || []).length === 0 && <span>Sin eventos registrados.</span>}
      </div>
    </section>
  </div>
}
