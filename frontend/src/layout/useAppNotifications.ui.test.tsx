// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppNotifications } from './useAppNotifications'

afterEach(() => {
  vi.unstubAllGlobals()
})

const options = (enabled: boolean) => ({ enabled, loggedUserId: 'user-1', loggedUserEmail: 'qa@example.test', locale: 'es', t: (key: string) => key })
const stubAuthToken = () => vi.stubGlobal('localStorage', { getItem: () => 'test-token' })

describe('useAppNotifications edition gate', () => {
  it('does not request premium notification endpoints in Community', async () => {
    stubAuthToken()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAppNotifications(options(false)))

    await act(async () => {
      await result.current.loadNotifications()
      await result.current.loadNotificationPreferences()
      await result.current.saveNotificationMute(1)
      await result.current.setNotificationsDisabled(true)
      await result.current.markNotificationRead({ id: 'notification-1' })
      await result.current.markAllNotificationsRead()
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.notifications).toEqual([])
  })

  it('loads notification data when the Premium feature is enabled', async () => {
    stubAuthToken()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
    vi.stubGlobal('fetch', fetchMock)
    renderHook(() => useAppNotifications(options(true)))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      expect.stringContaining('/notifications/inbox/?limit=10'),
      expect.stringContaining('/users/me/notification-preferences/'),
    ])
  })
})
