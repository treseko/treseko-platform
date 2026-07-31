import { useCallback, useMemo } from 'react'
import { useLiveRefresh } from '../shared/hooks/useLiveRefresh'
import { useProjectRealtime } from '../shared/realtime/useProjectRealtime'
import type { RealtimeEvent } from '../shared/realtime/realtimeTypes'
import { isValidUUID } from './validation'

export function useAppRealtime(options: any) {
  const {
    isAuthenticated, projectsSource, currentProjectId, currentBuildId, currentCompId, activeTab,
    projectInnerTab, runHistory, hasUnsavedCaseChanges, historialInitialFilters,
    environmentActions, loadOpenBugsByCase, loadProjectRunHistory, refreshCurrentTestContext,
    refreshExecutionLiveData, refreshProjectBuildLiveData, refreshReportesLiveData,
    setProjectSyncMessage, setTraceabilityRefreshToken, setBugTrackerRefreshToken,
  } = options

  const handleRealtimeEvent = useCallback((event: RealtimeEvent) => {
    const eventType = event.event_type || ''
    const affectsCurrentBuild = !event.build_id || !currentBuildId || event.build_id === currentBuildId
    const refreshAuthoringData = () => {
      if (hasUnsavedCaseChanges) {
        setProjectSyncMessage('Hay cambios nuevos disponibles. Actualiza la vista cuando termines de editar.')
        return
      }
      void refreshCurrentTestContext(currentCompId)
    }
    if (eventType.startsWith('traceability.')) {
      setTraceabilityRefreshToken((value: number) => value + 1)
      return
    }
    if (eventType.startsWith('execution.') || eventType.startsWith('ia.') || eventType.startsWith('automation.') || eventType.startsWith('worker.')) {
      if (activeTab === 'ejecutar' && affectsCurrentBuild) void refreshExecutionLiveData()
      if (activeTab === 'historial' || activeTab === 'motor_ia') void loadProjectRunHistory(historialInitialFilters)
      if (activeTab === 'reportes') void refreshReportesLiveData()
      return
    }
    if (eventType.startsWith('bug.')) {
      setBugTrackerRefreshToken((value: number) => value + 1)
      if (activeTab === 'ejecutar' && affectsCurrentBuild) void loadOpenBugsByCase({ silent: true })
      if (activeTab === 'reportes') void refreshReportesLiveData()
      if (activeTab === 'proyectos') void refreshProjectBuildLiveData()
      return
    }
    if (eventType.startsWith('build.') || eventType.startsWith('component.') || eventType.startsWith('project.')) {
      if (activeTab === 'ejecutar' && affectsCurrentBuild) void refreshExecutionLiveData()
      if (activeTab === 'proyectos') void refreshProjectBuildLiveData()
      if (activeTab === 'reportes') void refreshReportesLiveData()
      if (activeTab === 'crear_pruebas') refreshAuthoringData()
      return
    }
    if (eventType.startsWith('case.') || eventType.startsWith('suite.')) {
      if (activeTab === 'crear_pruebas') refreshAuthoringData()
      if (activeTab === 'ejecutar' && affectsCurrentBuild) void refreshExecutionLiveData()
      if (activeTab === 'proyectos') void refreshProjectBuildLiveData()
      if (activeTab === 'reportes') void refreshReportesLiveData()
      return
    }
    if (eventType.startsWith('environment.') || eventType.startsWith('dataset.')) {
      if (currentProjectId && isValidUUID(currentProjectId)) void environmentActions.loadEnvironmentsForProject(currentProjectId)
      if (activeTab === 'ejecutar' && affectsCurrentBuild) void refreshExecutionLiveData()
      if (activeTab === 'historial') void loadProjectRunHistory(historialInitialFilters)
      if (activeTab === 'reportes') void refreshReportesLiveData()
      return
    }
    if (eventType.startsWith('report.') && activeTab === 'reportes') void refreshReportesLiveData()
  }, [activeTab, currentBuildId, currentCompId, currentProjectId, environmentActions, hasUnsavedCaseChanges, historialInitialFilters, loadOpenBugsByCase, loadProjectRunHistory, refreshCurrentTestContext, refreshExecutionLiveData, refreshProjectBuildLiveData, refreshReportesLiveData, setProjectSyncMessage, setTraceabilityRefreshToken, setBugTrackerRefreshToken])

  const realtimeEnabled = isAuthenticated && projectsSource === 'backend' && !!currentProjectId && isValidUUID(currentProjectId)
  const { status: realtimeStatus } = useProjectRealtime({ enabled: realtimeEnabled, projectId: currentProjectId, onEvent: handleRealtimeEvent })
  const livePollingFallbackActive = !realtimeEnabled || realtimeStatus !== 'connected'
  const hasActiveRunHistory = useMemo(() => runHistory.some((run: any) => ['PENDING', 'EN_CURSO', 'RUNNING', 'EN_EJECUCION', 'IN_PROGRESS'].includes(String(run.status || run.estado_run || '').toUpperCase())), [runHistory])

  useLiveRefresh({ enabled: isAuthenticated && livePollingFallbackActive && activeTab === 'ejecutar', intervalMs: 12000, refreshOnFocus: true, onRefresh: refreshExecutionLiveData })
  useLiveRefresh({ enabled: isAuthenticated && livePollingFallbackActive && activeTab === 'bugs', intervalMs: 30000, refreshOnFocus: true, onRefresh: () => setBugTrackerRefreshToken((value: number) => value + 1) })
  useLiveRefresh({ enabled: isAuthenticated && livePollingFallbackActive && activeTab === 'reportes', intervalMs: 0, refreshOnFocus: false, onRefresh: refreshReportesLiveData })
  useLiveRefresh({ enabled: isAuthenticated && livePollingFallbackActive && activeTab === 'historial', intervalMs: hasActiveRunHistory ? 15000 : 0, refreshOnFocus: true, onRefresh: () => loadProjectRunHistory(historialInitialFilters) })
  useLiveRefresh({ enabled: isAuthenticated && livePollingFallbackActive && activeTab === 'proyectos' && projectInnerTab === 'components', intervalMs: 30000, refreshOnFocus: true, onRefresh: refreshProjectBuildLiveData })
  useLiveRefresh({ enabled: isAuthenticated && livePollingFallbackActive && activeTab === 'proyectos' && projectInnerTab === 'traceability', intervalMs: 15000, refreshOnFocus: true, onRefresh: () => setTraceabilityRefreshToken((value: number) => value + 1) })

  return { livePollingFallbackActive, realtimeEnabled, realtimeStatus }
}
