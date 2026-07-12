import type { SessionUser } from './types'

export type WorkspacePreferences = {
  activeTab?: string
  uri?: string
  currentOrgId?: string
  currentProjectId?: string
  currentCompId?: string
  currentBuildId?: string
}

const PREFIX = 'qa_workspace_preferences'

export function workspacePreferencesKey(user: Pick<SessionUser, 'id' | 'email'>) {
  return `${PREFIX}:${user.id || user.email || 'anonymous'}`
}

export function readWorkspacePreferences(user: Pick<SessionUser, 'id' | 'email'>): WorkspacePreferences {
  try {
    return JSON.parse(localStorage.getItem(workspacePreferencesKey(user)) || '{}') as WorkspacePreferences
  } catch {
    localStorage.removeItem(workspacePreferencesKey(user))
    return {}
  }
}

export function saveWorkspacePreferences(user: Pick<SessionUser, 'id' | 'email'>, preferences: WorkspacePreferences) {
  localStorage.setItem(workspacePreferencesKey(user), JSON.stringify(preferences))
}

export function tabFromCurrentUri() {
  const tab = new URLSearchParams(window.location.search).get('tab')
  return tab || ''
}

export function uriForTab(tab: string) {
  const url = new URL(window.location.href)
  if (tab) url.searchParams.set('tab', tab)
  else url.searchParams.delete('tab')
  return `${url.pathname}${url.search}${url.hash}`
}
