import { Badge, Button, Card, Col, Collapse, Dropdown, Form, Row, Table } from 'react-bootstrap'
import { ChevronDown, ChevronRight, ExternalLink, Eye, FilePlus2, FileText, History, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Sparkles } from 'lucide-react'

export function TraceabilityTables({ options }: { options: any }) {
  const { t, tx, archiveVisibility, setArchiveVisibility, load, loading, requirementStateFilter, setRequirementStateFilter, priorityFilter, setPriorityFilter, canEdit, openRequirement, visibleRequirements, storiesForRequirement, projectComponents, ReviewPendingIcon, openDetails, openGeneration, openStory, openHistory, setArchived, storiesExpanded, setStoriesExpanded, stories, visibleStories, storySearch, setStorySearch, requirements, storyRequirementFilter, setStoryRequirementFilter, storyStateFilter, setStoryStateFilter, requirementById, formatDateTime, changeStoryState, onCreateCaseFromStory, setCaseGenerationStory } = options
  return (
    <>
      <div className="responsive-page-toolbar traceability-toolbar mb-4 flex-shrink-0">
        <div>
          <h5 className="fw-bold text-dark m-0">{t('proyectos.tabRequirements')}</h5>
          <span className="text-muted small">
            {tx("coverageSubtitle")}
          </span>
        </div>
        <div className="traceability-toolbar-actions">
          <Form.Select
            size="sm"
            value={archiveVisibility}
            onChange={(event) => {
              const visibility = event.target.value as "active" | "archived" | "all";
              setArchiveVisibility(visibility);
              void load(true, visibility);
            }}
            aria-label={tx("showArchived")}
          >
            <option value="active">{tx("active")}</option>
            <option value="archived">{tx("archived")}</option>
            <option value="all">{tx("all")}</option>
          </Form.Select>
          <Form.Select
            size="sm"
            value={requirementStateFilter}
            onChange={(event) => setRequirementStateFilter(event.target.value)}
            aria-label={tx("states")}
          >
            <option value="">{tx("states")}</option>
            {["BORRADOR", "ACTIVO", "EN_REVISION", "CUMPLIDO", "ARCHIVADO"].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </Form.Select>
          <Form.Select
            size="sm"
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value)}
            aria-label={tx("priorities")}
          >
            <option value="">{tx("priorities")}</option>
            {["ALTA", "MEDIA", "BAJA"].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </Form.Select>
          <Button
            variant="outline-secondary"
            size="sm"
            className="rounded-pill shadow-none"
            onClick={() => load(true)}
            disabled={loading}
            title={t('proyectos.refresh')}
            aria-label={t('proyectos.refresh')}
          >
            <RefreshCw size={15} />
          </Button>
          {canEdit && (
            <Button
              variant="primary"
              size="sm"
              className="fw-bold rounded-pill px-3 shadow-sm d-flex align-items-center gap-1"
              onClick={() => openRequirement()}
            >
              <Plus size={15} /> {tx("requirement")}
            </Button>
          )}
        </div>
      </div>
      <Card className="border-0 shadow-sm mb-4 traceability-table-card">
        <Table responsive hover className="align-middle mb-0">
          <thead className="bg-light">
            <tr>
              <th>{tx("requirement")}</th>
              <th>{tx("state")}</th>
              <th>{tx("components")}</th>
              <th>{tx("storiesCoverage")}</th>
              <th className="text-end">{tx("actions")}</th>
            </tr>
          </thead>
          <tbody>
            {visibleRequirements.map((requirement) => {
              const relatedStories = storiesForRequirement(requirement.id);
              return (
                <tr key={requirement.id}>
                  <td>
                    <div className="fw-semibold">
                      {requirement.codigo} - {requirement.titulo}
                    </div>
                    {requirement.external_url && (
                      <a
                        href={requirement.external_url}
                        target="_blank"
                        rel="noreferrer"
                        className="small"
                      >
                        <ExternalLink size={12} className="me-1" />
                        {requirement.external_reference ||
                          requirement.external_provider ||
                          tx("externalReference")}
                      </a>
                    )}
                  </td>
                  <td>
                    <Badge
                      bg={
                        requirement.estado === "ACTIVO"
                          ? "success"
                          : "secondary"
                      }
                    >
                      {requirement.estado}
                    </Badge>
                  </td>
                  <td className="small">
                    {(requirement.componente_ids || [])
                      .map(
                        (id: string) =>
                          projectComponents.find((item) => item.id === id)
                            ?.name || tx("noComponent"),
                      )
                      .join(", ") || tx("noComponentDefined")}
                  </td>
                  <td>
                    <div className="small fw-semibold">
                      {relatedStories.length} {relatedStories.length === 1 ? tx("story") : tx("stories")}
                    </div>
                    {relatedStories.slice(0, 2).map((story) => (
                      <div
                        key={story.id}
                        className="small mt-1 d-flex gap-1 align-items-center"
                      >
                        <Badge
                          bg={
                            story.requiere_revision_count ? "warning" : "light"
                          }
                          text={
                            story.requiere_revision_count ? "dark" : "secondary"
                          }
                        >
                          {story.codigo}
                        </Badge>
                        <span>{story.titulo}</span>
                        <span className="text-muted">
                          {story.case_count} casos
                        </span>
                        {story.requiere_revision_count > 0 && (
                          <ReviewPendingIcon count={story.requiere_revision_count} tooltipId={`requirement-story-${story.id}-pending`} />
                        )}
                      </div>
                    ))}
                    {relatedStories.length > 2 && (
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0 small text-decoration-none"
                        onClick={() => openDetails("requirement", requirement)}
                      >
                        {tx("view")} {relatedStories.length - 2} {relatedStories.length - 2 === 1 ? tx("moreStory") : tx("moreStories")}
                      </Button>
                    )}
                  </td>
                  <td className="text-end">
                    <Dropdown align="end" drop="down" className="traceability-actions-menu">
                      <Dropdown.Toggle variant="light" size="sm" className="border" aria-label={`${tx("actions")} ${requirement.codigo}`} title={tx("actions")}>
                        <MoreHorizontal size={15} />
                      </Dropdown.Toggle>
                      <Dropdown.Menu className="traceability-actions-dropdown" popperConfig={{ strategy: "fixed", modifiers: [{ name: "flip", enabled: false }] }}>
                        <Dropdown.Item onClick={() => openDetails("requirement", requirement)}><Eye size={14} className="me-2" />{tx("viewRequirement")}</Dropdown.Item>
                        {canEdit && !requirement.archivado && <Dropdown.Item onClick={() => openGeneration(requirement)}><Sparkles size={14} className="me-2" />{tx("generateWithAi")}</Dropdown.Item>}
                        {canEdit && !requirement.archivado && <Dropdown.Item onClick={() => openStory(undefined, requirement.id)}><FilePlus2 size={14} className="me-2" />{tx("createStory")}</Dropdown.Item>}
                        <Dropdown.Item onClick={() => openHistory(requirement, "requisitos")}><History size={14} className="me-2" />{t('proyectos.history')}</Dropdown.Item>
                        {canEdit && <Dropdown.Item onClick={() => openRequirement(requirement)}><Pencil size={14} className="me-2" />{tx("editRequirement")}</Dropdown.Item>}
                        {canEdit && <Dropdown.Divider />}
                        {canEdit && <Dropdown.Item className="text-danger" onClick={() => setArchived(requirement, "requisitos", !requirement.archivado)}>{requirement.archivado ? tx("restoreRequirement") : tx("archiveRequirement")}</Dropdown.Item>}
                      </Dropdown.Menu>
                    </Dropdown>
                  </td>
                </tr>
              );
            })}
            {!loading && visibleRequirements.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-muted py-4">
                  {tx("noRequirements")}
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
      <Card className="border-0 shadow-sm traceability-table-card">
        <Card.Header className="bg-light border-bottom py-2 px-3 d-flex align-items-center justify-content-between">
          <div className="d-flex align-items-center gap-2">
            <Button
              variant="light"
              size="sm"
              className="border"
              title={
                storiesExpanded ? tx("collapseStories") : tx("expandStories")
              }
              aria-label={
                storiesExpanded ? tx("collapseStories") : tx("expandStories")
              }
              aria-expanded={storiesExpanded}
              onClick={() => setStoriesExpanded((value) => !value)}
            >
              {storiesExpanded ? (
                <ChevronDown size={15} />
              ) : (
                <ChevronRight size={15} />
              )}
            </Button>
            <h6 className="fw-bold mb-0">
              {tx("stories")} <Badge bg="secondary">{stories.length}</Badge>
            </h6>
          </div>
          {storiesExpanded && (
            <span className="small text-muted">
              {visibleStories.length} {tx("visible")}
            </span>
          )}
        </Card.Header>
        <Collapse in={storiesExpanded}>
          <div>
            <div className="p-3 border-bottom bg-white">
              <Row className="g-2">
                <Col md={5}>
                  <div className="position-relative">
                    <Search
                      size={15}
                      className="position-absolute top-50 start-0 translate-middle-y ms-2 text-muted"
                    />
                    <Form.Control
                      size="sm"
                      className="ps-4"
                      placeholder={tx("searchStories")}
                      value={storySearch}
                      onChange={(event) => setStorySearch(event.target.value)}
                    />
                  </div>
                </Col>
                <Col md={4}>
                  <Form.Select
                    size="sm"
                    value={storyRequirementFilter}
                    onChange={(event) =>
                      setStoryRequirementFilter(event.target.value)
                    }
                    aria-label={tx("allRequirements")}
                  >
                    <option value="">{tx("allRequirements")}</option>
                    {requirements.map((requirement) => (
                      <option key={requirement.id} value={requirement.id}>
                        {requirement.codigo} - {requirement.titulo}
                      </option>
                    ))}
                  </Form.Select>
                </Col>
                <Col md={3}>
                  <Form.Select
                    size="sm"
                    value={storyStateFilter}
                    onChange={(event) =>
                      setStoryStateFilter(event.target.value)
                    }
                    aria-label={tx("allStates")}
                  >
                    <option value="">{tx("allStates")}</option>
                    {["BORRADOR", "LISTA_PARA_QA", "EN_PRUEBA", "ACEPTADA", "ARCHIVADA"].map(
                      (state) => (
                        <option key={state}>{state}</option>
                      ),
                    )}
                  </Form.Select>
                </Col>
              </Row>
            </div>
            <Table responsive size="sm" className="align-middle mb-0">
              <thead>
                <tr>
                  <th>{tx("story")}</th>
                  <th>{tx("created")}</th>
                  <th>{tx("requirement")}</th>
                  <th>{tx("state")}</th>
                  <th>{tx("cases")}</th>
                  <th className="text-end">{tx("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleStories.map((story) => {
                  const requirement = requirementById.get(story.requisito_id);
                  return (
                    <tr key={story.id}>
                      <td style={{ maxWidth: "520px" }}>
                        <div
                          className="text-truncate"
                          title={`${story.codigo} ${story.titulo}`}
                        >
                          <strong>{story.codigo}</strong> {story.titulo}
                        </div>
                        {story.external_url && (
                          <a
                            href={story.external_url}
                            target="_blank"
                            rel="noreferrer"
                            className="ms-1"
                          >
                            <ExternalLink size={12} />
                          </a>
                        )}
                      </td>
                      <td className="small text-nowrap" title={formatDateTime(story.fecha_creacion)}>
                        {formatDateTime(story.fecha_creacion) || "—"}
                      </td>
                      <td className="small">
                        {requirement?.codigo || story.requisito_codigo}
                      </td>
                      <td>
                        {canEdit && !story.archivado ? (
                          <Form.Select
                            size="sm"
                            value={story.estado}
                            onChange={(event) => void changeStoryState(story, event.target.value)}
                            aria-label={`${tx("state")} ${story.codigo}`}
                          >
                            {["BORRADOR", "LISTA_PARA_QA", "EN_PRUEBA", "ACEPTADA"].map((state) => <option key={state} value={state}>{state.replaceAll("_", " ")}</option>)}
                          </Form.Select>
                        ) : <Badge bg="secondary">{story.estado}</Badge>}
                      </td>
                      <td>
                        {story.case_count}{" "}
                        {story.requiere_revision_count > 0 && (
                          <ReviewPendingIcon count={story.requiere_revision_count} tooltipId={`story-${story.id}-pending`} />
                        )}
                      </td>
                      <td className="text-end">
                        <Dropdown align="end" drop="down" className="traceability-actions-menu">
                          <Dropdown.Toggle variant="light" size="sm" className="border" aria-label={`${tx("actions")} ${story.codigo}`} title={tx("actions")}><MoreHorizontal size={15} /></Dropdown.Toggle>
                          <Dropdown.Menu className="traceability-actions-dropdown" popperConfig={{ strategy: "fixed", modifiers: [{ name: "flip", enabled: false }] }}>
                            <Dropdown.Item onClick={() => openDetails("story", story)}><Eye size={14} className="me-2" />{tx("viewStory")}</Dropdown.Item>
                            {canEdit && !story.archivado && <Dropdown.Item onClick={() => onCreateCaseFromStory(story, requirement)}><FilePlus2 size={14} className="me-2" />{tx("createCase")}</Dropdown.Item>}
                            {canEdit && !story.archivado && <Dropdown.Item onClick={() => setCaseGenerationStory(story)}><Sparkles size={14} className="me-2" />{tx("generateWithAi")}</Dropdown.Item>}
                            <Dropdown.Item onClick={() => openHistory(story, "historias")}><History size={14} className="me-2" />{t('proyectos.history')}</Dropdown.Item>
                            {canEdit && <Dropdown.Item onClick={() => openStory(story)}><Pencil size={14} className="me-2" />{tx("editStory")}</Dropdown.Item>}
                            {canEdit && <Dropdown.Divider />}
                            {canEdit && <Dropdown.Item className="text-danger" onClick={() => setArchived(story, "historias", !story.archivado)}>{story.archivado ? tx("restoreStory") : tx("archiveStory")}</Dropdown.Item>}
                          </Dropdown.Menu>
                        </Dropdown>
                      </td>
                    </tr>
                  );
                })}
                {visibleStories.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-muted py-3">
                      {tx("noStories")}
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          </div>
        </Collapse>
      </Card>
    </>
  )
}
