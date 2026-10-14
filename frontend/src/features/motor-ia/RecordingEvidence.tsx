import { useEffect, useState } from 'react'
import { Alert, Button } from 'react-bootstrap'
import { useI18n } from '../../i18n'
import { API_BASE } from '../../app/constants'
import { EvidenceViewerModal } from '../../shared/components/EvidenceViewerModal'
import { formatDateTime } from '../../shared/utils/dateTime'

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>

function TemporaryRecordingPreview({ reference, fetchWithAuth }: { reference: any; fetchWithAuth: AuthFetch }) {
  const { t } = useI18n()
  const [source, setSource] = useState('')
  const [page, setPage] = useState(0)
  const [deleted, setDeleted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const expired = Boolean(reference.expires_at && Date.parse(reference.expires_at) <= Date.now())
  useEffect(() => {
    if (deleted || expired) return
    const controller = new AbortController()
    let objectUrl = ''
    setSource('')
    setError('')
    void (async () => {
      try {
        const response = await fetchWithAuth(`${API_BASE}/ai-videos/${reference.id}/?page=${page}`, { signal: controller.signal })
        if (!response.ok) throw new Error('unavailable')
        const blob = await response.blob()
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        setSource(objectUrl)
      } catch {
        if (!controller.signal.aborted) setError(t('motorIa.videoUnavailable'))
      }
    })()
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [reference.id, page, deleted, expired, fetchWithAuth, t])
  const remove = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetchWithAuth(`${API_BASE}/ai-videos/${reference.id}/`, { method: 'DELETE' })
      if (!response.ok && response.status !== 404) throw new Error('delete failed')
      setDeleted(true)
      setSource('')
    } catch { setError(t('motorIa.videoDeleteFailed')) }
    finally { setBusy(false) }
  }
  if (deleted) return <Alert variant="secondary" className="small my-2">{t('motorIa.videoDeleted')}</Alert>
  return <section className="border rounded-3 p-3 my-3" aria-label={t('motorIa.executionVideo')}>
    <div className="fw-semibold mb-1">{t('motorIa.executionVideo')}</div>
    <p className="small text-muted mb-2">{t('motorIa.temporaryVideo', { date: formatDateTime(reference.expires_at) })} {t('motorIa.videoKeptOnClose')}</p>
    {error && <Alert variant="warning" className="small">{error}</Alert>}
    {expired ? <Alert variant="secondary" className="small">{t('motorIa.videoUnavailable')}</Alert> : source ? <video controls playsInline preload="metadata" src={source} className="w-100 rounded-2" style={{ maxHeight: 360 }} aria-label={t('motorIa.executionVideo')} /> : !error && <p className="small">{t('motorIa.videoLoading')}</p>}
    {Number(reference.page_count) > 1 && <div className="my-2">{Array.from({ length: Math.min(100, Number(reference.page_count)) }, (_, index) => <Button key={index} size="sm" className="me-1" variant={page === index ? 'primary' : 'outline-primary'} disabled={busy || expired} onClick={() => setPage(index)}>{index + 1}</Button>)}</div>}
    <Button size="sm" variant="outline-danger" disabled={busy} onClick={() => void remove()}>{busy ? t('motorIa.videoDeleting') : t('motorIa.deleteVideo')}</Button>
  </section>
}

export function RecordingEvidence({ reference, status, inlineTemporary = false, fetchWithAuth }: { reference: any; status?: string; inlineTemporary?: boolean; fetchWithAuth?: AuthFetch }) {
  const { t } = useI18n()
  const [open, setOpen] = useState<number | null>(null)
  if (!reference || !/^[a-f0-9-]{36}$/.test(String(reference.id || ''))) return status === 'UNAVAILABLE' ? <Alert variant="warning" className="small my-2">{t('motorIa.videoUnavailable')}</Alert> : null
  if (inlineTemporary && reference.temporary && fetchWithAuth) return <TemporaryRecordingPreview key={reference.id} reference={reference} fetchWithAuth={fetchWithAuth} />
  const expired = reference.expires_at && Date.parse(reference.expires_at) <= Date.now()
  return <div className="my-2">
    {Array.from({ length: Math.max(1, Math.min(100, Number(reference.page_count) || 1)) }, (_, page) => <Button key={page} size="sm" variant="outline-primary" className="me-1" disabled={Boolean(expired)} onClick={() => setOpen(page)}>{t('motorIa.executionVideo')}{page > 0 ? ` · ${page + 1}` : ''}</Button>)}
    {reference.temporary && <span className="small text-muted ms-2">{t('motorIa.temporaryVideo', { date: formatDateTime(reference.expires_at) })}</span>}
    <EvidenceViewerModal evidence={open !== null ? { url: `${API_BASE}/ai-videos/${reference.id}/?page=${open}`, filename: 'execution.webm', contentType: 'video/webm' } : null} onHide={() => setOpen(null)} />
  </div>
}
