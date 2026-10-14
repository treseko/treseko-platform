import { Alert, Badge, Col, Row } from 'react-bootstrap'
import { useI18n } from '../../i18n'

const pretty = (value: any) => typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2)
function Data({ value }: { value: any }) {
  return <pre className="small bg-light border rounded p-2 mb-0 history-evidence-data">{pretty(value)}</pre>
}

export function HistoryFormatEvidence({ caso }: { caso: any }) {
  const { t } = useI18n()
  if (caso.formato_prueba === 'API') {
    const result = caso.api_resultado || {}
    const steps = Array.isArray(result.steps) ? result.steps : []
    return <section aria-label={t('historial.apiEvidence')}>
      <h6>{t('historial.apiEvidence')}</h6>
      {!steps.length && <Alert variant="secondary" className="small">{t('historial.noFormatEvidence')}</Alert>}
      {steps.map((step: any, position: number) => <div className="border rounded p-3 mb-3" key={step.index ?? position}>
        <div className="fw-semibold text-break mb-2">{step.name || `${t('bugs.request')} ${position + 1}`} · {step.request?.method} {step.request?.url}</div>
        <Row className="g-2"><Col md={6}><div className="small fw-semibold">{t('bugs.requestSent')}</div><Data value={step.request} /></Col><Col md={6}><div className="small fw-semibold">{t('bugs.responseReceived')}</div><Data value={step.response ?? step.observed} /></Col></Row>
        <div className="small mt-2">HTTP {step.response?.status ?? step.response?.status_code ?? '-'} · {step.response?.timings?.total_ms ?? step.duration_ms ?? '-'} ms</div>
        <div className="fw-semibold small mt-2">{t('bugs.validations')}</div>
        {(step.assertions || []).map((assertion: any, index: number) => <div className="small border rounded p-2 mt-1 text-break" key={assertion.id || index}>
          <Badge bg={assertion.passed === false || assertion.status === 'FAILED' ? 'danger' : assertion.passed === true || assertion.status === 'PASSED' ? 'success' : 'secondary'} className="me-2">{assertion.passed === false || assertion.status === 'FAILED' ? t('historial.fail') : assertion.passed === true || assertion.status === 'PASSED' ? t('historial.pass') : assertion.status || '-'}</Badge>
          {assertion.name || assertion.id || assertion.rule}<Data value={{ expected: assertion.expected, actual: assertion.actual, error: assertion.error }} />
        </div>)}
      </div>)}
      {result.duration_ms != null && <div className="small mb-2">{t('historial.totalDuration')}: {result.duration_ms} ms</div>}
      <details><summary>{t('historial.frozenFormat')}</summary><Data value={caso.api_config_snapshot} /></details>
      <details className="mt-2"><summary>{t('historial.fullEvidence')}</summary><Data value={result} /></details>
    </section>
  }
  if (caso.formato_prueba === 'CONVERSACIONAL') {
    const result = caso.chatbot_resultado || {}
    const config = caso.chatbot_config_snapshot || {}
    const turns = Array.isArray(result.turns) ? result.turns : []
    const configured = config.conversation?.turns || []
    return <section aria-label={t('historial.conversationEvidence')}>
      <h6>{t('historial.conversationEvidence')}</h6>
      {!turns.length && <Alert variant="secondary" className="small">{t('historial.noFormatEvidence')}</Alert>}
      {turns.map((turn: any, position: number) => <div className="border rounded p-3 mb-3" key={turn.technical_index ?? position}>
        <div className="d-flex flex-wrap gap-2 align-items-center mb-2"><strong>{t('motorIa.visibleTurn', { number: position + 1 })}</strong><Badge bg={['FAILED', 'FALLO', 'BLOCKED'].includes(turn.status) ? 'danger' : 'secondary'}>{turn.status}</Badge><span className="small">HTTP {turn.statusCode ?? turn.status_code ?? '-'} · {turn.latencyMs ?? turn.latency_ms ?? '-'} ms</span></div>
        <Row className="g-2"><Col md={6}><div className="small fw-semibold">{t('bugs.sentMessage')}</div><Data value={turn.message ?? configured[position]?.input?.text} /></Col><Col md={6}><div className="small fw-semibold">{t('bugs.receivedResponse')}</div><Data value={turn.responseText ?? turn.response_text ?? turn.response} /></Col></Row>
        <div className="small fw-semibold mt-2">{t('bugs.expectedOutcome')}</div><Data value={turn.expected ?? configured[position]?.expected} />
        <div className="small fw-semibold mt-2">{t('bugs.validations')}</div><Data value={turn.assertions || turn.validations || []} />
        <details className="mt-2"><summary>{t('historial.fullEvidence')}</summary><Data value={turn} /></details>
      </div>)}
      <div className="fw-semibold small mb-1">{t('bugs.evaluation')}</div><Data value={result.manual_evaluation || result.human_evaluation || result.evaluation || { status: result.status, review: caso.ai_review_status }} />
      <details className="mt-2"><summary>{t('historial.frozenFormat')}</summary><Data value={config} /></details>
      <details className="mt-2"><summary>{t('historial.fullEvidence')}</summary><Data value={result} /></details>
    </section>
  }
  return null
}
