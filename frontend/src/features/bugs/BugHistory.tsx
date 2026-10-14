import { useEffect, useState } from 'react'
import { Button, Spinner } from 'react-bootstrap'
import { API_BASE } from '../../app/constants'
import { formatDateTime } from '../../shared/utils/dateTime'
import { apiErrorMessage } from './bugTrackerHelpers'
import { createBugLocalizedLabels } from './bugPresentation'

export function BugHistory({ bug, users, fetchWithAuth, t }: any) {
  const [events, setEvents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const { status } = createBugLocalizedLabels(t)
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(''); setEvents([])
    void (async () => {
      try {
        const response = await fetchWithAuth(`${API_BASE}/bugs/${bug.id}/history/`)
        if (!response.ok) throw new Error(await apiErrorMessage(response))
        const payload = await response.json()
        if (!cancelled) setEvents(payload)
      } catch (cause: any) { if (!cancelled) setError(cause.message || t('bugs.historyError')) }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
    // The fetch wrapper is recreated by the application; reload for persisted changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bug.id, bug.estado, bug.updated_at, retry])
  if (loading) return <div role="status"><Spinner size="sm" /> {t('bugs.loadingHistory')}</div>
  if (error) return <div role="alert" className="alert alert-danger">{error}<Button size="sm" variant="outline-danger" className="ms-2" onClick={() => setRetry(value => value + 1)}>{t('bugs.retry')}</Button></div>
  if (!events.length) return <p className="text-muted">{t('bugs.noHistory')}</p>
  return <ol className="bug-history list-unstyled">
    {events.map(event => {
      const actor = users.find((user: any) => String(user.id) === String(event.actor_id))
      const actorName = actor?.name || actor?.nombre_completo || actor?.email || t(event.actor_id ? 'bugs.unknownUser' : 'bugs.systemAuthor')
      return <li className="border-start border-3 ps-3 py-2 mb-2" key={event.id}>
        <div className="fw-semibold">{event.from_status ? `${status(event.from_status)} → ` : ''}{status(event.to_status)}</div>
        <div className="small text-muted">{actorName} · {formatDateTime(event.occurred_at)}{event.build_name || event.build_code ? ` · ${event.build_name || event.build_code}` : ''}</div>
        {(event.resolution || event.close_reason) && <div className="small white-space-pre-wrap text-break mt-1">{event.resolution || event.close_reason}</div>}
      </li>
    })}
  </ol>
}
