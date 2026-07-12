import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Card, Col, Form, Row, Spinner } from 'react-bootstrap'
import { Cpu, KeyRound, Plug, Power, RefreshCw, Settings2, ShieldCheck, Store, Webhook } from 'lucide-react'
import { API_BASE } from '../../../../app/constants'
import { PremiumGate } from '../../../premium/PremiumGate'
import { featureEnabled, type FeatureLookup } from '../../../premium/featureAccess'

type ExtensionKind = 'integration' | 'plugin'

type ExtensionInstance = {
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

type ExtensionItem = {
  id: string
  kind: ExtensionKind
  display_name: string
  description?: string
  status: string
  capabilities: Array<{ id: string, label: string, level: string }>
  premium_feature?: string
  premium_required?: boolean
  installed: boolean
  instance?: ExtensionInstance | null
}

type Props = {
  setActiveTab: (tab: any) => void
  setConfigTab: (tab: any) => void
  hasSystemFeature?: FeatureLookup
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  showFeedback: (title: string, message: string, variant?: string) => void
  canAccessCapability: (capabilityId: any, level?: any) => boolean
}

const statusVariant = (status?: string) => {
  if (status === 'active') return 'success'
  if (status === 'configured' || status === 'installed') return 'primary'
  if (status === 'error') return 'danger'
  return 'secondary'
}

const statusLabel = (status?: string) => ({
  active: 'Activo',
  configured: 'Configurado',
  installed: 'Instalado',
  disabled: 'Inactivo',
  error: 'Error',
} as Record<string, string>)[status || ''] || 'Instalado'

const fallbackDescription = (item: ExtensionItem) => {
  if (item.description) return item.description
  if (item.id === 'redmine') return 'Integracion enterprise segura para vincular defectos y trazabilidad con Redmine.'
  if (item.id === 'jira') return 'Conector planificado para incidencias e historias en Jira Software.'
  if (item.id === 'github_issues') return 'Conector planificado para vincular bugs con GitHub Issues.'
  return item.kind === 'plugin' ? 'Plugin administrado por Treseko.' : 'Integracion administrada por Treseko.'
}

export function IntegrationsSettingsTab({
  setActiveTab,
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

  const installedItems = useMemo(() => items.filter(item => item.installed && item.instance), [items])
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
          <Button variant="primary" size="sm" className="fw-bold rounded-pill" onClick={() => setActiveTab('redmine')}>
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

      <Row className="g-3 mb-3">
        <Col xl={4} lg={6}>
          <Card className="border-success-subtle shadow-sm h-100 rounded-4">
            <Card.Body className="p-4 d-flex flex-column">
              <div className="d-flex justify-content-between align-items-start mb-3">
                <div className="bg-danger bg-opacity-10 p-2 rounded text-danger"><Plug size={24} /></div>
                <Badge bg={installedItems.some(item => item.id === 'redmine') ? 'success' : 'secondary'} className="px-2 py-1 shadow-sm">
                  {installedItems.some(item => item.id === 'redmine') ? 'Instalado' : 'No instalado'}
                </Badge>
              </div>
              <h6 className="fw-bold text-dark">Redmine</h6>
              <p className="small text-muted mb-4">Se instala desde Complementos y se administra aqui cuando existe una instancia.</p>
              <Button variant="outline-dark" size="sm" className="mt-auto fw-bold rounded-pill shadow-none" onClick={() => setActiveTab('redmine')}>
                Abrir Complementos
              </Button>
            </Card.Body>
          </Card>
        </Col>

        <Col xl={4} lg={6}>
          <Card className="border-success-subtle shadow-sm h-100 rounded-4">
            <Card.Body className="p-4 d-flex flex-column">
              <div className="d-flex justify-content-between align-items-start mb-3">
                <div className="bg-info bg-opacity-10 p-2 rounded text-info"><Cpu size={24} /></div>
                <Badge bg={aiEnabled ? 'success' : 'secondary'} className="px-2 py-1 shadow-sm">{aiEnabled ? 'Disponible' : 'Bloqueado'}</Badge>
              </div>
              <h6 className="fw-bold text-dark">Motor LLM</h6>
              <p className="small text-muted mb-4">Configuracion de modelos, tokens y workflows IA del sistema.</p>
              <Button variant="outline-dark" size="sm" className="mt-auto fw-bold rounded-pill shadow-none" disabled={!aiEnabled} onClick={() => setConfigTab('ai')}>
                Tokens y Modelos
              </Button>
            </Card.Body>
          </Card>
        </Col>

        <Col xl={4} lg={6}>
          <Card className="border-light shadow-sm h-100 rounded-4 bg-light bg-opacity-50">
            <Card.Body className="p-4 d-flex flex-column opacity-75">
              <div className="d-flex justify-content-between align-items-start mb-3">
                <div className="bg-dark p-2 rounded text-white"><Webhook size={24} /></div>
                <Badge bg="secondary" className="px-2 py-1 shadow-sm">Proximamente</Badge>
              </div>
              <h6 className="fw-bold text-dark">Git / Webhooks</h6>
              <p className="small text-muted mb-4">Mapeo automatico de commits a versiones y builds.</p>
              <Button variant="light" size="sm" className="mt-auto fw-bold rounded-pill border shadow-none" disabled>Configurar Webhooks</Button>
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
            <Badge bg="primary" className="p-2">{installedItems.length} instalados</Badge>
          </div>

          {loading ? (
            <div className="py-4 text-center"><Spinner /></div>
          ) : installedItems.length === 0 ? (
            <div className="text-center text-muted small py-4">
              No hay complementos instalados. Abre la tienda para instalar los disponibles.
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
                {selected?.instance && (
                  <div className="d-grid gap-4">
                    {premiumBlocked && selected.premium_feature && (
                      <PremiumGate
                        feature={selected.premium_feature}
                        hasFeature={hasSystemFeature}
                        title="Complemento Premium"
                        description="Esta instancia requiere licencia Treseko Premium para operar."
                        mode="card"
                      />
                    )}

                    <section>
                      <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
                        <h6 className="fw-bold text-secondary small text-uppercase m-0"><Settings2 size={14} className="me-1" /> Configuracion</h6>
                        {selected.instance.last_error && <Badge bg="danger">{selected.instance.last_error}</Badge>}
                      </div>
                      <Row className="g-2">
                        <Col md={7}>
                          <Form.Label className="small fw-bold text-muted">URL del servicio</Form.Label>
                          <Form.Control
                            size="sm"
                            value={configDraft.url}
                            placeholder="https://redmine.ejemplo.local"
                            onChange={(event) => setConfigDraft(prev => ({ ...prev, url: event.target.value }))}
                            disabled={!canConfigureSelected || premiumBlocked}
                          />
                        </Col>
                        <Col md={5}>
                          <Form.Label className="small fw-bold text-muted">Proyecto / clave</Form.Label>
                          <Form.Control
                            size="sm"
                            value={configDraft.project_key}
                            placeholder="QA, APP, DEMO..."
                            onChange={(event) => setConfigDraft(prev => ({ ...prev, project_key: event.target.value }))}
                            disabled={!canConfigureSelected || premiumBlocked}
                          />
                        </Col>
                        <Col xs={12}>
                          <Form.Label className="small fw-bold text-muted">Notas internas</Form.Label>
                          <Form.Control
                            as="textarea"
                            rows={2}
                            size="sm"
                            value={configDraft.notes}
                            placeholder="Uso previsto, responsable o condiciones de operacion."
                            onChange={(event) => setConfigDraft(prev => ({ ...prev, notes: event.target.value }))}
                            disabled={!canConfigureSelected || premiumBlocked}
                          />
                        </Col>
                      </Row>
                      <div className="d-flex flex-wrap gap-2 mt-2">
                        <Button size="sm" variant="primary" className="fw-bold" onClick={updateSelected} disabled={saving || !canConfigureSelected || premiumBlocked}>
                          Guardar configuracion
                        </Button>
                        <Button size="sm" variant="outline-secondary" className="fw-bold" onClick={testSelected} disabled={saving || premiumBlocked}>
                          <RefreshCw size={14} className="me-1" /> Probar
                        </Button>
                      </div>
                    </section>

                    <section>
                      <h6 className="fw-bold text-secondary small text-uppercase"><KeyRound size={14} className="me-1" /> Secretos</h6>
                      <div className="d-flex flex-column flex-md-row gap-2">
                        <Form.Control
                          size="sm"
                          type="password"
                          value={secretDraft}
                          placeholder="API token o secreto"
                          onChange={(event) => setSecretDraft(event.target.value)}
                          disabled={!canManageSecrets || premiumBlocked}
                        />
                        <Button size="sm" variant="outline-primary" className="fw-bold text-nowrap" onClick={saveSecret} disabled={saving || !canManageSecrets || !secretDraft.trim() || premiumBlocked}>
                          Guardar secreto
                        </Button>
                      </div>
                      <div className="d-flex flex-wrap gap-1 mt-2">
                        {Object.entries(selected.instance.secrets_configured || {}).map(([key, value]: any) => (
                          <Badge key={key} bg="light" text="dark" className="border">
                            {key}: {value?.fingerprint ? `huella ...${value.fingerprint}` : 'configurado'}
                          </Badge>
                        ))}
                        {Object.keys(selected.instance.secrets_configured || {}).length === 0 && <span className="small text-muted">Sin secretos configurados.</span>}
                      </div>
                    </section>

                    <section className="d-flex flex-wrap gap-2">
                      <Button variant={selected.instance.enabled ? 'outline-danger' : 'success'} size="sm" className="fw-bold" onClick={toggleSelected} disabled={saving || !canToggleSelected || premiumBlocked}>
                        <Power size={14} className="me-1" /> {selected.instance.enabled ? 'Deshabilitar' : 'Habilitar'}
                      </Button>
                    </section>

                    <section>
                      <h6 className="fw-bold text-secondary small text-uppercase"><ShieldCheck size={14} className="me-1" /> Auditoria reciente</h6>
                      <div className="small text-muted d-grid gap-1">
                        {(selected.instance.audit_events || []).slice(0, 5).map((event, index) => (
                          <div key={`${event.at}-${index}`} className="border rounded-3 px-2 py-1 bg-light">
                            <strong>{event.action}</strong> por {event.actor || 'sistema'} · {event.at || 'sin fecha'}
                          </div>
                        ))}
                        {(selected.instance.audit_events || []).length === 0 && <span>Sin eventos registrados.</span>}
                      </div>
                    </section>
                  </div>
                )}
              </Col>
            </Row>
          )}
        </Card.Body>
      </Card>
    </div>
  )
}
