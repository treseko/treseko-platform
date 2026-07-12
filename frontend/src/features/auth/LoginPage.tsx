import { useEffect, useState } from 'react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { Button, Card, Form } from 'react-bootstrap'
import { BarChart3, Building2, FileCheck2, Key, Lock, ShieldCheck } from 'lucide-react'
import { DEV_ADMIN_EMAIL, IS_DEV_ENV } from '../../app/constants'
import type { AuthMode } from '../../app/types'
import { DEFAULT_BRANDING, type BrandingState } from '../../app/branding'
import { resolveAssetUrl } from '../../shared/utils/assets'
import traceabilityHero from '../../assets/marketing/login-hero-traceability.svg'
import automationHero from '../../assets/marketing/login-hero-automation.svg'
import reportingHero from '../../assets/marketing/login-hero-reporting.svg'

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
    eyebrow: 'Ejecucion QA',
    title: 'Pruebas manuales y automatizadas en una sola operacion.',
    description: 'Organiza corridas, resultados, evidencias y estados de ejecucion con una experiencia pensada para equipos QA.',
    chips: ['Casos', 'Ejecuciones', 'Resultados']
  },
  {
    image: reportingHero,
    eyebrow: 'Visibilidad',
    title: 'Metricas y reportes para seguir el estado real de calidad.',
    description: 'Consulta avances por build, resultados, bugs y vistas ejecutivas en una edicion comunitaria autogestionada.',
    chips: ['Metricas', 'Reportes', 'Bugs']
  }
] as const

const highlights = [
  { icon: FileCheck2, label: 'Evidencia ligada al caso' },
  { icon: BarChart3, label: 'Metricas por build' },
  { icon: ShieldCheck, label: 'Roles y auditoria base' }
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
  const [activeSlide, setActiveSlide] = useState(0)
  const activeMarketingSlide = marketingSlides[activeSlide]
  const effectiveAuthMode = showAdLogin ? authMode : 'local'
  const isAdPasswordMode = effectiveAuthMode === 'ad' && adMode === 'ldap'
  const editionLabel = branding.edition === 'premium' ? 'Premium' : 'Community'
  const brandName = branding.effective_brand_name || DEFAULT_BRANDING.effective_brand_name
  const brandLogoUrl = resolveAssetUrl(branding.effective_logo_url) || DEFAULT_BRANDING.effective_logo_url
  const displayBrandName = branding.custom_branding_active ? brandName : `${brandName} ${editionLabel}`

  useEffect(() => {
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
      className="login-screen text-dark overflow-auto"
      style={{
        minHeight: '100dvh',
        background: 'linear-gradient(135deg, #f8fafc 0%, #eef4ff 50%, #f6fbf8 100%)'
      }}
    >
      <section className="d-flex align-items-center justify-content-center px-3 px-lg-5 py-4" style={{ minHeight: '100dvh' }}>
        <div className="w-100" style={{ maxWidth: 1180 }}>
          <div className="row g-4 align-items-center">
            <div className="col-12 col-lg-7">
              <div className="login-brand d-flex align-items-center gap-3 mb-3">
                <div className="login-brand-mark shadow-sm" aria-hidden="true">
                  <img src={brandLogoUrl} alt="" className="login-brand-icon" onError={(event) => { event.currentTarget.src = DEFAULT_BRANDING.effective_logo_url }} />
                </div>
                <div>
                  <div className="fw-bold fs-4">{displayBrandName}</div>
                  <div className="text-muted small">Entorno QA {editionLabel}</div>
                </div>
              </div>

              <h1 className="fw-bold mb-3" style={{ fontSize: 'clamp(2rem, 4vw, 3.6rem)', lineHeight: 1 }}>
                Calidad visible antes de cada entrega.
              </h1>
              <p className="text-secondary fs-5 mb-4" style={{ maxWidth: 650 }}>
                Gestiona proyectos, builds, ejecuciones, evidencias y reportes desde una edicion abierta,
                limitada a capacidades base y pensada para adopcion inicial.
              </p>

              <div className="position-relative mb-4" style={{ maxWidth: 720 }}>
                <div className="bg-white rounded-4 shadow-sm border p-2 p-md-3">
                  <div
                    className="position-relative overflow-hidden rounded-4 border bg-white"
                    style={{ aspectRatio: '16 / 10', minHeight: 190 }}
                  >
                    <img
                      src={activeMarketingSlide.image}
                      alt={activeMarketingSlide.title}
                      className="d-block w-100 h-100"
                      style={{ objectFit: 'contain', transition: 'opacity 600ms ease' }}
                    />
                    <div className="position-absolute top-0 start-0 m-2 m-md-3 d-inline-flex align-items-center gap-2 rounded-pill border px-3 py-2 small fw-bold shadow-sm" style={{ background: 'rgba(255, 255, 255, 0.94)' }}>
                      <span className="rounded-circle bg-primary" style={{ width: 8, height: 8 }} />
                      {activeMarketingSlide.eyebrow}
                    </div>
                  </div>

                  <div className="d-flex flex-column flex-md-row justify-content-between gap-3 pt-3" aria-live="polite">
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
                            transition: 'all 220ms ease'
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
                      <img src={brandLogoUrl} alt="" className="login-brand-icon" onError={(event) => { event.currentTarget.src = DEFAULT_BRANDING.effective_logo_url }} />
                    </span>
                    <span className="fw-bold fs-5">{displayBrandName}</span>
                  </div>

                  <div className="mb-4">
                    <div className="text-primary fw-bold small text-uppercase mb-2">Entorno QA</div>
                    <h2 className="fw-bold text-dark mb-2" style={{ lineHeight: 1.08 }}>
                      Ingresa a tu entorno de calidad.
                    </h2>
                    <p className="text-muted small mb-0">
                      Accede a proyectos, builds, ejecuciones, evidencias y reportes desde una sesion segura.
                    </p>
                  </div>

                  <div className="row g-2 mb-4">
                    <div className="col-6">
                      <div className="border rounded-3 p-3 h-100 bg-light">
                        <div className="fw-bold small text-dark">{editionLabel} Edition</div>
                        <div className="text-muted" style={{ fontSize: '0.78rem' }}>{branding.edition === 'premium' ? 'Licencia activa para capacidades avanzadas.' : 'Edicion abierta para adopcion inicial y operacion base.'}</div>
                      </div>
                    </div>
                    <div className="col-6">
                      <div className="border rounded-3 p-3 h-100 bg-light">
                        <div className="fw-bold small text-dark">Capacidades incluidas</div>
                        <div className="text-muted" style={{ fontSize: '0.78rem' }}>Gestion QA, ejecuciones, evidencia y metricas base.</div>
                      </div>
                    </div>
                  </div>

                  {showAdLogin && (
                    <div className="d-flex gap-2 mb-4 p-1 bg-light border rounded-3">
                      <Button variant={authMode === 'local' ? 'primary' : 'light'} className="flex-fill fw-bold border-0" onClick={() => setAuthMode('local')} type="button">
                        <Key size={16} className="me-2" /> Local
                      </Button>
                      <Button variant={authMode === 'ad' ? 'primary' : 'light'} className="flex-fill fw-bold border-0" onClick={() => setAuthMode('ad')} type="button">
                        <Building2 size={16} className="me-2" /> AD
                      </Button>
                    </div>
                  )}

                  <Form onSubmit={handleLogin}>
                    {effectiveAuthMode === 'local' || isAdPasswordMode ? (
                      <>
                        <Form.Group className="mb-3">
                          <Form.Label className="small fw-bold text-muted">{isAdPasswordMode ? 'Usuario corporativo' : 'Email'}</Form.Label>
                          <Form.Control type={isAdPasswordMode ? 'text' : 'email'} value={loginForm.email} onChange={(event) => setLoginForm({ ...loginForm, email: event.target.value })} className="bg-light border-light-subtle" placeholder={isAdPasswordMode ? 'usuario o usuario@empresa.com' : 'usuario@empresa.com'} required />
                        </Form.Group>
                        <Form.Group className="mb-3">
                          <Form.Label className="small fw-bold text-muted">Contrasena</Form.Label>
                          <Form.Control type="password" value={loginForm.password} onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })} className="bg-light border-light-subtle" placeholder="Contrasena" required />
                        </Form.Group>
                      </>
                    ) : (
                      <div className="small text-muted bg-light border rounded-3 p-3 mb-3">
                        Seras redirigido al proveedor corporativo configurado. El login local permanece disponible.
                      </div>
                    )}

                    {loginError && <div className="small text-danger bg-danger bg-opacity-10 border border-danger-subtle rounded-3 p-2 mb-3">{loginError}</div>}

                    <Button type="submit" variant="primary" className="w-100 fw-bold py-2 rounded-3 shadow-sm" disabled={loginLoading}>
                      {loginLoading ? 'Validando...' : (effectiveAuthMode === 'ad' ? 'Ingresar con Active Directory' : 'Entrar a la plataforma')}
                    </Button>
                  </Form>

                  {IS_DEV_ENV && (
                    <div className="d-flex align-items-start gap-2 small text-muted mt-4">
                      <Lock size={16} className="text-primary mt-1 flex-shrink-0" />
                      <span>
                        Desarrollo: <span className="font-monospace">{DEV_ADMIN_EMAIL}</span>. Roles y permisos protegidos por sesion.
                      </span>
                    </div>
                  )}
                </Card.Body>
              </Card>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
