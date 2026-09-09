import { useEffect, useRef } from 'react'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { Button, Modal, Toast, ToastContainer } from 'react-bootstrap'
import { useI18n } from '../../i18n'

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
  const { t } = useI18n()
  const onHideRef = useRef(onHide)

  useEffect(() => {
    onHideRef.current = onHide
  }, [onHide])

  useEffect(() => {
    // Solo las notificaciones tipo toast se cierran automáticamente.
    // Los errores y advertencias se muestran como modal y deben quedar
    // visibles hasta que el usuario los cierre de forma explícita.
    if (!feedback.show || feedback.variant !== 'success') return
    const timer = window.setTimeout(() => onHideRef.current(), 4000)
    return () => window.clearTimeout(timer)
  }, [feedback.show, feedback.variant, feedback.title, feedback.message])

  if (feedback.variant === 'success') {
    return (
      <ToastContainer position="top-end" className="p-3" style={{ zIndex: 1080 }}>
        <Toast show={feedback.show} onClose={onHide} className="feedback-toast border shadow">
          <Toast.Header closeButton className="feedback-toast-header border-0">
            <CheckCircle2 size={18} className="text-success me-2" />
            <strong className="me-auto">{feedback.title || t('common.feedbackSaved')}</strong>
          </Toast.Header>
          {feedback.message && (
            <Toast.Body className="pt-0 small">{feedback.message}</Toast.Body>
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
          {t('common.understood')}
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
