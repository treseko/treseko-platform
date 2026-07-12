import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { ALLOW_LOCAL_FALLBACK, API_BASE } from '../../app/constants'
import { ERROR_CODES, formatAppError } from '../../app/errorCodes'
import { mapBackendProjectToCard } from '../../app/mappers'

type FeedbackVariant = 'success' | 'danger' | 'warning' | 'info'

type CreateProjectActionsParams = {
  canEditCurrentProject: boolean
  projectsSource: 'local' | 'backend'
  currentOrgId: string
  currentProjectId: string
  managingProjectId: string | null
  organizations: any[]
  projectsList: any[]
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  setProjectsLoading: (loading: boolean) => void
  setProjectsList: Dispatch<SetStateAction<any[]>>
  setCurrentProjectId: (projectId: string) => void
  setCurrentOrgId: (orgId: string) => void
  setSelectedOrganizationId: Dispatch<SetStateAction<string | null>>
  setCurrentCompId: (componentId: string) => void
  setCurrentBuildId: (buildId: string) => void
  setProjectsSource: (source: 'local' | 'backend') => void
  setProjectSyncMessage: (message: string) => void
  showFeedback: (title: string, message: string, variant?: FeedbackVariant) => void
}

export function createProjectActions({
  canEditCurrentProject,
  projectsSource,
  currentOrgId,
  currentProjectId,
  managingProjectId,
  organizations,
  projectsList,
  fetchWithAuth,
  setProjectsLoading,
  setProjectsList,
  setCurrentProjectId,
  setCurrentOrgId,
  setSelectedOrganizationId,
  setCurrentCompId,
  setCurrentBuildId,
  setProjectsSource,
  setProjectSyncMessage,
  showFeedback
}: CreateProjectActionsParams) {
  const loadProjectsFromBackend = async (knownOrganizations = organizations) => {
    setProjectsLoading(true)
    try {
      const activeKnownOrganizations = knownOrganizations.filter((org: any) => org.active !== false)
      if (activeKnownOrganizations.length === 0) {
        setProjectsList([])
        setCurrentProjectId('')
        setCurrentCompId('')
        setCurrentBuildId('')
        setProjectsSource('backend')
        setProjectSyncMessage('No hay clientes o soluciones asignados para este usuario.')
        return
      }
      const response = await fetchWithAuth(`${API_BASE}/proyectos/`)
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }

      const projects = await response.json()
      const fallbackOrgId = activeKnownOrganizations.find((org: any) => org.id === currentOrgId)?.id || activeKnownOrganizations[0]?.id || currentOrgId
      const mapped = projects.map((project: any) => mapBackendProjectToCard(project, fallbackOrgId))

      setProjectsList(mapped)
      const selectedProject = mapped.find((project: any) => project.id === currentProjectId)
        || mapped.find((project: any) => project.orgId === fallbackOrgId)
        || mapped[0]
      if (selectedProject) {
        setCurrentProjectId(selectedProject.id)
        setCurrentOrgId(selectedProject.orgId)
        setSelectedOrganizationId(selectedProject.orgId)
      } else {
        setCurrentProjectId('')
        setCurrentCompId('')
        setCurrentBuildId('')
      }
      setProjectsSource('backend')
      setProjectSyncMessage('')
    } catch (error: any) {
      if (error.message?.includes('403')) {
        setProjectsList([])
        setCurrentProjectId('')
        setCurrentCompId('')
        setCurrentBuildId('')
      }
      if (ALLOW_LOCAL_FALLBACK) {
        setProjectsSource('local')
        setProjectSyncMessage(`Modo diseño/local: ${error.message || 'backend no disponible'}.`)
      } else {
        setProjectsList([])
        setCurrentProjectId('')
        setCurrentCompId('')
        setCurrentBuildId('')
        setProjectsSource('backend')
        setProjectSyncMessage(formatAppError(ERROR_CODES.BACKEND_UNAVAILABLE, `No se pudieron cargar proyectos reales. ${error.message || 'Backend no disponible'}.`))
      }
    } finally {
      setProjectsLoading(false)
    }
  }

  const handleCreateProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const target = event.currentTarget
    const formData = new FormData(target)
    const pName = String(formData.get('projName') || '').trim()
    const orgSelect = String(formData.get('orgSelect') || currentOrgId)
    if (!pName) return

    const createLocalProject = () => {
      const newProjId = `p${projectsList.length + 1}`
      const localProject = {
        id: newProjId,
        orgId: orgSelect,
        name: pName,
        status: 'Activo',
        health: 0,
        testsCount: 0,
        runsCount: 0,
        team: 0,
        redmineLinked: false
      }
      setProjectsList([...projectsList, localProject])
      setCurrentProjectId(newProjId)
      setCurrentOrgId(orgSelect)
      setProjectSyncMessage('Proyecto creado en modo diseño/local. Levantá el backend para persistirlo.')
    }

    if (projectsSource === 'backend') {
      try {
        const response = await fetchWithAuth(`${API_BASE}/proyectos/`, {
          method: 'POST',
          body: JSON.stringify({
            nombre: pName,
            descripcion: '',
            activo: true,
            organizacion_id: orgSelect
          })
        })

        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.detail || `Backend respondió ${response.status}`)
        }

        const project = await response.json()
        const mapped = mapBackendProjectToCard(project, orgSelect)
        setProjectsList([...projectsList, mapped])
        setCurrentProjectId(mapped.id)
        setCurrentOrgId(mapped.orgId)
        setProjectSyncMessage('Proyecto creado y persistido en backend.')
      } catch (error: any) {
        if (ALLOW_LOCAL_FALLBACK) {
          setProjectsSource('local')
          createLocalProject()
          setProjectSyncMessage(`No se pudo persistir en backend: ${error.message}. Se creó localmente.`)
        } else {
          const message = formatAppError(ERROR_CODES.PROJECT_CREATE_FAILED, `No se pudo crear el proyecto en backend. ${error.message}.`)
          setProjectSyncMessage(message)
          showFeedback('Proyecto no creado', message, 'danger')
        }
      }
    } else {
      if (ALLOW_LOCAL_FALLBACK) {
        createLocalProject()
      } else {
        const message = formatAppError(ERROR_CODES.REAL_MODE_LOCAL_WRITE_DISABLED, 'La creación local está deshabilitada. Conectá el backend para crear proyectos.')
        setProjectSyncMessage(message)
        showFeedback('Modo real activo', message, 'warning')
      }
    }

    target.reset()
  }

  const handleUpdateProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!managingProjectId) return
    if (!canEditCurrentProject) {
      showFeedback('Permiso insuficiente', 'Tu rol en este proyecto es de solo lectura.', 'warning')
      return
    }

    const target = event.currentTarget
    const formData = new FormData(target)
    const name = String(formData.get('projectName') || '').trim()
    const status = String(formData.get('projectStatus') || 'Activo')
    const imageUrl = String(formData.get('projectImageUrl') || '').trim()
    if (!name) return

    const activo = status === 'Activo' || status === 'En QA'
    const updateLocalProject = () => {
      setProjectsList(projectsList.map(project => (
        project.id === managingProjectId
          ? { ...project, name, status, imageUrl }
          : project
      )))
    }

    if (projectsSource === 'backend') {
      try {
        const response = await fetchWithAuth(`${API_BASE}/proyectos/${managingProjectId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nombre: name,
            estado: status,
            imagen_url: imageUrl || null,
            activo
          })
        })

        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.detail || `Backend respondió ${response.status}`)
        }

        const updated = await response.json()
        const mapped = mapBackendProjectToCard(updated, currentOrgId)
        setProjectsList(projectsList.map(project => (
          project.id === mapped.id ? { ...project, ...mapped } : project
        )))
        setProjectSyncMessage('Cambios del proyecto guardados en backend.')
        showFeedback('Proyecto actualizado', 'Los cambios del proyecto se guardaron correctamente.', 'success')
      } catch (error: any) {
        setProjectSyncMessage(`No se pudo actualizar backend: ${error.message}.`)
        showFeedback('No se pudo guardar', error.message || 'Revisa los datos del proyecto.', 'danger')
      }
    } else {
      if (ALLOW_LOCAL_FALLBACK) {
        updateLocalProject()
        setProjectSyncMessage('Cambios del proyecto aplicados en modo diseño/local.')
      } else {
        const message = formatAppError(ERROR_CODES.REAL_MODE_LOCAL_WRITE_DISABLED, 'La edición local está deshabilitada. Conectá el backend para guardar cambios.')
        setProjectSyncMessage(message)
        showFeedback('Modo real activo', message, 'warning')
      }
    }
  }

  return {
    loadProjectsFromBackend,
    handleCreateProject,
    handleUpdateProject
  }
}
