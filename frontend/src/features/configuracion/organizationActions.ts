import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { API_BASE } from '../../app/constants'
import { mapBackendOrganizationMemberToItem, mapBackendOrganizationToItem } from '../../app/mappers'

type FeedbackVariant = 'success' | 'danger' | 'warning' | 'info'
type ConfirmAction = (options: { title: string; message: string; variant?: 'danger' | 'warning' | 'info'; confirmLabel?: string; cancelLabel?: string | null }) => Promise<boolean>
type LoadOrganizationsOptions = { includeInactive?: boolean }

let organizationsLoadInFlight: Promise<any[]> | null = null
let organizationsLoadCache: { at: number, data: any[] } = { at: 0, data: [] }

type CreateOrganizationActionsParams = {
  projectsSource: 'local' | 'backend'
  organizations: any[]
  selectedOrganizationId: string | null
  organizationMemberForm: any
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  setOrganizations: Dispatch<SetStateAction<any[]>>
  setCurrentOrgId: Dispatch<SetStateAction<string>>
  setSelectedOrganizationId: Dispatch<SetStateAction<string | null>>
  setProjectsList: Dispatch<SetStateAction<any[]>>
  setCurrentProjectId: (projectId: string) => void
  setCurrentCompId: (componentId: string) => void
  setCurrentBuildId: (buildId: string) => void
  setOrganizationMembers: Dispatch<SetStateAction<any[]>>
  setOrganizationMemberForm: Dispatch<SetStateAction<any>>
  setProjectSyncMessage: (message: string) => void
  showFeedback: (title: string, message: string, variant?: FeedbackVariant) => void
  confirmAction: ConfirmAction
}

export function createOrganizationActions({
  projectsSource,
  organizations,
  selectedOrganizationId,
  organizationMemberForm,
  fetchWithAuth,
  setOrganizations,
  setCurrentOrgId,
  setSelectedOrganizationId,
  setProjectsList,
  setCurrentProjectId,
  setCurrentCompId,
  setCurrentBuildId,
  setOrganizationMembers,
  setOrganizationMemberForm,
  setProjectSyncMessage,
  showFeedback,
  confirmAction
}: CreateOrganizationActionsParams) {
  const applyOrganizationSnapshot = (mapped: any[], includeInactive = false) => {
    const activeOrganizations = mapped.filter(org => org.active !== false)
    setOrganizations(mapped)
    setCurrentOrgId(prev => activeOrganizations.some(org => org.id === prev) ? prev : (activeOrganizations[0]?.id || ''))
    setSelectedOrganizationId(prev => {
      if (includeInactive && mapped.some(org => org.id === prev)) return prev
      if (activeOrganizations.some(org => org.id === prev)) return prev
      return activeOrganizations[0]?.id || mapped[0]?.id || ''
    })
    if (activeOrganizations.length === 0) {
      setProjectsList([])
      setCurrentProjectId('')
      setCurrentCompId('')
      setCurrentBuildId('')
    }
  }

  const loadOrganizationsFromBackend = async (options: LoadOrganizationsOptions = {}) => {
    const includeInactive = Boolean(options.includeInactive)
    const now = Date.now()
    if (!includeInactive && projectsSource === 'backend' && organizationsLoadCache.data.length > 0 && now - organizationsLoadCache.at < 3000) {
      applyOrganizationSnapshot(organizationsLoadCache.data, false)
      return organizationsLoadCache.data
    }
    if (!includeInactive && organizationsLoadInFlight) {
      return organizationsLoadInFlight
    }

    organizationsLoadInFlight = (async () => {
    try {
      const url = includeInactive ? `${API_BASE}/organizaciones/?include_inactive=true` : `${API_BASE}/organizaciones/`
      const response = await fetchWithAuth(url)
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }

      const backendOrganizations = await response.json()
      const mapped = backendOrganizations.map(mapBackendOrganizationToItem)
      if (mapped.length > 0) {
        applyOrganizationSnapshot(mapped, includeInactive)
      } else {
        setOrganizations([])
        setCurrentOrgId('')
        setSelectedOrganizationId('')
        setProjectsList([])
        setCurrentProjectId('')
        setCurrentCompId('')
        setCurrentBuildId('')
      }
      if (!includeInactive) organizationsLoadCache = { at: Date.now(), data: mapped }
      return mapped
    } catch (error: any) {
      if (error.message?.includes('403')) {
        setOrganizations([])
        setCurrentOrgId('')
        setSelectedOrganizationId('')
      }
      setProjectSyncMessage(`Modo local: no se pudieron cargar clientes (${error.message || 'backend no disponible'}).`)
      return []
    } finally {
      organizationsLoadInFlight = null
    }
    })()

    return organizationsLoadInFlight
  }

  const handleCreateOrganization = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const target = event.currentTarget
    const formData = new FormData(target)
    const name = String(formData.get('organizationName') || '').trim()
    if (!name) return

    if (projectsSource !== 'backend') {
      const localOrg = { id: `o${Date.now()}`, name, description: '', type: 'Cliente', active: true }
      setOrganizations(prev => [...prev, localOrg])
      setCurrentOrgId(localOrg.id)
      setSelectedOrganizationId(localOrg.id)
      target.reset()
      return
    }

    try {
      const response = await fetchWithAuth(`${API_BASE}/organizaciones/`, {
        method: 'POST',
        body: JSON.stringify({ nombre: name, tipo: 'Cliente' })
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      const org = mapBackendOrganizationToItem(await response.json())
      organizationsLoadCache = { at: 0, data: [] }
      setOrganizations(prev => [...prev, org])
      setCurrentOrgId(org.id)
      setSelectedOrganizationId(org.id)
      target.reset()
    } catch (error: any) {
      showFeedback('No se pudo crear cliente', error.message || 'Error al crear cliente/solución.', 'danger')
    }
  }

  const loadAllOrganizationMembers = async (orgId?: string) => {
    if (projectsSource !== 'backend' || organizations.length === 0) return
    try {
      const targetOrganizations = orgId
        ? organizations.filter(org => org.id === orgId)
        : organizations
      if (targetOrganizations.length === 0) return
      const membersByOrg = await Promise.all(targetOrganizations.map(async org => {
        const response = await fetchWithAuth(`${API_BASE}/organizaciones/${org.id}/miembros/`)
        if (!response.ok) return []
        const members = await response.json()
        return members.map(mapBackendOrganizationMemberToItem)
      }))
      const mappedMembers = membersByOrg.flat()
      if (orgId) {
        setOrganizationMembers(prev => [
          ...prev.filter(member => member.orgId !== orgId),
          ...mappedMembers,
        ])
      } else {
        setOrganizationMembers(mappedMembers)
      }
    } catch (error: any) {
      setProjectSyncMessage(`No se pudieron cargar permisos por cliente: ${error.message}.`)
    }
  }

  const handleUpdateOrganization = async (event: FormEvent<HTMLFormElement>, orgId: string) => {
    event.preventDefault()
    const target = event.currentTarget
    const formData = new FormData(target)
    const name = String(formData.get('organizationName') || '').trim()
    const type = String(formData.get('organizationType') || 'Cliente').trim()
    if (!name) return
    try {
      const response = await fetchWithAuth(`${API_BASE}/organizaciones/${orgId}`, {
        method: 'PATCH',
        body: JSON.stringify({ nombre: name, tipo: type })
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      const org = mapBackendOrganizationToItem(await response.json())
      organizationsLoadCache = { at: 0, data: [] }
      setOrganizations(prev => prev.map(item => item.id === orgId ? org : item))
      setProjectSyncMessage('Cliente actualizado.')
    } catch (error: any) {
      showFeedback('No se pudo editar cliente', error.message || 'Error al actualizar cliente/solución.', 'danger')
    }
  }

  const handleSetOrganizationActive = async (orgId: string, active: boolean) => {
    const organization = organizations.find(item => item.id === orgId)
    if (!active) {
      const confirmed = await confirmAction({
        title: 'Desactivar solución',
        message: `La solución ${organization?.name || 'seleccionada'} dejará de aparecer en la navegación operativa y sus proyectos quedarán inaccesibles para usuarios no administradores.`,
        variant: 'warning',
        confirmLabel: 'Desactivar solución'
      })
      if (!confirmed) return null
    }
    try {
      const response = await fetchWithAuth(`${API_BASE}/organizaciones/${orgId}`, {
        method: 'PATCH',
        body: JSON.stringify({ activo: active })
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      const org = mapBackendOrganizationToItem(await response.json())
      organizationsLoadCache = { at: 0, data: [] }
      setOrganizations(prev => prev.map(item => item.id === orgId ? org : item))
      if (org.active) {
        setSelectedOrganizationId(org.id)
        showFeedback('Solución reactivada', `${org.name} vuelve a estar disponible para la operación.`, 'success')
      } else {
        const nextActiveOrganization = organizations.find(item => item.id !== orgId && item.active !== false)
        if (selectedOrganizationId === orgId) {
          setSelectedOrganizationId(nextActiveOrganization?.id || '')
        }
        setCurrentOrgId(prev => prev === orgId ? (nextActiveOrganization?.id || '') : prev)
        showFeedback('Solución desactivada', `${org.name} quedó oculta de la operación.`, 'warning')
      }
      return org
    } catch (error: any) {
      showFeedback(
        active ? 'No se pudo reactivar la solución' : 'No se pudo desactivar la solución',
        error.message || 'Error al actualizar cliente/solución.',
        'danger'
      )
      return null
    }
  }

  const handleAssignOrganizationMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedOrganizationId || !organizationMemberForm.userId) return
    try {
      const response = await fetchWithAuth(`${API_BASE}/organizaciones/${selectedOrganizationId}/miembros/`, {
        method: 'POST',
        body: JSON.stringify({
          usuario_id: organizationMemberForm.userId,
          rol_cliente: 'MEMBER'
        })
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      const member = mapBackendOrganizationMemberToItem(await response.json())
      setOrganizationMembers(prev => [
        ...prev.filter(item => !(item.orgId === member.orgId && item.userId === member.userId)),
        member
      ])
      setOrganizationMemberForm({ userId: '' })
    } catch (error: any) {
      showFeedback('No se pudo asignar usuario', error.message || 'Error al asignar usuario.', 'danger')
    }
  }

  const handleRemoveOrganizationMember = async (userId: string) => {
    if (!selectedOrganizationId) return
    const confirmed = await confirmAction({
      title: 'Quitar usuario',
      message: 'Se quitará este usuario del cliente seleccionado.',
      variant: 'warning',
      confirmLabel: 'Quitar usuario'
    })
    if (!confirmed) return
    try {
      const response = await fetchWithAuth(`${API_BASE}/organizaciones/${selectedOrganizationId}/miembros/${userId}`, { method: 'DELETE' })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      setOrganizationMembers(prev => prev.filter(item => !(item.orgId === selectedOrganizationId && item.userId === userId)))
    } catch (error: any) {
      showFeedback('No se pudo quitar usuario', error.message || 'Error al quitar usuario.', 'danger')
    }
  }

  return {
    loadOrganizationsFromBackend,
    handleCreateOrganization,
    loadAllOrganizationMembers,
    handleUpdateOrganization,
    handleSetOrganizationActive,
    handleAssignOrganizationMember,
    handleRemoveOrganizationMember
  }
}
