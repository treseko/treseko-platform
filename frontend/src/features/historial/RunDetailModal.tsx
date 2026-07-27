import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Col, Form, Modal, Row, Spinner } from 'react-bootstrap'
import { ChevronDown, ChevronRight, Copy, Eye, FileText, History, Image as ImageIcon, Search } from 'lucide-react'
import { API_BASE } from '../../app/constants'
import { isImageAsset, resolveAssetUrl } from '../../shared/utils/assets'
import { formatDateTime } from '../../shared/utils/dateTime'
import { isEvidenceAvailable } from '../../shared/utils/evidenceAvailability'
import { AiExecutionReportModal } from '../motor-ia/AiExecutionReportModal'

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

const SECRET_KEY_RE = /(password|token|secret|apikey|api_key|cookie|authorization|bearer|jwt)/i
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const technicalAliases: Record<string, string> = {
  'ENV.ID': 'ID del ambiente',
  'ENV.NAME': 'Nombre del ambiente',
  'ENV.URL': 'URL del ambiente',
  'ENV.BASE_URL': 'URL base del ambiente',
  'ENV.VERSION': 'Version del ambiente',
  'ENV.STATUS': 'Estado del ambiente',
  'ENV.KEY': 'Clave del ambiente',
  'ENV.SEED': 'Seed del ambiente',
  ENV_KEY: 'Clave del ambiente',
  BASE_URL: 'URL base',
  'COMPONENT.ID': 'ID del componente',
  'COMPONENT.CODE': 'Codigo del componente',
  'COMPONENT.NAME': 'Nombre del componente',
  'COMPONENT.OWNER': 'Responsable del componente',
  'COMPONENT.SEED': 'Seed del componente',
  'DATASET.NAME': 'Nombre del dataset',
  'DATASET.USER': 'Usuario de prueba',
  'DATASET.ACCOUNT': 'Cuenta de prueba',
  'DATASET.SEED': 'Seed del dataset',
  DATASET: 'Dataset asociado',
  USER: 'Usuario de prueba',
  ACCOUNT: 'Cuenta de prueba',
  'CASE.NAME': 'Nombre del caso',
  'CASE.DATASET': 'Dataset del caso',
  'CASE.SEED': 'Seed del caso',
}

const functionalGroupDefinitions = [
  {
    id: 'environment',
    title: 'Ambiente',
    description: 'Contexto donde se ejecuto la prueba.',
    fields: [
      { id: 'name', label: 'Nombre', keys: ['ENV.NAME'] },
      { id: 'base_url', label: 'URL base', keys: ['ENV.BASE_URL', 'ENV.URL', 'BASE_URL'] },
      { id: 'status', label: 'Estado', keys: ['ENV.STATUS'] },
      { id: 'version', label: 'Version', keys: ['ENV.VERSION'] },
      { id: 'key', label: 'Clave', keys: ['ENV.KEY', 'ENV_KEY'] },
      { id: 'owner', label: 'Owner', keys: ['ENV.OWNER', 'OWNER'] },
    ],
  },
  {
    id: 'component',
    title: 'Componente',
    description: 'Modulo, servicio o aplicacion bajo prueba.',
    fields: [
      { id: 'name', label: 'Nombre', keys: ['COMPONENT.NAME'] },
      { id: 'code', label: 'Codigo', keys: ['COMPONENT.CODE'] },
      { id: 'owner', label: 'Responsable', keys: ['COMPONENT.OWNER', 'OWNER'] },
      { id: 'id', label: 'ID', keys: ['COMPONENT.ID'] },
    ],
  },
  {
    id: 'dataset',
    title: 'Dataset',
    description: 'Datos de prueba usados para reproducir el escenario.',
    fields: [
      { id: 'name', label: 'Nombre', keys: ['DATASET.NAME', 'DATASET'] },
      { id: 'user', label: 'Usuario', keys: ['DATASET.USER', 'USER'] },
      { id: 'account', label: 'Cuenta', keys: ['DATASET.ACCOUNT', 'ACCOUNT'] },
      { id: 'seed', label: 'Seed', keys: ['DATASET.SEED', 'SEED'] },
    ],
  },
  {
    id: 'case',
    title: 'Caso',
    description: 'Datos especificos del caso ejecutado.',
    fields: [
      { id: 'name', label: 'Nombre', keys: ['CASE.NAME', 'CASE.TITLE'] },
      { id: 'dataset', label: 'Dataset asociado', keys: ['CASE.DATASET', 'DATASET'] },
      { id: 'seed', label: 'Seed', keys: ['CASE.SEED', 'SEED'] },
    ],
  },
]

const normalizeVariableKey = (key: string) => String(key || '').trim().toUpperCase()
const normalizeVariableValue = (value: string) => String(value ?? '').trim()

const variableLabel = (key: string) => {
  const normalized = normalizeVariableKey(key)
  if (technicalAliases[normalized]) return technicalAliases[normalized]
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

const buildFrozenVariableView = (value: any, query: string) => {
  const rows = keyValueRows(value)
  const rowByKey = new Map(rows.map(row => [normalizeVariableKey(row.key), row]))
  const usedVisualValues = new Set<string>()
  const technicalRows = rows
    .map(row => ({ ...row, label: variableLabel(row.key), sensitive: isSensitiveVariable(row.key, row.value) }))
    .filter(row => matchesQuery(query, row.label, row.key, row.value))

  const groups: FunctionalGroup[] = functionalGroupDefinitions.map(group => {
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
}: {
  fieldKey: string
  value: string
  sensitive?: boolean
  canRevealSecrets: boolean
  revealedSecrets: Record<string, boolean>
  onRevealSecret: (key: string) => void
}) {
  const isUuid = UUID_RE.test(value)
  const isRevealed = !sensitive || revealedSecrets[fieldKey]
  const displayValue = sensitive && !isRevealed ? '•••••••••••' : compactUuid(value)
  return (
    <div className="d-flex align-items-center gap-1 flex-wrap">
      <span className="font-monospace small text-break" title={isUuid ? value : undefined}>{displayValue || '-'}</span>
      {isUuid && (
        <Button variant="light" size="sm" className="py-0 px-1 border" title="Copiar ID completo" onClick={() => navigator.clipboard?.writeText(value)}>
          <Copy size={12} />
        </Button>
      )}
      {sensitive && canRevealSecrets && !isRevealed && (
        <Button variant="outline-secondary" size="sm" className="py-0 px-1 x-small" onClick={() => onRevealSecret(fieldKey)}>
          <Eye size={12} className="me-1" /> Mostrar
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
}: {
  group: FunctionalGroup
  canRevealSecrets: boolean
  revealedSecrets: Record<string, boolean>
  onRevealSecret: (key: string) => void
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
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="small text-muted py-1">Sin datos funcionales para esta categoria.</div>
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

const executionModeCopy = (mode?: string, label?: string) => {
  const value = String(mode || '').toUpperCase()
  if (value === 'IA') return 'Ejecutado con IA'
  if (value === 'AUTOMATIZADA') return 'Ejecutado automatizado'
  if (value === 'EXTERNA') return 'Ejecucion externa'
  return label ? `Ejecutado ${label.toLowerCase()}` : 'Ejecutado manualmente'
}

const caseTypeBadge = (caseType?: string) => {
  const value = String(caseType || '').toLowerCase()
  if (value === 'automatizada_ia') return 'primary'
  if (value === 'automatizada') return 'info'
  return 'secondary'
}

const caseTypeCopy = (label?: string) => `Caso ${String(label || 'Manual').toLowerCase()}`

const runStateLabel = (state?: string) => {
  const value = String(state || '').toUpperCase()
  if (value === 'ABIERTO') return 'Run abierto'
  if (value === 'EN_PROGRESO') return 'En curso'
  if (value === 'CERRADO') return 'Cerrado'
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

export function EvidenceList({ items, onOpenEvidence }: { items: any[], onOpenEvidence: (attachment: any) => void }) {
  if (!items?.length) return <span className="text-muted x-small"><ImageIcon size={12} className="me-1" />Sin evidencia</span>
  return (
    <div className="d-flex align-items-center gap-1 flex-wrap">
      {items.map((attachment: any) => (
        isEvidenceAvailable(attachment) && isImageAsset(attachment) ? (
          <button
            key={attachment.id}
            type="button"
            className="border rounded-2 bg-white p-0"
            title={attachment.filename_original}
            onClick={() => onOpenEvidence(attachment)}
          >
            <img src={resolveAssetUrl(attachment.public_url)} alt={attachment.filename_original} className="rounded-2" style={{ width: 32, height: 32, objectFit: 'cover' }} />
          </button>
        ) : (
          <Button key={attachment.id} variant={isEvidenceAvailable(attachment) ? 'outline-secondary' : 'outline-warning'} size="sm" className="x-small py-0 px-1" title={attachment.filename_original} onClick={() => onOpenEvidence(attachment)}>
            <FileText size={12} /> {attachment.filename_original || 'Archivo'}
            {!isEvidenceAvailable(attachment) && <Badge bg="warning" text="dark" className="ms-1">Archivo no disponible</Badge>}
          </Button>
        )
      ))}
    </div>
  )
}

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
    () => buildFrozenVariableView(detail?.variables_resueltas, frozenSearch),
    [detail?.variables_resueltas, frozenSearch],
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
        throw new Error(data?.detail || 'No se pudo auditar la visualizacion del secreto.')
      }
      setRevealedSecrets(current => ({ ...current, [variable]: true }))
    } catch (error: any) {
      showFeedback?.('Snapshot de ejecución', error?.message || 'No se pudo registrar auditoria para mostrar el secreto.', 'danger')
    }
  }

  const markAiReviewed = async (executionId: string, note = '') => {
    if (!onMarkAiReviewed) return
    if (!executionId) {
      setReviewActionError('No se pudo marcar la revision. Falta el identificador de la ejecucion IA.')
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
      setReviewActionError(error?.message || 'No se pudo marcar la revision. Verifica que el backend este actualizado y reiniciado.')
    } finally {
      setMarkingReviewIds(current => {
        const next = { ...current }
        delete next[executionId]
        return next
      })
    }
  }

  return (
    <>
      <Modal
        show={!isNestedModalOpen && (!!detail || detailLoading || !!detailError)}
        onHide={onHide}
        size="xl"
        centered
        scrollable
      >
        <Modal.Header closeButton>
          <Modal.Title className="fw-bold d-flex align-items-center gap-2">
            <History size={20} /> Detalle de ejecucion
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {detailLoading && <div className="text-center py-5"><Spinner className="mb-2" /><div className="small text-muted">Cargando detalle...</div></div>}
          {detailError && <Alert variant="danger">{detailError}</Alert>}
          {reviewActionError && <Alert variant="danger">{reviewActionError}</Alert>}
          {detail && (
            <div className="d-flex flex-column gap-3">
            {focusError ? (
              <Alert variant="danger" className="mb-0">
                La ejecución seleccionada ya no está disponible dentro de este run. Vuelve al historial del caso y actualiza la página.
              </Alert>
            ) : focusedCase && (
              <Alert variant="info" className="mb-0 py-2 small">
                Mostrando ejecución de <strong>{focusedCase.codigo || focusedCase.caso_id?.slice(0, 8) || 'caso seleccionado'}</strong>.
              </Alert>
            )}
            <Card className="border p-3">
              <Row className="g-3 small">
                <Col md={3}><div className="text-muted x-small text-uppercase fw-bold">Run</div><div className="fw-bold">{detail.nombre}</div></Col>
                <Col md={3}><div className="text-muted x-small text-uppercase fw-bold">Build</div><div>{detail.build?.nombre || '-'}</div></Col>
                <Col md={2}><div className="text-muted x-small text-uppercase fw-bold">Componente</div><div>{detail.componente?.nombre || '-'}</div></Col>
                <Col md={2}><div className="text-muted x-small text-uppercase fw-bold">Ambiente</div><div>{detail.entorno?.nombre || '-'}</div></Col>
                <Col md={2}><div className="text-muted x-small text-uppercase fw-bold">Dataset</div><div>{detail.dataset?.nombre || 'Sin dataset'}</div></Col>
                <Col md={3}><div className="text-muted x-small text-uppercase fw-bold">Ejecutor</div><div>{detail.creado_por_nombre || '-'}</div></Col>
                <Col md={3}><div className="text-muted x-small text-uppercase fw-bold">Creacion</div><div>{formatDate(detail.fecha_creacion)}</div></Col>
                <Col md={2}><div className="text-muted x-small text-uppercase fw-bold">Origen del run</div><Badge bg="light" text="dark" className="border">{detail.origen}</Badge></Col>
                <Col md={2}><div className="text-muted x-small text-uppercase fw-bold">Estado run</div><Badge bg="secondary">{runStateLabel(detail.estado_run)}</Badge></Col>
                <Col md={2}><div className="text-muted x-small text-uppercase fw-bold">Ejecutado con</div><Badge bg={isAiRun(detail) ? 'primary' : detail.execution_mode_summary === 'MIXTO' ? 'warning' : executionModeBadge(detail.execution_mode_summary)} text={detail.execution_mode_summary === 'MIXTO' && !isAiRun(detail) ? 'dark' : undefined}>{isAiRun(detail) ? 'IA' : detail.execution_mode_label || 'Manual'}</Badge></Col>
              </Row>
            </Card>

            <Card className="border p-2">
              <div className="d-flex align-items-start justify-content-between gap-2">
                <div>
                  <div className="fw-bold small">Snapshot de ejecución</div>
                  <div className="x-small text-muted">
                    Ficha tecnica de la ejecucion, con variables tecnicas disponibles en modo avanzado.
                  </div>
                </div>
                <div className="d-flex align-items-center gap-1 flex-shrink-0">
                  <Badge bg="light" text="dark" className="border">{frozenVariables.visibleFunctionalCount} visibles</Badge>
                  <Badge bg="light" text="dark" className="border">{frozenVariables.total} tecnicas</Badge>
                  <Button variant="outline-secondary" size="sm" className="fw-bold ms-1" onClick={() => setShowExecutionSnapshot(current => !current)}>
                    {showExecutionSnapshot ? <ChevronDown size={14} className="me-1" /> : <ChevronRight size={14} className="me-1" />}
                    {showExecutionSnapshot ? 'Ocultar' : 'Ver'}
                  </Button>
                </div>
              </div>
              {showExecutionSnapshot && (
                <>
                  <div className="position-relative mt-2 mb-2">
                    <Search size={15} className="position-absolute text-muted" style={{ left: 12, top: 10 }} />
                    <Form.Control
                      size="sm"
                      className="ps-5"
                      placeholder="Buscar variable..."
                      value={frozenSearch}
                      onChange={(event) => setFrozenSearch(event.target.value)}
                    />
                  </div>
                  {frozenVariables.total === 0 ? (
                    <div className="small text-muted">Sin variables congeladas.</div>
                  ) : (
                    <>
                      <Row className="g-2">
                        {frozenVariables.groups.map(group => (
                          <Col md={6} key={group.id}>
                            <FrozenDataCard
                              group={group}
                              canRevealSecrets={canRevealSecrets}
                              revealedSecrets={revealedSecrets}
                              onRevealSecret={revealSecret}
                            />
                          </Col>
                        ))}
                      </Row>
                      <div className="border rounded-3 bg-light p-2 mt-2">
                        <div className="d-flex align-items-center justify-content-between gap-2">
                          <div>
                            <div className="fw-bold small">Variables tecnicas</div>
                            <div className="x-small text-muted">Diccionario original completo.</div>
                          </div>
                          <Button variant="outline-secondary" size="sm" className="fw-bold" onClick={() => setShowTechnicalVariables(current => !current)}>
                            {showTechnicalVariables ? 'Ocultar variables tecnicas' : 'Ver variables tecnicas'}
                          </Button>
                        </div>
                        {showTechnicalVariables && (
                          <div className="table-responsive mt-3">
                            <table className="table table-sm table-bordered bg-white mb-0 small">
                              <thead>
                                <tr>
                                  <th style={{ width: 260 }}>Variable</th>
                                  <th>Valor</th>
                                </tr>
                              </thead>
                              <tbody>
                                {frozenVariables.technicalRows.map(row => (
                                  <tr key={row.key}>
                                    <td>
                                      <div className="font-monospace">{row.key}</div>
                                      <div className="x-small text-muted">{row.label}</div>
                                    </td>
                                    <td>
                                      <FrozenValue
                                        fieldKey={row.key}
                                        value={row.value}
                                        sensitive={row.sensitive}
                                        canRevealSecrets={canRevealSecrets}
                                        revealedSecrets={revealedSecrets}
                                        onRevealSecret={revealSecret}
                                      />
                                    </td>
                                  </tr>
                                ))}
                                {frozenVariables.technicalRows.length === 0 && (
                                  <tr><td colSpan={2} className="text-muted">No hay variables que coincidan con la busqueda.</td></tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </Card>

            {!focusError && displayCases.map((caso: any) => {
              const executionMode = effectiveExecutionMode(detail, caso)
              const executionLabel = effectiveExecutionModeLabel(executionMode, caso.execution_mode_label)
              const executionId = getExecutionId(caso)
              return (
              <Card key={executionId || caso.caso_id} className="border shadow-sm">
                <Card.Header className="bg-white d-flex justify-content-between align-items-start gap-3">
                  <div>
                    <div className="d-flex align-items-center gap-2">
                      <Badge bg="light" text="primary" className="border">{caso.codigo || caso.caso_id?.slice(0, 8)}</Badge>
                      <span className="fw-bold">{caso.titulo}</span>
                      <Badge bg={caseTypeBadge(caso.case_type)}>{caseTypeCopy(caso.case_type_label)}</Badge>
                      <Badge bg={executionModeBadge(executionMode)}>{executionModeCopy(executionMode, executionLabel)}</Badge>
                      {caso.ai_review_status === 'REVISADA' && <Badge bg="success">IA revisada</Badge>}
                      {caso.ai_human_review_required && <Badge bg="danger">Revision humana pendiente</Badge>}
                    </div>
                    <div className="x-small text-muted mt-1">v{caso.version_ejecutada} ejecutada - {formatDate(caso.fecha_ejecucion)} - {formatSeconds(caso.duracion_segundos)}</div>
                  </div>
                  <Badge bg={getStatusColor(caso.estado)}>{caso.estado}</Badge>
                </Card.Header>
                <Card.Body className="d-flex flex-column gap-3">
                  {caso.has_ai_report && (
                    <Alert variant={caso.ai_human_review_required ? 'warning' : 'info'} className="mb-0">
                      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
                        <div>
                          <div className="fw-bold small">Reporte IA disponible</div>
                          <div className="x-small">
                            Consenso: {caso.ai_consensus || caso.ai_report?.consensus || caso.estado}
                            {' · '}Confianza: {caso.ai_confidence ?? caso.ai_report.confidence ?? 0}%
                            {caso.ai_failure_category ? ` · ${caso.ai_failure_category}` : ''}
                          </div>
                        </div>
                        <div className="d-flex align-items-center gap-2">
                          {onMarkAiReviewed && (caso.ai_human_review_required || caso.ai_review_status === 'REQUIERE_REVISION') && (
                            <Button variant="warning" size="sm" className="fw-bold" disabled={!!markingReviewIds[executionId]} onClick={() => setReviewConfirmCase(caso)}>
                              {markingReviewIds[executionId] && <Spinner size="sm" className="me-1" />}
                              Marcar como revisada
                            </Button>
                          )}
                          <Button variant="outline-primary" size="sm" onClick={() => setAiReportCase({
                            execution_id: executionId,
                            case_id: caso.caso_id,
                            case_code: caso.codigo,
                            case_title: caso.titulo,
                            status: caso.estado,
                            observations: caso.observaciones,
                            duration_seconds: caso.duracion_segundos,
                            confidence: caso.ai_confidence,
                            consensus: caso.ai_consensus,
                            failure_category: caso.ai_failure_category,
                            error_code: caso.ai_error_code,
                            execution_mode: executionMode,
                            review_status: caso.ai_review_status,
                            human_review_required: caso.ai_human_review_required,
                            ai_report: caso.ai_report,
                          })}>
                            Ver reporte IA
                          </Button>
                        </div>
                      </div>
                    </Alert>
                  )}
                  {!caso.has_ai_report && executionMode === 'IA' && (
                    <Alert variant="info" className="mb-0">
                      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
                        <div>
                          <div className="fw-bold small">Reporte IA disponible</div>
                          <div className="x-small">Ejecucion IA sin reporte estructurado. Se muestran datos reconstruidos desde la ejecucion y sus pasos.</div>
                        </div>
                        <div className="d-flex align-items-center gap-2">
                          {onMarkAiReviewed && (caso.ai_human_review_required || caso.ai_review_status === 'REQUIERE_REVISION') && (
                            <Button variant="warning" size="sm" className="fw-bold" disabled={!!markingReviewIds[executionId]} onClick={() => setReviewConfirmCase(caso)}>
                              {markingReviewIds[executionId] && <Spinner size="sm" className="me-1" />}
                              Marcar como revisada
                            </Button>
                          )}
                          <Button variant="outline-primary" size="sm" onClick={() => setAiReportCase(buildHistoryAiReportPayload(detail, caso))}>
                            Ver reporte IA
                          </Button>
                        </div>
                      </div>
                    </Alert>
                  )}
                  {(caso.descripcion || caso.precondiciones || caso.postcondiciones) && (
                    <Row className="g-2 small">
                      {caso.descripcion && <Col md={4}><div className="fw-bold text-muted x-small text-uppercase">Objetivo</div><div>{caso.descripcion}</div></Col>}
                      {caso.precondiciones && <Col md={4}><div className="fw-bold text-muted x-small text-uppercase">Precondiciones</div><div>{caso.precondiciones}</div></Col>}
                      {caso.postcondiciones && <Col md={4}><div className="fw-bold text-muted x-small text-uppercase">Postcondiciones</div><div>{caso.postcondiciones}</div></Col>}
                    </Row>
                  )}
                  {(caso.dataset_resuelto || []).length > 0 && (
                    <div>
                      <div className="fw-bold text-muted x-small text-uppercase mb-1">Datos usados por el caso</div>
                      <div className="d-flex flex-wrap gap-1">
                        {caso.dataset_resuelto.map((item: any, index: number) => <Badge key={`${item.key}-${index}`} bg="light" text="dark" className="border font-monospace">{item.key}={item.value}</Badge>)}
                      </div>
                    </div>
                  )}
                  {(caso.snapshots || []).map((snapshot: any) => (
                    <div key={snapshot.id} className="border rounded-3 p-3">
                      <div className="d-flex justify-content-between align-items-center mb-2">
                        <div className="fw-bold small">Paso {snapshot.numero_paso}</div>
                        <Badge bg={getStatusColor(snapshot.estado_paso)}>{snapshot.estado_paso}</Badge>
                      </div>
                      <Row className="g-3 small">
                        <Col md={4}><div className="text-muted x-small fw-bold text-uppercase">Accion</div><div>{snapshot.accion_congelada || 'Sin accion definida'}</div></Col>
                        <Col md={4}><div className="text-muted x-small fw-bold text-uppercase">Datos resueltos</div><div className="font-monospace">{snapshot.datos_resueltos || '-'}</div></Col>
                        <Col md={4}><div className="text-muted x-small fw-bold text-uppercase">Resultado esperado</div><div>{snapshot.resultado_esperado_congelado || '-'}</div></Col>
                        {(snapshot.comentarios || snapshot.error_log) && <Col md={12}><div className="text-muted x-small fw-bold text-uppercase">Observaciones</div><div>{snapshot.comentarios || snapshot.error_log}</div></Col>}
                        <Col md={6}><div className="text-muted x-small fw-bold text-uppercase mb-1">Referencias</div>{canViewEvidence ? <EvidenceList items={[...(snapshot.action_references || []), ...(snapshot.expected_references || [])]} onOpenEvidence={onOpenEvidence} /> : <span className="text-muted x-small">Sin acceso</span>}</Col>
                        <Col md={6}><div className="text-muted x-small fw-bold text-uppercase mb-1">Evidencias</div>{canViewEvidence ? <EvidenceList items={snapshot.evidencias || []} onOpenEvidence={onOpenEvidence} /> : <span className="text-muted x-small">Sin acceso</span>}</Col>
                      </Row>
                    </div>
                  ))}
                </Card.Body>
              </Card>
              )
            })}
            </div>
          )}
        </Modal.Body>
      </Modal>
      <AiExecutionReportModal
        show={!!aiReportCase}
        report={aiReportCase}
        onHide={() => setAiReportCase(null)}
        onMarkReviewed={onMarkAiReviewed ? (executionId: string) => markAiReviewed(executionId) : undefined}
      />
      <Modal show={!!reviewConfirmCase} onHide={() => setReviewConfirmCase(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="fw-bold">Confirmar revision IA</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="small mb-3">
            Esto registra que validaste humanamente esta ejecucion IA. No cambia el resultado de la prueba.
          </p>
          <Form.Group>
            <Form.Label className="small fw-bold">Nota opcional</Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              value={reviewNote}
              onChange={event => setReviewNote(event.target.value)}
              placeholder="Ej: Valide capturas, pasos y diagnostico IA."
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setReviewConfirmCase(null)}>
            Cancelar
          </Button>
          <Button
            variant="warning"
            className="fw-bold"
            disabled={!!markingReviewIds[getExecutionId(reviewConfirmCase)]}
            onClick={() => markAiReviewed(getExecutionId(reviewConfirmCase), reviewNote)}
          >
            {markingReviewIds[getExecutionId(reviewConfirmCase)] && <Spinner size="sm" className="me-1" />}
            Confirmar revision
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  )
}
