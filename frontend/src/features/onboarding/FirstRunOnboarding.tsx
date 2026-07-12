import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Form, Modal, ProgressBar, Spinner } from 'react-bootstrap'
import { BarChart3, Boxes, CheckCircle2, ChevronLeft, ChevronRight, FolderKanban, Layers3, PlayCircle, Rocket, ShieldCheck, Sparkles } from 'lucide-react'
import { API_BASE, TRESEKO_TELEMETRY_ENDPOINT } from '../../app/constants'

type FirstRunOnboardingProps = {
  loggedUser: any
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  onPreferencesUpdated: (preferences: any) => void
  firstRunState: any
  onFirstRunCompleted: (state: any) => void
  systemEdition: 'community' | 'premium'
  disabled?: boolean
}

type SurveyAnswers = {
  role: string
  organization_size: string
  expected_uses: string[]
  current_tools: string[]
}

const ROLE_OPTIONS = ['QA manual', 'QA automation', 'QA lead', 'Dev/DevOps', 'Product/Management', 'Otro']
const ORG_SIZE_OPTIONS = ['1-5', '6-20', '21-50', '51-200', '201+']
const USE_OPTIONS = ['gestionar casos', 'ejecutar pruebas', 'automatizacion', 'bugs/evidencias', 'reportes']
const CURRENT_TOOL_OPTIONS = ['Nada / proceso informal', 'Excel / Sheets', 'Jira', 'GitHub Issues', 'TestRail / Zephyr / Xray', 'Herramientas de automatizacion', 'Otro']
const ONBOARDING_SURVEY_VERSION = 1
const TERMS_VERSION = 'treseko-community-rc-1'
const TERMS_URL = 'https://treseko.com/terminos-y-condiciones'

const GUIDE_STEPS = [
  {
    title: 'Soluciones',
    icon: Boxes,
    text: 'Agrupan clientes, equipos o lineas de negocio. Es el primer contenedor donde vive tu trabajo QA.',
    chips: ['Cliente', 'Equipo', 'Unidad QA'],
  },
  {
    title: 'Proyectos',
    icon: FolderKanban,
    text: 'Cada proyecto representa un producto, app o iniciativa que necesita pruebas, bugs y reportes propios.',
    chips: ['Producto', 'Aplicacion', 'Iniciativa'],
  },
  {
    title: 'Componentes y Builds',
    icon: Layers3,
    text: 'Los componentes separan modulos. Las builds son versiones concretas: ahi asignas casos y decides si una entrega esta lista.',
    chips: ['Modulo', 'Version', 'Release'],
  },
  {
    title: 'Suites, ejecuciones y reportes',
    icon: BarChart3,
    text: 'Ordena casos en suites, ejecuta pruebas, adjunta evidencia, reporta bugs y comparte metricas de la build.',
    chips: ['Casos', 'Evidencias', 'Reportes'],
  },
]

const emptyAnswers: SurveyAnswers = {
  role: '',
  organization_size: '',
  expected_uses: [],
  current_tools: [],
}

function hasSeenGuide(profileSettings: any) {
  return profileSettings?.product_guide_seen === true
}

function selectedClass(active: boolean) {
  return `onboarding-choice ${active ? 'is-selected' : ''}`
}

export function FirstRunOnboarding({ loggedUser, fetchWithAuth, onPreferencesUpdated, firstRunState, onFirstRunCompleted, systemEdition, disabled = false }: FirstRunOnboardingProps) {
  const profileSettings = loggedUser?.profileSettings || {}
  const initialNeedsSurvey = firstRunState?.requires_onboarding === true
  const initialNeedsGuide = false
  const [stage, setStage] = useState<'survey' | 'guide' | 'done'>(() => initialNeedsSurvey ? 'survey' : initialNeedsGuide ? 'guide' : 'done')
  const [answers, setAnswers] = useState<SurveyAnswers>(emptyAnswers)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [telemetryOptIn, setTelemetryOptIn] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [guideIndex, setGuideIndex] = useState(0)

  const surveyValid = Boolean(answers.role && answers.organization_size && answers.expected_uses.length > 0 && answers.current_tools.length > 0 && termsAccepted)
  const show = !disabled && stage !== 'done' && (firstRunState?.requires_onboarding === true || stage === 'guide')

  useEffect(() => {
    if (disabled) return
    if (firstRunState?.requires_onboarding === true && stage === 'done') {
      setStage('survey')
      return
    }
    if (firstRunState?.requires_onboarding !== true && stage === 'survey') {
      setStage('done')
    }
  }, [disabled, firstRunState?.requires_onboarding, stage])

  const telemetryPayload = useMemo(() => ({
    event: 'treseko_onboarding_survey_completed',
    version: ONBOARDING_SURVEY_VERSION,
    edition: systemEdition,
    terms_version: TERMS_VERSION,
    telemetry_opt_in: telemetryOptIn,
    answers,
    created_at: new Date().toISOString(),
  }), [answers, systemEdition, telemetryOptIn])

  const patchProfileSettings = async (nextProfileSettings: any) => {
    const response = await fetchWithAuth(`${API_BASE}/users/me/preferences`, {
      method: 'PATCH',
      body: JSON.stringify({ profile_settings: nextProfileSettings }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data?.detail || 'No se pudieron guardar tus preferencias.')
    onPreferencesUpdated(data)
    return data
  }

  const sendTelemetryIfAllowed = async () => {
    if (!telemetryOptIn) return 'skipped'
    try {
      const payload = JSON.stringify(telemetryPayload)
      if (navigator.sendBeacon) {
        const sent = navigator.sendBeacon(
          TRESEKO_TELEMETRY_ENDPOINT,
          new Blob([payload], { type: 'text/plain;charset=UTF-8' })
        )
        if (sent) return 'sent'
      }
      await fetch(TRESEKO_TELEMETRY_ENDPOINT, {
        method: 'POST',
        mode: 'no-cors',
        keepalive: true,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: payload,
      })
      return 'sent'
    } catch (err: any) {
      return err?.message || 'No se pudieron enviar las respuestas.'
    }
  }

  const saveSurvey = async () => {
    if (!surveyValid || saving) return
    setSaving(true)
    setError('')
    try {
      const telemetryResult = await sendTelemetryIfAllowed()
      const telemetrySent = telemetryResult === 'sent'
      const telemetrySkipped = telemetryResult === 'skipped'
      const response = await fetchWithAuth(`${API_BASE}/system/first-run`, {
        method: 'POST',
        body: JSON.stringify({
          survey: {
            version: ONBOARDING_SURVEY_VERSION,
            completed_at: new Date().toISOString(),
            answers,
          },
          terms_accepted: true,
          terms_version: TERMS_VERSION,
          telemetry_opt_in: telemetryOptIn,
          telemetry_status: telemetrySent ? 'sent' : telemetrySkipped ? 'skipped' : 'pending_retry',
          telemetry_endpoint: telemetryOptIn ? TRESEKO_TELEMETRY_ENDPOINT : null,
          telemetry_last_error: telemetryOptIn && !telemetrySent && !telemetrySkipped ? telemetryResult : null,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.detail || 'No se pudo guardar la configuracion inicial.')
      onFirstRunCompleted(data)
      setStage('guide')
    } catch (err: any) {
      setError(err?.message || 'No se pudo guardar la encuesta.')
    } finally {
      setSaving(false)
    }
  }

  const finishGuide = async () => {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      if (!hasSeenGuide(profileSettings)) await patchProfileSettings({
        ...profileSettings,
        product_guide_seen: true,
        product_guide_seen_at: new Date().toISOString(),
      })
      setStage('done')
    } catch (err: any) {
      setError(err?.message || 'No se pudo cerrar la guia.')
    } finally {
      setSaving(false)
    }
  }

  const toggleExpectedUse = (option: string) => {
    setAnswers(prev => ({
      ...prev,
      expected_uses: prev.expected_uses.includes(option)
        ? prev.expected_uses.filter(item => item !== option)
        : [...prev.expected_uses, option],
    }))
  }

  const toggleCurrentTool = (option: string) => {
    setAnswers(prev => ({
      ...prev,
      current_tools: prev.current_tools.includes(option)
        ? prev.current_tools.filter(item => item !== option)
        : [...prev.current_tools, option],
    }))
  }

  const currentGuide = GUIDE_STEPS[guideIndex]
  const GuideIcon = currentGuide.icon
  const isLastGuideStep = guideIndex === GUIDE_STEPS.length - 1

  return (
    <Modal
      show={show}
      backdrop="static"
      keyboard={false}
      centered
      size="xl"
      contentClassName="onboarding-modal animate__animated animate__fadeIn"
    >
      {stage === 'survey' && (
        <>
          <Modal.Header className="border-0 pb-0">
            <div className="d-flex align-items-center gap-3">
              <div className="onboarding-icon-badge"><Sparkles size={22} /></div>
              <div>
                <Modal.Title className="fw-bold text-dark">Antes de empezar</Modal.Title>
                <div className="text-muted small">Cuatro respuestas nos ayudan a configurar Treseko segun tu forma de trabajo.</div>
              </div>
            </div>
          </Modal.Header>
          <Modal.Body className="pt-3">
            {error && <Alert variant="danger" className="small">{error}</Alert>}
            <div className="row g-3">
              <div className="col-lg-6">
                <Card className="onboarding-card h-100">
                  <Card.Body>
                    <div className="fw-bold mb-2">1. Rol principal</div>
                    <div className="onboarding-choice-grid">
                      {ROLE_OPTIONS.map(option => (
                        <button key={option} type="button" className={selectedClass(answers.role === option)} onClick={() => setAnswers(prev => ({ ...prev, role: option }))}>{option}</button>
                      ))}
                    </div>
                  </Card.Body>
                </Card>
              </div>
              <div className="col-lg-6">
                <Card className="onboarding-card h-100">
                  <Card.Body>
                    <div className="fw-bold mb-2">2. Tamano de organizacion</div>
                    <div className="onboarding-choice-grid compact">
                      {ORG_SIZE_OPTIONS.map(option => (
                        <button key={option} type="button" className={selectedClass(answers.organization_size === option)} onClick={() => setAnswers(prev => ({ ...prev, organization_size: option }))}>{option}</button>
                      ))}
                    </div>
                  </Card.Body>
                </Card>
              </div>
              <div className="col-lg-6">
                <Card className="onboarding-card h-100">
                  <Card.Body>
                    <div className="fw-bold mb-2">3. Uso esperado</div>
                    <div className="onboarding-choice-grid">
                      {USE_OPTIONS.map(option => (
                        <button key={option} type="button" className={selectedClass(answers.expected_uses.includes(option))} onClick={() => toggleExpectedUse(option)}>
                          {option}
                        </button>
                      ))}
                    </div>
                    <div className="x-small text-muted mt-2">Puedes elegir mas de uno.</div>
                  </Card.Body>
                </Card>
              </div>
              <div className="col-lg-6">
                <Card className="onboarding-card h-100">
                  <Card.Body>
                    <div className="fw-bold mb-2">4. Herramienta o flujo actual</div>
                    <div className="onboarding-choice-grid">
                      {CURRENT_TOOL_OPTIONS.map(option => (
                        <button key={option} type="button" className={selectedClass(answers.current_tools.includes(option))} onClick={() => toggleCurrentTool(option)}>{option}</button>
                      ))}
                    </div>
                    <div className="x-small text-muted mt-2">Puedes elegir mas de uno.</div>
                  </Card.Body>
                </Card>
              </div>
            </div>
            <div className="onboarding-consent mt-3">
              <Form.Check
                id="treseko-terms-consent"
                checked={termsAccepted}
                onChange={(event) => setTermsAccepted(event.target.checked)}
                label="Acepto los terminos y condiciones de Treseko."
              />
              <Form.Check
                id="treseko-telemetry-consent"
                className="mt-2"
                checked={telemetryOptIn}
                onChange={(event) => setTelemetryOptIn(event.target.checked)}
                label="Quiero compartir estas respuestas anonimas para ayudar a mejorar Treseko."
              />
              <div className="x-small text-muted mt-1">
                Nos ayuda a priorizar integraciones, onboarding y reportes. Es opcional: Treseko funciona igual si no lo marcas. No se envia email, nombre ni IDs de proyecto. Puedes revisar los terminos en{' '}
                <a href={TERMS_URL} target="_blank" rel="noreferrer">https://treseko.com/terminos-y-condiciones</a>.
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer className="border-0 pt-0">
            <Button variant="primary" className="fw-bold rounded-pill px-4" disabled={!surveyValid || saving} onClick={saveSurvey}>
              {saving ? <Spinner size="sm" className="me-2" /> : <CheckCircle2 size={16} className="me-2" />}
              Continuar
            </Button>
          </Modal.Footer>
        </>
      )}

      {stage === 'guide' && (
        <>
          <Modal.Header className="border-0 pb-0">
            <div className="d-flex align-items-center justify-content-between w-100 gap-3">
              <div className="d-flex align-items-center gap-3 min-w-0">
                <div className="onboarding-icon-badge"><Rocket size={22} /></div>
                <div className="min-w-0">
                  <Modal.Title className="fw-bold text-dark text-truncate">Como se ordena Treseko</Modal.Title>
                  <div className="text-muted small">Una guia visual rapida para entender la jerarquia de trabajo.</div>
                </div>
              </div>
              <Badge bg={systemEdition === 'premium' ? 'warning' : 'primary'} text={systemEdition === 'premium' ? 'dark' : undefined}>
                {systemEdition === 'premium' ? 'Premium' : 'Community'}
              </Badge>
            </div>
          </Modal.Header>
          <Modal.Body>
            {error && <Alert variant="danger" className="small">{error}</Alert>}
            <div className="onboarding-guide-layout">
              <div className="onboarding-flow" aria-hidden="true">
                {GUIDE_STEPS.map((step, index) => {
                  const StepIcon = step.icon
                  return (
                    <div key={step.title} className={`onboarding-flow-node ${index === guideIndex ? 'is-active' : ''} ${index < guideIndex ? 'is-done' : ''}`}>
                      <div className="onboarding-flow-dot"><StepIcon size={18} /></div>
                      <div className="onboarding-flow-label">{step.title}</div>
                    </div>
                  )
                })}
              </div>
              <Card className="onboarding-guide-card">
                <Card.Body>
                  <div className="d-flex align-items-start gap-3">
                    <div className="onboarding-guide-icon"><GuideIcon size={34} /></div>
                    <div className="min-w-0">
                      <h3 className="fw-bold text-dark mb-2">{currentGuide.title}</h3>
                      <p className="text-muted mb-3">{currentGuide.text}</p>
                      <div className="d-flex flex-wrap gap-2">
                        {currentGuide.chips.map(chip => <Badge key={chip} bg="light" text="dark" className="border">{chip}</Badge>)}
                      </div>
                    </div>
                  </div>
                  <div className="onboarding-hierarchy mt-4">
                    <span>Solucion</span>
                    <span>Proyecto</span>
                    <span>Componente</span>
                    <span>Build</span>
                    <span>Casos</span>
                    <span>Reportes</span>
                  </div>
                  <ProgressBar now={((guideIndex + 1) / GUIDE_STEPS.length) * 100} className="mt-4 onboarding-progress" />
                </Card.Body>
              </Card>
              <Alert variant="info" className="small border-0 onboarding-tip">
                <ShieldCheck size={16} className="me-1" />
                Cada usuario ve esta guia una sola vez. Luego podras volver a orientarte desde la estructura de navegacion.
              </Alert>
            </div>
          </Modal.Body>
          <Modal.Footer className="border-0 pt-0 d-flex justify-content-between">
            <Button variant="outline-secondary" className="fw-bold rounded-pill" disabled={guideIndex === 0 || saving} onClick={() => setGuideIndex(index => Math.max(0, index - 1))}>
              <ChevronLeft size={16} /> Anterior
            </Button>
            <Button
              variant="primary"
              className="fw-bold rounded-pill px-4"
              disabled={saving}
              onClick={() => isLastGuideStep ? finishGuide() : setGuideIndex(index => Math.min(GUIDE_STEPS.length - 1, index + 1))}
            >
              {saving ? <Spinner size="sm" className="me-2" /> : isLastGuideStep ? <PlayCircle size={16} className="me-2" /> : null}
              {isLastGuideStep ? 'Empezar' : 'Siguiente'}
              {!isLastGuideStep && <ChevronRight size={16} className="ms-1" />}
            </Button>
          </Modal.Footer>
        </>
      )}
    </Modal>
  )
}
