import type { SessionUser } from './types'

export type WorkspacePreferences = {
  version?: number
  activeTab?: string
  uri?: string
  currentOrgId?: string
  currentProjectId?: string
  currentCompId?: string
  currentBuildId?: string
  configTab?: string
  managingProjectId?: string
  projectInnerTab?: string
  sidebarCollapsed?: boolean
  collapsedSections?: Record<string, boolean>
}

export type WorkspaceNavigationState = Pick<WorkspacePreferences,
  | 'activeTab'
  | 'currentOrgId'
  | 'currentProjectId'
  | 'currentCompId'
  | 'currentBuildId'
  | 'configTab'
  | 'managingProjectId'
  | 'projectInnerTab'
>

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
  localStorage.setItem(workspacePreferencesKey(user), JSON.stringify({ version: 2, ...preferences }))
}

const URL_KEYS: Array<[keyof WorkspaceNavigationState, string]> = [
  ['activeTab', 'tab'],
  ['currentOrgId', 'org_id'],
  ['currentProjectId', 'project_id'],
  ['currentCompId', 'comp_id'],
  ['currentBuildId', 'build_id'],
  ['configTab', 'config_tab'],
  ['managingProjectId', 'manage_project_id'],
  ['projectInnerTab', 'project_tab'],
]

function readNavigationFromUrl(value: string | URL): WorkspaceNavigationState {
  const url = value instanceof URL ? value : new URL(value, 'http://treseko.local')
  const result: WorkspaceNavigationState = {}
  for (const [field, key] of URL_KEYS) {
    const parameter = url.searchParams.get(key)
    if (parameter !== null) result[field] = parameter
  }
  return result
}

export function navigationFromUrl(value: string) {
  return readNavigationFromUrl(value)
}

export function navigationFromCurrentUri() {
  return navigationFromUrl(window.location.href)
}

export function tabFromCurrentUri() {
  return navigationFromCurrentUri().activeTab || ''
}

export function uriForTab(tab: string) {
  return uriForWorkspaceState({ activeTab: tab })
}

export function uriForWorkspaceState(state: WorkspaceNavigationState, baseUrl = window.location.href) {
  const url = new URL(baseUrl, 'http://treseko.local')
  for (const [field, key] of URL_KEYS) {
    const isConfigurationState = field === 'configTab'
    const isProjectState = field === 'managingProjectId' || field === 'projectInnerTab'
    if (
      (isConfigurationState && state.activeTab !== 'configuracion')
      || (isProjectState && state.activeTab !== 'proyectos')
      || (field === 'projectInnerTab' && !state.managingProjectId)
    ) {
      url.searchParams.delete(key)
      continue
    }
    const value = state[field]
    if (value) url.searchParams.set(key, value)
    else url.searchParams.delete(key)
  }
  return `${url.pathname}${url.search}${url.hash}`
}
