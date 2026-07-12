import type { Dispatch, SetStateAction } from 'react'
import { API_BASE } from '../../app/constants'
import { isValidUUID } from '../../app/validation'
import { formatDateTime } from '../../shared/utils/dateTime'
import { fetchProjectRunHistory, fetchTestRunDetail } from './api/historialApi'

type CreateHistorialActionsParams = {
  currentProjectId: string
  projectsSource: 'local' | 'backend'
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  setRunHistory: Dispatch<SetStateAction<any[]>>
  setProjectSyncMessage: (message: string) => void
  showFeedback?: (title: string, message: string, variant?: string) => void
  loadProjectMetrics?: () => Promise<void> | void
}

export function createHistorialActions({
  currentProjectId,
  projectsSource,
  fetchWithAuth,
  setRunHistory,
  setProjectSyncMessage,
  showFeedback,
  loadProjectMetrics,
}: CreateHistorialActionsParams) {
  const normalizeReviewCount = (...values: any[]) => {
    for (const value of values) {
      const numberValue = Number(value)
      if (Number.isFinite(numberValue) && numberValue > 0) return numberValue
    }
    return 0
  }

  const loadProjectRunHistory = async (filters: Record<string, any> = {}) => {
    if (!currentProjectId || !isValidUUID(currentProjectId) || projectsSource !== 'backend') return
    try {
      const params = new URLSearchParams({ limit: '50' })
      Object.entries(filters).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return
        if (key === 'date_from') {
          params.set(key, `${value}T00:00:00`)
          return
        }
        if (key === 'date_to') {
          params.set(key, `${value}T23:59:59`)
          return
        }
        params.set(key, String(value))
      })
      const data = await fetchProjectRunHistory(fetchWithAuth, currentProjectId, params)
      const normalizedRuns = (Array.isArray(data) ? data : []).map((run: any) => {
        return {
          id: run.id,
          runId: run.runId || run.id,
          projectId: run.projectId || currentProjectId,
          buildId: run.build_id || '',
          buildName: run.build_name || '',
          buildCode: run.build_code || '',
          componentId: run.component_id || '',
          componentName: run.component_name || '',
          environmentId: run.environment_id || '',
          environmentName: run.environment_name || '',
          datasetId: run.dataset_id || '',
          datasetName: run.dataset_name || '',
          origin: run.origin || '',
          executionModes: run.execution_modes || {},
          executionModeSummary: run.execution_mode_summary || 'MANUAL',
          executionModeLabel: run.execution_mode_label || 'Manual',
          executionModeDetail: run.execution_mode_detail || '',
          aiReviewRequired: normalizeReviewCount(run.ai_review_required, run.aiReviewRequired, run.human_review_required),
          aiReviewReviewed: normalizeReviewCount(run.ai_review_reviewed, run.aiReviewReviewed, run.human_review_reviewed),
          aiReviewPending: normalizeReviewCount(run.ai_review_pending, run.aiReviewPending, run.human_review_pending),
          runnerId: run.runner_id || '',
          date: run.date ? formatDateTime(run.date) : '',
          rawDate: run.date || '',
          suite: run.suite || run.build_name || 'Run sin build',
          runner: run.runner || 'Sistema',
          passed: run.passed || 0,
          failed: run.failed || 0,
          blocked: run.blocked || 0,
          pending: run.pending || 0,
          status: run.status || 'pending',
          evidencias: Array.isArray(run.evidencias) ? run.evidencias : [],
        }
      })
      setRunHistory(normalizedRuns)
    } catch (error: any) {
      setProjectSyncMessage(`No se pudo cargar historial de runs: ${error.message}`)
    }
  }

  const loadTestRunDetail = async (runId: string) => {
    return fetchTestRunDetail(fetchWithAuth, runId)
  }

  const markHistorialAiReviewed = async (executionId: string, note = 'Revision registrada desde historial') => {
    const payload = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    }
    let response = await fetchWithAuth(`${API_BASE}/ejecuciones/${executionId}/ai-review`, payload)
    if (response.status === 404) {
      response = await fetchWithAuth(`${API_BASE}/ejecuciones/${executionId}/ai-review/`, payload)
    }
    if (!response.ok) {
      const error = await response.json().catch(() => null)
      const detail = error?.detail || ''
      if (response.status === 404) {
        throw new Error(
          detail && detail !== 'Not Found'
            ? detail
            : `No se pudo marcar la revision IA para execution_id=${executionId}. Endpoint usado: ${API_BASE}/ejecuciones/${executionId}/ai-review. Si ese ID existe, reinicia el backend para exponer la ruta actualizada.`
        )
      }
      throw new Error(detail || `No se pudo marcar la revision IA (${response.status})`)
    }
    showFeedback?.('Revision IA', 'La ejecucion quedo marcada como revisada.', 'success')
    await loadProjectMetrics?.()
  }

  return {
    loadProjectRunHistory,
    loadTestRunDetail,
    markHistorialAiReviewed,
  }
}
