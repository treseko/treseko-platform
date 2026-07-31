import type { Dispatch, SetStateAction } from 'react'
import { API_BASE } from '../../app/constants'
import { isValidUUID } from '../../app/validation'
import { mergeCasesById } from '../casos/caseUtils'
import type { TranslationKey } from '../../i18n'
import { isBuildReadOnly } from '../../app/buildState'

type FeedbackVariant = 'success' | 'danger' | 'warning' | 'info'

type CreateBuildScopeActionsParams = {
  projectsSource: 'local' | 'backend'
  buildsList: any[]
  buildCaseIds: Record<string, string[]>
  editingBuildCasesId: string | null
  buildCaseDraftIds: string[]
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  mapBackendCasoToTest: (caso: any) => any
  loadBuildCaseExecutionStatus: (buildId: string, caseIds: string[], options?: { silent?: boolean }) => Promise<void>
  setBuildCasesLoadingByBuild: Dispatch<SetStateAction<Record<string, boolean>>>
  setCasosList: Dispatch<SetStateAction<any[]>>
  setBuildCaseIds: Dispatch<SetStateAction<Record<string, string[]>>>
  setEditingBuildCasesId: (buildId: string | null) => void
  setBuildCaseDraftIds: (ids: string[]) => void
  setBuildCaseSearch: (query: string) => void
  setShowBuildCasesModal: (show: boolean) => void
  setProjectSyncMessage: (message: string) => void
  showFeedback: (title: string, message: string, variant?: FeedbackVariant) => void
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
}

export function createBuildScopeActions({
  projectsSource,
  buildsList,
  buildCaseIds,
  editingBuildCasesId,
  buildCaseDraftIds,
  fetchWithAuth,
  mapBackendCasoToTest,
  loadBuildCaseExecutionStatus,
  setBuildCasesLoadingByBuild,
  setCasosList,
  setBuildCaseIds,
  setEditingBuildCasesId,
  setBuildCaseDraftIds,
  setBuildCaseSearch,
  setShowBuildCasesModal,
  setProjectSyncMessage,
  showFeedback,
  t
}: CreateBuildScopeActionsParams) {
  const isInactiveBuild = (buildId: string) => {
    const build = buildsList.find(item => item.id === buildId)
    return isBuildReadOnly(build)
  }

  const loadBuildCases = async (buildId: string, options?: { silent?: boolean }) => {
    if (!buildId || !isValidUUID(buildId) || projectsSource !== 'backend') return []
    const silent = Boolean(options?.silent)
    if (!silent) setBuildCasesLoadingByBuild(prev => ({ ...prev, [buildId]: true }))
    try {
      const response = await fetchWithAuth(`${API_BASE}/builds/${buildId}/casos/?skip=0&limit=200`)
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      let cases = await response.json()
      let lastPageSize = cases.length
      for (let skip = lastPageSize; lastPageSize === 200; skip += 200) {
        const pageResponse = await fetchWithAuth(`${API_BASE}/builds/${buildId}/casos/?skip=${skip}&limit=200`)
        if (!pageResponse.ok) {
          const error = await pageResponse.json().catch(() => null)
          throw new Error(error?.detail || `Backend respondió ${pageResponse.status}`)
        }
        const page = await pageResponse.json()
        lastPageSize = page.length
        cases = [...cases, ...page]
      }
      const ids = cases.map((item: any) => item.id)
      const mappedCases = cases.map((item: any) => mapBackendCasoToTest(item))
      setCasosList(prev => mergeCasesById(prev, mappedCases))
      setBuildCaseIds(prev => ({ ...prev, [buildId]: ids }))
      return ids
    } catch (error: any) {
      setProjectSyncMessage(`${t('proyectos.buildCasesLoadError')}: ${error.message}`)
      return []
    } finally {
      if (!silent) setBuildCasesLoadingByBuild(prev => ({ ...prev, [buildId]: false }))
    }
  }

  const openBuildCasesModal = async (buildId: string) => {
    const ids = buildCaseIds[buildId] || await loadBuildCases(buildId)
    await loadBuildCaseExecutionStatus(buildId, ids)
    setEditingBuildCasesId(buildId)
    setBuildCaseDraftIds(ids)
    setBuildCaseSearch('')
    setShowBuildCasesModal(true)
  }

  const saveBuildCases = async () => {
    if (!editingBuildCasesId) return
    if (isInactiveBuild(editingBuildCasesId)) {
      showFeedback(t('proyectos.buildUpdateError'), 'La build histórica está en modo consulta y no admite modificaciones.', 'warning')
      return
    }
    try {
      const response = await fetchWithAuth(`${API_BASE}/builds/${editingBuildCasesId}/casos/`, {
        method: 'PUT',
        body: JSON.stringify({ caso_ids: buildCaseDraftIds })
      })
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `Backend respondió ${response.status}`)
      }
      const cases = await response.json()
      const savedIds = cases.map((item: any) => item.id)
      const mappedCases = cases.map((item: any) => mapBackendCasoToTest(item))
      setCasosList(prev => mergeCasesById(prev, mappedCases))
      setBuildCaseIds(prev => ({ ...prev, [editingBuildCasesId]: savedIds }))
      await loadBuildCaseExecutionStatus(editingBuildCasesId, savedIds)
      setShowBuildCasesModal(false)
      setEditingBuildCasesId(null)
      showFeedback(t('proyectos.buildUpdated'), t('proyectos.buildCasesSaved'), 'success')
    } catch (error: any) {
      showFeedback(t('proyectos.saveError'), error.message || t('proyectos.buildCasesSaveError'), 'danger')
    }
  }

  const assignPreviousFailedCases = async (buildId = editingBuildCasesId) => {
    if (!buildId || !isValidUUID(buildId) || projectsSource !== 'backend') return
    try {
      const response = await fetchWithAuth(`${API_BASE}/builds/${buildId}/casos/fallos-previos/`)
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      const cases = await response.json()
      const mappedCases = cases.map((item: any) => mapBackendCasoToTest(item))
      const previousFailedIds = mappedCases.map((item: any) => item.id).filter(Boolean)
      if (mappedCases.length > 0) {
        setCasosList(prev => mergeCasesById(prev, mappedCases))
      }
      if (previousFailedIds.length === 0) {
        showFeedback(t('proyectos.noPreviousFailures'), t('proyectos.noPreviousFailuresMessage'), 'info')
        return
      }
      const nextIds = Array.from(new Set([...buildCaseDraftIds, ...previousFailedIds]))
      const addedCount = nextIds.length - buildCaseDraftIds.length
      setBuildCaseDraftIds(nextIds)
      showFeedback(
        t('proyectos.selectedCases'),
        addedCount > 0
          ? t('proyectos.previousFailuresAdded', { count: addedCount })
          : t('proyectos.previousFailuresAlreadySelected'),
        'success'
      )
    } catch (error: any) {
      showFeedback(t('proyectos.loadError'), error.message || t('proyectos.previousFailuresLoadError'), 'danger')
    }
  }

  return {
    loadBuildCases,
    openBuildCasesModal,
    saveBuildCases,
    assignPreviousFailedCases
  }
}
