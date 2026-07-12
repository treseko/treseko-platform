import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { API_BASE } from '../../app/constants'
import { mapBackendProjectMemberToItem } from '../../app/mappers'
import { isValidUUID } from '../../app/validation'

type CreateProjectMemberActionsParams = {
  projectsSource: 'local' | 'backend'
  managingProjectId: string | null
  projectMemberForm: any
  projectMemberRemoval: any
  assignableUsers: any[]
  projectMembers: any[]
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  setProjectMemberForm: Dispatch<SetStateAction<any>>
  setShowProjectMemberModal: (show: boolean) => void
  setProjectSyncMessage: (message: string) => void
  setProjectMembers: Dispatch<SetStateAction<any[]>>
  setProjectsList: Dispatch<SetStateAction<any[]>>
  setProjectMemberRemoval: Dispatch<SetStateAction<any | null>>
}

export function createProjectMemberActions({
  projectsSource,
  managingProjectId,
  projectMemberForm,
  projectMemberRemoval,
  assignableUsers,
  projectMembers,
  fetchWithAuth,
  setProjectMemberForm,
  setShowProjectMemberModal,
  setProjectSyncMessage,
  setProjectMembers,
  setProjectsList,
  setProjectMemberRemoval
}: CreateProjectMemberActionsParams) {
  const loadProjectMembers = async (projectId: string) => {
    if (!projectId || !isValidUUID(projectId) || projectsSource !== 'backend') return
    try {
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${projectId}/miembros/`)
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      const members = await response.json()
      const mapped = members.map(mapBackendProjectMemberToItem)
      setProjectMembers(prev => [
        ...prev.filter(member => member.projectId !== projectId),
        ...mapped
      ])
      setProjectsList(prev => prev.map(project => project.id === projectId ? { ...project, team: mapped.length } : project))
    } catch (error: any) {
      setProjectSyncMessage(`No se pudo cargar equipo: ${error.message}.`)
    }
  }

  const handleAddProjectMember = () => {
    if (!managingProjectId) return
    setProjectMemberForm({
      userId: assignableUsers[0]?.id || ''
    })
    setShowProjectMemberModal(true)
  }

  const handleSubmitProjectMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!managingProjectId || !projectMemberForm.userId) return
    const user = assignableUsers.find(item => item.id === projectMemberForm.userId)
    if (!user) {
      setProjectSyncMessage('Usuario no encontrado. Primero debe existir en el directorio de usuarios.')
      return
    }
    const localMember = {
      id: `pm${Date.now()}`,
      projectId: managingProjectId,
      userId: user.id,
      user
    }

    if (projectsSource === 'backend') {
      try {
        const response = await fetchWithAuth(`${API_BASE}/proyectos/${managingProjectId}/miembros/`, {
          method: 'POST',
          body: JSON.stringify({
            usuario_id: projectMemberForm.userId
          })
        })
        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.detail || `Backend respondió ${response.status}`)
        }
        const member = await response.json()
        const mapped = mapBackendProjectMemberToItem(member)
        const nextMembers = [
          ...projectMembers.filter(item => !(item.projectId === managingProjectId && item.userId === mapped.userId)),
          mapped
        ]
        setProjectMembers(nextMembers)
        setProjectsList(prev => prev.map(project => project.id === managingProjectId ? { ...project, team: nextMembers.filter(item => item.projectId === managingProjectId).length } : project))
        setProjectSyncMessage('Miembro asignado al proyecto en backend.')
        setShowProjectMemberModal(false)
      } catch (error: any) {
        setProjectSyncMessage(`No se pudo asignar miembro: ${error.message}.`)
      }
      return
    }

    const nextMembers = [
      ...projectMembers.filter(item => !(item.projectId === managingProjectId && item.userId === user.id)),
      localMember
    ]
    setProjectMembers(nextMembers)
    setProjectsList(prev => prev.map(project => project.id === managingProjectId ? { ...project, team: nextMembers.filter(item => item.projectId === managingProjectId).length } : project))
    setProjectSyncMessage('Miembro asignado en modo local.')
    setShowProjectMemberModal(false)
  }

  const handleRemoveProjectMember = (userId: string) => {
    if (!managingProjectId) return
    const member = projectMembers.find(item => item.projectId === managingProjectId && item.userId === userId)
    setProjectMemberRemoval(member || { projectId: managingProjectId, userId })
  }

  const confirmRemoveProjectMember = async () => {
    if (!managingProjectId || !projectMemberRemoval?.userId) return
    const userId = projectMemberRemoval.userId
    if (projectsSource === 'backend') {
      try {
        const response = await fetchWithAuth(`${API_BASE}/proyectos/${managingProjectId}/miembros/${userId}`, {
          method: 'DELETE'
        })
        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.detail || `Backend respondió ${response.status}`)
        }
        setProjectSyncMessage('Miembro quitado del proyecto en backend.')
      } catch (error: any) {
        setProjectSyncMessage(`No se pudo quitar miembro: ${error.message}.`)
        return
      }
    }
    const nextMembers = projectMembers.filter(item => !(item.projectId === managingProjectId && item.userId === userId))
    setProjectMembers(nextMembers)
    setProjectsList(prev => prev.map(project => project.id === managingProjectId ? { ...project, team: nextMembers.filter(item => item.projectId === managingProjectId).length } : project))
    setProjectMemberRemoval(null)
  }

  return {
    loadProjectMembers,
    handleAddProjectMember,
    handleSubmitProjectMember,
    handleRemoveProjectMember,
    confirmRemoveProjectMember
  }
}
