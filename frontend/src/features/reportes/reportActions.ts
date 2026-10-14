import type { Dispatch, SetStateAction } from 'react'
import { API_BASE } from '../../app/constants'
import { isValidUUID } from '../../app/validation'
import type { TranslationKey } from '../../i18n'

export type MetricsRequestState = { context: string; sequence: number; active: boolean }
export const metricsContextKey = (project: string, build: string, source: string) => `${source}:${project}:${build}`

type CreateReportActionsParams = {
  currentProjectId: string
  currentBuildId: string
  projectsSource: 'local' | 'backend'
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  setProjectMetrics: Dispatch<SetStateAction<any>>
  setMetricsLoading: (loading: boolean) => void
  setMetricsError: (error: string) => void
  requestRef: { current: MetricsRequestState }
  setProjectSyncMessage: (message: string) => void
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
}

export function createReportActions({
  currentProjectId,
  currentBuildId,
  projectsSource,
  fetchWithAuth,
  setProjectMetrics,
  setMetricsLoading,
  setMetricsError,
  requestRef,
  setProjectSyncMessage,
  t
}: CreateReportActionsParams) {
  const loadProjectMetrics = async (buildId?: string, options?: { silent?: boolean }) => {
    const context = metricsContextKey(currentProjectId, currentBuildId, projectsSource)
    if (!requestRef.current.active || requestRef.current.context !== context) return
    const sequence = ++requestRef.current.sequence
    const isCurrent = () => requestRef.current.active && requestRef.current.context === context && requestRef.current.sequence === sequence
    if (!currentProjectId || !isValidUUID(currentProjectId) || projectsSource !== 'backend') {
      setProjectMetrics(null)
      setMetricsError('')
      setMetricsLoading(false)
      return
    }
    const silent = Boolean(options?.silent)
    setMetricsLoading(!silent)
    setMetricsError('')
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
      if (isCurrent()) setProjectMetrics(data)
    } catch (error: any) {
      if (!isCurrent()) return
      const message = `${t('reportes.metricsLoadError')}: ${error?.message || String(error)}`
      setMetricsError(message)
      setProjectSyncMessage(message)
    } finally {
      if (isCurrent()) setMetricsLoading(false)
    }
  }

  return {
    loadProjectMetrics
  }
}
