import { useEffect, useState } from 'react'
import { ChevronDown, Link2 } from 'lucide-react'
import { Button, Card, Form, OverlayTrigger, Tooltip } from 'react-bootstrap'
import { useI18n } from '../../i18n'
import { API_BASE } from '../../app/constants'

export function CaseTraceabilitySection({
  projectId, masterId, fetchWithAuth, storyIds, setStoryIds, editable = true, canConfirmRevision = true, showFeedback,
}: any) {
  const { t } = useI18n()
  const [stories, setStories] = useState<any[]>([])
  const [linked, setLinked] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [reviewingStoryId, setReviewingStoryId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const refreshMessage = (title: string, message: string, variant: 'success' | 'danger' = 'danger') => {
    if (typeof showFeedback === 'function') {
      showFeedback(title, message, variant)
      return
    }
    setActionError(message)
    if (variant === 'success') {
      window.setTimeout(() => setActionError(null), 2500)
    }
  }

  useEffect(() => {
    if (!projectId || !fetchWithAuth) return
    let active = true
    setLoading(true)
    Promise.all([
      fetchWithAuth(`${API_BASE}/proyectos/${projectId}/historias/`).then((response: Response) => response.ok ? response.json() : []),
      masterId ? fetchWithAuth(`${API_BASE}/casos/${masterId}/historias/`).then((response: Response) => response.ok ? response.json() : []) : Promise.resolve([]),
    ]).then(([available, current]) => {
      if (!active) return
      setStories(Array.isArray(available) ? available : [])
      setLinked(Array.isArray(current) ? current : [])
      if (masterId && !storyIds.length) setStoryIds((Array.isArray(current) ? current : []).map((item: any) => String(item.historia_id)))
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, masterId, fetchWithAuth])

  const linkedById = new Map(linked.map((item: any) => [String(item.historia_id), item]))
  const toggle = (id: string) => setStoryIds(storyIds.includes(id) ? storyIds.filter((item: string) => item !== id) : [...storyIds, id])
  const pendingReviewCount = Array.from(linkedById.values()).filter((item: any) => item?.requiere_revision).length
  const renderReviewIcon = (count?: number, contextId?: string) => {
    const pending = Number.isFinite(count) && count > 0 ? count : 1
    const message = pending === 1 ? t('casos.pendingReview') : t('casos.pendingReviewCount', { count: pending })
    const tooltipId = `story-review-indicator-${contextId ?? 'case'}`

    return (
      <OverlayTrigger placement="top" overlay={<Tooltip id={tooltipId}>{message}</Tooltip>}>
        <span
          className="d-inline-flex align-items-center justify-content-center rounded-circle bg-warning-subtle text-warning-emphasis border border-warning-subtle"
          style={{ width: 16, height: 16, fontSize: 12, fontWeight: 700, lineHeight: 1 }}
          role="img"
          aria-label={message}
          title={message}
        >
          !
        </span>
      </OverlayTrigger>
    )
  }

  return (
    <Card className="border rounded-2 bg-white text-start mb-2 overflow-hidden">
      <button
        type="button"
        className="bg-light border-0 border-bottom w-100 py-1 px-2 d-flex align-items-center gap-2 text-start"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <Link2 size={18} className="text-primary" />
        <span className="small fw-semibold text-dark">{t('casos.traceability')}</span>
        {pendingReviewCount > 0 && renderReviewIcon(pendingReviewCount, `traceability-${masterId ?? 'new'}`)}
        <span className="ms-auto d-flex align-items-center gap-2">
          {!loading && <span className="x-small text-muted">{storyIds.length} {t('casos.linked')}</span>}
          <ChevronDown size={15} className="text-muted" style={{ transform: expanded ? 'rotate(180deg)' : undefined, transition: 'transform 120ms ease' }} />
        </span>
      </button>
      {expanded && <Card.Body className="p-2">
        {loading ? <span className="small text-muted">{t('casos.loadingStories')}</span> : stories.length === 0 ? <span className="small text-muted">{t('casos.noActiveStories')}</span> : (
          <div className="d-flex flex-column gap-2">
            {actionError && <div className="small text-danger">{actionError}</div>}
            {stories.map((story) => {
              const id = String(story.id)
              const current = linkedById.get(id)
              return <div key={id} className="border rounded-2 p-2 d-flex gap-2 align-items-start">
                <Form.Check aria-label={t('casos.linkStory', { code: story.codigo })} checked={storyIds.includes(id)} disabled={!editable} onChange={() => toggle(id)} className="mt-1" />
                <div className="flex-grow-1 min-w-0">
                  <div className="small fw-bold text-primary">{story.codigo} · {story.titulo}</div>
                  <div className="x-small text-muted">{story.requisito_codigo} · {story.requisito_titulo}</div>
                  {current?.requiere_revision && (
                    <div className="x-small text-warning-emphasis mt-1 d-flex align-items-center gap-1">
                      {renderReviewIcon(1, id)}
                    </div>
                  )}
                </div>
                {current?.requiere_revision && masterId && editable && canConfirmRevision && <Button size="sm" variant="outline-warning" title={t('casos.confirmReview')} disabled={reviewingStoryId === id} onClick={async () => {
                  setReviewingStoryId(id)
                  setActionError(null)
                  try {
                    const response = await fetchWithAuth(`${API_BASE}/casos/${masterId}/historias/${id}/confirmar-revision`, { method: 'POST' })
                    if (!response.ok) {
                      const error = await response.json().catch(() => null)
                      throw new Error(error?.detail || t('casos.confirmReviewHttpFailed', { status: response.status }))
                    }
                    const body = await response.json()
                    setLinked(Array.isArray(body) ? body : [])
                    refreshMessage(t('casos.reviewConfirmed'), t('casos.storyMarkedReviewed'), 'success')
                  } catch (error: any) {
                    setActionError(error?.message || t('casos.confirmReviewFailed'))
                    refreshMessage(t('casos.confirmReviewFailed'), error?.message || t('casos.confirmReviewFailed'), 'danger')
                  } finally {
                    setReviewingStoryId(null)
                  }
                }}> {reviewingStoryId === id ? t('casos.confirming') : t('casos.reviewed')}</Button>}
                {current?.requiere_revision && masterId && editable && !canConfirmRevision && (
                  <div className="small text-muted">{t('casos.noPermissionToConfirm')}</div>
                )}
              </div>
            })}
          </div>
        )}
      </Card.Body>}
    </Card>
  )
}
