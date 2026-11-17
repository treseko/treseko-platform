import { Alert, Modal } from 'react-bootstrap'

type Trace = { blob: Blob; filename: string } | null

export function PlaywrightTraceViewerModal({ show, trace, onHide, t }: {
  show: boolean
  trace: Trace
  onHide: () => void
  t: (key: string) => string
}) {
  return <Modal show={show && Boolean(trace)} onHide={onHide} fullscreen centered>
    <Modal.Header closeButton closeLabel={t('ejecutarPruebas.closeModal')}>
      <Modal.Title>{t('ejecutarPruebas.traceViewerTitle')}{trace?.filename ? ` · ${trace.filename}` : ''}</Modal.Title>
    </Modal.Header>
    <Modal.Body className="p-0 d-flex flex-column">
      <Alert variant="info" className="m-2 mb-0 small">{t('ejecutarPruebas.traceViewerPrivacy')}</Alert>
      {trace && <iframe
        title={t('ejecutarPruebas.traceViewerTitle')}
        src="https://trace.playwright.dev/"
        className="border-0 flex-grow-1 w-100"
        style={{ minHeight: 0 }}
        onLoad={event => event.currentTarget.contentWindow?.postMessage({ method: 'load', params: { trace: trace.blob } }, 'https://trace.playwright.dev')}
      />}
    </Modal.Body>
  </Modal>
}
