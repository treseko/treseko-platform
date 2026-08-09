import { Badge, Button, Card, Col, Form, Row } from "react-bootstrap";
import { ChevronDown, ChevronRight, FileText, Info, Tag, X } from "lucide-react";
import { RequiredLabel } from "../../shared/ui/RequiredLabel";

type Props = { context: any };

export function CaseMetadataCard({ context }: Props) {
  const {
    t, collapsedSections, setCollapsedSections, editingCaseCode, canEditCases,
    newTestTitle, setNewTestTitle, newTestTags, tagDraft, setTagDraft, commitTagDraft,
    removeTag, newTestDescription, setNewTestDescription, newTestPriority,
    setNewTestPriority, newTestCriticality, setNewTestCriticality, newTestStatus,
    setNewTestStatus, newTestType, setNewTestType, newTestPre, setNewTestPre,
    newTestPost, setNewTestPost, newTestData, setNewTestData, showFeedback,
  } = context;
  return (
    <>
    <Card className="border-0 shadow-sm rounded-3 bg-white text-start mb-3 overflow-hidden">
      <div
        className="bg-light border-bottom py-2 px-3 d-flex justify-content-between align-items-center cursor-pointer"
        onClick={() => setCollapsedSections(prev => ({ ...prev, metadata: !prev.metadata }))}
        style={{ cursor: 'pointer' }}
      >
        <h6 className="fw-bold text-dark m-0 d-flex align-items-center gap-2">
            <FileText size={18} className="text-primary"/> {t('casos.caseDefinition')}
        </h6>
        {collapsedSections.metadata ? <ChevronRight size={18} className="text-muted" /> : <ChevronDown size={18} className="text-muted" />}
      </div>
      {!collapsedSections.metadata && (
      <Card.Body className="p-3">
        <Row className="g-2">
          <Col md={8}>
            <Form.Group>
              <Form.Label className="fw-bold x-small text-muted"><RequiredLabel required>{t('casos.mainTitle')}</RequiredLabel></Form.Label>
              <div className="input-group"><span className="input-group-text bg-secondary-subtle text-secondary fw-semibold font-monospace" title={t('casos.immutableCaseCode')}>{editingCaseCode || 'TC · al guardar'}</span><Form.Control name="a11y-casemetadatacardtsx-35" aria-label="Campo de formulario" type="text" placeholder={t('casos.caseTitlePlaceholder')} value={newTestTitle} onChange={(e) => setNewTestTitle(e.target.value)} required className="bg-light border-light-subtle shadow-none fw-bold text-primary fs-6" /></div>
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label className="fw-bold x-small text-muted d-flex align-items-center gap-1">
                <Tag size={13} /> {t('casos.tags')}
              </Form.Label>
              <div className="bg-light border border-light-subtle rounded-2 p-2 d-flex flex-wrap align-items-center gap-2">
                {newTestTags.map((tag: string) => (
                  <Badge key={tag} bg="primary" className="d-inline-flex align-items-center gap-1 rounded-pill px-2 py-1">
                    {tag}
                    <button type="button" className="btn btn-link btn-sm p-0 text-white lh-1" onClick={() => removeTag(tag)} title={`Quitar ${tag}`}>
                      <X size={12} />
                    </button>
                  </Badge>
                ))}
                <Form.Control name="a11y-casemetadatacardtsx-52" aria-label="Campo de formulario"
                  value={tagDraft}
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ',') {
                      event.preventDefault()
                      commitTagDraft()
                    }
                  }}
                  onBlur={commitTagDraft}
                  placeholder={newTestTags.length ? t('casos.addAnotherTag') : t('casos.tagsPlaceholder')}
                  className="border-0 bg-transparent shadow-none p-0 flex-grow-1 small"
                  style={{ minWidth: 120 }}
                />
              </div>
            </Form.Group>
          </Col>
          <Col md={12}>
            <Form.Group>
              <Form.Label className="fw-bold x-small text-muted">{t('casos.description')}</Form.Label>
              <Form.Control name="a11y-casemetadatacardtsx-72" aria-label="Campo de formulario" as="textarea" rows={1} placeholder="Objetivo del caso o alcance funcional..." value={newTestDescription} onChange={(e) => setNewTestDescription(e.target.value)} className="bg-light border-light-subtle shadow-none text-dark" />
            </Form.Group>
          </Col>
          <Col md={3}>
            <Form.Group>
              <Form.Label className="fw-bold x-small text-muted"><RequiredLabel required>{t('casos.priority')}</RequiredLabel></Form.Label>
              <Form.Select name="a11y-casemetadatacardtsx-78" aria-label="Campo de formulario" required value={newTestPriority} onChange={(e) => setNewTestPriority(e.target.value)} className="bg-light border-light-subtle shadow-none text-dark fw-bold">
                <option value="ALTA">Alta</option>
                <option value="MEDIA">Media</option>
                <option value="BAJA">Baja</option>
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={3}>
            <Form.Group>
              <Form.Label className="fw-bold x-small text-muted">{t('casos.criticality')}</Form.Label>
              <Form.Select name="a11y-casemetadatacardtsx-88" aria-label="Campo de formulario" value={newTestCriticality} onChange={(e) => setNewTestCriticality(e.target.value)} className="bg-light border-light-subtle shadow-none text-dark fw-bold">
                <option value="CRITICA">{t('casos.critical')}</option>
                <option value="ALTA">Alta</option>
                <option value="MEDIA">Media</option>
                <option value="BAJA">Baja</option>
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={3}>
            <Form.Group>
              <Form.Label className="fw-bold x-small text-muted">{t('casos.status')}</Form.Label>
              <Form.Select name="a11y-casemetadatacardtsx-99" aria-label="Campo de formulario" value={newTestStatus} onChange={(e) => setNewTestStatus(e.target.value)} className="bg-light border-light-subtle shadow-none text-dark fw-bold">
                <option value="ACTIVO">Draft / Activo</option>
                <option value="EN_REVISION">Review</option>
                <option value="DEPRECADO">Deprecado</option>
                {newTestStatus === 'ARCHIVADO' && <option value="ARCHIVADO">Archivado</option>}
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={3}>
            <Form.Group>
              <Form.Label className="fw-bold x-small text-muted"><RequiredLabel required>{t('casos.mode')}</RequiredLabel></Form.Label>
              <Form.Select name="a11y-casemetadatacardtsx-110" aria-label="Campo de formulario" required value={newTestType} onChange={(e) => setNewTestType(e.target.value)} className="bg-primary bg-opacity-10 border-primary text-primary fw-bold shadow-none">
                <option value="AI Agent">IA</option>
                <option value="Automatizada">{t('casos.automated')}</option>
                <option value="Manual">Manual</option>
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label className="fw-bold x-small text-muted">{t('casos.preconditions')}</Form.Label>
              <Form.Control name="a11y-casemetadatacardtsx-120" aria-label="Campo de formulario" type="text" placeholder="Ej. El usuario debe estar logueado previamente" value={newTestPre} onChange={(e) => setNewTestPre(e.target.value)} className="bg-light border-light-subtle shadow-none text-dark" />
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label className="fw-bold x-small text-muted">{t('casos.postconditions')}</Form.Label>
              <Form.Control name="a11y-casemetadatacardtsx-126" aria-label="Campo de formulario" type="text" placeholder="Ej. Orden generada, usuario bloqueado..." value={newTestPost} onChange={(e) => setNewTestPost(e.target.value)} className="bg-light border-light-subtle shadow-none text-dark" />
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <div className="d-flex justify-content-between align-items-center">
                <Form.Label className="fw-bold x-small text-muted mb-1">{t('casos.specificData')}</Form.Label>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="p-0 text-primary shadow-none"
                  title={t('casos.datasetFormats')}
                  onClick={() => showFeedback(t('casos.specificData'), t('casos.specificDataHelp'), 'info')}
                >
                  <Info size={14} />
                </Button>
              </div>
              <Form.Control name="a11y-casemetadatacardtsx-144" aria-label="Campo de formulario" type="text" placeholder="Ej. usuario={{DATASET.usuario}} / perfil=admin" value={newTestData} onChange={(e) => setNewTestData(e.target.value)} className="bg-light border-light-subtle shadow-none font-monospace text-dark x-small" />
            </Form.Group>
          </Col>
        </Row>
      </Card.Body>
      )}
    </Card>
    </>
  );
}
