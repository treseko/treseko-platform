import { Modal } from 'react-bootstrap'
import { FileText } from 'lucide-react'

type Props = {
  show: boolean
  onHide: () => void
  children: React.ReactNode
}

export function StoryEditorModal({ show, onHide, children }: Props) {
  return (
    <Modal show={show} onHide={onHide} centered size="lg" scrollable>
      <Modal.Header closeButton className="border-0 pb-2">
        <Modal.Title className="fw-bold d-flex align-items-center gap-2">
          <FileText size={18} className="text-primary" />
          Edición de historia
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="pt-0">{children}</Modal.Body>
    </Modal>
  )
}
