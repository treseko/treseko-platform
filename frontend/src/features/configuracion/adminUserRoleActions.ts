import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { API_BASE, ROLE_ACCESS } from '../../app/constants'
import { mapBackendRoleToItem, mapBackendUserToItem, modulesFromPermissions, modulesFromPermissionsAndCapabilities, permissionsFromModules } from '../../app/mappers'
import type { CapabilityId, CapabilityPermissionMap, ModuleId, ModulePermissionMap, PermissionLevel, RoleKey } from '../../app/types'

type ConfirmAction = (options: { title: string; message: string; variant?: 'danger' | 'warning' | 'info'; confirmLabel?: string; cancelLabel?: string | null }) => Promise<boolean>

type CreateAdminUserRoleActionsParams = {
  appUsers: any[]
  customRoles: any[]
  systemRoleOverrides: Partial<Record<RoleKey, ModulePermissionMap>>
  userForm: any
  roleForm: any
  editingUserId: string | null
  editingRoleId: string | null
  projectsSource: 'local' | 'backend'
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  setEditingUserId: (id: string | null) => void
  setUserForm: Dispatch<SetStateAction<any>>
  setShowUserModal: (show: boolean) => void
  setAppUsers: Dispatch<SetStateAction<any[]>>
  setEditingRoleId: (id: string | null) => void
  setRoleForm: Dispatch<SetStateAction<any>>
  setShowRoleModal: (show: boolean) => void
  setCustomRoles: Dispatch<SetStateAction<any[]>>
  setSystemRoleOverrides: Dispatch<SetStateAction<Partial<Record<RoleKey, ModulePermissionMap>>>>
  setProjectSyncMessage: (message: string) => void
  confirmAction: ConfirmAction
}

export function createAdminUserRoleActions({
  appUsers,
  customRoles,
  systemRoleOverrides,
  userForm,
  roleForm,
  editingUserId,
  editingRoleId,
  projectsSource,
  fetchWithAuth,
  setEditingUserId,
  setUserForm,
  setShowUserModal,
  setAppUsers,
  setEditingRoleId,
  setRoleForm,
  setShowRoleModal,
  setCustomRoles,
  setSystemRoleOverrides,
  setProjectSyncMessage,
  confirmAction
}: CreateAdminUserRoleActionsParams) {
  const loadUsersFromBackend = async () => {
    if (projectsSource !== 'backend') return
    try {
      const response = await fetchWithAuth(`${API_BASE}/usuarios/`)
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      const users = await response.json()
      setAppUsers(users.map(mapBackendUserToItem))
    } catch (error: any) {
      setProjectSyncMessage(`No se pudieron cargar usuarios: ${error.message}.`)
    }
  }

  const loadRolesFromBackend = async () => {
    if (projectsSource !== 'backend') return
    try {
      const response = await fetchWithAuth(`${API_BASE}/roles/`)
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      const roles = await response.json()
      setCustomRoles(roles.map(mapBackendRoleToItem))
    } catch (error: any) {
      setProjectSyncMessage(`No se pudieron cargar roles: ${error.message}.`)
    }
  }

  const stripClientAccessPermission = (permissions: ModulePermissionMap) => {
    const next = { ...permissions }
    delete next.clientes
    return next
  }

  const stripClientAccessModule = (modules: ModuleId[]) => modules.filter(module => module !== 'clientes')

  const getRoleAccess = (role: RoleKey) => systemRoleOverrides[role] || ROLE_ACCESS[role]

  const getRoleModules = (role: RoleKey) => modulesFromPermissions(getRoleAccess(role))

  const openUserModal = (user?: any) => {
    if (user) {
      const baseRole = (user.baseRole || user.role || 'TESTER') as RoleKey
      const validCustomRole = customRoles.find(role => role.id === user.roleCustomId && role.status === 'Activo')
      const validCustomRoleId = validCustomRole?.id || ''
      const rolePermissions = validCustomRole
        ? validCustomRole.permissions || permissionsFromModules(validCustomRole.modules || [])
        : getRoleAccess(baseRole)
      const userPermissions = stripClientAccessPermission(rolePermissions)
      setEditingUserId(user.id)
      setUserForm({
        name: user.name,
        email: user.email,
        password: '',
        role: baseRole,
        roleCustomId: validCustomRoleId,
        auth: user.auth,
        status: user.status,
        modules: stripClientAccessModule(modulesFromPermissionsAndCapabilities(userPermissions, user.capabilities || {})),
        permissions: userPermissions,
        capabilities: user.capabilities || {},
        adLookupVerified: user.auth === 'AD',
        adLookupUsername: '',
        adLookupGroups: [],
        saveError: ''
      })
    } else {
      const defaultPermissions = stripClientAccessPermission(getRoleAccess('TESTER'))
      setEditingUserId(null)
      setUserForm({
        name: '',
        email: '',
        password: '',
        role: 'TESTER',
        roleCustomId: '',
        auth: 'Local',
        status: 'Activo',
        modules: stripClientAccessModule(modulesFromPermissionsAndCapabilities(defaultPermissions, {})),
        permissions: defaultPermissions,
        capabilities: {},
        adLookupVerified: false,
        adLookupUsername: '',
        adLookupGroups: [],
        saveError: ''
      })
    }
    setShowUserModal(true)
  }

  const getUserFormRolePermissions = () => {
    const customRole = userForm.roleCustomId
      ? customRoles.find(role => role.id === userForm.roleCustomId && role.status === 'Activo')
      : null
    return stripClientAccessPermission(
      customRole
        ? customRole.permissions || permissionsFromModules(customRole.modules || [])
        : getRoleAccess(userForm.role)
    )
  }

  const handleUserRoleChange = (role: RoleKey) => {
    const cleanPermissions = stripClientAccessPermission(getRoleAccess(role))
    setUserForm({
      ...userForm,
      role,
      roleCustomId: '',
      modules: stripClientAccessModule(modulesFromPermissionsAndCapabilities(cleanPermissions, {})),
      permissions: cleanPermissions,
      capabilities: {}
    })
  }

  const handleUserCustomRoleChange = (roleId: string) => {
    const role = customRoles.find(item => item.id === roleId)
    if (!role) return
    const cleanPermissions = stripClientAccessPermission(role.permissions || permissionsFromModules(role.modules))
    setUserForm({
      ...userForm,
      role: 'TESTER',
      roleCustomId: role.id,
      modules: stripClientAccessModule(modulesFromPermissionsAndCapabilities(cleanPermissions, role.capabilities || {})),
      permissions: cleanPermissions,
      capabilities: role.capabilities || {}
    })
  }

  const setUserModulePermission = (moduleId: ModuleId, level: PermissionLevel) => {
    const nextPermissions = { ...userForm.permissions }
    if (level === 'none') {
      delete nextPermissions[moduleId]
    } else {
      nextPermissions[moduleId] = level
    }
    setUserForm({
      ...userForm,
      permissions: nextPermissions,
      modules: modulesFromPermissionsAndCapabilities(nextPermissions, userForm.capabilities || {})
    })
  }

  const setUserCapabilityPermission = (capabilityId: CapabilityId, level: PermissionLevel) => {
    const nextCapabilities: CapabilityPermissionMap = { ...(userForm.capabilities || {}) }
    if (level === 'none') {
      nextCapabilities[capabilityId] = 'none'
    } else {
      nextCapabilities[capabilityId] = level
    }
    setUserForm({
      ...userForm,
      capabilities: nextCapabilities,
      modules: modulesFromPermissionsAndCapabilities(userForm.permissions || {}, nextCapabilities)
    })
  }

  const handleSaveUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setUserForm((current: any) => ({ ...current, saveError: '' }))
    if (userForm.auth === 'AD' && !userForm.adLookupVerified) {
      setUserForm((current: any) => ({ ...current, saveError: 'Busca y valida el usuario en Active Directory antes de guardar.' }))
      return
    }
    const cleanPermissions = getUserFormRolePermissions()
    const cleanModules = stripClientAccessModule(modulesFromPermissionsAndCapabilities(cleanPermissions, userForm.capabilities || {}))
    const payload = {
      id: editingUserId || `u${Date.now()}`,
      name: userForm.name,
      email: userForm.email,
      role: userForm.role,
      auth: userForm.auth,
      status: userForm.status,
      modules: cleanModules,
      permissions: cleanPermissions,
      capabilities: userForm.capabilities || {}
    }

    try {
      const response = await fetchWithAuth(editingUserId ? `${API_BASE}/usuarios/${editingUserId}` : `${API_BASE}/usuarios/`, {
        method: editingUserId ? 'PATCH' : 'POST',
        body: JSON.stringify({
          email: userForm.email,
          nombre_completo: userForm.name,
          rol: userForm.role,
          rol_custom_id: userForm.roleCustomId || null,
          auth_provider: userForm.auth === 'AD' ? 'ad' : 'local',
          activo: userForm.status === 'Activo',
          modulos: cleanModules,
          permisos: cleanPermissions,
          permisos_detallados: userForm.capabilities || {},
          ...(userForm.password ? { password: userForm.password } : {})
        })
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      const backendUser = await response.json()
      const mapped = mapBackendUserToItem(backendUser)
      setAppUsers(editingUserId ? appUsers.map(user => user.id === editingUserId ? mapped : user) : [...appUsers, mapped])
      setProjectSyncMessage('Usuario guardado en backend.')
      setShowUserModal(false)
    } catch (error: any) {
      const message = error?.message || 'Error desconocido'
      if (projectsSource !== 'backend') {
        setAppUsers(editingUserId ? appUsers.map(user => user.id === editingUserId ? payload : user) : [...appUsers, payload])
        setShowUserModal(false)
      }
      setUserForm((current: any) => ({ ...current, saveError: message }))
      setProjectSyncMessage(`No se pudo persistir usuario: ${message}.`)
    }
  }

  const handleDeactivateUser = async (user: any) => {
    const confirmed = await confirmAction({
      title: 'Inactivar usuario',
      message: `Se inactivará a ${user.name}.`,
      variant: 'warning',
      confirmLabel: 'Inactivar usuario'
    })
    if (!confirmed) return
    try {
      const response = await fetchWithAuth(`${API_BASE}/usuarios/${user.id}`, { method: 'DELETE' })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      const backendUser = await response.json()
      const mapped = mapBackendUserToItem(backendUser)
      setAppUsers(appUsers.map(item => item.id === user.id ? mapped : item))
      setProjectSyncMessage('Usuario inactivado en backend.')
    } catch (error: any) {
      setAppUsers(appUsers.map(item => item.id === user.id ? { ...item, status: 'Inactivo' } : item))
      setProjectSyncMessage(`No se pudo inactivar usuario en backend: ${error.message}. Cambio aplicado localmente.`)
    }
  }

  const openRoleModal = (role?: any) => {
    if (role) {
      const rolePermissions = stripClientAccessPermission(role.permissions || permissionsFromModules(role.modules || []))
      setEditingRoleId(role.id)
      setRoleForm({
        name: role.name,
        description: role.description,
        modules: stripClientAccessModule(modulesFromPermissionsAndCapabilities(rolePermissions, role.capabilities || {})),
        permissions: rolePermissions,
        capabilities: role.capabilities || {},
        status: role.status
      })
    } else {
      const defaultPermissions = stripClientAccessPermission(ROLE_ACCESS.VIEWER)
      setEditingRoleId(null)
      setRoleForm({
        name: '',
        description: '',
        modules: stripClientAccessModule(modulesFromPermissionsAndCapabilities(defaultPermissions, {})),
        permissions: defaultPermissions,
        capabilities: {},
        status: 'Activo'
      })
    }
    setShowRoleModal(true)
  }

  const setRoleModulePermission = (moduleId: ModuleId, level: PermissionLevel) => {
    const nextPermissions = { ...roleForm.permissions }
    if (level === 'none') {
      delete nextPermissions[moduleId]
    } else {
      nextPermissions[moduleId] = level
    }
    setRoleForm({
      ...roleForm,
      permissions: nextPermissions,
      modules: modulesFromPermissionsAndCapabilities(nextPermissions, roleForm.capabilities || {}),
    })
  }

  const setRoleCapabilityPermission = (capabilityId: CapabilityId, level: PermissionLevel) => {
    const nextCapabilities: CapabilityPermissionMap = { ...(roleForm.capabilities || {}) }
    nextCapabilities[capabilityId] = level
    setRoleForm({
      ...roleForm,
      capabilities: nextCapabilities,
      modules: modulesFromPermissionsAndCapabilities(roleForm.permissions || {}, nextCapabilities)
    })
  }

  const handleSaveRole = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const cleanPermissions = stripClientAccessPermission(roleForm.permissions)
    const cleanModules = stripClientAccessModule(modulesFromPermissionsAndCapabilities(cleanPermissions, roleForm.capabilities || {}))
    if (editingRoleId?.startsWith('system:')) {
      const role = editingRoleId.replace('system:', '') as RoleKey
      const next = { ...systemRoleOverrides, [role]: cleanPermissions }
      setSystemRoleOverrides(next)
      localStorage.setItem('qa_system_role_overrides', JSON.stringify(next))
      const affectedUsers = appUsers.filter((user: any) => user.baseRole === role)
      await Promise.all(affectedUsers.map(user => fetchWithAuth(`${API_BASE}/usuarios/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          modulos: cleanModules,
          permisos: cleanPermissions,
          permisos_detallados: roleForm.capabilities || {}
        })
      })))
      setAppUsers(prev => prev.map((user: any) => user.baseRole === role ? {
        ...user,
        modules: cleanModules,
        permissions: cleanPermissions,
        capabilities: roleForm.capabilities || {}
      } : user))
      setShowRoleModal(false)
      return
    }
    const payload = {
      id: editingRoleId || `role-${Date.now()}`,
      name: roleForm.name,
      description: roleForm.description,
      modules: cleanModules,
      permissions: cleanPermissions,
      capabilities: roleForm.capabilities || {},
      status: roleForm.status
    }
    try {
      const response = await fetchWithAuth(editingRoleId ? `${API_BASE}/roles/${editingRoleId}` : `${API_BASE}/roles/`, {
        method: editingRoleId ? 'PATCH' : 'POST',
        body: JSON.stringify({
          nombre: roleForm.name,
          descripcion: roleForm.description,
          modulos: cleanModules,
          permisos: cleanPermissions,
          permisos_detallados: roleForm.capabilities || {},
          activo: roleForm.status === 'Activo'
        })
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      const backendRole = await response.json()
      const mapped = mapBackendRoleToItem(backendRole)
      setCustomRoles(editingRoleId ? customRoles.map(role => role.id === editingRoleId ? mapped : role) : [...customRoles, mapped])
      setProjectSyncMessage('Rol guardado en backend.')
    } catch (error: any) {
      setCustomRoles(editingRoleId ? customRoles.map(role => role.id === editingRoleId ? payload : role) : [...customRoles, payload])
      setProjectSyncMessage(`No se pudo persistir rol: ${error.message}. Cambio aplicado localmente.`)
    }
    setShowRoleModal(false)
  }

  const handleDeactivateRole = async (role: any) => {
    const confirmed = await confirmAction({
      title: 'Inactivar rol',
      message: `Se inactivará el rol ${role.name}.`,
      variant: 'warning',
      confirmLabel: 'Inactivar rol'
    })
    if (!confirmed) return
    try {
      const response = await fetchWithAuth(`${API_BASE}/roles/${role.id}`, { method: 'DELETE' })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }
      const backendRole = await response.json()
      const mapped = mapBackendRoleToItem(backendRole)
      setCustomRoles(customRoles.map(item => item.id === role.id ? mapped : item))
      setProjectSyncMessage('Rol inactivado en backend.')
    } catch (error: any) {
      setCustomRoles(customRoles.map(item => item.id === role.id ? { ...item, status: 'Inactivo' } : item))
      setProjectSyncMessage(`No se pudo inactivar rol en backend: ${error.message}. Cambio aplicado localmente.`)
    }
  }

  return {
    loadUsersFromBackend,
    loadRolesFromBackend,
    getRoleAccess,
    getRoleModules,
    openUserModal,
    handleUserRoleChange,
    handleUserCustomRoleChange,
    setUserModulePermission,
    setUserCapabilityPermission,
    handleSaveUser,
    handleDeactivateUser,
    openRoleModal,
    setRoleModulePermission,
    setRoleCapabilityPermission,
    handleSaveRole,
    handleDeactivateRole
  }
}
