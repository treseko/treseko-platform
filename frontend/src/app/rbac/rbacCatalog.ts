import type { CapabilityId, ModuleId } from '../types'

export type RbacCapability = {
  id: CapabilityId
  label: string
}

export type RbacCapabilityGroup = {
  module: ModuleId
  moduleLabel: string
  capabilities: RbacCapability[]
}

export const RBAC_CAPABILITIES: RbacCapabilityGroup[] = [
  { module: 'dashboard', moduleLabel: 'Dashboard', capabilities: [
    { id: 'dashboard.ver', label: 'Ver dashboard' },
    { id: 'dashboard.personalizar', label: 'Personalizar' }
  ] },
  { module: 'ejecutar', moduleLabel: 'Ejecutar Pruebas', capabilities: [
    { id: 'ejecutar.ver', label: 'Ver casos ejecutables' },
    { id: 'ejecutar.manual', label: 'Iniciar manual' },
    { id: 'ejecutar.automatizada', label: 'Iniciar automatizada' },
    { id: 'ejecutar.ia', label: 'Iniciar IA' },
    { id: 'ejecutar.evidencias', label: 'Evidencias' },
    { id: 'ejecutar.historial_build', label: 'Historial de build' }
  ] },
  { module: 'crear_pruebas', moduleLabel: 'Anadir Pruebas', capabilities: [
    { id: 'crear_pruebas.suites', label: 'Suites' },
    { id: 'crear_pruebas.casos', label: 'Casos' },
    { id: 'crear_pruebas.pasos', label: 'Pasos' },
    { id: 'crear_pruebas.versiones', label: 'Versiones' },
    { id: 'crear_pruebas.adjuntos', label: 'Adjuntos de referencia' },
    { id: 'crear_pruebas.scripts', label: 'Scripts automatizados' }
  ] },
  { module: 'automatizacion', moduleLabel: 'Automatizacion', capabilities: [
    { id: 'automatizacion.workers', label: 'Workers' },
    { id: 'automatizacion.jobs', label: 'Jobs' },
    { id: 'automatizacion.funciones', label: 'Funciones reutilizables' },
    { id: 'automatizacion.validacion_scripts', label: 'Validacion de scripts' }
  ] },
  { module: 'proyectos', moduleLabel: 'Proyectos', capabilities: [
    { id: 'proyectos.portfolio', label: 'Portafolio' },
    { id: 'proyectos.componentes', label: 'Componentes' },
    { id: 'proyectos.builds', label: 'Builds' },
    { id: 'proyectos.build_scope', label: 'Alcance build-caso' },
    { id: 'proyectos.equipo', label: 'Equipo' },
    { id: 'proyectos.ambientes', label: 'Ambientes' },
    { id: 'proyectos.datasets', label: 'Datasets' },
    { id: 'proyectos.wiki', label: 'Wiki' }
  ] },
  { module: 'inventario', moduleLabel: 'Inventario', capabilities: [
    { id: 'inventario.ambientes', label: 'Ambientes' },
    { id: 'inventario.dispositivos', label: 'Dispositivos' },
    { id: 'inventario.nodos', label: 'Nodos' },
    { id: 'inventario.categorias', label: 'Categorias' }
  ] },
  { module: 'reportes', moduleLabel: 'Reportes', capabilities: [
    { id: 'reportes.ver', label: 'Ver metricas' },
    { id: 'reportes.exportar', label: 'Exportar' },
    { id: 'reportes.compartir', label: 'Compartir' },
    { id: 'reportes.configurar', label: 'Configurar informes' }
  ] },
  { module: 'bugs', moduleLabel: 'Bug Tracker', capabilities: [
    { id: 'bugs.ver', label: 'Ver bugs' },
    { id: 'bugs.crear', label: 'Crear bugs' },
    { id: 'bugs.editar', label: 'Editar bugs' },
    { id: 'bugs.triage', label: 'Triage y estados' },
    { id: 'bugs.asignar', label: 'Asignar responsables' },
    { id: 'bugs.comentar', label: 'Comentar' },
    { id: 'bugs.adjuntos', label: 'Adjuntar evidencia' },
    { id: 'bugs.vincular_externo', label: 'Vincular tracker externo' },
    { id: 'bugs.exportar', label: 'Exportar markdown' },
    { id: 'bugs.admin', label: 'Administrar bug tracker' }
  ] },
  { module: 'motor_ia', moduleLabel: 'Motor IA', capabilities: [
    { id: 'motor_ia.ver', label: 'Ver estado' },
    { id: 'motor_ia.configuracion', label: 'Configuración' },
    { id: 'motor_ia.workflows', label: 'Workflows' },
    { id: 'motor_ia.logs', label: 'Logs' },
    { id: 'motor_ia.scheduler', label: 'Scheduler' }
  ] },
  { module: 'redmine', moduleLabel: 'Complementos legacy', capabilities: [
    { id: 'redmine.ver', label: 'Ver' },
    { id: 'redmine.configuracion', label: 'Configurar' },
    { id: 'redmine.reportar', label: 'Reportar' },
    { id: 'redmine.vinculos', label: 'Vinculos issue/snapshot' }
  ] },
  { module: 'integraciones', moduleLabel: 'Integraciones', capabilities: [
    { id: 'integraciones.catalogo', label: 'Catálogo' },
    { id: 'integraciones.ver_estado', label: 'Ver estado' },
    { id: 'integraciones.test_conexion', label: 'Probar conexion' },
    { id: 'integraciones.configurar', label: 'Configurar' },
    { id: 'integraciones.secretos', label: 'Gestionar secretos' },
    { id: 'integraciones.webhooks', label: 'Webhooks' },
    { id: 'integraciones.auditoria', label: 'Auditoria' }
  ] },
  { module: 'integraciones', moduleLabel: 'Integraciones / Redmine', capabilities: [
    { id: 'integraciones.provider.redmine.ver', label: 'Ver configuracion Redmine' },
    { id: 'integraciones.provider.redmine.configurar', label: 'Configurar Redmine' },
    { id: 'integraciones.provider.redmine.test_conexion', label: 'Probar conexion Redmine' },
    { id: 'integraciones.provider.redmine.gestionar_secretos', label: 'Gestionar secretos Redmine' },
    { id: 'integraciones.provider.redmine.reportar', label: 'Reportar defectos' },
    { id: 'integraciones.provider.redmine.vincular', label: 'Vincular issue/snapshot' },
    { id: 'integraciones.provider.redmine.deduplicar', label: 'Buscar duplicados' },
    { id: 'integraciones.provider.redmine.webhooks', label: 'Webhooks Redmine' },
    { id: 'integraciones.provider.redmine.auditoria', label: 'Auditoria Redmine' }
  ] },
  { module: 'integraciones', moduleLabel: 'Integraciones / Jira', capabilities: [
    { id: 'integraciones.provider.jira.ver', label: 'Ver configuracion Jira' },
    { id: 'integraciones.provider.jira.configurar', label: 'Configurar Jira' },
    { id: 'integraciones.provider.jira.reportar', label: 'Reportar defectos' },
    { id: 'integraciones.provider.jira.vincular', label: 'Vincular issue/snapshot' },
    { id: 'integraciones.provider.jira.deduplicar', label: 'Buscar duplicados' }
  ] },
  { module: 'integraciones', moduleLabel: 'Integraciones / GitHub Issues', capabilities: [
    { id: 'integraciones.provider.github_issues.ver', label: 'Ver configuracion GitHub Issues' },
    { id: 'integraciones.provider.github_issues.configurar', label: 'Configurar GitHub Issues' },
    { id: 'integraciones.provider.github_issues.reportar', label: 'Reportar issues' },
    { id: 'integraciones.provider.github_issues.vincular', label: 'Vincular issue/snapshot' }
  ] },
  { module: 'plugins', moduleLabel: 'Plugins', capabilities: [
    { id: 'plugins.catalogo', label: 'Catálogo' },
    { id: 'plugins.instalar', label: 'Instalar plugins' },
    { id: 'plugins.desinstalar', label: 'Desinstalar plugins' },
    { id: 'plugins.habilitar', label: 'Habilitar plugins' },
    { id: 'plugins.configurar', label: 'Configurar plugins' },
    { id: 'plugins.gestionar_secretos', label: 'Gestionar secretos' },
    { id: 'plugins.auditoria', label: 'Auditoria plugins' }
  ] },
  { module: 'plugins', moduleLabel: 'Plugins / Providers planificados', capabilities: [
    { id: 'plugins.provider.junit_importer.importar_resultados', label: 'Importar resultados JUnit/XML' },
    { id: 'plugins.provider.excel_importer.importar_casos', label: 'Importar casos desde Excel' },
    { id: 'plugins.provider.custom_dashboard.agregar_widget', label: 'Agregar widget de Dashboard' },
    { id: 'plugins.provider.ai_case_generator.generar_casos', label: 'Generar casos con IA' }
  ] },
  { module: 'notificaciones', moduleLabel: 'Correo del sistema', capabilities: [
    { id: 'notificaciones.ver', label: 'Ver correo del sistema' },
    { id: 'notificaciones.inbox', label: 'Preferencias personales de correo' },
    { id: 'notificaciones.configuracion', label: 'Configuracion SMTP' },
    { id: 'notificaciones.reglas', label: 'Reglas de correo' },
    { id: 'notificaciones.plantillas', label: 'Plantillas de correo' },
    { id: 'notificaciones.auditoria', label: 'Auditoria de entregas' },
    { id: 'notificaciones.admin', label: 'Administracion' }
  ] },
  { module: 'historial', moduleLabel: 'Historial', capabilities: [
    { id: 'historial.ver', label: 'Ver historial' },
    { id: 'historial.detalle', label: 'Detalle' },
    { id: 'historial.evidencias', label: 'Evidencias' }
  ] },
  { module: 'configuracion', moduleLabel: 'Configuración', capabilities: [
    { id: 'configuracion.preferencias', label: 'Preferencias' },
    { id: 'configuracion.perfil', label: 'Mi Perfil' },
    { id: 'configuracion.clientes', label: 'Clientes / Soluciones' },
    { id: 'configuracion.usuarios', label: 'Gestión Usuarios' },
    { id: 'configuracion.roles', label: 'Roles' },
    { id: 'configuracion.integraciones', label: 'Integraciones' },
    { id: 'configuracion.pruebas_ia', label: 'Pruebas con IA' },
    { id: 'configuracion.monitor', label: 'Monitor' },
    { id: 'configuracion.api_keys', label: 'API keys' },
    { id: 'configuracion.sesion', label: 'Sesión y seguridad' },
    { id: 'configuracion.adjuntos', label: 'Adjuntos y evidencias' },
    { id: 'configuracion.licencia', label: 'Licencia' }
  ] }
]

export const CAPABILITY_TO_MODULE = Object.fromEntries(
  RBAC_CAPABILITIES.flatMap(group => group.capabilities.map(capability => [capability.id, group.module]))
) as Record<CapabilityId, ModuleId>
