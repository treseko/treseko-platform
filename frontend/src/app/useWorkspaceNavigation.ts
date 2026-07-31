import { useEffect } from 'react'
import type { ModuleId } from './types'
import { allSidebarItems } from './navigationModel'
import { navigationFromCurrentUri, readWorkspacePreferences, saveWorkspacePreferences, uriForWorkspaceState } from './workspacePreferences'

export function useWorkspaceNavigation(options: any) {
  const {
    isAuthenticated, loggedUser, workspacePreferencesHydrated, setWorkspacePreferencesHydrated,
    workspacePreferencesHydratedRef, workspaceNavigationInitializedRef, workspaceNavigationPathRef,
    canAccessModule, setActiveTab, setSidebarCollapsed, setCollapsedSections, setConfigTab,
    setProjectInnerTab, setManagingProjectId, setCurrentOrgId, setSelectedOrganizationId,
    setCurrentProjectId, setCurrentCompId, setNewTestComponent, setCurrentBuildId,
    deepLinkBugId, setDeepLinkBugId, canAccessCapability, deepLinkPermissionNoticeRef,
    showFeedback, consumeDeepLinkBug, internalReportToken,
    activeTab, currentOrgId, currentProjectId, currentCompId, currentBuildId, configTab,
    managingProjectId, projectInnerTab, sidebarCollapsed, collapsedSections,
  } = options

  useEffect(() => {
    if (!isAuthenticated) {
      workspacePreferencesHydratedRef.current = ''
      workspaceNavigationInitializedRef.current = false
      workspaceNavigationPathRef.current = ''
      setWorkspacePreferencesHydrated(false)
      return
    }
    const userKey = loggedUser.id || loggedUser.email
    if (workspacePreferencesHydratedRef.current === userKey) {
      if (!workspacePreferencesHydrated) setWorkspacePreferencesHydrated(true)
      return
    }
    workspaceNavigationInitializedRef.current = false
    workspaceNavigationPathRef.current = ''
    const preferences = readWorkspacePreferences(loggedUser)
    const urlNavigation = navigationFromCurrentUri()
    const preferredTab = urlNavigation.activeTab || preferences.activeTab
    const preferredAllowed = preferredTab && canAccessModule(preferredTab as ModuleId)
    const fallbackAllowed = allSidebarItems.find((item) => canAccessModule(item.id))?.id || ''
    if (preferredAllowed) setActiveTab(preferredTab)
    else if (fallbackAllowed) setActiveTab(fallbackAllowed)
    const restoredOrgId = urlNavigation.currentOrgId ?? preferences.currentOrgId
    const restoredProjectId = urlNavigation.currentProjectId ?? preferences.currentProjectId
    const restoredCompId = urlNavigation.currentCompId ?? preferences.currentCompId
    const restoredBuildId = urlNavigation.currentBuildId ?? preferences.currentBuildId
    const restoredConfigTab = urlNavigation.configTab ?? preferences.configTab
    const restoredManagingProjectId = urlNavigation.managingProjectId ?? preferences.managingProjectId
    const restoredProjectInnerTab = urlNavigation.projectInnerTab ?? preferences.projectInnerTab
    if (typeof preferences.sidebarCollapsed === 'boolean') setSidebarCollapsed(preferences.sidebarCollapsed)
    if (preferences.collapsedSections && typeof preferences.collapsedSections === 'object') {
      setCollapsedSections((current: any) => ({
        ...current,
        ...Object.fromEntries(Object.entries(preferences.collapsedSections).filter(([, value]) => typeof value === 'boolean')),
      }))
    }
    if (restoredConfigTab) setConfigTab(restoredConfigTab)
    if (restoredProjectInnerTab) setProjectInnerTab(restoredProjectInnerTab)
    if (urlNavigation.managingProjectId !== undefined || preferences.managingProjectId) setManagingProjectId(restoredManagingProjectId || null)
    if (restoredOrgId) {
      setCurrentOrgId(restoredOrgId)
      setSelectedOrganizationId(restoredOrgId)
    }
    if (restoredProjectId) setCurrentProjectId(restoredProjectId)
    if (restoredCompId) {
      setCurrentCompId(restoredCompId)
      setNewTestComponent(restoredCompId)
    }
    if (restoredBuildId) setCurrentBuildId(restoredBuildId)
    workspacePreferencesHydratedRef.current = userKey
    setWorkspacePreferencesHydrated(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, loggedUser.id, loggedUser.email])

  useEffect(() => {
    const urlBugId = new URLSearchParams(window.location.search).get('bug_id') || ''
    const targetBugId = urlBugId || deepLinkBugId
    if (!targetBugId) return
    if (targetBugId !== deepLinkBugId) setDeepLinkBugId(targetBugId)
    if (!isAuthenticated || !workspacePreferencesHydrated) return
    if (!canAccessCapability('bugs.ver', 'read')) {
      if (deepLinkPermissionNoticeRef.current !== targetBugId) {
        deepLinkPermissionNoticeRef.current = targetBugId
        showFeedback('Sin permiso', 'No tienes permiso para ver el detalle de bugs.', 'warning')
      }
      consumeDeepLinkBug()
      return
    }
    setActiveTab('bugs')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, workspacePreferencesHydrated, deepLinkBugId, loggedUser.id, loggedUser.email])

  useEffect(() => {
    if (!isAuthenticated || !workspacePreferencesHydrated || internalReportToken) return
    if (!canAccessModule(activeTab as ModuleId)) return
    const uri = uriForWorkspaceState({ activeTab, currentOrgId, currentProjectId, currentCompId, currentBuildId, configTab, managingProjectId: managingProjectId || '', projectInnerTab })
    saveWorkspacePreferences(loggedUser, { version: 2, activeTab, uri, currentOrgId, currentProjectId, currentCompId, currentBuildId, configTab, managingProjectId: managingProjectId || undefined, projectInnerTab, sidebarCollapsed, collapsedSections })
    const currentUri = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (currentUri !== uri) {
      const navigationPath = uriForWorkspaceState({ activeTab, configTab, managingProjectId: managingProjectId || '', projectInnerTab })
      const shouldCreateHistoryEntry = workspaceNavigationInitializedRef.current && workspaceNavigationPathRef.current !== navigationPath
      const method = shouldCreateHistoryEntry ? 'pushState' : 'replaceState'
      window.history[method](null, '', uri)
      workspaceNavigationPathRef.current = navigationPath
    } else if (!workspaceNavigationPathRef.current) {
      workspaceNavigationPathRef.current = uriForWorkspaceState({ activeTab, configTab, managingProjectId: managingProjectId || '', projectInnerTab })
    }
    workspaceNavigationInitializedRef.current = true
  }, [isAuthenticated, workspacePreferencesHydrated, loggedUser, activeTab, currentOrgId, currentProjectId, currentCompId, currentBuildId, configTab, managingProjectId, projectInnerTab, sidebarCollapsed, collapsedSections])

  return null
}
