import { Badge, Button, Card, Col, Form, Row } from 'react-bootstrap'
import { Clock, Save, ShieldCheck } from 'lucide-react'

type Props = {
  sessionConfig: any
  setSessionConfig: (config: any) => void
  sessionConfigLoading: boolean
  saveSessionConfig: (config: any) => void
  canEditSession: boolean
}

const SESSION_PRESETS = [
  { hours: 2, label: '2 horas', description: 'Mas estricto' },
  { hours: 8, label: '8 horas', description: 'Recomendado' },
  { hours: 24, label: '24 horas', description: 'Jornada extendida' },
  { hours: 168, label: '168 horas', description: 'Equipos internos' },
]

const formatSessionDuration = (minutesValue: any) => {
  const minutes = Math.max(15, Math.min(Number(minutesValue || 480), 43200))
  const hours = Math.max(1, Math.round(minutes / 60))
  return hours === 1 ? '1 hora' : `${hours} horas`
}

export function SessionSettingsTab({
  sessionConfig,
  setSessionConfig,
  sessionConfigLoading,
  saveSessionConfig,
  canEditSession,
}: Props) {
  const sessionMinutes = Number(sessionConfig.session_timeout_minutes ?? 480)
  const sessionHours = Math.max(1, Math.round(sessionMinutes / 60))
  const durationLabel = formatSessionDuration(sessionMinutes)

  return (
    <Card className="border-0 shadow-sm rounded-4 bg-white p-4 mt-4">
      <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
        <div className="d-flex align-items-start gap-3">
          <div className="bg-primary bg-opacity-10 text-primary rounded-3 p-2 d-flex">
            <ShieldCheck size={20} />
          </div>
          <div>
            <h6 className="fw-bold text-dark m-0">Inicio de sesion</h6>
            <span className="small text-muted">Define cuanto tiempo puede estar abierta Treseko antes de pedir la contrasena otra vez.</span>
          </div>
        </div>
        <Badge bg="light" text="dark" className="border">
          Actual: {durationLabel}
        </Badge>
      </div>
      <Form onSubmit={(e) => { e.preventDefault(); saveSessionConfig(sessionConfig) }}>
        <Row className="g-3 align-items-stretch">
          <Col lg={7}>
            <Form.Label className="fw-bold small text-muted">Duracion recomendada</Form.Label>
            <div className="d-grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))' }}>
              {SESSION_PRESETS.map(preset => {
                const presetMinutes = preset.hours * 60
                const selected = sessionMinutes === presetMinutes
                return (
                  <Button
                    key={preset.hours}
                    type="button"
                    variant={selected ? 'primary' : 'outline-secondary'}
                    className="text-start rounded-3 py-2 px-3"
                    disabled={!canEditSession || sessionConfigLoading}
                    onClick={() => setSessionConfig({ ...sessionConfig, session_timeout_minutes: presetMinutes })}
                  >
                    <span className="d-block fw-bold">{preset.label}</span>
                    <span className={`d-block x-small ${selected ? 'text-white-50' : 'text-muted'}`}>{preset.description}</span>
                  </Button>
                )
              })}
            </div>
          </Col>
          <Col lg={5}>
            <Form.Label className="fw-bold small text-muted">Personalizado en horas</Form.Label>
            <Form.Control
              type="number"
              min={1}
              max={720}
              step={1}
              value={sessionHours}
              disabled={!canEditSession || sessionConfigLoading}
              onChange={(e) => setSessionConfig({ ...sessionConfig, session_timeout_minutes: Number(e.target.value) * 60 })}
            />
            <div className="small text-muted mt-1">Entre 1 hora y 720 horas.</div>
          </Col>
        </Row>
        <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 border-top pt-3 mt-3">
          <div className="small text-muted d-flex align-items-start gap-2">
            <Clock size={16} className="text-primary flex-shrink-0 mt-1" />
            <span>
              Treseko pedira iniciar sesion nuevamente despues de <strong className="text-dark">{durationLabel}</strong>. El cambio se aplica desde el proximo inicio de sesion y no expulsa usuarios conectados ahora.
            </span>
          </div>
          {canEditSession && (
            <Button variant="primary" type="submit" className="px-4 fw-bold rounded-pill shadow-sm" disabled={sessionConfigLoading}>
              <Save size={16} className="me-2" /> Guardar duracion
            </Button>
          )}
        </div>
      </Form>
    </Card>
  )
}
