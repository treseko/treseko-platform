import { useEffect, useRef, useState } from 'react'
import { Alert, Badge, Button, ProgressBar } from 'react-bootstrap'
import { FileText, Image as ImageIcon, Upload, X } from 'lucide-react'
import { isImageAsset, resolveAssetUrl } from './shared/utils/assets'
import { EvidenceViewerModal, type EvidenceViewerItem } from './shared/components/EvidenceViewerModal'
import { isEvidenceAvailable } from './shared/utils/evidenceAvailability'

export type AttachmentMeta = {
  id: string
  filename_original: string
  content_type: string
  size: number
  public_url: string
  scope: string
  available?: boolean
  missing_reason?: string | null
}

type EvidenceUploadProps = {
  onUploadComplete: (attachment: AttachmentMeta) => void
  currentEvidence?: string | null
  currentAttachments?: AttachmentMeta[]
  projectId?: string
  maxFileSize?: number
  disabled?: boolean
  uploadScope?: string
  enablePaste?: boolean
  compact?: boolean
  iconOnly?: boolean
  label?: string
  onRemoveAttachment?: (attachment: AttachmentMeta) => void
}

const DEFAULT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
  'application/xml',
  'text/xml',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'video/mp4',
  'video/webm',
  'application/octet-stream'
].join(',')

const readCurrentWorkspaceProjectId = () => {
  try {
    const sessionUser = JSON.parse(localStorage.getItem('qa_session_user') || '{}')
    const key = `qa_workspace_preferences:${sessionUser.id || sessionUser.email || 'anonymous'}`
    const preferences = JSON.parse(localStorage.getItem(key) || '{}')
    return typeof preferences.currentProjectId === 'string' ? preferences.currentProjectId : ''
  } catch {
    return ''
  }
}

export const EvidenceUpload = ({
  onUploadComplete,
  currentEvidence,
  currentAttachments = [],
  projectId,
  maxFileSize = 10,
  disabled = false,
  uploadScope = 'EXECUTION_EVIDENCE',
  enablePaste = true,
  compact = false,
  iconOnly = false,
  label = 'Adjuntar evidencia',
  onRemoveAttachment
}: EvidenceUploadProps) => {
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [viewerEvidence, setViewerEvidence] = useState<EvidenceViewerItem | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const uploadFile = async (file: File) => {
    setError(null)
    if (file.size > maxFileSize * 1024 * 1024) {
      setError(`El archivo supera el maximo permitido de ${maxFileSize}MB.`)
      return
    }

    setUploading(true)
    setUploadProgress(20)
    const formData = new FormData()
    formData.append('file', file)

    try {
      const token = localStorage.getItem('qa_access_token')
      const uploadProjectId = projectId || readCurrentWorkspaceProjectId()
      const params = new URLSearchParams({ scope: uploadScope })
      if (uploadProjectId) params.set('project_id', uploadProjectId)
      const response = await fetch(`/api/attachments/?${params.toString()}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: formData
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.detail || `Backend respondio ${response.status}`)
      }
      setUploadProgress(100)
      onUploadComplete(data)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al subir el archivo')
    } finally {
      setUploading(false)
    }
  }

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) await uploadFile(file)
  }

  useEffect(() => {
    if (!enablePaste || disabled) return
    const node = containerRef.current
    if (!node) return
    const handlePaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.items || [])
        .find(item => item.kind === 'file' && item.type.startsWith('image/'))
        ?.getAsFile()
      if (file) {
        event.preventDefault()
        void uploadFile(file)
      }
    }
    node.addEventListener('paste', handlePaste)
    return () => node.removeEventListener('paste', handlePaste)
  }, [disabled, enablePaste, maxFileSize, uploadScope])

  const attachments = currentAttachments.filter(Boolean)
  const openEvidenceViewer = (attachment: AttachmentMeta) => {
    setViewerEvidence({
      url: attachment.public_url,
      filename: attachment.filename_original,
      contentType: attachment.content_type,
      available: attachment.available,
      missing_reason: attachment.missing_reason,
    })
  }

  return (
    <div ref={containerRef} className="evidence-upload" tabIndex={0}>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        accept={DEFAULT_TYPES}
        style={{ display: 'none' }}
        disabled={disabled || uploading}
      />

      {attachments.length > 0 && (
        <div className={`d-flex flex-wrap gap-2 ${compact ? 'mb-2' : 'mb-3'}`}>
          {attachments.map((attachment) => (
            <div key={attachment.id} className="border rounded-3 bg-white p-2 d-flex align-items-center gap-2" style={{ maxWidth: compact ? 210 : 260 }}>
              {isEvidenceAvailable(attachment) && isImageAsset(attachment) ? (
                <img src={resolveAssetUrl(attachment.public_url)} alt={attachment.filename_original} className="rounded border" style={{ width: 42, height: 42, objectFit: 'cover', cursor: 'pointer' }} onClick={() => openEvidenceViewer(attachment)} />
              ) : (
                <FileText size={22} className={`${isEvidenceAvailable(attachment) ? 'text-primary' : 'text-muted'} flex-shrink-0`} />
              )}
              <div className="min-w-0">
                <Button variant="link" size="sm" className={`p-0 text-start text-truncate small text-decoration-none d-block ${!isEvidenceAvailable(attachment) ? 'text-muted' : ''}`} onClick={() => openEvidenceViewer(attachment)}>
                  {attachment.filename_original || 'archivo'}
                </Button>
                {!isEvidenceAvailable(attachment) && <Badge bg="warning" text="dark" className="x-small">Archivo no disponible</Badge>}
              </div>
              {!disabled && onRemoveAttachment && (
                <Button variant="link" size="sm" className="p-0 text-danger ms-auto" onClick={() => onRemoveAttachment(attachment)}>
                  <X size={14} />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {currentEvidence && attachments.length === 0 && (
        <div className="mb-2">
          <Button
            variant="outline-primary"
            size="sm"
            className="x-small rounded-pill fw-bold"
            onClick={() => setViewerEvidence({ url: currentEvidence, filename: 'Evidencia legacy', contentType: null })}
          >
            <ImageIcon size={14} className="me-1" /> Ver evidencia legacy
          </Button>
        </div>
      )}

      <Button
        variant={compact ? 'outline-secondary' : 'outline-primary'}
        size={compact ? 'sm' : undefined}
        className={`${iconOnly ? 'evidence-upload-icon-btn' : compact ? 'x-small py-1 px-2' : 'w-100 py-3'} fw-bold shadow-none`}
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || uploading}
        title={label}
        aria-label={label}
      >
        {iconOnly && uploading ? (
          <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
        ) : uploading ? (
          <>
            <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
            Subiendo...
          </>
        ) : iconOnly ? (
          <Upload size={14} />
        ) : (
          <>
            <Upload size={14} className="me-2" />
            {label}
          </>
        )}
      </Button>

      {uploading && <ProgressBar now={uploadProgress} className="mt-2" style={{ height: 4 }} />}
      {error && <Alert variant="danger" className="mt-2 mb-0 py-2 small">{error}</Alert>}
      {enablePaste && !compact && <div className="x-small text-muted mt-1">Tambien puedes pegar imagenes con Ctrl + V.</div>}
      <EvidenceViewerModal evidence={viewerEvidence} onHide={() => setViewerEvidence(null)} />
    </div>
  )
}
