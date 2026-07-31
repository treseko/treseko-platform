import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { API_BASE } from '../../app/constants'
import { mapBackendBuildToItem } from '../../app/mappers'
import { isValidUUID } from '../../app/validation'
import { fromDateTimeLocalInput } from '../../shared/utils/dateTime'
import type { TranslationKey } from '../../i18n'
import { isBuildReadOnly } from '../../app/buildState'

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
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
  readOnlyBuild?: boolean
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
  confirmAction,
  t,
  readOnlyBuild = false
}: CreateBuildActionsParams) {
  const getTargetComponentId = () =>
    currentCompId || componentsList.find(component => component.projectId === managingProjectId)?.id || ''

  const rejectInactiveWrite = (buildId: string) => {
    const build = buildsList.find(item => item.id === buildId)
    if (isBuildReadOnly(build)) {
      showFeedback(t('proyectos.buildUpdateError'), 'La build histórica está en modo consulta y no admite modificaciones.', 'warning')
      return true
    }
    return false
  }

  const applyBackendBuild = (updatedBuild: any) => {
    const mapped = mapBackendBuildToItem(updatedBuild)
    setBuildsList(prev => prev.map(item => {
      if (item.id === mapped.id) return { ...item, ...mapped }
      if (mapped.active && item.componentId === mapped.componentId && (item.active || item.state === 'ACTIVA')) {
        return { ...item, active: false, state: 'HISTORICA' }
      }
      return item
    }))
    return mapped
  }

  const handleCreateBuild = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canEditCurrentProject) {
      showFeedback(t('proyectos.buildPermissionTitle'), t('proyectos.buildCreatePermission'), 'warning')
      return
    }
    if (readOnlyBuild) {
      showFeedback(t('proyectos.buildUpdateError'), 'La build histórica está en modo consulta y no admite modificaciones.', 'warning')
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
        setProjectSyncMessage(t('proyectos.buildSelectComponent'))
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
        active: false,
        state: 'PREPARACION',
        hidden: false
      }
      setBuildsList(prev => [newBuild, ...prev])
      setBuildCaseIds(prev => ({ ...prev, [newBuild.id]: [] }))
      setProjectSyncMessage(t('proyectos.buildCreatedLocal'))
    }

    if (projectsSource === 'backend') {
      try {
        const componentId = getTargetComponentId()
        if (!componentId) {
          setProjectSyncMessage(t('proyectos.buildSelectComponent'))
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
            estado: 'PREPARACION',
            activo: false
          })
        })
        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.detail || `Backend respondió ${response.status}`)
        }
        const mapped = mapBackendBuildToItem(await response.json())
        setBuildsList(prev => [mapped, ...prev])
        setBuildCaseIds(prev => ({ ...prev, [mapped.id]: [] }))
        setProjectSyncMessage(t('proyectos.buildCreatedBackend'))
      } catch (error: any) {
        setProjectSyncMessage(`${t('proyectos.buildPersistError')}: ${error.message}.`)
      }
    } else {
      createLocalBuild()
    }
    target.reset()
  }

  const handleSetActiveBuild = async (buildId: string) => {
    if (!canEditCurrentProject) {
      showFeedback(t('proyectos.buildPermissionTitle'), t('proyectos.buildActivatePermission'), 'warning')
      return
    }
    const build = buildsList.find(item => item.id === buildId)
    if (!build) return
    let updatedBuild: any = null
    if (projectsSource === 'backend') {
      try {
        const response = await fetchWithAuth(`${API_BASE}/builds/${buildId}`, {
          method: 'PATCH',
          body: JSON.stringify({ estado: 'ACTIVA', activo: true })
        })
        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.detail || `Backend respondió ${response.status}`)
        }
        updatedBuild = applyBackendBuild(await response.json())
      } catch (error: any) {
        setProjectSyncMessage(`${t('proyectos.buildActivateError')}: ${error.message}.`)
        return
      }
    }
    const now = new Date().toISOString()
    if (projectsSource !== 'backend') {
      setBuildsList(prev => prev.map(item => item.componentId === build.componentId
        ? item.id === buildId
          ? { ...item, active: true, state: 'ACTIVA', startDate: item.startDate || now }
          : item.active || item.state === 'ACTIVA'
            ? { ...item, active: false, state: 'HISTORICA' }
            : item
        : item
      ))
    }
    setCurrentBuildId(buildId)
    showFeedback(t('proyectos.buildActivated'), `${updatedBuild?.name || build.name || t('proyectos.theBuild')} ${t('proyectos.buildIsActive')}`, 'success')
  }

  const handleSetInactiveBuild = async (buildId: string) => {
    if (!canEditCurrentProject) {
      showFeedback(t('proyectos.buildPermissionTitle'), t('proyectos.buildDeactivatePermission'), 'warning')
      return
    }
    const build = buildsList.find(item => item.id === buildId)
    if (!build) return
    let updatedBuild: any = null
    if (projectsSource === 'backend') {
      try {
        const response = await fetchWithAuth(`${API_BASE}/builds/${buildId}`, {
          method: 'PATCH',
          body: JSON.stringify({ estado: 'HISTORICA', activo: false })
        })
        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.detail || `Backend respondió ${response.status}`)
        }
        updatedBuild = applyBackendBuild(await response.json())
      } catch (error: any) {
        setProjectSyncMessage(`${t('proyectos.buildDeactivateError')}: ${error.message}.`)
        showFeedback(t('proyectos.buildUpdateError'), error.message || t('proyectos.buildUpdateFallback'), 'danger')
        return
      }
    }
    const now = new Date().toISOString()
    if (projectsSource !== 'backend') {
      setBuildsList(prev => {
        const nextBuilds = prev.map(item => item.id === buildId ? { ...item, active: false, state: 'HISTORICA', endDate: now } : item)
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
    showFeedback(t('proyectos.buildDeactivated'), `${updatedBuild?.name || build.name || t('proyectos.theBuild')} ${t('proyectos.buildNoLongerActive')}`, 'success')
  }

  const handleUpdateBuildContext = async (event: FormEvent<HTMLFormElement>, buildId: string) => {
    event.preventDefault()
    if (!canEditCurrentProject) {
      showFeedback(t('proyectos.insufficientPermission'), t('proyectos.buildEditPermission'), 'warning')
      return
    }
    if (rejectInactiveWrite(buildId)) return
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
        showFeedback(t('proyectos.buildUpdateError'), error.message || t('proyectos.buildUpdateFallback'), 'danger')
        return
      }
    }
    if (projectsSource !== 'backend') {
      setBuildsList(prev => prev.map(item => item.id === buildId ? { ...item, changeContext, startDate, endDate } : item))
    }
    setProjectSyncMessage(t('proyectos.buildUpdated'))
    showFeedback(t('proyectos.buildUpdated'), `${updatedBuild?.name || t('proyectos.changeNotes')} ${t('proyectos.savedSuffix')}`, 'success')
  }

  const handleToggleBuildHidden = async (buildId: string) => {
    if (!canEditCurrentProject) {
      showFeedback(t('proyectos.insufficientPermission'), t('proyectos.buildEditPermission'), 'warning')
      return
    }
    if (rejectInactiveWrite(buildId)) return
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
        showFeedback(t('proyectos.buildUpdateError'), error.message || t('proyectos.buildUpdateFallback'), 'danger')
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
      nextHidden ? t('proyectos.buildHidden') : t('proyectos.buildVisible'),
      nextHidden ? t('proyectos.buildHiddenMessage') : t('proyectos.buildVisibleMessage'),
      'success'
    )
  }

  const handleDeleteBuild = async (buildId: string) => {
    if (!canEditCurrentProject) {
      showFeedback(t('proyectos.insufficientPermission'), t('proyectos.buildDeletePermission'), 'warning')
      return
    }
    if (rejectInactiveWrite(buildId)) return
    const confirmed = await confirmAction({
      title: t('proyectos.deleteBuild'),
      message: t('proyectos.deleteBuildConfirm'),
      variant: 'danger',
      confirmLabel: t('proyectos.deleteBuild')
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
        setProjectSyncMessage(`${t('proyectos.buildDeleteError')}: ${error.message}.`)
        showFeedback(t('proyectos.buildDeleteError'), error.message || t('proyectos.buildDeleteFallback'), 'danger')
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
    setProjectSyncMessage(t('proyectos.buildDeleted'))
    showFeedback(t('proyectos.buildDeleted'), t('proyectos.buildDeletedMessage'), 'success')
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
