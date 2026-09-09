// @vitest-environment jsdom
import { renderHook, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceNavigation } from './useWorkspaceNavigation'

beforeEach(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function options(authenticated: boolean, capability: string) {
  const values: any = {
    isAuthenticated: authenticated, loggedUser: { id: 'developer' },
    workspacePreferencesHydrated: true, activeTab: '',
    deepLinkBugId: 'bug-21', canAccessModule: () => false,
    canAccessCapability: (name: string) => name === capability,
    workspacePreferencesHydratedRef: { current: '' },
    workspaceNavigationInitializedRef: { current: false },
    workspaceNavigationPathRef: { current: '' },
    deepLinkPermissionNoticeRef: { current: '' },
  }
  for (const key of ['setWorkspacePreferencesHydrated', 'setActiveTab', 'setSidebarCollapsed',
    'setCollapsedSections', 'setConfigTab', 'setProjectInnerTab', 'setManagingProjectId',
    'setCurrentOrgId', 'setSelectedOrganizationId', 'setCurrentProjectId', 'setCurrentCompId',
    'setNewTestComponent', 'setCurrentBuildId', 'setDeepLinkBugId', 'showFeedback', 'consumeDeepLinkBug']) values[key] = vi.fn()
  return values
}

describe('report navigation after login', () => {
  it.each([['incidencias', 'incidencias.ver'], ['bugs', 'bugs.ver']])('opens %s with its own read capability', (tab, capability) => {
    window.history.replaceState(null, '', `/?tab=${tab}&bug_id=bug-21`)
    const initial = options(false, capability)
    const { rerender } = renderHook(props => useWorkspaceNavigation(props), { initialProps: initial })
    expect(initial.setActiveTab).not.toHaveBeenCalled()
    rerender({ ...initial, isAuthenticated: true })
    expect(initial.setActiveTab).toHaveBeenLastCalledWith(tab)
    expect(initial.consumeDeepLinkBug).not.toHaveBeenCalled()
  })

  it('does not grant incidence access from Bug Tracker permission', () => {
    window.history.replaceState(null, '', '/?tab=incidencias&bug_id=bug-21')
    const initial = options(true, 'bugs.ver')
    renderHook(() => useWorkspaceNavigation(initial))
    expect(initial.showFeedback).toHaveBeenCalledOnce()
    expect(initial.consumeDeepLinkBug).toHaveBeenCalledOnce()
    expect(initial.setActiveTab).not.toHaveBeenCalledWith('incidencias')
  })
})
