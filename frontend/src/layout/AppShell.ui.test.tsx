// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { I18nProvider } from '../i18n'
import { AppShell } from './AppShell'

vi.mock('./useAppNotifications', () => ({
  useAppNotifications: () => ({
    notifications: [],
    notificationsLoading: false,
    notificationsDisabled: false,
    notificationsMuted: false,
    muteUntil: null,
    unreadNotifications: 0,
    notificationTypeLabel: () => '',
    notificationVariant: () => 'secondary',
    notificationTime: () => '',
    loadNotifications: vi.fn(),
    loadNotificationPreferences: vi.fn(),
    saveNotificationMute: vi.fn(),
    setNotificationsDisabled: vi.fn(),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
  }),
}))

vi.mock('./NotificationInbox', () => ({ NotificationInbox: () => null }))

afterEach(cleanup)

const baseProps = {
  children: <div>Contenido</div>,
  sidebarCollapsed: false,
  setSidebarCollapsed: vi.fn(),
  sidebarItems: [{ id: 'dashboard', label: 'Dashboard', icon: () => <span /> }],
  activeTab: 'dashboard',
  onModuleNavigation: vi.fn(),
  organizations: [],
  currentOrgId: '',
  onOrgChange: vi.fn(),
  loggedUser: { id: 'user-1', email: 'user@example.com', name: 'User', avatar: 'U', role: 'VIEWER', roleLabel: 'Viewer' },
  onLogout: vi.fn(),
  projectsList: [],
  currentProjectId: '',
  onProjectChange: vi.fn(),
  componentsList: [],
  currentCompId: '',
  onComponentChange: vi.fn(),
  buildsList: [],
  currentBuildId: '',
  sortBuildsNewestFirst: (builds: any[]) => builds,
  onBuildChange: vi.fn(),
  canAccessConfig: false,
} as unknown as ComponentProps<typeof AppShell>

describe('AppShell mobile drawer', () => {
  it('opens as a modal, focuses close, closes on Escape and restores the trigger focus', async () => {
    render(<I18nProvider><AppShell {...baseProps} /></I18nProvider>)
    const trigger = screen.getByRole('button', { name: /Open menu|Abrir menú/ })
    fireEvent.click(trigger)
    const drawer = screen.getByRole('dialog')

    await waitFor(() => expect(document.activeElement).toBe(drawer.querySelector('button[aria-label]')))
    expect(drawer).toHaveAttribute('aria-modal', 'true')
    expect(drawer).toHaveAttribute('aria-labelledby', 'app-mobile-drawer-title')

    fireEvent.keyDown(drawer, { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    expect(drawer).toHaveAttribute('aria-hidden', 'true')
  })
})
