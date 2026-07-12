import { ROLE_ACCESS } from '../constants'
import type { CapabilityId, ModuleId, PermissionLevel, SessionUser } from '../types'
import { CAPABILITY_TO_MODULE, RBAC_CAPABILITIES } from './rbacCatalog'
import { getLegacyCapabilityLevel } from './rbacCompat'

export function getCapabilityModule(capabilityId: CapabilityId): ModuleId {
  return CAPABILITY_TO_MODULE[capabilityId]
}

export function getEffectiveCapabilityLevel(user: SessionUser, capabilityId: CapabilityId): PermissionLevel {
  if (user.role === 'ADMIN') return 'edit'
  const explicit = user.capabilities?.[capabilityId]
  if (explicit) return explicit
  const legacyLevel = getLegacyCapabilityLevel(user.permissions || {}, capabilityId)
  if (legacyLevel !== 'none') return legacyLevel
  return 'none'
}

export function canAccessCapability(user: SessionUser, capabilityId: CapabilityId, level: PermissionLevel = 'read') {
  const current = getEffectiveCapabilityLevel(user, capabilityId)
  if (level === 'read') return current === 'read' || current === 'edit'
  if (level === 'edit') return current === 'edit'
  return false
}

export function canAccessModule(user: SessionUser, moduleId: ModuleId, level: PermissionLevel = 'read') {
  const current = user.permissions?.[moduleId] || (user.role === 'ADMIN' ? ROLE_ACCESS.ADMIN[moduleId] : undefined)
  const moduleMatch = level === 'read' ? current === 'read' || current === 'edit' : current === 'edit'
  if (moduleMatch) return true
  if (level !== 'read') return false
  if (moduleId === 'configuracion') {
    const hasNotificationSettings = RBAC_CAPABILITIES
      .filter(item => item.module === 'notificaciones')
      .some(group => group.capabilities.some(capability => canAccessCapability(user, capability.id, 'read')))
    if (hasNotificationSettings) return true
  }
  return RBAC_CAPABILITIES
    .filter(item => item.module === moduleId)
    .some(group => group.capabilities.some(capability => canAccessCapability(user, capability.id, 'read')))
}

export function getVisibleCapabilitiesForUser(user: SessionUser) {
  return RBAC_CAPABILITIES.flatMap(group =>
    group.capabilities.filter(capability => canAccessCapability(user, capability.id, 'read'))
  )
}
