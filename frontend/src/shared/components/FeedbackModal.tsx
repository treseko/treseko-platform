import { useEffect } from 'react'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { Button, Modal, Toast, ToastContainer } from 'react-bootstrap'

type FeedbackModalState = {
  show: boolean
  title: string
  message: string
  variant: 'success' | 'danger' | 'warning' | 'info'
}

type FeedbackModalProps = {
  feedback: FeedbackModalState
  onHide: () => void
}

export function FeedbackModal({ feedback, onHide }: FeedbackModalProps) {
  useEffect(() => {
    if (!feedback.show || feedback.variant !== 'success') return
    const timer = window.setTimeout(onHide, 2600)
    return () => window.clearTimeout(timer)
  }, [feedback.show, feedback.variant, onHide])

  if (feedback.variant === 'success') {
    return (
      <ToastContainer position="top-end" className="p-3" style={{ zIndex: 1080 }}>
        <Toast show={feedback.show} onClose={onHide} bg="light" className="border-0 shadow">
          <Toast.Header closeButton className="border-0">
            <CheckCircle2 size={18} className="text-success me-2" />
            <strong className="me-auto text-dark">{feedback.title || 'Guardado'}</strong>
          </Toast.Header>
          {feedback.message && (
            <Toast.Body className="pt-0 text-secondary small">{feedback.message}</Toast.Body>
          )}
        </Toast>
      </ToastContainer>
    )
  }

  return (
    <Modal show={feedback.show} onHide={onHide} centered>
      <Modal.Header closeButton className={`border-0 ${feedback.variant === 'danger' ? 'bg-danger text-white' : feedback.variant === 'warning' ? 'bg-warning' : 'bg-primary text-white'}`}>
        <Modal.Title className="fw-bold d-flex align-items-center gap-2">
          <AlertCircle size={22} /> {feedback.title}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="p-4 text-dark">
        <p className="mb-0" style={{ whiteSpace: 'pre-wrap' }}>{feedback.message}</p>
      </Modal.Body>
      <Modal.Footer className="border-0 pt-0">
        <Button variant={feedback.variant === 'danger' ? 'danger' : feedback.variant === 'warning' ? 'warning' : 'primary'} className="fw-bold rounded-pill px-4" onClick={onHide}>
          Entendido
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
