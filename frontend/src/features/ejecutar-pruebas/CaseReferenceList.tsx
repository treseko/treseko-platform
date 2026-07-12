import { FileText, ImagePlus } from 'lucide-react'
import type { AttachmentMeta } from '../../EvidenceUpload'
import { isImageAsset, resolveAssetUrl } from '../../shared/utils/assets'
import { openInNewTab } from '../../shared/utils/openExternal'

type CaseReferenceListProps = {
  title: string
  references?: AttachmentMeta[]
  onZoomImage: (url: string) => void
}

export function CaseReferenceList({
  title,
  references = [],
  onZoomImage
}: CaseReferenceListProps) {
  if (!references.length) return null

  return (
    <div className="mt-2">
      <div className="x-small fw-bold text-muted text-uppercase mb-2 d-flex align-items-center gap-1">
        <ImagePlus size={13} /> {title}
      </div>
      <div className="d-flex flex-wrap gap-2">
        {references.map((attachment) => {
          const assetUrl = resolveAssetUrl(attachment.public_url)
          const isImage = isImageAsset(attachment)
          return (
            <button
              key={attachment.id}
              type="button"
              className="border rounded-3 bg-white p-1 d-flex align-items-center gap-2 shadow-sm"
              style={{ maxWidth: '220px' }}
              onClick={() => isImage ? onZoomImage(assetUrl) : openInNewTab(assetUrl)}
              title={attachment.filename_original}
            >
              {isImage ? (
                <img src={assetUrl} alt={attachment.filename_original} className="rounded border" style={{ width: 46, height: 34, objectFit: 'cover' }} />
              ) : (
                <FileText size={18} className="text-primary flex-shrink-0" />
              )}
              <span className="x-small text-primary text-truncate">{attachment.filename_original}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
