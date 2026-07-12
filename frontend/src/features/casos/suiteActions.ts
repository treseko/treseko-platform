import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { API_BASE } from '../../app/constants'
import { isValidUUID } from '../../app/validation'

type FeedbackVariant = 'success' | 'danger' | 'warning' | 'info'
type ConfirmAction = (options: { title: string; message: string; variant?: 'danger' | 'warning' | 'info'; confirmLabel?: string; cancelLabel?: string | null }) => Promise<boolean>

type CreateSuiteActionsParams = {
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
}

const emptySuiteForm = { nombre: '', descripcion: '', parentId: '', color: '#F1F5F9', icono: 'folder' }

export function createSuiteActions({
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
  confirmAction
}: CreateSuiteActionsParams) {
  const loadSuitesFromBackend = async (projectId: string, componentId = currentCompId, options?: { silent?: boolean }) => {
    if (!projectId || projectsSource !== 'backend') return
    const silent = Boolean(options?.silent)
    if (!silent) setSuitesLoading(true)
    try {
      const params = new URLSearchParams({ include_archived: 'true' })
      if (componentId && isValidUUID(componentId)) params.set('componente_id', componentId)
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${projectId}/suites/?${params}`)
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      const suites = await response.json()
      setSuitesTree(suites)
    } catch (error: any) {
      setProjectSyncMessage(`No se pudieron cargar suites: ${error.message}`)
    } finally {
      if (!silent) setSuitesLoading(false)
    }
  }

  const handleCreateSuite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const projectId = managingProjectId || currentProjectId
    const formData = new FormData(event.currentTarget)
    const submittedName = String(formData.get('nombre') || formData.get('folderName') || suiteForm.nombre || '').trim()
    const submittedDescription = String(formData.get('descripcion') || suiteForm.descripcion || '')
    const submittedParentId = String(formData.get('parentId') || suiteForm.parentId || '')
    const submittedColor = String(formData.get('color') || suiteForm.color || '#F1F5F9')
    const submittedIcon = String(formData.get('icono') || suiteForm.icono || 'folder')

    if (!isValidUUID(projectId)) {
      showFeedback('Proyecto no válido', 'No hay proyecto seleccionado o el proyecto no es válido. Selecciona un proyecto del backend primero.', 'warning')
      return false
    }

    if (!submittedName) {
      showFeedback('Nombre requerido', 'Ingresa un nombre para crear la suite.', 'warning')
      return false
    }

    try {
      const componentBelongsToProject = componentsList.some(component =>
        component.id === currentCompId && component.projectId === projectId
      )
      const componentId = isValidUUID(currentCompId) && componentBelongsToProject ? currentCompId : null
      const response = await fetchWithAuth(`${API_BASE}/suites/`, {
        method: 'POST',
        body: JSON.stringify({
          proyecto_id: projectId,
          componente_id: componentId,
          nombre: submittedName,
          descripcion: submittedDescription,
          parent_id: submittedParentId || null,
          color: submittedColor,
          icono: submittedIcon
        })
      })
      if (!response.ok) {
        throw new Error(`Backend respondió ${response.status}`)
      }
      const createdSuite = await response.json()
      await loadSuitesFromBackend(projectId, componentId || '')
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
      setProjectSyncMessage('Suite creada correctamente.')
      showFeedback('Suite creada', 'La carpeta fue creada correctamente.', 'success')
    } catch (error: any) {
      setProjectSyncMessage(`Error al crear suite: ${error.message}`)
      showFeedback('Error al crear suite', error.message || 'No se pudo crear la carpeta.', 'danger')
    }
  }

  const handleUpdateSuite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editingSuiteId) return
    const projectId = managingProjectId || currentProjectId
    if (!isValidUUID(projectId)) {
      showFeedback('Proyecto no válido', 'Selecciona un proyecto válido antes de continuar.', 'warning')
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
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      await loadSuitesFromBackend(projectId, currentCompId)
      setShowSuiteModal(false)
      setEditingSuiteId(null)
      setSuiteForm(emptySuiteForm)
      setProjectSyncMessage('Suite actualizada correctamente.')
      showFeedback('Suite actualizada', 'La carpeta fue actualizada correctamente.', 'success')
    } catch (error: any) {
      setProjectSyncMessage(`Error al actualizar suite: ${error.message}`)
      showFeedback('Error al actualizar suite', error.message || 'No se pudo actualizar la carpeta.', 'danger')
    }
  }

  const handleDeleteSuite = async (suiteId: string) => {
    const confirmed = await confirmAction({
      title: 'Eliminar carpeta',
      message: 'Se eliminará esta suite y todas sus sub-suites. Esta acción no se puede deshacer.',
      variant: 'danger',
      confirmLabel: 'Eliminar carpeta'
    })
    if (!confirmed) return
    const projectId = managingProjectId || currentProjectId
    if (!isValidUUID(projectId)) {
      showFeedback('Proyecto no válido', 'Selecciona un proyecto válido antes de continuar.', 'warning')
      return
    }

    try {
      const response = await fetchWithAuth(`${API_BASE}/suites/${suiteId}`, {
        method: 'DELETE'
      })
      if (!response.ok) {
        const error = await response.json()
        showFeedback('No se pudo eliminar la suite', error.detail || 'No se pudo eliminar la suite.', 'danger')
        return
      }
      await loadSuitesFromBackend(projectId, currentCompId)
      setProjectSyncMessage('Suite eliminada correctamente.')
    } catch (error: any) {
      setProjectSyncMessage(`Error al eliminar suite: ${error.message}`)
    }
  }

  const handleCloneSuite = async (suiteId: string) => {
    const projectId = managingProjectId || currentProjectId
    if (!isValidUUID(projectId)) {
      showFeedback('Proyecto no válido', 'Selecciona un proyecto válido antes de continuar.', 'warning')
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
      await loadSuitesFromBackend(projectId, currentCompId)
      setProjectSyncMessage('Suite clonada correctamente.')
    } catch (error: any) {
      setProjectSyncMessage(`Error al clonar suite: ${error.message}`)
    }
  }

  const handleCloneSuiteComplete = async (suiteId: string, options: { nuevo_nombre?: string; parent_id?: string | null; include_cases?: boolean } = {}) => {
    const projectId = managingProjectId || currentProjectId
    if (!isValidUUID(projectId)) {
      showFeedback('Proyecto no valido', 'Selecciona un proyecto valido antes de continuar.', 'warning')
      return false
    }

    try {
      const response = await fetchWithAuth(`${API_BASE}/suites/${suiteId}/clone`, {
        method: 'POST',
        body: JSON.stringify({
          nuevo_nombre: options.nuevo_nombre,
          parent_id: options.parent_id || null,
          include_cases: options.include_cases ?? true
        })
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondio ${response.status}`)
      }
      const cloneResult = await response.json()
      const clonedSuite = cloneResult?.suite || cloneResult
      await loadSuitesFromBackend(projectId, currentCompId)
      await reloadCasosAfterSuiteClone?.(projectId, componentsList)
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
      setProjectSyncMessage('Suite copiada correctamente.')
      showFeedback('Suite copiada', `Se copiaron ${suitesCount} suite(s) y ${casesCount} caso(s).`, 'success')
      return cloneResult
    } catch (error: any) {
      setProjectSyncMessage(`Error al copiar suite: ${error.message}`)
      showFeedback('Error al copiar suite', error.message || 'No se pudo copiar la suite.', 'danger')
      return false
    }
  }

  const handleMoveSuite = async () => {
    if (!movingSuiteId) return
    const projectId = managingProjectId || currentProjectId
    if (!isValidUUID(projectId)) {
      showFeedback('Proyecto no válido', 'Selecciona un proyecto válido antes de continuar.', 'warning')
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
        showFeedback('No se pudo mover la suite', error.detail || 'No se pudo mover la suite.', 'danger')
        return
      }
      await loadSuitesFromBackend(projectId, currentCompId)
      setShowMoveSuiteModal(false)
      setMovingSuiteId(null)
      setMoveSuiteParentId('')
      setProjectSyncMessage('Suite movida correctamente.')
    } catch (error: any) {
      setProjectSyncMessage(`Error al mover suite: ${error.message}`)
    }
  }

  const handleReorderSuite = async (_suiteId: string, _direction: 'up' | 'down') => {
    setProjectSyncMessage('Funcionalidad de reordenamiento pendiente de implementar.')
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
