import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Col, Form, Modal, Row, Table } from 'react-bootstrap'
import { Check, KeyRound, Pencil, Play, RefreshCw } from 'lucide-react'
import {
  activateAiProviderProfile,
  createAiProviderCredential,
  createAiProviderProfile,
  disableAiProviderProfile,
  fetchAiProviderCredentials,
  fetchAiProviderProfiles,
  testAiProviderProfile,
  updateAiProviderCredential,
  updateAiProviderProfile,
  type FetchWithAuth,
} from '../../api/configuracionApi'
import { aiProviderOptions } from '../../mappers/configuracionMappers'
import { API_BASE } from '../../../../app/constants'
import { useI18n } from '../../../../i18n'

type Props = {
  fetchWithAuth: FetchWithAuth
  canEdit: boolean
  showFeedback: (title: string, message: string, variant?: string) => void
  activeConfig: any
  onActiveConfig: (config: any) => void
}

const adapterFor = (provider: string) =>
  provider === 'openai' ? 'openai-responses'
  : provider === 'anthropic' ? 'anthropic-messages'
  : provider === 'gemini' ? 'gemini'
  : provider === 'azure-openai' ? 'azure-openai'
  : 'openai-compatible'

export function AiProviderProfilesPanel({ fetchWithAuth, canEdit, showFeedback, activeConfig, onActiveConfig }: Props) {
  const { t } = useI18n()
  const [profiles, setProfiles] = useState<any[]>([])
  const [credentials, setCredentials] = useState<any[]>([])
  const [catalogs, setCatalogs] = useState<Record<string, any[]>>({})
  const [busyId, setBusyId] = useState('')
  const [newProvider, setNewProvider] = useState('lm-studio')
  const [newLabel, setNewLabel] = useState('')
  const [newSecret, setNewSecret] = useState('')
  const [newEndpoint, setNewEndpoint] = useState('http://127.0.0.1:1234/v1')
  const [newModel, setNewModel] = useState('lm-studio')
  const [editingProfile, setEditingProfile] = useState<any | null>(null)
  const [editedProfileName, setEditedProfileName] = useState('')
  const [editedCredentialLabel, setEditedCredentialLabel] = useState('')
  const providerOptions = useMemo(() => aiProviderOptions, [])

  const load = async () => {
    const [nextProfiles, nextCredentials] = await Promise.all([
      fetchAiProviderProfiles(fetchWithAuth),
      fetchAiProviderCredentials(fetchWithAuth),
    ])
    setProfiles(nextProfiles)
    setCredentials(nextCredentials)
    return nextProfiles
  }
  useEffect(() => { void load().catch(error => showFeedback(t('configuracion.aiProfilesTitle'), error.message, 'danger')) }, [])

  const credentialOptions = (provider: string) => credentials.filter(item => item.active && item.provider === provider)
  const providerLabel = (provider: string) => providerOptions.find(item => item.value === provider)?.label || provider
  const modelOptions = (profile: any) => {
    const scanned = catalogs[profile.id] || (profile.active_runtime ? activeConfig.model_catalog || [] : [])
    const defaults = providerOptions.find(item => item.value === profile.provider)?.defaultModel
    const unique = new Map<string, any>()
    if (profile.model) unique.set(profile.model, { id: profile.model, name: profile.model })
    if (defaults) unique.set(defaults, { id: defaults, name: defaults })
    scanned.forEach((item: any) => unique.set(item.id || item.name, item))
    return [...unique.values()]
  }

  const scanProfile = async (profile: any) => {
    setBusyId(`scan-${profile.id}`)
    try {
      const response = await fetchWithAuth(`${API_BASE}/ai-engine/models/scan`, {
        method: 'POST', body: JSON.stringify({ profile_id: profile.id }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !['ok', 'empty'].includes(result.status)) throw new Error(result.detail || t('configuracion.aiProfilesCatalogUpdateFailed'))
      const models = Array.isArray(result.models) ? result.models : []
      setCatalogs(previous => ({ ...previous, [profile.id]: models }))
      if (profile.active_runtime) onActiveConfig({ ...activeConfig, model_catalog: models, last_model_scan_at: result.scanned_at, last_model_scan_status: result.status })
      showFeedback(t('configuracion.aiModelsTitle'), result.detail || t('configuracion.aiProfilesModelsAvailable', { count: models.length }), result.status === 'ok' ? 'success' : 'warning')
    } catch (error: any) {
      showFeedback(t('configuracion.aiModelsTitle'), error.message || t('configuracion.aiProfilesCatalogUpdateFailed'), 'warning')
    } finally { setBusyId('') }
  }

  const updateProfile = async (profile: any, patch: any) => {
    setBusyId(`profile-${profile.id}`)
    try {
      const saved = await updateAiProviderProfile(fetchWithAuth, profile.id, patch)
      setProfiles(items => items.map(item => item.id === profile.id ? { ...item, ...saved } : item))
      if (profile.active_runtime) onActiveConfig({ ...activeConfig, model: saved.model, llm_endpoint: saved.endpoint, active_provider_profile_id: saved.id })
      showFeedback(t('configuracion.aiProfileTitle'), patch.model ? t('configuracion.aiProfilesModelUpdated') : t('configuracion.aiProfilesProfileUpdated'), 'success')
    } catch (error: any) { showFeedback(t('configuracion.aiProfileTitle'), error.message, 'danger') } finally { setBusyId('') }
  }

  const activate = async (profile: any) => {
    setBusyId(`activate-${profile.id}`)
    try {
      const result = await activateAiProviderProfile(fetchWithAuth, profile.id)
      onActiveConfig(result.config)
      await load()
      showFeedback(t('configuracion.aiProfileTitle'), t('configuracion.aiProfilesActivated', { name: profile.name }), 'success')
    } catch (error: any) { showFeedback(t('configuracion.aiProfileTitle'), error.message, 'danger') } finally { setBusyId('') }
  }

  const beginEdit = (profile: any) => {
    const credential = credentials.find(item => item.id === profile.credential_id)
    setEditingProfile(profile)
    setEditedProfileName(profile.name || '')
    setEditedCredentialLabel(credential?.label || '')
  }

  const saveNames = async () => {
    if (!editingProfile) return
    const profileName = editedProfileName.trim()
    const credential = credentials.find(item => item.id === editingProfile.credential_id)
    const credentialLabel = editedCredentialLabel.trim()
    if (!profileName || (credential && !credentialLabel)) {
      showFeedback(t('configuracion.aiProfileTitle'), t('configuracion.aiProfilesCompleteNames'), 'warning')
      return
    }
    setBusyId(`edit-${editingProfile.id}`)
    try {
      const updates: Promise<unknown>[] = []
      if (profileName !== editingProfile.name) updates.push(updateAiProviderProfile(fetchWithAuth, editingProfile.id, { name: profileName }))
      if (credential && credentialLabel !== credential.label) updates.push(updateAiProviderCredential(fetchWithAuth, credential.id, { label: credentialLabel }))
      await Promise.all(updates)
      await load()
      setEditingProfile(null)
      showFeedback(t('configuracion.aiProfileTitle'), t('configuracion.aiProfilesNamesUpdated'), 'success')
    } catch (error: any) { showFeedback(t('configuracion.aiProfileTitle'), error.message, 'danger') } finally { setBusyId('') }
  }

  const saveProvider = async () => {
    setBusyId('new')
    try {
      const option = providerOptions.find(item => item.value === newProvider)
      const label = newLabel.trim() || `${option?.label || newProvider}-${Date.now()}`
      const credential = option?.requiresApiKey
        ? await createAiProviderCredential(fetchWithAuth, { provider: newProvider, label, secret: newSecret })
        : null
      if (newProvider !== 'opencode') {
        await createAiProviderProfile(fetchWithAuth, {
          name: label, provider: newProvider, endpoint: newEndpoint, model: newModel, credential_id: credential?.id || null,
          adapter: adapterFor(newProvider), capabilities_json: {}, capability_status: 'unknown',
        })
      }
      setNewLabel(''); setNewSecret('')
      const refreshedProfiles = await load()
      const openCodeProfile = refreshedProfiles.find(item => item.provider === 'opencode')
      if (newProvider === 'opencode' && openCodeProfile) await scanProfile(openCodeProfile)
      showFeedback(t('configuracion.aiProfileTitle'), newProvider === 'opencode' ? t('configuracion.aiProfilesOpenCodeKeySaved') : t('configuracion.aiProfilesCreated', { name: label }), 'success')
    } catch (error: any) { showFeedback(t('configuracion.aiProfileTitle'), error.message, 'danger') } finally { setBusyId('') }
  }

  return (
    <section className="mt-3" aria-labelledby="ai-provider-profiles-title">
      {canEdit && <div className="border rounded-3 p-3 bg-light-subtle mb-3">
        <div className="small fw-bold mb-2"><KeyRound size={14} className="me-1" />{t('configuracion.addProvider')}</div>
        <Row className="g-2 align-items-end">
          <Col md={3}><Form.Label className="small fw-bold">{t('configuracion.provider')}</Form.Label><Form.Select aria-label={t('configuracion.provider')} value={newProvider} onChange={event => { const option = providerOptions.find(item => item.value === event.target.value); setNewProvider(event.target.value); setNewEndpoint(option?.defaultEndpoint || ''); setNewModel(option?.defaultModel || '') }}>{providerOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Form.Select></Col>
          <Col md={3}><Form.Label className="small fw-bold">{t('configuracion.profileLabel')}</Form.Label><Form.Control value={newLabel} onChange={event => setNewLabel(event.target.value)} placeholder={t('configuracion.aiProfilesMainPlaceholder')} autoComplete="off" /></Col>
          <Col md={3}><Form.Label className="small fw-bold">{t('configuracion.endpoint')}</Form.Label><Form.Control value={newEndpoint} onChange={event => setNewEndpoint(event.target.value)} disabled={newProvider === 'opencode'} /></Col>
          <Col md={3}><Form.Label className="small fw-bold">{t('configuracion.initialModel')}</Form.Label><Form.Control value={newModel} onChange={event => setNewModel(event.target.value)} placeholder={t('configuracion.modelIdPlaceholder')} /></Col>
          {providerOptions.find(item => item.value === newProvider)?.requiresApiKey && <Col md={8}><Form.Label className="small fw-bold">{t('configuracion.apiKeyName')}</Form.Label><Form.Control type="password" value={newSecret} onChange={event => setNewSecret(event.target.value)} autoComplete="off" /></Col>}
          <Col md={providerOptions.find(item => item.value === newProvider)?.requiresApiKey ? 4 : 12}><Button type="button" className="w-100" disabled={busyId === 'new' || (Boolean(providerOptions.find(item => item.value === newProvider)?.requiresApiKey) && !newSecret) || (newProvider !== 'opencode' && (!newModel || !newEndpoint))} onClick={() => void saveProvider()}><Check size={14} className="me-1" />{busyId === 'new' ? t('configuracion.saving') : newProvider === 'opencode' ? t('configuracion.saveApiKey') : t('configuracion.createProfile')}</Button></Col>
        </Row>
      </div>}

      <div className="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-2">
        <div><h6 id="ai-provider-profiles-title" className="fw-bold mb-1">{t('configuracion.providerProfiles')}</h6><p className="small text-muted mb-0">{t('configuracion.providerProfilesDesc')}</p></div>
        <Badge bg="primary">{profiles.filter(item => item.active_runtime).length ? t('configuracion.oneActiveProfile') : t('configuracion.noActiveProfile')}</Badge>
      </div>
      <div className="mobile-scroll-x border rounded-3 bg-white">
        <Table responsive hover size="sm" className="mb-0 align-middle">
          <thead><tr><th>{t('configuracion.profile')}</th><th>{t('configuracion.provider')}</th><th>{t('configuracion.initialModel')}</th><th>{t('configuracion.credential')}</th><th>{t('configuracion.status')}</th><th className="text-end">{t('configuracion.actions')}</th></tr></thead>
          <tbody>{profiles.map(profile => {
            const profileCredentials = credentialOptions(profile.provider)
            const models = modelOptions(profile)
            return <tr key={profile.id} className={profile.active_runtime ? 'table-primary' : ''}>
              <td className="fw-semibold">{profile.name} {profile.active_runtime && <Badge bg="success" className="ms-1">{t('configuracion.active')}</Badge>}</td>
              <td>{providerLabel(profile.provider)}</td>
              <td><Form.Select size="sm" value={profile.model} disabled={!canEdit || Boolean(busyId)} onChange={event => void updateProfile(profile, { model: event.target.value })}>{models.map(item => <option key={item.id || item.name} value={item.id || item.name}>{item.name || item.id}</option>)}</Form.Select></td>
              <td>{profileCredentials.length ? <Form.Select size="sm" aria-label={t('configuracion.aiProfilesCredentialFor', { name: profile.name })} value={profile.credential_id || ''} disabled={!canEdit || Boolean(busyId)} onChange={event => void updateProfile(profile, { credential_id: event.target.value || null })}><option value="">{t('configuracion.noCredential')}</option>{profileCredentials.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Form.Select> : <span className="text-muted">{t('configuracion.notRequired')}</span>}</td>
              <td><Badge bg={!profile.enabled ? 'secondary' : profile.capability_status === 'tested' ? 'success' : 'warning'}>{!profile.enabled ? t('configuracion.disabled') : profile.capability_status}</Badge></td>
              <td className="text-end"><div className="d-flex justify-content-end flex-wrap gap-2"><Button type="button" size="sm" variant="outline-secondary" aria-label={t('configuracion.edit')} disabled={!canEdit || Boolean(busyId)} onClick={() => beginEdit(profile)}><Pencil size={13} className="me-1" />{t('configuracion.edit')}</Button><Button type="button" size="sm" variant="outline-primary" aria-label={t('configuracion.scan')} disabled={!canEdit || busyId === `scan-${profile.id}`} onClick={() => void scanProfile(profile)}><RefreshCw size={13} className="me-1" />{t('configuracion.scan')}</Button>{!profile.active_runtime && <Button type="button" size="sm" variant="primary" aria-label={t('configuracion.activate')} disabled={!canEdit || busyId === `activate-${profile.id}`} onClick={() => void activate(profile)}><Play size={13} className="me-1" />{t('configuracion.activate')}</Button>}<Button type="button" size="sm" variant="link" className="p-0" aria-label={t('configuracion.test')} disabled={!canEdit || Boolean(busyId)} onClick={async () => { setBusyId(`test-${profile.id}`); try { await testAiProviderProfile(fetchWithAuth, profile.id); await load(); showFeedback(t('configuracion.aiProfileTitle'), t('configuracion.connectionVerified'), 'success') } catch (error: any) { showFeedback(t('configuracion.aiProfileTitle'), error.message, 'danger') } finally { setBusyId('') } }}>{t('configuracion.test')}</Button>{canEdit && !profile.active_runtime && <Button type="button" size="sm" variant="link" className="p-0 text-danger" aria-label={t('configuracion.disable')} disabled={Boolean(busyId)} onClick={async () => { if (!window.confirm(t('configuracion.aiProfilesDisableConfirm', { name: profile.name }))) return; setBusyId(`disable-${profile.id}`); try { await disableAiProviderProfile(fetchWithAuth, profile.id); await load() } catch (error: any) { showFeedback(t('configuracion.aiProfileTitle'), error.message, 'danger') } finally { setBusyId('') } }}>{t('configuracion.disable')}</Button>}</div></td>
            </tr>
          })}{!profiles.length && <tr><td colSpan={6} className="text-center text-muted py-3">{t('configuracion.noProfiles')}</td></tr>}</tbody>
          </Table>
      </div>
      <Modal show={Boolean(editingProfile)} onHide={() => !busyId && setEditingProfile(null)} centered>
        <Modal.Header closeButton><Modal.Title as="h5">{t('configuracion.editLabels')}</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-3"><Form.Label>{t('configuracion.profileLabel')}</Form.Label><Form.Control aria-label={t('configuracion.profileLabel')} value={editedProfileName} onChange={event => setEditedProfileName(event.target.value)} autoFocus /></Form.Group>
          {editingProfile?.credential_id && <Form.Group><Form.Label>{t('configuracion.credentialName')}</Form.Label><Form.Control aria-label={t('configuracion.credentialName')} value={editedCredentialLabel} onChange={event => setEditedCredentialLabel(event.target.value)} /><Form.Text>{t('configuracion.visibleLabelHint')}</Form.Text></Form.Group>}
        </Modal.Body>
        <Modal.Footer><Button variant="outline-secondary" onClick={() => setEditingProfile(null)} disabled={Boolean(busyId)}>{t('configuracion.cancel')}</Button><Button onClick={() => void saveNames()} disabled={Boolean(busyId)}>{busyId ? t('configuracion.saving') : t('configuracion.saveChanges')}</Button></Modal.Footer>
      </Modal>
    </section>
  )
}
