import { useEffect, useState } from 'react'
import { Badge, Button, Card, Col, Form, Row } from 'react-bootstrap'
import { Clock, Crown, Image as ImageIcon, Save } from 'lucide-react'
import { API_BASE } from '../../../../app/constants'
import { DEFAULT_BRANDING, normalizeBrandingState, type BrandingState } from '../../../../app/branding'
import { resolveAssetUrl } from '../../../../shared/utils/assets'
import { ApiKeyPanel } from '../ApiKeyPanel'
import { SessionSettingsTab } from './SessionSettingsTab'
import { ActiveDirectorySettingsTab } from './ActiveDirectorySettingsTab'
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
  const canEditPreferences = canAccessCapability('configuracion.preferencias', 'edit')
  const canEditSession = canAccessCapability('configuracion.sesion', 'edit')
  const canEditAttachments = canAccessCapability('configuracion.adjuntos', 'edit')
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
      showFeedback('Branding', error?.message || 'No se pudo cargar el branding.', 'warning')
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
      showFeedback('Hora del sistema', error?.message || 'No se pudo cargar la configuracion horaria.', 'warning')
    } finally {
      setTimeSettingsLoading(false)
    }
  }

  useEffect(() => {
    void loadTimeSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      showFeedback('Hora del sistema', 'Zona horaria guardada. El Dashboard usara esta zona para calcular hoy.', 'success')
    } catch (error: any) {
      showFeedback('Hora del sistema', error?.message || 'No se pudo guardar la configuracion horaria.', 'danger')
    } finally {
      setTimeSettingsSaving(false)
    }
  }

  const systemTimePreview = (() => {
    try {
      return new Date().toLocaleString('es-AR', {
        timeZone: timeSettings.timezone,
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    } catch {
      return 'Zona horaria invalida'
    }
  })()

  const saveBranding = async () => {
    if (!brandingDraft.effective_brand_name && !brandingDraft.brand_name) {
      showFeedback('Branding', 'Ingresa un nombre de marca.', 'warning')
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
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.detail || 'No se pudo guardar el branding.')
      const normalized = normalizeBrandingState(data)
      setBranding(normalized)
      setBrandingDraft(normalized)
      onBrandingUpdated(normalized)
      showFeedback('Branding guardado', 'El branding personalizado fue actualizado.', 'success')
    } catch (error: any) {
      showFeedback('Branding', error?.message || 'No se pudo guardar el branding.', 'danger')
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
      showFeedback('Logo cargado', 'Revisa la vista previa y guarda el branding.', 'success')
    } catch (error: any) {
      showFeedback('Logo de branding', error?.message || 'No se pudo cargar el logo.', 'danger')
    } finally {
      setBrandingUploading(false)
    }
  }

  return (
    <div className="animate__animated animate__fadeIn">
      {canCustomizeBranding ? (
        <Card className="border-0 shadow-sm rounded-4 bg-white p-4">
          <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
            <div>
              <h6 className="fw-bold text-dark mb-1 d-flex align-items-center gap-2">
                <ImageIcon size={18} className="text-primary" /> Branding personalizado
              </h6>
              <p className="small text-muted mb-0">Define el nombre e ícono visibles en login, sidebar y navegación móvil.</p>
            </div>
            <Badge bg={branding.custom_branding_active ? 'success' : 'light'} text={branding.custom_branding_active ? undefined : 'dark'} className="border">
              {branding.custom_branding_active ? 'Activo' : 'Inactivo'}
            </Badge>
          </div>
          <Row className="g-4 align-items-stretch">
            <Col lg={7}>
              <Form onSubmit={(event) => { event.preventDefault(); void saveBranding() }}>
                <Form.Group className="mb-3">
                  <Form.Label className="fw-bold small text-muted">Nombre de marca</Form.Label>
                  <Form.Control
                    type="text"
                    value={brandingDraft.brand_name || ''}
                    disabled={!canEditPreferences || brandingLoading || brandingSaving}
                    onChange={(event) => setBrandingDraft(current => ({ ...current, brand_name: event.target.value, effective_brand_name: event.target.value }))}
                    maxLength={80}
                    className="bg-light border-0 shadow-sm text-dark font-sans"
                  />
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label className="fw-bold small text-muted">Ícono / logo</Form.Label>
                  <div className="d-flex flex-wrap align-items-center gap-2">
                    <Form.Control
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                      disabled={!canEditPreferences || brandingUploading || brandingSaving}
                      onChange={(event) => {
                        const input = event.currentTarget as HTMLInputElement
                        const file = input.files?.[0]
                        void uploadBrandingLogo(file)
                        input.value = ''
                      }}
                      className="bg-light border-0 shadow-sm text-dark font-sans"
                      style={{ maxWidth: 360 }}
                    />
                    <Button variant="outline-secondary" disabled={!canEditPreferences || brandingUploading || brandingSaving} onClick={() => setBrandingDraft(current => ({ ...current, logo_url: null, effective_logo_url: DEFAULT_BRANDING.effective_logo_url }))}>
                      Usar ícono Treseko
                    </Button>
                  </div>
                  <div className="small text-muted mt-2">{brandingUploading ? 'Cargando logo...' : 'PNG, JPG, WEBP o GIF. Máximo 2 MB.'}</div>
                </Form.Group>
                <Form.Check
                  type="switch"
                  id="custom-branding-enabled"
                  label="Activar branding personalizado"
                  checked={Boolean(brandingDraft.enabled)}
                  disabled={!canEditPreferences || brandingLoading || brandingSaving}
                  onChange={(event) => setBrandingDraft(current => ({ ...current, enabled: event.target.checked }))}
                />
                {canEditPreferences && (
                  <div className="text-end border-top pt-3 mt-3">
                    <Button variant="primary" type="submit" className="px-5 fw-bold rounded-pill shadow-sm" disabled={brandingSaving || brandingUploading || brandingLoading}>
                      <Save size={16} className="me-2" /> {brandingSaving ? 'Guardando...' : 'Guardar branding'}
                    </Button>
                  </div>
                )}
              </Form>
            </Col>
            <Col lg={5}>
              <div className="border rounded-4 bg-light p-3 h-100">
                <div className="small fw-bold text-muted text-uppercase mb-3">Vista previa</div>
                <div className="bg-dark text-white rounded-4 p-3 shadow-sm">
                  <div className="d-flex align-items-center gap-3">
                    <span className="app-brand-mark flex-shrink-0" aria-hidden="true">
                      <img
                        src={resolveAssetUrl(brandingDraft.logo_url || brandingDraft.effective_logo_url) || DEFAULT_BRANDING.effective_logo_url}
                        alt=""
                        className="app-brand-icon"
                        onError={(event) => { event.currentTarget.src = DEFAULT_BRANDING.effective_logo_url }}
                      />
                    </span>
                    <div className="min-w-0">
                      <div className="fw-bold fs-5 tracking-tight text-white lh-sm text-truncate">{brandingDraft.brand_name || DEFAULT_BRANDING.effective_brand_name}</div>
                      <div className="app-edition-text text-truncate">Premium</div>
                    </div>
                  </div>
                </div>
                <div className="small text-muted mt-3">Si desactivas el switch, se conserva la configuración pero se vuelve a mostrar Treseko.</div>
              </div>
            </Col>
          </Row>
        </Card>
      ) : (
        <Card className="premium-gate-card border-0 shadow-sm rounded-4 bg-white p-4">
          <div className="d-flex justify-content-between align-items-start gap-3">
            <div>
              <h6 className="fw-bold text-dark mb-1 d-flex align-items-center gap-2">
                <Crown size={18} className="text-warning" /> Branding personalizado
              </h6>
              <p className="small text-muted mb-0">
                Personaliza el nombre y el ícono visible de Treseko con una licencia Premium que incluya branding personalizado.
              </p>
            </div>
            <Badge bg="warning" text="dark" className="border">Premium</Badge>
          </div>
        </Card>
      )}
      <Card className="border-0 shadow-sm rounded-4 bg-white p-4 mt-4">
        <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
          <div>
            <h6 className="fw-bold text-dark mb-1 d-flex align-items-center gap-2">
              <Clock size={18} className="text-primary" /> Hora del sistema
            </h6>
            <p className="small text-muted mb-0">
              Define la zona horaria usada por metricas como hoy, vencimientos y ventanas operativas.
            </p>
          </div>
          <Badge bg="light" text="dark" className="border">{timeSettings.timezone}</Badge>
        </div>
        <Form onSubmit={(event) => { event.preventDefault(); void saveTimeSettings() }}>
          <Row className="g-3 align-items-end">
            <Col lg={5}>
              <Form.Label className="fw-bold small text-muted">Zona horaria</Form.Label>
              <Form.Select
                value={timeSettings.timezone}
                disabled={!canEditPreferences || timeSettingsLoading || timeSettingsSaving}
                onChange={(event) => setTimeSettings({ timezone: event.target.value })}
              >
                {SYSTEM_TIMEZONE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Form.Select>
              <div className="small text-muted mt-1">Se guarda en el sistema. No depende del reloj del navegador.</div>
            </Col>
            <Col lg={4}>
              <Form.Label className="fw-bold small text-muted">Hora actual de referencia</Form.Label>
              <div className="border rounded-3 bg-light px-3 py-2 fw-semibold">{systemTimePreview}</div>
            </Col>
            {canEditPreferences && (
              <Col lg={3} className="text-lg-end">
                <Button variant="primary" type="submit" className="px-4 fw-bold rounded-pill shadow-sm" disabled={timeSettingsLoading || timeSettingsSaving}>
                  <Save size={16} className="me-2" /> {timeSettingsSaving ? 'Guardando...' : 'Guardar hora'}
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
                <Crown size={18} className="text-warning" /> Active Directory / OIDC
              </h6>
              <p className="small text-muted mb-0">
                Login empresarial con Microsoft Entra ID, AD FS u OIDC, aprovisionamiento controlado y mapeo de grupos.
              </p>
            </div>
            <Badge bg="warning" text="dark" className="border">Premium</Badge>
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
            <h6 className="fw-bold text-dark m-0">Adjuntos y evidencias</h6>
            <span className="small text-muted">Límites globales para referencias de pasos y evidencias de ejecución.</span>
          </div>
          <Badge bg="light" text="dark" className="border">{attachmentConfig.allowed_mime_types?.length || 0} tipos</Badge>
        </div>
        <Form onSubmit={(e) => { e.preventDefault(); saveAttachmentConfig(attachmentConfig) }}>
          <Row className="g-3">
            <Col md={12}>
              <Form.Label className="fw-bold small text-muted">Tipos permitidos</Form.Label>
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
                Videos soportados para vista previa en navegador: MP4 y WEBM.
              </div>
            </Col>
            <Col md={4}>
              <Form.Label className="fw-bold small text-muted">Tamaño máximo (MB)</Form.Label>
              <Form.Control type="number" min={1} max={200} value={attachmentConfig.max_file_size_mb} disabled={!canEditAttachments} onChange={(e) => setAttachmentConfig({ ...attachmentConfig, max_file_size_mb: Number(e.target.value) })} />
            </Col>
            <Col md={4}>
              <Form.Label className="fw-bold small text-muted">Máximo por paso</Form.Label>
              <Form.Control type="number" min={1} max={50} value={attachmentConfig.max_files_per_step} disabled={!canEditAttachments} onChange={(e) => setAttachmentConfig({ ...attachmentConfig, max_files_per_step: Number(e.target.value) })} />
            </Col>
            <Col md={4}>
              <Form.Label className="fw-bold small text-muted">Máximo por snapshot</Form.Label>
              <Form.Control type="number" min={1} max={100} value={attachmentConfig.max_files_per_snapshot} disabled={!canEditAttachments} onChange={(e) => setAttachmentConfig({ ...attachmentConfig, max_files_per_snapshot: Number(e.target.value) })} />
            </Col>
            <Col md={6}>
              <Form.Check type="switch" id="enable-paste" label="Permitir Ctrl + V para imágenes" checked={attachmentConfig.enable_clipboard_paste} disabled={!canEditAttachments} onChange={(e) => setAttachmentConfig({ ...attachmentConfig, enable_clipboard_paste: e.target.checked })} />
            </Col>
            <Col md={6}>
              <Form.Check type="switch" id="require-failure-evidence" label="Requerir evidencia al fallar" checked={attachmentConfig.require_evidence_on_failure} disabled={!canEditAttachments} onChange={(e) => setAttachmentConfig({ ...attachmentConfig, require_evidence_on_failure: e.target.checked })} />
            </Col>
          </Row>
          {canEditAttachments && (
            <div className="text-end border-top pt-3 mt-3">
              <Button variant="primary" type="submit" className="px-4 fw-bold rounded-pill shadow-sm" disabled={attachmentConfigLoading}>
                <Save size={16} className="me-2" /> Guardar adjuntos
              </Button>
            </div>
          )}
        </Form>
      </Card>
    </div>
  )
}
