import { Button, Card, Col, Form, Row } from 'react-bootstrap'
import { Check, Save } from 'lucide-react'
import { BUILTIN_THEMES } from '../../../../app/themes/themeCatalog'

type ProfileDraft = {
  nombre_completo: string
  display_name: string
  avatar_provider: string
  personal_theme: string
  density: string
  language: string
}

type Props = {
  loggedUser: any
  profileDraft: ProfileDraft
  setProfileDraft: (draft: ProfileDraft) => void
  saveMyProfile: (event: any) => void
  canEditProfile?: boolean
}

export function ProfileSettingsTab({
  loggedUser,
  profileDraft,
  setProfileDraft,
  saveMyProfile,
  canEditProfile = true,
}: Props) {
  return (
    <div className="animate__animated animate__fadeIn">
      <h5 className="fw-bold text-secondary mb-3 text-uppercase small">Perfil y preferencias personales</h5>
      <Card className="border-0 shadow-sm rounded-4 bg-white p-4">
        <Form onSubmit={saveMyProfile}>
          <div className="d-flex align-items-center gap-3 mb-4">
            <div className="rounded-circle bg-primary text-white d-flex align-items-center justify-content-center fw-bold overflow-hidden position-relative" style={{ width: 64, height: 64 }}>
              <span>{loggedUser.avatar}</span>
              {loggedUser.avatarUrl && profileDraft.avatar_provider === 'gravatar' ? (
                <img src={loggedUser.avatarUrl} alt={loggedUser.name} width={64} height={64} className="object-fit-cover position-absolute top-0 start-0" onError={(event) => { event.currentTarget.style.display = 'none' }} />
              ) : null}
            </div>
            <div>
              <h6 className="fw-bold text-dark mb-1">{loggedUser.email}</h6>
              <div className="small text-muted">Avatar por Gravatar con fallback de iniciales. No se suben imagenes en V1.</div>
            </div>
          </div>
          <Row className="g-3">
            <Col md={6}>
              <Form.Label className="fw-bold small text-muted">Nombre completo</Form.Label>
              <Form.Control value={profileDraft.nombre_completo} disabled={!canEditProfile} onChange={(e) => setProfileDraft({ ...profileDraft, nombre_completo: e.target.value })} />
            </Col>
            <Col md={6}>
              <Form.Label className="fw-bold small text-muted">Nombre visible</Form.Label>
              <Form.Control value={profileDraft.display_name} placeholder="Opcional" disabled={!canEditProfile} onChange={(e) => setProfileDraft({ ...profileDraft, display_name: e.target.value })} />
            </Col>
            <Col md={4}>
              <Form.Label className="fw-bold small text-muted">Avatar</Form.Label>
              <Form.Select value={profileDraft.avatar_provider} disabled={!canEditProfile} onChange={(e) => setProfileDraft({ ...profileDraft, avatar_provider: e.target.value })}>
                <option value="gravatar">Gravatar</option>
                <option value="none">Iniciales</option>
              </Form.Select>
              <Form.Text muted>Gravatar usa el email de tu cuenta; iniciales no requiere imagen externa.</Form.Text>
            </Col>
            <Col md={4} className="opacity-75">
              <Form.Label className="fw-bold small text-muted">Densidad UI <span className="badge bg-light text-secondary border ms-1">Próximamente</span></Form.Label>
              <Form.Select value={profileDraft.density} disabled>
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compacta</option>
              </Form.Select>
              <Form.Text muted>Esta preferencia todavía no modifica la interfaz.</Form.Text>
            </Col>
            <Col md={4} className="opacity-75">
              <Form.Label className="fw-bold small text-muted">Idioma <span className="badge bg-light text-secondary border ms-1">Próximamente</span></Form.Label>
              <Form.Select value={profileDraft.language} disabled>
                <option value="es">Español</option>
                <option value="en">English</option>
              </Form.Select>
              <Form.Text muted>La traducción completa se habilitará en una versión futura.</Form.Text>
            </Col>
            <Col xs={12}>
              <Form.Label className="fw-bold small text-muted">Tema global</Form.Label>
              <div className="theme-picker-grid">
                {BUILTIN_THEMES.map(theme => {
                  const selected = profileDraft.personal_theme === theme.id
                  return (
                    <button
                      type="button"
                      key={theme.id}
                      className={`theme-choice ${selected ? 'is-selected' : ''}`}
                      disabled={!canEditProfile}
                      onClick={() => setProfileDraft({ ...profileDraft, personal_theme: theme.id })}
                      aria-pressed={selected}
                    >
                      <span className="theme-choice-preview" aria-hidden="true">
                        {theme.preview.map(color => <span key={color} style={{ backgroundColor: color }} />)}
                      </span>
                      <span className="theme-choice-copy">
                        <span className="theme-choice-title">
                          {theme.name}
                          {selected && <Check size={14} />}
                        </span>
                        <span className="theme-choice-description">{theme.description}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </Col>
          </Row>
          {canEditProfile && (
            <div className="text-end border-top pt-3 mt-4">
              <Button variant="primary" type="submit" className="px-4 fw-bold rounded-pill shadow-sm"><Save size={16} className="me-2" /> Guardar mi perfil</Button>
            </div>
          )}
        </Form>
      </Card>
    </div>
  )
}
