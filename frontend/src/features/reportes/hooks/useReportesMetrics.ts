import { useEffect, useRef, useState } from 'react'
import { useReportesPreload } from '../../../app/useReportesPreload'
import { createReportActions, metricsContextKey } from '../reportActions'
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
  const [metricsError, setMetricsError] = useState('')
  const context = metricsContextKey(currentProjectId, currentBuildId, projectsSource)
  const requestRef = useRef({ context, sequence: 0, active: true })
  if (requestRef.current.context !== context) {
    requestRef.current.context = context
    requestRef.current.sequence += 1
  }
  useEffect(() => {
    requestRef.current.active = true
    return () => { requestRef.current.active = false; requestRef.current.sequence += 1 }
  }, [])
  useEffect(() => {
    setProjectMetrics(null)
    setMetricsError('')
    setMetricsLoading(false)
  }, [context])
  const [expandedMetricSuites, setExpandedMetricSuites] = useState<Set<string>>(new Set())

  const { loadProjectMetrics } = createReportActions({
    currentProjectId,
    currentBuildId,
    projectsSource,
    fetchWithAuth,
    setProjectMetrics,
    setMetricsLoading,
    setMetricsError,
    requestRef,
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
    metricsError,
    expandedMetricSuites,
    setExpandedMetricSuites,
    loadProjectMetrics,
  }
}
