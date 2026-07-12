import type { Dispatch, SetStateAction } from 'react'
import { API_BASE } from '../../app/constants'
import { isValidUUID } from '../../app/validation'

type CreateReportActionsParams = {
  currentProjectId: string
  currentBuildId: string
  projectsSource: 'local' | 'backend'
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  setProjectMetrics: Dispatch<SetStateAction<any>>
  setMetricsLoading: (loading: boolean) => void
  setProjectSyncMessage: (message: string) => void
}

export function createReportActions({
  currentProjectId,
  currentBuildId,
  projectsSource,
  fetchWithAuth,
  setProjectMetrics,
  setMetricsLoading,
  setProjectSyncMessage
}: CreateReportActionsParams) {
  const loadProjectMetrics = async (buildId?: string, options?: { silent?: boolean }) => {
    if (!currentProjectId || !isValidUUID(currentProjectId) || projectsSource !== 'backend') {
      setProjectMetrics(null)
      return
    }
    const silent = Boolean(options?.silent)
    if (!silent) setMetricsLoading(true)
    try {
      const effectiveBuildId = buildId || currentBuildId
      const url = effectiveBuildId && isValidUUID(effectiveBuildId)
        ? `${API_BASE}/proyectos/${currentProjectId}/metrics/?build_id=${effectiveBuildId}`
        : `${API_BASE}/proyectos/${currentProjectId}/metrics/`
      const response = await fetchWithAuth(url)
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      const data = await response.json()
      setProjectMetrics(data)
    } catch (error: any) {
      setProjectSyncMessage(`No se pudieron cargar métricas: ${error?.message || String(error)}`)
    } finally {
      if (!silent) setMetricsLoading(false)
    }
  }

  return {
    loadProjectMetrics
  }
}
