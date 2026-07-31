import { useEffect, useState } from 'react'
import { API_BASE } from '../app/constants'

type NotificationOptions = { loggedUserId?: string, loggedUserEmail?: string, locale: string, t: (key: any, values?: any) => string }

export function useAppNotifications({ loggedUserId, loggedUserEmail, locale, t }: NotificationOptions) {
  const [notifications, setNotifications] = useState<any[]>([])
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [notificationPreferences, setNotificationPreferences] = useState<any[]>([])

  const loadNotifications = async () => {
    const token = localStorage.getItem('qa_access_token')
    if (!token) return
    setNotificationsLoading(true)
    try {
      const response = await fetch(`${API_BASE}/notifications/inbox/?limit=10`, { headers: { Authorization: `Bearer ${token}` } })
      if (response.ok) setNotifications(await response.json())
    } catch {
    } finally {
      setNotificationsLoading(false)
    }
  }

  const loadNotificationPreferences = async () => {
    const token = localStorage.getItem('qa_access_token')
    if (!token) return
    try {
      const response = await fetch(`${API_BASE}/users/me/notification-preferences/`, { headers: { Authorization: `Bearer ${token}` } })
      if (response.ok) setNotificationPreferences(await response.json())
    } catch {
    }
  }

  const saveNotificationPreferences = async (nextPreference: any) => {
    const token = localStorage.getItem('qa_access_token')
    if (!token) return
    const otherPreferences = notificationPreferences.filter(item => !(item.event_type === null && item.channel === 'in_app'))
    try {
      const response = await fetch(`${API_BASE}/users/me/notification-preferences/`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([...otherPreferences.map(({ event_type, channel, enabled, frequency, quiet_hours_json }: any) => ({ event_type, channel, enabled, frequency, quiet_hours_json })), nextPreference])
      })
      if (response.ok) setNotificationPreferences(await response.json())
    } catch {
    }
  }

  const saveNotificationMute = (hours: number | null) => saveNotificationPreferences({
    event_type: null,
    channel: 'in_app',
    enabled: true,
    frequency: 'immediate',
    quiet_hours_json: hours ? { mute_until: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString() } : {},
  })

  const setNotificationsDisabled = (disabled: boolean) => saveNotificationPreferences({
    event_type: null,
    channel: 'in_app',
    enabled: !disabled,
    frequency: disabled ? 'never' : 'immediate',
    quiet_hours_json: {},
  })

  const markNotificationRead = async (notification: any) => {
    const token = localStorage.getItem('qa_access_token')
    if (!token || notification?.read_at) return
    try {
      const response = await fetch(`${API_BASE}/notifications/inbox/${notification.id}/read/`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
      if (response.ok) await loadNotifications()
    } catch {
    }
  }

  const markAllNotificationsRead = async () => {
    const token = localStorage.getItem('qa_access_token')
    if (!token) return
    try {
      const response = await fetch(`${API_BASE}/notifications/inbox/read-all/`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
      if (response.ok) await loadNotifications()
    } catch {
    }
  }

  useEffect(() => {
    void loadNotifications()
    void loadNotificationPreferences()
    const timer = window.setInterval(() => { void loadNotifications() }, 60000)
    return () => window.clearInterval(timer)
  }, [loggedUserId, loggedUserEmail])

  const globalInAppPreference = notificationPreferences.find(item => !item.event_type && item.channel === 'in_app')
  const muteUntilValue = globalInAppPreference?.quiet_hours_json?.mute_until
  const muteUntil = muteUntilValue ? new Date(muteUntilValue) : null
  const notificationsDisabled = globalInAppPreference?.enabled === false || globalInAppPreference?.frequency === 'never'
  const notificationsMuted = !!muteUntil && muteUntil.getTime() > Date.now()
  const unreadNotifications = notifications.filter(item => !item.read_at).length
  const notificationTypeLabel = (type?: string) => ({ ADMINISTRATIVA: t('common.notificationAdministrative'), CALIDAD: t('common.notificationQuality'), IA: t('common.notificationAi'), PROYECTO: t('common.notificationProject'), REPORTE: t('common.notificationReport'), SEGURIDAD: t('common.notificationSecurity') }[String(type || '').toUpperCase()] || t('common.notificationGeneral'))
  const notificationVariant = (type?: string) => ({ ADMINISTRATIVA: 'secondary', CALIDAD: 'warning', IA: 'primary', PROYECTO: 'info', REPORTE: 'success', SEGURIDAD: 'danger' }[String(type || '').toUpperCase()] || 'secondary') as any
  const notificationTime = (value?: string) => {
    if (!value) return ''
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(locale === 'en' ? 'en-US' : 'es-AR', { dateStyle: 'short', timeStyle: 'short' })
  }

  return { notifications, notificationsLoading, notificationsDisabled, notificationsMuted, muteUntil, unreadNotifications, notificationTypeLabel, notificationVariant, notificationTime, loadNotifications, loadNotificationPreferences, saveNotificationMute, setNotificationsDisabled, markNotificationRead, markAllNotificationsRead }
}
