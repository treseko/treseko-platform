import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { API_BASE } from '../../app/constants'
import { mapBackendComponentToItem } from '../../app/mappers'
import { isValidUUID } from '../../app/validation'

type FeedbackVariant = 'success' | 'danger' | 'warning' | 'info'
type Translate = (key: string, options?: Record<string, unknown>) => string
type ConfirmAction = (options: { title: string; message: string; variant?: 'danger' | 'warning' | 'info'; confirmLabel?: string; cancelLabel?: string | null }) => Promise<boolean>

const parseKeyValueText = (value: string) => {
  const result: Record<string, string> = {}
  String(value || '').split(/\r?\n/).forEach(line => {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.includes('=')) return
    const [rawKey, ...rawValue] = trimmed.split('=')
    const key = rawKey.trim()
    if (!key) return
    result[key] = rawValue.join('=').trim()
  })
  return result
}

type CreateComponentActionsParams = {
  canEditCurrentProject: boolean
  projectsSource: 'local' | 'backend'
  managingProjectId: string | null
  currentProjectId: string
  componentForm: any
  componentsList: any[]
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  setComponentsList: Dispatch<SetStateAction<any[]>>
  setCurrentCompId: (componentId: string) => void
  setNewTestComponent: (componentId: string) => void
  setCurrentBuildId: (buildId: string) => void
  setShowComponentModal: (show: boolean) => void
  setComponentForm: Dispatch<SetStateAction<any>>
  setProjectSyncMessage: (message: string) => void
  showFeedback: (title: string, message: string, variant?: FeedbackVariant) => void
  confirmAction: ConfirmAction
  t: Translate
  readOnlyBuild?: boolean
}

export function createComponentActions({
  canEditCurrentProject,
  projectsSource,
  managingProjectId,
  currentProjectId,
  componentForm,
  componentsList,
  fetchWithAuth,
  setComponentsList,
  setCurrentCompId,
  setNewTestComponent,
  setCurrentBuildId,
  setShowComponentModal,
  setComponentForm,
  setProjectSyncMessage,
  showFeedback,
  confirmAction,
  t,
  readOnlyBuild = false
}: CreateComponentActionsParams) {
  const handleCreateComponent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canEditCurrentProject) {
      showFeedback(t('proyectos.insufficientPermission'), t('proyectos.componentCreatePermission'), 'warning')
      return
    }
    if (readOnlyBuild) {
      showFeedback(t('proyectos.insufficientPermission'), 'La build histórica está en modo consulta y no admite modificaciones.', 'warning')
      return
    }
    const target = event.currentTarget
    const formData = new FormData(target)
    const name = String(formData.get('componentName') || '').trim()
    if (!name || !managingProjectId) return

    const createLocalComponent = () => {
      const newComponent = {
        id: `c${componentsList.length + 1}`,
        projectId: managingProjectId,
        name,
        description: '',
        techStack: '',
        variables: {}
      }
      setComponentsList([...componentsList, newComponent])
      setCurrentCompId(newComponent.id)
      setNewTestComponent(newComponent.id)
      setCurrentBuildId('')
      setProjectSyncMessage(t('proyectos.componentCreatedLocal'))
    }

    if (projectsSource === 'backend') {
      try {
        const response = await fetchWithAuth(`${API_BASE}/componentes/`, {
          method: 'POST',
          body: JSON.stringify({
            proyecto_id: managingProjectId,
            nombre: name,
            descripcion: '',
            variables: {}
          })
        })

        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.detail || `Backend respondió ${response.status}`)
        }

        const component = await response.json()
        const mapped = mapBackendComponentToItem(component)
        setComponentsList([...componentsList, mapped])
        setCurrentCompId(mapped.id)
        setNewTestComponent(mapped.id)
        setCurrentBuildId('')
        setProjectSyncMessage(t('proyectos.componentCreatedBackend'))
      } catch (error: any) {
        setProjectSyncMessage(`${t('proyectos.componentPersistError')}: ${error.message}.`)
      }
    } else {
      createLocalComponent()
    }

    target.reset()
  }

  const handleSaveComponentForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (readOnlyBuild) {
      showFeedback(t('proyectos.insufficientPermission'), 'La build histórica está en modo consulta y no admite modificaciones.', 'warning')
      return
    }
    if (!canEditCurrentProject) {
      showFeedback(t('proyectos.insufficientPermission'), t('proyectos.componentEditPermission'), 'warning')
      return
    }
    const projectId = managingProjectId || currentProjectId
    const name = componentForm.name.trim()
    const description = componentForm.description.trim()
    const techStack = componentForm.techStack.trim()
    const variables = parseKeyValueText(componentForm.variablesText || '')
    if (!name || !projectId) return

    const closeModal = () => {
      setShowComponentModal(false)
      setComponentForm({ id: '', name: '', description: '', techStack: '', variablesText: '' })
    }

    if (componentForm.id) {
      if (projectsSource === 'backend' && isValidUUID(componentForm.id)) {
        try {
          const response = await fetchWithAuth(`${API_BASE}/componentes/${componentForm.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              nombre: name,
              descripcion: description,
              tech_stack: techStack,
              variables
            })
          })
          if (!response.ok) {
            const error = await response.json().catch(() => null)
            throw new Error(error?.detail || `Backend respondió ${response.status}`)
          }
          const updated = mapBackendComponentToItem(await response.json())
          setComponentsList(prev => prev.map(component => component.id === updated.id ? updated : component))
          setProjectSyncMessage(t('proyectos.componentUpdatedBackend'))
          closeModal()
          return
        } catch (error: any) {
          setProjectSyncMessage(`${t('proyectos.componentUpdateError')}: ${error.message}.`)
          return
        }
      }

      setComponentsList(prev => prev.map(component => component.id === componentForm.id ? {
        ...component,
        name,
        description,
        techStack,
        variables
      } : component))
      setProjectSyncMessage(t('proyectos.componentUpdatedLocal'))
      closeModal()
      return
    }

    if (projectsSource === 'backend' && isValidUUID(projectId)) {
      try {
        const response = await fetchWithAuth(`${API_BASE}/componentes/`, {
          method: 'POST',
          body: JSON.stringify({
            proyecto_id: projectId,
            nombre: name,
            descripcion: description,
            tech_stack: techStack,
            variables
          })
        })
        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.detail || `Backend respondió ${response.status}`)
        }
        const created = mapBackendComponentToItem(await response.json())
        setComponentsList(prev => [...prev, created])
        setCurrentCompId(created.id)
        setNewTestComponent(created.id)
        setCurrentBuildId('')
        setProjectSyncMessage(t('proyectos.componentCreatedBackend'))
        closeModal()
        return
      } catch (error: any) {
        setProjectSyncMessage(`${t('proyectos.componentPersistError')}: ${error.message}.`)
        return
      }
    }

    const localComponent = {
      id: `c${Date.now()}`,
      projectId,
      name,
      description,
      techStack,
      variables
    }
    setComponentsList(prev => [...prev, localComponent])
    setCurrentCompId(localComponent.id)
    setNewTestComponent(localComponent.id)
    setCurrentBuildId('')
    setProjectSyncMessage(t('proyectos.componentCreatedLocal'))
    closeModal()
  }

  const handleDeleteComponent = async (componentId: string) => {
    if (!canEditCurrentProject) {
      showFeedback(t('proyectos.insufficientPermission'), t('proyectos.componentDeletePermission'), 'warning')
      return
    }
    if (readOnlyBuild) {
      showFeedback(t('proyectos.insufficientPermission'), 'La build histórica está en modo consulta y no admite modificaciones.', 'warning')
      return
    }
    const confirmed = await confirmAction({
      title: t('proyectos.deleteComponent'),
      message: t('proyectos.deleteComponentConfirm'),
      variant: 'danger',
      confirmLabel: t('proyectos.deleteComponent')
    })
    if (!confirmed) return
    if (projectsSource === 'backend') {
      try {
        const response = await fetchWithAuth(`${API_BASE}/componentes/${componentId}`, { method: 'DELETE' })
        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.detail || `Backend respondió ${response.status}`)
        }
        setProjectSyncMessage(t('proyectos.componentDeletedBackend'))
      } catch (error: any) {
        setProjectSyncMessage(`${t('proyectos.componentDeleteError')}: ${error.message}.`)
        return
      }
    }
    setComponentsList(componentsList.filter(component => component.id !== componentId))
  }

  return {
    handleCreateComponent,
    handleSaveComponentForm,
    handleDeleteComponent
  }
}
