import { Badge, Button, Card, Col, Modal, Row, Table } from 'react-bootstrap'
import { ExternalLink, Eye, History } from 'lucide-react'
import { WikiMarkdownViewer } from './WikiMarkdownViewer'
import { priorityLabel, requirementStateLabel, storyStateLabel } from './traceabilityPresentation'

export function TraceabilityHistoryModals({ options }: { options: any }) {
  const { detailItem, setDetailItem, WikiMarkdownViewer, requirementById, openDetails, linkedStoryCasesLoading, linkedStoryCases, onOpenLinkedCase, ReviewPendingIcon, projectComponents, storiesForRequirement, historyEntries, setHistoryEntries, historyDiff, setHistoryDiff, historyKind, historyCode, historyTitle, historyDisplayActor, openHistoryDiff, historyDiffRows, t } = options
  return (
    <>
      <Modal
        show={Boolean(detailItem)}
        onHide={() => setDetailItem(null)}
        size="lg"
        centered
        scrollable
      >
        <Modal.Header closeButton className="border-0 pb-2">
          <Modal.Title className="fw-bold d-flex align-items-center gap-2">
            <Eye size={18} className="text-primary" />
            {detailItem?.kind === "requirement"
              ? t('proyectos.traceabilityRequirement')
              : t('proyectos.traceabilityStory')}:{" "}
            {detailItem?.item.codigo}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="pt-0">
          {detailItem && (
            <Row className="g-3">
              <Col xs={12}>
                <div className="fw-semibold fs-5">{detailItem.item.titulo}</div>
                <div className="d-flex gap-2 mt-2">
                  <Badge
                    bg={
                      detailItem.item.estado === "ACTIVO"
                        ? "success"
                        : "secondary"
                    }
                  >
                    {detailItem.kind === "requirement"
                      ? requirementStateLabel(t, detailItem.item.estado)
                      : storyStateLabel(t, detailItem.item.estado)}
                  </Badge>
                  <Badge bg="light" text="dark" className="border">
                    {t('proyectos.traceabilityPriorityValue', {
                      priority: priorityLabel(t, detailItem.item.prioridad),
                    })}
                  </Badge>
                </div>
              </Col>
              <Col xs={12}>
                <div className="small fw-bold text-uppercase text-muted mb-1">
                  {t('proyectos.traceabilityDescription')}
                </div>
                <div className="border rounded p-3 bg-light markdown-preview"><WikiMarkdownViewer content={detailItem.item.descripcion_markdown || t('proyectos.traceabilityNoDescription')} /></div>
              </Col>
              {detailItem.kind === "story" && (
                <>
                  <Col xs={12}>
                    <div className="small fw-bold text-uppercase text-muted mb-1">
                      {t('proyectos.traceabilityAcceptanceCriteria')}
                    </div>
                    <div className="border rounded p-3 bg-light markdown-preview"><WikiMarkdownViewer content={detailItem.item.criterios_aceptacion_markdown || t('proyectos.traceabilityNoAcceptanceCriteria')} /></div>
                  </Col>
                  <Col md={6}>
                    <div className="small fw-bold text-uppercase text-muted mb-1">
                      {t('proyectos.traceabilityRelatedRequirement')}
                    </div>
                    <Button
                      variant="link"
                      className="p-0 text-start"
                      onClick={() => {
                        const requirement = requirementById.get(
                          detailItem.item.requisito_id,
                        );
                        if (requirement)
                          openDetails("requirement", requirement);
                      }}
                    >
                      {requirementById.get(detailItem.item.requisito_id)
                        ?.codigo ||
                        detailItem.item.requisito_codigo ||
                        t('proyectos.traceabilityUnavailable')}
                    </Button>
                  </Col>
                  <Col md={6}>
                    <div className="small fw-bold text-uppercase text-muted mb-1">
                      {t('proyectos.traceabilityLinkedCases')}
                    </div>
                    {linkedStoryCasesLoading ? <span className="small text-muted">{t('proyectos.traceabilityLoadingCases')}</span> : linkedStoryCases.length ? <div className="d-flex flex-column gap-1">{linkedStoryCases.map((testCase) => <Button key={testCase.master_id} variant="link" className="p-0 text-start small" onClick={() => { setDetailItem(null); onOpenLinkedCase(String(testCase.master_id)); }}><strong>{testCase.codigo}</strong> · {testCase.titulo}{testCase.requiere_revision ? <span className="ms-1"><ReviewPendingIcon count={1} tooltipId={`linked-case-${testCase.master_id}-pending`} /></span> : null}</Button>)}</div> : <span className="small text-muted">{t('proyectos.traceabilityNoLinkedCases')}</span>}
                  </Col>
                </>
              )}
              {detailItem.kind === "requirement" && (
                <>
                  <Col md={6}>
                    <div className="small fw-bold text-uppercase text-muted mb-1">
                      {t('proyectos.traceabilityComponents')}
                    </div>
                    <div>
                      {(detailItem.item.componente_ids || [])
                        .map(
                          (id: string) =>
                            projectComponents.find(
                              (component) => component.id === id,
                            )?.name || t('proyectos.traceabilityNoComponent'),
                        )
                        .join(", ") || t('proyectos.traceabilityAllComponents')}
                    </div>
                  </Col>
                  <Col md={6}>
                    <div className="small fw-bold text-uppercase text-muted mb-1">
                      {t('proyectos.traceabilityLinkedStories')}
                    </div>
                    <div>
                      {storiesForRequirement(detailItem.item.id).length === 1
                        ? t('proyectos.traceabilityStoryCountOne', {
                            count: storiesForRequirement(detailItem.item.id).length,
                          })
                        : t('proyectos.traceabilityStoryCountMany', {
                            count: storiesForRequirement(detailItem.item.id).length,
                          })}
                    </div>
                  </Col>
                  <Col xs={12}>
                    <div className="small fw-bold text-uppercase text-muted mb-2">
                      {t('proyectos.traceabilityLinkedStories')}
                    </div>
                    <Table responsive size="sm" className="mb-0 border">
                      <thead>
                        <tr>
                          <th>{t('proyectos.traceabilityStory')}</th>
                          <th>{t('proyectos.traceabilityStates')}</th>
                          <th>{t('proyectos.traceabilityCases')}</th>
                          <th className="text-end">{t('proyectos.traceabilityTableView')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {storiesForRequirement(detailItem.item.id).map(
                          (story) => (
                            <tr key={story.id}>
                              <td>
                                <strong>{story.codigo}</strong> {story.titulo}
                              </td>
                              <td>
                                <Badge bg="secondary">{storyStateLabel(t, story.estado)}</Badge>
                              </td>
                              <td>{story.case_count || 0}</td>
                              <td className="text-end">
                                <Button
                                  variant="light"
                                  size="sm"
                                  className="border"
                                  title={t('proyectos.traceabilityViewStory')}
                                  aria-label={`${t('proyectos.traceabilityViewStory')} ${story.codigo}`}
                                  onClick={() => openDetails("story", story)}
                                >
                                  <Eye size={14} />
                                </Button>
                              </td>
                            </tr>
                          ),
                        )}
                        {storiesForRequirement(detailItem.item.id).length ===
                          0 && (
                          <tr>
                            <td
                              colSpan={4}
                              className="text-center text-muted py-3"
                            >
                              {t('proyectos.traceabilityNoLinkedStories')}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </Table>
                  </Col>
                </>
              )}
              {(detailItem.item.external_provider ||
                detailItem.item.external_reference ||
                detailItem.item.external_url) && (
                <Col xs={12}>
                    <div className="small fw-bold text-uppercase text-muted mb-1">
                    {t('proyectos.traceabilityExternalReference')}
                  </div>
                  {detailItem.item.external_url ? (
                    <a
                      href={detailItem.item.external_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={14} className="me-1" />
                      {detailItem.item.external_reference ||
                        detailItem.item.external_provider ||
                        detailItem.item.external_url}
                    </a>
                  ) : (
                    <span>
                      {detailItem.item.external_reference ||
                        detailItem.item.external_provider}
                    </span>
                  )}
                </Col>
              )}
            </Row>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setDetailItem(null)}>
            {t('proyectos.traceabilityClose')}
          </Button>
        </Modal.Footer>
      </Modal>
      <Modal
        show={Boolean(historyEntries) && !historyDiff}
        size="lg"
        centered
        scrollable
        contentClassName="traceability-history-modal"
        onHide={() => {
          setHistoryEntries(null);
          setHistoryDiff(null);
        }}
      >
        <Modal.Header closeButton className="border-0 pb-2">
          <Modal.Title className="d-flex align-items-center gap-2">
            <History size={18} className="text-primary" aria-hidden="true" />
            {t('proyectos.traceabilityHistoryOf', {
              kind: t(historyKind === "requisitos"
                ? 'proyectos.traceabilityRequirementKind'
                : 'proyectos.traceabilityStoryKind'),
            })}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="pt-0">
          <div className="traceability-history-subtitle mb-3">
            {historyCode && <Badge bg="light" text="dark" className="me-2">{historyCode}</Badge>}
            <span>{historyTitle}</span>
          </div>
          <div className="d-flex flex-column gap-2">
            {historyEntries?.map((entry, index) => (
              <Card key={entry.id} className="traceability-history-entry shadow-none">
                <Card.Body className="p-3">
                  <div className="d-flex align-items-start justify-content-between gap-3">
                    <div className="min-w-0">
                      <div className="small text-muted">
                        {new Date(entry.fecha_edicion).toLocaleString()}
                      </div>
                      <div className="small fw-semibold text-break">{historyDisplayActor(entry)}</div>
                    </div>
                    <div className="d-flex align-items-center gap-2 flex-shrink-0">
                  <Button
                    size="sm"
                    variant="outline-primary"
                    onClick={() => openHistoryDiff(index)}
                    disabled={!historyEntries || index >= historyEntries.length - 1}
                    title={index >= (historyEntries?.length ?? 0) - 1
                      ? t('proyectos.traceabilityNoPreviousVersion')
                      : t('proyectos.traceabilityComparePrevious')}
                  >
                    {t('proyectos.traceabilityVersionDifferences')}
                  </Button>
                  {historyEntries && index >= historyEntries.length - 1 && (
                  <span className="small text-muted text-end" title={t('proyectos.traceabilityOldestVersion')}>
                      {t('proyectos.traceabilityInitialVersion')}
                    </span>
                  )}
                    </div>
                  </div>
                </Card.Body>
              </Card>
            ))}
          </div>
        </Modal.Body>
      </Modal>
      <Modal
        show={Boolean(historyDiff)}
        onHide={() => setHistoryDiff(null)}
        size="lg"
        centered
        scrollable
        contentClassName="traceability-history-modal traceability-diff-modal"
      >
        <Modal.Header closeButton className="border-0 pb-2">
          <Modal.Title className="d-flex align-items-center gap-2">
            <History size={18} className="text-primary" aria-hidden="true" />
            <span>{t('proyectos.traceabilityVersionDifferences')}</span>
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="pt-0">
          <div className="traceability-history-subtitle mb-3">
            {historyCode && <Badge bg="light" text="dark" className="me-2">{historyCode}</Badge>}
            <span>{historyTitle}</span>
          </div>
          <div className="traceability-diff-meta mb-3">
            <div className="small text-muted">
              {t('proyectos.traceabilityModification')} {historyDiff?.current?.fecha_edicion
              ? new Date(historyDiff.current.fecha_edicion).toLocaleString()
                : "—"}
            </div>
            <div className="small text-muted">
              {historyDiff?.current?.comentario_cambio || t('proyectos.traceabilityNoChangeComment')}
            </div>
          </div>
          {historyDiff?.previous ? (
            historyDiffRows.length === 0 ? (
              <Card className="traceability-history-entry shadow-none">
                <Card.Body className="p-3 text-muted">
                {t('proyectos.traceabilityNoDifferences')}
                </Card.Body>
              </Card>
            ) : (
              historyDiffRows.map((item) => (
                <Card key={item.key} className="traceability-history-entry traceability-diff-entry shadow-none mb-3">
                  <Card.Body className="p-3">
                    <div className="small fw-semibold text-uppercase text-muted mb-3">
                      {item.label}
                    </div>
                    <Row className="g-3">
                      <Col md={6}>
                        <div className="small text-muted mb-1">{t('proyectos.traceabilityPrevious')}</div>
                        <pre className="traceability-diff-value traceability-diff-value-previous">
                          {item.previousValue || "—"}
                        </pre>
                      </Col>
                      <Col md={6}>
                        <div className="small text-muted mb-1">{t('proyectos.traceabilityCurrent')}</div>
                        <pre className="traceability-diff-value traceability-diff-value-current">
                          {item.currentValue || "—"}
                        </pre>
                      </Col>
                    </Row>
                  </Card.Body>
                </Card>
              ))
            )
          ) : (
            <Card className="traceability-history-entry shadow-none">
              <Card.Body className="p-3 text-muted">
                {t('proyectos.traceabilityNoOlderVersion')}
              </Card.Body>
            </Card>
          )}
        </Modal.Body>
      </Modal>

    </>
  )
}
