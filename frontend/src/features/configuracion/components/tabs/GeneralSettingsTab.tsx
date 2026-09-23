import { useEffect, useState } from 'react'
import { Badge, Button, Card, Col, Form, Row } from 'react-bootstrap'
import { Clock, Crown, Image as ImageIcon, Save } from 'lucide-react'
import { API_BASE } from '../../../../app/constants'
import { DEFAULT_BRANDING, normalizeBrandingState, type BrandingState } from '../../../../app/branding'
import { resolveAssetUrl } from '../../../../shared/utils/assets'
import { useI18n } from '../../../../i18n'
import { BrandingSettings } from './BrandingSettings'
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
  [key: string]: any
  showFeedback: (title: string, message: string, variant?: string) => void
  sessionConfig?: any
  setSessionConfig?: (config: any) => void
  sessionConfigLoading?: boolean
  saveSessionConfig?: (config: any) => void
  canAccessCapability: (capabilityId: any, level?: any) => boolean
  hasSystemFeature: (featureId: string) => boolean
  apiKeys?: any[]
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  onBrandingUpdated: (branding: BrandingState) => void
}

export function GeneralSettingsTab({
  showFeedback,
  canAccessCapability,
  hasSystemFeature,
  fetchWithAuth,
  onBrandingUpdated,
}: Props) {
  const { t, locale } = useI18n()
  const canEditPreferences = canAccessCapability('configuracion.preferencias', 'edit')
  const canReadPreferences = canAccessCapability('configuracion.preferencias', 'read')
  const canCustomizeBranding = hasSystemFeature('branding.custom') && canReadPreferences

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
      showFeedback(t('configuracion.brandingTitle'), error?.message || t('configuracion.brandingLoadError'), 'warning')
    } finally {
      setBrandingLoading(false)
    }
  }
  useEffect(() => {
    if (canReadPreferences) void loadBranding()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReadPreferences])
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
              <Form.Select name="a11y-generalsettingstabtsx-308" aria-label="Campo de formulario"
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

    </div>
  )
}
