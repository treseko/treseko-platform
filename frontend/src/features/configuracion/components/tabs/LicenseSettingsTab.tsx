import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Col, Form, ProgressBar, Row, Spinner, Table } from 'react-bootstrap'
import { Crown, Download, KeyRound, Lock, ShieldCheck, Upload } from 'lucide-react'
import { API_BASE } from '../../../../app/constants'
import { humanizePremiumError } from '../../../premium/featureAccess'
import { useI18n } from '../../../../i18n'
import { LicenseSettingsView } from './LicenseSettingsView'

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
  online_status?: 'verified' | 'pending' | null
  online_reason?: string | null
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
  max_ai_case_generations_per_week: 20,
  max_storage_mb: 1024,
}

const LIMIT_LABEL_KEYS: Record<string, string> = {
  max_organizations: 'licenseLimitOrganizations', max_users: 'licenseLimitUsers', max_projects: 'licenseLimitProjects', max_workers: 'licenseLimitWorkers',
  max_automated_runs_per_week: 'licenseLimitAutomatedRuns', max_ai_runs_per_week: 'licenseLimitAiRuns', max_ai_case_generations_per_week: 'licenseLimitAiCaseGenerations', max_storage_mb: 'licenseLimitStorage',
}

const LIMIT_NOTE_KEYS: Record<string, string> = {
  max_automated_runs_per_week: 'licenseNoteAutomatedRuns', max_ai_runs_per_week: 'licenseNoteAiRuns', max_ai_case_generations_per_week: 'licenseNoteAiCaseGenerations', max_workers: 'licenseNoteWorkers', max_storage_mb: 'licenseNoteStorage',
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
  online_status: null,
  online_reason: null,
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

function sourceLabel(source: TrustKeyringInfo['source'], t: (key: string, params?: Record<string, unknown>) => string) {
  return source === 'development_override' ? t('configuracion.licenseTemporaryConfiguration') : t('configuracion.licenseIncludedInTreseko')
}

function stateLabel(state: string, t: (key: string, params?: Record<string, unknown>) => string) {
  const labels: Record<string, string> = {
    active: t('configuracion.licenseStateActive'), community: t('configuracion.licenseCommunity'), expired: t('configuracion.licenseStateExpired'),
    invalid: t('configuracion.licenseStateInvalid'), revoked: t('configuracion.licenseStateRevoked'), unavailable: t('configuracion.licenseUnavailable'),
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

function updateChannelLabel(channel: string | undefined, t: (key: string, params?: Record<string, unknown>) => string) {
  if (!channel) return t('configuracion.licenseChannelUndefined')
  if (channel.includes('stable')) return t('configuracion.licenseChannelStable')
  if (channel.includes('rc')) return t('configuracion.licenseChannelRc')
  if (channel.includes('beta')) return t('configuracion.licenseChannelBeta')
  return channel
}

function formatLicenseDate(value: string | null | undefined, t: (key: string, params?: Record<string, unknown>) => string, locale: string) {
  if (!value) return t('configuracion.licenseUnavailable')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(locale === 'en' ? 'en-US' : 'es-AR', {
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

function stateMessage(license: LicenseState, t: (key: string, params?: Record<string, unknown>) => string) {
  if (license.state === 'active') return null
  if (license.state === 'expired') return t('configuracion.licenseMessageExpired')
  if (license.state === 'revoked') return t('configuracion.licenseMessageRevoked')
  if (license.state === 'invalid') return t('configuracion.licenseMessageInvalid')
  if (license.state === 'community') return t('configuracion.licenseMessageCommunity')
  return license.reason || null
}

function formatLimitValue(key: string, value: number | undefined, locale: string, t: (key: string, params?: Record<string, unknown>) => string) {
  if (value === undefined || value === null) return t('configuracion.licenseUndefined')
  if (key === 'max_storage_mb') return `${value.toLocaleString(locale === 'en' ? 'en-US' : 'es-AR')} MB`
  return value.toLocaleString(locale === 'en' ? 'en-US' : 'es-AR')
}

function formatUsageValue(key: string, value?: number, locale = 'es', t?: (key: string, params?: Record<string, unknown>) => string) {
  if (value === undefined || value === null) return '0'
  if (key === 'max_storage_mb') return `${value.toLocaleString(locale === 'en' ? 'en-US' : 'es-AR')} MB`
  return value.toLocaleString(locale === 'en' ? 'en-US' : 'es-AR')
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
    throw new Error(data?.detail || 'Operation could not be completed')
  }
  return data
}

export function LicenseSettingsTab({ fetchWithAuth, showFeedback, canEditLicense, selectedOrganizationId }: LicenseSettingsTabProps) {
  const { t, locale } = useI18n()
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
      label: LIMIT_LABEL_KEYS[key] ? t(`configuracion.${LIMIT_LABEL_KEYS[key]}`) : key.replaceAll('_', ' '),
      currentValue: license.limits?.[key],
      usage: usage.usage?.[key],
      note: LIMIT_NOTE_KEYS[key] ? t(`configuracion.${LIMIT_NOTE_KEYS[key]}`) : undefined,
    }))
  }, [license.limits, usage.usage])
  const enabledPremiumCount = useMemo(
    () => premiumFeatures.filter(feature => featureIsActive(feature)).length,
    [premiumFeatures],
  )
  const disabledPremiumCount = premiumFeatures.length - enabledPremiumCount
  const licenseStateMessage = useMemo(() => stateMessage(license, t), [license, t])
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
      showFeedback(t('configuracion.licenseTitle'), error?.message || t('configuracion.licenseLoadError'), 'danger')
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
      showFeedback(t('configuracion.licenseTitle'), t('configuracion.licenseSelectBeforeInstall'), 'warning')
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
            ? ` ${t('configuracion.licensePremiumVersionFound', { version: syncData.latest_version || syncData.version })}`
            : ` ${t('configuracion.licensePremiumChannelChecked')}`
        } catch (syncError: any) {
          syncMessage = ` ${t('configuracion.licensePremiumUpdatesError', { error: syncError?.message || t('configuracion.licenseTryUpdatesLater') })}.`
        }
      }
      await loadLicense()
      window.dispatchEvent(new Event('treseko:license-updated'))
      const verificationMessage = data?.online_status === 'pending'
        ? ` ${t('configuracion.licenseOnlinePending', { reason: data.online_reason || t('configuracion.licenseRetrySection') })}`
        : ` ${t('configuracion.licenseOnlineConfirmed')}`
      showFeedback(t('configuracion.licenseInstalled'), `${t('configuracion.licenseUpdated')}.${verificationMessage}${syncMessage}`, data?.online_status === 'pending' ? 'warning' : 'success')
    } catch (error: any) {
      const diagnostic = error instanceof SyntaxError
        ? t('configuracion.licenseInvalidJson')
        : (error?.message || t('configuracion.licenseInstallError'))
      setInstallDiagnostic(diagnostic)
      showFeedback(t('configuracion.licenseInvalid'), humanizePremiumError(t('configuracion.licenseValidationError')), 'danger')
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
      showFeedback(t('configuracion.licenseLoaded'), t('configuracion.licenseFileLoaded', { name: file.name }), 'info')
    } catch (error: any) {
      setLicenseFileName('')
      setInstallDiagnostic(error?.message || t('configuracion.licenseReadError'))
      showFeedback(t('configuracion.licenseTitle'), t('configuracion.licenseReadFileError'), 'danger')
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
            {keyring.configured ? t('configuracion.licenseTrusted') : t('configuracion.licenseNotConfigured')}
          </Badge>
        </div>
        <div className="d-flex flex-wrap gap-2 mb-2">
          <Badge bg="light" text="dark" className="border">{sourceLabel(keyring.source, t)}</Badge>
          <Badge bg="light" text="dark" className="border">{keyring.key_count} {t('configuracion.licenseKeys')}</Badge>
        </div>
        {keyring.fingerprints.length > 0 ? (
          <div className="d-flex flex-column gap-1">
            {keyring.fingerprints.map(fingerprint => (
              <code className="small text-break" key={fingerprint}>{fingerprint}</code>
            ))}
          </div>
        ) : (
          <div className="small text-muted">{t('configuracion.licenseNoFingerprints')}</div>
        )}
        {keyring.errors.length > 0 && (
          <Alert variant="warning" className="small mt-2 mb-0">
            {keyring.errors.join(' · ')}
          </Alert>
        )}
      </div>
    </Col>
  )

  return <LicenseSettingsView options={{
    t,
    locale,
    loading,
    loadLicense,
    license,
    licenseStateMessage,
    limitRows,
    hasTrustWarning,
    trust,
    renderTrustKeyring,
    communityFeatures,
    premiumFeatures,
    enabledPremiumCount,
    disabledPremiumCount,
    licenseJson,
    canEditLicense,
    installing,
    installLicense,
    licenseFileName,
    loadLicenseFile,
    installDiagnostic,
    editionBadge,
    editionLabel,
    planLabel,
    stateBadge,
    stateLabel,
    updateChannelLabel,
    formatUsageValue,
    formatLimitValue,
    usageVariant,
    formatLicenseDate,
    daysUntil,
    featureIsActive,
  }} />
}
