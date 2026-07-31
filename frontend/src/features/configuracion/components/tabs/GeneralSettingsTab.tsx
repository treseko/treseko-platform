import { useEffect, useState } from 'react'
import { Alert, Badge, Button, Card, Col, Form, Row } from 'react-bootstrap'
import { Clock, Crown, Image as ImageIcon, Save, ShieldCheck } from 'lucide-react'
import { API_BASE } from '../../../../app/constants'
import { DEFAULT_BRANDING, normalizeBrandingState, type BrandingState } from '../../../../app/branding'
import { resolveAssetUrl } from '../../../../shared/utils/assets'
import { fetchEvidenceSanitizationPolicy, updateEvidenceSanitizationPolicy } from '../../api/configuracionApi'
import { ApiKeyPanel } from '../ApiKeyPanel'
import { SessionSettingsTab } from './SessionSettingsTab'
import { ActiveDirectorySettingsTab } from './ActiveDirectorySettingsTab'
import { useI18n } from '../../../../i18n'
import { BrandingSettings } from './BrandingSettings'
import type { AttachmentMimeGroup, AttachmentMimeOption } from '../../hooks/useAttachmentMimeOptions'

const SYSTEM_TIMEZONE_OPTIONS = [
  { value: 'America/Argentina/Buenos_Aires', label: 'Argentina - Buenos Aires' },
  { value: 'UTC', label: 'UTC' },
  { value: 'America/Santiago', label: 'Chile - Santiago' },
  { value: 'America/Montevideo', label: 'Uruguay - Montevideo' },
  { value: 'America/Asuncion', label: 'Paraguay - Asuncion' },
  { value: 'America/Lima', label: 'Peru - Lima' },
  { value: 'America/Bogota', label: 'Colombia - Bogota' },
  { value: 'America/Mexico_City', label: 'Mexico - Ciudad de Mexico' },
  { value: 'America/New_York', label: 'Estados Unidos - New York' },
  { value: 'Europe/Madrid', label: 'Espana - Madrid' },
]

type Props = {
  showFeedback: (title: string, message: string, variant?: string) => void
  sessionConfig: any
  setSessionConfig: (config: any) => void
  sessionConfigLoading: boolean
  saveSessionConfig: (config: any) => void
  canAccessCapability: (capabilityId: any, level?: any) => boolean
  hasSystemFeature: (featureId: string) => boolean
  apiKeys: any[]
  apiKeysLoading: boolean
  apiKeyName: string
  newApiKeyValue: string
  setApiKeyName: (value: string) => void
  createUserApiKey: () => void
  revokeUserApiKey: (id: string) => void
  handleApiKeyEnabledChange: (enabled: boolean) => void
  copyToClipboard: (text: string, label?: string) => void
  attachmentConfig: any
  setAttachmentConfig: (config: any) => void
  attachmentConfigLoading: boolean
  saveAttachmentConfig: (config: any) => void
  attachmentMimeGroups: AttachmentMimeGroup[]
  toggleAttachmentMime: (option: AttachmentMimeOption, checked: boolean) => void
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  onBrandingUpdated: (branding: BrandingState) => void
}

export function GeneralSettingsTab({
  showFeedback,
  sessionConfig,
  setSessionConfig,
  sessionConfigLoading,
  saveSessionConfig,
  canAccessCapability,
  hasSystemFeature,
  apiKeys,
  apiKeysLoading,
  apiKeyName,
  newApiKeyValue,
  setApiKeyName,
  createUserApiKey,
  revokeUserApiKey,
  handleApiKeyEnabledChange,
  copyToClipboard,
  attachmentConfig,
  setAttachmentConfig,
  attachmentConfigLoading,
  saveAttachmentConfig,
  attachmentMimeGroups,
  toggleAttachmentMime,
  fetchWithAuth,
  onBrandingUpdated,
}: Props) {
  const { t, locale } = useI18n()
  const canEditPreferences = canAccessCapability('configuracion.preferencias', 'edit')
  const canEditSession = canAccessCapability('configuracion.sesion', 'edit')
  const canEditAttachments = canAccessCapability('configuracion.adjuntos', 'edit')
  const canManageEvidenceSanitization = canAccessCapability('settings.evidence_sanitization.manage', 'edit')
  const canCustomizeBranding = hasSystemFeature('branding.custom')
  const showSsoPreview = canAccessCapability('configuracion.sesion', 'read') && !hasSystemFeature('auth.sso')
  const getAttachmentOptionValues = (option: AttachmentMimeOption) => (
    [option.value, option.extra, ...(option.extras || [])].filter(Boolean)
  )
  const isAttachmentOptionChecked = (option: AttachmentMimeOption) => {
    const enabledTypes = attachmentConfig.allowed_mime_types || []
    return getAttachmentOptionValues(option).some(value => enabledTypes.includes(value))
  }
  const [branding, setBranding] = useState<BrandingState>(DEFAULT_BRANDING)
  const [brandingDraft, setBrandingDraft] = useState<BrandingState>(DEFAULT_BRANDING)
  const [brandingLoading, setBrandingLoading] = useState(false)
  const [brandingSaving, setBrandingSaving] = useState(false)
  const [brandingUploading, setBrandingUploading] = useState(false)
  const [timeSettings, setTimeSettings] = useState({ timezone: 'America/Argentina/Buenos_Aires' })
  const [timeSettingsLoading, setTimeSettingsLoading] = useState(false)
  const [timeSettingsSaving, setTimeSettingsSaving] = useState(false)
  const [evidencePolicy, setEvidencePolicy] = useState({ sanitization_enabled: true, traceability_complete_enabled: false })
  const [evidencePolicyLoading, setEvidencePolicyLoading] = useState(false)
  const [evidencePolicySaving, setEvidencePolicySaving] = useState(false)

  const loadBranding = async () => {
    setBrandingLoading(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/system/branding`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.detail || 'No se pudo cargar el branding.')
      const normalized = normalizeBrandingState(data)
      setBranding(normalized)
      setBrandingDraft(normalized)
      onBrandingUpdated(normalized)
    } catch (error: any) {
      showFeedback(t('configuracion.brandingTitle'), error?.message || t('configuracion.brandingLoadError'), 'warning')
    } finally {
      setBrandingLoading(false)
    }
  }

  useEffect(() => {
    void loadBranding()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadTimeSettings = async () => {
    setTimeSettingsLoading(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/system/time-settings`)
      const data = await response.json().catch(() => ({}))
      if (response.status === 404) {
        setTimeSettings({ timezone: 'America/Argentina/Buenos_Aires' })
        return
      }
      if (!response.ok) throw new Error(data?.detail || 'No se pudo cargar la hora del sistema.')
      setTimeSettings({ timezone: data?.timezone || 'America/Argentina/Buenos_Aires' })
    } catch (error: any) {
      showFeedback(t('configuracion.systemTimeTitle'), error?.message || t('configuracion.systemTimeLoadError'), 'warning')
    } finally {
      setTimeSettingsLoading(false)
    }
  }

  useEffect(() => {
    void loadTimeSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadEvidencePolicy = async () => {
    setEvidencePolicyLoading(true)
    try {
      const data = await fetchEvidenceSanitizationPolicy(fetchWithAuth)
      setEvidencePolicy({
        sanitization_enabled: Boolean(data?.sanitization_enabled ?? true),
        traceability_complete_enabled: Boolean(data?.traceability_complete_enabled ?? !data?.sanitization_enabled),
      })
    } catch (error: any) {
      showFeedback(t('configuracion.attachmentsUnavailable'), error?.message || t('configuracion.sanitizationLoadError'), 'warning')
    } finally {
      setEvidencePolicyLoading(false)
    }
  }

  useEffect(() => {
    void loadEvidencePolicy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveEvidencePolicy = async (traceabilityEnabled: boolean) => {
    const previous = evidencePolicy
    const nextPolicy = {
      sanitization_enabled: !traceabilityEnabled,
      traceability_complete_enabled: traceabilityEnabled,
    }
    setEvidencePolicy(nextPolicy)
    setEvidencePolicySaving(true)
    try {
      const data = await updateEvidenceSanitizationPolicy(fetchWithAuth, nextPolicy)
      const normalized = {
        sanitization_enabled: Boolean(data?.sanitization_enabled ?? nextPolicy.sanitization_enabled),
        traceability_complete_enabled: Boolean(data?.traceability_complete_enabled ?? nextPolicy.traceability_complete_enabled),
      }
      setEvidencePolicy(normalized)
      showFeedback(
        'Adjuntos y evidencias',
        normalized.traceability_complete_enabled
          ? 'Modo trazabilidad completa activado para reportes y evidencias.'
          : 'Modo seguro activado: Treseko volvera a ocultar datos sensibles.',
        'success',
      )
    } catch (error: any) {
      setEvidencePolicy(previous)
      showFeedback(t('configuracion.attachmentsUnavailable'), error?.message || t('configuracion.sanitizationSaveError'), 'danger')
    } finally {
      setEvidencePolicySaving(false)
    }
  }

  const saveTimeSettings = async () => {
    setTimeSettingsSaving(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/system/time-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(timeSettings),
      })
      const data = await response.json().catch(() => ({}))
      if (response.status === 404) {
        throw new Error('La API de hora del sistema no esta disponible. Reinicia el backend para cargar la nueva ruta.')
      }
      if (!response.ok) throw new Error(data?.detail || 'No se pudo guardar la hora del sistema.')
      setTimeSettings({ timezone: data?.timezone || timeSettings.timezone })
      showFeedback(t('configuracion.systemTimeTitle'), t('configuracion.systemTimeSaved'), 'success')
    } catch (error: any) {
      showFeedback(t('configuracion.systemTimeTitle'), error?.message || t('configuracion.systemTimeSaveError'), 'danger')
    } finally {
      setTimeSettingsSaving(false)
    }
  }

  const systemTimePreview = (() => {
    try {
      return new Date().toLocaleString(locale === 'en' ? 'en-US' : 'es-ES', {
        timeZone: timeSettings.timezone,
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    } catch {
      return t('configuracion.timezoneInvalid')
    }
  })()

  const saveBranding = async () => {
    if (!brandingDraft.effective_brand_name && !brandingDraft.brand_name) {
      showFeedback(t('configuracion.brandingTitle'), t('configuracion.brandingNameRequired'), 'warning')
      return
    }
    setBrandingSaving(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/system/branding`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand_name: brandingDraft.brand_name || brandingDraft.effective_brand_name,
          logo_url: brandingDraft.logo_url || null,
          enabled: Boolean(brandingDraft.enabled),
          primary_color: brandingDraft.primary_color || brandingDraft.effective_primary_color,
          accent_color: brandingDraft.accent_color || brandingDraft.effective_accent_color,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.detail || 'No se pudo guardar el branding.')
      const normalized = normalizeBrandingState(data)
      setBranding(normalized)
      setBrandingDraft(normalized)
      onBrandingUpdated(normalized)
      showFeedback(t('configuracion.brandingSaved'), t('configuracion.brandingSavedMessage'), 'success')
    } catch (error: any) {
      showFeedback(t('configuracion.brandingTitle'), error?.message || t('configuracion.brandingSaveError'), 'danger')
    } finally {
      setBrandingSaving(false)
    }
  }

  const uploadBrandingLogo = async (file?: File) => {
    if (!file) return
    setBrandingUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetchWithAuth(`${API_BASE}/system/branding/logo`, {
        method: 'POST',
        body: formData,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.detail || 'No se pudo cargar el logo.')
      setBrandingDraft(current => ({ ...current, logo_url: data.logo_url, effective_logo_url: data.logo_url }))
      showFeedback(t('configuracion.logoLoaded'), t('configuracion.logoLoadedMessage'), 'success')
    } catch (error: any) {
      showFeedback(t('configuracion.brandingLogo'), error?.message || t('configuracion.logoLoadError'), 'danger')
    } finally {
      setBrandingUploading(false)
    }
  }

  return (
    <div className="animate__animated animate__fadeIn">
      <BrandingSettings options={{ t, canCustomizeBranding, branding, brandingDraft, setBrandingDraft, canEditPreferences, brandingLoading, brandingSaving, brandingUploading, uploadBrandingLogo, saveBranding }} />
      <Card className="border-0 shadow-sm rounded-4 bg-white p-4 mt-4">
        <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
          <div>
            <h6 className="fw-bold text-dark mb-1 d-flex align-items-center gap-2">
              <Clock size={18} className="text-primary" /> {t('configuracion.systemTimeTitle')}
            </h6>
            <p className="small text-muted mb-0">
              {t('configuracion.systemTimeDesc')}
            </p>
          </div>
          <Badge bg="light" text="dark" className="border">{timeSettings.timezone}</Badge>
        </div>
        <Form onSubmit={(event) => { event.preventDefault(); void saveTimeSettings() }}>
          <Row className="g-3 align-items-end">
            <Col lg={5}>
              <Form.Label className="fw-bold small text-muted">{t('configuracion.systemTimeZone')}</Form.Label>
              <Form.Select
                value={timeSettings.timezone}
                disabled={!canEditPreferences || timeSettingsLoading || timeSettingsSaving}
                onChange={(event) => setTimeSettings({ timezone: event.target.value })}
              >
                {SYSTEM_TIMEZONE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Form.Select>
              <div className="small text-muted mt-1">{t('configuracion.systemTimeHint')}</div>
            </Col>
            <Col lg={4} className="align-self-start">
              <Form.Label className="fw-bold small text-muted">{t('configuracion.systemTimePreview')}</Form.Label>
              <div className="border rounded-3 bg-light px-3 py-2 fw-semibold">{systemTimePreview}</div>
            </Col>
            {canEditPreferences && (
              <Col lg={3} className="text-lg-end align-self-start pt-4">
                <Button variant="primary" type="submit" className="px-4 fw-bold rounded-pill shadow-sm" disabled={timeSettingsLoading || timeSettingsSaving}>
                  <Save size={16} className="me-2" /> {timeSettingsSaving ? t('configuracion.systemTimeSaving') : t('configuracion.systemTimeSave')}
                </Button>
              </Col>
            )}
          </Row>
        </Form>
      </Card>
      <SessionSettingsTab
        sessionConfig={sessionConfig}
        setSessionConfig={setSessionConfig}
        sessionConfigLoading={sessionConfigLoading}
        saveSessionConfig={saveSessionConfig}
        canEditSession={canEditSession}
      />
      {hasSystemFeature('auth.sso') && (
        <ActiveDirectorySettingsTab
          fetchWithAuth={fetchWithAuth}
          showFeedback={showFeedback}
          canAccessCapability={canAccessCapability}
        />
      )}
      {showSsoPreview && (
        <Card className="premium-gate-card border-0 shadow-sm rounded-4 bg-white p-4 mt-4">
          <div className="d-flex justify-content-between align-items-start gap-3">
            <div>
              <h6 className="fw-bold text-dark mb-1 d-flex align-items-center gap-2">
                <Crown size={18} className="text-warning" /> {t('configuracion.ssoPreviewTitle')}
              </h6>
              <p className="small text-muted mb-0">
                {t('configuracion.ssoPreviewDesc')}
              </p>
            </div>
            <Badge bg="warning" text="dark" className="border">{t('configuracion.premiumBadge')}</Badge>
          </div>
        </Card>
      )}
      {canAccessCapability('configuracion.api_keys', 'edit') && (
        <ApiKeyPanel
          apiKeys={apiKeys}
          apiKeysLoading={apiKeysLoading}
          apiKeyName={apiKeyName}
          newApiKeyValue={newApiKeyValue}
          setApiKeyName={setApiKeyName}
          createUserApiKey={createUserApiKey}
          revokeUserApiKey={revokeUserApiKey}
          handleApiKeyEnabledChange={handleApiKeyEnabledChange}
          copyToClipboard={copyToClipboard}
        />
      )}
      <Card className="border-0 shadow-sm rounded-4 bg-white p-4 mt-4">
        <div className="d-flex justify-content-between align-items-start mb-3">
          <div>
            <h6 className="fw-bold text-dark m-0 d-flex align-items-center gap-2">
              <ShieldCheck size={18} className="text-primary" /> {t('configuracion.attachmentsTitle')}
            </h6>
            <span className="small text-muted">{t('configuracion.attachmentsDesc')}</span>
          </div>
          <Badge bg="light" text="dark" className="border">{attachmentConfig.allowed_mime_types?.length || 0} {t('configuracion.attachmentsAllowedTypes')}</Badge>
        </div>
        <div className="border rounded-4 bg-light p-3 mb-4">
          <div className="d-flex flex-wrap justify-content-between align-items-start gap-3">
            <div className="pe-lg-4">
              <div className="fw-bold text-dark">{t('configuracion.attachmentsModeTraceability')}</div>
              <div className="small text-muted">
                {t('configuracion.attachmentsModeTraceabilityDesc')}
              </div>
              {!canManageEvidenceSanitization && (
                <div className="x-small text-muted mt-2">
                  {t('configuracion.attachmentsPermissionNeeded')}
                </div>
              )}
            </div>
            <div className="d-flex align-items-center gap-3">
              <Badge bg={evidencePolicy.traceability_complete_enabled ? 'warning' : 'success'} text={evidencePolicy.traceability_complete_enabled ? 'dark' : undefined} className="border">
                {evidencePolicy.traceability_complete_enabled ? t('configuracion.attachmentsModeTraceabilityBadge') : t('configuracion.attachmentsModeSafe')}
              </Badge>
              <Form.Check
                type="switch"
                id="evidence-traceability-mode"
                label={evidencePolicy.traceability_complete_enabled ? t('configuracion.attachmentsActive') : t('configuracion.attachmentsInactive')}
                checked={Boolean(evidencePolicy.traceability_complete_enabled)}
                disabled={!canManageEvidenceSanitization || evidencePolicyLoading || evidencePolicySaving}
                onChange={(event) => { void saveEvidencePolicy(event.target.checked) }}
              />
            </div>
          </div>
          {evidencePolicy.traceability_complete_enabled && (
            <Alert variant="warning" className="small mb-0 mt-3 py-2">
              {t('configuracion.attachmentsTraceabilityAlert')}
            </Alert>
          )}
        </div>
        <Form onSubmit={(e) => { e.preventDefault(); saveAttachmentConfig(attachmentConfig) }}>
          <Row className="g-3">
            <Col md={12}>
              <Form.Label className="fw-bold small text-muted">{t('configuracion.attachmentsAllowedTypes')}</Form.Label>
              <div className="d-grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                {attachmentMimeGroups.map(group => (
                  <div key={group.label} className="border rounded-3 bg-light p-3">
                    <div className="x-small fw-bold text-muted text-uppercase mb-2">{group.label}</div>
                    <div className="d-flex flex-wrap gap-3">
                      {group.options.map(option => (
                        <Form.Check
                          key={option.value}
                          type="checkbox"
                          id={`mime-${option.value}`}
                          label={option.label}
                          checked={isAttachmentOptionChecked(option)}
                          disabled={!canEditAttachments}
                          onChange={(event) => toggleAttachmentMime(option, event.target.checked)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="x-small text-muted mt-2">
                {t('configuracion.attachmentsVideoHint')}
              </div>
            </Col>
            <Col md={4}>
              <Form.Label className="fw-bold small text-muted">{t('configuracion.attachmentsMaxSize')}</Form.Label>
              <Form.Control type="number" min={1} max={200} value={attachmentConfig.max_file_size_mb} disabled={!canEditAttachments} onChange={(e) => setAttachmentConfig({ ...attachmentConfig, max_file_size_mb: Number(e.target.value) })} />
            </Col>
            <Col md={4}>
              <Form.Label className="fw-bold small text-muted">{t('configuracion.attachmentsMaxPerStep')}</Form.Label>
              <Form.Control type="number" min={1} max={50} value={attachmentConfig.max_files_per_step} disabled={!canEditAttachments} onChange={(e) => setAttachmentConfig({ ...attachmentConfig, max_files_per_step: Number(e.target.value) })} />
            </Col>
            <Col md={4}>
              <Form.Label className="fw-bold small text-muted">{t('configuracion.attachmentsMaxPerSnapshot')}</Form.Label>
              <Form.Control type="number" min={1} max={100} value={attachmentConfig.max_files_per_snapshot} disabled={!canEditAttachments} onChange={(e) => setAttachmentConfig({ ...attachmentConfig, max_files_per_snapshot: Number(e.target.value) })} />
            </Col>
            <Col md={6}>
              <Form.Check type="switch" id="enable-paste" label={t('configuracion.attachmentsEnablePaste')} checked={attachmentConfig.enable_clipboard_paste} disabled={!canEditAttachments} onChange={(e) => setAttachmentConfig({ ...attachmentConfig, enable_clipboard_paste: e.target.checked })} />
            </Col>
            <Col md={6}>
              <Form.Check type="switch" id="require-failure-evidence" label={t('configuracion.attachmentsRequireEvidenceOnFailure')} checked={attachmentConfig.require_evidence_on_failure} disabled={!canEditAttachments} onChange={(e) => setAttachmentConfig({ ...attachmentConfig, require_evidence_on_failure: e.target.checked })} />
            </Col>
          </Row>
          {canEditAttachments && (
            <div className="text-end border-top pt-3 mt-3">
              <Button variant="primary" type="submit" className="px-4 fw-bold rounded-pill shadow-sm" disabled={attachmentConfigLoading}>
                <Save size={16} className="me-2" /> {t('configuracion.attachmentsSave')}
              </Button>
            </div>
          )}
        </Form>
      </Card>
    </div>
  )
}
