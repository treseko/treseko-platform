import { Button, Card, Col, Form, Row } from 'react-bootstrap'
import { Check, Save } from 'lucide-react'
import { BUILTIN_THEMES } from '../../../../app/themes/themeCatalog'
import { useI18n } from '../../../../i18n'

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
  saveLanguage: (language: 'es' | 'en') => void
  canEditProfile?: boolean
}

export function ProfileSettingsTab({
  loggedUser,
  profileDraft,
  setProfileDraft,
  saveMyProfile,
  saveLanguage,
  canEditProfile = true,
}: Props) {
  const { t, locale, setLocale } = useI18n()
  return (
    <div className="animate__animated animate__fadeIn">
      <h5 className="fw-bold text-secondary mb-3 text-uppercase small">{t('configuracion.profileTitle')}</h5>
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
              <div className="small text-muted">{t('configuracion.profileAvatarFallback')}</div>
            </div>
          </div>
          <Row className="g-3">
            <Col md={6}>
              <Form.Label className="fw-bold small text-muted">{t('configuracion.profileName')}</Form.Label>
              <Form.Control value={profileDraft.nombre_completo} disabled={!canEditProfile} onChange={(e) => setProfileDraft({ ...profileDraft, nombre_completo: e.target.value })} />
            </Col>
            <Col md={6}>
              <Form.Label className="fw-bold small text-muted">{t('configuracion.profileDisplayName')}</Form.Label>
              <Form.Control value={profileDraft.display_name} placeholder={t('configuracion.profileDisplayNamePlaceholder')} disabled={!canEditProfile} onChange={(e) => setProfileDraft({ ...profileDraft, display_name: e.target.value })} />
            </Col>
            <Col md={4}>
              <Form.Label className="fw-bold small text-muted">{t('configuracion.profileAvatar')}</Form.Label>
              <Form.Select value={profileDraft.avatar_provider} disabled={!canEditProfile} onChange={(e) => setProfileDraft({ ...profileDraft, avatar_provider: e.target.value })}>
                <option value="gravatar">{t('configuracion.profileAvatarGravatar')}</option>
                <option value="none">{t('configuracion.profileAvatarInitials')}</option>
              </Form.Select>
              <Form.Text muted>{t('configuracion.profileAvatarHint')}</Form.Text>
            </Col>
            <Col md={4} className="opacity-75">
              <Form.Label className="fw-bold small text-muted">{t('configuracion.profileDensity')} <span className="badge bg-light text-secondary border ms-1">{t('configuracion.unknown')}</span></Form.Label>
              <Form.Select value={profileDraft.density} disabled>
                <option value="comfortable">{t('configuracion.profileDensityComfortable')}</option>
                <option value="compact">{t('configuracion.profileDensityCompact')}</option>
              </Form.Select>
              <Form.Text muted>{t('configuracion.profileDensityDisabled')}</Form.Text>
            </Col>
            <Col md={4}>
              <Form.Label className="fw-bold small text-muted">{t('configuracion.profileLanguage')}</Form.Label>
              <Form.Select value={locale} onChange={(e) => { const next = e.target.value as 'es' | 'en'; setLocale(next); saveLanguage(next) }}>
                <option value="es">{t('configuracion.languageSpanish')}</option>
                <option value="en">{t('configuracion.languageEnglish')}</option>
              </Form.Select>
              <Form.Text muted>{t('configuracion.profileLanguageHint')}</Form.Text>
            </Col>
            <Col xs={12}>
              <Form.Label className="fw-bold small text-muted">{t('configuracion.profileTheme')}</Form.Label>
              <div className="theme-picker-grid">
                {BUILTIN_THEMES.map(theme => {
                  const selected = profileDraft.personal_theme === theme.id
                  const themeCopy: Record<string, [string, string]> = {
                    system: [t('configuracion.themeSystem'), t('configuracion.themeSystemDescription')],
                    light: [t('configuracion.themeLight'), t('configuracion.themeLightDescription')],
                    dark: [t('configuracion.themeDark'), t('configuracion.themeDarkDescription')],
                    'pink-panther': [t('configuracion.themePink'), t('configuracion.themePinkDescription')],
                    graphite: [t('configuracion.themeGraphite'), t('configuracion.themeGraphiteDescription')],
                  }
                  const [themeName, themeDescription] = themeCopy[theme.id] || [theme.name, theme.description]
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
                          {themeName}
                          {selected && <Check size={14} />}
                        </span>
                        <span className="theme-choice-description">{themeDescription}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </Col>
          </Row>
          {canEditProfile && (
            <div className="text-end border-top pt-3 mt-4">
              <Button variant="primary" type="submit" className="px-4 fw-bold rounded-pill shadow-sm"><Save size={16} className="me-2" /> {t('configuracion.profileSave')}</Button>
            </div>
          )}
        </Form>
      </Card>
    </div>
  )
}
