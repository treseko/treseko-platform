import type { AttachmentMeta } from '../EvidenceUpload'
import { dateTimeMs, formatDateTime } from '../shared/utils/dateTime'
import { DEV_ADMIN_EMAIL, MODULE_PERMISSIONS, ROLE_ACCESS } from './constants'
import { CAPABILITY_TO_MODULE } from './rbac/rbacCatalog'
import type { AuthMode, ModuleId, ModulePermissionMap, PermissionLevel, RoleKey, SessionUser } from './types'

export const modulesFromPermissions = (permissions: ModulePermissionMap) =>
  Object.entries(permissions)
    .filter(([, level]) => level === 'read' || level === 'edit')
    .map(([module]) => module as ModuleId)

export const modulesFromPermissionsAndCapabilities = (
  permissions: ModulePermissionMap = {},
  capabilities: Record<string, PermissionLevel> = {}
) => Array.from(new Set([
  ...modulesFromPermissions(permissions),
  ...Object.entries(capabilities)
    .filter(([, level]) => level === 'read' || level === 'edit')
    .map(([capability]) => CAPABILITY_TO_MODULE[capability as keyof typeof CAPABILITY_TO_MODULE])
    .filter(Boolean)
])) as ModuleId[]

export const permissionsFromModules = (modules: ModuleId[], level: Exclude<PermissionLevel, 'none'> = 'read'): ModulePermissionMap =>
  Object.fromEntries(modules.map(module => [module, level])) as ModulePermissionMap

const backendUserPermissions = (user: any) => user.rol === 'ADMIN'
  ? { ...ROLE_ACCESS.ADMIN, ...(user.permisos || {}) }
  : Object.keys(user.permisos || {}).length ? user.permisos : ROLE_ACCESS[user.rol as RoleKey] || ROLE_ACCESS.TESTER

export const getInitials = (nameOrEmail: string) => {
  const source = nameOrEmail.includes('@') ? nameOrEmail.split('@')[0] : nameOrEmail
  return source
    .split(/[.\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'US'
}

export const createSessionUser = (email: string, role: RoleKey = 'ADMIN', auth: AuthMode = 'local', name?: string): SessionUser => ({
  id: email,
  name: name || (email === DEV_ADMIN_EMAIL ? 'Admin QA' : email.split('@')[0]),
  email,
  role,
  roleLabel: role,
  auth,
  avatar: getInitials(name || email),
  avatarProvider: 'gravatar',
  personalTheme: 'system',
  profileSettings: {},
  projectThemeOverrides: {},
  modules: MODULE_PERMISSIONS[role],
  permissions: ROLE_ACCESS[role]
})

export const mapBackendProjectToCard = (project: any, fallbackOrgId: string) => ({
  id: project.id,
  code: project.codigo || '',
  orgId: project.organizacion_id || fallbackOrgId,
  name: project.nombre,
  status: project.estado || (project.activo ? 'Activo' : 'En Pausa'),
  imageUrl: project.imagen_url || '',
  health: 0,
  testsCount: 0,
  runsCount: 0,
  team: 0,
  redmineLinked: false
})

export const mapBackendOrganizationToItem = (org: any) => ({
  id: org.id,
  code: org.codigo || '',
  name: org.nombre,
  description: org.descripcion || '',
  type: org.tipo || 'Cliente',
  active: org.activo !== false
})

export const mapBackendComponentToItem = (component: any) => ({
  id: component.id,
  code: component.codigo || '',
  projectId: component.proyecto_id,
  name: component.nombre,
  description: component.descripcion || '',
  techStack: component.tech_stack || '',
  variables: component.variables || {}
})

export const mapBackendBuildToItem = (build: any) => ({
  id: build.id,
  code: build.codigo || '',
  projectId: build.proyecto_id,
  componentId: build.componente_id || '',
  name: build.nombre,
  changeContext: build.contexto_cambio || '',
  createdAt: build.fecha_creacion ?? null,
  startDate: build.fecha_inicio ?? null,
  endDate: build.fecha_fin ?? null,
  active: build.activo,
  hidden: Boolean(build.oculto)
})

export const sortBuildsNewestFirst = (builds: any[]) => builds.slice().sort((a, b) => {
  const dateA = dateTimeMs(a.startDate) || dateTimeMs(a.endDate) || dateTimeMs(a.createdAt) || 0
  const dateB = dateTimeMs(b.startDate) || dateTimeMs(b.endDate) || dateTimeMs(b.createdAt) || 0
  if (dateA !== dateB) return dateB - dateA
  return String(b.id || '').localeCompare(String(a.id || ''))
})

export const firstUrlFromText = (value?: string) => value?.match(/https?:\/\/\S+/)?.[0] || ''

export const mapBackendEnvironmentToItem = (environment: any) => ({
  id: environment.id,
  projectId: environment.proyecto_id,
  name: environment.nombre,
  url: environment.url,
    status: environment.status || 'Unknown',
    version: environment.version || '',
    active: environment.activo !== false,
    variables: environment.variables || {},
    datasets: Array.isArray(environment.datasets) ? environment.datasets.filter((dataset: any) => dataset.activo !== false).map((dataset: any) => ({
    id: dataset.id,
    environmentId: dataset.entorno_id,
    name: dataset.nombre,
    description: dataset.descripcion || '',
    variables: dataset.variables || {},
    active: dataset.activo !== false,
    isDefault: Boolean(dataset.es_default),
    createdAt: dataset.fecha_creacion || ''
  })) : [],
  lastPing: environment.ultima_verificacion ? formatDateTime(environment.ultima_verificacion) : 'Sin verificacion'
})

export const mapBackendWikiToItem = (page: any) => ({
  id: page.id,
  projectId: page.proyecto_id,
  title: page.titulo,
  content: page.contenido || '',
  lastEditedBy: page.ultima_edicion_por_display || page.ultima_edicion_por || 'Sistema',
  lastEditedAt: page.ultima_actualizacion ? formatDateTime(page.ultima_actualizacion) : '',
  history: Array.isArray(page.history) ? page.history : Array.isArray(page.historial) ? page.historial : []
})

export const mapBackendUserToItem = (user: any) => ({
  id: user.id,
  name: user.nombre_completo || user.email,
  email: user.email,
  role: user.rol_nombre || user.rol,
  baseRole: user.rol,
  roleCustomId: user.rol_custom_id || '',
  auth: user.auth_provider === 'ad' ? 'AD' : 'Local',
  avatarUrl: user.avatar_url || '',
  avatarProvider: user.avatar_provider || 'gravatar',
  status: user.activo ? 'Activo' : 'Inactivo',
  modules: modulesFromPermissionsAndCapabilities(backendUserPermissions(user), user.permisos_detallados || {}),
  permissions: backendUserPermissions(user),
  capabilities: user.permisos_detallados || {}
})

export const mapBackendUserToSession = (user: any): SessionUser => ({
  id: user.id,
  name: user.nombre_completo || user.email,
  email: user.email,
  role: user.rol,
  roleLabel: user.rol_nombre || user.rol,
  roleCustomId: user.rol_custom_id || '',
  auth: user.auth_provider === 'ad' ? 'ad' : 'local',
  avatar: getInitials(user.nombre_completo || user.email),
  avatarUrl: user.avatar_url || '',
  avatarProvider: user.avatar_provider || 'gravatar',
  personalTheme: user.personal_theme || 'system',
  profileSettings: user.profile_settings || {},
  projectThemeOverrides: user.project_theme_overrides || {},
  modules: modulesFromPermissionsAndCapabilities(backendUserPermissions(user), user.permisos_detallados || {}),
  permissions: backendUserPermissions(user),
  capabilities: user.permisos_detallados || {}
})

export const mapBackendRoleToItem = (role: any) => ({
  id: role.id,
  name: role.nombre,
  description: role.descripcion || '',
  permissions: Object.keys(role.permisos || {}).length ? role.permisos : permissionsFromModules(role.modulos || []),
  modules: modulesFromPermissionsAndCapabilities(
    Object.keys(role.permisos || {}).length ? role.permisos : permissionsFromModules(role.modulos || []),
    role.permisos_detallados || {}
  ),
  capabilities: role.permisos_detallados || {},
  status: role.activo ? 'Activo' : 'Inactivo'
})

export const mapBackendProjectMemberToItem = (member: any) => ({
  id: member.id,
  projectId: member.proyecto_id,
  userId: member.usuario_id,
  user: member.usuario ? mapBackendUserToItem(member.usuario) : null
})

export const mapBackendOrganizationMemberToItem = (member: any) => ({
  id: member.id,
  orgId: member.organizacion_id,
  userId: member.usuario_id,
  user: member.usuario ? mapBackendUserToItem(member.usuario) : null
})

const normalizeEditorAttachments = (attachments: AttachmentMeta[] = []) =>
  attachments
    .filter(attachment => attachment?.id)
    .map(attachment => ({
      id: attachment.id,
      filename_original: attachment.filename_original || '',
      content_type: attachment.content_type || ''
    }))
    .sort((a, b) => `${a.id}:${a.filename_original}`.localeCompare(`${b.id}:${b.filename_original}`))

export const buildCaseEditorSnapshot = (values: {
  suiteId: string
  componentId: string
  title: string
  description: string
  pre: string
  post: string
  data: string
  priority: string
  criticality: string
  status: string
  type: string
  script: string
  framework: string
  tags?: string[]
  steps: { action: string, data: string, expected: string, actionImg: string, expectedImg: string, actionAttachments?: AttachmentMeta[], expectedAttachments?: AttachmentMeta[] }[]
}) => JSON.stringify({
  suiteId: values.suiteId || '',
  componentId: values.componentId || '',
  title: values.title || '',
  description: values.description || '',
  pre: values.pre || '',
  post: values.post || '',
  data: values.data || '',
  priority: values.priority || '',
  criticality: values.criticality || '',
  status: values.status || '',
  type: values.type || '',
  script: values.script || '',
  framework: values.framework || '',
  tags: (values.tags || []).map(tag => String(tag || '').trim()).filter(Boolean).sort((a, b) => a.localeCompare(b)),
  steps: values.steps.map(step => ({
    action: step.action || '',
    data: step.data || '',
    expected: step.expected || '',
    actionImg: step.actionImg || '',
    expectedImg: step.expectedImg || '',
    actionAttachments: normalizeEditorAttachments(step.actionAttachments),
    expectedAttachments: normalizeEditorAttachments(step.expectedAttachments)
  }))
})
