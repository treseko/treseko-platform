import { useI18n } from '../../i18n'
import { Badge, Button } from 'react-bootstrap'
import { FileText, Image as ImageIcon } from 'lucide-react'
import { isImageAsset, resolveAssetUrl } from '../../shared/utils/assets'
import { isEvidenceAvailable } from '../../shared/utils/evidenceAvailability'

export function EvidenceList({ items, onOpenEvidence }: { items: any[], onOpenEvidence: (attachment: any) => void }) {
  const { t } = useI18n()
  if (!items?.length) return <span className="text-muted x-small"><ImageIcon size={12} className="me-1" />{t('historial.withoutEvidence')}</span>
  return (
    <div className="d-flex align-items-center gap-1 flex-wrap">
      {items.map((attachment: any) => (
        isEvidenceAvailable(attachment) && isImageAsset(attachment) ? (
          <button
            key={attachment.id}
            type="button"
            className="border rounded-2 bg-white p-0"
            title={attachment.filename_original}
            onClick={() => onOpenEvidence(attachment)}
          >
            <img src={resolveAssetUrl(attachment.public_url)} alt={attachment.filename_original} className="rounded-2" style={{ width: 32, height: 32, objectFit: 'cover' }} />
          </button>
        ) : (
          <Button key={attachment.id} variant={isEvidenceAvailable(attachment) ? 'outline-secondary' : 'outline-warning'} size="sm" className="x-small py-0 px-1" title={attachment.filename_original} onClick={() => onOpenEvidence(attachment)}>
            <FileText size={12} /> {attachment.filename_original || 'Archivo'}
            {!isEvidenceAvailable(attachment) && <Badge bg="warning" text="dark" className="ms-1">Archivo no disponible</Badge>}
          </Button>
        )
      ))}
    </div>
  )
}
