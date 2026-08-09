import { Badge, Button, Card, Col, Form, Row } from 'react-bootstrap'
import { Crown, Image as ImageIcon, Save } from 'lucide-react'
import { DEFAULT_BRANDING } from '../../../../app/branding'
import { resolveAssetUrl } from '../../../../shared/utils/assets'

export function BrandingSettings({ options }: { options: any }) {
  const { t, canCustomizeBranding, branding, brandingDraft, setBrandingDraft, canEditPreferences, brandingLoading, brandingSaving, brandingUploading, uploadBrandingLogo, saveBranding } = options
  return (
    <>
{canCustomizeBranding ? (
  <Card className="branding-settings-card border-0 shadow-sm rounded-4 bg-white p-3">
    <div className="d-flex justify-content-between align-items-start gap-3 mb-2">
      <div>
        <h6 className="fw-bold text-dark mb-1 d-flex align-items-center gap-2">
          <ImageIcon size={18} className="text-primary" /> {t('configuracion.brandingTitle')}
        </h6>
        <p className="small text-muted mb-0">{t('configuracion.brandingDesc')}</p>
      </div>
      <Badge bg={branding.custom_branding_active ? 'success' : 'light'} text={branding.custom_branding_active ? undefined : 'dark'} className="border">
        {branding.custom_branding_active ? t('configuracion.brandingActive') : t('configuracion.brandingInactive')}
      </Badge>
    </div>
    <Row className="g-3 align-items-start">
      <Col lg={8}>
        <Form onSubmit={(event) => { event.preventDefault(); void saveBranding() }}>
          <Row className="g-2 align-items-end">
            <Col md={6}>
              <Form.Label className="fw-bold small text-muted">{t('configuracion.brandingName')}</Form.Label>
              <Form.Control name="a11y-brandingsettingstsx-29" aria-label="Campo de formulario" type="text" value={brandingDraft.brand_name || ''} disabled={!canEditPreferences || brandingLoading || brandingSaving} onChange={(event) => setBrandingDraft(current => ({ ...current, brand_name: event.target.value, effective_brand_name: event.target.value }))} maxLength={80} className="bg-light border-0 shadow-sm text-dark font-sans" />
            </Col>
            <Col md={3}>
              <Form.Label className="fw-bold small text-muted">{t('configuracion.brandingPrimaryColor')}</Form.Label><Form.Control name="a11y-brandingsettingstsx-32" aria-label="Campo de formulario" type="color" value={brandingDraft.primary_color || brandingDraft.effective_primary_color || '#172033'} disabled={!canEditPreferences || brandingLoading || brandingSaving} onChange={(event) => setBrandingDraft(current => ({ ...current, primary_color: event.target.value, effective_primary_color: event.target.value }))} />
            </Col>
            <Col md={3}>
              <Form.Label className="fw-bold small text-muted">{t('configuracion.brandingAccentColor')}</Form.Label><Form.Control name="a11y-brandingsettingstsx-35" aria-label="Campo de formulario" type="color" value={brandingDraft.accent_color || brandingDraft.effective_accent_color || '#1677ff'} disabled={!canEditPreferences || brandingLoading || brandingSaving} onChange={(event) => setBrandingDraft(current => ({ ...current, accent_color: event.target.value, effective_accent_color: event.target.value }))} />
            </Col>
          </Row>
          <Form.Group className="mt-2 mb-2">
            <Form.Label className="fw-bold small text-muted">{t('configuracion.brandingLogo')}</Form.Label>
            <div className="d-flex flex-wrap align-items-center gap-2">
              <Form.Control name="a11y-brandingsettingstsx-41" aria-label="Campo de formulario"
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
                {t('configuracion.brandingUseTresekoIcon')}
              </Button>
            </div>
            <div className="small text-muted mt-1">{brandingUploading ? t('configuracion.brandingUploading') : t('configuracion.brandingUploadHint')}</div>
          </Form.Group>
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 border-top pt-2 mt-2">
            <Form.Check type="switch" id="custom-branding-enabled" label={t('configuracion.brandingEnable')} checked={Boolean(brandingDraft.enabled)} disabled={!canEditPreferences || brandingLoading || brandingSaving} onChange={(event) => setBrandingDraft(current => ({ ...current, enabled: event.target.checked }))} />
            {canEditPreferences && (
              <Button variant="primary" type="submit" className="px-5 fw-bold rounded-pill shadow-sm" disabled={brandingSaving || brandingUploading || brandingLoading}>
                <Save size={16} className="me-2" /> {brandingSaving ? t('configuracion.brandingSaving') : t('configuracion.brandingSave')}
              </Button>
            )}
          </div>
        </Form>
      </Col>
      <Col lg={4}>
        <div className="branding-preview-panel border rounded-4 bg-light p-3">
          <div className="small fw-bold text-muted text-uppercase mb-2">{t('configuracion.brandingPreview')}</div>
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
          <div className="small text-muted mt-2">{t('configuracion.brandingDisabledHint')}</div>
        </div>
      </Col>
    </Row>
  </Card>
) : (
  <Card className="premium-gate-card border-0 shadow-sm rounded-4 bg-white p-4">
    <div className="d-flex justify-content-between align-items-start gap-3">
      <div>
        <h6 className="fw-bold text-dark mb-1 d-flex align-items-center gap-2">
          <Crown size={18} className="text-warning" /> {t('configuracion.brandingPremiumTitle')}
        </h6>
        <p className="small text-muted mb-0">
          {t('configuracion.brandingPremiumDesc')}
        </p>
      </div>
      <Badge bg="warning" text="dark" className="border">{t('configuracion.premiumBadge')}</Badge>
    </div>
  </Card>
)}

    </>
  )
}
