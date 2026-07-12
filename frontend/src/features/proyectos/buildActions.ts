import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { API_BASE } from '../../app/constants'
import { mapBackendBuildToItem } from '../../app/mappers'
import { isValidUUID } from '../../app/validation'
import { fromDateTimeLocalInput } from '../../shared/utils/dateTime'

type FeedbackVariant = 'success' | 'danger' | 'warning' | 'info'
type ConfirmAction = (options: { title: string; message: string; variant?: 'danger' | 'warning' | 'info'; confirmLabel?: string; cancelLabel?: string | null }) => Promise<boolean>

type CreateBuildActionsParams = {
  canEditCurrentProject: boolean
  projectsSource: 'local' | 'backend'
  managingProjectId: string | null
  currentCompId: string
  currentBuildId: string
  componentsList: any[]
  buildsList: any[]
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  setBuildsList: Dispatch<SetStateAction<any[]>>
  setBuildCaseIds: Dispatch<SetStateAction<Record<string, string[]>>>
  setCurrentBuildId: (buildId: string) => void
  setProjectSyncMessage: (message: string) => void
  showFeedback: (title: string, message: string, variant?: FeedbackVariant) => void
  confirmAction: ConfirmAction
}

export function createBuildActions({
  canEditCurrentProject,
  projectsSource,
  managingProjectId,
  currentCompId,
  currentBuildId,
  componentsList,
  buildsList,
  fetchWithAuth,
  setBuildsList,
  setBuildCaseIds,
  setCurrentBuildId,
  setProjectSyncMessage,
  showFeedback,
  confirmAction
}: CreateBuildActionsParams) {
  const getTargetComponentId = () =>
    currentCompId || componentsList.find(component => component.projectId === managingProjectId)?.id || ''

  const applyBackendBuild = (updatedBuild: any) => {
    const mapped = mapBackendBuildToItem(updatedBuild)
    setBuildsList(prev => prev.map(item => {
      if (item.id === mapped.id) return { ...item, ...mapped }
      if (mapped.active && item.componentId === mapped.componentId) return { ...item, active: false }
      return item
    }))
    return mapped
  }

  const handleCreateBuild = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canEditCurrentProject) {
      showFeedback('Permiso insuficiente', 'Tu rol en este proyecto no permite crear builds.', 'warning')
      return
    }
    const target = event.currentTarget
    const formData = new FormData(target)
    const name = String(formData.get('buildName') || '').trim()
    const changeContext = String(formData.get('buildContext') || '').trim()
    const startDate = String(formData.get('buildStartDate') || '').trim()
    const endDate = String(formData.get('buildEndDate') || '').trim()
    if (!name || !managingProjectId) return

    const createLocalBuild = () => {
      const componentId = getTargetComponentId()
      if (!componentId) {
        setProjectSyncMessage('Primero crea o selecciona un componente para poder agregar una build.')
        return
      }
      const newBuild = {
        id: `b${Date.now()}`,
        projectId: managingProjectId,
        componentId,
        name,
        changeContext,
        startDate,
        endDate,
        createdAt: new Date().toISOString(),
        active: buildsList.filter(build => build.projectId === managingProjectId && build.componentId === componentId).length === 0,
        hidden: false
      }
      setBuildsList(prev => [newBuild, ...prev])
      setBuildCaseIds(prev => ({ ...prev, [newBuild.id]: [] }))
      if (newBuild.active) setCurrentBuildId(newBuild.id)
      setProjectSyncMessage('Build creada en modo diseño/local.')
    }

    if (projectsSource === 'backend') {
      try {
        const componentId = getTargetComponentId()
        if (!componentId) {
          setProjectSyncMessage('Primero crea o selecciona un componente para poder agregar una build.')
          return
        }
        const response = await fetchWithAuth(`${API_BASE}/builds/`, {
          method: 'POST',
          body: JSON.stringify({
            proyecto_id: managingProjectId,
            componente_id: componentId,
            nombre: name,
            contexto_cambio: changeContext || null,
            fecha_inicio: fromDateTimeLocalInput(startDate),
            fecha_fin: fromDateTimeLocalInput(endDate),
            activo: buildsList.filter(build => build.projectId === managingProjectId && build.componentId === componentId).length === 0
          })
        })
        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.detail || `Backend respondió ${response.status}`)
        }
        const mapped = mapBackendBuildToItem(await response.json())
        setBuildsList(prev => [mapped, ...prev])
        setBuildCaseIds(prev => ({ ...prev, [mapped.id]: [] }))
        if (mapped.active) setCurrentBuildId(mapped.id)
        setProjectSyncMessage('Build creada y persistida en backend.')
      } catch (error: any) {
        setProjectSyncMessage(`No se pudo persistir build: ${error.message}.`)
      }
    } else {
      createLocalBuild()
    }
    target.reset()
  }

  const handleSetActiveBuild = async (buildId: string) => {
    if (!canEditCurrentProject) {
      showFeedback('Permiso insuficiente', 'Tu rol en este proyecto no permite activar builds.', 'warning')
      return
    }
    const build = buildsList.find(item => item.id === buildId)
    if (!build) return
    let updatedBuild: any = null
    if (projectsSource === 'backend') {
      try {
        const response = await fetchWithAuth(`${API_BASE}/builds/${buildId}`, {
          method: 'PATCH',
          body: JSON.stringify({ activo: true })
        })
        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.detail || `Backend respondió ${response.status}`)
        }
        updatedBuild = applyBackendBuild(await response.json())
      } catch (error: any) {
        setProjectSyncMessage(`No se pudo activar build: ${error.message}.`)
        return
      }
    }
    const now = new Date().toISOString()
    if (projectsSource !== 'backend') {
      setBuildsList(prev => prev.map(item => item.componentId === build.componentId
        ? { ...item, active: item.id === buildId, startDate: item.id === buildId ? (item.startDate || now) : item.startDate }
        : item
      ))
    }
    setCurrentBuildId(buildId)
    showFeedback('Build activada', `${updatedBuild?.name || build.name || 'La build'} quedó activa.`, 'success')
  }

  const handleSetInactiveBuild = async (buildId: string) => {
    if (!canEditCurrentProject) {
      showFeedback('Permiso insuficiente', 'Tu rol en este proyecto no permite desactivar builds.', 'warning')
      return
    }
    const build = buildsList.find(item => item.id === buildId)
    if (!build) return
    let updatedBuild: any = null
    if (projectsSource === 'backend') {
      try {
        const response = await fetchWithAuth(`${API_BASE}/builds/${buildId}`, {
          method: 'PATCH',
          body: JSON.stringify({ activo: false })
        })
        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.detail || `Backend respondió ${response.status}`)
        }
        updatedBuild = applyBackendBuild(await response.json())
      } catch (error: any) {
        setProjectSyncMessage(`No se pudo desactivar build: ${error.message}.`)
        showFeedback('No se pudo desactivar build', error.message || 'Error al actualizar la build.', 'danger')
        return
      }
    }
    const now = new Date().toISOString()
    if (projectsSource !== 'backend') {
      setBuildsList(prev => {
        const nextBuilds = prev.map(item => item.id === buildId ? { ...item, active: false, endDate: now } : item)
        if (currentBuildId === buildId) {
          const nextActiveBuild = nextBuilds.find(item => item.projectId === build.projectId && item.componentId === build.componentId && item.active)
          setCurrentBuildId(nextActiveBuild?.id || '')
        }
        return nextBuilds
      })
    } else if (currentBuildId === buildId) {
      const nextActiveBuild = buildsList.find(item => item.projectId === build.projectId && item.componentId === build.componentId && item.id !== buildId && item.active)
      setCurrentBuildId(nextActiveBuild?.id || '')
    }
    showFeedback('Build desactivada', `${updatedBuild?.name || build.name || 'La build'} ya no puede usarse para nuevas ejecuciones.`, 'success')
  }

  const handleUpdateBuildContext = async (event: FormEvent<HTMLFormElement>, buildId: string) => {
    event.preventDefault()
    if (!canEditCurrentProject) {
      showFeedback('Permiso insuficiente', 'Tu rol en este proyecto no permite editar builds.', 'warning')
      return
    }
    const formData = new FormData(event.currentTarget)
    const changeContext = String(formData.get('buildContext') || '').trim()
    const startDate = String(formData.get('buildStartDate') || '').trim()
    const endDate = String(formData.get('buildEndDate') || '').trim()
    let updatedBuild: any = null
    if (projectsSource === 'backend') {
      try {
        const response = await fetchWithAuth(`${API_BASE}/builds/${buildId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            contexto_cambio: changeContext || null,
            fecha_inicio: fromDateTimeLocalInput(startDate),
            fecha_fin: fromDateTimeLocalInput(endDate),
          })
        })
        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.detail || `Backend respondió ${response.status}`)
        }
        updatedBuild = applyBackendBuild(await response.json())
      } catch (error: any) {
        setProjectSyncMessage(`No se pudieron guardar notas de build: ${error.message}.`)
        showFeedback('No se pudo actualizar build', error.message || 'Error al guardar notas.', 'danger')
        return
      }
    }
    if (projectsSource !== 'backend') {
      setBuildsList(prev => prev.map(item => item.id === buildId ? { ...item, changeContext, startDate, endDate } : item))
    }
    setProjectSyncMessage('Notas de build actualizadas.')
    showFeedback('Build actualizada', `${updatedBuild?.name || 'Las notas de control de cambios'} fueron guardadas.`, 'success')
  }

  const handleToggleBuildHidden = async (buildId: string) => {
    if (!canEditCurrentProject) {
      showFeedback('Permiso insuficiente', 'Tu rol en este proyecto no permite modificar builds.', 'warning')
      return
    }
    const build = buildsList.find(item => item.id === buildId)
    if (!build) return
    const nextHidden = !build.hidden
    let updatedBuild: any = null
    if (projectsSource === 'backend') {
      try {
        const response = await fetchWithAuth(`${API_BASE}/builds/${buildId}`, {
          method: 'PATCH',
          body: JSON.stringify({ oculto: nextHidden })
        })
        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.detail || `Backend respondió ${response.status}`)
        }
        updatedBuild = applyBackendBuild(await response.json())
      } catch (error: any) {
        setProjectSyncMessage(`No se pudo actualizar visibilidad de build: ${error.message}.`)
        showFeedback('No se pudo actualizar build', error.message || 'Error al actualizar la build.', 'danger')
        return
      }
    }
    if (projectsSource !== 'backend') {
      setBuildsList(prev => {
        const nextBuilds = prev.map(item => item.id === buildId ? { ...item, hidden: nextHidden } : item)
        if (nextHidden && currentBuildId === buildId) {
          const nextVisibleActiveBuild = nextBuilds.find(item =>
            item.projectId === build.projectId &&
            item.componentId === build.componentId &&
            item.active &&
            !item.hidden
          )
          setCurrentBuildId(nextVisibleActiveBuild?.id || '')
        }
        return nextBuilds
      })
    } else if (updatedBuild?.hidden && currentBuildId === buildId) {
      const nextVisibleActiveBuild = buildsList.find(item =>
        item.projectId === build.projectId &&
        item.componentId === build.componentId &&
        item.id !== buildId &&
        item.active &&
        !item.hidden
      )
      setCurrentBuildId(nextVisibleActiveBuild?.id || '')
    }
    showFeedback(
      nextHidden ? 'Build oculta' : 'Build visible',
      nextHidden ? 'La build ya no aparece en el selector del header.' : 'La build vuelve a aparecer en el selector del header.',
      'success'
    )
  }

  const handleDeleteBuild = async (buildId: string) => {
    if (!canEditCurrentProject) {
      showFeedback('Permiso insuficiente', 'Tu rol en este proyecto no permite eliminar builds.', 'warning')
      return
    }
    const confirmed = await confirmAction({
      title: 'Eliminar build',
      message: 'Se eliminará esta build y su alcance asociado. Esta acción no se puede deshacer.',
      variant: 'danger',
      confirmLabel: 'Eliminar build'
    })
    if (!confirmed) return
    if (projectsSource === 'backend') {
      try {
        const response = await fetchWithAuth(`${API_BASE}/builds/${buildId}`, { method: 'DELETE' })
        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.detail || `Backend respondió ${response.status}`)
        }
      } catch (error: any) {
        setProjectSyncMessage(`No se pudo eliminar build: ${error.message}.`)
        showFeedback('No se pudo eliminar build', error.message || 'Error al eliminar la build.', 'danger')
        return
      }
    }
    setBuildsList(prev => {
      const nextBuilds = prev.filter(build => build.id !== buildId)
      if (currentBuildId === buildId) {
        setCurrentBuildId(nextBuilds.find(build => build.projectId === managingProjectId && build.componentId === currentCompId && build.active)?.id || '')
      }
      return nextBuilds
    })
    setProjectSyncMessage('Build eliminada.')
    showFeedback('Build eliminada', 'La build y su alcance asociado fueron eliminados.', 'success')
  }

  return {
    handleCreateBuild,
    handleSetActiveBuild,
    handleSetInactiveBuild,
    handleUpdateBuildContext,
    handleToggleBuildHidden,
    handleDeleteBuild
  }
}
