import { Button, Form } from 'react-bootstrap'
import { ChevronDown, ChevronRight, Eye } from 'lucide-react'

export function TraceabilityGenerationContext({ options }: { options: any }) {
  const { generationStep, generationContextExpanded, setGenerationContextExpanded, tx, generationRun, generationInstructions, setGenerationInstructions, projectComponents, generationComponentIds, setGenerationComponentIds, generationWiki, generationWikiIds, setGenerationWikiIds, generationQuestionAnswers, setGenerationQuestionAnswers, generationBusy, generationCandidates, setAutoContinuePaused, estimateExplanationVisible, setEstimateExplanationVisible, locale } = options
  return (
    <>
              {generationStep === "context" && (
              <div className="border rounded overflow-hidden">
                <div className="bg-light border-bottom px-3 py-2 d-flex align-items-center justify-content-between">
                  <div className="fw-semibold">{tx("contextForAi")}</div>
                  <Button
                    variant="light"
                    size="sm"
                    className="border"
                    title={
                      generationContextExpanded
                        ? tx("collapseContext")
                        : tx("expandContext")
                    }
                    aria-label={
                      generationContextExpanded
                        ? tx("collapseContext")
                        : tx("expandContext")
                    }
                    onClick={() =>
                      setGenerationContextExpanded((value) => !value)
                    }
                  >
                    {generationContextExpanded ? (
                      <ChevronDown size={15} />
                    ) : (
                      <ChevronRight size={15} />
                    )}
                  </Button>
                </div>
                {generationContextExpanded && (
                  <div className="p-3 d-flex flex-column gap-3">
                    <Form.Group>
                      <Form.Label>{tx("optionalInstructions")}</Form.Label>
                      <Form.Control name="a11y-traceabilitygenerationcontexttsx-41" aria-label="Campo de formulario"
                        as="textarea"
                        rows={3}
                        disabled={Boolean(generationRun)}
                        value={generationInstructions}
                        onChange={(event) =>
                          setGenerationInstructions(event.target.value)
                        }
                        placeholder={tx("instructionsPlaceholder")}
                      />
                    </Form.Group>
                    <Form.Group>
                      <Form.Label>{tx("contextComponents")}</Form.Label>
                      <div className="d-flex flex-wrap gap-3">
                        {projectComponents.map((component) => (
                          <Form.Check name="a11y-traceabilitygenerationcontexttsx-56" aria-label="Campo de formulario"
                            key={component.id}
                            type="checkbox"
                            disabled={Boolean(generationRun)}
                            label={component.name}
                            checked={generationComponentIds.includes(
                              component.id,
                            )}
                            onChange={() =>
                              setGenerationComponentIds((previous) =>
                                previous.includes(component.id)
                                  ? previous.filter((id) => id !== component.id)
                                  : [...previous, component.id],
                              )
                            }
                          />
                        ))}
                      </div>
                    </Form.Group>
                    <Form.Group>
                      <Form.Label>{tx("optionalWiki")}</Form.Label>
                      {generationWiki.length ? (
                        <div
                          className="border rounded p-2"
                          style={{ maxHeight: "160px", overflowY: "auto" }}
                        >
                          {generationWiki.map((page) => (
                            <Form.Check name="a11y-traceabilitygenerationcontexttsx-83" aria-label="Campo de formulario"
                              key={page.id}
                              type="checkbox"
                              disabled={Boolean(generationRun)}
                              className="mb-1"
                              label={page.titulo}
                              checked={generationWikiIds.includes(page.id)}
                              onChange={() =>
                                setGenerationWikiIds((previous) =>
                                  previous.includes(page.id)
                                    ? previous.filter((id) => id !== page.id)
                                    : [...previous, page.id],
                                )
                              }
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="small text-muted">
                          No hay páginas Wiki disponibles.
                        </div>
                      )}
                    </Form.Group>
                  </div>
                )}
              </div>
              )}
              {generationRun && generationStep === "analysis" && (
                <div className="border-start border-primary border-3 bg-light px-3 py-2">
                  <div className="d-flex flex-wrap align-items-center gap-2">
                    <div className="flex-grow-1">
                      <div className="small text-uppercase text-muted fw-semibold">
                        {tx("analysisResult")}
                      </div>
                      <div className="fw-semibold">
                        {generationRun.analysis?.readiness === "READY"
                          ? tx("readyContext")
                          : generationRun.analysis?.readiness === "NEEDS_CLARIFICATION"
                            ? tx("incompleteContext")
                            : tx("blockedAnalysis")}
                      </div>
                      <div className="small text-muted">
                        {generationRun.analysis?.readiness === "READY"
                          ? tx("readyAnalysisHint")
                          : tx("incompleteAnalysisHint")}
                      </div>
                    </div>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      className="d-inline-flex align-items-center gap-1"
                      onClick={() =>
                        setEstimateExplanationVisible((value) => !value)
                      }
                    >
                      <Eye size={14} />
                      {estimateExplanationVisible
                        ? tx("hideExplanation")
                        : tx("showExplanation")}
                    </Button>
                  </div>
                  {estimateExplanationVisible && (
                    <div className="small border-top mt-2 pt-2 d-flex flex-column gap-2">
                      {!!generationRun.analysis?.ambiguities?.length && (
                        <div><span className="fw-semibold">{tx("ambiguities")}</span> {generationRun.analysis.ambiguities.join("; ")}</div>
                      )}
                      {!!generationRun.analysis?.proposed_assumptions?.length && (
                        <div><span className="fw-semibold">{tx("proposedAssumptions")}</span> {generationRun.analysis.proposed_assumptions.map((item: any) => item.text).join("; ")}</div>
                      )}
                    </div>
                  )}
                  {!!generationRun.analysis?.questions?.length && (
                    <div className="border-top mt-2 pt-2">
                      <div className="fw-semibold">{tx("answerContext")}</div>
                      <div className="small text-muted mb-2">
                        {tx("optionalAnswers")}
                      </div>
                      <div className="d-flex flex-column gap-2">
                        {generationRun.analysis.questions.map((question: string, index: number) => (
                          <Form.Group key={question}>
                            <Form.Label className="small mb-1">
                              {index + 1}. {question}
                            </Form.Label>
                            <Form.Control name="a11y-traceabilitygenerationcontexttsx-166" aria-label="Campo de formulario"
                              as="textarea"
                              rows={2}
                              value={generationQuestionAnswers[question] || ""}
                              disabled={generationBusy || generationCandidates.length > 0}
                              onChange={(event) =>
                                {
                                  setAutoContinuePaused(true);
                                  setGenerationQuestionAnswers((previous) => ({
                                    ...previous,
                                    [question]: event.target.value,
                                  }));
                                }
                              }
                              placeholder={tx("answerPlaceholder")}
                            />
                          </Form.Group>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

    </>
  )
}
