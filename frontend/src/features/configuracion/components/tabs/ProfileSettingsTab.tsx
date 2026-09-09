import { Button, Card, Col, Form, Row } from 'react-bootstrap'
import { Check, Download, Save, Settings2, Upload, RotateCcw, Palette } from 'lucide-react'
import { BUILTIN_THEMES } from '../../../../app/themes/themeCatalog'
import { useRef, useState } from 'react'
import { applyCustomTheme, applyProjectTheme, applyWallpaper, clearCustomTheme, clearProjectTheme, DEFAULT_PROJECT_THEME, MAX_THEME_IMAGE_BYTES, normalizeCustomThemes, normalizeProjectTheme, readImportedProjectTheme, type ProjectThemeSettings } from '../../../../app/themes/themeCustomization'
import { useI18n, type Locale } from '../../../../i18n'

type ProfileDraft = {
  nombre_completo: string
  display_name: string
  avatar_provider: string
  personal_theme: string
  density: string
  language: Locale
  appearance: { wallpaper: 'none' | 'aurora' | 'sunset' | 'graphite' }
  custom_themes: any[]
  personal_theme_config: ProjectThemeSettings | null
  project_theme: ProjectThemeSettings | null
}

type Props = {
  loggedUser: any
  profileDraft: ProfileDraft
  setProfileDraft: (draft: ProfileDraft) => void
  saveMyProfile: (event: any) => void
  saveLanguage: (language: Locale) => Promise<boolean>
  currentProjectId: string | null
  currentProjectName: string
  saveProjectTheme: (theme: ProjectThemeSettings) => Promise<void>
  resetProjectTheme: () => Promise<void>
  canEditProfile?: boolean
}

export function commitLanguageLocale(
  saved: boolean,
  next: Locale,
  previous: Locale,
  setLocale: (locale: Locale) => void,
) {
  setLocale(saved ? next : previous)
}

export function ProfileSettingsTab({
  loggedUser,
  profileDraft,
  setProfileDraft,
  saveMyProfile,
  saveLanguage,
  currentProjectId,
  currentProjectName,
  saveProjectTheme,
  resetProjectTheme,
  canEditProfile = true,
}: Props) {
  const { t, locale, setLocale } = useI18n()
  const [showProjectTheme, setShowProjectTheme] = useState(false)
  const [importError, setImportError] = useState('')
  const [savingProjectTheme, setSavingProjectTheme] = useState(false)
  const [savingLanguage, setSavingLanguage] = useState(false)
  const [projectThemeDraft, setProjectThemeDraft] = useState<ProjectThemeSettings | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const customThemes = normalizeCustomThemes(profileDraft.custom_themes)
  const availableThemes = [...BUILTIN_THEMES, ...customThemes]
  const personalTheme = normalizeProjectTheme(profileDraft.personal_theme_config) || normalizeProjectTheme(profileDraft.project_theme)
  const editableProjectTheme = projectThemeDraft || personalTheme
  const updateProjectTheme = (changes: Partial<ProjectThemeSettings>) => {
    const next = normalizeProjectTheme({ ...(editableProjectTheme || {}), ...changes })
    setProjectThemeDraft(next)
    applyProjectTheme(next)
    if (!next?.gradientEnabled) applyWallpaper('none')
  }
  const handleThemeSelect = (themeId: string) => {
    setProfileDraft({ ...profileDraft, personal_theme: themeId, personal_theme_config: themeId === 'light' || themeId === 'dark' || themeId === 'system' || themeId === 'pink-panther' || themeId === 'graphite' ? null : profileDraft.personal_theme_config })
    // Apply the preview immediately; persistence still happens with the profile form.
    document.documentElement.dataset.qaTheme = themeId
    const selected = availableThemes.find(theme => theme.id === themeId)
    if (selected?.source === 'third-party') applyCustomTheme(selected)
    else clearCustomTheme()
    clearProjectTheme()
    if (selected?.source === 'builtin') applyCustomTheme(selected)
    else if (personalTheme) applyProjectTheme(personalTheme)
  }
  const handleImportTheme = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const imported = await readImportedProjectTheme(file)
      setProjectThemeDraft(imported)
      applyProjectTheme(imported)
      setShowProjectTheme(true)
      setImportError('')
    } catch (error: any) {
      setImportError(error?.message || 'No se pudo importar el tema.')
    }
  }
  const handleSaveProjectTheme = async () => {
    if (!editableProjectTheme) return
    setSavingProjectTheme(true)
    try {
      await saveProjectTheme(editableProjectTheme)
    } catch (error: any) {
      setImportError(error?.message || t('configuracion.profileSaveFallback'))
    } finally {
      setSavingProjectTheme(false)
    }
  }
  const handleResetProjectTheme = async () => {
    setSavingProjectTheme(true)
    try {
      await resetProjectTheme()
      setProfileDraft({ ...profileDraft, project_theme: null })
      setProjectThemeDraft(null)
      clearProjectTheme()
      applyWallpaper('none')
    } catch (error: any) {
      setImportError(error?.message || t('configuracion.profileSaveFallback'))
    } finally {
      setSavingProjectTheme(false)
    }
  }
  const openProjectThemeEditor = () => {
    setProjectThemeDraft({ ...DEFAULT_PROJECT_THEME, name: `${t('configuracion.projectThemeNewName')}` })
    setShowProjectTheme(true)
  }
  const handleBackgroundImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setImportError(t('configuracion.projectThemeImageTypeError'))
      return
    }
    if (file.size > MAX_THEME_IMAGE_BYTES) {
      setImportError(t('configuracion.projectThemeImageSizeError'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const backgroundImage = typeof reader.result === 'string' ? reader.result : ''
      const next = normalizeProjectTheme({ ...(editableProjectTheme || DEFAULT_PROJECT_THEME), backgroundMode: 'image', backgroundImage })
      setProjectThemeDraft(next)
      applyProjectTheme(next)
      setImportError('')
    }
    reader.onerror = () => setImportError(t('configuracion.projectThemeImageReadError'))
    reader.readAsDataURL(file)
  }
  const exportProjectTheme = () => {
    if (!editableProjectTheme) return
    const blob = new Blob([JSON.stringify(editableProjectTheme, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${editableProjectTheme.name.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'tema-proyecto'}.json`
    link.click()
    URL.revokeObjectURL(url)
  }
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
              <Form.Control name="a11y-profilesettingstabtsx-53" aria-label="Campo de formulario" value={profileDraft.nombre_completo} disabled={!canEditProfile} onChange={(e) => setProfileDraft({ ...profileDraft, nombre_completo: e.target.value })} />
            </Col>
            <Col md={6}>
              <Form.Label className="fw-bold small text-muted">{t('configuracion.profileDisplayName')}</Form.Label>
              <Form.Control name="a11y-profilesettingstabtsx-57" aria-label="Campo de formulario" value={profileDraft.display_name} placeholder={t('configuracion.profileDisplayNamePlaceholder')} disabled={!canEditProfile} onChange={(e) => setProfileDraft({ ...profileDraft, display_name: e.target.value })} />
            </Col>
            <Col md={4}>
              <Form.Label className="fw-bold small text-muted">{t('configuracion.profileAvatar')}</Form.Label>
              <Form.Select name="a11y-profilesettingstabtsx-61" aria-label="Campo de formulario" value={profileDraft.avatar_provider} disabled={!canEditProfile} onChange={(e) => setProfileDraft({ ...profileDraft, avatar_provider: e.target.value })}>
                <option value="gravatar">{t('configuracion.profileAvatarGravatar')}</option>
                <option value="none">{t('configuracion.profileAvatarInitials')}</option>
              </Form.Select>
              <Form.Text muted>{t('configuracion.profileAvatarHint')}</Form.Text>
            </Col>
            <Col md={4} className="opacity-75">
              <Form.Label className="fw-bold small text-muted">{t('configuracion.profileDensity')} <span className="badge bg-light text-secondary border ms-1">{t('configuracion.unknown')}</span></Form.Label>
              <Form.Select name="a11y-profilesettingstabtsx-69" aria-label="Campo de formulario" value={profileDraft.density} disabled>
                <option value="comfortable">{t('configuracion.profileDensityComfortable')}</option>
                <option value="compact">{t('configuracion.profileDensityCompact')}</option>
              </Form.Select>
              <Form.Text muted>{t('configuracion.profileDensityDisabled')}</Form.Text>
            </Col>
            <Col md={4}>
              <Form.Label className="fw-bold small text-muted">{t('configuracion.profileLanguage')}</Form.Label>
              <Form.Select name="a11y-profilesettingstabtsx-77" aria-label="Campo de formulario" value={locale} disabled={!canEditProfile || savingLanguage} onChange={(e) => {
                const next = e.target.value as Locale
                const previous = locale
                if (next === previous) return
                setSavingLanguage(true)
                void saveLanguage(next).then((saved) => {
                  commitLanguageLocale(saved, next, previous, setLocale)
                }).finally(() => setSavingLanguage(false))
              }}>
                <option value="es">{t('configuracion.languageSpanish')}</option>
                <option value="en">{t('configuracion.languageEnglish')}</option>
                <option value="pt">Português (Brasil)</option>
              </Form.Select>
              <Form.Text muted>{t('configuracion.profileLanguageHint')}</Form.Text>
            </Col>
            <Col xs={12}>
              <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
                <Form.Label className="fw-bold small text-muted mb-0">{t('configuracion.profileTheme')}</Form.Label>
                {canEditProfile && (
                  <div className="d-flex gap-2">
                    <Button type="button" variant={showProjectTheme ? 'primary' : 'outline-primary'} size="sm" className="rounded-pill" onClick={openProjectThemeEditor}>
                      <Settings2 size={14} className="me-1" /> {t('configuracion.projectThemeCreate')}
                    </Button>
                    <Button type="button" variant="outline-secondary" size="sm" className="rounded-pill" onClick={() => importInputRef.current?.click()}>
                      <Upload size={14} className="me-1" /> {t('configuracion.projectThemeImport')}
                    </Button>
                    <Form.Control ref={importInputRef} type="file" accept="application/json,.json" className="d-none" onChange={handleImportTheme} />
                  </div>
                )}
              </div>
              <div className="theme-picker-grid">
                {availableThemes.map(theme => {
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
                      onClick={() => handleThemeSelect(theme.id)}
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
              {importError && <div className="text-danger small mt-2" role="alert">{importError}</div>}
              {showProjectTheme && canEditProfile && editableProjectTheme && (
                <div className="project-theme-editor border rounded-4 p-3 p-lg-4 mt-3">
                  <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
                    <div>
                      <div className="fw-bold text-dark"><Palette size={17} className="me-2 text-primary" />{t('configuracion.projectThemeTitle')}</div>
                      <div className="small text-muted mt-1">{personalTheme ? `${t('configuracion.projectThemeActive')}: ${personalTheme.name}` : t('configuracion.projectThemeNoTheme')}</div>
                    </div>
                    <span className="badge rounded-pill bg-primary-subtle text-primary">{t('configuracion.projectThemeLivePreview')}</span>
                  </div>
                  <Row className="g-3">
                    <Col xs={12}>
                      <Form.Label className="small fw-bold">{t('configuracion.projectThemeName')}</Form.Label>
                      <Form.Control value={editableProjectTheme.name} maxLength={50} onChange={event => updateProjectTheme({ name: event.target.value })} />
                    </Col>
                    {([['background', 'projectThemeBackground'], ['surface', 'projectThemeSurface'], ['surfaceMuted', 'projectThemeSurfaceMuted'], ['surfaceRaised', 'projectThemeSurfaceRaised'], ['surfaceHover', 'projectThemeSurfaceHover'], ['border', 'projectThemeBorder'], ['borderStrong', 'projectThemeBorderStrong'], ['primary', 'projectThemePrimary'], ['accent', 'projectThemeAccent'], ['text', 'projectThemeText'], ['muted', 'projectThemeMuted'], ['rowSelected', 'projectThemeRowSelected'], ['caseRowBackground', 'projectThemeCaseRowBackground'], ['caseRowHover', 'projectThemeCaseRowHover'], ['caseRowText', 'projectThemeCaseRowText']] as const).map(([key, label]) => (
                      <Col xs={6} md={4} key={key}>
                        <Form.Label className="small fw-bold">{t(`configuracion.${label}` as any)}</Form.Label>
                        <div className="d-flex align-items-center gap-2">
                          <Form.Control type="color" value={editableProjectTheme[key]} onChange={event => updateProjectTheme({ [key]: event.target.value } as Partial<ProjectThemeSettings>)} className="theme-color-input" />
                          <code className="small">{editableProjectTheme[key]}</code>
                        </div>
                      </Col>
                    ))}
                    <Col xs={12} md={4}>
                      <Form.Label className="small fw-bold">{t('configuracion.projectThemeBackgroundType')}</Form.Label>
                      <Form.Select value={editableProjectTheme.backgroundMode} onChange={event => updateProjectTheme({ backgroundMode: event.target.value as ProjectThemeSettings['backgroundMode'] })}>
                        <option value="solid">{t('configuracion.projectThemeBackgroundSolid')}</option>
                        <option value="gradient">{t('configuracion.projectThemeBackgroundGradient')}</option>
                        <option value="image">{t('configuracion.projectThemeBackgroundImage')}</option>
                      </Form.Select>
                    </Col>
                    {editableProjectTheme.backgroundMode === 'image' && <>
                      <Col xs={12} md={8}>
                        <Form.Label className="small fw-bold">{t('configuracion.projectThemeUploadImage')}</Form.Label>
                        <Form.Control type="file" accept="image/png,image/jpeg,image/webp" onChange={handleBackgroundImage} />
                        <Form.Text muted>{t('configuracion.projectThemeImageHint')}</Form.Text>
                      </Col>
                      <Col xs={12} md={4}><Form.Label className="small fw-bold">{t('configuracion.projectThemeImageSize')}</Form.Label><Form.Select value={editableProjectTheme.imageSize} onChange={event => updateProjectTheme({ imageSize: event.target.value as ProjectThemeSettings['imageSize'] })}><option value="cover">{t('configuracion.projectThemeImageCover')}</option><option value="contain">{t('configuracion.projectThemeImageContain')}</option><option value="auto">{t('configuracion.projectThemeImageAuto')}</option></Form.Select></Col>
                      <Col xs={12} md={4}><Form.Label className="small fw-bold">{t('configuracion.projectThemeImagePosition')}</Form.Label><Form.Select value={editableProjectTheme.imagePosition} onChange={event => updateProjectTheme({ imagePosition: event.target.value as ProjectThemeSettings['imagePosition'] })}><option value="center">{t('configuracion.projectThemeImageCenter')}</option><option value="top">{t('configuracion.projectThemeImageTop')}</option><option value="bottom">{t('configuracion.projectThemeImageBottom')}</option><option value="left">{t('configuracion.projectThemeImageLeft')}</option><option value="right">{t('configuracion.projectThemeImageRight')}</option></Form.Select></Col>
                      <Col xs={12} md={4}><Form.Label className="small fw-bold d-flex justify-content-between"><span>{t('configuracion.projectThemeImageOpacity')}</span><span>{editableProjectTheme.imageOpacity}%</span></Form.Label><Form.Range min={0} max={100} value={editableProjectTheme.imageOpacity} onChange={event => updateProjectTheme({ imageOpacity: Number(event.target.value) })} /></Col>
                    </>}
                    <Col xs={12}>
                      <Form.Check type="switch" label={t('configuracion.projectThemeGradient')} checked={editableProjectTheme.backgroundMode === 'gradient'} onChange={event => updateProjectTheme({ backgroundMode: event.target.checked ? 'gradient' : 'solid', gradientEnabled: event.target.checked })} />
                    </Col>
                    {editableProjectTheme.backgroundMode === 'gradient' && <>
                      <Col xs={6} md={3}><Form.Label className="small fw-bold">{t('configuracion.projectThemeGradientStart')}</Form.Label><Form.Control type="color" value={editableProjectTheme.gradientStart} onChange={event => updateProjectTheme({ gradientStart: event.target.value })} className="theme-color-input w-100" /></Col>
                      <Col xs={6} md={3}><Form.Label className="small fw-bold">{t('configuracion.projectThemeGradientEnd')}</Form.Label><Form.Control type="color" value={editableProjectTheme.gradientEnd} onChange={event => updateProjectTheme({ gradientEnd: event.target.value })} className="theme-color-input w-100" /></Col>
                      <Col xs={12} md={3}><Form.Label className="small fw-bold">{t('configuracion.projectThemeGradientDirection')}</Form.Label><Form.Select value={editableProjectTheme.gradientDirection} onChange={event => updateProjectTheme({ gradientDirection: event.target.value as ProjectThemeSettings['gradientDirection'] })}><option value="90deg">90°</option><option value="135deg">135°</option><option value="180deg">180°</option><option value="225deg">225°</option></Form.Select></Col>
                      <Col xs={12} md={3}><Form.Label className="small fw-bold d-flex justify-content-between"><span>{t('configuracion.projectThemeOpacity')}</span><span>{editableProjectTheme.gradientOpacity}%</span></Form.Label><Form.Range min={0} max={100} value={editableProjectTheme.gradientOpacity} onChange={event => updateProjectTheme({ gradientOpacity: Number(event.target.value) })} /></Col>
                    </>}
                    <Col xs={12}><div className="project-theme-preview rounded-3 p-3" style={{ backgroundColor: editableProjectTheme.background, color: editableProjectTheme.text, backgroundImage: editableProjectTheme.backgroundMode === 'image' && editableProjectTheme.backgroundImage ? `linear-gradient(rgba(0,0,0,${1 - editableProjectTheme.imageOpacity / 100}), url("${editableProjectTheme.backgroundImage}"))` : editableProjectTheme.backgroundMode === 'gradient' ? `linear-gradient(${editableProjectTheme.gradientDirection}, ${editableProjectTheme.gradientStart}${Math.round(editableProjectTheme.gradientOpacity * 2.55).toString(16).padStart(2, '0')}, ${editableProjectTheme.gradientEnd}${Math.round(editableProjectTheme.gradientOpacity * 2.55).toString(16).padStart(2, '0')})` : undefined, backgroundSize: editableProjectTheme.imageSize === 'auto' ? 'auto' : editableProjectTheme.imageSize, backgroundPosition: editableProjectTheme.imagePosition }}><div className="small fw-bold">{t('configuracion.projectThemePreview')}</div><div className="small mt-2 opacity-75">{t('configuracion.projectThemePreviewText')}</div></div></Col>
                  </Row>
                  <div className="d-flex flex-wrap justify-content-end gap-2 mt-4 pt-3 border-top">
                    <Button type="button" variant="outline-secondary" size="sm" onClick={exportProjectTheme} disabled={savingProjectTheme}><Download size={14} className="me-1" /> {t('configuracion.projectThemeExport')}</Button>
                    {personalTheme && <Button type="button" variant="outline-danger" size="sm" onClick={() => void handleResetProjectTheme()} disabled={savingProjectTheme}><RotateCcw size={14} className="me-1" /> {t('configuracion.projectThemeReset')}</Button>}
                    <Button type="button" variant="primary" size="sm" onClick={() => void handleSaveProjectTheme()} disabled={savingProjectTheme}><Save size={14} className="me-1" /> {t('configuracion.projectThemeSave')}</Button>
                  </div>
                </div>
              )}
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
