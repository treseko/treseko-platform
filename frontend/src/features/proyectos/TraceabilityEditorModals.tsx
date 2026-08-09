import { Button, Col, Form, Modal, Row } from 'react-bootstrap'
import { FileText, Pencil } from 'lucide-react'
import { AcceptanceCriteriaEditor } from './AcceptanceCriteriaEditor'
import { CaseGenerationWizard } from './CaseGenerationWizard'

export function TraceabilityEditorModals({ options }: { options: any }) {
  const { showRequirementModal, setShowRequirementModal, saveRequirement, editingRequirement, tx, requirementForm, setRequirementForm, projectComponents, toggleRequirementComponent, caseGenerationStory, fetchWithAuth, setCaseGenerationStory, showFeedback, showStoryModal, setShowStoryModal, saveStory, editingStory, storyRequirementId, setStoryRequirementId, requirements, storyForm, setStoryForm, t } = options
  return (
    <>
      <Modal
        show={showRequirementModal}
        onHide={() => setShowRequirementModal(false)}
        size="lg"
        centered
        scrollable
      >
        <Form onSubmit={saveRequirement}>
          <Modal.Header closeButton className="border-0 pb-2">
            <Modal.Title className="fw-bold d-flex align-items-center gap-2">
              <FileText size={18} className="text-primary" />
              {editingRequirement ? tx("editRequirementTitle") : tx("newRequirementTitle")}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body className="pt-0">
            <Row className="g-3">
              <Col md={8}>
                <Form.Label>{tx("title")}</Form.Label>
                <Form.Control name="a11y-traceabilityeditormodalstsx-28" aria-label="Campo de formulario"
                  required
                  value={requirementForm.titulo}
                  onChange={(event) =>
                    setRequirementForm({
                      ...requirementForm,
                      titulo: event.target.value,
                    })
                  }
                />
              </Col>
              <Col md={2}>
                <Form.Label>{tx("priority")}</Form.Label>
                <Form.Select name="a11y-traceabilityeditormodalstsx-41" aria-label="Campo de formulario"
                  value={requirementForm.prioridad}
                  onChange={(event) =>
                    setRequirementForm({
                      ...requirementForm,
                      prioridad: event.target.value,
                    })
                  }
                >
                  {["ALTA", "MEDIA", "BAJA"].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={2}>
                <Form.Label>{tx("state")}</Form.Label>
                <Form.Select name="a11y-traceabilityeditormodalstsx-57" aria-label="Campo de formulario"
                  value={requirementForm.estado}
                  onChange={(event) =>
                    setRequirementForm({
                      ...requirementForm,
                      estado: event.target.value,
                    })
                  }
                >
                  {["BORRADOR", "ACTIVO", "EN_REVISION", "CUMPLIDO"].map(
                    (item) => (
                      <option key={item}>{item}</option>
                    ),
                  )}
                </Form.Select>
              </Col>
              <Col xs={12}>
                <Form.Label>{tx("descriptionMarkdown")}</Form.Label>
                <Form.Control name="a11y-traceabilityeditormodalstsx-75" aria-label="Campo de formulario"
                  as="textarea"
                  rows={6}
                  value={requirementForm.descripcion_markdown}
                  onChange={(event) =>
                    setRequirementForm({
                      ...requirementForm,
                      descripcion_markdown: event.target.value,
                    })
                  }
                />
              </Col>
              <Col md={6}>
                <Form.Label>{tx("optionalExternalTicket")}</Form.Label>
                <Form.Control name="a11y-traceabilityeditormodalstsx-89" aria-label="Campo de formulario"
                  placeholder={tx("provider")}
                  value={requirementForm.external_provider || ""}
                  onChange={(event) =>
                    setRequirementForm({
                      ...requirementForm,
                      external_provider: event.target.value,
                    })
                  }
                />
              </Col>
              <Col md={6}>
                <Form.Label>{tx("referenceUrl")}</Form.Label>
                <Form.Control name="a11y-traceabilityeditormodalstsx-102" aria-label="Campo de formulario"
                  placeholder={tx("idOrUrl")}
                  value={requirementForm.external_url || ""}
                  onChange={(event) =>
                    setRequirementForm({
                      ...requirementForm,
                      external_url: event.target.value,
                      external_reference: event.target.value,
                    })
                  }
                />
              </Col>
              <Col xs={12}>
                <Form.Label>{tx("affectedComponents")}</Form.Label>
                <div className="traceability-component-picker">
                  {projectComponents.length ? (
                    projectComponents.map((component) => (
                      <Form.Check name="a11y-traceabilityeditormodalstsx-119" aria-label="Campo de formulario"
                        key={component.id}
                        type="checkbox"
                        id={`requirement-component-${component.id}`}
                        label={component.name}
                        checked={(
                          requirementForm.componente_ids || []
                        ).includes(component.id)}
                        onChange={() =>
                          toggleRequirementComponent(component.id)
                        }
                      />
                    ))
                  ) : (
                    <span className="small text-muted">
                      No hay componentes disponibles en este proyecto.
                    </span>
                  )}
                </div>
              </Col>
            </Row>
          </Modal.Body>
          <Modal.Footer>
            <Button
              variant="secondary"
              onClick={() => setShowRequirementModal(false)}
            >
              {t('proyectos.cancel')}
            </Button>
            <Button type="submit">{t('proyectos.save')}</Button>
          </Modal.Footer>
        </Form>
      </Modal>
      {caseGenerationStory && <CaseGenerationWizard story={caseGenerationStory} fetchWithAuth={fetchWithAuth} onClose={() => setCaseGenerationStory(null)} onApplied={(count) => { setCaseGenerationStory(null); showFeedback(tx("casesCreatedTitle"), tx("casesCreatedMessage", { count }), "success"); }} />}
      <Modal
        show={showStoryModal}
        onHide={() => setShowStoryModal(false)}
        size="lg"
        centered
        scrollable
      >
        <Form onSubmit={saveStory}>
          <Modal.Header closeButton className="border-0 pb-2">
            <Modal.Title className="fw-bold d-flex align-items-center gap-2">
              <Pencil size={18} className="text-primary" />
              {editingStory ? tx("editStoryTitle") : tx("newStoryTitle")}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body className="pt-0">
            <Row className="g-3">
              <Col md={8}>
                <Form.Label>{tx("requirement")}</Form.Label>
                <Form.Select name="a11y-traceabilityeditormodalstsx-171" aria-label="Campo de formulario"
                  required
                  value={storyRequirementId}
                  disabled={Boolean(editingStory)}
                  onChange={(event) =>
                    setStoryRequirementId(event.target.value)
                  }
                >
                  {!editingStory && (
                    <option value="">{tx("selectRequirement")}</option>
                  )}
                  {requirements.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.codigo} - {item.titulo}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={2}>
                <Form.Label>{tx("priority")}</Form.Label>
                <Form.Select name="a11y-traceabilityeditormodalstsx-191" aria-label="Campo de formulario"
                  value={storyForm.prioridad}
                  onChange={(event) =>
                    setStoryForm({
                      ...storyForm,
                      prioridad: event.target.value,
                    })
                  }
                >
                  {["ALTA", "MEDIA", "BAJA"].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={2}>
                <Form.Label>{tx("state")}</Form.Label>
                <Form.Select name="a11y-traceabilityeditormodalstsx-207" aria-label="Campo de formulario"
                  value={storyForm.estado}
                  onChange={(event) =>
                    setStoryForm({ ...storyForm, estado: event.target.value })
                  }
                >
                  {["BORRADOR", "LISTA_PARA_QA", "EN_PRUEBA", "ACEPTADA"].map(
                    (item) => (
                      <option key={item}>{item}</option>
                    ),
                  )}
                </Form.Select>
              </Col>
              <Col xs={12}>
                <Form.Label>{tx("title")}</Form.Label>
                <Form.Control name="a11y-traceabilityeditormodalstsx-222" aria-label="Campo de formulario"
                  required
                  value={storyForm.titulo}
                  onChange={(event) =>
                    setStoryForm({ ...storyForm, titulo: event.target.value })
                  }
                />
              </Col>
              <Col xs={12}>
                <Form.Label>{editingStory ? tx("descriptionMarkdown") : tx("userStory")}</Form.Label>
                {!editingStory && <div className="border-start border-primary border-3 ps-3 py-1 mb-2 small text-muted"><strong className="text-dark d-block">{tx("recommendedFormatLabel")}</strong>{tx("userStoryExample")}</div>}
                <Form.Control name="a11y-traceabilityeditormodalstsx-233" aria-label="Campo de formulario"
                  as="textarea"
                  rows={4}
                  value={storyForm.descripcion_markdown}
                  placeholder={editingStory ? undefined : tx("storyExample")}
                  onChange={(event) =>
                    setStoryForm({
                      ...storyForm,
                      descripcion_markdown: event.target.value,
                    })
                  }
                />
              </Col>
              <Col xs={12}>
                <Form.Label>{editingStory ? tx("acceptanceMarkdown") : tx("structuredAcceptance")}</Form.Label>
                {!editingStory && <><p className="small text-muted mb-2">{tx("acceptanceHintShort")}</p><AcceptanceCriteriaEditor criteria={storyForm.acceptance_criteria || []} onChange={(acceptance_criteria) => setStoryForm({ ...storyForm, acceptance_criteria })} /></>}
                {editingStory &&
                <Form.Control name="a11y-traceabilityeditormodalstsx-250" aria-label="Campo de formulario"
                  as="textarea"
                  rows={4}
                  value={storyForm.criterios_aceptacion_markdown}
                  onChange={(event) =>
                    setStoryForm({
                      ...storyForm,
                      criterios_aceptacion_markdown: event.target.value,
                    })
                  }
                />}
              </Col>
              <Col md={6}>
                <Form.Label>{tx("externalProvider")}</Form.Label>
                <Form.Control name="a11y-traceabilityeditormodalstsx-264" aria-label="Campo de formulario"
                  value={storyForm.external_provider || ""}
                  onChange={(event) =>
                    setStoryForm({
                      ...storyForm,
                      external_provider: event.target.value,
                    })
                  }
                />
              </Col>
              <Col md={6}>
                <Form.Label>{tx("externalUrl")}</Form.Label>
                <Form.Control name="a11y-traceabilityeditormodalstsx-276" aria-label="Campo de formulario"
                  type="url"
                  value={storyForm.external_url || ""}
                  onChange={(event) =>
                    setStoryForm({
                      ...storyForm,
                      external_url: event.target.value,
                    })
                  }
                />
              </Col>
            </Row>
          </Modal.Body>
          <Modal.Footer>
            <Button
              variant="secondary"
              onClick={() => setShowStoryModal(false)}
            >
              {t('proyectos.cancel')}
            </Button>
            <Button type="submit">{t('proyectos.save')}</Button>
          </Modal.Footer>
        </Form>
      </Modal>

    </>
  )
}
