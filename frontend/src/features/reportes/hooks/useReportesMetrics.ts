import { useState } from 'react'
import { useReportesPreload } from '../../../app/useReportesPreload'
import { createReportActions } from '../reportActions'

export function useReportesMetrics({
  activeTab,
  currentProjectId,
  currentBuildId,
  projectsSource,
  fetchWithAuth,
  setProjectSyncMessage,
}: any) {
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
