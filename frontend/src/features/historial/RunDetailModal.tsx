import { useEffect, useMemo, useState } from 'react'
import { useI18n, type TranslationKey } from '../../i18n'
import { Alert, Badge, Button, Card, Col, Form, Modal, Row, Spinner } from 'react-bootstrap'
import { ChevronDown, ChevronRight, Copy, Eye, FileText, History, Image as ImageIcon, Search } from 'lucide-react'
import { API_BASE } from '../../app/constants'
import { isImageAsset, resolveAssetUrl } from '../../shared/utils/assets'
import { formatDateTime } from '../../shared/utils/dateTime'
import { isEvidenceAvailable } from '../../shared/utils/evidenceAvailability'
import { AiExecutionReportModal } from '../motor-ia/AiExecutionReportModal'
import { RunDetailView } from './RunDetailView'
export { EvidenceList } from './EvidenceList'
import { EvidenceList } from './EvidenceList'

type RunDetailModalProps = {
  detail: any | null
  detailLoading: boolean
  detailError: string
  focusedExecutionId?: string
  getStatusColor: (status: string) => string
  onHide: () => void
  onOpenEvidence: (attachment: any) => void
  isExternalChildModalOpen?: boolean
  onMarkAiReviewed?: (executionId: string, note?: string) => Promise<void> | void
  canViewEvidence?: boolean
  fetchWithAuth?: (url: string, options?: any) => Promise<Response>
  showFeedback?: (title: string, message: string, variant?: string) => void
  canAccessCapability?: (capabilityId: string, level?: string) => boolean
  setActiveTab?: (tab: any) => void
}

const formatDate = (value?: string) => {
  if (!value) return '-'
  return formatDateTime(value) || '-'
}

const formatSeconds = (seconds?: number) => {
  if (!seconds) return '-'
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`
}

const keyValueRows = (value: any) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value).map(([key, item]) => ({ key, value: String(item ?? '') }))
}

type FunctionalField = { id: string, label: string, keys: string[], value: string, sourceKey: string, sensitive: boolean }
type FunctionalGroup = { id: string, title: string, description: string, fields: FunctionalField[] }
type Translator = (key: TranslationKey, params?: Record<string, string | number>) => string

const SECRET_KEY_RE = /(password|token|secret|apikey|api_key|cookie|authorization|bearer|jwt)/i
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const technicalAliases: Record<string, string> = {
  'ENV.ID': 'historial.environmentId', 'ENV.NAME': 'historial.environmentName', 'ENV.URL': 'historial.environmentUrl', 'ENV.BASE_URL': 'historial.environmentBaseUrl', 'ENV.VERSION': 'historial.environmentVersion', 'ENV.STATUS': 'historial.environmentStatus', 'ENV.KEY': 'historial.environmentKey', 'ENV.SEED': 'historial.environmentSeed', ENV_KEY: 'historial.environmentKey', BASE_URL: 'historial.baseUrl',
  'COMPONENT.ID': 'historial.componentId', 'COMPONENT.CODE': 'historial.componentCode', 'COMPONENT.NAME': 'historial.componentName', 'COMPONENT.OWNER': 'historial.componentOwner', 'COMPONENT.SEED': 'historial.componentSeed',
  'DATASET.NAME': 'historial.datasetName', 'DATASET.USER': 'historial.testUser', 'DATASET.ACCOUNT': 'historial.testAccount', 'DATASET.SEED': 'historial.datasetSeed', DATASET: 'historial.associatedDataset', USER: 'historial.testUser', ACCOUNT: 'historial.testAccount',
  'CASE.NAME': 'historial.caseName', 'CASE.DATASET': 'historial.caseDataset', 'CASE.SEED': 'historial.caseSeed',
}

const functionalGroupDefinitions = (t: Translator) => [
  {
    id: 'environment',
    title: t('historial.environment'),
    description: t('historial.environmentDescription'),
    fields: [
      { id: 'name', label: t('historial.name'), keys: ['ENV.NAME'] }, { id: 'base_url', label: t('historial.baseUrl'), keys: ['ENV.BASE_URL', 'ENV.URL', 'BASE_URL'] }, { id: 'status', label: t('historial.status'), keys: ['ENV.STATUS'] }, { id: 'version', label: t('historial.version'), keys: ['ENV.VERSION'] }, { id: 'key', label: t('historial.key'), keys: ['ENV.KEY', 'ENV_KEY'] }, { id: 'owner', label: t('historial.owner'), keys: ['ENV.OWNER', 'OWNER'] },
    ],
  },
  {
    id: 'component',
    title: t('historial.component'), description: t('historial.componentDescription'),
    fields: [
      { id: 'name', label: t('historial.name'), keys: ['COMPONENT.NAME'] }, { id: 'code', label: t('historial.code'), keys: ['COMPONENT.CODE'] }, { id: 'owner', label: t('historial.responsible'), keys: ['COMPONENT.OWNER', 'OWNER'] }, { id: 'id', label: 'ID', keys: ['COMPONENT.ID'] },
    ],
  },
  {
    id: 'dataset',
    title: t('historial.dataset'), description: t('historial.datasetDescription'),
    fields: [
      { id: 'name', label: t('historial.name'), keys: ['DATASET.NAME', 'DATASET'] }, { id: 'user', label: t('historial.user'), keys: ['DATASET.USER', 'USER'] }, { id: 'account', label: t('historial.account'), keys: ['DATASET.ACCOUNT', 'ACCOUNT'] }, { id: 'seed', label: t('historial.seed'), keys: ['DATASET.SEED', 'SEED'] },
    ],
  },
  {
    id: 'case',
    title: t('historial.case'), description: t('historial.caseDescription'),
    fields: [
      { id: 'name', label: t('historial.name'), keys: ['CASE.NAME', 'CASE.TITLE'] }, { id: 'dataset', label: t('historial.associatedDataset'), keys: ['CASE.DATASET', 'DATASET'] }, { id: 'seed', label: t('historial.seed'), keys: ['CASE.SEED', 'SEED'] },
    ],
  },
]

const normalizeVariableKey = (key: string) => String(key || '').trim().toUpperCase()
const normalizeVariableValue = (value: string) => String(value ?? '').trim()

const variableLabel = (key: string, t: Translator) => {
  const normalized = normalizeVariableKey(key)
  if (technicalAliases[normalized]) return t(technicalAliases[normalized] as TranslationKey)
  return String(key || '')
    .replace(/^(ENV|COMPONENT|DATASET|CASE)\./i, '')
    .replace(/_/g, ' ')
    .replace(/\bURL\b/i, 'URL')
    .replace(/\bID\b/i, 'ID')
    .replace(/\b\w/g, char => char.toUpperCase())
}

const isSensitiveVariable = (key: string, value = '') => SECRET_KEY_RE.test(key) || SECRET_KEY_RE.test(value)
const compactUuid = (value: string) => UUID_RE.test(value) ? `${value.slice(0, 8)}...${value.slice(-6)}` : value

const matchesQuery = (query: string, ...values: string[]) => {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return values.some(value => String(value || '').toLowerCase().includes(normalized))
}

const buildFrozenVariableView = (value: any, query: string, t: Translator) => {
  const rows = keyValueRows(value)
  const rowByKey = new Map(rows.map(row => [normalizeVariableKey(row.key), row]))
  const usedVisualValues = new Set<string>()
  const technicalRows = rows
    .map(row => ({ ...row, label: variableLabel(row.key, t), sensitive: isSensitiveVariable(row.key, row.value) }))
    .filter(row => matchesQuery(query, row.label, row.key, row.value))

  const groups: FunctionalGroup[] = functionalGroupDefinitions(t).map(group => {
    const fields: FunctionalField[] = []
    for (const definition of group.fields) {
      const candidate = definition.keys
        .map(key => rowByKey.get(normalizeVariableKey(key)))
        .find(row => row && normalizeVariableValue(row.value))
      if (!candidate) continue
      const normalizedValue = normalizeVariableValue(candidate.value)
      const dedupeKey = normalizedValue.toLowerCase()
      if (usedVisualValues.has(dedupeKey)) continue
      usedVisualValues.add(dedupeKey)
      fields.push({
        id: `${group.id}.${definition.id}`,
        label: definition.label,
        keys: definition.keys,
        value: normalizedValue,
        sourceKey: candidate.key,
        sensitive: isSensitiveVariable(candidate.key, normalizedValue),
      })
    }
    return {
      id: group.id,
      title: group.title,
      description: group.description,
      fields: fields.filter(field => matchesQuery(query, field.label, field.sourceKey, field.value, field.keys.join(' '))),
    }
  })

  return {
    groups,
    technicalRows,
    total: rows.length,
    visibleFunctionalCount: groups.reduce((sum, group) => sum + group.fields.length, 0),
  }
}

function FrozenValue({
  fieldKey,
  value,
  sensitive,
  canRevealSecrets,
  revealedSecrets,
  onRevealSecret,
  t,
}: {
  fieldKey: string
  value: string
  sensitive?: boolean
  canRevealSecrets: boolean
  revealedSecrets: Record<string, boolean>
  onRevealSecret: (key: string) => void
  t: Translator
}) {
  const isUuid = UUID_RE.test(value)
  const isRevealed = !sensitive || revealedSecrets[fieldKey]
  const displayValue = sensitive && !isRevealed ? '•••••••••••' : compactUuid(value)
  return (
    <div className="d-flex align-items-center gap-1 flex-wrap">
      <span className="font-monospace small text-break" title={isUuid ? value : undefined}>{displayValue || '-'}</span>
      {isUuid && (
        <Button variant="light" size="sm" className="py-0 px-1 border" title={t('historial.copyFullId')} onClick={() => navigator.clipboard?.writeText(value)}>
          <Copy size={12} />
        </Button>
      )}
      {sensitive && canRevealSecrets && !isRevealed && (
        <Button variant="outline-secondary" size="sm" className="py-0 px-1 x-small" onClick={() => onRevealSecret(fieldKey)}>
          <Eye size={12} className="me-1" /> {t('historial.show')}
        </Button>
      )}
    </div>
  )
}

function FrozenDataCard({
  group,
  canRevealSecrets,
  revealedSecrets,
  onRevealSecret,
  t,
}: {
  group: FunctionalGroup
  canRevealSecrets: boolean
  revealedSecrets: Record<string, boolean>
  onRevealSecret: (key: string) => void
  t: Translator
}) {
  return (
    <div className="border rounded-3 bg-white p-2 h-100">
      <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
        <div>
          <div className="fw-bold small">{group.title}</div>
          <div className="x-small text-muted text-truncate" title={group.description}>{group.description}</div>
        </div>
        <Badge bg="light" text="dark" className="border flex-shrink-0">{group.fields.length}</Badge>
      </div>
      {group.fields.length > 0 ? (
        <div className="row row-cols-1 row-cols-lg-2 g-2">
          {group.fields.map(field => (
            <div className="col" key={field.id}>
              <div className="x-small text-muted text-uppercase fw-bold lh-1 mb-1">{field.label}</div>
              <FrozenValue
                fieldKey={field.sourceKey}
                value={field.value}
                sensitive={field.sensitive}
                canRevealSecrets={canRevealSecrets}
                revealedSecrets={revealedSecrets}
                onRevealSecret={onRevealSecret}
                t={t}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="small text-muted py-1">{t('historial.noFunctionalData')}</div>
      )}
    </div>
  )
}

const executionModeBadge = (mode?: string) => {
  const value = String(mode || '').toUpperCase()
  if (value === 'IA') return 'primary'
  if (value === 'AUTOMATIZADA') return 'info'
  if (value === 'EXTERNA') return 'success'
  return 'secondary'
}

const executionModeCopy = (mode: string | undefined, label: string | undefined, t: Translator) => {
  const value = String(mode || '').toUpperCase()
  if (value === 'IA') return t('historial.executedWithLabel', { label: 'IA' })
  if (value === 'AUTOMATIZADA') return t('historial.executedWithLabel', { label: t('historial.automatedLabel') })
  if (value === 'EXTERNA') return t('historial.externalLabel')
  return label ? t('historial.executedWithLabel', { label: label.toLowerCase() }) : t('historial.executedManually')
}

const caseTypeBadge = (caseType?: string) => {
  const value = String(caseType || '').toLowerCase()
  if (value === 'automatizada_ia') return 'primary'
  if (value === 'automatizada') return 'info'
  return 'secondary'
}

const caseTypeCopy = (label: string | undefined, t: Translator) => t('historial.caseLabel', { label: String(label || t('historial.manualLabel')).toLowerCase() })

const runStateLabel = (state: string | undefined, t: Translator) => {
  const value = String(state || '').toUpperCase()
  if (value === 'ABIERTO') return t('historial.openRun')
  if (value === 'EN_PROGRESO') return t('historial.inProgress')
  if (value === 'CERRADO') return t('historial.closed')
  return state || '-'
}

const isAiRun = (detail: any) => String(detail?.origen || '').toUpperCase() === 'IA'

const effectiveExecutionMode = (detail: any, caso?: any) => {
  const mode = String(caso?.execution_mode || '').toUpperCase()
  if (mode && mode !== 'MANUAL') return mode
  if (isAiRun(detail)) return 'IA'
  return mode || 'MANUAL'
}

const effectiveExecutionModeLabel = (mode: string, fallback?: string) => {
  if (mode === 'IA') return 'IA'
  if (mode === 'AUTOMATIZADA') return 'Automatizada'
  if (mode === 'EXTERNA') return 'Externa'
  return fallback || 'Manual'
}

const buildHistoryAiReportPayload = (detail: any, caso: any) => {
  const mode = effectiveExecutionMode(detail, caso)
  const executionId = getExecutionId(caso)
  const existingReport = caso.ai_report && typeof caso.ai_report === 'object' ? caso.ai_report : {}
  const snapshots = Array.isArray(caso.snapshots) ? caso.snapshots : []
  const baseReport = Object.keys(existingReport).length > 0 ? existingReport : {
    schema_version: 1,
    legacy: true,
    execution_id: executionId,
    summary: caso.observaciones || 'Ejecucion IA sin reporte estructurado.',
    status: caso.estado,
    confidence: caso.ai_confidence ?? 0,
    consensus: caso.ai_consensus || caso.estado,
    failure_category: caso.ai_failure_category || 'legacy_ai_execution',
    human_review_required: Boolean(caso.ai_human_review_required),
    steps: snapshots.map((snapshot: any) => ({
      number: snapshot.numero_paso,
      status: snapshot.estado_paso,
      observations: snapshot.comentarios || snapshot.error_log,
      confidence: 0,
      failure_category: snapshot.estado_paso,
      attempts: [],
    })),
  }
  const snapshotsByStep = new Map<number, any>(snapshots.map((snapshot: any) => [Number(snapshot.numero_paso), snapshot]))
  const generatedReport = {
    ...baseReport,
    steps: (Array.isArray(baseReport.steps) ? baseReport.steps : []).map((step: any) => {
      const snapshot = snapshotsByStep.get(Number(step.number))
      if (!snapshot) return step
      return {
        ...step,
        evidence_url: step.evidence_url || snapshot.evidencia_url,
        evidences: Array.isArray(step.evidences) && step.evidences.length ? step.evidences : (snapshot.evidencias || []),
      }
    }),
  }
  return {
    execution_id: executionId,
    case_id: caso.caso_id,
    case_code: caso.codigo,
    case_title: caso.titulo,
    status: caso.estado,
    observations: caso.observaciones,
    duration_seconds: caso.duracion_segundos,
    confidence: caso.ai_confidence ?? generatedReport.confidence,
    consensus: caso.ai_consensus || generatedReport.consensus,
    failure_category: caso.ai_failure_category || generatedReport.failure_category,
    error_code: caso.ai_error_code || generatedReport.error_code,
    execution_mode: mode,
    review_status: caso.ai_review_status || generatedReport.human_review_status,
    human_review_required: Boolean(caso.ai_human_review_required || generatedReport.human_review_required),
    ai_report: generatedReport,
  }
}

const getExecutionId = (caso: any) => String(caso?.execution_id || caso?.id || '')

const markCaseAsReviewed = (caso: any) => ({
  ...caso,
  ai_review_status: 'REVISADA',
  ai_human_review_required: false,
  ai_report: {
    ...(caso.ai_report || {}),
    human_review_required: false,
    human_review_status: 'REVISADA',
  },
})


export function RunDetailModal({
  detail,
  detailLoading,
  detailError,
  focusedExecutionId,
  getStatusColor,
  onHide,
  onOpenEvidence,
  isExternalChildModalOpen = false,
  onMarkAiReviewed,
  canViewEvidence = true,
  fetchWithAuth,
  showFeedback,
  canAccessCapability,
}: RunDetailModalProps) {
  const { t } = useI18n()
  const [aiReportCase, setAiReportCase] = useState<any | null>(null)
  const [markingReviewIds, setMarkingReviewIds] = useState<Record<string, boolean>>({})
  const [reviewActionError, setReviewActionError] = useState('')
  const [localCases, setLocalCases] = useState<any[]>([])
  const [reviewConfirmCase, setReviewConfirmCase] = useState<any | null>(null)
  const [reviewNote, setReviewNote] = useState('')
  const [frozenSearch, setFrozenSearch] = useState('')
  const [showExecutionSnapshot, setShowExecutionSnapshot] = useState(false)
  const [showTechnicalVariables, setShowTechnicalVariables] = useState(false)
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({})
  const isNestedModalOpen = Boolean(
    aiReportCase || reviewConfirmCase || isExternalChildModalOpen,
  )
  const focusedCase = useMemo(() => {
    if (!focusedExecutionId) return null
    return (detail?.casos || []).find((caso: any) => getExecutionId(caso) === focusedExecutionId) || null
  }, [detail?.casos, focusedExecutionId])
  const focusError = Boolean(focusedExecutionId && detail && !focusedCase)
  const displayCases = useMemo(() => {
    const cases = localCases.length > 0 ? localCases : (detail?.casos || [])
    if (!focusedExecutionId) return cases
    return cases.filter((caso: any) => getExecutionId(caso) === focusedExecutionId)
  }, [detail?.casos, focusedExecutionId, localCases])
  const frozenVariables = useMemo(
    () => buildFrozenVariableView(detail?.variables_resueltas, frozenSearch, t),
    [detail?.variables_resueltas, frozenSearch, t],
  )
  const canRevealSecrets = Boolean(canAccessCapability?.('configuracion.monitor', 'read'))

  useEffect(() => {
    const cases = detail?.casos || []
    setLocalCases(focusedExecutionId ? cases.filter((caso: any) => getExecutionId(caso) === focusedExecutionId) : cases)
    setReviewActionError('')
    setReviewConfirmCase(null)
    setReviewNote('')
    setFrozenSearch('')
    setShowExecutionSnapshot(false)
    setShowTechnicalVariables(false)
    setRevealedSecrets({})
  }, [detail?.id, detail?.casos, focusedExecutionId])

  const revealSecret = async (variable: string) => {
    if (!canRevealSecrets) return
    try {
      if (!fetchWithAuth) throw new Error('No hay canal seguro para auditar la visualizacion del secreto.')
      const response = await fetchWithAuth(`${API_BASE}/audit/secret-reveals/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_id: detail?.id || null,
          variable,
          context: 'run_detail_frozen_variables',
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data?.detail || t('historial.secretAuditVisualizeError'))
      }
      setRevealedSecrets(current => ({ ...current, [variable]: true }))
    } catch (error: any) {
      showFeedback?.(t('historial.secretAuditTitle'), error?.message || t('historial.secretAuditError'), 'danger')
    }
  }

  const markAiReviewed = async (executionId: string, note = '') => {
    if (!onMarkAiReviewed) return
    if (!executionId) {
      setReviewActionError(t('historial.reviewMissingId'))
      return
    }
    setReviewActionError('')
    setMarkingReviewIds(current => ({ ...current, [executionId]: true }))
    try {
      await onMarkAiReviewed(executionId, note)
      setLocalCases(current => current.map(caso => getExecutionId(caso) === executionId ? markCaseAsReviewed(caso) : caso))
      setAiReportCase((current: any) => {
        if (!current || current.execution_id !== executionId) return current
        return {
          ...current,
          review_status: 'REVISADA',
          human_review_required: false,
          ai_report: {
            ...(current.ai_report || {}),
            human_review_required: false,
            human_review_status: 'REVISADA',
          },
        }
      })
      setReviewConfirmCase(null)
      setReviewNote('')
    } catch (error: any) {
      setReviewActionError(error?.message || t('historial.reviewBackendError'))
    } finally {
      setMarkingReviewIds(current => {
        const next = { ...current }
        delete next[executionId]
        return next
      })
    }
  }

  return <RunDetailView options={{
    t, detail, detailLoading, detailError, onHide, focusedCase, focusError, displayCases,
    canViewEvidence, onOpenEvidence, getStatusColor, runStateLabel,
    executionModeBadge, executionModeCopy, caseTypeBadge, caseTypeCopy,
    effectiveExecutionMode, effectiveExecutionModeLabel, getExecutionId,
    buildHistoryAiReportPayload, markAiReviewed, markingReviewIds, reviewActionError,
    reviewConfirmCase, setReviewConfirmCase, reviewNote, setReviewNote, aiReportCase,
    setAiReportCase, showExecutionSnapshot, setShowExecutionSnapshot,
    showTechnicalVariables, setShowTechnicalVariables, frozenVariables,
    frozenSearch, setFrozenSearch, canRevealSecrets, revealedSecrets, revealSecret,
    FrozenDataCard, FrozenValue, EvidenceList, isAiRun, onMarkAiReviewed, showFeedback,
    focusedExecutionId, isNestedModalOpen, setRevealedSecrets, formatDate, formatSeconds,
  }} />
}
