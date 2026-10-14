import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { API_BASE } from '../../app/constants'
import { isValidUUID } from '../../app/validation'
import type { TranslationKey } from '../../i18n'

type FeedbackVariant = 'success' | 'danger' | 'warning' | 'info'
type ConfirmAction = (options: { title: string; message: string; variant?: 'danger' | 'warning' | 'info'; confirmLabel?: string; cancelLabel?: string | null }) => Promise<boolean>

type CreateSuiteActionsParams = {
  contextHydrationVersionRef?: { current: number }
  suitesLoadVersionRef?: { current: number }
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
  projectsSource: 'local' | 'backend'
  currentCompId: string
  managingProjectId: string | null
  currentProjectId: string
  componentsList: any[]
  suiteForm: any
  editingSuiteId: string | null
  movingSuiteId: string | null
  moveSuiteParentId: string
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  reloadCasosAfterSuiteClone?: (projectId: string, componentsSnapshot?: any[]) => Promise<void> | void
  setSuitesLoading: (loading: boolean) => void
  setSuitesTree: Dispatch<SetStateAction<any[]>>
  setProjectSyncMessage: (message: string) => void
  setShowSuiteModal: (show: boolean) => void
  setSuiteForm: Dispatch<SetStateAction<any>>
  setEditingSuiteId: (id: string | null) => void
  setShowMoveSuiteModal: (show: boolean) => void
  setMovingSuiteId: (id: string | null) => void
  setMoveSuiteParentId: (id: string) => void
  setSelectedSuiteId: (id: string) => void
  setSelectedSubSuiteId: (id: string | null) => void
  setExpandedSuites: Dispatch<SetStateAction<Record<string, boolean>>>
  setNewTestSuite: (id: string) => void
  setNewTestSuiteSub: (id: string) => void
  showFeedback: (title: string, message: string, variant?: FeedbackVariant) => void
  confirmAction: ConfirmAction
  readOnlyBuild?: boolean
}

const errorDetail = (error: any, fallback: string) => {
  if (typeof error?.detail === 'string') return error.detail
  if (Array.isArray(error?.detail)) return error.detail.map((item: any) => `${(item.loc || []).slice(1).join('.')}: ${item.msg}`).join(' · ')
  return fallback
}

const emptySuiteForm = { nombre: '', descripcion: '', parentId: '', color: '#F1F5F9', icono: 'folder' }
const pendingWrites = new Set<string>()
const requestIds = new Map<string, string>()
const reserveRequest = (action: string, payload: any) => {
  const key = JSON.stringify([action, payload])
  if (pendingWrites.has(key)) return null
  const requestId = requestIds.get(key) || crypto.randomUUID()
  requestIds.set(key, requestId)
  pendingWrites.add(key)
  return { key, requestId }
}

export function createSuiteActions({
  contextHydrationVersionRef = { current: 0 },
  suitesLoadVersionRef = { current: 0 },
  t,
  projectsSource,
  currentCompId,
  managingProjectId,
  currentProjectId,
  componentsList,
  suiteForm,
  editingSuiteId,
  movingSuiteId,
  moveSuiteParentId,
  fetchWithAuth,
  reloadCasosAfterSuiteClone,
  setSuitesLoading,
  setSuitesTree,
  setProjectSyncMessage,
  setShowSuiteModal,
  setSuiteForm,
  setEditingSuiteId,
  setShowMoveSuiteModal,
  setMovingSuiteId,
  setMoveSuiteParentId,
  setSelectedSuiteId,
  setSelectedSubSuiteId,
  setExpandedSuites,
  setNewTestSuite,
  setNewTestSuiteSub,
  showFeedback,
  confirmAction,
  readOnlyBuild = false
}: CreateSuiteActionsParams) {
  const mutationContextVersion = contextHydrationVersionRef.current
  const isCurrentContext = () => mutationContextVersion === contextHydrationVersionRef.current
  const rejectReadOnlyWrite = () => {
    if (!isCurrentContext()) return false
    if (!readOnlyBuild) return false
    showFeedback(t('casos.updateSuiteError'), 'La build histórica está en modo consulta y no admite modificaciones.', 'warning')
    return true
  }
  const loadSuitesFromBackend = async (projectId: string, componentId = currentCompId, options?: { silent?: boolean }) => {
    if (!projectId || projectsSource !== 'backend') return
    const requestId = ++suitesLoadVersionRef.current
    const contextVersion = contextHydrationVersionRef.current
    const isCurrent = () => suitesLoadVersionRef.current === requestId && contextHydrationVersionRef.current === contextVersion
    const silent = Boolean(options?.silent)
    if (!silent) setSuitesLoading(true)
    try {
      const params = new URLSearchParams({ include_archived: 'true' })
      if (componentId && isValidUUID(componentId)) params.set('componente_id', componentId)
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${projectId}/suites/?${params}`)
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(errorDetail(error, t('casos.backendResponse', { status: response.status })))
      }
      const suites = await response.json()
      if (isCurrent()) setSuitesTree(suites)
    } catch (error: any) {
      if (isCurrent()) setProjectSyncMessage(`${t('casos.loadSuitesError')}: ${error.message}`)
    } finally {
      if (!silent && isCurrent()) setSuitesLoading(false)
    }
  }

  const handleCreateSuite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (rejectReadOnlyWrite()) return false
    const projectId = managingProjectId || currentProjectId
    const formData = new FormData(event.currentTarget)
    const submittedName = String(formData.get('nombre') || formData.get('folderName') || suiteForm.nombre || '').trim()
    const submittedDescription = String(formData.get('descripcion') || suiteForm.descripcion || '')
    const submittedParentId = String(formData.get('parentId') || suiteForm.parentId || '')
    const submittedColor = String(formData.get('color') || suiteForm.color || '#F1F5F9')
    const submittedIcon = String(formData.get('icono') || suiteForm.icono || 'folder')

    if (!isValidUUID(projectId)) {
      showFeedback(t('casos.invalidProject'), t('casos.selectBackendProject'), 'warning')
      return false
    }

    if (!submittedName) {
      showFeedback(t('casos.nameRequired'), t('casos.enterSuiteName'), 'warning')
      return false
    }

    let requestKey: string | undefined
    try {
      const componentBelongsToProject = componentsList.some(component =>
        component.id === currentCompId && component.projectId === projectId
      )
      const componentId = isValidUUID(currentCompId) && componentBelongsToProject ? currentCompId : null
      const body = { proyecto_id: projectId, componente_id: componentId, nombre: submittedName,
        descripcion: submittedDescription, parent_id: submittedParentId || null, color: submittedColor, icono: submittedIcon }
      const reserved = reserveRequest('create', body)
      if (!reserved) return false
      requestKey = reserved.key
      const response = await fetchWithAuth(`${API_BASE}/suites/`, {
        method: 'POST',
        body: JSON.stringify({ ...body, request_id: reserved.requestId })
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(errorDetail(error, t('casos.backendResponse', { status: response.status })))
      }
      const createdSuite = await response.json()
      requestIds.delete(requestKey)
      if (!isCurrentContext()) return false
      await loadSuitesFromBackend(projectId, componentId || '')
      if (!isCurrentContext()) return false
      const createdSuiteId = createdSuite?.id || createdSuite?.suite?.id || ''
      if (createdSuiteId) {
        setSelectedSuiteId(createdSuiteId)
        setSelectedSubSuiteId(createdSuiteId)
        setNewTestSuite(createdSuiteId)
        setNewTestSuiteSub(createdSuiteId)
        setExpandedSuites(prev => ({
          ...prev,
          ...(submittedParentId ? { [submittedParentId]: true } : {}),
          [createdSuiteId]: true
        }))
      }
      setShowSuiteModal(false)
      setSuiteForm(emptySuiteForm)
      setProjectSyncMessage(t('casos.suiteCreated'))
      showFeedback(t('casos.suiteCreatedTitle'), t('casos.folderCreated'), 'success')
      return true
    } catch (error: any) {
      if (!isCurrentContext()) return false
      setProjectSyncMessage(`${t('casos.createSuiteError')}: ${error.message}`)
      showFeedback(t('casos.createSuiteError'), error.message || t('casos.createSuiteFallback'), 'danger')
      return false
    } finally {
      if (requestKey) pendingWrites.delete(requestKey)
    }
  }

  const handleUpdateSuite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (rejectReadOnlyWrite()) return false
    if (!editingSuiteId) return
    const projectId = managingProjectId || currentProjectId
    if (!isValidUUID(projectId)) {
      showFeedback(t('casos.invalidProject'), t('casos.selectValidProject'), 'warning')
      return
    }

    try {
      const response = await fetchWithAuth(`${API_BASE}/suites/${editingSuiteId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          nombre: suiteForm.nombre,
          descripcion: suiteForm.descripcion,
          color: suiteForm.color,
          icono: suiteForm.icono || 'folder'
        })
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(errorDetail(error, t('casos.backendResponse', { status: response.status })))
      }
      if (!isCurrentContext()) return false
      await loadSuitesFromBackend(projectId, currentCompId)
      if (!isCurrentContext()) return false
      setShowSuiteModal(false)
      setEditingSuiteId(null)
      setSuiteForm(emptySuiteForm)
      setProjectSyncMessage(t('casos.suiteUpdated'))
      showFeedback(t('casos.suiteUpdatedTitle'), t('casos.folderUpdated'), 'success')
    } catch (error: any) {
      if (!isCurrentContext()) return false
      setProjectSyncMessage(`${t('casos.updateSuiteError')}: ${error.message}`)
      showFeedback(t('casos.updateSuiteError'), error.message || t('casos.updateSuiteFallback'), 'danger')
    }
  }

  const handleDeleteSuite = async (suiteId: string) => {
    if (rejectReadOnlyWrite()) return false
    const confirmed = await confirmAction({
      title: t('casos.deleteFolderTitle'),
      message: t('casos.deleteSuiteConfirm'),
      variant: 'danger',
      confirmLabel: t('casos.deleteFolder')
    })
    if (!confirmed) return
    const projectId = managingProjectId || currentProjectId
    if (!isValidUUID(projectId)) {
      showFeedback(t('casos.invalidProject'), t('casos.selectValidProject'), 'warning')
      return
    }

    try {
      const response = await fetchWithAuth(`${API_BASE}/suites/${suiteId}`, {
        method: 'DELETE'
      })
      if (!response.ok) {
        const error = await response.json()
        showFeedback(t('casos.deleteSuiteFailed'), error.detail || t('casos.deleteSuiteFailed'), 'danger')
        return
      }
      if (!isCurrentContext()) return false
      await loadSuitesFromBackend(projectId, currentCompId)
      if (!isCurrentContext()) return false
      setProjectSyncMessage(t('casos.suiteDeleted'))
    } catch (error: any) {
      if (!isCurrentContext()) return false
      setProjectSyncMessage(`Error al eliminar suite: ${error.message}`)
    }
  }

  const handleCloneSuite = async (suiteId: string) => {
    if (rejectReadOnlyWrite()) return false
    const projectId = managingProjectId || currentProjectId
    if (!isValidUUID(projectId)) {
      showFeedback(t('casos.invalidProject'), t('casos.selectValidProject'), 'warning')
      return
    }

    try {
      const response = await fetchWithAuth(`${API_BASE}/suites/${suiteId}/clone`, {
        method: 'POST'
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      if (!isCurrentContext()) return false
      await loadSuitesFromBackend(projectId, currentCompId)
      if (!isCurrentContext()) return false
      setProjectSyncMessage(t('casos.suiteCloned'))
    } catch (error: any) {
      if (!isCurrentContext()) return false
      setProjectSyncMessage(`Error al clonar suite: ${error.message}`)
    }
  }

  const handleCloneSuiteComplete = async (suiteId: string, options: { nuevo_nombre?: string; parent_id?: string | null; include_cases?: boolean } = {}) => {
    if (rejectReadOnlyWrite()) return false
    const projectId = managingProjectId || currentProjectId
    if (!isValidUUID(projectId)) {
      showFeedback(t('casos.invalidProject'), t('casos.selectValidProject'), 'warning')
      return false
    }

    let requestKey: string | undefined
    try {
      const body = { nuevo_nombre: options.nuevo_nombre, parent_id: options.parent_id || null, include_cases: options.include_cases ?? true }
      const reserved = reserveRequest(`clone:${projectId}:${suiteId}`, body)
      if (!reserved) return false
      requestKey = reserved.key
      const response = await fetchWithAuth(`${API_BASE}/suites/${suiteId}/clone`, {
        method: 'POST',
        body: JSON.stringify({ ...body, request_id: reserved.requestId })
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondio ${response.status}`)
      }
      const cloneResult = await response.json()
      requestIds.delete(requestKey)
      if (!isCurrentContext()) return false
      const clonedSuite = cloneResult?.suite || cloneResult
      if (!isCurrentContext()) return false
      await loadSuitesFromBackend(projectId, currentCompId)
      if (!isCurrentContext()) return false
      let refreshFailed = false
      try { await reloadCasosAfterSuiteClone?.(projectId, componentsList) }
      catch { refreshFailed = true }
      if (!isCurrentContext()) return false
      const clonedSuiteId = clonedSuite?.id || ''
      if (clonedSuiteId) {
        setSelectedSuiteId(clonedSuiteId)
        setSelectedSubSuiteId(clonedSuiteId)
        setNewTestSuite(clonedSuiteId)
        setNewTestSuiteSub(clonedSuiteId)
        setExpandedSuites(prev => ({
          ...prev,
          ...(options.parent_id ? { [options.parent_id]: true } : {}),
          [clonedSuiteId]: true
        }))
      }
      const suitesCount = cloneResult?.suites_copiadas ?? 1
      const casesCount = cloneResult?.casos_copiados ?? 0
      setProjectSyncMessage(t(refreshFailed ? 'casos.suiteCopyRefreshFailed' : 'casos.suiteCopied'))
      showFeedback(t('casos.suiteCopied'), refreshFailed ? t('casos.suiteCopyRefreshFailed') : t('casos.suiteCopiedMessage', { suites: suitesCount, cases: casesCount }), refreshFailed ? 'warning' : 'success')
      return cloneResult
    } catch (error: any) {
      if (!isCurrentContext()) return false
      setProjectSyncMessage(`Error al copiar suite: ${error.message}`)
      showFeedback(t('casos.copySuiteError'), error.message || t('casos.copySuiteError'), 'danger')
      return false
    } finally {
      if (requestKey) pendingWrites.delete(requestKey)
    }
  }

  const handleMoveSuite = async () => {
    if (rejectReadOnlyWrite()) return false
    if (!movingSuiteId) return
    const projectId = managingProjectId || currentProjectId
    if (!isValidUUID(projectId)) {
      showFeedback(t('casos.invalidProject'), t('casos.selectValidProject'), 'warning')
      return
    }

    try {
      const response = await fetchWithAuth(`${API_BASE}/suites/${movingSuiteId}/move`, {
        method: 'PATCH',
        body: JSON.stringify({
          parent_id: moveSuiteParentId || null
        })
      })
      if (!response.ok) {
        const error = await response.json()
        showFeedback(t('casos.moveSuiteError'), error.detail || t('casos.moveSuiteError'), 'danger')
        return
      }
      if (!isCurrentContext()) return false
      await loadSuitesFromBackend(projectId, currentCompId)
      if (!isCurrentContext()) return false
      setShowMoveSuiteModal(false)
      setMovingSuiteId(null)
      setMoveSuiteParentId('')
      setProjectSyncMessage(t('casos.suiteMoved'))
    } catch (error: any) {
      if (!isCurrentContext()) return false
      setProjectSyncMessage(`Error al mover suite: ${error.message}`)
    }
  }

  const handleReorderSuite = async (suiteId: string, direction: 'up' | 'down') => {
    if (rejectReadOnlyWrite()) return false
    const projectId = managingProjectId || currentProjectId
    if (!isValidUUID(projectId)) return false
    const contextVersion = contextHydrationVersionRef.current
    try {
      const params = new URLSearchParams({ include_archived: 'true' })
      if (currentCompId && isValidUUID(currentCompId)) params.set('componente_id', currentCompId)
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${projectId}/suites/?${params}`)
      if (!response.ok) throw new Error(t('casos.backendResponse', { status: response.status }))
      const roots = await response.json()
      const findSiblings = (rows: any[]): any[] | null => {
        if (rows.some(row => row.id === suiteId)) return rows
        for (const row of rows) { const result = findSiblings(row.children || []); if (result) return result }
        return null
      }
      const found = findSiblings(roots) || []
      const selected = found.find(row => row.id === suiteId)
      const siblings = found.filter(row => row.componente_id === selected?.componente_id).sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0) || String(a.nombre).localeCompare(String(b.nombre), undefined, { numeric: true }))
      const index = siblings.findIndex(row => row.id === suiteId)
      let target = index + (direction === 'up' ? -1 : 1)
      while (target >= 0 && target < siblings.length && siblings[target].archivado) target += direction === 'up' ? -1 : 1
      if (index < 0 || target < 0 || target >= siblings.length || contextHydrationVersionRef.current !== contextVersion) return false
      ;[siblings[index], siblings[target]] = [siblings[target], siblings[index]]
      const saved = await fetchWithAuth(`${API_BASE}/suites/reorder`, { method: 'PATCH', body: JSON.stringify({ orden: siblings.map(row => row.id) }) })
      if (!saved.ok) { const error = await saved.json().catch(() => null); throw new Error(typeof error?.detail === 'string' ? error.detail : t('casos.backendResponse', { status: saved.status })) }
      if (contextHydrationVersionRef.current === contextVersion) await loadSuitesFromBackend(projectId, currentCompId)
      return true
    } catch (error: any) {
      if (contextHydrationVersionRef.current === contextVersion) showFeedback(t('casos.moveSuiteError'), error.message, 'danger')
      return false
    }
  }

  const openCreateSuiteModal = (parentId = '') => {
    setSuiteForm({ nombre: '', descripcion: '', parentId, color: '#F1F5F9', icono: 'folder' })
    setEditingSuiteId(null)
    setShowSuiteModal(true)
  }

  const openEditSuiteModal = (suite: any) => {
    setSuiteForm({
      nombre: suite.nombre,
      descripcion: suite.descripcion || '',
      parentId: suite.parent_id || '',
      color: suite.color || '#F1F5F9',
      icono: suite.icono || suite.icon || 'folder'
    })
    setEditingSuiteId(suite.id)
    setShowSuiteModal(true)
  }

  const openMoveSuiteModal = (suiteId: string) => {
    setMovingSuiteId(suiteId)
    setMoveSuiteParentId('')
    setShowMoveSuiteModal(true)
  }

  return {
    loadSuitesFromBackend,
    handleCreateSuite,
    handleUpdateSuite,
    handleDeleteSuite,
    handleCloneSuite: handleCloneSuiteComplete,
    handleMoveSuite,
    handleReorderSuite,
    openCreateSuiteModal,
    openEditSuiteModal,
    openMoveSuiteModal
  }
}
