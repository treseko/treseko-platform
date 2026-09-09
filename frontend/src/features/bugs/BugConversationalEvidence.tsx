import { Alert, Badge, Card, Col, Row } from 'react-bootstrap'

type Props = { t: any; context: any; selectedBug: any; loading: boolean }

const display = (value: unknown, fallback: string) => {
  const text = String(value ?? '').trim()
  return text || fallback
}

const pretty = (value: unknown, fallback: string) => typeof value === 'string' ? value : JSON.stringify(value ?? fallback, null, 2)

export function BugConversationalEvidence({ t, context, selectedBug, loading }: Props) {
  if (loading) return <div className="small text-muted py-4 text-center">{t('bugs.loadingConversationContext')}</div>
  if (!context) return <div className="small text-muted py-4 text-center">{t('bugs.noConversationContext')}</div>
  const execution = context.execution_snapshot || {}
  const evaluation = context.evaluation || {}
  const technical = context.technical_evidence || {}
  const turns = Array.isArray(context.conversation_turns) ? context.conversation_turns : []
  const affectedIndex = evaluation.turn_index == null ? selectedBug.chatbot_turn_index : Number(evaluation.turn_index)
  const observedText = (turn: any) => turn.response_text || turn.responseText || turn.observed?.responseText || turn.observed?.response_text || turn.observed?.response?.text || turn.observed?.message || t('common.noData')

  return <div className="bug-conversational-context">
    <Alert variant="info" className="small">{t('bugs.conversationContextHelp')}</Alert>
    <Card className="border shadow-none mb-3"><Card.Body className="py-3">
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-2"><div><h6 className="mb-1">{t('bugs.evidenceExecutionSummary')}</h6><div className="small text-muted">{execution.run_name || t('bugs.unnamedRun')} · {execution.execution_id || t('bugs.executionNotAvailable')}</div></div><Badge bg={String(evaluation.status || execution.status).toUpperCase() === 'PASO' ? 'success' : 'danger'}>{evaluation.status || execution.status || t('common.noData')}</Badge></div>
      <Row className="g-2 small">{[
        [t('bugs.runLabel'), execution.run_name], [t('bugs.executionLabel'), execution.execution_id], [t('bugs.modeLabel'), execution.mode], [t('bugs.environmentLabel'), execution.environment_name], [t('bugs.datasetLabel'), execution.dataset_id], [t('bugs.durationLabel'), execution.duration_seconds != null ? `${execution.duration_seconds}s` : null], [t('bugs.sessionLabel'), execution.session_id || technical.session_id], [t('bugs.findingLabel'), evaluation.finding_type || selectedBug.chatbot_finding_type], [t('bugs.confidenceLabel'), evaluation.confidence], [t('bugs.consensusLabel'), evaluation.consensus], [t('bugs.modelLabel'), evaluation.model], [t('bugs.workflowLabel'), evaluation.workflow_version],
      ].map(([label, value]) => <Col md={4} sm={6} key={String(label)}><span className="text-muted d-block">{label}</span><span className="text-break">{display(value, t('common.noData'))}</span></Col>)}</Row>
    </Card.Body></Card>
    <h6>{t('bugs.conversationTimeline')}</h6>
    <div className="d-flex flex-column gap-3 mb-3">{turns.map((turn: any, position: number) => {
      const index = Number(turn.technical_index ?? turn.index ?? position)
      const visible = Number(turn.turn_number ?? index + 1)
      const state = String(turn.status || '').toUpperCase()
      const failed = index === Number(affectedIndex) || state === 'FAILED' || state === 'FALLO'
      const assertions = Array.isArray(turn.assertions) ? turn.assertions : []
      return <Card key={`${index}-${visible}`} className={`border shadow-none ${failed ? 'border-danger bg-danger-subtle' : ''}`}><Card.Body className="py-3">
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2"><strong>{t('bugs.visibleTurn', { visible, total: turns.length })} <span className="text-muted fw-normal">· {t('bugs.technicalIndex', { index })}</span></strong><div className="d-flex flex-wrap gap-2"><Badge bg={state === 'NOT_EXECUTED' ? 'secondary' : failed ? 'danger' : 'success'}>{state || t('common.noData')}</Badge>{turn.failure_type && <Badge bg="warning" text="dark">{turn.failure_type}</Badge>}</div></div>
        <Row className="g-2 small"><Col md={6}><div className="text-muted">{t('bugs.sentMessage')}</div><div className="white-space-pre-wrap text-break">{display(turn.message, t('common.noData'))}</div></Col><Col md={6}><div className="text-muted">{t('bugs.receivedResponse')}</div><div className="white-space-pre-wrap text-break">{state === 'NOT_EXECUTED' ? t('bugs.notExecuted') : observedText(turn)}</div></Col><Col md={6}><div className="text-muted">{t('bugs.expectedOutcome')}</div><pre className="small mb-0 text-wrap">{pretty(turn.expected, t('common.noData'))}</pre></Col><Col md={6}><div className="text-muted">{t('bugs.observedOutcome')}</div><pre className="small mb-0 text-wrap">{state === 'NOT_EXECUTED' ? t('bugs.notExecuted') : pretty(turn.observed || turn.response || observedText(turn), t('common.noData'))}</pre></Col><Col md={6}><div className="text-muted">{t('bugs.timeHttp')}</div><div>{turn.latency_ms ?? t('common.noData')} ms · HTTP {turn.status_code ?? t('common.noData')}</div></Col><Col md={6}><div className="text-muted">{t('bugs.categoryObservation')}</div><div className="text-break">{display(turn.failure_type || turn.observation, t('bugs.noFinding'))}</div></Col></Row>
        {assertions.length > 0 && <div className="mt-3"><div className="text-muted small mb-1">{t('bugs.assertions')}</div><div className="d-flex flex-column gap-1">{assertions.map((assertion: any, assertionIndex: number) => <div key={`${index}-assertion-${assertionIndex}`} className="border rounded p-2 small bg-white"><Badge bg={assertion.passed === false ? 'danger' : 'success'} className="me-2">{assertion.passed === false ? t('bugs.assertionFailed') : t('bugs.assertionPassed')}</Badge><span className="fw-semibold">{assertion.rule || assertion.name || assertion.type || `${t('bugs.assertions')} ${assertionIndex + 1}`}</span>{(assertion.expected != null || assertion.actual != null) && <div className="text-muted mt-1">{t('bugs.expectedValue')}: {pretty(assertion.expected, t('common.noData'))} · {t('bugs.obtainedValue')}: {pretty(assertion.actual, t('common.noData'))}</div>}</div>)}</div></div>}
        <details className="bug-technical-details mt-3"><summary>{t('bugs.technicalEvidenceDetails')}</summary><Row className="g-2 mt-1"><Col md={6}><div className="text-muted small">{t('bugs.request')}</div><pre className="small bg-light border rounded p-2 text-wrap">{pretty(turn.request || {}, t('common.noData'))}</pre></Col><Col md={6}><div className="text-muted small">{t('bugs.response')}</div><pre className="small bg-light border rounded p-2 text-wrap">{pretty(turn.response || turn.observed || {}, t('common.noData'))}</pre></Col><Col md={6}><div className="text-muted small">{t('bugs.tools')}</div><pre className="small bg-light border rounded p-2 text-wrap">{pretty(turn.tools || [], t('common.noData'))}</pre></Col><Col md={6}><div className="text-muted small">{t('bugs.memory')}</div><pre className="small bg-light border rounded p-2 text-wrap">{pretty(turn.memory_checks || [], t('common.noData'))}</pre></Col></Row></details>
      </Card.Body></Card>
    })}</div>
    <Card className="border shadow-none mb-3"><Card.Body className="py-3"><h6>{t('bugs.evaluation')}</h6><Row className="g-2 small">{[[t('bugs.humanResult'), evaluation.human_evaluation?.status || evaluation.review_status], [t('bugs.reviewNote'), evaluation.human_evaluation?.notes || evaluation.review_note], [t('bugs.qaNotes'), selectedBug.notas_qa], [t('bugs.humanReview'), evaluation.human_review_required ? t('bugs.yes') : t('bugs.no')], [t('bugs.aiResult'), evaluation.status], [t('bugs.provider'), evaluation.provider], [t('bugs.workflowLabel'), evaluation.workflow_version]].map(([label, value]) => <Col md={6} key={String(label)}><span className="text-muted d-block">{label}</span><div className="text-break">{display(value, t('common.noData'))}</div></Col>)}</Row></Card.Body></Card>
    <details className="bug-technical-details"><summary>{t('bugs.traceDetails')}</summary><pre className="small bg-light border rounded p-3 mt-2 text-wrap">{pretty({ technical_evidence: technical, evidence_refs: context.evidence_refs, evidence_sha256: context.evidence_sha256, resolved_variables: execution.resolved_variables, resolved_dataset: execution.resolved_dataset }, t('common.noData'))}</pre></details>
  </div>
}
