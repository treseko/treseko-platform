import { Badge, Button, Card, Col, Collapse, Dropdown, Form, Row, Table } from 'react-bootstrap'
import { ChevronDown, ChevronRight, ExternalLink, Eye, FilePlus2, FileText, History, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Sparkles } from 'lucide-react'
import { priorityLabel, requirementStateLabel, storyStateLabel } from './traceabilityPresentation'

export function TraceabilityTables({ options }: { options: any }) {
  const { t, archiveVisibility, setArchiveVisibility, load, loading, requirementStateFilter, setRequirementStateFilter, priorityFilter, setPriorityFilter, canEdit, openRequirement, visibleRequirements, storiesForRequirement, projectComponents, ReviewPendingIcon, openDetails, openGeneration, openStory, openHistory, setArchived, storiesExpanded, setStoriesExpanded, stories, visibleStories, storySearch, setStorySearch, requirements, storyRequirementFilter, setStoryRequirementFilter, storyStateFilter, setStoryStateFilter, requirementById, formatDateTime, changeStoryState, onCreateCaseFromStory, setCaseGenerationStory } = options
  return (
    <>
      <div className="responsive-page-toolbar traceability-toolbar mb-4 flex-shrink-0">
        <div>
          <h5 className="fw-bold text-dark m-0">{t('proyectos.tabRequirements')}</h5>
          <span className="text-muted small">
            {t('proyectos.traceabilityCoverageSubtitle')}
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
            aria-label={t('proyectos.traceabilityShowArchived')}
          >
            <option value="active">{t('proyectos.traceabilityActive')}</option>
            <option value="archived">{t('proyectos.traceabilityArchived')}</option>
            <option value="all">{t('proyectos.traceabilityAll')}</option>
          </Form.Select>
          <Form.Select
            size="sm"
            value={requirementStateFilter}
            onChange={(event) => setRequirementStateFilter(event.target.value)}
            aria-label={t('proyectos.traceabilityStates')}
          >
            <option value="">{t('proyectos.traceabilityStates')}</option>
            {["BORRADOR", "ACTIVO", "EN_REVISION", "CUMPLIDO", "ARCHIVADO"].map((item) => (
              <option key={item} value={item}>{requirementStateLabel(t, item)}</option>
            ))}
          </Form.Select>
          <Form.Select
            size="sm"
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value)}
            aria-label={t('proyectos.traceabilityPriorities')}
          >
            <option value="">{t('proyectos.traceabilityPriorities')}</option>
            {["ALTA", "MEDIA", "BAJA"].map((item) => (
              <option key={item} value={item}>{priorityLabel(t, item)}</option>
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
              <Plus size={15} /> {t('proyectos.traceabilityRequirement')}
            </Button>
          )}
        </div>
      </div>
      <Card className="border-0 shadow-sm mb-4 traceability-table-card">
        <Table responsive hover className="align-middle mb-0">
          <thead className="bg-light">
            <tr>
              <th>{t('proyectos.traceabilityRequirement')}</th>
              <th>{t('proyectos.traceabilityStates')}</th>
              <th>{t('proyectos.traceabilityComponents')}</th>
              <th>{t('proyectos.traceabilityStoriesCoverage')}</th>
              <th className="text-end">{t('proyectos.traceabilityActions')}</th>
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
                          t('proyectos.traceabilityExternalReference')}
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
                      {requirementStateLabel(t, requirement.estado)}
                    </Badge>
                  </td>
                  <td className="small">
                    {(requirement.componente_ids || [])
                      .map(
                        (id: string) =>
                          projectComponents.find((item) => item.id === id)
                            ?.name || t('proyectos.traceabilityNoComponent'),
                      )
                      .join(", ") || t('proyectos.traceabilityNoComponentDefined')}
                  </td>
                  <td>
                    <div className="small fw-semibold">
                      {relatedStories.length === 1
                        ? t('proyectos.traceabilityStoryCountOne', { count: relatedStories.length })
                        : t('proyectos.traceabilityStoryCountMany', { count: relatedStories.length })}
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
                          {t('proyectos.traceabilityCaseCount', { count: story.case_count })}
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
                        {t('proyectos.traceabilityView')} {relatedStories.length - 2}{' '}
                        {relatedStories.length - 2 === 1
                          ? t('proyectos.traceabilityMoreStory')
                          : t('proyectos.traceabilityMoreStories')}
                      </Button>
                    )}
                  </td>
                  <td className="text-end">
                    <Dropdown align="end" drop="down" className="traceability-actions-menu">
                      <Dropdown.Toggle variant="light" size="sm" className="border" aria-label={`${t('proyectos.traceabilityActions')} ${requirement.codigo}`} title={t('proyectos.traceabilityActions')}>
                        <MoreHorizontal size={15} />
                      </Dropdown.Toggle>
                      <Dropdown.Menu className="traceability-actions-dropdown" popperConfig={{ strategy: "fixed", modifiers: [{ name: "flip", enabled: false }] }}>
                        <Dropdown.Item onClick={() => openDetails("requirement", requirement)}><Eye size={14} className="me-2" />{t('proyectos.traceabilityViewRequirement')}</Dropdown.Item>
                        {canEdit && !requirement.archivado && <Dropdown.Item onClick={() => openGeneration(requirement)}><Sparkles size={14} className="me-2" />{t('proyectos.traceabilityGenerateWithAi')}</Dropdown.Item>}
                        {canEdit && !requirement.archivado && <Dropdown.Item onClick={() => openStory(undefined, requirement.id)}><FilePlus2 size={14} className="me-2" />{t('proyectos.traceabilityCreateStory')}</Dropdown.Item>}
                        <Dropdown.Item onClick={() => openHistory(requirement, "requisitos")}><History size={14} className="me-2" />{t('proyectos.history')}</Dropdown.Item>
                        {canEdit && <Dropdown.Item onClick={() => openRequirement(requirement)}><Pencil size={14} className="me-2" />{t('proyectos.traceabilityEditRequirement')}</Dropdown.Item>}
                        {canEdit && <Dropdown.Divider />}
                        {canEdit && <Dropdown.Item className="text-danger" onClick={() => setArchived(requirement, "requisitos", !requirement.archivado)}>{requirement.archivado ? t('proyectos.traceabilityRestoreRequirement') : t('proyectos.traceabilityArchiveRequirement')}</Dropdown.Item>}
                      </Dropdown.Menu>
                    </Dropdown>
                  </td>
                </tr>
              );
            })}
            {!loading && visibleRequirements.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-muted py-4">
                  {t('proyectos.traceabilityNoRequirements')}
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
                storiesExpanded ? t('proyectos.traceabilityCollapseStories') : t('proyectos.traceabilityExpandStories')
              }
              aria-label={
                storiesExpanded ? t('proyectos.traceabilityCollapseStories') : t('proyectos.traceabilityExpandStories')
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
              {t('proyectos.traceabilityStories')} <Badge bg="secondary">{stories.length}</Badge>
            </h6>
          </div>
          {storiesExpanded && (
            <span className="small text-muted">
              {t('proyectos.traceabilityVisibleCount', { count: visibleStories.length })}
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
                    <Form.Control name="a11y-traceabilitytablestsx-239" aria-label={t('common.formField')}
                      size="sm"
                      className="ps-4"
                      placeholder={t('proyectos.traceabilitySearchStories')}
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
                    aria-label={t('proyectos.traceabilityAllRequirements')}
                  >
                    <option value="">{t('proyectos.traceabilityAllRequirements')}</option>
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
                    aria-label={t('proyectos.traceabilityAllStates')}
                  >
                    <option value="">{t('proyectos.traceabilityAllStates')}</option>
                    {["BORRADOR", "LISTA_PARA_QA", "EN_PRUEBA", "ACEPTADA", "ARCHIVADA"].map(
                      (state) => (
                        <option key={state} value={state}>{storyStateLabel(t, state)}</option>
                      ),
                    )}
                  </Form.Select>
                </Col>
              </Row>
            </div>
            <Table responsive size="sm" className="align-middle mb-0">
              <thead>
                <tr>
                  <th>{t('proyectos.traceabilityStory')}</th>
                  <th>{t('proyectos.traceabilityCreated')}</th>
                  <th>{t('proyectos.traceabilityRequirement')}</th>
                  <th>{t('proyectos.traceabilityStates')}</th>
                  <th>{t('proyectos.traceabilityCases')}</th>
                  <th className="text-end">{t('proyectos.traceabilityActions')}</th>
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
                            aria-label={`${t('proyectos.traceabilityStates')} ${story.codigo}`}
                          >
                            {["BORRADOR", "LISTA_PARA_QA", "EN_PRUEBA", "ACEPTADA"].map((state) => <option key={state} value={state}>{storyStateLabel(t, state)}</option>)}
                          </Form.Select>
                        ) : <Badge bg="secondary">{storyStateLabel(t, story.estado)}</Badge>}
                      </td>
                      <td>
                        {story.case_count}{" "}
                        {story.requiere_revision_count > 0 && (
                          <ReviewPendingIcon count={story.requiere_revision_count} tooltipId={`story-${story.id}-pending`} />
                        )}
                      </td>
                      <td className="text-end">
                        <Dropdown align="end" drop="down" className="traceability-actions-menu">
                          <Dropdown.Toggle variant="light" size="sm" className="border" aria-label={`${t('proyectos.traceabilityActions')} ${story.codigo}`} title={t('proyectos.traceabilityActions')}><MoreHorizontal size={15} /></Dropdown.Toggle>
                          <Dropdown.Menu className="traceability-actions-dropdown" popperConfig={{ strategy: "fixed", modifiers: [{ name: "flip", enabled: false }] }}>
                            <Dropdown.Item onClick={() => openDetails("story", story)}><Eye size={14} className="me-2" />{t('proyectos.traceabilityViewStory')}</Dropdown.Item>
                            {canEdit && !story.archivado && <Dropdown.Item onClick={() => onCreateCaseFromStory(story, requirement)}><FilePlus2 size={14} className="me-2" />{t('proyectos.traceabilityCreateCase')}</Dropdown.Item>}
                            {canEdit && !story.archivado && <Dropdown.Item onClick={() => setCaseGenerationStory(story)}><Sparkles size={14} className="me-2" />{t('proyectos.traceabilityGenerateWithAi')}</Dropdown.Item>}
                            <Dropdown.Item onClick={() => openHistory(story, "historias")}><History size={14} className="me-2" />{t('proyectos.history')}</Dropdown.Item>
                            {canEdit && <Dropdown.Item onClick={() => openStory(story)}><Pencil size={14} className="me-2" />{t('proyectos.traceabilityEditStory')}</Dropdown.Item>}
                            {canEdit && <Dropdown.Divider />}
                            {canEdit && <Dropdown.Item className="text-danger" onClick={() => setArchived(story, "historias", !story.archivado)}>{story.archivado ? t('proyectos.traceabilityRestoreStory') : t('proyectos.traceabilityArchiveStory')}</Dropdown.Item>}
                          </Dropdown.Menu>
                        </Dropdown>
                      </td>
                    </tr>
                  );
                })}
                {visibleStories.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-muted py-3">
                      {t('proyectos.traceabilityNoStories')}
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
