import type { CapabilityId, ModulePermissionMap, PermissionLevel } from '../types'

const REDMINE_READ = new Set<CapabilityId>([
  'integraciones.provider.redmine.ver',
])

const REDMINE_EDIT = new Set<CapabilityId>([
  'integraciones.provider.redmine.ver',
  'integraciones.provider.redmine.configurar',
  'integraciones.provider.redmine.test_conexion',
  'integraciones.provider.redmine.gestionar_secretos',
  'integraciones.provider.redmine.reportar',
  'integraciones.provider.redmine.vincular',
])

export function getLegacyCapabilityLevel(permissions: ModulePermissionMap, capabilityId: CapabilityId): PermissionLevel {
  const redmineLevel = permissions.redmine
  if (redmineLevel === 'edit' && REDMINE_EDIT.has(capabilityId)) return 'edit'
  if ((redmineLevel === 'read' || redmineLevel === 'edit') && REDMINE_READ.has(capabilityId)) return 'read'
  return 'none'
}
