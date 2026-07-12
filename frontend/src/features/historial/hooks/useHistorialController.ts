import { useEffect, useState } from 'react'
import { createHistorialActions } from '../historialActions'

type UseHistorialControllerParams = {
  activeTab: string
  currentProjectId: string
  currentBuildId: string
  projectsSource: 'local' | 'backend'
  initialRunHistory: any[]
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  setProjectSyncMessage: (message: string) => void
  showFeedback: (title: string, message: string, variant?: string) => void
  loadProjectMetrics: () => Promise<void> | void
  setActiveTab: (tab: string) => void
}

export function useHistorialController({
  activeTab,
  currentProjectId,
  currentBuildId,
  projectsSource,
  initialRunHistory,
  fetchWithAuth,
  setProjectSyncMessage,
  showFeedback,
  loadProjectMetrics,
  setActiveTab,
}: UseHistorialControllerParams) {
  const [runHistory, setRunHistory] = useState(initialRunHistory)
  const [historialInitialFilters, setHistorialInitialFilters] = useState<Record<string, any>>({})
  const [pendingHistorialRunDetailId, setPendingHistorialRunDetailId] = useState('')

  const {
    loadProjectRunHistory,
    loadTestRunDetail,
    markHistorialAiReviewed,
  } = createHistorialActions({
    currentProjectId,
    projectsSource,
    fetchWithAuth,
    setRunHistory,
    setProjectSyncMessage,
    showFeedback,
    loadProjectMetrics,
  })

  useEffect(() => {
    if (activeTab !== 'historial') return
    loadProjectRunHistory(historialInitialFilters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentProjectId, currentBuildId, projectsSource, JSON.stringify(historialInitialFilters)])

  const openHistorialRuns = (filters: Record<string, any> = {}, runId = '') => {
    setHistorialInitialFilters(filters)
    setPendingHistorialRunDetailId(runId)
    setActiveTab('historial')
  }

  return {
    runHistory,
    historialInitialFilters,
    pendingHistorialRunDetailId,
    setPendingHistorialRunDetailId,
    loadProjectRunHistory,
    loadTestRunDetail,
    markHistorialAiReviewed,
    openHistorialRuns,
  }
}
