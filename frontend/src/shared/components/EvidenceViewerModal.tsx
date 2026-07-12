import { useEffect, useState } from 'react'
import { AlertCircle, Download, ExternalLink, FileText } from 'lucide-react'
import { Button, Modal, Spinner } from 'react-bootstrap'
import { API_BASE } from '../../app/constants'
import { resolveAssetUrl } from '../utils/assets'
import { getEvidenceMissingReason, isEvidenceAvailable } from '../utils/evidenceAvailability'

export type EvidenceViewerItem = {
  url?: string | null
  filename?: string | null
  contentType?: string | null
  available?: boolean
  missing_reason?: string | null
  missingReason?: string | null
}

type EvidenceViewerModalProps = {
  evidence: EvidenceViewerItem | null
  onHide: () => void
}

const extensionFromName = (value?: string | null) => {
  const clean = String(value || '').split('?', 1)[0].toLowerCase()
  const match = clean.match(/\.([a-z0-9]+)$/)
  return match?.[1] || ''
}

const inferContentType = (evidence: EvidenceViewerItem | null) => {
  const explicit = String(evidence?.contentType || '').split(';', 1)[0].trim().toLowerCase()
  if (explicit) return explicit
  const ext = extensionFromName(evidence?.filename || evidence?.url)
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return `image/${ext === 'jpg' ? 'jpeg' : ext}`
  if (ext === 'pdf') return 'application/pdf'
  if (['txt', 'log'].includes(ext)) return 'text/plain'
  if (ext === 'csv') return 'text/csv'
  if (ext === 'json') return 'application/json'
  if (['xml'].includes(ext)) return 'application/xml'
  if (ext === 'mp4') return 'video/mp4'
  if (ext === 'webm') return 'video/webm'
  if (ext === 'mp3') return 'audio/mpeg'
  if (ext === 'wav') return 'audio/wav'
  return 'application/octet-stream'
}

const isImage = (type: string) => type.startsWith('image/')
const isVideo = (type: string) => type.startsWith('video/')
const isAudio = (type: string) => type.startsWith('audio/')
const isText = (type: string) => type.startsWith('text/') || ['application/json', 'application/xml'].includes(type)
const isPdf = (type: string) => type === 'application/pdf'

const getStoredToken = (key: string) => {
  if (typeof localStorage === 'undefined') return ''
  return localStorage.getItem(key) || ''
}

const stripAssetToken = (url: string) => {
  if (!url) return ''
  try {
    const parsed = new URL(url, window.location.origin)
    parsed.searchParams.delete('asset_token')
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return url
  }
}

const fetchEvidenceAsset = async (url: string, signal: AbortSignal) => {
  const doFetch = (token: string) => fetch(url, {
    signal,
    credentials: 'same-origin',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  })

  return doFetch(getStoredToken('qa_access_token'))
}

const openAssetBlob = async (
  url: string,
  filename: string,
  download: boolean,
  setDownloading: (value: boolean) => void
) => {
  if (!url) return
  const controller = new AbortController()
  setDownloading(true)
  let objectUrl = ''
  try {
    const response = await fetchEvidenceAsset(url, controller.signal)
    if (!response.ok) throw new Error(`No se pudo cargar la evidencia (${response.status}).`)
    const blob = await response.blob()
    objectUrl = URL.createObjectURL(blob)
    if (download) {
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
    } else {
      window.open(objectUrl, '_blank', 'noopener,noreferrer')
    }
  } finally {
    window.setTimeout(() => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }, 30_000)
    setDownloading(false)
  }
}

export function EvidenceViewerModal({ evidence, onHide }: EvidenceViewerModalProps) {
  const source = resolveAssetUrl(evidence?.url)
  const previewSource = stripAssetToken(source)
  const assetSource = previewSource || source
  const filename = evidence?.filename || 'evidencia'
  const contentType = inferContentType(evidence)
  const available = isEvidenceAvailable(evidence)
  const missingReason = getEvidenceMissingReason(evidence)
  const canPreview = available && Boolean(previewSource) && (isImage(contentType) || isVideo(contentType) || isAudio(contentType) || isText(contentType) || isPdf(contentType))
  const [previewUrl, setPreviewUrl] = useState('')
  const [textPreview, setTextPreview] = useState('')
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [previewError, setPreviewError] = useState('')

  useEffect(() => {
    if (!previewSource || !canPreview || !evidence) {
      setPreviewUrl('')
      setTextPreview('')
      setPreviewError('')
      setLoadingPreview(false)
      return
    }

    const controller = new AbortController()
    let objectUrl = ''
    setLoadingPreview(true)
    setPreviewUrl('')
    setTextPreview('')
    setPreviewError('')

    fetchEvidenceAsset(previewSource, controller.signal)
      .then(async response => {
        if (!response.ok) {
          const message = response.status === 401
            ? 'La sesión para ver esta evidencia expiró. Vuelve a iniciar sesión o usa descargar con una sesión activa.'
            : response.status === 410 || response.status === 404
              ? 'El archivo físico de esta evidencia no está disponible en el storage. El registro existe, pero no hay archivo para previsualizar o descargar.'
              : `No se pudo cargar la evidencia (${response.status}).`
          throw new Error(message)
        }
        const blob = await response.blob()
        if (isText(contentType)) {
          const text = await blob.text()
          setTextPreview(text)
          return
        }
        objectUrl = URL.createObjectURL(blob)
        setPreviewUrl(objectUrl)
      })
      .catch(error => {
        if (controller.signal.aborted) return
        setPreviewError(error instanceof Error ? error.message : 'No se pudo cargar la vista previa.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingPreview(false)
      })

    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [previewSource, canPreview, contentType, evidence])

  return (
    <Modal show={Boolean(evidence)} onHide={onHide} size="xl" centered>
      <Modal.Header closeButton>
        <Modal.Title className="fs-6 fw-bold d-flex align-items-center gap-2 min-w-0">
          <FileText size={18} className="text-primary flex-shrink-0" />
          <span className="text-truncate">{filename}</span>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="bg-light">
        {!available ? (
          <div className="text-center text-muted py-5 bg-white rounded-3 border">
            <AlertCircle size={32} className="mb-2 text-warning" />
            <div className="fw-bold text-dark">Archivo no disponible</div>
            <div className="small">{missingReason}</div>
            <div className="small mt-2">El registro de evidencia se conserva para trazabilidad, pero el archivo físico no está en storage.</div>
          </div>
        ) : !source ? (
          <div className="text-center text-muted py-5">
            <AlertCircle size={32} className="mb-2" />
            <div className="fw-bold">No se pudo resolver la URL de la evidencia.</div>
          </div>
        ) : loadingPreview ? (
          <div className="text-center text-muted py-5 bg-white rounded-3 border">
            <Spinner animation="border" size="sm" className="me-2" />
            Cargando vista previa...
          </div>
        ) : previewError ? (
          <div className="text-center text-muted py-5 bg-white rounded-3 border">
            <AlertCircle size={32} className="mb-2 text-warning" />
            <div className="fw-bold text-dark">No se pudo mostrar la vista previa.</div>
            <div className="small">{previewError}</div>
          </div>
        ) : isImage(contentType) ? (
          <div className="d-flex justify-content-center bg-white rounded-3 border p-3">
            <img src={previewUrl} alt={filename} className="img-fluid rounded" style={{ maxHeight: '70vh', objectFit: 'contain' }} />
          </div>
        ) : isVideo(contentType) ? (
          <video src={previewUrl} controls className="w-100 bg-dark rounded-3" style={{ maxHeight: '70vh' }} />
        ) : isAudio(contentType) ? (
          <div className="bg-white rounded-3 border p-4">
            <audio src={previewUrl} controls className="w-100" />
          </div>
        ) : isText(contentType) ? (
          <pre
            className="w-100 bg-white rounded-3 border p-3 mb-0 small font-monospace text-dark"
            style={{ minHeight: '45vh', maxHeight: '70vh', overflow: 'auto', whiteSpace: 'pre-wrap' }}
          >
            {textPreview}
          </pre>
        ) : isPdf(contentType) ? (
          <iframe
            title={filename}
            src={previewUrl}
            className="w-100 bg-white rounded-3 border"
            style={{ minHeight: '70vh' }}
          />
        ) : (
          <div className="text-center text-muted py-5 bg-white rounded-3 border">
            <FileText size={36} className="mb-3 opacity-50" />
            <div className="fw-bold text-dark">Este archivo no se puede previsualizar en el navegador.</div>
            <div className="small">Descárgalo para revisarlo con una aplicación compatible.</div>
          </div>
        )}
        {available && source && canPreview && (
          <div className="small text-muted mt-3">
            Si el navegador no muestra la vista previa correctamente, usa descargar.
          </div>
        )}
      </Modal.Body>
      <Modal.Footer className="d-flex justify-content-between">
        <Button variant="outline-secondary" onClick={() => openAssetBlob(assetSource, filename, false, setDownloading)} disabled={!available || !assetSource || downloading}>
          <ExternalLink size={16} className="me-2" /> Abrir aparte
        </Button>
        <Button className="fw-bold" onClick={() => openAssetBlob(assetSource, filename, true, setDownloading)} disabled={!available || !assetSource || downloading}>
          <Download size={16} className="me-2" /> {downloading ? 'Preparando...' : 'Descargar'}
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
