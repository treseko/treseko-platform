import { useEffect, useRef, useState } from 'react'
import { Button, Form, Modal, Spinner } from 'react-bootstrap'
import { API_BASE } from '../../app/constants'
import { apiErrorMessage } from './bugTrackerHelpers'
import { useI18n } from '../../i18n'

export function BugDuplicateModal({ bug, fetchWithAuth, onClose, onSaved, searchInIncidentCenter = false }: any) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<any[]>([])
  const [originalId, setOriginalId] = useState('')
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const sequence = useRef(0)
  const search = async (suggested = false) => {
    if (!bug) return
    const request = ++sequence.current
    setLoading(true); setError(''); setOriginalId(''); setCandidates([])
    try {
      const params = new URLSearchParams({ q: suggested ? String(bug.titulo).slice(0, 200) : query.trim().slice(0, 200), limit: '25' })
      if (!suggested && !query.trim()) { setLoading(false); return }
      const url = searchInIncidentCenter ? `${API_BASE}/incidencias/centro/?proyecto_id=${bug.proyecto_id}&${params}` : suggested ? `${API_BASE}/proyectos/${bug.proyecto_id}/bugs/dedupe-suggestions/?${params}` : `${API_BASE}/proyectos/${bug.proyecto_id}/bugs/?${params}`
      const response = await fetchWithAuth(url)
      if (!response.ok) throw new Error(await apiErrorMessage(response))
      const payload = await response.json()
      if (request !== sequence.current) return
      const items = suggested && !searchInIncidentCenter ? payload.map((item: any) => item.bug) : payload.items || []
      setCandidates(items.filter((item: any) => item.id !== bug.id && !item.duplicate_of_id && item.estado !== 'DUPLICADO'))
    } catch (cause: any) { if (request === sequence.current) setError(cause.message || t('bugs.duplicateError')) }
    finally { if (request === sequence.current) setLoading(false) }
  }
  useEffect(() => {
    setQuery(''); setOriginalId(''); setComment(''); setError(''); setCandidates([])
    if (bug) void search(true)
    return () => { sequence.current++ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bug?.id])
  const save = async () => {
    if (!originalId || saving) return
    setSaving(true); setError('')
    try {
      const response = await fetchWithAuth(`${API_BASE}/bugs/${bug.id}/mark-duplicate/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duplicate_of_id: originalId, comentario: comment.trim() || null }),
      })
      if (!response.ok) throw new Error(await apiErrorMessage(response))
      await onSaved(await response.json())
    } catch (cause: any) { setError(cause.message || t('bugs.duplicateError')) }
    finally { setSaving(false) }
  }
  return <Modal show={Boolean(bug)} onHide={() => !saving && onClose()} centered>
    <Modal.Header closeButton={!saving}><Modal.Title>{t('bugs.markDuplicate')}</Modal.Title></Modal.Header>
    <Modal.Body>
      <p className="small">{t('bugs.duplicateHelp', { bug: bug?.codigo || '' })}</p>
      <Form onSubmit={event => { event.preventDefault(); void search() }} className="d-flex gap-2 mb-3">
        <Form.Control aria-label={t('bugs.searchOriginal')} placeholder={t('bugs.searchOriginal')} maxLength={200} value={query} onChange={event => setQuery(event.target.value)} disabled={saving} />
        <Button type="submit" disabled={loading || saving || !query.trim()}>{t('bugs.search')}</Button>
      </Form>
      {error && <div role="alert" className="alert alert-danger">{error}</div>}
      {loading ? <div role="status"><Spinner size="sm" /> {t('bugs.loading')}</div> : <>
        <Form.Label htmlFor="bug-duplicate-original">{t('bugs.originalBug')}</Form.Label>
        <Form.Select id="bug-duplicate-original" value={originalId} onChange={event => setOriginalId(event.target.value)} disabled={saving}>
          <option value="">{t('bugs.selectOriginal')}</option>
          {candidates.map(item => <option key={item.id} value={item.id}>{item.codigo} · {item.titulo}</option>)}
        </Form.Select>
        {!candidates.length && <p className="small text-muted mt-2">{t('bugs.noDuplicateCandidates')}</p>}
      </>}
      <Form.Label htmlFor="bug-duplicate-comment" className="mt-3">{t('bugs.closureReason')}</Form.Label>
      <Form.Control id="bug-duplicate-comment" as="textarea" rows={3} value={comment} onChange={event => setComment(event.target.value)} disabled={saving} />
    </Modal.Body>
    <Modal.Footer><Button variant="secondary" disabled={saving} onClick={onClose}>{t('bugs.cancel')}</Button><Button disabled={saving || loading || !originalId} onClick={save}>{saving ? t('bugs.saving') : t('bugs.confirmDuplicate')}</Button></Modal.Footer>
  </Modal>
}
