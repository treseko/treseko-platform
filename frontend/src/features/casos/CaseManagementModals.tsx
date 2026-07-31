import { Button, Form, Modal } from "react-bootstrap";
import { FileText, Folders } from "lucide-react";
import { flattenSuites } from "../../testRepositoryUtils";

type Props = { context: any };

export function CaseManagementModals({ context }: Props) {
  const {
    t, showLocationModal, setShowLocationModal, currentSuiteBreadcrumb, currentSuiteId,
    selectSuiteTarget, suitesTree, getSuiteDepth, cloneSourceCase, setCloneSourceCase,
    cloneTargetSuiteId, setCloneTargetSuiteId, cloneDestinationSuites, cloneTargetSuiteValid,
    confirmCloneCase, moveSourceCase, setMoveSourceCase, moveTargetSuiteId,
    setMoveTargetSuiteId, moveCaseDestinationSuites, moveTargetSuiteValid, confirmMoveCase,
    cloneSourceSuite, setCloneSourceSuite, cloneSuiteIds, cloneSuiteCasesCount, cloneSuiteName,
    setCloneSuiteName, cloneSuiteParentId, setCloneSuiteParentId, cloneSuiteDestinationSuites,
    confirmCloneSuite,
  } = context;
  return (
    <>
<Modal show={showLocationModal} onHide={() => setShowLocationModal(false)} centered fullscreen="sm-down">
  <Modal.Header closeButton className="bg-light border-bottom text-dark">
    <Modal.Title className="fw-bold fs-6 d-flex align-items-center gap-2">
      <Folders size={18} className="text-primary" /> Cambiar carpeta destino
    </Modal.Title>
  </Modal.Header>
  <Modal.Body className="text-start">
    <div className="small text-muted mb-2">{t('casos.currentFolder')}</div>
    <div className="fw-semibold text-dark border rounded-2 bg-light p-2 mb-3 text-break">{currentSuiteBreadcrumb}</div>
    <Form.Group>
      <Form.Label className="fw-bold x-small text-muted">{t('casos.newFolder').toUpperCase()}</Form.Label>
      <Form.Select
        value={currentSuiteId}
        onChange={(event) => selectSuiteTarget(event.target.value)}
        className="bg-light border-light-subtle shadow-none text-dark fw-bold"
        required
      >
        <option value="">{t('casos.selectFolder')}</option>
        {flattenSuites(suitesTree).map(suite => (
          <option key={suite.id} value={suite.id}>
            {'- '.repeat(getSuiteDepth(suite.id))}{suite.nombre}
          </option>
        ))}
      </Form.Select>
    </Form.Group>
  </Modal.Body>
  <Modal.Footer className="border-0 pt-0">
    <Button variant="primary" className="fw-bold rounded-pill px-4" onClick={() => setShowLocationModal(false)}>
      {t('casos.useFolder')}
    </Button>
  </Modal.Footer>
</Modal>
<Modal show={Boolean(cloneSourceCase)} onHide={() => setCloneSourceCase(null)} centered fullscreen="sm-down">
  <Modal.Header closeButton className="bg-light border-bottom text-dark">
    <Modal.Title className="fw-bold fs-6 d-flex align-items-center gap-2">
      <FileText size={18} className="text-primary" /> Copiar como nueva prueba
    </Modal.Title>
  </Modal.Header>
  <Modal.Body className="text-start">
    <div className="border rounded-3 bg-light p-3 mb-3">
      <div className="font-monospace x-small fw-bold text-secondary">{cloneSourceCase?.code || cloneSourceCase?.id}</div>
      <div className="fw-bold text-dark">{cloneSourceCase?.title}</div>
      <div className="small text-muted mt-1">{t('casos.copyCaseDescription')}</div>
    </div>
    <Form.Group>
      <Form.Label className="fw-bold x-small text-muted">{t('casos.destinationSuite').toUpperCase()}</Form.Label>
      <Form.Select
        value={cloneTargetSuiteId}
        onChange={(event) => setCloneTargetSuiteId(event.target.value)}
        className="bg-light border-light-subtle shadow-none text-dark fw-bold"
      >
        {cloneDestinationSuites.map((suite: any) => (
          <option key={suite.id} value={suite.id}>
            {suite.id === cloneSourceCase?.suiteId ? 'Misma suite - ' : ''}{'- '.repeat(getSuiteDepth(suite.id))}{suite.nombre}
          </option>
        ))}
      </Form.Select>
    </Form.Group>
    {cloneDestinationSuites.length === 0 && (
      <div className="small text-danger mt-2">{t('casos.noDestinationSuites')}</div>
    )}
    {cloneDestinationSuites.length > 0 && !cloneTargetSuiteValid && (
      <div className="small text-danger mt-2">{t('casos.invalidDestinationSuite')}</div>
    )}
  </Modal.Body>
  <Modal.Footer className="border-0 pt-0">
    <Button variant="outline-secondary" className="fw-bold rounded-pill px-4" onClick={() => setCloneSourceCase(null)}>
      {t('common.cancel')}
    </Button>
    <Button variant="primary" className="fw-bold rounded-pill px-4" disabled={!cloneTargetSuiteValid} onClick={confirmCloneCase}>
      {t('casos.copyCase')}
    </Button>
  </Modal.Footer>
</Modal>
<Modal show={Boolean(moveSourceCase)} onHide={() => setMoveSourceCase(null)} centered fullscreen="sm-down">
  <Modal.Header closeButton className="bg-light border-bottom text-dark">
    <Modal.Title className="fw-bold fs-6 d-flex align-items-center gap-2">
      <FileText size={18} className="text-primary" /> Mover prueba
    </Modal.Title>
  </Modal.Header>
  <Modal.Body className="text-start">
    <div className="border rounded-3 bg-light p-3 mb-3">
      <div className="font-monospace x-small fw-bold text-secondary">{moveSourceCase?.code || moveSourceCase?.id}</div>
      <div className="fw-bold text-dark">{moveSourceCase?.title}</div>
      <div className="small text-muted mt-1">La prueba se movera sin cambiar builds, ejecuciones ni historial.</div>
    </div>
    <Form.Group>
      <Form.Label className="fw-bold x-small text-muted">SUITE DESTINO</Form.Label>
      <Form.Select
        value={moveTargetSuiteId}
        onChange={(event) => setMoveTargetSuiteId(event.target.value)}
        className="bg-light border-light-subtle shadow-none text-dark fw-bold"
      >
        <option value="">{t('casos.selectSuite')}</option>
        {moveCaseDestinationSuites.map((suite: any) => (
          <option key={suite.id} value={suite.id} disabled={suite.id === moveSourceCase?.suiteId}>
            {suite.id === moveSourceCase?.suiteId ? 'Actual - ' : ''}{'- '.repeat(getSuiteDepth(suite.id))}{suite.nombre}
          </option>
        ))}
      </Form.Select>
    </Form.Group>
    {moveCaseDestinationSuites.length === 0 && (
      <div className="small text-danger mt-2">{t('casos.noDestinationSuites')}</div>
    )}
  </Modal.Body>
  <Modal.Footer className="border-0 pt-0">
    <Button variant="outline-secondary" className="fw-bold rounded-pill px-4" onClick={() => setMoveSourceCase(null)}>
      {t('common.cancel')}
    </Button>
    <Button variant="primary" className="fw-bold rounded-pill px-4" disabled={!moveTargetSuiteValid} onClick={confirmMoveCase}>
      Mover prueba
    </Button>
  </Modal.Footer>
</Modal>
<Modal show={Boolean(cloneSourceSuite)} onHide={() => setCloneSourceSuite(null)} centered fullscreen="sm-down">
  <Modal.Header closeButton className="bg-light border-bottom text-dark">
    <Modal.Title className="fw-bold fs-6 d-flex align-items-center gap-2">
      <Folders size={18} className="text-primary" /> Copiar suite completa
    </Modal.Title>
  </Modal.Header>
  <Modal.Body className="text-start">
    <div className="border rounded-3 bg-light p-3 mb-3">
      <div className="small text-muted">Suite origen</div>
      <div className="fw-bold text-dark">{cloneSourceSuite?.nombre}</div>
      <div className="small text-muted mt-1">
        Se copiaran {cloneSuiteIds.size} suite(s) y {cloneSuiteCasesCount} caso(s). No se copian builds, ejecuciones ni evidencias.
      </div>
    </div>
    <Form.Group className="mb-3">
      <Form.Label className="fw-bold x-small text-muted">NOMBRE DE LA COPIA</Form.Label>
      <Form.Control
        value={cloneSuiteName}
        onChange={(event) => setCloneSuiteName(event.target.value)}
        className="bg-light border-light-subtle shadow-none text-dark fw-bold"
        placeholder="Copia de suite"
      />
    </Form.Group>
    <Form.Group>
      <Form.Label className="fw-bold x-small text-muted">SUITE PADRE DESTINO</Form.Label>
      <Form.Select
        value={cloneSuiteParentId}
        onChange={(event) => setCloneSuiteParentId(event.target.value)}
        className="bg-light border-light-subtle shadow-none text-dark fw-bold"
      >
        <option value="">Raiz del componente</option>
        {cloneSuiteDestinationSuites.map((suite: any) => (
          <option key={suite.id} value={suite.id}>
            {'- '.repeat(getSuiteDepth(suite.id))}{suite.nombre}
          </option>
        ))}
      </Form.Select>
    </Form.Group>
  </Modal.Body>
  <Modal.Footer className="border-0 pt-0">
    <Button variant="outline-secondary" className="fw-bold rounded-pill px-4" onClick={() => setCloneSourceSuite(null)}>
      {t('common.cancel')}
    </Button>
    <Button variant="primary" className="fw-bold rounded-pill px-4" disabled={!cloneSuiteName.trim()} onClick={confirmCloneSuite}>
      Copiar suite
    </Button>
  </Modal.Footer>
</Modal>
    </>
  );
}
