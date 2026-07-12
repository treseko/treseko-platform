import type { ModuleId, ModulePermissionMap, RoleKey } from './types'

export const API_BASE = '/api'
export const IS_DEV_ENV = import.meta.env.DEV
export const ALLOW_LOCAL_FALLBACK = IS_DEV_ENV && import.meta.env.VITE_ALLOW_LOCAL_FALLBACK === 'true'
export const DEV_ADMIN_EMAIL = IS_DEV_ENV ? 'admin@qa.local' : ''
export const DEV_ADMIN_PASSWORD = IS_DEV_ENV ? (import.meta.env.VITE_DEV_ADMIN_PASSWORD || '') : ''
export const TRESEKO_TELEMETRY_ENDPOINT = 'https://verify.treseko.com/api/telemetry/onboarding'
export const SUITE_COLORS = [
  '#F1F5F9',
  '#E0F2FE',
  '#DBEAFE',
  '#EDE9FE',
  '#F3E8FF',
  '#FCE7F3',
  '#FFE4E6',
  '#FEE2E2',
  '#FFEDD5',
  '#FEF3C7',
  '#ECFCCB',
  '#DCFCE7',
  '#CCFBF1',
  '#CFFAFE',
  '#E5E7EB',
  '#E2E8F0'
]

export const SUITE_ICONS = [
  { id: 'folder', label: 'Carpeta' },
  { id: 'folder-check', label: 'Validación' },
  { id: 'file-check', label: 'Casos' },
  { id: 'shield', label: 'Seguridad' },
  { id: 'bug', label: 'Bugs' },
  { id: 'search', label: 'Exploración' },
  { id: 'globe', label: 'Web' },
  { id: 'smartphone', label: 'Móvil' },
  { id: 'database', label: 'Datos' },
  { id: 'lock', label: 'Acceso' },
  { id: 'zap', label: 'Smoke' },
  { id: 'settings', label: 'Configuración' }
]

export const MODULE_PERMISSIONS: Record<RoleKey, ModuleId[]> = {
  ADMIN: ['dashboard', 'ejecutar', 'crear_pruebas', 'proyectos', 'inventario', 'reportes', 'bugs', 'motor_ia', 'redmine', 'historial', 'configuracion', 'automatizacion', 'clientes', 'integraciones', 'plugins', 'notificaciones'],
  QA_LEAD: ['dashboard', 'ejecutar', 'crear_pruebas', 'proyectos', 'inventario', 'reportes', 'bugs', 'motor_ia', 'historial', 'automatizacion', 'integraciones', 'notificaciones'],
  TESTER: ['dashboard', 'ejecutar', 'crear_pruebas', 'proyectos', 'bugs', 'historial', 'notificaciones'],
  VIEWER: ['dashboard', 'proyectos', 'reportes', 'bugs', 'historial', 'notificaciones']
}

export const ROLE_ACCESS: Record<RoleKey, ModulePermissionMap> = {
  ADMIN: Object.fromEntries(MODULE_PERMISSIONS.ADMIN.map(module => [module, 'edit'])) as ModulePermissionMap,
  QA_LEAD: {
    dashboard: 'read',
    ejecutar: 'edit',
    crear_pruebas: 'edit',
    proyectos: 'edit',
    inventario: 'edit',
    reportes: 'edit',
    bugs: 'edit',
    motor_ia: 'edit',
    historial: 'read',
    automatizacion: 'edit',
    integraciones: 'read',
    notificaciones: 'read'
  },
  TESTER: {
    dashboard: 'read',
    ejecutar: 'edit',
    crear_pruebas: 'edit',
    proyectos: 'read',
    bugs: 'edit',
    historial: 'read',
    notificaciones: 'read'
  },
  VIEWER: {
    dashboard: 'read',
    proyectos: 'read',
    reportes: 'read',
    bugs: 'read',
    historial: 'read',
    notificaciones: 'read'
  }
}
