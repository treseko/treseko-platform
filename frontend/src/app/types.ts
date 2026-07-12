export type AuthMode = 'local' | 'ad'
export type RoleKey = 'ADMIN' | 'QA_LEAD' | 'TESTER' | 'VIEWER'
export type ModuleId = 'dashboard' | 'ejecutar' | 'crear_pruebas' | 'proyectos' | 'inventario' | 'reportes' | 'bugs' | 'motor_ia' | 'redmine' | 'historial' | 'configuracion' | 'automatizacion' | 'clientes' | 'integraciones' | 'plugins' | 'notificaciones'
export type PermissionLevel = 'none' | 'read' | 'edit'
export type ModulePermissionMap = Partial<Record<ModuleId, Exclude<PermissionLevel, 'none'>>>
export type CoreCapabilityId =
  | 'dashboard.ver' | 'dashboard.personalizar'
  | 'ejecutar.ver' | 'ejecutar.manual' | 'ejecutar.automatizada' | 'ejecutar.ia' | 'ejecutar.evidencias' | 'ejecutar.historial_build'
  | 'crear_pruebas.suites' | 'crear_pruebas.casos' | 'crear_pruebas.pasos' | 'crear_pruebas.versiones' | 'crear_pruebas.adjuntos' | 'crear_pruebas.scripts'
  | 'automatizacion.workers' | 'automatizacion.jobs' | 'automatizacion.funciones' | 'automatizacion.validacion_scripts'
  | 'proyectos.portfolio' | 'proyectos.componentes' | 'proyectos.builds' | 'proyectos.build_scope' | 'proyectos.equipo' | 'proyectos.ambientes' | 'proyectos.datasets' | 'proyectos.wiki'
  | 'inventario.ambientes' | 'inventario.dispositivos' | 'inventario.nodos' | 'inventario.categorias'
  | 'reportes.ver' | 'reportes.exportar' | 'reportes.compartir' | 'reportes.configurar'
  | 'bugs.ver' | 'bugs.crear' | 'bugs.editar' | 'bugs.triage' | 'bugs.asignar' | 'bugs.comentar' | 'bugs.adjuntos' | 'bugs.vincular_externo' | 'bugs.exportar' | 'bugs.admin'
  | 'motor_ia.ver' | 'motor_ia.configuracion' | 'motor_ia.workflows' | 'motor_ia.logs' | 'motor_ia.scheduler'
  | 'redmine.ver' | 'redmine.configuracion' | 'redmine.reportar' | 'redmine.vinculos'
  | 'notificaciones.ver' | 'notificaciones.inbox' | 'notificaciones.configuracion' | 'notificaciones.reglas' | 'notificaciones.plantillas' | 'notificaciones.auditoria' | 'notificaciones.admin'
  | 'historial.ver' | 'historial.detalle' | 'historial.evidencias'
  | 'configuracion.preferencias' | 'configuracion.perfil' | 'configuracion.clientes' | 'configuracion.usuarios' | 'configuracion.roles' | 'configuracion.integraciones' | 'configuracion.pruebas_ia' | 'configuracion.monitor' | 'configuracion.api_keys' | 'configuracion.sesion' | 'configuracion.adjuntos' | 'configuracion.licencia'
  | 'integraciones.catalogo' | 'integraciones.ver_estado' | 'integraciones.test_conexion' | 'integraciones.configurar' | 'integraciones.secretos' | 'integraciones.webhooks' | 'integraciones.auditoria'
  | 'plugins.catalogo' | 'plugins.instalar' | 'plugins.desinstalar' | 'plugins.habilitar' | 'plugins.configurar' | 'plugins.gestionar_secretos' | 'plugins.auditoria'
export type DynamicCapabilityId =
  | `integraciones.provider.${string}.${string}`
  | `plugins.provider.${string}.${string}`
export type CapabilityId = CoreCapabilityId | DynamicCapabilityId
export type CapabilityPermissionMap = Partial<Record<CapabilityId, PermissionLevel>>

export type SessionUser = {
  id?: string
  name: string
  email: string
  role: RoleKey
  roleLabel?: string
  roleCustomId?: string
  auth: AuthMode
  avatar: string
  avatarUrl?: string
  avatarProvider?: string
  personalTheme?: string
  profileSettings?: Record<string, any>
  projectThemeOverrides?: Record<string, any>
  modules: ModuleId[]
  permissions: ModulePermissionMap
  capabilities?: CapabilityPermissionMap
}
