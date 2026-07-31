import { useEffect } from 'react'
import { useLiveRefresh } from '../shared/hooks/useLiveRefresh'

export function useAppSessionBootstrap(options: any) {
  const {
    isAuthenticated, projectsSource, workspacePreferencesHydrated, loggedUser,
    syncSessionFromBackend, setIsAuthenticated, initialBackendLoadKeyRef,
    organizationMembersLoadKeyRef, loadInitialBackendData, projectsLoading,
    projectsList, currentProjectId, currentOrgId, setCurrentProjectId,
    setCurrentOrgId, setSelectedOrganizationId, setCurrentCompId, setCurrentBuildId,
    hydrateProjectContext,
  } = options

  useEffect(() => {
    if (!isAuthenticated) return
    syncSessionFromBackend()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated])

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'qa_session_active' && e.newValue !== 'true') setIsAuthenticated(false)
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [setIsAuthenticated])

  useLiveRefresh({
    enabled: isAuthenticated && projectsSource === 'backend',
    intervalMs: 30000,
    refreshOnFocus: true,
    onRefresh: syncSessionFromBackend,
  })

  useEffect(() => {
    if (!isAuthenticated || !workspacePreferencesHydrated) {
      initialBackendLoadKeyRef.current = ''
      organizationMembersLoadKeyRef.current = ''
      return
    }
    const key = `${loggedUser.id || loggedUser.email}`
    if (initialBackendLoadKeyRef.current === key) return
    initialBackendLoadKeyRef.current = key
    loadInitialBackendData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, workspacePreferencesHydrated, loggedUser.id, loggedUser.email])

  useEffect(() => {
    if (!isAuthenticated || projectsSource !== 'backend' || projectsLoading || projectsList.length === 0) return
    const currentProject = projectsList.find((project: any) => project.id === currentProjectId)
    if (currentProject) return
    const orgProject = projectsList.find((project: any) => project.orgId === currentOrgId)
    const fallbackProject = orgProject || projectsList[0]
    if (!fallbackProject) return
    setCurrentProjectId(fallbackProject.id)
    setCurrentOrgId(fallbackProject.orgId)
    setSelectedOrganizationId(fallbackProject.orgId)
    setCurrentCompId('')
    setCurrentBuildId('')
    void hydrateProjectContext(fallbackProject.id, '', { silent: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, projectsSource, projectsLoading, projectsList, currentProjectId, currentOrgId])
}
