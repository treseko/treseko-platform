import { Bell, BellOff } from 'lucide-react'
import { Badge, Button, Dropdown } from 'react-bootstrap'

type NotificationInboxProps = {
  state: any
  locale: string
  t: (key: any, values?: any) => string
}

export function NotificationInbox({ state, locale, t }: NotificationInboxProps) {
  const {
    notifications, notificationsLoading, notificationsDisabled, notificationsMuted,
    muteUntil, unreadNotifications, notificationTypeLabel, notificationVariant,
    notificationTime, loadNotifications, loadNotificationPreferences,
    saveNotificationMute, setNotificationsDisabled, markNotificationRead,
    markAllNotificationsRead,
  } = state

  return (
    <Dropdown onToggle={(isOpen) => { if (isOpen) { void loadNotifications(); void loadNotificationPreferences() } }}>
      <Dropdown.Toggle variant="link" size="sm" className="p-0 border-0 shadow-none position-relative d-inline-flex align-items-center text-decoration-none" title={t('common.notifications')}>
        {notificationsMuted || notificationsDisabled
          ? <BellOff size={18} className="text-muted cursor-pointer ms-1 hover-text-primary transition-all" />
          : <Bell size={18} className={unreadNotifications ? 'text-primary cursor-pointer ms-1 transition-all' : 'text-muted cursor-pointer ms-1 hover-text-primary transition-all'} />}
        {unreadNotifications > 0 && !notificationsMuted && !notificationsDisabled && <Badge bg="danger" pill className="position-absolute top-0 start-100 translate-middle x-small">{unreadNotifications > 9 ? '9+' : unreadNotifications}</Badge>}
      </Dropdown.Toggle>
      <Dropdown.Menu className="notification-inbox-menu shadow-lg border text-start p-0" align="end">
        <div className="px-3 py-2 border-bottom d-flex justify-content-between align-items-center">
          <div>
            <div className="fw-bold small">{t('common.notifications')}</div>
            <div className="x-small text-muted">
              {notificationsDisabled ? t('common.disabled') : notificationsMuted && muteUntil ? t('common.mutedUntil', { time: muteUntil.toLocaleTimeString(locale === 'en' ? 'en-US' : 'es-AR', { hour: '2-digit', minute: '2-digit' }) }) : t('common.unreadCount', { count: unreadNotifications })}
            </div>
          </div>
          <Button size="sm" variant="link" className="p-0 text-decoration-none" disabled={!unreadNotifications} onClick={markAllNotificationsRead}>{t('common.markRead')}</Button>
        </div>
        <div className="px-3 py-2 border-bottom bg-light">
          <div className="x-small fw-bold text-muted text-uppercase mb-2">{t('common.muteNewNotifications')}</div>
          <div className="d-flex flex-wrap gap-2">
            <Button size="sm" variant="outline-secondary" disabled={notificationsDisabled} onClick={() => saveNotificationMute(1)}>1 h</Button>
            <Button size="sm" variant="outline-secondary" disabled={notificationsDisabled} onClick={() => saveNotificationMute(8)}>8 h</Button>
            <Button size="sm" variant="outline-secondary" disabled={notificationsDisabled} onClick={() => saveNotificationMute(24)}>24 h</Button>
            <Button size="sm" variant={notificationsDisabled ? 'primary' : 'outline-danger'} onClick={() => setNotificationsDisabled(!notificationsDisabled)}>{notificationsDisabled ? t('common.activate') : t('common.deactivate')}</Button>
          </div>
          {notificationsDisabled && <div className="x-small text-muted mt-2">{t('common.noNewNotifications')}</div>}
        </div>
        <div className="notification-inbox-list">
          {notificationsLoading && <div className="px-3 py-3 small text-muted">{t('common.loading')}</div>}
          {!notificationsLoading && notifications.length === 0 && <div className="px-3 py-3 small text-muted">{t('common.noNotifications')}</div>}
          {!notificationsLoading && notifications.map((notification: any) => (
            <button key={notification.id} type="button" className={`notification-inbox-item btn btn-link w-100 text-start text-decoration-none border-bottom rounded-0 px-3 py-2 ${notification.read_at ? 'bg-white text-muted' : 'bg-light text-dark'}`} onClick={() => markNotificationRead(notification)}>
              <div className="d-flex justify-content-between gap-2"><span className="fw-semibold notification-inbox-title">{notification.title}</span>{!notification.read_at && <Badge bg="primary">{t('common.new')}</Badge>}</div>
              <div className="small text-muted notification-inbox-message">{notification.message}</div>
              <div className="notification-inbox-meta">
                <Badge bg={notificationVariant(notification.notification_type)}>{notificationTypeLabel(notification.notification_type)}</Badge>
                {notification.actor_name && <span>{t('common.byActor', { actor: notification.actor_name })}</span>}
                <time dateTime={notification.created_at}>{notificationTime(notification.created_at)}</time>
              </div>
            </button>
          ))}
        </div>
      </Dropdown.Menu>
    </Dropdown>
  )
}
