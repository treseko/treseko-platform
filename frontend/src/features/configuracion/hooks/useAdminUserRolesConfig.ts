import { useState } from 'react'
import { MODULE_PERMISSIONS, ROLE_ACCESS } from '../../../app/constants'
import { createSystemRoleItems } from '../../../app/navigationModel'
import type { ModulePermissionMap, RoleKey } from '../../../app/types'
import { isValidUUID } from '../../../app/validation'
import { createAdminUserRoleActions } from '../adminUserRoleActions'

type ConfirmAction = (options: { title: string; message: string; variant?: 'danger' | 'warning' | 'info'; confirmLabel?: string; cancelLabel?: string | null }) => Promise<boolean>

type UseAdminUserRolesConfigParams = {
  allowLocalFallback: boolean
  initialAdConfig: any
  initialAppUsers: any[]
  projectsSource: 'local' | 'backend'
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  setProjectSyncMessage: (message: string) => void
  confirmAction: ConfirmAction
}

export function useAdminUserRolesConfig({
  allowLocalFallback,
  initialAdConfig,
  initialAppUsers,
  projectsSource,
  fetchWithAuth,
  setProjectSyncMessage,
  confirmAction,
}: UseAdminUserRolesConfigParams) {
  const [adConfig, setAdConfig] = useState(allowLocalFallback ? initialAdConfig : { enabled: false, server: '', domain: '' })
  const [appUsers, setAppUsers] = useState(allowLocalFallback ? initialAppUsers : [])
  const [customRoles, setCustomRoles] = useState<any[]>([])
  const [systemRoleOverrides, setSystemRoleOverrides] = useState<Partial<Record<RoleKey, ModulePermissionMap>>>(() => {
    try {
      return JSON.parse(localStorage.getItem('qa_system_role_overrides') || '{}')
    } catch {
      return {}
    }
  })
  const [showRoleModal, setShowRoleModal] = useState(false)
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null)
  const [roleForm, setRoleForm] = useState({
    name: '',
    description: '',
    modules: MODULE_PERMISSIONS.VIEWER,
    permissions: ROLE_ACCESS.VIEWER,
    capabilities: {},
    status: 'Activo'
  })
  const [showUserModal, setShowUserModal] = useState(false)
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [userForm, setUserForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'TESTER' as RoleKey,
    roleCustomId: '',
    auth: 'Local',
    status: 'Activo',
    modules: MODULE_PERMISSIONS.TESTER,
    permissions: ROLE_ACCESS.TESTER,
    capabilities: {},
    adLookupVerified: false,
    adLookupUsername: '',
    adLookupGroups: []
  })

  const actions = createAdminUserRoleActions({
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
    confirmAction,
  })
  const assignableUsers = projectsSource === 'backend' ? appUsers.filter(user => isValidUUID(user.id)) : appUsers
  const systemRoleItems = createSystemRoleItems(actions.getRoleModules, actions.getRoleAccess)

  return {
    adConfig,
    setAdConfig,
    appUsers,
    assignableUsers,
    customRoles,
    systemRoleItems,
    showRoleModal,
    setShowRoleModal,
    editingRoleId,
    roleForm,
    setRoleForm,
    showUserModal,
    setShowUserModal,
    editingUserId,
    userForm,
    setUserForm,
    ...actions,
  }
}

export type AdminUserRolesConfigState = ReturnType<typeof useAdminUserRolesConfig>
