import type { CapabilityId, ModuleId } from '../types'

export type WorkflowCapabilityId =
  | 'motor_ia.workflow_view'
  | 'motor_ia.workflow_execute'
  | 'motor_ia.workflow_drafts'
  | 'motor_ia.workflow_publish'
  | 'motor_ia.workflow_activate'
  | 'motor_ia.workflow_archive'
  | 'motor_ia.workflow_integrations'
  | 'motor_ia.workflow_blocked_reviews'

export type CatalogCapabilityId = CapabilityId | WorkflowCapabilityId

export type RbacCapability = {
  id: CatalogCapabilityId
  label: string
  scope?: 'screen' | 'action' | 'compatibility' | 'reserved'
  route?: string
  impact?: string
  purpose?: string
  status?: 'active' | 'compatibility' | 'reserved'
  compatibility_note?: string
  subsection?: string
}

export type RbacCapabilityGroup = {
  module: ModuleId
  moduleLabel: string
  moduleDescription: string
  capabilities: RbacCapability[]
}

export const RBAC_CAPABILITIES: RbacCapabilityGroup[] = [
  { module: 'dashboard', moduleLabel: 'Dashboard', moduleDescription: 'Vista general del trabajo y del estado de calidad.', capabilities: [
    { id: 'dashboard.ver', label: 'Ver dashboard' },
    { id: 'dashboard.personalizar', label: 'Personalizar' }
  ] },
  { module: 'ejecutar', moduleLabel: 'Ejecución de pruebas', moduleDescription: 'Ejecución manual, automatizada y asistida por IA.', capabilities: [
    { id: 'ejecutar.ver', label: 'Ver casos ejecutables' },
    { id: 'ejecutar.manual', label: 'Iniciar manual' },
    { id: 'ejecutar.automatizada', label: 'Iniciar automatizada' },
    { id: 'ejecutar.ia', label: 'Iniciar IA' },
    { id: 'ejecutar.evidencias', label: 'Evidencias' },
    { id: 'ejecutar.historial_build', label: 'Historial de build' }
  ] },
  { module: 'crear_pruebas', moduleLabel: 'Diseño de pruebas', moduleDescription: 'Suites, casos, pasos, versiones y adjuntos de prueba.', capabilities: [
    { id: 'crear_pruebas.suites', label: 'Suites' },
    { id: 'crear_pruebas.casos', label: 'Casos' },
    { id: 'crear_pruebas.pasos', label: 'Pasos' },
    { id: 'crear_pruebas.versiones', label: 'Versiones' },
    { id: 'crear_pruebas.adjuntos', label: 'Adjuntos de referencia' },
    { id: 'crear_pruebas.scripts', label: 'Scripts automatizados' }
  ] },
  { module: 'automatizacion', moduleLabel: 'Automatización', moduleDescription: 'Workers, jobs y funciones para ejecutar automatizaciones.', capabilities: [
    { id: 'automatizacion.workers', label: 'Workers' },
    { id: 'automatizacion.jobs', label: 'Jobs' },
    { id: 'automatizacion.funciones', label: 'Funciones reutilizables' },
    { id: 'automatizacion.validacion_scripts', label: 'Validacion de scripts' }
  ] },
  { module: 'proyectos', moduleLabel: 'Proyectos y datos', moduleDescription: 'Proyectos, builds, ambientes, datasets, requisitos y documentación.', capabilities: [
    { id: 'proyectos.portfolio', label: 'Portafolio' },
    { id: 'proyectos.componentes', label: 'Componentes' },
    { id: 'proyectos.builds', label: 'Builds' },
    { id: 'proyectos.build_scope', label: 'Alcance build-caso' },
    { id: 'proyectos.equipo', label: 'Equipo' },
    { id: 'proyectos.ambientes', label: 'Ambientes' },
    { id: 'proyectos.datasets', label: 'Datasets' },
    { id: 'proyectos.wiki', label: 'Wiki' }
  ] },
  { module: 'inventario', moduleLabel: 'Inventario técnico', moduleDescription: 'Ambientes, dispositivos, nodos y categorías disponibles.', capabilities: [
    { id: 'inventario.ambientes', label: 'Ambientes' },
    { id: 'inventario.dispositivos', label: 'Dispositivos' },
    { id: 'inventario.nodos', label: 'Nodos' },
    { id: 'inventario.categorias', label: 'Categorias' }
  ] },
  { module: 'reportes', moduleLabel: 'Reportes y métricas', moduleDescription: 'Métricas, cobertura, exportaciones y enlaces compartidos.', capabilities: [
    { id: 'reportes.ver', label: 'Ver metricas' },
    { id: 'reportes.exportar', label: 'Exportar' },
    { id: 'reportes.compartir', label: 'Compartir' },
    { id: 'reportes.configurar', label: 'Configurar informes' }
  ] },
  { module: 'bugs', moduleLabel: 'Gestión de bugs', moduleDescription: 'Registro, análisis, asignación, resolución y seguimiento de bugs.', capabilities: [
    { id: 'bugs.ver', label: 'Ver bugs' },
    { id: 'bugs.crear', label: 'Crear bugs' },
    { id: 'bugs.editar', label: 'Editar bugs' },
    { id: 'bugs.triage', label: 'Triage y estados' },
    { id: 'bugs.asignar', label: 'Asignar responsables' },
    { id: 'bugs.tomar', label: 'Tomar incidencias' },
    { id: 'bugs.resolver', label: 'Resolver incidencias' },
    { id: 'bugs.cerrar', label: 'Cerrar incidencias' },
    { id: 'bugs.comentar', label: 'Comentar' },
    { id: 'bugs.adjuntos', label: 'Adjuntar evidencia' },
    { id: 'bugs.vincular_externo', label: 'Vincular tracker externo' },
    { id: 'bugs.exportar', label: 'Exportar markdown' },
    { id: 'bugs.admin', label: 'Administrar bug tracker' }
  ] },
  { module: 'incidencias', moduleLabel: 'Centro de incidencias', moduleDescription: 'Bandeja operativa para revisar y devolver incidencias a QA.', capabilities: [
    { id: 'incidencias.ver', label: 'Ver centro de incidencias' },
  ] },
  { module: 'motor_ia', moduleLabel: 'Motor de IA', moduleDescription: 'Estado, configuración y workflows de inteligencia artificial.', capabilities: [
    { id: 'motor_ia.ver', label: 'Ver estado' },
    { id: 'motor_ia.configuracion', label: 'Configuración' },
    { id: 'motor_ia.workflows', label: 'Workflows' },
    { id: 'motor_ia.workflow_view', label: 'Ver workflows' },
    { id: 'motor_ia.workflow_execute', label: 'Ejecutar workflows' },
    { id: 'motor_ia.workflow_drafts', label: 'Crear y editar borradores' },
    { id: 'motor_ia.workflow_publish', label: 'Publicar versiones' },
    { id: 'motor_ia.workflow_activate', label: 'Activar workflows' },
    { id: 'motor_ia.workflow_archive', label: 'Archivar workflows' },
    { id: 'motor_ia.workflow_integrations', label: 'Usar agentes externos' },
    { id: 'motor_ia.workflow_blocked_reviews', label: 'Revisar ejecuciones bloqueadas' },
    { id: 'motor_ia.logs', label: 'Logs' },
    { id: 'motor_ia.scheduler', label: 'Scheduler' }
  ] },
  { module: 'redmine', moduleLabel: 'Integración con trackers', moduleDescription: 'Conexión con trackers externos y vínculos de seguimiento.', capabilities: [
    { id: 'redmine.ver', label: 'Ver' },
    { id: 'redmine.configuracion', label: 'Configurar' },
    { id: 'redmine.reportar', label: 'Reportar' },
    { id: 'redmine.vinculos', label: 'Vinculos issue/snapshot' }
  ] },
  { module: 'integraciones', moduleLabel: 'Integraciones externas', moduleDescription: 'Conectores, credenciales, webhooks y auditoría de servicios externos.', capabilities: [
    { id: 'integraciones.catalogo', label: 'Catálogo' },
    { id: 'integraciones.ver_estado', label: 'Ver estado' },
    { id: 'integraciones.test_conexion', label: 'Probar conexion' },
    { id: 'integraciones.configurar', label: 'Configurar' },
    { id: 'integraciones.secretos', label: 'Gestionar secretos' },
    { id: 'integraciones.webhooks', label: 'Webhooks' },
    { id: 'integraciones.auditoria', label: 'Auditoria' }
  ] },
  { module: 'plugins', moduleLabel: 'Complementos instalables', moduleDescription: 'Catálogo y administración de extensiones aprobadas.', capabilities: [
    { id: 'plugins.catalogo', label: 'Catálogo' },
    { id: 'plugins.instalar', label: 'Instalar plugins' },
    { id: 'plugins.desinstalar', label: 'Desinstalar plugins' },
    { id: 'plugins.habilitar', label: 'Habilitar plugins' },
    { id: 'plugins.configurar', label: 'Configurar plugins' },
    { id: 'plugins.gestionar_secretos', label: 'Gestionar secretos' },
    { id: 'plugins.auditoria', label: 'Auditoria plugins' },
    { id: 'plugins.provider.ai_case_generator.generar_casos', label: 'Generar casos con IA' },
    { id: 'plugins.provider.case_portability.importar_casos', label: 'Exportar, importar y revertir casos' }
  ] },
  { module: 'notificaciones', moduleLabel: 'Correo y notificaciones', moduleDescription: 'Preferencias, reglas, plantillas y entregas de correo del sistema.', capabilities: [
    { id: 'notificaciones.ver', label: 'Ver correo del sistema' },
    { id: 'notificaciones.inbox', label: 'Preferencias personales de correo' },
    { id: 'notificaciones.configuracion', label: 'Configuracion SMTP' },
    { id: 'notificaciones.reglas', label: 'Reglas de correo' },
    { id: 'notificaciones.plantillas', label: 'Plantillas de correo' },
    { id: 'notificaciones.auditoria', label: 'Auditoria de entregas' },
    { id: 'notificaciones.admin', label: 'Administracion' }
  ] },
  { module: 'historial', moduleLabel: 'Historial de ejecuciones', moduleDescription: 'Consultas, detalles y evidencias de ejecuciones anteriores.', capabilities: [
    { id: 'historial.ver', label: 'Ver historial' },
    { id: 'historial.detalle', label: 'Detalle' },
    { id: 'historial.evidencias', label: 'Evidencias' }
  ] },
  { module: 'configuracion', moduleLabel: 'Administración y configuración', moduleDescription: 'Usuarios, roles, preferencias, seguridad, licencia y mantenimiento.', capabilities: [
    { id: 'configuracion.preferencias', label: 'Preferencias' },
    { id: 'configuracion.perfil', label: 'Mi Perfil' },
    { id: 'configuracion.clientes', label: 'Clientes / Soluciones' },
    { id: 'configuracion.usuarios', label: 'Gestión Usuarios' },
    { id: 'configuracion.roles', label: 'Roles' },
    { id: 'configuracion.integraciones', label: 'Integraciones' },
    { id: 'configuracion.pruebas_ia', label: 'Pruebas con IA' },
    { id: 'configuracion.monitor', label: 'Monitor' },
    { id: 'configuracion.api_keys', label: 'API keys y credenciales MCP' },
    { id: 'mcp.usar', label: 'Usar MCP' },
    { id: 'configuracion.sesion', label: 'Sesión y seguridad' },
    { id: 'configuracion.adjuntos', label: 'Adjuntos y evidencias' },
    { id: 'settings.evidence_sanitization.manage', label: 'Gestionar sanitizacion de evidencias' },
    { id: 'configuracion.licencia', label: 'Licencia' },
    { id: 'configuracion.actualizaciones', label: 'Actualizaciones' }
  ] }
]

const CONFIG_SUBSECTIONS: Record<string, string> = {
  'configuracion.preferencias': 'Cuenta y preferencias',
  'configuracion.perfil': 'Cuenta y preferencias',
  'configuracion.sesion': 'Cuenta y preferencias',
  'configuracion.clientes': 'Organización y acceso',
  'configuracion.usuarios': 'Organización y acceso',
  'configuracion.roles': 'Organización y acceso',
  'configuracion.integraciones': 'Integraciones y conexiones',
  'configuracion.api_keys': 'Integraciones y conexiones',
  'mcp.usar': 'Integraciones y conexiones',
  'configuracion.pruebas_ia': 'Inteligencia artificial',
  'configuracion.adjuntos': 'Evidencias y archivos',
  'settings.evidence_sanitization.manage': 'Evidencias y archivos',
  'configuracion.monitor': 'Plataforma',
  'configuracion.licencia': 'Plataforma',
  'configuracion.actualizaciones': 'Plataforma',
}

for (const group of RBAC_CAPABILITIES) {
  if (group.module !== 'configuracion') continue
  for (const capability of group.capabilities) {
    capability.subsection = CONFIG_SUBSECTIONS[capability.id]
  }
}

export const CAPABILITY_TO_MODULE = Object.fromEntries(
  RBAC_CAPABILITIES.flatMap(group => group.capabilities.map(capability => [capability.id, group.module]))
) as Record<CatalogCapabilityId, ModuleId>
