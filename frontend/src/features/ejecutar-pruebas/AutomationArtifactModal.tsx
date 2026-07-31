import { Button, Modal } from 'react-bootstrap'

export function AutomationArtifactModal({ options }: { options: any }) {
  const { show, selectedArtifact, setSelectedArtifact, t } = options
  return (
<Modal show={show && Boolean(selectedArtifact)} onHide={() => setSelectedArtifact(null)} centered size="xl" backdrop="static">
  <Modal.Header closeButton>
    <Modal.Title className="fw-bold">{selectedArtifact?.label || 'Evidencia'}</Modal.Title>
  </Modal.Header>
  <Modal.Body className="text-center bg-dark">
    {selectedArtifact?.href ? (
      <img
        src={selectedArtifact.href}
        alt={selectedArtifact.label || 'Evidencia'}
        className="img-fluid rounded"
        style={{ maxHeight: '70vh', objectFit: 'contain' }}
      />
    ) : (
      <div className="text-white">{t('ejecutarPruebas.evidenceLoadFailed')}</div>
    )}
  </Modal.Body>
  <Modal.Footer>
    <Button variant="outline-secondary" onClick={() => setSelectedArtifact(null)}>{t('common.close')}</Button>
    {selectedArtifact?.href && (
      <a
        href={selectedArtifact.href}
        download={selectedArtifact.filename || 'evidencia.png'}
        className="btn btn-primary"
      >
        {t('ejecutarPruebas.download')}
      </a>
    )}
  </Modal.Footer>
</Modal>

  )
}
