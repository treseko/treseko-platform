import type { ModuleId } from './types'

type CreateNavigationActionsParams = {
  canAccessModule: (moduleId: ModuleId) => boolean
  loadProjectMetrics: () => Promise<void>
  loadProjectRunHistory: () => Promise<void>
  setActiveTab: (tab: string) => void
  setViewMode: (mode: 'list' | 'manual_exec') => void
  setCaseEditorOpen: (open: boolean) => void
  setEditingCasoMasterId: (masterId: string | null) => void
  setSelectedTest: (test: any) => void
}

export function createNavigationActions({
  canAccessModule,
  loadProjectMetrics,
  loadProjectRunHistory,
  setActiveTab,
  setViewMode,
  setCaseEditorOpen,
  setEditingCasoMasterId,
  setSelectedTest
}: CreateNavigationActionsParams) {
  const handleModuleNavigation = (moduleId: ModuleId) => {
    if (!canAccessModule(moduleId)) return
    setActiveTab(moduleId)
    setViewMode('list')
    if (moduleId === 'crear_pruebas') {
      setCaseEditorOpen(false)
      setEditingCasoMasterId(null)
      setSelectedTest(null)
    }
    if (moduleId === 'reportes') {
      loadProjectMetrics()
    }
    if (moduleId === 'historial') {
      loadProjectRunHistory()
    }
  }

  return {
    handleModuleNavigation
  }
}
