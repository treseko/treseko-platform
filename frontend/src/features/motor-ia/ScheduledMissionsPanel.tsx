import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Table } from 'react-bootstrap'
import { API_BASE } from '../../app/constants'
import { useI18n } from '../../i18n'
import { formatDateTime } from '../../shared/utils/dateTime'

export function ScheduledMissionsPanel({ projectId, fetchWithAuth }: { projectId: string; fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response> }) {
  const { t } = useI18n()
  const [rows, setRows] = useState<any[]>([])
  const [error, setError] = useState(false)
  const [pending, setPending] = useState('')
  const [loadedProject, setLoadedProject] = useState('')
  const contextRef = useRef(0)
  const requestRef = useRef(0)
  const cancellingContextRef = useRef<number | null>(null)
  useEffect(() => {
    const context = ++contextRef.current
    let disposed = false
    setRows([])
    setLoadedProject(projectId)
    setError(false)
    setPending('')
    const refresh = async () => {
      if (cancellingContextRef.current === context) return
      const request = ++requestRef.current
      const isCurrent = () => !disposed && contextRef.current === context && requestRef.current === request
      try {
        const response = await fetchWithAuth(`${API_BASE}/proyectos/${projectId}/ai-schedules/`)
        if (!response.ok) throw new Error('Schedules unavailable')
        const result = await response.json()
        if (!Array.isArray(result)) throw new Error('Invalid schedules response')
        if (isCurrent()) { setRows(result); setError(false) }
      } catch { if (isCurrent()) setError(true) }
    }
    void refresh()
    const interval = window.setInterval(() => void refresh(), 5000)
    return () => { disposed = true; contextRef.current++; requestRef.current++; window.clearInterval(interval) }
  }, [projectId, fetchWithAuth])
  const cancel = async (id: string) => {
    const context = contextRef.current
    if (cancellingContextRef.current === context) return
    cancellingContextRef.current = context
    requestRef.current++
    setPending(id)
    try {
      const response = await fetchWithAuth(`${API_BASE}/ai-schedules/${id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('Cancellation failed')
      const result = await response.json()
      if (contextRef.current === context) {
        setRows(previous => previous.map(row => row.id === id ? result : row))
        setError(false)
      }
    } catch { if (contextRef.current === context) setError(true) }
    finally {
      if (cancellingContextRef.current === context) cancellingContextRef.current = null
      if (contextRef.current === context) setPending('')
    }
  }
  return <section className="p-3 border-top">
    <h6>{t('motorIa.savedSchedules')}</h6>
    {error && <Alert variant="warning">{t('motorIa.scheduleLoadFailed')}</Alert>}
    <Table responsive size="sm"><tbody>{(loadedProject === projectId ? rows : []).map(row => <tr key={row.id}>
      <td>{row.nombre}</td><td>{formatDateTime(row.scheduled_at)}</td>
      <td>{row.estado === 'PENDING' ? t('motorIa.statusEnEspera') : row.estado === 'QUEUED' ? t('motorIa.queueWaiting') : row.estado === 'CANCELLED' ? t('motorIa.statusCancelled') : t('motorIa.statusBloqueado')}{row.error_message && <div className="small text-muted">{row.error_message}</div>}</td>
      <td>{row.estado === 'PENDING' && <Button size="sm" variant="outline-danger" disabled={Boolean(pending)} onClick={() => void cancel(row.id)}>{t('common.cancel')}</Button>}</td>
    </tr>)}</tbody></Table>
  </section>
}
