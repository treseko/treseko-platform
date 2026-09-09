import { Button, Form, Modal, ProgressBar, Spinner } from 'react-bootstrap'
import { Sparkles } from 'lucide-react'
import { TraceabilityGenerationContext } from './TraceabilityGenerationContext'
import { TraceabilityGenerationResults } from './TraceabilityGenerationResults'

export function TraceabilityGenerationModal({ options }: { options: any }) {
  const { generationRequirement, setGenerationRequirement, generationBusy, t, tx, generationStep, setGenerationStep, locale, generationCompletedCount, generationRequestedCount, generationElapsedSeconds, generationContextExpanded, setGenerationContextExpanded, generationRun, setGenerationRun, generationInstructions, setGenerationInstructions, projectComponents, generationComponentIds, setGenerationComponentIds, generationWiki, generationWikiIds, setGenerationWikiIds, generationQuestionAnswers, setGenerationQuestionAnswers, generationCandidates, setAutoContinuePaused, estimateExplanationVisible, setEstimateExplanationVisible, preflightExcludedStories, selectedCandidateCount, expandedCandidateIndexes, setExpandedCandidateIndexes, setGenerationCandidates, updateGenerationCandidate, proposalQualityMeta, hasSimilarStory, proposalQuality, AcceptanceCriteriaEditor, estimateGeneration, generationHasActionableReview, confirmAssumptions, generationHasCriticalAssumptions, autoContinueRemaining, autoContinuePaused, recalculateGenerationScope, generationMaxStories, setGenerationMaxStories, generateCandidates, selectedCriticalCandidatesNeedDecision, applyCandidates } = options
  return (
      <Modal
        show={Boolean(generationRequirement)}
        onHide={() => !generationBusy && setGenerationRequirement(null)}
        size="xl"
        scrollable
        centered
      >
        <Modal.Header closeButton className="border-0 pb-2">
          <Modal.Title className="fw-bold d-flex align-items-center gap-2">
            <Sparkles size={18} className="text-primary" />
            {t('proyectos.generationTitle')}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {generationRequirement && (
            <div className="d-flex flex-column gap-3">
              <div className="border-start border-primary border-3 ps-3">
                <div className="fw-semibold">
                  {generationRequirement.codigo} -{" "}
                  {generationRequirement.titulo}
                </div>
                <div className="small text-muted">
                  {tx("generationNotice")}
                </div>
              </div>
              <div className="d-flex flex-wrap gap-2 small" aria-label={tx("stages")}>
                {[
                  t('proyectos.stageContext'),
                  t('proyectos.stageAnalyze'),
                  t('proyectos.stageConfigure'),
                  t('proyectos.stageReview'),
                ].map((label, index) => {
                  const currentStep = {
                    context: 0,
                    analysis: 1,
                    configuration: 2,
                    review: 3,
                  }[generationStep];
                  return (
                    <span
                      key={label}
                      className={`border rounded px-2 py-1 ${index === currentStep ? "bg-primary text-white border-primary" : index < currentStep ? "bg-light text-muted" : "text-muted"}`}
                    >
                      {label}
                    </span>
                  );
                })}
              </div>
              {generationBusy && (
                <div className="border rounded bg-light px-3 py-2" aria-live="polite">
                  <div className="d-flex align-items-center gap-2">
                    <Spinner animation="border" variant="primary" size="sm" role="status">
                      <span className="visually-hidden">{tx("processing")}</span>
                    </Spinner>
                    <div className="flex-grow-1">
                      <span className="fw-semibold">{tx("aiWorking")}</span>
                      <span className="text-muted small ms-2">
                        {generationStep === "context"
                          ? t('proyectos.caseGenerationBusyAnalyzing')
                          : generationStep === "analysis"
                            ? t('proyectos.caseGenerationBusyUpdating')
                            : generationStep === "configuration"
                            ? t('proyectos.caseGenerationProgress', { current: Math.min(generationCompletedCount + 1, generationRequestedCount), total: generationRequestedCount })
                            : t('proyectos.caseGenerationBusyCreating')}
                      </span>
                    </div>
                    <span className="small text-muted">{generationElapsedSeconds}s</span>
                  </div>
                  <ProgressBar animated now={100} variant="primary" className="mt-2" style={{ height: "4px" }} />
                </div>
              )}
              <TraceabilityGenerationContext options={{
                generationStep,
                generationContextExpanded,
                setGenerationContextExpanded,
                tx,
                generationRun,
                generationInstructions,
                setGenerationInstructions,
                projectComponents,
                generationComponentIds,
                setGenerationComponentIds,
                generationWiki,
                generationWikiIds,
                setGenerationWikiIds,
                generationQuestionAnswers,
                setGenerationQuestionAnswers,
                generationBusy,
                generationCandidates,
                setAutoContinuePaused,
                estimateExplanationVisible,
                setEstimateExplanationVisible,
                locale,
                t,
              }} />
              <TraceabilityGenerationResults options={{
                generationRun,
                generationStep,
                locale,
                t,
                tx,
                generationBusy,
                generationCompletedCount,
                generationRequestedCount,
                generationCandidates,
                preflightExcludedStories,
                selectedCandidateCount,
                generationRequirement,
                expandedCandidateIndexes,
                setExpandedCandidateIndexes,
                setGenerationCandidates,
                updateGenerationCandidate,
                proposalQualityMeta,
                hasSimilarStory,
                proposalQuality,
                AcceptanceCriteriaEditor,
              }} />
            </div>
          )}
        </Modal.Body>
        <Modal.Footer className="d-flex flex-wrap align-items-end justify-content-end gap-2">
          <Button
            variant="secondary"
            disabled={generationBusy}
            onClick={() => setGenerationRequirement(null)}
          >
            {t('proyectos.cancel')}
          </Button>
          {generationRun && (
            <Button
              variant="outline-secondary"
              disabled={generationBusy}
              onClick={() => {
                setGenerationRun(null);
                setGenerationCandidates([]);
                setGenerationStep("context");
                setGenerationContextExpanded(true);
                setExpandedCandidateIndexes(new Set());
              }}
            >
              {t('proyectos.backContext')}
            </Button>
          )}
          {!generationRun && (
            <Button
              disabled={generationBusy}
              onClick={() => void estimateGeneration()}
            >
              {generationBusy
                ? t('proyectos.caseGenerationBusyAnalyzing')
                : t('proyectos.stageAnalyze')}
            </Button>
          )}
          {generationRun && generationCandidates.length === 0 && (
            generationRun.estado === "ESPERANDO_SUPUESTOS" && generationHasActionableReview ? (
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <Button disabled={generationBusy} onClick={() => void confirmAssumptions()}>
                  {generationBusy ? t('proyectos.saving') : t('proyectos.continueWithAssumptions')}
                </Button>
                {generationHasCriticalAssumptions ? (
                  <span className="small text-muted">{tx("criticalAssumptions")}</span>
                ) : autoContinueRemaining !== null ? (
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    onClick={() => setAutoContinuePaused(true)}
                  >
                    {tx("pauseAuto")} ({autoContinueRemaining}s)
                  </Button>
                ) : autoContinuePaused ? (
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    onClick={() => setAutoContinuePaused(false)}
                  >
                    {tx("resumeAuto")}
                  </Button>
                ) : null}
              </div>
            ) : generationStep === "analysis" ? (
              <Button
                disabled={generationBusy}
                onClick={() => void recalculateGenerationScope()}
              >
                {generationBusy ? t('proyectos.updating') : t('proyectos.continueCalculateScope')}
              </Button>
            ) : generationStep === "configuration" ? (
              <div className="d-flex align-items-end gap-2">
                <Button
                  variant="outline-secondary"
                  disabled={generationBusy}
                  onClick={() => setGenerationStep("analysis")}
                >
                  {tx("backAnalysis")}
                </Button>
                <Form.Group style={{ width: "158px" }}>
                  <Form.Label className="small mb-1 text-nowrap">{t('proyectos.quantityDrafts')}</Form.Label>
                  <Form.Control name="a11y-traceabilitygenerationmodaltsx-204" aria-label={t('proyectos.quantityDrafts')}
                    size="sm"
                    type="number"
                    min={1}
                    max={20}
                    value={generationMaxStories}
                    disabled={generationBusy}
                    onChange={(event) => setGenerationMaxStories(Math.max(1, Math.min(20, Number(event.target.value) || 1)))}
                  />
                </Form.Group>
                <Button disabled={generationBusy} onClick={() => void generateCandidates()}>
                  {generationBusy ? t('proyectos.generating') : t(generationMaxStories === 1 ? 'proyectos.generateDraft' : 'proyectos.generateDrafts', { count: generationMaxStories })}
                </Button>
              </div>
            ) : (
              <div className="d-flex align-items-end gap-2">
                <Form.Group style={{ width: "104px" }}>
                  <Form.Label className="small mb-1">{t('proyectos.proposals')}</Form.Label>
                  <Form.Control name="a11y-traceabilitygenerationmodaltsx-222" aria-label={t('proyectos.proposals')}
                    size="sm"
                    type="number"
                    min={1}
                    max={20}
                    value={generationMaxStories}
                    disabled={generationBusy}
                    onChange={(event) => setGenerationMaxStories(Math.max(1, Math.min(20, Number(event.target.value) || 1)))}
                  />
                </Form.Group>
                <Button disabled={generationBusy} onClick={() => void generateCandidates()}>
                  {generationBusy ? t('proyectos.generating') : t(generationMaxStories === 1 ? 'proyectos.generateProposal' : 'proyectos.generateProposals', { count: generationMaxStories })}
                </Button>
              </div>
            )
          )}
          {generationCandidates.length > 0 && (
            <div className="d-flex flex-column align-items-end gap-1">
              {selectedCriticalCandidatesNeedDecision && (
                <span className="small text-danger">
                  {tx("confirmReview")}
                </span>
              )}
              <Button
                disabled={generationBusy || selectedCandidateCount === 0 || selectedCriticalCandidatesNeedDecision}
                onClick={() => void applyCandidates()}
              >
                {generationBusy
                  ? t('proyectos.creating')
                  : t('proyectos.createDraftsCount', { count: selectedCandidateCount })}
              </Button>
            </div>
          )}
        </Modal.Footer>
      </Modal>

  )
}
