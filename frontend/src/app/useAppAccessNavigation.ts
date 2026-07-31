import { useEffect, useMemo } from 'react'
import type { ModuleId } from './types'
import { allSidebarItems } from './navigationModel'
import { navigationFromCurrentUri } from './workspacePreferences'

export function useAppAccessNavigation(options: any) {
  const {
    isAuthenticated, projectsSource, workspacePreferencesHydrated, projectsLoading,
    organizations, loggedUser, activeTab, canAccessModule, canAccessEntitledModule,
    setActiveTab, setConfigTab, setManagingProjectId, setProjectInnerTab,
    setCurrentOrgId, setSelectedOrganizationId, setCurrentProjectId, setCurrentCompId,
    setNewTestComponent, setCurrentBuildId, setViewMode, setCaseEditorOpen,
    setEditingCasoMasterId, setSelectedTest,
  } = options
  const sidebarItems = useMemo(
    () => allSidebarItems.filter((item) => canAccessModule(item.id) && canAccessEntitledModule(item.id)),
    [canAccessModule, canAccessEntitledModule],
  )
  const firstAllowedModuleId = sidebarItems[0]?.id || ''
  const canRenderActiveModule = Boolean(activeTab && canAccessModule(activeTab as ModuleId) && canAccessEntitledModule(activeTab as ModuleId))
  const showWorkspaceAccessGate = isAuthenticated && projectsSource === 'backend' && workspacePreferencesHydrated && !projectsLoading && sidebarItems.length === 0
  const isAdminSession = loggedUser.role === 'ADMIN'
  const hasOrganizationAccess = organizations.length > 0

  useEffect(() => {
    if (!isAuthenticated || !workspacePreferencesHydrated) return
    const handleNavigationPopState = () => {
      const navigation = navigationFromCurrentUri()
      const nextTab = navigation.activeTab || firstAllowedModuleId
      if (nextTab && canAccessModule(nextTab as ModuleId) && canAccessEntitledModule(nextTab as ModuleId)) setActiveTab(nextTab)
      if (nextTab === 'configuracion') setConfigTab((navigation.configTab || 'general') as any)
      if (nextTab === 'proyectos') {
        setManagingProjectId(navigation.managingProjectId || null)
        setProjectInnerTab((navigation.projectInnerTab || 'config') as any)
      }
      if (navigation.currentOrgId !== undefined) {
        setCurrentOrgId(navigation.currentOrgId)
        setSelectedOrganizationId(navigation.currentOrgId)
      }
      if (navigation.currentProjectId !== undefined) setCurrentProjectId(navigation.currentProjectId)
      if (navigation.currentCompId !== undefined) {
        setCurrentCompId(navigation.currentCompId)
        setNewTestComponent(navigation.currentCompId)
      }
      if (navigation.currentBuildId !== undefined) setCurrentBuildId(navigation.currentBuildId)
    }
    window.addEventListener('popstate', handleNavigationPopState)
    return () => window.removeEventListener('popstate', handleNavigationPopState)
  }, [canAccessEntitledModule, canAccessModule, firstAllowedModuleId, isAuthenticated, workspacePreferencesHydrated])

  useEffect(() => {
    if (!isAuthenticated || !workspacePreferencesHydrated || !firstAllowedModuleId) return
    if (activeTab && canAccessModule(activeTab as ModuleId) && canAccessEntitledModule(activeTab as ModuleId)) return
    setActiveTab(firstAllowedModuleId)
    setViewMode('list')
    if (activeTab === 'crear_pruebas') {
      setCaseEditorOpen(false)
      setEditingCasoMasterId(null)
      setSelectedTest(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, workspacePreferencesHydrated, activeTab, firstAllowedModuleId, loggedUser, canAccessEntitledModule])

  return { sidebarItems, firstAllowedModuleId, canRenderActiveModule, showWorkspaceAccessGate, isAdminSession, hasOrganizationAccess }
}
