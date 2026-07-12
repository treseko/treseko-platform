import { useEffect } from 'react'

type UseReportesPreloadParams = {
  activeTab: string
  currentProjectId: string
  currentBuildId: string
  projectsSource: 'local' | 'backend'
  setProjectMetrics: (metrics: any) => void
  loadProjectMetrics: (buildId?: string, options?: { silent?: boolean }) => void
}

export function useReportesPreload({
  activeTab,
  currentProjectId,
  currentBuildId,
  projectsSource,
  setProjectMetrics,
  loadProjectMetrics,
}: UseReportesPreloadParams) {
  useEffect(() => {
    if (activeTab !== 'reportes') return
    setProjectMetrics(null)
    loadProjectMetrics()
  }, [activeTab, currentProjectId, currentBuildId, projectsSource])
}
