import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Col, Form, ProgressBar, Row, Spinner, Table } from 'react-bootstrap'
import { Crown, Download, KeyRound, Lock, ShieldCheck, Upload } from 'lucide-react'
import { API_BASE } from '../../../../app/constants'
import { humanizePremiumError } from '../../../premium/featureAccess'

type LicenseSettingsTabProps = {
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  showFeedback: (title: string, message: string, variant?: string) => void
  canEditLicense: boolean
  selectedOrganizationId?: string | null
}

type LicenseState = {
  edition: 'community' | 'premium'
  state: string
  valid: boolean
  reason?: string
  limits: Record<string, number>
  enabled_features: string[]
  update_channel: string
  plan_id?: string | null
  plan_name?: string | null
  plan_version?: string | null
  plan_custom?: boolean
  issued_at?: string | null
  valid_until?: string | null
  activated_at?: string | null
  last_check_at?: string | null
  next_check_at?: string | null
  grace_until?: string | null
  verification_interval_days?: number | null
  grace_period_days?: number | null
  license?: Record<string, any> | null
}

type FeatureRow = {
  id: string
  label: string
  category: string
  edition: 'community' | 'premium'
  enabled: boolean
}

type LicenseUsageItem = {
  used: number
  limit?: number | null
  percent: number
}

type LicenseUsageState = {
  organization_id?: string | null
  usage: Record<string, LicenseUsageItem>
}

const COMMUNITY_LIMITS_BASE: Record<string, number> = {
  max_organizations: 1,
  max_users: 5,
  max_projects: 3,
  max_workers: 1,
  max_automated_runs_per_week: 50,
  max_ai_runs_per_week: 10,
  max_storage_mb: 1024,
}

const LIMIT_LABELS: Record<string, string> = {
  max_organizations: 'Soluciones / clientes',
  max_users: 'Usuarios',
  max_projects: 'Proyectos',
  max_workers: 'Workers locales',
  max_automated_runs_per_week: 'Automatizadas por semana',
  max_ai_runs_per_week: 'IA por semana',
  max_storage_mb: 'Almacenamiento',
}

const LIMIT_NOTES: Record<string, string> = {
  max_automated_runs_per_week: 'Cuenta automatizadas externas y locales en los ultimos 7 dias.',
  max_ai_runs_per_week: 'Cuenta ejecuciones IA en los ultimos 7 dias.',
  max_workers: 'Community permite un worker local.',
  max_storage_mb: 'Total de evidencias y adjuntos de la instancia.',
}

type TrustKeyringInfo = {
  kind: 'license' | 'license_server' | 'update'
  algorithm: string
  configured: boolean
  source: 'embedded' | 'development_override'
  development_override_enabled: boolean
  key_count: number
  fingerprints: string[]
  errors: string[]
}

type TrustState = {
  license_keyring: TrustKeyringInfo
  server_response_keyring: TrustKeyringInfo
  update_keyring: TrustKeyringInfo
}

const emptyLicenseState: LicenseState = {
  edition: 'community',
  state: 'community',
  valid: false,
  limits: {},
  enabled_features: [],
  update_channel: 'community-stable',
  plan_id: 'community',
  plan_name: 'Community',
  plan_version: null,
  plan_custom: false,
  issued_at: null,
  valid_until: null,
  activated_at: null,
  last_check_at: null,
  next_check_at: null,
  grace_until: null,
  verification_interval_days: null,
  grace_period_days: null,
  license: null,
}

const emptyTrustState: TrustState = {
  license_keyring: {
    kind: 'license',
    algorithm: 'ed25519',
    configured: false,
    source: 'embedded',
    development_override_enabled: false,
    key_count: 0,
    fingerprints: [],
    errors: [],
  },
  server_response_keyring: {
    kind: 'license_server',
    algorithm: 'ed25519',
    configured: false,
    source: 'embedded',
    development_override_enabled: false,
    key_count: 0,
    fingerprints: [],
    errors: [],
  },
  update_keyring: {
    kind: 'update',
    algorithm: 'ed25519',
    configured: false,
    source: 'embedded',
    development_override_enabled: false,
    key_count: 0,
    fingerprints: [],
    errors: [],
  },
}

function editionBadge(edition: string) {
  return edition === 'premium' ? 'warning' : 'primary'
}

function stateBadge(state: string) {
  if (state === 'active') return 'success'
  if (state === 'expired') return 'danger'
  if (state === 'invalid') return 'danger'
  if (state === 'revoked') return 'danger'
  if (state === 'unavailable') return 'warning'
  if (state === 'community') return 'primary'
  return 'secondary'
}

function sourceLabel(source: TrustKeyringInfo['source']) {
  return source === 'development_override' ? 'Configuracion temporal' : 'Incluido en Treseko'
}

function stateLabel(state: string) {
  const labels: Record<string, string> = {
    active: 'Activa',
    community: 'Community',
    expired: 'Vencida',
    invalid: 'Invalida',
    revoked: 'Revocada',
    unavailable: 'No disponible',
  }
  return labels[state] || state
}

function editionLabel(edition: LicenseState['edition']) {
  return edition === 'premium' ? 'Premium' : 'Community'
}

function planLabel(license: LicenseState) {
  if (license.plan_name) return license.plan_name
  if (license.edition === 'premium') return 'Premium'
  return 'Community'
}

function updateChannelLabel(channel?: string) {
  if (!channel) return 'Canal no definido'
  if (channel.includes('stable')) return 'Canal estable'
  if (channel.includes('rc')) return 'Canal RC'
  if (channel.includes('beta')) return 'Canal beta'
  return channel
}

function formatLicenseDate(value?: string | null) {
  if (!value) return 'No disponible'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function daysUntil(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return Math.ceil((date.getTime() - Date.now()) / 86400000)
}

function stateMessage(license: LicenseState) {
  if (license.state === 'active') return null
  if (license.state === 'expired') return 'La licencia Premium vencio. Treseko conserva los datos historicos y opera con permisos Community.'
  if (license.state === 'revoked') return 'La licencia Premium fue revocada. El documento queda guardado como trazabilidad y las funciones Premium quedan bloqueadas.'
  if (license.state === 'invalid') return 'La licencia instalada no pudo validarse. Treseko no habilita Premium hasta instalar un archivo firmado valido.'
  if (license.state === 'community') return 'Treseko esta operando en Community. Puedes instalar un license.treseko Premium firmado cuando corresponda.'
  return license.reason || null
}

function formatLimitValue(key: string, value?: number) {
  if (value === undefined || value === null) return 'Sin definir'
  if (key === 'max_storage_mb') return `${value.toLocaleString('es-AR')} MB`
  return value.toLocaleString('es-AR')
}

function formatUsageValue(key: string, value?: number) {
  if (value === undefined || value === null) return '0'
  if (key === 'max_storage_mb') return `${value.toLocaleString('es-AR')} MB`
  return value.toLocaleString('es-AR')
}

function usageVariant(percent: number) {
  if (percent >= 80) return 'danger'
  if (percent >= 60) return 'warning'
  return 'success'
}

function featureIsActive(feature: FeatureRow) {
  return feature.enabled || feature.edition === 'community'
}

async function readJsonResponse(response: Response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data?.detail || 'No se pudo completar la operacion')
  }
  return data
}

export function LicenseSettingsTab({ fetchWithAuth, showFeedback, canEditLicense, selectedOrganizationId }: LicenseSettingsTabProps) {
  const [license, setLicense] = useState<LicenseState>(emptyLicenseState)
  const [trust, setTrust] = useState<TrustState>(emptyTrustState)
  const [features, setFeatures] = useState<FeatureRow[]>([])
  const [usage, setUsage] = useState<LicenseUsageState>({ usage: {} })
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState(false)
  const [licenseJson, setLicenseJson] = useState('')
  const [licenseFileName, setLicenseFileName] = useState('')
  const [installDiagnostic, setInstallDiagnostic] = useState('')

  const premiumFeatures = useMemo(() => features.filter(feature => feature.edition === 'premium'), [features])
  const communityFeatures = useMemo(() => features.filter(feature => feature.edition === 'community'), [features])
  const limitRows = useMemo(() => {
    const keys = Array.from(new Set([...Object.keys(COMMUNITY_LIMITS_BASE), ...Object.keys(license.limits || {})]))
    return keys.map(key => ({
      key,
      label: LIMIT_LABELS[key] || key.replaceAll('_', ' '),
      currentValue: license.limits?.[key],
      usage: usage.usage?.[key],
      note: LIMIT_NOTES[key],
    }))
  }, [license.limits, usage.usage])
  const enabledPremiumCount = useMemo(
    () => premiumFeatures.filter(feature => featureIsActive(feature)).length,
    [premiumFeatures],
  )
  const disabledPremiumCount = premiumFeatures.length - enabledPremiumCount
  const licenseStateMessage = useMemo(() => stateMessage(license), [license])
  const hasTrustWarning = !trust.license_keyring.configured
    || !trust.server_response_keyring.configured
    || !trust.update_keyring.configured
    || trust.license_keyring.development_override_enabled
    || trust.server_response_keyring.development_override_enabled
    || trust.update_keyring.development_override_enabled

  const loadLicense = async () => {
    setLoading(true)
    try {
      const usageUrl = selectedOrganizationId
        ? `${API_BASE}/system/license/usage?organization_id=${encodeURIComponent(selectedOrganizationId)}`
        : `${API_BASE}/system/license/usage`
      const [licenseResponse, featuresResponse, trustResponse, usageResponse] = await Promise.all([
        fetchWithAuth(`${API_BASE}/system/license`),
        fetchWithAuth(`${API_BASE}/system/features`),
        fetchWithAuth(`${API_BASE}/system/trust`),
        fetchWithAuth(usageUrl),
      ])
      const licenseData = await readJsonResponse(licenseResponse)
      const featuresData = await readJsonResponse(featuresResponse)
      const trustData = await readJsonResponse(trustResponse)
      const usageData = await readJsonResponse(usageResponse)
      setLicense(licenseData)
      setFeatures(featuresData.features || [])
      setTrust(trustData)
      setUsage(usageData || { usage: {} })
    } catch (error: any) {
      showFeedback('Licencia', error?.message || 'No se pudo cargar el estado de licencia.', 'danger')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadLicense()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrganizationId])

  const installLicense = async () => {
    if (!licenseJson.trim()) {
      showFeedback('Licencia', 'Selecciona un archivo .treseko o pega el contenido de la licencia antes de instalar.', 'warning')
      return
    }
    setInstalling(true)
    setInstallDiagnostic('')
    try {
      const payload = JSON.parse(licenseJson)
      const response = await fetchWithAuth(`${API_BASE}/system/license/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await readJsonResponse(response)
      setLicense(data)
      setLicenseJson('')
      setLicenseFileName('')
      setInstallDiagnostic('')
      let syncMessage = ''
      if (data?.edition === 'premium' && Array.isArray(data?.enabled_features) && data.enabled_features.includes('updates.premium')) {
        try {
          const syncResponse = await fetchWithAuth(`${API_BASE}/system/updates/sync-premium`, { method: 'POST' })
          const syncData = await readJsonResponse(syncResponse)
          syncMessage = syncData?.available
            ? ` Se encontró la versión ${syncData.latest_version || syncData.version} en el canal Premium.`
            : ' Se consultó el canal Premium de actualizaciones.'
        } catch (syncError: any) {
          syncMessage = ` No se pudo consultar actualizaciones Premium ahora: ${syncError?.message || 'intenta desde Actualizaciones más tarde'}.`
        }
      }
      await loadLicense()
      showFeedback('Licencia instalada', `Treseko actualizó la edición y los entitlements activos.${syncMessage}`, 'success')
    } catch (error: any) {
      const diagnostic = error instanceof SyntaxError
        ? 'El contenido pegado no es JSON valido.'
        : (error?.message || 'No se pudo instalar la licencia.')
      setInstallDiagnostic(diagnostic)
      showFeedback('Licencia invalida', humanizePremiumError('No se pudo validar la licencia Premium. Revisa que sea un license.treseko firmado y vigente.'), 'danger')
    } finally {
      setInstalling(false)
    }
  }

  const loadLicenseFile = async (file?: File | null) => {
    if (!file) return
    setInstallDiagnostic('')
    try {
      const text = await file.text()
      setLicenseJson(text)
      setLicenseFileName(file.name)
      showFeedback('Licencia cargada', `Se cargo ${file.name}. Revisa el contenido y pulsa Instalar licencia Premium.`, 'info')
    } catch (error: any) {
      setLicenseFileName('')
      setInstallDiagnostic(error?.message || 'No se pudo leer el archivo seleccionado.')
      showFeedback('Licencia', 'No se pudo leer el archivo .treseko seleccionado.', 'danger')
    }
  }

  const renderTrustKeyring = (title: string, keyring: TrustKeyringInfo) => (
    <Col lg={4}>
      <div className="border rounded-3 p-3 h-100 bg-light">
        <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
          <div>
            <div className="small text-muted fw-bold text-uppercase">{title}</div>
            <div className="fw-bold">{keyring.algorithm.toUpperCase()}</div>
          </div>
          <Badge bg={keyring.configured ? 'success' : 'danger'}>
            {keyring.configured ? 'Confiable' : 'Sin configurar'}
          </Badge>
        </div>
        <div className="d-flex flex-wrap gap-2 mb-2">
          <Badge bg="light" text="dark" className="border">{sourceLabel(keyring.source)}</Badge>
          <Badge bg="light" text="dark" className="border">{keyring.key_count} clave(s)</Badge>
        </div>
        {keyring.fingerprints.length > 0 ? (
          <div className="d-flex flex-column gap-1">
            {keyring.fingerprints.map(fingerprint => (
              <code className="small text-break" key={fingerprint}>{fingerprint}</code>
            ))}
          </div>
        ) : (
          <div className="small text-muted">Sin huellas de firma disponibles.</div>
        )}
        {keyring.errors.length > 0 && (
          <Alert variant="warning" className="small mt-2 mb-0">
            {keyring.errors.join(' · ')}
          </Alert>
        )}
      </div>
    </Col>
  )

  return (
    <div className="animate__animated animate__fadeIn">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h5 className="fw-bold text-secondary text-uppercase small m-0">Licencia</h5>
          <span className="small text-muted">Edicion activa, limites, features habilitadas y canal de actualizaciones.</span>
        </div>
        <Button variant="outline-primary" className="fw-bold rounded-pill" onClick={loadLicense} disabled={loading}>
          {loading ? <Spinner size="sm" className="me-2" /> : <Download size={16} className="me-2" />}
          Actualizar estado
        </Button>
      </div>

      {loading ? (
        <Card className="border-0 shadow-sm rounded-4 bg-white p-4">
          <div className="text-muted"><Spinner size="sm" className="me-2" /> Cargando licencia...</div>
        </Card>
      ) : (
        <>
          <Row className="g-3">
            <Col lg={4}>
              <Card className="border-0 shadow-sm rounded-4 bg-white h-100">
                <Card.Body>
                  <div className="d-flex align-items-center gap-3 mb-3">
                    <div className="bg-primary bg-opacity-10 p-2 rounded-3"><ShieldCheck size={24} className="text-primary" /></div>
                    <div>
                      <div className="small text-muted fw-bold text-uppercase">Edicion actual</div>
                      <h4 className="m-0">Treseko {license.edition === 'premium' ? 'Premium' : 'Community'}</h4>
                      <div className="small text-muted fw-bold mt-1">Plan: {planLabel(license)}</div>
                    </div>
                  </div>
                  <div className="d-flex flex-wrap gap-2 mb-3">
                    <Badge bg={editionBadge(license.edition)}>{editionLabel(license.edition)}</Badge>
                    <Badge bg="light" text="dark">{license.plan_custom ? 'Plan personalizado' : planLabel(license)}</Badge>
                    {license.state !== license.edition && <Badge bg={stateBadge(license.state)}>{stateLabel(license.state)}</Badge>}
                    <Badge bg="light" text="dark">{updateChannelLabel(license.update_channel)}</Badge>
                  </div>
                  {licenseStateMessage && <Alert variant={license.state === 'active' ? 'success' : 'warning'} className="small mb-2">{licenseStateMessage}</Alert>}
                  {license.reason && license.reason !== licenseStateMessage && <Alert variant="light" className="border small mb-0">{license.reason}</Alert>}
                </Card.Body>
              </Card>
            </Col>
            <Col lg={8}>
              <Card className="border-0 shadow-sm rounded-4 bg-white h-100">
                <Card.Body>
                  <div className="d-flex justify-content-between align-items-start gap-3 mb-2">
                      <div>
                        <div className="small text-muted fw-bold text-uppercase">Limites de uso</div>
                        <div className="small text-muted">
                        Estos son los limites vigentes aplicados ahora por la licencia instalada.
                        </div>
                      </div>
                    <Badge bg={license.edition === 'premium' ? 'success' : 'primary'}>
                      {license.edition === 'premium' ? 'Licencia Premium activa' : 'Community local'}
                    </Badge>
                  </div>
                  <Table size="sm" responsive className="align-middle small mb-0">
                    <thead>
                      <tr>
                        <th>Limite</th>
                        <th style={{ minWidth: 220 }}>Uso actual</th>
                        <th className="text-end">Actual</th>
                      </tr>
                    </thead>
                    <tbody>
                      {limitRows.map(row => (
                        <tr key={row.key}>
                          <td>
                            <span className="fw-bold">{row.label}</span>
                            {row.note && <div className="text-muted">{row.note}</div>}
                          </td>
                          <td>
                            <div className="d-flex align-items-center gap-2">
                              <ProgressBar
                                now={row.usage?.percent || 0}
                                variant={usageVariant(row.usage?.percent || 0)}
                                className="flex-grow-1"
                                style={{ height: 8, minWidth: 110 }}
                                aria-label={`Uso de ${row.label}`}
                              />
                              <span className="small fw-bold text-nowrap">
                                {(row.usage?.percent || 0).toFixed(0)}%
                              </span>
                            </div>
                            <div className="x-small text-muted">
                              {formatUsageValue(row.key, row.usage?.used)} usados
                            </div>
                          </td>
                          <td className="text-end fw-bold">{formatLimitValue(row.key, row.currentValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Card.Body>
              </Card>
            </Col>
          </Row>

          <Card className="border-0 shadow-sm rounded-4 bg-white mt-3">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
                <div>
                  <h6 className="fw-bold m-0">Periodo y verificacion</h6>
                  <div className="small text-muted">
                    El vencimiento define hasta cuando vale la licencia. El check online y la gracia controlan la continuidad Premium si el servidor no responde.
                  </div>
                </div>
                <Badge bg={license.edition === 'premium' ? 'success' : 'primary'}>
                  {license.edition === 'premium' ? 'Premium verificado' : 'Community'}
                </Badge>
              </div>
              <Row className="g-3">
                <Col md={4}>
                  <div className="border rounded-3 p-3 h-100">
                    <div className="small text-muted fw-bold text-uppercase">Valida hasta</div>
                    <div className="fw-bold">{formatLicenseDate(license.valid_until || license.license?.expires_at)}</div>
                    {daysUntil(license.valid_until || license.license?.expires_at) !== null && (
                      <div className="small text-muted">
                        {Math.max(daysUntil(license.valid_until || license.license?.expires_at) || 0, 0)} dias restantes
                      </div>
                    )}
                  </div>
                </Col>
                <Col md={4}>
                  <div className="border rounded-3 p-3 h-100">
                    <div className="small text-muted fw-bold text-uppercase">Activada</div>
                    <div className="fw-bold">{formatLicenseDate(license.activated_at)}</div>
                    <div className="small text-muted">Primera asociacion con esta instancia.</div>
                  </div>
                </Col>
                <Col md={4}>
                  <div className="border rounded-3 p-3 h-100">
                    <div className="small text-muted fw-bold text-uppercase">Ultimo check</div>
                    <div className="fw-bold">{formatLicenseDate(license.last_check_at)}</div>
                    <div className="small text-muted">Ultima respuesta firmada del servidor Premium.</div>
                  </div>
                </Col>
                <Col md={4}>
                  <div className="border rounded-3 p-3 h-100">
                    <div className="small text-muted fw-bold text-uppercase">Proximo check</div>
                    <div className="fw-bold">{formatLicenseDate(license.next_check_at)}</div>
                    {license.verification_interval_days && <div className="small text-muted">Intervalo: {license.verification_interval_days} dias</div>}
                  </div>
                </Col>
                <Col md={4}>
                  <div className="border rounded-3 p-3 h-100">
                    <div className="small text-muted fw-bold text-uppercase">Gracia offline hasta</div>
                    <div className="fw-bold">{formatLicenseDate(license.grace_until)}</div>
                    {license.grace_period_days && <div className="small text-muted">Gracia configurada: {license.grace_period_days} dias</div>}
                  </div>
                </Col>
                <Col md={4}>
                  <div className="border rounded-3 p-3 h-100">
                    <div className="small text-muted fw-bold text-uppercase">Emitida</div>
                    <div className="fw-bold">{formatLicenseDate(license.issued_at || license.license?.issued_at)}</div>
                    <div className="small text-muted">Fecha firmada dentro del archivo .treseko.</div>
                  </div>
                </Col>
              </Row>
            </Card.Body>
          </Card>

          <Card className="border-0 shadow-sm rounded-4 bg-white mt-3">
            <Card.Body>
              <div className="d-flex align-items-start gap-2 mb-3">
                <KeyRound size={20} className="text-primary mt-1" />
                <div>
                  <h6 className="fw-bold m-0">Confianza y firmas</h6>
                  <div className="small text-muted">
                    Treseko self-hosted solo verifica licencias y manifests con claves publicas. No se exponen claves crudas ni secretos de firma.
                  </div>
                </div>
              </div>
              {hasTrustWarning && (
                <Alert variant="warning" className="small">
                  La instalacion verifica licencias y actualizaciones con claves publicas de Treseko. Si alguna firma aparece sin configurar, instala una licencia firmada o solicita al administrador del servidor que complete la configuracion de confianza.
                </Alert>
              )}
              <Row className="g-3">
                {renderTrustKeyring('Licencias Premium', trust.license_keyring)}
                {renderTrustKeyring('Servidor Premium', trust.server_response_keyring)}
                {renderTrustKeyring('Updates firmados', trust.update_keyring)}
              </Row>
            </Card.Body>
          </Card>

          <Row className="g-3 mt-1">
            <Col lg={6}>
              <Card className="border-0 shadow-sm rounded-4 bg-white h-100">
                <Card.Body>
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <ShieldCheck size={18} className="text-primary" />
                    <h6 className="fw-bold m-0">Community habilitado</h6>
                    <Badge bg="primary">{communityFeatures.length}</Badge>
                  </div>
                  <div className="small text-muted mb-2">
                    Estas funciones vienen incluidas en Treseko Community aunque luego una licencia Premium eleve limites o agregue modulos.
                  </div>
                  <Table size="sm" responsive className="align-middle small mb-0">
                    <tbody>
                      {communityFeatures.map(feature => (
                        <tr key={feature.id}>
                          <td className="fw-bold">{feature.label}</td>
                          <td className="text-end"><Badge bg={featureIsActive(feature) ? 'success' : 'secondary'}>{featureIsActive(feature) ? 'Incluido' : 'Bloqueado'}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Card.Body>
              </Card>
            </Col>
            <Col lg={6}>
              <Card className="border-0 shadow-sm rounded-4 bg-white h-100">
                <Card.Body>
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <Crown size={18} className="text-warning" />
                    <h6 className="fw-bold m-0">Premium por entitlement</h6>
                    <Badge bg={license.edition === 'premium' && disabledPremiumCount === 0 ? 'success' : 'warning'} text={license.edition === 'premium' && disabledPremiumCount === 0 ? undefined : 'dark'}>
                      {enabledPremiumCount}/{premiumFeatures.length}
                    </Badge>
                  </div>
                  <Alert variant={license.edition === 'premium' ? 'info' : 'light'} className="border small mb-2">
                    {license.edition === 'premium'
                      ? 'Tu licencia Premium puede habilitar solo algunos modulos. Los que figuran como no incluidos requieren una licencia emitida con ese entitlement.'
                      : 'Estas funciones se desbloquean al instalar una licencia Premium que incluya cada entitlement.'}
                  </Alert>
                  <Table size="sm" responsive className="align-middle small mb-0">
                    <tbody>
                      {premiumFeatures.map(feature => (
                        <tr key={feature.id}>
                          <td>
                            <span className="fw-bold">{feature.label}</span>
                            {!featureIsActive(feature) && <span className="text-muted ms-2"><Lock size={12} /> Entitlement no incluido</span>}
                          </td>
                          <td className="text-end">
                            <Badge bg={featureIsActive(feature) ? 'success' : 'light'} text={featureIsActive(feature) ? undefined : 'dark'}>
                              {featureIsActive(feature) ? 'Activo' : license.edition === 'premium' ? 'No incluido' : 'Requiere Premium'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Card.Body>
              </Card>
            </Col>
          </Row>

          <Card className="border-0 shadow-sm rounded-4 bg-white mt-3">
            <Card.Body>
              <div className="d-flex align-items-center justify-content-between gap-3 mb-3">
                <div>
                  <h6 className="fw-bold m-0">Instalar licencia Premium</h6>
                  <div className="small text-muted">Selecciona un archivo .treseko firmado o pega su contenido manualmente. Treseko valida firma Ed25519, key_id, vencimiento y features.</div>
                </div>
                <Button variant={licenseJson.trim() ? 'primary' : 'outline-primary'} className="fw-bold rounded-pill" disabled={!canEditLicense || installing || !licenseJson.trim()} onClick={installLicense}>
                  {installing ? <Spinner size="sm" className="me-2" /> : <Upload size={16} className="me-2" />}
                  Instalar licencia Premium
                </Button>
              </div>
              {!canEditLicense && <Alert variant="light" className="border small">Necesitas permiso de edicion de licencia para instalar una clave Premium.</Alert>}
              <div className="border rounded-3 bg-light p-3 mb-3">
                <Form.Label className="small fw-bold mb-1">Archivo de licencia</Form.Label>
                <Form.Control
                  type="file"
                  accept=".treseko,.json,application/json"
                  disabled={!canEditLicense || installing}
                  onChange={(event) => {
                    const input = event.currentTarget as HTMLInputElement
                    const file = input.files?.[0]
                    void loadLicenseFile(file)
                    input.value = ''
                  }}
                />
                <div className="x-small text-muted mt-2">
                  {licenseFileName ? `Archivo cargado: ${licenseFileName}` : 'Formato esperado: license.treseko o JSON firmado emitido para tu instalacion.'}
                </div>
              </div>
              <Form.Control
                as="textarea"
                rows={8}
                value={licenseJson}
                onChange={(event) => {
                  setLicenseJson(event.target.value)
                  setLicenseFileName('')
                }}
                disabled={!canEditLicense}
                placeholder='{"edition":"premium","license_id":"lic_...","customer_id":"cus_...","key_id":"ed25519:sha256:...","issued_at":"2026-07-05T00:00:00Z","expires_at":"2027-07-05T00:00:00Z","max_users":50,"max_projects":10,"max_workers":2,"max_storage_mb":10240,"enabled_features":["ai.engine"],"update_channel":"premium-stable","signature":"ed25519:..."}'
                className="font-monospace small"
              />
              {installDiagnostic && (
                <Alert variant="danger" className="small mt-3 mb-0">
                  No se pudo validar la licencia Premium. Asegurate de cargar el archivo .treseko completo y vigente.
                  <details className="mt-2">
                    <summary className="fw-bold" role="button">Diagnostico tecnico</summary>
                    <pre className="bg-light border rounded-3 p-2 mt-2 mb-0 text-wrap">{installDiagnostic}</pre>
                  </details>
                </Alert>
              )}
              <div className="d-flex justify-content-end mt-3">
                <Button
                  variant={licenseJson.trim() ? 'outline-primary' : 'primary'}
                  className="fw-bold rounded-pill"
                  onClick={() => showFeedback('Treseko Premium', 'Solicita un archivo .treseko firmado para tu instalacion e instalalo desde esta pantalla.', 'info')}
                >
                  Solicitar Premium
                </Button>
              </div>
            </Card.Body>
          </Card>
        </>
      )}
    </div>
  )
}
