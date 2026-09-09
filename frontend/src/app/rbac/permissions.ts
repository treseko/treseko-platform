import { ROLE_ACCESS } from '../constants'
import type { CapabilityId, ModuleId, PermissionLevel, SessionUser } from '../types'
import { CAPABILITY_TO_MODULE, RBAC_CAPABILITIES, type CatalogCapabilityId } from './rbacCatalog'
import { getLegacyCapabilityLevel } from './rbacCompat'

/**
 * The session can come from localStorage created by an older frontend or from
 * the backend. Keep the authorization decision stable if the role contains
 * casing/whitespace differences between those sources.
 */
export function isGlobalAdmin(user: Pick<SessionUser, 'role'> | null | undefined) {
  return String(user?.role ?? '').trim().toUpperCase() === 'ADMIN'
}

export function getCapabilityModule(capabilityId: CatalogCapabilityId): ModuleId {
  return CAPABILITY_TO_MODULE[capabilityId]
}

export function getEffectiveCapabilityLevel(user: SessionUser, capabilityId: CatalogCapabilityId): PermissionLevel {
  if (capabilityId === 'configuracion.perfil') return 'edit'
  if (isGlobalAdmin(user)) return 'edit'
  const explicit = (user.capabilities as Record<string, PermissionLevel> | undefined)?.[capabilityId]
  if (explicit) return explicit
  const legacyLevel = getLegacyCapabilityLevel(user.permissions || {}, capabilityId as CapabilityId)
  if (legacyLevel !== 'none') return legacyLevel
  return 'none'
}

export function canAccessCapability(user: SessionUser, capabilityId: CatalogCapabilityId, level: PermissionLevel = 'read') {
  const current = getEffectiveCapabilityLevel(user, capabilityId)
  if (level === 'read') return current === 'read' || current === 'edit'
  if (level === 'edit') return current === 'edit'
  return false
}

export function canAccessModule(user: SessionUser, moduleId: ModuleId, level: PermissionLevel = 'read') {
  if (moduleId === 'bugs' && !canAccessCapability(user, 'bugs.ver', 'read')) return false
  if (moduleId === 'incidencias') {
    // `bugs.ver` is a read-only compatibility path for existing roles. It
    // must never satisfy a future write check for this separate module.
    if (level === 'read' && (
      canAccessCapability(user, 'incidencias.ver', 'read') ||
      canAccessCapability(user, 'bugs.ver', 'read')
    )) return true
    if (level === 'edit' && canAccessCapability(user, 'incidencias.ver', 'edit')) return true
  }
  const current = user.permissions?.[moduleId] || (isGlobalAdmin(user) ? ROLE_ACCESS.ADMIN[moduleId] : undefined)
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
