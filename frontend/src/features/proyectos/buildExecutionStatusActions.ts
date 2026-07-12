import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { API_BASE } from '../../app/constants'
import { formatDateTime } from '../../shared/utils/dateTime'
import { isValidUUID } from '../../app/validation'

type CreateBuildExecutionStatusActionsParams = {
  projectsSource: 'local' | 'backend'
  latestResultsRequestRef: MutableRefObject<Record<string, number>>
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  setLatestResultsLoadingByBuild: Dispatch<SetStateAction<Record<string, boolean>>>
  setLockedBuildCaseIds: Dispatch<SetStateAction<Record<string, string[]>>>
  setBuildCaseResultHistoryByBuild: Dispatch<SetStateAction<Record<string, Record<string, any[]>>>>
  setCasosList: Dispatch<SetStateAction<any[]>>
  setSelectedTest: Dispatch<SetStateAction<any>>
  setProjectSyncMessage: (message: string) => void
}

export function createBuildExecutionStatusActions({
  projectsSource,
  latestResultsRequestRef,
  fetchWithAuth,
  setLatestResultsLoadingByBuild,
  setLockedBuildCaseIds,
  setBuildCaseResultHistoryByBuild,
  setCasosList,
  setSelectedTest,
  setProjectSyncMessage
}: CreateBuildExecutionStatusActionsParams) {
  const loadBuildCaseExecutionStatus = async (buildId: string, caseIds: string[], options?: { silent?: boolean }) => {
    if (!buildId || !isValidUUID(buildId) || projectsSource !== 'backend') return
    const silent = Boolean(options?.silent)
    const requestId = (latestResultsRequestRef.current[buildId] || 0) + 1
    latestResultsRequestRef.current[buildId] = requestId
    if (!silent) setLatestResultsLoadingByBuild(prev => ({ ...prev, [buildId]: true }))
    if (caseIds.length === 0) {
      setLockedBuildCaseIds(prev => ({ ...prev, [buildId]: [] }))
      setBuildCaseResultHistoryByBuild(prev => ({ ...prev, [buildId]: {} }))
      if (!silent) setLatestResultsLoadingByBuild(prev => ({ ...prev, [buildId]: false }))
      return
    }
    try {
      const response = await fetchWithAuth(`${API_BASE}/builds/${buildId}/casos/ultimos-resultados/`)
      if (latestResultsRequestRef.current[buildId] !== requestId) return
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      const rows = await response.json()
      const caseIdSet = new Set(caseIds)
      const finalStatuses = new Set(['PASO', 'FALLO', 'BLOQUEADO'])
      const lockedIds = rows
        .filter((item: any) => caseIdSet.has(item.caso_id) && finalStatuses.has(item.estado))
        .map((item: any) => item.caso_id)
      setLockedBuildCaseIds(prev => ({ ...prev, [buildId]: lockedIds }))
      const latestByCase = new Map(rows.map((item: any) => {
        const history = []
        if (item.estado) {
          history.push({
            date: item.fecha ? formatDateTime(item.fecha) : '',
            status: item.estado,
            executedBy: item.ejecutado_por_nombre || item.ejecutado_por || '',
            duration: item.duracion_segundos ? `${Math.floor(item.duracion_segundos / 60)}m ${item.duracion_segundos % 60}s` : '',
            failedStep: item.paso_fallido || null,
            evidenceUrl: null,
            observation: item.observaciones || null,
            versionExecuted: item.version_ejecutada || null,
            testRunId: item.test_run_id || null,
            executionId: item.ejecucion_id || item.execution_id || null,
            snapshotId: item.snapshot_id || null,
            buildId: item.build_id || buildId || null,
            buildName: item.build_nombre || null,
            buildCode: item.build_codigo || null,
            componentId: item.componente_id || null,
            componentName: item.componente_nombre || null,
            environmentId: item.entorno_id || null,
            environmentName: item.entorno_nombre || null,
            datasetId: item.dataset_id || null,
            datasetName: item.dataset_nombre || null,
            testData: item.datos_prueba || null,
            expected: item.resultado_esperado || null,
          })
        }
        if (item.estado_anterior) {
          history.push({
            date: item.fecha_anterior ? formatDateTime(item.fecha_anterior) : '',
            status: item.estado_anterior,
            executedBy: item.ejecutado_por_nombre_anterior || item.ejecutado_por_anterior || '',
            duration: item.duracion_segundos_anterior ? `${Math.floor(item.duracion_segundos_anterior / 60)}m ${item.duracion_segundos_anterior % 60}s` : '',
            failedStep: item.paso_fallido_anterior || null,
            evidenceUrl: null,
            observation: item.observaciones_anterior || null,
            versionExecuted: item.version_ejecutada_anterior || null,
            testRunId: item.test_run_id_anterior || null,
            executionId: item.ejecucion_id_anterior || null,
            snapshotId: item.snapshot_id_anterior || null,
            buildId: item.build_id || buildId || null,
            buildName: item.build_nombre || null,
            buildCode: item.build_codigo || null,
            componentId: item.componente_id || null,
            componentName: item.componente_nombre || null,
            environmentId: item.entorno_id || null,
            environmentName: item.entorno_nombre || null,
            datasetId: item.dataset_id || null,
            datasetName: item.dataset_nombre || null,
          })
        }
        return [item.caso_id, history] as const
      }))
      const resultHistoryByCase = Object.fromEntries(
        caseIds.map(caseId => [caseId, (latestByCase.get(caseId) || []) as any[]])
      )
      setBuildCaseResultHistoryByBuild(prev => ({ ...prev, [buildId]: resultHistoryByCase }))
      setCasosList(prev => prev.map(test => {
        if (!caseIdSet.has(test.id)) return test
        const summaryHistory = (latestByCase.get(test.id) || []) as any[]
        const history = Array.isArray(test.history) && test.history.length > summaryHistory.length
          ? test.history
          : summaryHistory
        const latest = summaryHistory[0] || history[0]
        return {
          ...test,
          lastResult: latest?.status || null,
          lastExecutedAt: latest?.date || null,
          lastExecutedBy: latest?.executedBy || null,
          lastExecutedVersion: latest?.versionExecuted || null,
          history
        }
      }))
      setSelectedTest(prev => {
        if (!prev || !caseIdSet.has(prev.id)) return prev
        const summaryHistory = (latestByCase.get(prev.id) || []) as any[]
        const detailedHistory = Array.isArray(prev.history) && prev.history.length > summaryHistory.length
          ? prev.history
          : summaryHistory
        const latest = summaryHistory[0] || detailedHistory[0]
        return {
          ...prev,
          lastResult: latest?.status || null,
          lastExecutedAt: latest?.date || null,
          lastExecutedBy: latest?.executedBy || null,
          lastExecutedVersion: latest?.versionExecuted || null,
          history: detailedHistory
        }
      })
    } catch (error: any) {
      setProjectSyncMessage(`No se pudo cargar historial de la build: ${error.message}`)
    } finally {
      if (!silent && latestResultsRequestRef.current[buildId] === requestId) {
        setLatestResultsLoadingByBuild(prev => ({ ...prev, [buildId]: false }))
      }
    }
  }

  return {
    loadBuildCaseExecutionStatus
  }
}
