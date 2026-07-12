import type { Dispatch, SetStateAction } from 'react'
import type { AttachmentMeta } from '../../EvidenceUpload'
import { API_BASE } from '../../app/constants'

type FeedbackVariant = 'success' | 'danger' | 'warning' | 'info'

type CreateSnapshotActionsParams = {
  currentExecutionCase: any
  stepResults: Record<number, string>
  snapshotNotes: Record<number, string>
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  setExecutionSnapshots: Dispatch<SetStateAction<any[]>>
  setSnapshotAttachments: Dispatch<SetStateAction<Record<string, AttachmentMeta[]>>>
  setStepResults: Dispatch<SetStateAction<Record<number, string>>>
  setSnapshotNotes: Dispatch<SetStateAction<Record<number, string>>>
  showFeedback: (title: string, message: string, variant?: FeedbackVariant) => void
}

export function createSnapshotActions({
  currentExecutionCase,
  stepResults,
  snapshotNotes,
  fetchWithAuth,
  setExecutionSnapshots,
  setSnapshotAttachments,
  setStepResults,
  setSnapshotNotes,
  showFeedback
}: CreateSnapshotActionsParams) {
  const persistExecutionSnapshots = async (snapshotsToSave: any[]) => {
    if (!currentExecutionCase?.id || snapshotsToSave.length === 0) return []
    const payload = {
      snapshots: snapshotsToSave.map(snapshot => ({
        id: snapshot.id,
        estado: snapshot.nextEstado || stepResults[snapshot.numero_paso] || snapshot.estado_paso || 'SIN_CORRER',
        comentarios: snapshot.nextComentarios ?? snapshotNotes[snapshot.numero_paso] ?? snapshot.comentarios ?? '',
        evidencia_url: snapshot.evidencia_url || null
      }))
    }
    const response = await fetchWithAuth(`${API_BASE}/ejecuciones/${currentExecutionCase.id}/snapshots/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    if (!response.ok) {
      const error = await response.json().catch(() => null)
      throw new Error(error?.detail || `Backend respondió ${response.status}`)
    }
    const updated = await response.json()
    setExecutionSnapshots(updated)
    setStepResults(Object.fromEntries(updated.map((snap: any) => [snap.numero_paso, snap.estado_paso])))
    setSnapshotNotes(Object.fromEntries(updated.map((snap: any) => [snap.numero_paso, snap.comentarios || ''])))
    return updated
  }

  const handleSnapshotStatusChange = (snapshot: any, status: string) => {
    if (!snapshot?.id || !status) return
    setStepResults(prev => ({ ...prev, [snapshot.numero_paso]: status }))
    setExecutionSnapshots(prev => prev.map(item => item.id === snapshot.id ? { ...item, estado_paso: status } : item))
  }

  const handleSnapshotNoteChange = (stepNumber: number, value: string) => {
    setSnapshotNotes(prev => ({ ...prev, [stepNumber]: value }))
  }

  const handleSnapshotNoteBlur = (snapshot: any) => {
    setExecutionSnapshots(prev => prev.map(item =>
      item.id === snapshot.id
        ? { ...item, comentarios: snapshotNotes[snapshot.numero_paso] || '' }
        : item
    ))
  }

  const handleSnapshotAttachmentUpload = async (snapshot: any, attachment: AttachmentMeta) => {
    if (!snapshot?.id || !attachment?.id) return false
    const tipo = attachment.content_type === 'application/pdf'
      ? 'PDF'
      : attachment.content_type === 'text/plain'
        ? 'LOG'
        : 'SCREENSHOT'
    const response = await fetchWithAuth(`${API_BASE}/snapshots/${snapshot.id}/attachments/`, {
      method: 'POST',
      body: JSON.stringify({ attachment_id: attachment.id, tipo })
    })
    if (!response.ok) {
      const error = await response.json().catch(() => null)
      showFeedback('No se pudo vincular evidencia', error?.detail || `Backend respondió ${response.status}`, 'danger')
      return false
    }
    const link = await response.json()
    setSnapshotAttachments(prev => ({
      ...prev,
      [snapshot.id]: [...(prev[snapshot.id] || []), link.attachment]
    }))
    return true
  }

  const handleRemoveSnapshotAttachment = async (snapshot: any, attachment: AttachmentMeta) => {
    if (!snapshot?.id || !attachment?.id) return
    const response = await fetchWithAuth(`${API_BASE}/snapshots/${snapshot.id}/attachments/${attachment.id}/`, { method: 'DELETE' })
    if (!response.ok) return
    setSnapshotAttachments(prev => ({
      ...prev,
      [snapshot.id]: (prev[snapshot.id] || []).filter(item => item.id !== attachment.id)
    }))
  }

  return {
    persistExecutionSnapshots,
    handleSnapshotStatusChange,
    handleSnapshotNoteChange,
    handleSnapshotNoteBlur,
    handleSnapshotAttachmentUpload,
    handleRemoveSnapshotAttachment
  }
}
