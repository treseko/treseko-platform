import type { Dispatch, SetStateAction } from 'react'
import { API_BASE } from '../../app/constants'
import { formatDateTime } from '../../shared/utils/dateTime'
import { isValidUUID } from '../../app/validation'
import { mergeCasesById } from './caseUtils'

type FeedbackVariant = 'success' | 'danger' | 'warning' | 'info'
type ConfirmAction = (options: { title: string; message: string; variant?: 'danger' | 'warning' | 'info'; confirmLabel?: string; cancelLabel?: string | null }) => Promise<boolean>

const CASES_PAGE_SIZE = 200

type LoadCasesOptions = {
  preserveExecutionState?: boolean
  buildId?: string
  silent?: boolean
}

type CreateCaseActionsParams = {
  projectsSource: 'local' | 'backend'
  managingProjectId: string | null
  currentProjectId: string
  currentBuildId: string
  componentsList: any[]
  casosPage: number
  casosPageSize: number
  casosSearchQuery: string
  casosFilterSuite: string | null
  casosFilterPrioridad: string | null
  casosFilterCriticidad: string | null
  casosFilterEstado: string | null
  casosFilterEtiqueta: string
  selectedTest: any
  buildCaseResultHistoryByBuild: Record<string, Record<string, any[]>>
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  mapBackendCasoToTest: (caso: any, componentsSnapshot?: any[]) => any
  setCasosLoading: (loading: boolean) => void
  setCasosList: Dispatch<SetStateAction<any[]>>
  setCasosSearchResults: Dispatch<SetStateAction<any[] | null>>
  setCasosTotal: (total: number) => void
  setShowCasoModal: (show: boolean) => void
  setProjectSyncMessage: (message: string) => void
  setCaseVersions: Dispatch<SetStateAction<any[]>>
  setVersionsCase: Dispatch<SetStateAction<any | null>>
  setSelectedCompareVersionId: Dispatch<SetStateAction<string | null>>
  setShowVersionsModal: (show: boolean) => void
  showFeedback: (title: string, message: string, variant?: FeedbackVariant) => void
  confirmAction: ConfirmAction
}

export function createCaseActions({
  projectsSource,
  managingProjectId,
  currentProjectId,
  currentBuildId,
  componentsList,
  casosPage,
  casosPageSize,
  casosSearchQuery,
  casosFilterSuite,
  casosFilterPrioridad,
  casosFilterCriticidad,
  casosFilterEstado,
  casosFilterEtiqueta,
  selectedTest,
  buildCaseResultHistoryByBuild,
  fetchWithAuth,
  mapBackendCasoToTest,
  setCasosLoading,
  setCasosList,
  setCasosSearchResults,
  setCasosTotal,
  setShowCasoModal,
  setProjectSyncMessage,
  setCaseVersions,
  setVersionsCase,
  setSelectedCompareVersionId,
  setShowVersionsModal,
  showFeedback,
  confirmAction
}: CreateCaseActionsParams) {
  const fetchCasePages = async (path: string, baseParams: URLSearchParams) => {
    let skip = 0
    let items: any[] = []
    while (true) {
      const params = new URLSearchParams(baseParams)
      params.set('skip', String(skip))
      params.set('limit', String(CASES_PAGE_SIZE))
      const response = await fetchWithAuth(`${API_BASE}${path}?${params}`)
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      const payload = await response.json()
      const page = Array.isArray(payload) ? payload : (payload.items || [])
      items = [...items, ...page]
      if (page.length < CASES_PAGE_SIZE) {
        return Array.isArray(payload) ? items : { ...payload, items, total: payload.total ?? items.length }
      }
      skip += CASES_PAGE_SIZE
    }
  }

  const loadCasosFromBackend = async (
    projectId: string,
    componentsSnapshot = componentsList,
    options: LoadCasesOptions = {}
  ) => {
    if (!projectId || !isValidUUID(projectId) || projectsSource !== 'backend') return
    const silent = Boolean(options.silent)
    if (!silent) setCasosLoading(true)
    try {
      const params = new URLSearchParams({ include_archived: 'true' })
      const casos = await fetchCasePages(`/proyectos/${projectId}/casos/`, params) as any[]
      const resultBuildId = options.buildId || currentBuildId
      const cachedResultHistory = resultBuildId ? buildCaseResultHistoryByBuild[resultBuildId] || {} : {}
      const applyCachedBuildResult = (test: any) => {
        if (!resultBuildId || !Object.prototype.hasOwnProperty.call(cachedResultHistory, test.id)) return test
        const history = cachedResultHistory[test.id] || []
        const latest = history[0]
        return {
          ...test,
          lastResult: latest?.status || null,
          lastExecutedAt: latest?.date || null,
          lastExecutedBy: latest?.executedBy || null,
          lastExecutedVersion: latest?.versionExecuted || null,
          history
        }
      }
      const mapped = casos.map((caso: any) => applyCachedBuildResult(mapBackendCasoToTest(caso, componentsSnapshot)))
      if (options.preserveExecutionState) {
        setCasosList(prev => {
          const previousById = new Map(prev.map(test => [test.id, test]))
          const hydratedMapped = mapped.map((test: any) => {
            const previous = previousById.get(test.id)
            if (!previous) return test
            return {
              ...test,
              lastResult: previous.lastResult ?? test.lastResult,
              lastExecutedAt: previous.lastExecutedAt ?? test.lastExecutedAt,
              lastExecutedBy: previous.lastExecutedBy ?? test.lastExecutedBy,
              lastExecutedVersion: previous.lastExecutedVersion ?? test.lastExecutedVersion,
              history: Array.isArray(previous.history) && previous.history.length > 0 ? previous.history : test.history
            }
          })
          const historicalBuildCases = prev.filter(test =>
            test.projectId === projectId &&
            test.isHistoricalBuildVersion &&
            !hydratedMapped.some((latest: any) => latest.id === test.id)
          )
          return mergeCasesById(hydratedMapped, historicalBuildCases)
        })
      } else {
        setCasosList(prev => {
          const historicalBuildCases = prev.filter(test =>
            test.projectId === projectId &&
            test.isHistoricalBuildVersion &&
            !mapped.some((latest: any) => latest.id === test.id)
          )
          return mergeCasesById(mapped, historicalBuildCases)
        })
      }
    } catch (error: any) {
      setProjectSyncMessage(`Error al cargar casos: ${error.message}`)
    } finally {
      if (!silent) setCasosLoading(false)
    }
  }

  const searchCasos = async () => {
    const projectId = managingProjectId || currentProjectId
    if (!projectId || !isValidUUID(projectId)) return
    const params = new URLSearchParams()
    if (casosSearchQuery) params.set('q', casosSearchQuery)
    if (casosFilterSuite) params.set('suite_id', casosFilterSuite)
    if (casosFilterPrioridad) params.set('prioridad', casosFilterPrioridad)
    if (casosFilterCriticidad) params.set('criticidad', casosFilterCriticidad)
    if (casosFilterEstado) params.set('estado', casosFilterEstado)
    if (!casosFilterEstado) params.set('include_archived', 'true')
    if (casosFilterEtiqueta.trim()) params.set('tag', casosFilterEtiqueta.trim())

    try {
      const data = await fetchCasePages(`/proyectos/${projectId}/casos/search`, params) as any
      setCasosSearchResults(data.items)
      setCasosTotal(data.total)
    } catch (error: any) {
      setProjectSyncMessage(`Error al buscar casos: ${error.message}`)
    }
  }

  const handleCreateCaso = async (casoData: any) => {
    const projectId = managingProjectId || currentProjectId
    if (!projectId || !isValidUUID(projectId)) {
      showFeedback('Proyecto no válido', 'Selecciona un proyecto válido antes de continuar.', 'warning')
      return
    }
    try {
      const response = await fetchWithAuth(`${API_BASE}/casos/`, {
        method: 'POST',
        body: JSON.stringify({
          ...casoData,
          proyecto_id: projectId
        })
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      const createdCaso = await response.json()
      await loadCasosFromBackend(projectId)
      setShowCasoModal(false)
      setProjectSyncMessage('Caso creado correctamente.')
      return createdCaso
    } catch (error: any) {
      setProjectSyncMessage(`Error al crear caso: ${error.message}`)
      showFeedback('Error al crear caso', error.message || 'No se pudo crear el caso de prueba.', 'danger')
      return false
    }
  }

  const handleUpdateCaso = async (masterId: string, casoData: any) => {
    const projectId = managingProjectId || currentProjectId
    if (!projectId || !isValidUUID(projectId)) return
    try {
      const response = await fetchWithAuth(`${API_BASE}/casos/${masterId}`, {
        method: 'PUT',
        body: JSON.stringify(casoData)
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      const updatedCaso = await response.json()
      await loadCasosFromBackend(projectId)
      setShowCasoModal(false)
      const previousVersion = selectedTest?.version || updatedCaso.version
      setProjectSyncMessage(updatedCaso.version > previousVersion ? 'Caso ejecutado: se creó una nueva versión.' : 'Caso en borrador actualizado correctamente.')
      return updatedCaso
    } catch (error: any) {
      setProjectSyncMessage(`Error al actualizar caso: ${error.message}`)
      showFeedback('Error al guardar cambios', error.message || 'No se pudieron guardar los cambios del caso.', 'danger')
      return false
    }
  }

  const handleDeleteCaso = async (casoId: string) => {
    const confirmed = await confirmAction({
      title: 'Eliminar caso de prueba',
      message: 'Se eliminará este caso de prueba. Esta acción no se puede deshacer.',
      variant: 'danger',
      confirmLabel: 'Eliminar caso'
    })
    if (!confirmed) return
    const projectId = managingProjectId || currentProjectId
    if (!projectId || !isValidUUID(projectId)) return
    try {
      const response = await fetchWithAuth(`${API_BASE}/casos/${casoId}`, {
        method: 'DELETE'
      })
      if (!response.ok) {
        const error = await response.json()
        showFeedback('No se pudo eliminar el caso', error.detail || 'No se pudo eliminar el caso.', 'danger')
        return
      }
      await loadCasosFromBackend(projectId)
      setProjectSyncMessage('Caso eliminado correctamente.')
    } catch (error: any) {
      setProjectSyncMessage(`Error al eliminar caso: ${error.message}`)
    }
  }

  const handleCloneCaso = async (casoId: string, suiteId?: string) => {
    const projectId = managingProjectId || currentProjectId
    if (!projectId || !isValidUUID(projectId)) return
    try {
      const params = suiteId && isValidUUID(suiteId) ? `?suite_id=${suiteId}` : ''
      const response = await fetchWithAuth(`${API_BASE}/casos/${casoId}/clone${params}`, {
        method: 'POST'
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      const clonedCaso = await response.json()
      await loadCasosFromBackend(projectId)
      setProjectSyncMessage('Caso copiado como nueva prueba correctamente.')
      showFeedback('Prueba copiada', 'Se creo una nueva prueba independiente. Asignala a una build para ejecutarla.', 'success')
      return clonedCaso
    } catch (error: any) {
      setProjectSyncMessage(`Error al copiar caso: ${error.message}`)
      showFeedback('Error al copiar caso', error.message || 'No se pudo copiar el caso.', 'danger')
      return false
    }
  }

  const handleMoveCaso = async (casoId: string, suiteId: string) => {
    const projectId = managingProjectId || currentProjectId
    if (!projectId || !isValidUUID(projectId) || !isValidUUID(suiteId)) return false
    try {
      const response = await fetchWithAuth(`${API_BASE}/casos/${casoId}/move`, {
        method: 'PATCH',
        body: JSON.stringify({ suite_id: suiteId })
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondio ${response.status}`)
      }
      const movedCaso = await response.json()
      await loadCasosFromBackend(projectId)
      setProjectSyncMessage('Caso movido correctamente.')
      showFeedback('Prueba movida', 'La prueba fue movida a la suite seleccionada.', 'success')
      return movedCaso
    } catch (error: any) {
      setProjectSyncMessage(`Error al mover caso: ${error.message}`)
      showFeedback('Error al mover prueba', error.message || 'No se pudo mover la prueba.', 'danger')
      return false
    }
  }

  const loadCasoVersions = async (masterId: string, test?: any) => {
    try {
      const response = await fetchWithAuth(`${API_BASE}/casos/${masterId}/versions`)
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      const versions = await response.json()
      setCaseVersions(versions)
      setVersionsCase(test || null)
      setSelectedCompareVersionId(versions[1]?.id || versions[0]?.id || null)
      setShowVersionsModal(true)
    } catch (error: any) {
      setProjectSyncMessage(`Error al cargar versiones: ${error.message}`)
    }
  }

  const loadCasoExecutionHistory = async (casoId: string, buildId = currentBuildId, limit = 10) => {
    try {
      const params = new URLSearchParams({ limit: String(limit) })
      if (buildId && isValidUUID(buildId)) params.set('build_id', buildId)
      const response = await fetchWithAuth(`${API_BASE}/casos/${casoId}/historial?${params.toString()}`)
      if (!response.ok) {
        throw new Error(`Backend respondió ${response.status}`)
      }
      const historial = await response.json()
      return historial.map((item: any) => ({
        date: item.fecha ? formatDateTime(item.fecha) : '',
        status: item.estado,
        executedBy: item.ejecutado_por_nombre || item.ejecutado_por || '',
        duration: item.duracion_segundos ? `${Math.floor(item.duracion_segundos / 60)}m ${item.duracion_segundos % 60}s` : '',
        failedStep: item.paso_fallido || null,
        evidenceUrl: item.evidencia_url || null,
        evidencias: Array.isArray(item.evidencias) ? item.evidencias : [],
        observation: item.observaciones || null,
        versionExecuted: item.version_ejecutada || null,
        testRunId: item.test_run_id || null,
        executionId: item.id || item.execution_id || null,
        snapshotId: item.snapshot_id || null,
        buildId: item.build_id || null,
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
        action: item.accion || null,
        executionMode: item.execution_mode || null,
        aiReviewStatus: item.ai_review_status || null,
        aiHumanReviewRequired: Boolean(item.ai_human_review_required),
      }))
    } catch {
      return []
    }
  }

  return {
    loadCasosFromBackend,
    searchCasos,
    handleCreateCaso,
    handleUpdateCaso,
    handleDeleteCaso,
    handleCloneCaso,
    handleMoveCaso,
    loadCasoVersions,
    loadCasoExecutionHistory
  }
}
