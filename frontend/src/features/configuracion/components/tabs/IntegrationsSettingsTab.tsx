import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Card, Col, Row, Spinner } from 'react-bootstrap'
import { Cpu, RefreshCw, ShieldCheck, Store } from 'lucide-react'
import { API_BASE } from '../../../../app/constants'
import { PremiumGate } from '../../../premium/PremiumGate'
import { featureEnabled, type FeatureLookup } from '../../../premium/featureAccess'
import { CasePortabilityPanel } from './CasePortabilityPanel'
import { ExtensionInstanceDetails } from './ExtensionInstanceDetails'

export type ExtensionKind = 'integration' | 'plugin'

export type ExtensionInstance = {
  id: string
  provider_id: string
  kind: ExtensionKind
  enabled: boolean
  status: string
  config_json: Record<string, any>
  secrets_configured: Record<string, any>
  last_check_at?: string
  last_error?: string
  audit_events?: Array<Record<string, any>>
}

export type ExtensionItem = {
  id: string
  kind: ExtensionKind
  display_name: string
  description?: string
  status: string
  capabilities: Array<{ id: string, label: string, level: string }>
  premium_feature?: string
  premium_required?: boolean
  builtin?: boolean
  installed: boolean
  instance?: ExtensionInstance | null
}

type OfficialStoreItem = {
  release_id?: string
  plugin_id: string
  version: string
  status: string
  changelog?: string
  manifest?: { name?: string, publisher?: string, compatibility?: { treseko_min?: string, treseko_max?: string }, permissions?: string[] }
}

type Props = {
  setConfigTab: (tab: any) => void
  hasSystemFeature?: FeatureLookup
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  showFeedback: (title: string, message: string, variant?: string) => void
  canAccessCapability: (capabilityId: any, level?: any) => boolean
}

const statusVariant = (status?: string) => {
  if (status === 'active') return 'success'
  if (status === 'configured' || status === 'installed') return 'primary'
  if (status === 'error' || status === 'revoked') return 'danger'
  return 'secondary'
}

const statusLabel = (status?: string) => ({
  active: 'Activo',
  configured: 'Configurado',
  installed: 'Instalado',
  disabled: 'Inactivo',
  error: 'Error',
  revoked: 'Revocado',
} as Record<string, string>)[status || ''] || 'Instalado'

const fallbackDescription = (item: ExtensionItem) => {
  if (item.description) return item.description
  if (item.id === 'redmine') return 'Integracion enterprise segura para vincular defectos y trazabilidad con Redmine.'
  if (item.id === 'jira') return 'Conector planificado para incidencias e historias en Jira Software.'
  if (item.id === 'github_issues') return 'Conector planificado para vincular bugs con GitHub Issues.'
  return item.kind === 'plugin' ? 'Plugin administrado por Treseko.' : 'Integracion administrada por Treseko.'
}

export function IntegrationsSettingsTab({
  setConfigTab,
  hasSystemFeature,
  fetchWithAuth,
  showFeedback,
  canAccessCapability,
}: Props) {
  const enterpriseEnabled = featureEnabled(hasSystemFeature, 'integrations.enterprise')
  const aiEnabled = featureEnabled(hasSystemFeature, 'ai.engine')
  const [items, setItems] = useState<ExtensionItem[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [configDraft, setConfigDraft] = useState({ url: '', project_key: '', notes: '' })
  const [secretDraft, setSecretDraft] = useState('')
  const [storeItems, setStoreItems] = useState<OfficialStoreItem[]>([])
  const [storeVisible, setStoreVisible] = useState(false)
  const [storeLoading, setStoreLoading] = useState(false)
  const [storePaired, setStorePaired] = useState(false)
  const [storeAudit, setStoreAudit] = useState<Array<{ id: string, accion: string, usuario_email?: string, fecha?: string, detalles?: Record<string, any> }>>([])

  const installedItems = useMemo(() => items.filter(item => item.installed && item.instance), [items])
  const builtinItems = useMemo(() => items.filter(item => item.installed && item.builtin && !item.instance), [items])
  const installedCount = installedItems.length + builtinItems.length
  const selected = useMemo(
    () => installedItems.find(item => item.id === selectedId) || installedItems[0],
    [installedItems, selectedId]
  )

  const loadCatalog = async () => {
    setLoading(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/extensions/catalog`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.detail || 'No se pudo cargar el catalogo.')
      const nextItems = data.items || []
      setItems(nextItems)
      const installed = nextItems.filter((item: ExtensionItem) => item.installed && item.instance)
      setSelectedId(prev => prev && installed.some((item: ExtensionItem) => item.id === prev) ? prev : installed[0]?.id || '')
    } catch (err: any) {
      showFeedback('Complementos', err?.message || 'No se pudieron cargar los complementos instalados.', 'danger')
    } finally {
      setLoading(false)
    }
  }

  const loadOfficialStore = async () => {
    setStoreLoading(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/plugins/store/catalog`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.detail || 'No se pudo consultar la tienda oficial.')
      setStoreItems(Array.isArray(data.items) ? data.items : [])
      if (canAccessCapability('plugins.configurar', 'edit')) {
        const connection = await fetchWithAuth(`${API_BASE}/plugins/store/connection`)
        const connectionData = await connection.json().catch(() => ({}))
        if (connection.ok) setStorePaired(Boolean(connectionData.paired))
      }
    } catch (err: any) {
      showFeedback('Tienda oficial', err?.message || 'La tienda no está disponible en este momento.', 'warning')
    } finally {
      setStoreLoading(false)
    }
  }

  useEffect(() => {
    loadCatalog()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const config = selected?.instance?.config_json || {}
    setConfigDraft({
      url: config.url || '',
      project_key: config.project_key || '',
      notes: config.notes || '',
    })
    setSecretDraft('')
    setStoreAudit([])
  }, [selected?.id, selected?.instance?.id])

  const request = async (url: string, options?: any) => {
    setSaving(true)
    try {
      const response = await fetchWithAuth(url, options)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.detail || 'No se pudo completar la accion.')
      await loadCatalog()
      return data
    } finally {
      setSaving(false)
    }
  }

  const pairOfficialStore = async () => {
    try {
      setSaving(true)
      const response = await fetchWithAuth(`${API_BASE}/plugins/store/register`, { method: 'POST' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.detail || 'No se pudo vincular esta instalación.')
      setStorePaired(true)
      showFeedback('Tienda vinculada', 'La instalación quedó vinculada con una identidad propia y cifrada.', 'success')
    } catch (err: any) {
      showFeedback('No se pudo vincular', err?.message || 'Revisa la disponibilidad de la tienda oficial.', 'danger')
    } finally {
      setSaving(false)
    }
  }

  const installStoreRelease = async (item: OfficialStoreItem) => {
    if (!item.release_id) return
    try {
      await request(`${API_BASE}/plugins/store/releases/${item.release_id}/install`, { method: 'POST', body: JSON.stringify({}) })
      showFeedback('Plugin instalado', `${item.manifest?.name || item.plugin_id} quedó instalado y deshabilitado hasta que lo habilites.`, 'success')
    } catch (err: any) {
      showFeedback('No se pudo instalar', err?.message || 'Revisa el pairing, permisos o licencia.', 'danger')
    }
  }

  const loadStoreAudit = async () => {
    if (!selected?.instance) return
    try {
      setSaving(true)
      const response = await fetchWithAuth(`${API_BASE}/plugins/store/${selected.instance.id}/audit`)
      const data = await response.json().catch(() => ([]))
      if (!response.ok) throw new Error(data?.detail || 'No se pudo consultar la auditoría.')
      setStoreAudit(Array.isArray(data) ? data : [])
    } catch (err: any) {
      showFeedback('Auditoría', err?.message || 'No se pudo cargar la auditoría del plugin.', 'danger')
    } finally { setSaving(false) }
  }

  const uninstallStorePlugin = async () => {
    if (!selected?.instance || !window.confirm(`¿Desinstalar ${selected.display_name}? Se conservará la auditoría.`)) return
    try {
      setSaving(true)
      const response = await fetchWithAuth(`${API_BASE}/plugins/store/${selected.instance.id}`, { method: 'DELETE' })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data?.detail || 'No se pudo desinstalar el plugin.')
      }
      setStoreAudit([])
      await loadCatalog()
      showFeedback('Plugin desinstalado', 'La instancia y sus secretos fueron eliminados; la auditoría se conserva.', 'success')
    } catch (err: any) {
      showFeedback('No se pudo desinstalar', err?.message || 'Revisa tus permisos.', 'danger')
    } finally { setSaving(false) }
  }

  const updateSelected = async () => {
    if (!selected?.instance) return
    try {
      await request(`${API_BASE}/extensions/${selected.instance.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ config_json: configDraft }),
      })
      showFeedback('Configuracion guardada', 'El complemento instalado fue actualizado.', 'success')
    } catch (err: any) {
      showFeedback('No se pudo guardar', err?.message || 'Revisa permisos o licencia.', 'danger')
    }
  }

  const saveSecret = async () => {
    if (!selected?.instance || !secretDraft.trim()) return
    try {
      await request(`${API_BASE}/extensions/${selected.instance.id}/secrets`, {
        method: 'POST',
        body: JSON.stringify({ secrets: { api_token: secretDraft } }),
      })
      setSecretDraft('')
      showFeedback('Secreto configurado', 'El secreto quedo marcado como configurado sin exponerse en pantalla.', 'success')
    } catch (err: any) {
      showFeedback('No se pudo guardar el secreto', err?.message || 'Revisa permisos o licencia.', 'danger')
    }
  }

  const toggleSelected = async () => {
    if (!selected?.instance) return
    const action = selected.instance.enabled ? 'disable' : 'enable'
    try {
      await request(`${API_BASE}/extensions/${selected.instance.id}/${action}`, { method: 'POST' })
      showFeedback('Complemento actualizado', `${selected.display_name} quedo ${action === 'enable' ? 'activo' : 'inactivo'}.`, 'success')
    } catch (err: any) {
      showFeedback('No se pudo actualizar', err?.message || 'Revisa permisos o licencia.', 'danger')
    }
  }

  const testSelected = async () => {
    if (!selected?.instance) return
    try {
      const data = await request(`${API_BASE}/extensions/${selected.instance.id}/test`, { method: 'POST' })
      showFeedback('Prueba de complemento', data?.message || 'Validacion completada.', data?.ok ? 'success' : 'warning')
    } catch (err: any) {
      showFeedback('No se pudo probar', err?.message || 'Revisa la configuracion.', 'danger')
    }
  }

  const canConfigureSelected = selected
    ? canAccessCapability(selected.kind === 'integration' ? 'integraciones.configurar' : 'plugins.configurar', 'edit')
    : false
  const canToggleSelected = selected
    ? canAccessCapability(selected.kind === 'integration' ? 'integraciones.configurar' : 'plugins.habilitar', 'edit')
    : false
  const canManageSecrets = selected
    ? canAccessCapability(selected.kind === 'integration' ? 'integraciones.secretos' : 'plugins.gestionar_secretos', 'edit')
    : false
  const premiumBlocked = Boolean(selected?.premium_required && selected?.premium_feature && !hasSystemFeature?.(selected.premium_feature))

  return (
    <div className="animate__animated animate__fadeIn">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h5 className="fw-bold text-secondary text-uppercase small m-0">Complementos instalados</h5>
        <div className="d-flex flex-wrap gap-2">
          <Button variant="outline-secondary" size="sm" className="fw-bold rounded-pill" onClick={loadCatalog} disabled={loading}>
            <RefreshCw size={14} className="me-1" /> Actualizar
          </Button>
          <Button variant="primary" size="sm" className="fw-bold rounded-pill" onClick={() => { setStoreVisible(value => !value); if (!storeVisible) loadOfficialStore() }}>
            <Store size={14} className="me-1" /> Tienda
          </Button>
        </div>
      </div>

      {!enterpriseEnabled && (
        <PremiumGate
          feature="integrations.enterprise"
          hasFeature={hasSystemFeature}
          title="Complementos enterprise Premium"
          description="Community puede ver capacidades bloqueadas. Premium habilita conectores enterprise, secretos y endpoints externos."
          mode="card"
          className="mb-3"
        />
      )}

      {storeVisible && (
        <Card className="border-0 shadow-sm rounded-4 mb-3">
          <Card.Body className="p-4">
            <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
              <div>
                <h6 className="fw-bold text-dark mb-1">Tienda oficial de Treseko</h6>
                <div className="small text-muted">Releases publicados por Treseko. La descarga y validación se realizan desde el backend.</div>
              </div>
              <div className="d-flex gap-2">
                {canAccessCapability('plugins.configurar', 'edit') && <Button variant={storePaired ? 'outline-success' : 'outline-primary'} size="sm" onClick={pairOfficialStore} disabled={saving || storePaired}>
                  <ShieldCheck size={14} className="me-1" /> {storePaired ? 'Tienda vinculada' : 'Vincular tienda'}
                </Button>}
                <Button variant="outline-secondary" size="sm" onClick={loadOfficialStore} disabled={storeLoading}><RefreshCw size={14} className="me-1" /> Actualizar</Button>
              </div>
            </div>
            {storeLoading ? <div className="py-3 text-center"><Spinner size="sm" /></div> : storeItems.length === 0 ? (
              <div className="small text-muted py-2">No hay releases oficiales disponibles para esta instalación.</div>
            ) : (
              <Row className="g-3">
                {storeItems.map(item => <Col md={6} key={item.release_id || item.plugin_id}>
                  <div className="border rounded-3 p-3 h-100">
                    <div className="d-flex justify-content-between gap-2"><strong>{item.manifest?.name || item.plugin_id}</strong><Badge bg="success">v{item.version}</Badge></div>
                    <div className="small text-muted mt-1">{item.manifest?.publisher || 'Treseko'} · Compatible con {item.manifest?.compatibility?.treseko_min || '?'} a {item.manifest?.compatibility?.treseko_max || '?'}</div>
                    {item.changelog && <div className="small mt-2">{item.changelog}</div>}
                    <div className="d-flex flex-wrap gap-2 mt-3">
                      <Button size="sm" variant="primary" onClick={() => installStoreRelease(item)} disabled={saving || !storePaired || !canAccessCapability('plugins.instalar', 'edit')}>
                        Instalar
                      </Button>
                      {!storePaired && <span className="small text-muted align-self-center">Vincula la tienda antes de instalar.</span>}
                    </div>
                  </div>
                </Col>)}
              </Row>
            )}
          </Card.Body>
        </Card>
      )}

      <CasePortabilityPanel
        fetchWithAuth={fetchWithAuth}
        showFeedback={showFeedback}
        canEdit={canAccessCapability('plugins.provider.case_portability.importar_casos', 'edit')}
      />

      <Row className="g-3 mb-3">
        <Col xl={4} lg={6}>
          <Card className="border-success-subtle shadow-sm h-100 rounded-4">
            <Card.Body className="p-4 d-flex flex-column">
              <div className="d-flex justify-content-between align-items-start mb-3">
                <div className="bg-info bg-opacity-10 p-2 rounded text-info"><Cpu size={24} /></div>
                <Badge bg={aiEnabled ? 'success' : 'secondary'} className="px-2 py-1 shadow-sm">{aiEnabled ? 'Instalado' : 'Bloqueado'}</Badge>
              </div>
              <h6 className="fw-bold text-dark">Motor LLM</h6>
              <p className="small text-muted mb-4">Configuracion de modelos, tokens y workflows IA del sistema.</p>
              <Button variant="outline-dark" size="sm" className="mt-auto fw-bold rounded-pill shadow-none" disabled={!aiEnabled} onClick={() => setConfigTab('ai')}>
                Tokens y Modelos
              </Button>
            </Card.Body>
          </Card>
        </Col>

      </Row>

      <Card className="border-0 shadow-sm rounded-4">
        <Card.Body className="p-4">
          <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
            <div>
              <h6 className="fw-bold text-dark mb-1">Administracion de complementos instalados</h6>
              <div className="small text-muted">Solo usuarios con RBAC de integraciones/plugins pueden configurar, habilitar o guardar secretos.</div>
            </div>
            <Badge bg="primary" className="p-2">{installedCount} instalados</Badge>
          </div>

          {!loading && builtinItems.length > 0 && (
            <div className="border rounded-3 bg-light px-3 py-2 mb-3">
              <div className="small fw-bold text-dark mb-1">Incluidos con Treseko</div>
              <div className="d-flex flex-wrap gap-2 align-items-center">
                {builtinItems.map(item => <Badge key={item.id} bg="success">{item.display_name}</Badge>)}
                <span className="small text-muted">Ya están disponibles y no requieren instalación desde la tienda.</span>
              </div>
            </div>
          )}

          {loading ? (
            <div className="py-4 text-center"><Spinner /></div>
          ) : installedItems.length === 0 ? (
            <div className="text-center text-muted small py-4">
              No hay complementos adicionales instalados desde la tienda. Abre la tienda para instalar los disponibles.
            </div>
          ) : (
            <Row className="g-3">
              <Col xl={4}>
                <div className="d-grid gap-2">
                  {installedItems.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      className={`extension-installed-picker text-start border rounded-3 p-3 bg-white ${selected?.id === item.id ? 'is-selected' : ''}`}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <div className="d-flex justify-content-between gap-2">
                        <strong>{item.display_name}</strong>
                        <Badge bg={statusVariant(item.instance?.status)}>{statusLabel(item.instance?.status)}</Badge>
                      </div>
                      <div className="small text-muted mt-1">{fallbackDescription(item)}</div>
                    </button>
                  ))}
                </div>
              </Col>

              <Col xl={8}>
                {selected?.instance && <ExtensionInstanceDetails
                  selected={selected}
                  premiumBlocked={premiumBlocked}
                  hasSystemFeature={hasSystemFeature}
                  configDraft={configDraft}
                  setConfigDraft={setConfigDraft}
                  secretDraft={secretDraft}
                  setSecretDraft={setSecretDraft}
                  storeAudit={storeAudit}
                  saving={saving}
                  canConfigure={canConfigureSelected}
                  canManageSecrets={canManageSecrets}
                  canToggle={canToggleSelected}
                  canAccessCapability={canAccessCapability}
                  onSave={updateSelected}
                  onTest={testSelected}
                  onSaveSecret={saveSecret}
                  onToggle={toggleSelected}
                  onUninstall={uninstallStorePlugin}
                  onLoadAudit={loadStoreAudit}
                />}
              </Col>
            </Row>
          )}
        </Card.Body>
      </Card>
    </div>
  )
}
