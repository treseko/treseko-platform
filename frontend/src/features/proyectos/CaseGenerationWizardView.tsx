import { Alert, Badge, Button, Form, Modal, ProgressBar, Spinner } from 'react-bootstrap'
import { Sparkles } from 'lucide-react'

export function CaseGenerationWizardView({ options }: { options: any }) {
  const { t, step, busy, busyMessage, elapsedSeconds, error, run, duplicateReviewOpen, onClose, story, structured, components, componentId, setSelectedComponent, availableSuites, suiteId, setSelectedSuite, suitePathById, selectedSuite, selectedComponent, instructions, setInstructions, answers, setAnswers, plannedScenarios, selectedScenarioIds, toggleScenario, toggle, duplicateSignals, setDuplicateDetail, duplicateReasons, setDuplicateReasons, requiresDuplicateDecision, failReasons, setFailReasons, estimate, confirm, generate, apply, duplicateDetail } = options
  return (
    <Modal show={!duplicateReviewOpen} onHide={onClose} size="xl" scrollable centered>
      <Modal.Header closeButton className="border-0 pb-2">
        <Modal.Title className="fw-bold d-flex align-items-center gap-2">
          <Sparkles size={18} className="text-primary" />
          {t('proyectos.caseGenerationTitle')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="d-flex gap-2 small mb-3" aria-label={t('proyectos.caseGenerationStepAria', { step })}>
          {[
            t('proyectos.stepContext'),
            t('proyectos.stepAnalysis'),
            t('proyectos.stepCoverage'),
            t('proyectos.stepCases'),
            t('proyectos.stepApply'),
          ].map((label, i) => (
            <span
              key={label}
              className={`border rounded px-2 py-1 ${i + 1 === step
                ? "bg-primary text-white border-primary"
                : i + 1 < step
                  ? "bg-light text-muted"
                  : "text-muted"}`}
            >
              {i + 1}. {label}
            </span>
          ))}
        </div>

        {busy && (
          <div className="border rounded bg-light px-3 py-2 mb-3" aria-live="polite">
            <div className="d-flex align-items-center gap-2">
              <Spinner animation="border" variant="primary" size="sm" role="status">
                <span className="visually-hidden">{t('proyectos.caseGenerationProcessing')}</span>
              </Spinner>
              <div className="flex-grow-1">
                <span className="fw-semibold">{t('proyectos.iaWorking')}</span>
                <span className="text-muted small ms-2">{busyMessage}</span>
              </div>
              <span className="small text-muted">{elapsedSeconds}s</span>
            </div>
            <ProgressBar now={100} striped animated className="mt-2" visuallyHidden />
          </div>
        )}

        {error && <div className="alert alert-danger" role="alert">{error}</div>}

        {!run && (
          <>
            <p className="text-muted">{t('proyectos.caseGenerationDescription', { code: story.codigo, title: story.titulo })}</p>
            <div className="border rounded p-3 mb-3 bg-light">
              <div className="d-flex justify-content-between gap-2">
                <strong>{t('proyectos.acceptanceCriteria')}</strong>
                <Badge bg={structured ? "success" : "warning"} text={structured ? undefined : "dark"}>
                  {structured ? t('proyectos.structured') : t('proyectos.pendingStructuring')}
                </Badge>
              </div>
              <p className="mb-0 mt-2 small">
                {structured
                  ? t('proyectos.caseGenerationCriteriaAvailable', { count: story.criterios_estructurados_count })
                  : t('proyectos.caseGenerationCriteriaUnstructured')}
              </p>
            </div>
            {!structured && (
              <Alert variant="warning" className="small">
                {t('proyectos.caseGenerationCannotAnalyze')}
              </Alert>
            )}

            <div className="border rounded p-3 mb-3">
              <div className="fw-semibold mb-1">{t('proyectos.caseGenerationRequiredDestination')}</div>
              <p className="small text-muted mb-3">
                {t('proyectos.caseGenerationLocationHint')}
              </p>
              <div className="row g-3">
                <div className="col-md-6">
                  <Form.Label>{t('proyectos.caseGenerationComponentLabel')} <span className="text-danger">*</span></Form.Label>
                  <Form.Select
                    value={componentId}
                    onChange={(event) => setSelectedComponent(event.target.value)}
                    required>
                    <option value="">{t('proyectos.caseGenerationSelectComponent')}</option>
                    {components.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}
                  </Form.Select>
                </div>
                <div className="col-md-6">
                  <Form.Label>{t('proyectos.caseGenerationSuiteLabel')} <span className="text-danger">*</span></Form.Label>
                  <Form.Select
                    value={suiteId}
                    onChange={(event) => setSelectedSuite(event.target.value)}
                    required>
                    <option value="">{t('proyectos.caseGenerationSelectSuite')}</option>
                    {availableSuites.map((item) => (
                      <option key={item.id} value={item.id}>
                        {suitePathById[item.id] || item.nombre}
                      </option>
                    ))}
                  </Form.Select>
                </div>
              </div>
              <div className="small text-muted mt-2">
                {t('proyectos.caseGenerationDestinationFormat', {
                  suite: selectedSuite ? (suitePathById[selectedSuite.id] || selectedSuite.nombre) : t('proyectos.caseGenerationPending'),
                  component: selectedComponent ? selectedComponent.nombre : t('proyectos.caseGenerationComponentPending'),
                })}
              </div>
            </div>

            <Form.Group>
              <Form.Label>{t('proyectos.caseGenerationFocusLabel')} <span className="text-muted">{t('proyectos.caseGenerationOptional')}</span></Form.Label>
              <Form.Control
                as="textarea"
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                maxLength={4000}
                placeholder={t('proyectos.caseGenerationFocusPlaceholder')}
              />
            </Form.Group>
          </>
        )}

        {run && step === 2 && (
          <>
            <h6>{t('proyectos.caseGenerationAnalysisTitle')}</h6>
            <p>{run.analysis?.readiness === "BLOCKED" ? t('proyectos.caseGenerationAnalysisBlocked') : t('proyectos.caseGenerationAnalysisPrompt')}</p>
            {(run.analysis?.questions || []).map((question: string) => (
              <Form.Group key={question} className="mb-2">
                <Form.Label>{question}</Form.Label>
                <Form.Control
                  value={answers[question] || ""}
                  onChange={(event) => setAnswers({ ...answers, [question]: event.target.value })}
                />
              </Form.Group>
            ))}
            {(run.analysis?.proposed_assumptions || []).map((item: any) => (
              <div key={item.id} className="small border rounded p-2 mb-2">
                <Badge bg="warning" text="dark">{item.risk}</Badge> {item.text}
              </div>
            ))}
          </>
        )}

        {run && step === 3 && (
          <>
            <h6>{t('proyectos.caseGenerationCoverageTitle')}</h6>
            <p className="text-muted">{t('proyectos.caseGenerationCoverageHint')}</p>
            {plannedScenarios.length
              ? plannedScenarios.map((item: any) => (
                <details key={item.local_id} className="border rounded p-2 mb-2">
                  <summary className="d-flex align-items-center gap-2">
                    <Form.Check
                      aria-label={t('proyectos.caseGenerationSelectAria', { title: item.title })}
                      checked={selectedScenarioIds.includes(item.local_id)}
                      onChange={() => toggleScenario(item.local_id)}
                      onClick={(event) => event.stopPropagation()}
                    />
                    <strong>{item.title}</strong>
                    <Badge bg="secondary">{item.category}</Badge>
                  </summary>
                  <div className="small mt-2 ms-4">
                    {item.objective || t('proyectos.caseGenerationNoObjective')}
                    <br />
                    {t('proyectos.caseGenerationCriteriaLinked')} {(item.criterion_refs || []).join(", ") || t('proyectos.caseGenerationPendingValidation')}
                  </div>
                </details>
              ))
              : <Alert variant="warning">{t('proyectos.caseGenerationNoCoverage')}</Alert>}
          </>
        )}

        {run && step === 4 && (
          <>
            <h6>{t('proyectos.caseGenerationPreviewTitle')}</h6>
            <p className="text-muted small">{t('proyectos.caseGenerationPreviewHint')}</p>
            {(run.propuestas || []).map((item: any, index: number) => (
              <details open className="border rounded mb-3 bg-white" key={item.local_id}>
                <summary className="p-3 d-flex align-items-center gap-2">
                  <Form.Check
                    aria-label={t('proyectos.caseGenerationIncludeAria', { title: item.title })}
                    checked={Boolean(item.selected)}
                    onChange={() => toggle(index)}
                    onClick={(event) => event.stopPropagation()}
                  />
                  <strong className="flex-grow-1">{item.title}</strong>
                  <Badge bg="secondary">{item.category}</Badge>
                  <Badge bg="light" text="dark" className="border">{t('proyectos.caseGenerationPriority')} {item.priority}</Badge>
                  <Badge bg="light" text="dark" className="border">{item.criticality}</Badge>
                  <Badge bg={item.quality?.testability === "FAIL" ? "danger" : item.quality?.testability === "PASS" ? "success" : "warning"}>
                    {item.quality?.testability || "WARN"}
                  </Badge>
                  {duplicateSignals(item).length ? (
                    <Button
                      type="button"
                      size="sm"
                      variant={duplicateSignals(item).some((signal: any) => signal.severity === "EXACT") ? "danger" : "warning"}
                      className="py-0"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setDuplicateDetail(item);
                      }}
                    >
                      {duplicateSignals(item).some((signal: any) => signal.severity === "EXACT") ? "DUPLICADO" : "POSIBLE DUPLICADO"}
                    </Button>
                  ) : null}
                </summary>
                <div className="border-top p-3 small">
                  <div className="mb-3">
                    <div className="text-uppercase text-muted fw-semibold small">{t('proyectos.caseGenerationObjective')}</div>
                    <div>{item.objective || t('proyectos.caseGenerationNoObjectiveSpecified')}</div>
                  </div>
                  <div className="row g-3 mb-3">
                    <div className="col-md-6">
                      <div className="text-uppercase text-muted fw-semibold small mb-1">{t('proyectos.caseGenerationPreconditions')}</div>
                      {item.preconditions?.length
                        ? <ul className="mb-0 ps-3">{item.preconditions.map((value: string, itemIndex: number) => <li key={itemIndex}>{value}</li>)}</ul>
                        : <span className="text-muted">{t('proyectos.caseGenerationNoPreconditions')}</span>}
                    </div>
                    <div className="col-md-6">
                      <div className="text-uppercase text-muted fw-semibold small mb-1">{t('proyectos.caseGenerationTestData')}</div>
                      {item.test_data?.length
                        ? <ul className="mb-0 ps-3">{item.test_data.map((data: any, itemIndex: number) => <li key={itemIndex}><strong>{data.key}:</strong> {data.value}</li>)}</ul>
                        : <span className="text-muted">{t('proyectos.caseGenerationNoTestData')}</span>}
                    </div>
                  </div>
                  <div className="text-uppercase text-muted fw-semibold small mb-1">{t('proyectos.caseGenerationStepsTitle')}</div>
                  <div className="table-responsive">
                    <table className="table table-sm table-bordered mb-3">
                      <thead className="table-light">
                        <tr>
                          <th style={{ width: "56px" }}>#</th>
                          <th>{t('proyectos.caseGenerationAction')}</th>
                          <th>{t('proyectos.caseGenerationData')}</th>
                          <th>{t('proyectos.caseGenerationExpectedResult')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {item.steps?.map((caseStep: any) => (
                          <tr key={caseStep.number}>
                            <td>{caseStep.number}</td>
                            <td>{caseStep.action}</td>
                            <td>{caseStep.data || "—"}</td>
                            <td>{caseStep.expected_result}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="text-uppercase text-muted fw-semibold small mb-1">{t('proyectos.caseGenerationTraceability')}</div>
                  <div>{t('proyectos.caseGenerationCriteriaCount', { count: item.criterion_refs?.length || 0 })}</div>
                  {item.selected && requiresDuplicateDecision(item) ? (
                    <Form.Group className="mt-3">
                      <Form.Label className="small">{t('proyectos.caseGenerationDuplicateJustification')}</Form.Label>
                      <Form.Control
                        required
                        value={duplicateReasons[item.local_id] || ""}
                        onChange={(event) => setDuplicateReasons({ ...duplicateReasons, [item.local_id]: event.target.value })}
                      />
                    </Form.Group>
                  ) : null}
                  {item.quality?.warnings?.length ? (
                    <Alert variant={item.quality?.testability === "FAIL" ? "danger" : "warning"} className="small mt-3 mb-0">
                      {item.quality.warnings.join(" · ")}
                    </Alert>
                  ) : null}
                  {item.selected && item.quality?.testability === "FAIL" ? (
                    <Form.Group className="mt-3">
                      <Form.Label className="small">{t('proyectos.caseGenerationFailJustification')}</Form.Label>
                      <Form.Control
                        required
                        value={failReasons[item.local_id] || ""}
                        onChange={(event) => setFailReasons({ ...failReasons, [item.local_id]: event.target.value })}
                      />
                    </Form.Group>
                  ) : null}
                </div>
              </details>
            ))}
          </>
        )}

        {run && step === 5 && (
          <p>{t('proyectos.caseGenerationApplied')}</p>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        {!run && (
          <Button onClick={estimate} disabled={busy || !structured || !suiteId || !componentId}>
            {busy ? t('proyectos.caseGenerationAnalyzingLabel') : t('proyectos.caseGenerationAnalyzeSuggest')}
          </Button>
        )}
        {run && step === 2 && (
          <Button onClick={confirm} disabled={busy}>
            {busy ? t('proyectos.caseGenerationSavingLabel') : t('proyectos.caseGenerationConfirmDecisions')}
          </Button>
        )}
        {run && step === 3 && (
          <Button onClick={generate} disabled={busy || !selectedScenarioIds.length}>
            {busy ? t('proyectos.caseGenerationDraftingLabel') : t('proyectos.caseGenerationDraftCount', { count: selectedScenarioIds.length })}
          </Button>
        )}
        {run && step === 4 && (
          <Button
            onClick={apply}
            disabled={busy
              || !(run.propuestas || []).some((item: any) => item.selected)
              || (run.propuestas || []).some((item: any) => item.selected && duplicateSignals(item).some((signal: any) => signal.severity === "EXACT"))
              || (run.propuestas || []).some((item: any) => item.selected && item.quality?.testability === "FAIL" && !String(failReasons[item.local_id] || "").trim())
              || (run.propuestas || []).some((item: any) => item.selected && requiresDuplicateDecision(item) && !String(duplicateReasons[item.local_id] || "").trim())}
          >
            {busy ? t('proyectos.caseGenerationApplyingLabel') : t('proyectos.caseGenerationCreateCount', { count: (run.propuestas || []).filter((item: any) => item.selected).length })}
          </Button>
        )}
      </Modal.Footer>
      <Modal show={Boolean(duplicateDetail)} onHide={() => setDuplicateDetail(null)} centered>
        <Modal.Header closeButton><Modal.Title>{t('proyectos.caseGenerationDuplicateReviewTitle')}</Modal.Title></Modal.Header>
        <Modal.Body>
          {duplicateDetail && (
            <>
              <p className="mb-3"><strong>{t('proyectos.caseGenerationProposalLabel')}</strong> {duplicateDetail.title}</p>
              {duplicateSignals(duplicateDetail).map((signal: any) => (
                <div key={signal.master_id} className={`border rounded p-3 mb-2 ${signal.severity === "EXACT" ? "border-danger bg-danger-subtle" : signal.severity === "HIGH" ? "border-warning bg-warning-subtle" : "border-info bg-info-subtle"}`}>
                  <div className="d-flex justify-content-between gap-2">
                    <strong>{signal.code} · {signal.title}</strong>
                    <Badge bg={signal.severity === "EXACT" ? "danger" : signal.severity === "HIGH" ? "warning" : "info"}>
                      {Math.round(signal.score * 100)}%
                    </Badge>
                  </div>
                  <div className="small mt-2">{t('proyectos.caseGenerationMatchLabel')} {signal.reasons.join("; ")}</div>
                  <div className="small mt-2 fw-semibold">
                    {signal.severity === "EXACT"
                      ? t('proyectos.caseGenerationExactDuplicate')
                      : signal.severity === "HIGH"
                        ? t('proyectos.caseGenerationHighDuplicate')
                        : t('proyectos.caseGenerationLowDuplicate')}
                  </div>
                </div>
              ))}
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setDuplicateDetail(null)}>{t('proyectos.caseGenerationUnderstand')}</Button>
        </Modal.Footer>
      </Modal>
    </Modal>
  );
}
