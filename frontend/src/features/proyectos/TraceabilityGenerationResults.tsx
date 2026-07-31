import { Fragment } from 'react'
import { Badge, Button, Col, Form, Row, Table } from 'react-bootstrap'
import { Eye } from 'lucide-react'

export function TraceabilityGenerationResults({ options }: { options: any }) {
  const { generationRun, generationStep, locale, tx, generationBusy, generationCompletedCount, generationRequestedCount, generationCandidates, preflightExcludedStories, selectedCandidateCount, generationRequirement, expandedCandidateIndexes, setExpandedCandidateIndexes, setGenerationCandidates, updateGenerationCandidate, proposalQualityMeta, hasSimilarStory, proposalQuality, AcceptanceCriteriaEditor } = options
  return (
    <>
              {generationRun && generationStep === "configuration" && (
                <div className="border-start border-primary border-3 bg-light px-3 py-3">
                  <div className="small text-uppercase text-muted fw-semibold">
                    Propuesta de alcance
                  </div>
                  <div className="fw-semibold">
                    {locale === "en" ? "AI proposes" : "La IA propone"} {generationRun.estimacion?.cantidad_recomendada || 1} {generationRun.estimacion?.cantidad_recomendada === 1 ? tx("story") : tx("stories")}
                  </div>
                  <div className="small text-muted mb-3">
                    {tx("scopeHint")}
                  </div>
                  {!!generationRun.analysis?.story_outline?.length && (
                    <div className="border rounded bg-white overflow-hidden">
                      <div className="px-3 py-2 border-bottom fw-semibold">{tx("suggestedStories")}</div>
                      {generationRun.analysis.story_outline.map((item: any, index: number) => (
                        <div key={`${item.title}-${index}`} className="px-3 py-2 border-bottom small">
                          <div className="fw-semibold">Propuesta {index + 1}: {item.title}</div>
                          {item.reason && <div className="text-muted">{item.reason}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  {generationBusy && (
                    <div className="border rounded bg-white mt-3 overflow-hidden" aria-live="polite">
                      <div className="px-3 py-2 border-bottom d-flex justify-content-between align-items-center">
                        <span className="fw-semibold">{tx("generatedDrafts")}</span>
                        <span className="small text-muted">{generationCompletedCount} de {generationRequestedCount} completados</span>
                      </div>
                      {generationCandidates.length ? (
                        generationCandidates.map((item, index) => (
                          <div key={item.local_id || index} className="px-3 py-2 border-bottom small">
                            <span className="fw-semibold">Borrador {index + 1}:</span> {item.title || item.titulo}
                          </div>
                        ))
                      ) : (
                        <div className="px-3 py-2 small text-muted">{tx("noCompleteDraft")}</div>
                      )}
                    </div>
                  )}
                  {preflightExcludedStories.length > 0 && (
                    <div className="border border-warning rounded bg-warning-subtle mt-3 overflow-hidden">
                      <div className="px-3 py-2 fw-semibold">
                        {preflightExcludedStories.length} {preflightExcludedStories.length === 1 ? tx("coveredProposal") : tx("coveredProposals")}
                      </div>
                      {preflightExcludedStories.map((item: any, index: number) => (
                        <div key={`${item.title}-${index}`} className="px-3 py-2 border-top small">
                          <span className="fw-semibold">{item.title}</span>
                          {item.similar_stories?.length > 0 && (
                            <span className="text-muted"> · existente: {item.similar_stories.map((story: any) => `${story.codigo} ${story.titulo}`).join(", ")}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {generationRun && generationStep === "review" && generationCandidates.length === 0 && preflightExcludedStories.length > 0 && (
                <div className="border border-warning rounded bg-warning-subtle px-3 py-3">
                  <div className="fw-semibold">{tx("noNewDrafts")}</div>
                  <div className="small">
                    {tx("allScopeCovered")}
                  </div>
                </div>
              )}
              {generationCandidates.length > 0 && generationStep === "review" && (
                <div className="border rounded overflow-hidden">
                  <div className="bg-light border-bottom px-3 py-2 d-flex align-items-center justify-content-between">
                    <div className="fw-semibold">
                      {tx("insertionPreview")} {" "}
                      <Badge bg="secondary">
                        {generationCandidates.length}
                      </Badge>
                    </div>
                    <span className="small text-muted">
                      {selectedCandidateCount} seleccionadas
                    </span>
                  </div>
                  <Table responsive size="sm" className="align-middle mb-0">
                    <thead>
                      <tr>
                        <th>{tx("story")}</th>
                        <th>{tx("requirement")}</th>
                        <th>{tx("state")}</th>
                        <th>{tx("cases")}</th>
                        <th className="text-end">{tx("actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {generationCandidates.map((candidate, index) => (
                        <Fragment key={`candidate-group-${index}`}>
                          <tr
                            key={`candidate-${index}`}
                            className={candidate.selected ? "" : "text-muted"}
                          >
                            <td>
                              <span className="fw-semibold">{tx("proposal")} {index + 1}</span>{" "}
                              {candidate.title}
                              <Badge bg={proposalQualityMeta(candidate).variant} className="ms-2">
                                {proposalQualityMeta(candidate).label}
                              </Badge>
                              {hasSimilarStory(candidate) && (
                                <Badge bg="warning" text="dark" className="ms-2">
                                  {candidate.similarity_check?.mode === "AI_INTENT"
                                    ? tx("coveredIntent")
                                    : tx("similarStory")}
                                </Badge>
                              )}
                              <span className="small text-muted ms-2">
                                {candidate.story_type === "USER_STORY" ? tx("userStoryType") : candidate.story_type === "TECHNICAL_STORY" ? tx("technicalStory") : candidate.story_type}
                              </span>
                            </td>
                            <td className="small">
                              {generationRequirement.codigo}
                            </td>
                            <td>
                              <Badge bg="secondary">{locale === "en" ? "DRAFT" : "BORRADOR"}</Badge>
                            </td>
                            <td>0</td>
                            <td className="text-end">
                              <Button
                                variant="light"
                                size="sm"
                                className="border me-1"
                                title={
                                  expandedCandidateIndexes.has(index)
                                    ? tx("hideDetail")
                                    : tx("viewEditDetail")
                                }
                                aria-label={
                                  expandedCandidateIndexes.has(index)
                                    ? tx("hideDetail")
                                    : tx("viewEditDetail")
                                }
                                onClick={() => setExpandedCandidateIndexes((previous) => {
                                  const next = new Set(previous);
                                  if (next.has(index)) next.delete(index);
                                  else next.add(index);
                                  return next;
                                })}
                              >
                                <Eye size={14} />
                              </Button>
                              <Button
                                variant="link"
                                size="sm"
                                className="p-0 me-2 align-baseline text-decoration-none"
                                onClick={() => setExpandedCandidateIndexes((previous) => {
                                  const next = new Set(previous);
                                  if (next.has(index)) next.delete(index);
                                  else next.add(index);
                                  return next;
                                })}
                              >
                                {expandedCandidateIndexes.has(index) ? tx("hideDetail") : tx("viewDetail")}
                              </Button>
                              <Form.Check
                                inline
                                className="d-inline-block align-middle mb-0"
                                title={
                                  proposalQuality(candidate) === "FAIL"
                                    ? candidate.selected
                                      ? tx("excludeCreation")
                                      : tx("includeCritical")
                                    : candidate.selected
                                    ? "Incluir al crear"
                                    : tx("excludeCreation")
                                }
                                aria-label={
                                  proposalQuality(candidate) === "FAIL"
                                    ? candidate.selected
                                      ? tx("excludeCriticalAria")
                                      : tx("includeCriticalAria")
                                    : candidate.selected
                                    ? "Incluir al crear"
                                    : tx("excludeCreation")
                                }
                                checked={Boolean(candidate.selected)}
                                onChange={() => {
                                  const nextSelected = !candidate.selected;
                                  setGenerationCandidates((previous) =>
                                    previous.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? {
                                          ...item,
                                          selected: nextSelected,
                                          ...(nextSelected ? {} : {
                                            quality_override_accepted: false,
                                            quality_override_reason: "",
                                          }),
                                        }
                                        : item,
                                    ),
                                  );
                                  if (nextSelected && proposalQuality(candidate) === "FAIL") {
                                    setExpandedCandidateIndexes((previous) => new Set(previous).add(index));
                                  }
                                }}
                              />
                            </td>
                          </tr>
                          {expandedCandidateIndexes.has(index) && (
                            <tr
                              key={`candidate-detail-${index}`}
                              className="bg-light"
                            >
                              <td colSpan={5} className="p-3">
                                <div className={`border rounded p-2 mb-3 small ${proposalQuality(candidate) === "FAIL" ? "border-danger bg-danger-subtle" : proposalQuality(candidate) === "WARN" ? "border-warning bg-warning-subtle" : "border-success bg-success-subtle"}`}>
                                  <span className="fw-semibold">Calidad: {proposalQualityMeta(candidate).label}.</span>
                                  {candidate.rule_findings?.length ? (
                                    <ul className="mb-0 mt-1 ps-3">
                                      {candidate.rule_findings.map((finding: any) => <li key={`${finding.code}-${finding.message}`}>{finding.message}</li>)}
                                    </ul>
                                  ) : candidate.quality?.warnings?.length ? (
                                    <div className="mt-1">{candidate.quality.warnings.join("; ")}</div>
                                  ) : (
                                    <div className="mt-1">{tx("rulesPass")}</div>
                                  )}
                                </div>
                                {hasSimilarStory(candidate) && (
                                  <div className="border border-warning rounded p-2 mb-3 small bg-warning-subtle">
                                    <span className="fw-semibold">
                                      {candidate.similarity_check?.mode === "AI_INTENT"
                                        ? tx("equivalentIntent")
                                        : tx("similarTitle")}
                                    </span>
                                    <div className="mt-1">
                                      {tx("reviewScope")}
                                    </div>
                                    <ul className="mb-0 mt-1 ps-3">
                                      {candidate.similar_stories.map((story: any) => (
                                        <li key={`${story.id}-${story.codigo}-${story.titulo}`}>
                                          <span className="fw-semibold">{story.codigo || "Historia"}</span>{" "}
                                          {story.titulo}{" "}
                                          <span className="text-muted">
                                            ({story.kind === "AI_INTENT"
                                              ? story.reason || `intención equivalente${story.confidence ? ` (${story.confidence.toLowerCase()})` : ""}`
                                              : story.kind === "EXACT" ? tx("equalTitle") : tx("similarTitleShort")})
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {proposalQuality(candidate) === "FAIL" && candidate.selected && (
                                  <div className="border border-danger rounded p-2 mb-3 small">
                                    <Form.Check
                                      id={`quality-override-${index}`}
                                      label={tx("criticalOverrideLabel")}
                                      checked={Boolean(candidate.quality_override_accepted)}
                                      onChange={(event) => updateGenerationCandidate(index, {
                                        quality_override_accepted: event.target.checked,
                                      })}
                                    />
                                    <Form.Label className="small fw-semibold mt-2 mb-1" htmlFor={`quality-override-reason-${index}`}>
                                      {tx("decisionJustification")}
                                    </Form.Label>
                                    <Form.Control
                                      id={`quality-override-reason-${index}`}
                                      size="sm"
                                      as="textarea"
                                      rows={2}
                                      placeholder={tx("decisionJustification")}
                                      value={candidate.quality_override_reason || ""}
                                      onChange={(event) => updateGenerationCandidate(index, {
                                        quality_override_reason: event.target.value,
                                      })}
                                    />
                                  </div>
                                )}
                                <Row className="g-3">
                                  <Col md={8}>
                                    <Form.Label className="small fw-semibold">
                                      {tx("title")}
                                    </Form.Label>
                                    <Form.Control
                                      size="sm"
                                      value={candidate.title}
                                      onChange={(event) =>
                                        setGenerationCandidates((previous) =>
                                          previous.map((item, itemIndex) =>
                                            itemIndex === index ? { ...item, title: event.target.value } : item,
                                          ),
                                        )
                                      }
                                    />
                                  </Col>
                                  <Col md={4}>
                                    <Form.Label className="small fw-semibold">
                                      Prioridad
                                    </Form.Label>
                                    <Form.Select
                                      size="sm"
                                      value={candidate.prioridad}
                                      onChange={(event) =>
                                        setGenerationCandidates((previous) =>
                                          previous.map((item, itemIndex) =>
                                            itemIndex === index ? { ...item, prioridad: event.target.value } : item,
                                          ),
                                        )
                                      }
                                    >
                                      {["ALTA", "MEDIA", "BAJA"].map(
                                        (priority) => (
                                          <option key={priority}>
                                            {priority}
                                          </option>
                                        ),
                                      )}
                                    </Form.Select>
                                  </Col>
                                  <Col md={6}>
                                    <Form.Label className="small fw-semibold">
                                      {tx("description")}
                                    </Form.Label>
                                    <Form.Control
                                      as="textarea"
                                      rows={4}
                                      value={candidate.description}
                                      onChange={(event) =>
                                        setGenerationCandidates((previous) =>
                                          previous.map((item, itemIndex) =>
                                            itemIndex === index ? { ...item, description: event.target.value } : item,
                                          ),
                                        )
                                      }
                                    />
                                  </Col>
                                  <Col md={6}>
                                    <Form.Label className="small fw-semibold">
                                      {tx("acceptanceMarkdown")}
                                    </Form.Label>
                                    <AcceptanceCriteriaEditor
                                      criteria={candidate.acceptance_criteria || []}
                                      onChange={(acceptance_criteria) => updateGenerationCandidate(index, { acceptance_criteria })}
                                    />
                                  </Col>
                                </Row>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
    </>
  )
}
