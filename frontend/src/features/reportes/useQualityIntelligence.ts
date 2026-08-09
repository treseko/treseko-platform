import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE } from '../../app/constants'
import { isValidUUID } from '../../app/validation'

export type QualityHealthItem = {
  case_master_id: string
  case_code?: string | null
  case_title?: string | null
  scope_key: string
  algorithm_version: string
  classification: 'STABLE' | 'FLAKY' | 'BLOCKED' | 'INSUFFICIENT_DATA' | 'MIXED' | string
  flaky_score: number
  window_size: number
  total_observations: number
  passed_count: number
  failed_count: number
  blocked_count: number
  transition_count: number
  evidence_summary: Record<string, unknown>
  calculated_at: string
}

export type QualityHealthResponse = {
  proyecto_id: string
  algorithm_version: string
  analysis_scope: string
  items: QualityHealthItem[]
  source_revision: number
  rebuilt_revision: number
  is_stale: boolean
  source_updated_at: string | null
  rebuilt_at: string | null
}

export type QualityFailureFingerprint = {
  id: string
  fingerprint: string
  signature_version: string
  failure_category: string
  occurrence_count: number
  case_count: number
  first_seen_at: string
  last_seen_at: string
}

export type QualityFailureFingerprintResponse = {
  proyecto_id: string
  algorithm_version: string
  items: QualityFailureFingerprint[]
}

export type QualityExecutionObservation = {
  id: string
  ejecucion_caso_id: string
  case_master_id: string
  case_code?: string | null
  case_title?: string | null
  build_id?: string | null
  build_name?: string | null
  suite_id?: string | null
  suite_name?: string | null
  entorno_id?: string | null
  environment_name?: string | null
  runner_id?: string | null
  runner_name?: string | null
  resultado: string
  execution_mode: string
  intento_numero: number
  duracion_segundos: number
  observed_at: string
  failure_fingerprint_id?: string | null
  failure_category?: string | null
  evidence_summary: Record<string, unknown>
}

export type QualityExecutionObservationResponse = {
  proyecto_id: string
  algorithm_version: string
  analysis_scope: string
  items: QualityExecutionObservation[]
  source_revision: number
  rebuilt_revision: number
  is_stale: boolean
  source_updated_at: string | null
  rebuilt_at: string | null
}

export type QualityIntelligenceSummary = {
  proyecto_id: string
  algorithm_version: string
  analysis_scope: string
  health_cases: number
  assessable_cases: number
  flaky_cases: number
  blocked_cases: number
  stable_cases: number
  mixed_cases: number
  insufficient_data_cases: number
  flaky_case_rate: number | null
  terminal_observations: number
  terminal_duration_seconds: number
  retry_observations: number
  calculated_at: string | null
  source_revision: number
  rebuilt_revision: number
  is_stale: boolean
  source_updated_at: string | null
  rebuilt_at: string | null
}

export type QualityDiagnosis = {
  id: string
  proyecto_id: string
  ejecucion_caso_id?: string | null
  failure_fingerprint_id?: string | null
  source_revision: number
  status: string
  facts: Array<{ statement?: string; evidence_refs?: string[] }>
  hypotheses: Array<{ statement?: string; confidence?: number; evidence_refs?: string[] }>
  unknowns: string[]
  recommended_next_steps: string[]
  evidence_refs: string[]
  provider?: string | null
  model?: string | null
  created_at: string
  reviewed_at?: string | null
  review_note?: string | null
  supersedes_diagnosis_id?: string | null
}

export type QualityDiagnosisEditPayload = {
  facts?: Array<{ statement?: string; evidence_refs?: string[] }>
  hypotheses?: Array<{ statement?: string; confidence?: number; evidence_refs?: string[] }>
  unknowns?: string[]
  recommended_next_steps?: string[]
  note: string
}

export type QualityDiagnosisBugDraft = {
  diagnosis_id: string
  target_path: string
  payload: Record<string, unknown>
}

export type ReleaseRiskEvaluation = {
  id: string
  build_id: string
  score: number
  level: string
  recommendation: string
  factors: Array<{ id: string; weight: number; points: number; value: unknown; evidence_refs: string[] }>
  created_at: string
  accepted_at?: string | null
  acceptance_note?: string | null
  comparison: {
    available: boolean
    evaluation_id?: string
    build_id?: string
    score?: number
    recommendation?: string
    accepted_at?: string | null
    score_delta?: number
  }
}

type Params = {
  currentProjectId: string
  currentBuildId: string
  enabled: boolean
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  showFeedback: (title: string, message: string, variant?: string) => void
  t: (key: `${string}.${string}`, params?: Record<string, string | number>) => string
}

export function useQualityIntelligence({ currentProjectId, currentBuildId, enabled, fetchWithAuth, showFeedback, t }: Params) {
  const [health, setHealth] = useState<QualityHealthResponse | null>(null)
  const [fingerprints, setFingerprints] = useState<QualityFailureFingerprintResponse | null>(null)
  const [observations, setObservations] = useState<QualityExecutionObservationResponse | null>(null)
  const [summary, setSummary] = useState<QualityIntelligenceSummary | null>(null)
  const [diagnoses, setDiagnoses] = useState<QualityDiagnosis[]>([])
  const [releaseRisk, setReleaseRisk] = useState<ReleaseRiskEvaluation | null>(null)
  const [loading, setLoading] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [diagnosingExecutionId, setDiagnosingExecutionId] = useState('')
  const [reviewingDiagnosisId, setReviewingDiagnosisId] = useState('')
  const [editingDiagnosisId, setEditingDiagnosisId] = useState('')
  const [bugDraft, setBugDraft] = useState<QualityDiagnosisBugDraft | null>(null)
  const [error, setError] = useState('')
  const latestRequest = useRef(0)

  const loadHealth = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    const requestId = ++latestRequest.current
    if (!enabled || !currentProjectId || !isValidUUID(currentProjectId)) {
      setHealth(null)
      setFingerprints(null)
      setObservations(null)
      setSummary(null)
      setDiagnoses([])
      setReleaseRisk(null)
      setBugDraft(null)
      setError('')
      return null
    }
    if (!silent) setLoading(true)
    try {
      const [healthResponse, fingerprintResponse, observationResponse, summaryResponse, diagnosisResponse] = await Promise.all([
        fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/quality-intelligence/health?limit=100`),
        fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/quality-intelligence/fingerprints?limit=25`),
        fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/quality-intelligence/observations?limit=10`),
        fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/quality-intelligence/summary`),
        fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/quality-intelligence/diagnoses?limit=10`),
      ])
      if (!healthResponse.ok || !fingerprintResponse.ok || !observationResponse.ok || !summaryResponse.ok || !diagnosisResponse.ok) {
        const failedResponse = !healthResponse.ok
          ? healthResponse
          : !fingerprintResponse.ok
            ? fingerprintResponse
            : !observationResponse.ok
              ? observationResponse
              : !summaryResponse.ok
                ? summaryResponse
                : diagnosisResponse
        const body = await failedResponse.json().catch(() => null)
        throw new Error(body?.detail || `Backend respondió ${failedResponse.status}`)
      }
      const [payload, fingerprintPayload, observationPayload, summaryPayload, diagnosisPayload] = await Promise.all([
        healthResponse.json() as Promise<QualityHealthResponse>,
        fingerprintResponse.json() as Promise<QualityFailureFingerprintResponse>,
        observationResponse.json() as Promise<QualityExecutionObservationResponse>,
        summaryResponse.json() as Promise<QualityIntelligenceSummary>,
        diagnosisResponse.json() as Promise<{ items: QualityDiagnosis[] }>,
      ])
      let riskPayload: ReleaseRiskEvaluation | null = null
      if (isValidUUID(currentBuildId)) {
        const riskResponse = await fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/quality-intelligence/release-risk?build_id=${currentBuildId}`)
        if (riskResponse.ok) riskPayload = await riskResponse.json() as ReleaseRiskEvaluation
        else if (riskResponse.status !== 404) {
          const body = await riskResponse.json().catch(() => null)
          throw new Error(body?.detail || `Backend respondió ${riskResponse.status}`)
        }
      }
      if (requestId === latestRequest.current) {
        setHealth(payload)
        setFingerprints(fingerprintPayload)
        setObservations(observationPayload)
        setSummary(summaryPayload)
        setDiagnoses(diagnosisPayload.items || [])
        setReleaseRisk(riskPayload)
        setError('')
      }
      return payload
    } catch (reason: any) {
      if (requestId === latestRequest.current) {
        setHealth(null)
        setFingerprints(null)
        setObservations(null)
        setSummary(null)
        setDiagnoses([])
        setReleaseRisk(null)
        setError(reason?.message || String(reason))
      }
      return null
    } finally {
      if (requestId === latestRequest.current && !silent) setLoading(false)
    }
  }, [currentProjectId, currentBuildId, enabled, fetchWithAuth])

  const evaluateReleaseRisk = useCallback(async () => {
    if (!currentProjectId || !isValidUUID(currentProjectId) || !isValidUUID(currentBuildId)) return
    try {
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/quality-intelligence/release-risk/evaluate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ build_id: currentBuildId }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.detail || `Backend respondió ${response.status}`)
      }
      setReleaseRisk(await response.json() as ReleaseRiskEvaluation)
      showFeedback(t('reportes.releaseRiskEvaluated'), t('reportes.releaseRiskEvaluatedDetail'), 'success')
    } catch (reason: any) {
      showFeedback(t('reportes.releaseRiskError'), reason?.message || String(reason), 'danger')
    }
  }, [currentProjectId, currentBuildId, fetchWithAuth, showFeedback, t])

  const acceptReleaseRisk = useCallback(async (note: string) => {
    if (!currentProjectId || !releaseRisk || note.trim().length < 3) return
    try {
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/quality-intelligence/release-risk/${releaseRisk.id}/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: note.trim() }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.detail || `Backend respondió ${response.status}`)
      }
      setReleaseRisk(await response.json() as ReleaseRiskEvaluation)
      showFeedback(t('reportes.releaseRiskAccepted'), t('reportes.releaseRiskAcceptedDetail'), 'success')
    } catch (reason: any) {
      showFeedback(t('reportes.releaseRiskError'), reason?.message || String(reason), 'danger')
    }
  }, [currentProjectId, fetchWithAuth, releaseRisk, showFeedback, t])

  const createDiagnosis = useCallback(async (observation: QualityExecutionObservation) => {
    if (!currentProjectId || !isValidUUID(currentProjectId) || !observation.ejecucion_caso_id) return
    setDiagnosingExecutionId(observation.ejecucion_caso_id)
    try {
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/quality-intelligence/diagnoses`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ejecucion_caso_id: observation.ejecucion_caso_id, failure_fingerprint_id: observation.failure_fingerprint_id || undefined }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.detail || `Backend respondió ${response.status}`)
      }
      await loadHealth({ silent: true })
      showFeedback(t('reportes.qualityDiagnosisCreated'), t('reportes.qualityDiagnosisCreatedDetail'), 'success')
    } catch (reason: any) {
      showFeedback(t('reportes.qualityDiagnosisError'), reason?.message || String(reason), 'danger')
    } finally {
      setDiagnosingExecutionId('')
    }
  }, [currentProjectId, fetchWithAuth, loadHealth, showFeedback, t])

  const reviewDiagnosis = useCallback(async (diagnosisId: string, status: 'ACCEPTED' | 'REJECTED') => {
    if (!currentProjectId || !isValidUUID(currentProjectId)) return
    setReviewingDiagnosisId(diagnosisId)
    try {
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/quality-intelligence/diagnoses/${diagnosisId}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.detail || `Backend respondió ${response.status}`)
      }
      await loadHealth({ silent: true })
      showFeedback(t('reportes.qualityDiagnosisReviewed'), t('reportes.qualityDiagnosisReviewedDetail'), 'success')
    } catch (reason: any) {
      showFeedback(t('reportes.qualityDiagnosisError'), reason?.message || String(reason), 'danger')
    } finally {
      setReviewingDiagnosisId('')
    }
  }, [currentProjectId, fetchWithAuth, loadHealth, showFeedback, t])

  const editDiagnosis = useCallback(async (diagnosisId: string, payload: QualityDiagnosisEditPayload) => {
    if (!currentProjectId || !isValidUUID(currentProjectId) || payload.note.trim().length < 3) return
    setEditingDiagnosisId(diagnosisId)
    try {
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/quality-intelligence/diagnoses/${diagnosisId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.detail || `Backend respondió ${response.status}`)
      }
      await loadHealth({ silent: true })
      showFeedback(t('reportes.qualityDiagnosisEdited'), t('reportes.qualityDiagnosisEditedDetail'), 'success')
    } catch (reason: any) {
      showFeedback(t('reportes.qualityDiagnosisError'), reason?.message || String(reason), 'danger')
    } finally {
      setEditingDiagnosisId('')
    }
  }, [currentProjectId, fetchWithAuth, loadHealth, showFeedback, t])

  const prepareBugDraft = useCallback(async (diagnosisId: string) => {
    if (!currentProjectId || !isValidUUID(currentProjectId)) return
    try {
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/quality-intelligence/diagnoses/${diagnosisId}/bug-draft`)
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.detail || `Backend respondió ${response.status}`)
      }
      setBugDraft(await response.json() as QualityDiagnosisBugDraft)
    } catch (reason: any) {
      showFeedback(t('reportes.qualityDiagnosisError'), reason?.message || String(reason), 'danger')
    }
  }, [currentProjectId, fetchWithAuth, showFeedback, t])

  const rebuild = useCallback(async () => {
    if (!currentProjectId || !isValidUUID(currentProjectId)) return
    setRebuilding(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/quality-intelligence/rebuild`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ window_size: 20 }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.detail || `Backend respondió ${response.status}`)
      }
      const result = await response.json()
      await loadHealth({ silent: true })
      showFeedback(t('reportes.qualityAnalysisUpdated'), t('reportes.qualityAnalysisUpdatedDetail', {
        observations: Number(result?.observations || 0),
      }), 'success')
    } catch (reason: any) {
      showFeedback(t('reportes.qualityAnalysisError'), reason?.message || String(reason), 'danger')
    } finally {
      setRebuilding(false)
    }
  }, [currentProjectId, fetchWithAuth, loadHealth, showFeedback, t])

  useEffect(() => {
    void loadHealth()
  }, [loadHealth])

  return { health, fingerprints, observations, summary, diagnoses, releaseRisk, loading, rebuilding, diagnosingExecutionId, reviewingDiagnosisId, editingDiagnosisId, bugDraft, error, loadHealth, rebuild, createDiagnosis, reviewDiagnosis, editDiagnosis, prepareBugDraft, evaluateReleaseRisk, acceptReleaseRisk }
}
