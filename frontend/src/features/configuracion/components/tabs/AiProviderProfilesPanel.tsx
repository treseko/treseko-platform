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
  useEffect(() => { void load().catch(error => showFeedback('Perfiles IA', error.message, 'danger')) }, [])

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
      if (!response.ok || !['ok', 'empty'].includes(result.status)) throw new Error(result.detail || 'No se pudo actualizar el catálogo.')
      const models = Array.isArray(result.models) ? result.models : []
      setCatalogs(previous => ({ ...previous, [profile.id]: models }))
      if (profile.active_runtime) onActiveConfig({ ...activeConfig, model_catalog: models, last_model_scan_at: result.scanned_at, last_model_scan_status: result.status })
      showFeedback('Modelos IA', result.detail || `${models.length} modelos disponibles.`, result.status === 'ok' ? 'success' : 'warning')
    } catch (error: any) {
      showFeedback('Modelos IA', error.message || 'No se pudo actualizar el catálogo.', 'warning')
    } finally { setBusyId('') }
  }

  const updateProfile = async (profile: any, patch: any) => {
    setBusyId(`profile-${profile.id}`)
    try {
      const saved = await updateAiProviderProfile(fetchWithAuth, profile.id, patch)
      setProfiles(items => items.map(item => item.id === profile.id ? { ...item, ...saved } : item))
      if (profile.active_runtime) onActiveConfig({ ...activeConfig, model: saved.model, llm_endpoint: saved.endpoint, active_provider_profile_id: saved.id })
      showFeedback('Perfil IA', patch.model ? 'Modelo del perfil actualizado.' : 'Perfil actualizado.', 'success')
    } catch (error: any) { showFeedback('Perfil IA', error.message, 'danger') } finally { setBusyId('') }
  }

  const activate = async (profile: any) => {
    setBusyId(`activate-${profile.id}`)
    try {
      const result = await activateAiProviderProfile(fetchWithAuth, profile.id)
      onActiveConfig(result.config)
      await load()
      showFeedback('Perfil IA', `${profile.name} está activo para las nuevas ejecuciones.`, 'success')
    } catch (error: any) { showFeedback('Perfil IA', error.message, 'danger') } finally { setBusyId('') }
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
      showFeedback('Perfil IA', 'Completá los nombres que querés guardar.', 'warning')
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
      showFeedback('Perfil IA', 'Nombres actualizados.', 'success')
    } catch (error: any) { showFeedback('Perfil IA', error.message, 'danger') } finally { setBusyId('') }
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
      showFeedback('Perfil IA', newProvider === 'opencode' ? 'Key OpenCode guardada. Elegí la credencial que usará el perfil.' : `Perfil ${label} creado.`, 'success')
    } catch (error: any) { showFeedback('Perfil IA', error.message, 'danger') } finally { setBusyId('') }
  }

  return (
    <section className="mt-3" aria-labelledby="ai-provider-profiles-title">
      {canEdit && <div className="border rounded-3 p-3 bg-light-subtle mb-3">
        <div className="small fw-bold mb-2"><KeyRound size={14} className="me-1" />Agregar proveedor</div>
        <Row className="g-2 align-items-end">
          <Col md={3}><Form.Label className="small fw-bold">Proveedor</Form.Label><Form.Select value={newProvider} onChange={event => { const option = providerOptions.find(item => item.value === event.target.value); setNewProvider(event.target.value); setNewEndpoint(option?.defaultEndpoint || ''); setNewModel(option?.defaultModel || '') }}>{providerOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Form.Select></Col>
          <Col md={3}><Form.Label className="small fw-bold">Etiqueta del perfil</Form.Label><Form.Control value={newLabel} onChange={event => setNewLabel(event.target.value)} placeholder="Principal…" autoComplete="off" /></Col>
          <Col md={3}><Form.Label className="small fw-bold">Endpoint</Form.Label><Form.Control value={newEndpoint} onChange={event => setNewEndpoint(event.target.value)} disabled={newProvider === 'opencode'} /></Col>
          <Col md={3}><Form.Label className="small fw-bold">Modelo inicial</Form.Label><Form.Control value={newModel} onChange={event => setNewModel(event.target.value)} placeholder="ID del modelo…" /></Col>
          {providerOptions.find(item => item.value === newProvider)?.requiresApiKey && <Col md={8}><Form.Label className="small fw-bold">API key</Form.Label><Form.Control type="password" value={newSecret} onChange={event => setNewSecret(event.target.value)} autoComplete="off" /></Col>}
          <Col md={providerOptions.find(item => item.value === newProvider)?.requiresApiKey ? 4 : 12}><Button type="button" className="w-100" disabled={busyId === 'new' || (Boolean(providerOptions.find(item => item.value === newProvider)?.requiresApiKey) && !newSecret) || (newProvider !== 'opencode' && (!newModel || !newEndpoint))} onClick={() => void saveProvider()}><Check size={14} className="me-1" />{busyId === 'new' ? 'Guardando…' : newProvider === 'opencode' ? 'Guardar API key' : 'Crear perfil'}</Button></Col>
        </Row>
      </div>}

      <div className="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-2">
        <div><h6 id="ai-provider-profiles-title" className="fw-bold mb-1">Perfiles de proveedor</h6><p className="small text-muted mb-0">El modelo y la credencial se administran desde cada fila.</p></div>
        <Badge bg="primary">{profiles.filter(item => item.active_runtime).length ? '1 perfil activo' : 'Sin perfil activo'}</Badge>
      </div>
      <div className="mobile-scroll-x border rounded-3 bg-white">
        <Table responsive hover size="sm" className="mb-0 align-middle">
          <thead><tr><th>Perfil</th><th>Proveedor</th><th>Modelo</th><th>Credencial</th><th>Estado</th><th className="text-end">Acciones</th></tr></thead>
          <tbody>{profiles.map(profile => {
            const profileCredentials = credentialOptions(profile.provider)
            const models = modelOptions(profile)
            return <tr key={profile.id} className={profile.active_runtime ? 'table-primary' : ''}>
              <td className="fw-semibold">{profile.name} {profile.active_runtime && <Badge bg="success" className="ms-1">Activo</Badge>}</td>
              <td>{providerLabel(profile.provider)}</td>
              <td><Form.Select size="sm" value={profile.model} disabled={!canEdit || Boolean(busyId)} onChange={event => void updateProfile(profile, { model: event.target.value })}>{models.map(item => <option key={item.id || item.name} value={item.id || item.name}>{item.name || item.id}</option>)}</Form.Select></td>
              <td>{profileCredentials.length ? <Form.Select size="sm" value={profile.credential_id || ''} disabled={!canEdit || Boolean(busyId)} onChange={event => void updateProfile(profile, { credential_id: event.target.value || null })}><option value="">Sin credencial</option>{profileCredentials.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Form.Select> : <span className="text-muted">No requiere</span>}</td>
              <td><Badge bg={!profile.enabled ? 'secondary' : profile.capability_status === 'tested' ? 'success' : 'warning'}>{!profile.enabled ? 'Deshabilitado' : profile.capability_status}</Badge></td>
              <td className="text-end"><div className="d-flex justify-content-end flex-wrap gap-2"><Button type="button" size="sm" variant="outline-secondary" disabled={!canEdit || Boolean(busyId)} onClick={() => beginEdit(profile)}><Pencil size={13} className="me-1" />Editar</Button><Button type="button" size="sm" variant="outline-primary" disabled={!canEdit || busyId === `scan-${profile.id}`} onClick={() => void scanProfile(profile)}><RefreshCw size={13} className="me-1" />Scan</Button>{!profile.active_runtime && <Button type="button" size="sm" variant="primary" disabled={!canEdit || busyId === `activate-${profile.id}`} onClick={() => void activate(profile)}><Play size={13} className="me-1" />Activar</Button>}<Button type="button" size="sm" variant="link" className="p-0" disabled={!canEdit || Boolean(busyId)} onClick={async () => { setBusyId(`test-${profile.id}`); try { await testAiProviderProfile(fetchWithAuth, profile.id); await load(); showFeedback('Perfil IA', 'Conexión y modelo verificados.', 'success') } catch (error: any) { showFeedback('Perfil IA', error.message, 'danger') } finally { setBusyId('') } }}>Probar</Button>{canEdit && !profile.active_runtime && <Button type="button" size="sm" variant="link" className="p-0 text-danger" disabled={Boolean(busyId)} onClick={async () => { if (!window.confirm(`¿Deshabilitar el perfil ${profile.name}?`)) return; setBusyId(`disable-${profile.id}`); try { await disableAiProviderProfile(fetchWithAuth, profile.id); await load() } catch (error: any) { showFeedback('Perfil IA', error.message, 'danger') } finally { setBusyId('') } }}>Deshabilitar</Button>}</div></td>
            </tr>
          })}{!profiles.length && <tr><td colSpan={6} className="text-center text-muted py-3">Todavía no hay perfiles configurados.</td></tr>}</tbody>
        </Table>
      </div>
      <Modal show={Boolean(editingProfile)} onHide={() => !busyId && setEditingProfile(null)} centered>
        <Modal.Header closeButton><Modal.Title as="h5">Editar etiquetas</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-3"><Form.Label>Nombre del perfil</Form.Label><Form.Control value={editedProfileName} onChange={event => setEditedProfileName(event.target.value)} autoFocus /></Form.Group>
          {editingProfile?.credential_id && <Form.Group><Form.Label>Nombre de la credencial</Form.Label><Form.Control value={editedCredentialLabel} onChange={event => setEditedCredentialLabel(event.target.value)} /><Form.Text>Solo cambia la etiqueta visible; la API key no se modifica.</Form.Text></Form.Group>}
        </Modal.Body>
        <Modal.Footer><Button variant="outline-secondary" onClick={() => setEditingProfile(null)} disabled={Boolean(busyId)}>Cancelar</Button><Button onClick={() => void saveNames()} disabled={Boolean(busyId)}>{busyId ? 'Guardando…' : 'Guardar cambios'}</Button></Modal.Footer>
      </Modal>
    </section>
  )
}
