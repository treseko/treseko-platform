// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppWorkspaceView } from './AppWorkspaceView'
import { ADMIN_GUIDE_ACTION_EVENT } from '../features/onboarding/onboardingEvents'

let routedOptions: Record<string, unknown> | undefined

vi.mock('./AppRouteContent', () => ({
  AppRouteContent: ({ options }: { options: Record<string, unknown> }) => {
    routedOptions = options
    return <div data-testid="route-content" />
  },
}))

vi.mock('./AppOverlayStack', () => ({
  AppOverlayStack: () => null,
}))

vi.mock('../layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

afterEach(() => {
  routedOptions = undefined
  cleanup()
})

describe('AppWorkspaceView', () => {
  it('reenvía el cambio de componente a las rutas internas', () => {
    const handleComponentChange = vi.fn()

    render(<AppWorkspaceView options={{
      activeTab: 'proyectos',
      canAccessModule: vi.fn(() => true),
      canRenderActiveModule: true,
      handleComponentChange,
      showWorkspaceAccessGate: false,
      sidebarItems: [],
    }} />)

    expect(routedOptions?.handleComponentChange).toBe(handleComponentChange)
  })

  it('reenvía el estado especializado de los editores API y Chatbot', () => {
    const apiConfig = { schema_version: 'treseko.api-test/v2' }
    const chatbotConfig = { schema_version: 'treseko.chatbot-test/v1' }
    const setNewTestApiConfig = vi.fn()
    const setNewTestChatbotConfig = vi.fn()

    render(<AppWorkspaceView options={{
      activeTab: 'anadir',
      canAccessModule: vi.fn(() => true),
      canRenderActiveModule: true,
      newTestApiConfig: apiConfig,
      newTestChatbotConfig: chatbotConfig,
      setNewTestApiConfig,
      setNewTestChatbotConfig,
      showWorkspaceAccessGate: false,
      sidebarItems: [],
    }} />)

    expect(routedOptions?.newTestApiConfig).toBe(apiConfig)
    expect(routedOptions?.setNewTestApiConfig).toBe(setNewTestApiConfig)
    expect(routedOptions?.newTestChatbotConfig).toBe(chatbotConfig)
    expect(routedOptions?.setNewTestChatbotConfig).toBe(setNewTestChatbotConfig)
  })

  it('lleva la guía de producto al área correcta y al objetivo de creación', () => {
    const handleModuleNavigation = vi.fn()
    const setManagingProjectId = vi.fn()
    const setProjectInnerTab = vi.fn()
    const setConfigTab = vi.fn()

    render(<AppWorkspaceView options={{
      activeTab: 'proyectos',
      canAccessModule: vi.fn(() => true),
      canRenderActiveModule: true,
      currentProjectId: 'project-1',
      currentCompId: 'component-1',
      organizations: [],
      handleModuleNavigation,
      setManagingProjectId,
      setProjectInnerTab,
      setConfigTab,
      showWorkspaceAccessGate: false,
      sidebarItems: [],
    }} />)

    window.dispatchEvent(new CustomEvent(ADMIN_GUIDE_ACTION_EVENT, { detail: { action: 'build' } }))

    expect(handleModuleNavigation).toHaveBeenCalledWith('proyectos')
    expect(setManagingProjectId).toHaveBeenCalledWith('project-1')
    expect(setProjectInnerTab).toHaveBeenCalledWith('components')
  })
})
