import { useState } from 'react'
import { useReportesPreload } from '../../../app/useReportesPreload'
import { createReportActions } from '../reportActions'
import { useI18n } from '../../../i18n'

export function useReportesMetrics({
  activeTab,
  currentProjectId,
  currentBuildId,
  projectsSource,
  fetchWithAuth,
  setProjectSyncMessage,
}: any) {
  const { t } = useI18n()
  const [projectMetrics, setProjectMetrics] = useState<any>(null)
  const [metricsLoading, setMetricsLoading] = useState(false)
  const [expandedMetricSuites, setExpandedMetricSuites] = useState<Set<string>>(new Set())

  const { loadProjectMetrics } = createReportActions({
    currentProjectId,
    currentBuildId,
    projectsSource,
    fetchWithAuth,
    setProjectMetrics,
    setMetricsLoading,
    setProjectSyncMessage,
    t,
  })

  useReportesPreload({
    activeTab,
    currentProjectId,
    currentBuildId,
    projectsSource,
    setProjectMetrics,
    loadProjectMetrics,
  })

  return {
    projectMetrics,
    setProjectMetrics,
    metricsLoading,
    expandedMetricSuites,
    setExpandedMetricSuites,
    loadProjectMetrics,
  }
}
