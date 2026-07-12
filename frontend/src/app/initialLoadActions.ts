type CreateInitialLoadActionsParams = {
  organizations: any[]
  loadOrganizationsFromBackend: (options?: { includeInactive?: boolean }) => Promise<any[]>
  loadProjectsFromBackend: (organizationsSnapshot?: any[]) => Promise<void>
}

export function createInitialLoadActions({
  organizations,
  loadOrganizationsFromBackend,
  loadProjectsFromBackend
}: CreateInitialLoadActionsParams) {
  const loadInitialBackendData = async () => {
    const loadedOrganizations = await loadOrganizationsFromBackend()
    await loadProjectsFromBackend(loadedOrganizations.length > 0 ? loadedOrganizations : organizations)
  }

  return {
    loadInitialBackendData
  }
}
