import { useEffect, useRef, useState, type RefObject } from 'react'
import { Alert, Badge, Button, Form, Modal, ProgressBar } from 'react-bootstrap'
import { FileText, Image as ImageIcon, Trash2, Upload, X } from 'lucide-react'
import { isImageAsset, resolveAssetUrl } from './shared/utils/assets'
import { EvidenceViewerModal, type EvidenceViewerItem } from './shared/components/EvidenceViewerModal'
import { isEvidenceAvailable } from './shared/utils/evidenceAvailability'
import { useI18n } from './i18n'

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
  pasteTargetRef?: RefObject<HTMLElement | null>
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
  maxFileSize = 100,
  disabled = false,
  uploadScope = 'EXECUTION_EVIDENCE',
  enablePaste = true,
  compact = false,
  iconOnly = false,
  label,
  onRemoveAttachment,
  pasteTargetRef
}: EvidenceUploadProps) => {
  const { t } = useI18n()
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadFilename, setUploadFilename] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const dragDepthRef = useRef(0)
  const [viewerEvidence, setViewerEvidence] = useState<EvidenceViewerItem | null>(null)
  const displayLabel = label || t('common.attachedEvidence')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const getFilenameExtension = (filename: string) => {
    const extension = filename.match(/\.([^.]+)$/)?.[1]
    return extension ? `.${extension}` : ''
  }

  const normalizedUploadFilename = () => {
    const trimmed = uploadFilename.trim()
    if (!trimmed || !selectedFile) return selectedFile?.name || ''
    const originalExtension = getFilenameExtension(selectedFile.name)
    const hasExtension = /\.[^./\\]+$/.test(trimmed)
    return hasExtension || !originalExtension ? trimmed : `${trimmed}${originalExtension}`
  }

  const uploadFile = async (file: File): Promise<boolean> => {
    setError(null)
    if (file.size > maxFileSize * 1024 * 1024) {
      setError(t('common.maxFileSizeError', { size: maxFileSize }))
      return false
    }

    setUploading(true)
    setUploadProgress(20)
    const formData = new FormData()
    formData.append('file', file, normalizedUploadFilename())

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
        throw new Error(data.detail || t('common.backendResponded', { status: response.status }))
      }
      setUploadProgress(100)
      onUploadComplete(data)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.uploadFailed'))
      return false
    } finally {
      setUploading(false)
    }
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      setUploadFilename(file.name)
      setError(null)
    }
  }

  const selectIncomingFile = (file?: File) => {
    if (!file) return
    setSelectedFile(file)
    setUploadFilename(file.name)
    setError(null)
  }

  const handleDragEnter = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault()
    dragDepthRef.current += 1
    setIsDragging(true)
  }

  const handleDragLeave = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsDragging(false)
  }

  const handleDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault()
    dragDepthRef.current = 0
    setIsDragging(false)
    selectIncomingFile(event.dataTransfer.files?.[0])
  }

  const clipboardImageFile = (event: { clipboardData: DataTransfer | null }) => Array.from(event.clipboardData?.items || [])
    .find(item => item.kind === 'file' && item.type.startsWith('image/'))
    ?.getAsFile()

  useEffect(() => {
    if (!enablePaste || disabled) return
    const node = pasteTargetRef?.current || containerRef.current
    if (!node) return
    const handlePaste = (event: ClipboardEvent) => {
      const file = clipboardImageFile(event)
      if (file) {
        event.preventDefault()
        setSelectedFile(file)
        setError(null)
        setShowUploadModal(true)
      }
    }
    node.addEventListener('paste', handlePaste)
    return () => node.removeEventListener('paste', handlePaste)
  }, [disabled, enablePaste, maxFileSize, pasteTargetRef, uploadScope])

  useEffect(() => {
    if (!showUploadModal || !enablePaste || disabled) return
    const handleModalPaste = (event: ClipboardEvent) => {
      const file = clipboardImageFile(event)
      if (!file) return
      event.preventDefault()
      event.stopPropagation()
      selectIncomingFile(file)
    }
    document.addEventListener('paste', handleModalPaste, true)
    return () => document.removeEventListener('paste', handleModalPaste, true)
  }, [disabled, enablePaste, showUploadModal])

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
      {attachments.length > 0 && (
        <div className={`${compact ? 'evidence-upload-attachments-compact' : 'd-flex flex-wrap gap-2'} ${compact ? 'mb-2' : 'mb-3'}`}>
          {attachments.map((attachment, attachmentIndex) => {
            const filename = attachment.filename_original || t('common.fileNameFallback')
            const previousWithSameName = attachments.slice(0, attachmentIndex).filter(item => item.filename_original === attachment.filename_original).length
            const displayFilename = previousWithSameName ? `${filename} (${previousWithSameName + 1})` : filename
            return (
            <div key={attachment.id} data-attachment-index={attachmentIndex + 1} title={displayFilename} className={`border rounded-3 bg-white p-2 d-flex align-items-center gap-2 ${compact ? 'evidence-upload-attachment-card-compact' : ''}`} style={{ maxWidth: compact ? undefined : 260 }}>
              {isEvidenceAvailable(attachment) && isImageAsset(attachment) ? (
                <img src={resolveAssetUrl(attachment.public_url)} alt={attachment.filename_original} className={`rounded border ${compact ? 'evidence-upload-thumbnail-compact' : ''}`} style={{ width: 42, height: 42, objectFit: 'cover', cursor: 'pointer' }} onClick={() => openEvidenceViewer(attachment)} />
              ) : (
                <FileText size={22} className={`${isEvidenceAvailable(attachment) ? 'text-primary' : 'text-muted'} flex-shrink-0`} />
              )}
              <div className="min-w-0">
                <Button variant="link" size="sm" className={`p-0 text-start text-truncate small text-decoration-none d-block ${!isEvidenceAvailable(attachment) ? 'text-muted' : ''}`} onClick={() => openEvidenceViewer(attachment)}>
                  {displayFilename}
                </Button>
                {!isEvidenceAvailable(attachment) && <Badge bg="warning" text="dark" className="x-small">{t('common.evidenceFileUnavailable')}</Badge>}
              </div>
              {!disabled && onRemoveAttachment && (
                <Button variant="link" size="sm" className="p-0 text-danger ms-auto" onClick={() => onRemoveAttachment(attachment)} aria-label={`${t('common.removeAttachment')}: ${displayFilename}`}>
                  <X size={14} />
                </Button>
              )}
            </div>
            )
          })}
        </div>
      )}

      {currentEvidence && attachments.length === 0 && (
        <div className="mb-2">
          <Button
            variant="outline-primary"
            size="sm"
            className="x-small rounded-pill fw-bold"
            onClick={() => setViewerEvidence({ url: currentEvidence, filename: t('common.legacyEvidence'), contentType: null })}
          >
            <ImageIcon size={14} className="me-1" /> {t('common.viewLegacyEvidence')}
          </Button>
        </div>
      )}

      <Button
        variant={compact ? 'outline-secondary' : 'outline-primary'}
        size={compact ? 'sm' : undefined}
        className={`${iconOnly ? 'evidence-upload-icon-btn' : compact ? 'x-small py-1 px-2' : 'w-100 py-3'} fw-bold shadow-none`}
        onClick={() => { setError(null); setSelectedFile(null); setUploadFilename(''); setShowUploadModal(true) }}
        disabled={disabled || uploading}
        title={displayLabel}
        aria-label={displayLabel}
      >
        {iconOnly && uploading ? (
          <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
        ) : uploading ? (
          <>
            <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
            {t('common.uploading')}
          </>
        ) : iconOnly ? (
          <Upload size={14} />
        ) : (
          <>
            <Upload size={14} className="me-2" />
            {displayLabel}
          </>
        )}
      </Button>

      {uploading && <ProgressBar now={uploadProgress} className="mt-2" style={{ height: 4 }} />}
      {error && <Alert variant="danger" className="mt-2 mb-0 py-2 small">{error}</Alert>}
      {enablePaste && !compact && <div className="x-small text-muted mt-1">{t('common.pasteImagesHint')}</div>}
      <Modal show={showUploadModal} onHide={() => { if (!uploading) { setShowUploadModal(false); setSelectedFile(null); setUploadFilename(''); setError(null); setIsDragging(false); dragDepthRef.current = 0 } }} centered dialogClassName="evidence-upload-modal">
        <Modal.Header closeButton={!uploading}>
          <Modal.Title className="h5 d-flex align-items-center gap-2"><span className="evidence-upload-modal-icon"><Upload size={17} aria-hidden="true" /></span>{t('common.uploadModalTitle')}</Modal.Title>
        </Modal.Header>
        <Modal.Body
          onDragEnter={handleDragEnter}
          onDragOver={event => event.preventDefault()}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onPaste={event => {
          if (!enablePaste || disabled || uploading) return
          const file = clipboardImageFile(event)
          if (file) { event.preventDefault(); selectIncomingFile(file) }
        }}>
          <p className="text-muted mb-3">{t('common.uploadModalHint')}</p>
          <div className={`evidence-upload-dropzone ${isDragging ? 'is-dragging' : ''}`}>
            <div className="evidence-upload-dropzone-icon"><Upload size={22} aria-hidden="true" /></div>
            <div className="fw-semibold">{isDragging ? t('common.dropFileHere') : t('common.dragFileHere')}</div>
            <div className="small text-muted mt-1">{t('common.orSelectFile')}</div>
            <Form.Label htmlFor="evidence-upload-file" className="btn btn-outline-primary btn-sm mt-3 mb-0 px-3">{t('common.selectFile')}</Form.Label>
            <Form.Control id="evidence-upload-file" ref={fileInputRef} name="evidence-upload-file" type="file" accept={DEFAULT_TYPES} onChange={handleFileSelect} disabled={disabled || uploading} className="visually-hidden" />
            {enablePaste && <div className="small text-muted mt-3" tabIndex={0}>{t('common.pasteImagesHint')}</div>}
          </div>
          {selectedFile && (
            <div className="evidence-upload-selected-file mt-3">
              <div className="evidence-upload-file-preview" aria-hidden="true">
                {selectedFile.type.startsWith('image/') ? <ImageIcon size={22} /> : <FileText size={22} />}
              </div>
              <div className="min-w-0 flex-grow-1">
                <div className="small fw-semibold text-muted">{t('common.selectedFile')}</div>
                <Form.Label htmlFor="evidence-upload-filename" className="visually-hidden">{t('common.fileName')}</Form.Label>
                <Form.Control id="evidence-upload-filename" name="evidence-upload-filename" type="text" value={uploadFilename} onChange={event => setUploadFilename(event.target.value)} disabled={disabled || uploading} autoComplete="off" spellCheck={false} aria-describedby="evidence-upload-file-meta" />
                <div id="evidence-upload-file-meta" className="small text-muted mt-1">{Math.ceil(selectedFile.size / 1024)} KB · {selectedFile.type || t('common.file')}</div>
              </div>
              <Button
                variant="link"
                size="sm"
                className="evidence-upload-remove-selected p-1 text-danger"
                onClick={() => { setSelectedFile(null); setUploadFilename(''); if (fileInputRef.current) fileInputRef.current.value = '' }}
                disabled={disabled || uploading}
                aria-label={t('common.removeSelectedFile')}
                title={t('common.removeSelectedFile')}
              >
                <Trash2 size={17} aria-hidden="true" />
              </Button>
            </div>
          )}
          {error && <Alert variant="danger" className="mt-3 mb-0 py-2 small">{error}</Alert>}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => { setShowUploadModal(false); setSelectedFile(null); setUploadFilename(''); setError(null); setIsDragging(false); dragDepthRef.current = 0 }} disabled={uploading}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={async () => { if (!selectedFile) return; const uploaded = await uploadFile(selectedFile); if (uploaded) { setSelectedFile(null); setShowUploadModal(false) } }} disabled={!selectedFile || disabled || uploading}>
            {uploading ? <><span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" />{t('common.uploading')}</> : t('common.confirmUpload')}
          </Button>
        </Modal.Footer>
      </Modal>
      <EvidenceViewerModal evidence={viewerEvidence} onHide={() => setViewerEvidence(null)} />
    </div>
  )
}
