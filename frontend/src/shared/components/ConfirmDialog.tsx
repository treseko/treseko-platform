import { AlertTriangle, Info } from 'lucide-react'
import { Button, Modal } from 'react-bootstrap'
import { useI18n } from '../../i18n'

export type ConfirmDialogVariant = 'danger' | 'warning' | 'info'

export type ConfirmDialogOptions = {
  title: string
  message: string
  variant?: ConfirmDialogVariant
  confirmLabel?: string
  cancelLabel?: string | null
}

export type ConfirmDialogState = ConfirmDialogOptions & {
  show: boolean
}

type ConfirmDialogProps = {
  dialog: ConfirmDialogState
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmDialog({ dialog, onCancel, onConfirm }: ConfirmDialogProps) {
  const { t } = useI18n()
  const variant = dialog.variant || 'warning'
  const isInfo = variant === 'info'
  const confirmVariant = variant === 'danger' ? 'danger' : variant === 'warning' ? 'warning' : 'primary'

  return (
    <Modal show={dialog.show} onHide={onCancel} centered>
      <Modal.Header closeButton className={`border-0 ${variant === 'danger' ? 'bg-danger text-white' : variant === 'warning' ? 'bg-warning' : 'bg-primary text-white'}`}>
        <Modal.Title className="fw-bold d-flex align-items-center gap-2">
          {isInfo ? <Info size={22} /> : <AlertTriangle size={22} />}
          {dialog.title}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="p-4 text-dark">
        <p className="mb-0" style={{ whiteSpace: 'pre-wrap' }}>{dialog.message}</p>
      </Modal.Body>
      <Modal.Footer className="border-0 pt-0">
        {dialog.cancelLabel !== null && (
          <Button variant="outline-secondary" className="fw-bold rounded-pill px-4" onClick={onCancel}>
            {dialog.cancelLabel || t('common.cancel')}
          </Button>
        )}
        <Button variant={confirmVariant} className="fw-bold rounded-pill px-4" onClick={onConfirm}>
          {dialog.confirmLabel || (isInfo ? t('common.understood') : t('common.confirm'))}
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
