import {
  BarChart3,
  Bug,
  Code,
  Cpu,
  Folders,
  History,
  LayoutDashboard,
  PlayCircle,
  Plug,
  PlusCircle,
  Server,
  Sliders
} from 'lucide-react'
import type { SidebarItem } from '../layout/AppShell'
import type { ModuleId, ModulePermissionMap, RoleKey } from './types'

export const allSidebarItems: SidebarItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'ejecutar', label: 'Ejecutar Pruebas', icon: PlayCircle },
  { id: 'crear_pruebas', label: 'Añadir Pruebas', icon: PlusCircle },
  { id: 'automatizacion', label: 'Automatización', icon: Code },
  { id: 'proyectos', label: 'Proyectos', icon: Folders },
  { id: 'inventario', label: 'Inventario', icon: Server },
  { id: 'reportes', label: 'Reportes y Métricas', icon: BarChart3 },
  { id: 'bugs', label: 'Bug Tracker', icon: Bug },
  { id: 'motor_ia', label: 'Motor IA', icon: Cpu },
  { id: 'redmine', label: 'Complementos', icon: Plug },
  { id: 'historial', label: 'Historial Runs', icon: History },
  { id: 'configuracion', label: 'Configuración', icon: Sliders }
]

export function createSystemRoleItems(
  getRoleModules: (role: RoleKey) => ModuleId[],
  getRoleAccess: (role: RoleKey) => ModulePermissionMap
) {
  return (['QA_LEAD', 'TESTER', 'VIEWER'] as RoleKey[]).map(role => ({
    id: `system:${role}`,
    name: role,
    description: 'Rol del sistema editable',
    modules: getRoleModules(role),
    permissions: getRoleAccess(role),
    status: 'Activo',
    systemRole: true
  }))
}
