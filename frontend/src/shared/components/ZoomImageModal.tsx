import { Modal } from 'react-bootstrap'
import { resolveAssetUrl } from '../utils/assets'

type ZoomImageModalProps = {
  imageUrl: string | null
  onHide: () => void
}

export function ZoomImageModal({ imageUrl, onHide }: ZoomImageModalProps) {
  return (
    <Modal show={!!imageUrl} onHide={onHide} size="lg" centered>
      <Modal.Header closeButton className="border-0 pb-0 text-dark">
        <Modal.Title className="fw-bold text-dark">Imagen de referencia</Modal.Title>
      </Modal.Header>
      <Modal.Body className="p-3 text-center">
        {imageUrl && (
          <img
            src={resolveAssetUrl(imageUrl)}
            className="img-fluid rounded border shadow"
            alt="Referencia ampliada"
            style={{ maxHeight: '75vh' }}
          />
        )}
      </Modal.Body>
    </Modal>
  )
}
