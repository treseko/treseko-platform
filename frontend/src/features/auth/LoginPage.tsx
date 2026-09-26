import { useEffect, useState } from 'react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { Button, Card, Form } from 'react-bootstrap'
import { BarChart3, Building2, FileCheck2, Key, ShieldCheck } from 'lucide-react'
import type { AuthMode } from '../../app/types'
import { DEFAULT_BRANDING, type BrandingState } from '../../app/branding'
import { resolveAssetUrl } from '../../shared/utils/assets'
import traceabilityHero from '../../assets/marketing/login-hero-traceability.svg'
import automationHero from '../../assets/marketing/login-hero-automation.svg'
import reportingHero from '../../assets/marketing/login-hero-reporting.svg'
import { useI18n } from '../../i18n'
import { PasswordVisibilityField } from '../../shared/ui/PasswordVisibilityField'

type LoginFormState = {
  email: string
  password: string
  domain: string
}

type LoginPageProps = {
  authMode: AuthMode
  setAuthMode: (mode: AuthMode) => void
  showAdLogin?: boolean
  adMode?: string
  loginForm: LoginFormState
  setLoginForm: Dispatch<SetStateAction<LoginFormState>>
  loginError: string
  loginLoading: boolean
  handleLogin: (event: FormEvent<HTMLFormElement>) => void
  branding?: BrandingState
}

const marketingSlides = [
  {
    image: traceabilityHero,
    eyebrow: 'Trazabilidad',
    title: 'Del caso a la evidencia, todo queda conectado.',
    description: 'Relaciona proyectos, componentes, builds, suites, casos, ejecuciones y adjuntos dentro de un mismo flujo de trabajo.',
    chips: ['Proyectos', 'Builds', 'Evidencia']
  },
  {
    image: automationHero,
    eyebrow: 'Ejecución QA',
    title: 'Pruebas manuales y automatizadas en una sola operación.',
    description: 'Organiza ejecuciones, resultados, evidencias y estados con una experiencia pensada para equipos QA.',
    chips: ['Casos', 'Ejecuciones', 'Resultados']
  },
  {
    image: reportingHero,
    eyebrow: 'Visibilidad',
    title: 'Métricas y reportes para seguir el estado real de calidad.',
    description: 'Consulta avances por build, resultados, bugs y vistas ejecutivas en una plataforma autogestionada.',
    chips: ['Métricas', 'Reportes', 'Bugs']
  }
] as const

const highlights = [
  { icon: FileCheck2, label: 'Evidencia ligada al caso' },
  { icon: BarChart3, label: 'Métricas por build' },
  { icon: ShieldCheck, label: 'Roles y auditoría' }
]

export function LoginPage({
  authMode,
  setAuthMode,
  showAdLogin = false,
  adMode = 'oidc',
  loginForm,
  setLoginForm,
  loginError,
  loginLoading,
  handleLogin,
  branding = DEFAULT_BRANDING
}: LoginPageProps) {
  const { t } = useI18n()
  const [activeSlide, setActiveSlide] = useState(0)
  const activeMarketingSlide = marketingSlides[activeSlide]
  const effectiveAuthMode = showAdLogin ? authMode : 'local'
  const isAdPasswordMode = effectiveAuthMode === 'ad' && adMode === 'ldap'
  const isPremium = branding.edition === 'premium'
  const editionLabel = isPremium ? t('auth.premiumEdition') : t('auth.communityEdition')
  const brandName = branding.effective_brand_name || DEFAULT_BRANDING.effective_brand_name
  const brandLogoUrl = resolveAssetUrl(branding.effective_logo_url) || DEFAULT_BRANDING.effective_logo_url
  const displayBrandName = branding.custom_branding_active ? brandName : `${brandName} ${editionLabel}`

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const rotationId = window.setInterval(() => {
      setActiveSlide((currentSlide) => (currentSlide + 1) % marketingSlides.length)
    }, 5800)

    return () => window.clearInterval(rotationId)
  }, [])

  useEffect(() => {
    if (!showAdLogin && authMode === 'ad') {
      setAuthMode('local')
    }
  }, [authMode, setAuthMode, showAdLogin])

  return (
    <main
      className="login-screen text-dark overflow-x-hidden"
      style={{
        minHeight: '100dvh',
        background: 'linear-gradient(135deg, #f8fafc 0%, #eef4ff 50%, #f6fbf8 100%)'
      }}
    >
      <section className="login-layout d-flex align-items-center justify-content-center px-3 px-lg-5 py-3 py-lg-4">
        <div className="w-100" style={{ maxWidth: 1180 }}>
          <div className="row g-4 align-items-center">
            <div className="col-12 col-lg-7">
              <div className="login-brand d-flex align-items-center gap-3 mb-3">
                <div className="login-brand-mark shadow-sm" aria-hidden="true">
                  <img src={brandLogoUrl} alt="" width="46" height="46" className="login-brand-icon" onError={(event) => { event.currentTarget.src = DEFAULT_BRANDING.effective_logo_url }} />
                </div>
                <div>
                  <div className="fw-bold fs-4">{displayBrandName}</div>
                  <div className="text-muted small">{t('auth.qaEnvironment')} · {editionLabel}</div>
                </div>
              </div>

              <h1 className="fw-bold mb-3" style={{ fontSize: 'clamp(2rem, 4vw, 3.6rem)', lineHeight: 1 }}>
                {t('auth.visibleQuality')}
              </h1>
              <p className="text-secondary fs-5 mb-4" style={{ maxWidth: 650 }}>
                {isPremium ? t('auth.premiumQualityDescription') : t('auth.qualityDescription')}
              </p>

              <div className="position-relative mb-4" style={{ maxWidth: 720 }}>
                <div className="bg-white rounded-4 shadow-sm border p-2 p-md-3">
                  <div
                    className="login-marketing-visual position-relative overflow-hidden rounded-4 border bg-white"
                  >
                    <img
                      src={activeMarketingSlide.image}
                      alt={activeMarketingSlide.title}
                      className="d-block w-100 h-100"
                      width="720"
                      height="520"
                      fetchPriority="high"
                      style={{ objectFit: 'contain' }}
                    />
                    <div className="position-absolute top-0 start-0 m-2 m-md-3 d-inline-flex align-items-center gap-2 rounded-pill border px-3 py-2 small fw-bold shadow-sm" style={{ background: 'rgba(255, 255, 255, 0.94)' }}>
                      <span className="rounded-circle bg-primary" style={{ width: 8, height: 8 }} />
                      {activeMarketingSlide.eyebrow}
                    </div>
                  </div>

                  <div className="login-slide-copy d-flex flex-column flex-md-row justify-content-between gap-3 pt-3" aria-live="polite">
                    <div>
                      <h2 className="h5 fw-bold mb-1">{activeMarketingSlide.title}</h2>
                      <p className="small text-secondary mb-2" style={{ maxWidth: 560 }}>
                        {activeMarketingSlide.description}
                      </p>
                      <div className="d-flex flex-wrap gap-2">
                        {activeMarketingSlide.chips.map((chip) => (
                          <span key={chip} className="badge rounded-pill bg-primary bg-opacity-10 text-primary border border-primary-subtle px-3 py-2">
                            {chip}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="d-flex align-items-start gap-2 pt-1 flex-shrink-0">
                      {marketingSlides.map((slide, index) => (
                        <button
                          key={slide.title}
                          type="button"
                          aria-label={`Ver ${slide.eyebrow}`}
                          className={`border-0 rounded-pill p-0 ${index === activeSlide ? 'bg-primary' : 'bg-secondary'}`}
                          style={{
                            width: index === activeSlide ? 24 : 9,
                            height: 9,
                            opacity: index === activeSlide ? 1 : 0.35,
                            transition: 'width 220ms ease, opacity 220ms ease, background-color 220ms ease'
                          }}
                          onClick={() => setActiveSlide(index)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="d-none d-md-flex flex-wrap gap-2">
                {highlights.map(({ icon: Icon, label }) => (
                  <div key={label} className="d-inline-flex align-items-center gap-2 bg-white border rounded-pill px-3 py-2 shadow-sm small fw-bold">
                    <Icon size={16} className="text-primary" />
                    {label}
                  </div>
                ))}
              </div>
            </div>

            <div className="col-12 col-lg-5">
              <Card className="border-0 shadow-lg rounded-4 overflow-hidden bg-white">
                <Card.Body className="p-4 p-xl-5">
                  <div className="d-lg-none d-flex align-items-center gap-2 mb-3">
                    <span className="login-brand-mark login-brand-mark-sm" aria-hidden="true">
                      <img src={brandLogoUrl} alt="" width="34" height="34" className="login-brand-icon" onError={(event) => { event.currentTarget.src = DEFAULT_BRANDING.effective_logo_url }} />
                    </span>
                    <span className="fw-bold fs-5">{displayBrandName}</span>
                  </div>

                  <div className="mb-4">
                    <div className="text-primary fw-bold small text-uppercase mb-2">{t('auth.qaEnvironment')}</div>
                    <h2 className="fw-bold text-dark mb-2" style={{ lineHeight: 1.08 }}>
                      {t('auth.login')}
                    </h2>
                    <p className="text-muted small mb-0">
                      {t('auth.qaEditionDescription')}
                    </p>
                  </div>

                  <div className="row g-2 mb-4">
                    <div className="col-6">
                      <div className="border rounded-3 p-3 h-100 bg-light">
                        <div className="fw-bold small text-dark">{editionLabel}</div>
                        <div className="text-muted app-label">{isPremium ? t('auth.activeLicense') : t('auth.openEdition')}</div>
                      </div>
                    </div>
                    <div className="col-6">
                      <div className="border rounded-3 p-3 h-100 bg-light">
                        <div className="fw-bold small text-dark">{t('auth.includedCapabilities')}</div>
                        <div className="text-muted app-label">{isPremium ? t('auth.premiumCapabilitiesDescription') : t('auth.includedCapabilitiesDescription')}</div>
                      </div>
                    </div>
                  </div>

                  {showAdLogin && (
                    <div className="d-flex gap-2 mb-4 p-1 bg-light border rounded-3">
                      <Button variant={authMode === 'local' ? 'primary' : 'light'} className="flex-fill fw-bold border-0" onClick={() => setAuthMode('local')} type="button">
                        <Key size={16} className="me-2" /> {t('auth.local')}
                      </Button>
                      <Button variant={authMode === 'ad' ? 'primary' : 'light'} className="flex-fill fw-bold border-0" onClick={() => setAuthMode('ad')} type="button">
                        <Building2 size={16} className="me-2" /> {t('auth.activeDirectory')}
                      </Button>
                    </div>
                  )}

                  <Form onSubmit={handleLogin}>
                    {effectiveAuthMode === 'local' || isAdPasswordMode ? (
                      <>
                        <Form.Group className="mb-3">
                          <Form.Label className="small fw-bold text-muted">{isAdPasswordMode ? t('auth.corporateUser') : t('auth.email')}</Form.Label>
                          <Form.Control name="email" aria-label={isAdPasswordMode ? t('auth.corporateUser') : t('auth.email')} autoComplete={isAdPasswordMode ? 'username' : 'email'} spellCheck={false} type={isAdPasswordMode ? 'text' : 'email'} value={loginForm.email} onChange={(event) => setLoginForm({ ...loginForm, email: event.target.value })} className="bg-light border-light-subtle" placeholder={isAdPasswordMode ? t('auth.corporateUserPlaceholder') : t('auth.emailPlaceholder')} required />
                        </Form.Group>
                        <Form.Group className="mb-3">
                          <Form.Label className="small fw-bold text-muted">{t('auth.password')}</Form.Label>
                          <PasswordVisibilityField name="password" aria-label={t('auth.password')} autoComplete="current-password" value={loginForm.password} onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })} className="bg-light border-light-subtle" placeholder={t('auth.passwordPlaceholder')} required showLabel={t('common.showPassword')} hideLabel={t('common.hidePassword')} />
                        </Form.Group>
                      </>
                    ) : (
                      <div className="small text-muted bg-light border rounded-3 p-3 mb-3">
                        {t('auth.corporateRedirect')}
                      </div>
                    )}

                    {loginError && <div className="small text-danger bg-danger bg-opacity-10 border border-danger-subtle rounded-3 p-2 mb-3" role="alert" aria-live="polite">{loginError}</div>}

                    <Button type="submit" variant="primary" className="w-100 fw-bold py-2 rounded-3 shadow-sm" disabled={loginLoading}>
                      {loginLoading ? t('auth.validating') : (effectiveAuthMode === 'ad' ? t('auth.loginWithAd') : t('auth.enterPlatform'))}
                    </Button>
                  </Form>

                  <div className="small text-muted mt-4">{t('auth.protectedSession')}</div>
                </Card.Body>
              </Card>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
