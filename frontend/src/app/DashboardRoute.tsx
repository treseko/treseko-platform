import { DashboardPage } from '../features/dashboard/DashboardPage'

type DashboardRouteProps = {
  activeTab: string
  currentProjectId: string
  currentBuildId: string
  currentCompId: string
  projectVersion: string
  loggedUser: any
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  showFeedback: (title: string, message: string, variant?: string) => void
  handleLoggedUserPreferencesUpdated: (preferences: any) => void
  canAccessCapability?: (capabilityId: any, level?: any) => boolean
}

export function DashboardRoute(props: DashboardRouteProps) {
  if (props.activeTab !== 'dashboard') return null

  return (
    <DashboardPage
      currentProjectId={props.currentProjectId}
      currentBuildId={props.currentBuildId}
      currentCompId={props.currentCompId}
      projectVersion={props.projectVersion}
      loggedUser={props.loggedUser}
      fetchWithAuth={props.fetchWithAuth}
      showFeedback={props.showFeedback}
      onPreferencesUpdated={props.handleLoggedUserPreferencesUpdated}
      canAccessCapability={props.canAccessCapability}
    />
  )
}
