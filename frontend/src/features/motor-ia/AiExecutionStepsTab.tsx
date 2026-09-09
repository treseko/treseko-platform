import { Alert, Badge, Card, Col, Row, Table } from 'react-bootstrap'
import { useI18n } from '../../i18n'
import { resolveAssetUrl } from '../../shared/utils/assets'

type Preview = { src: string; title: string; subtitle?: string }

type Props = {
  aiReport: any
  steps: any[]
  caseSteps: any[]
  timeline: any[]
  agentConversation: any[]
  auditEvidenceSteps: any[]
  visualEvidenceRefs: Set<string>
  formatValue: (value: any) => string
  statusColor: (status?: string) => string
  onPreview: (preview: Preview) => void
}

const screenshotSrc = (base64?: string) => {
  if (!base64) return ''
  const value = String(base64).trim()
  if (!value || value.startsWith('[') || value.length < 64) return ''
  return value.startsWith('data:') ? value : `data:image/png;base64,${value}`
}

const evidenceSrc = (attempt: any, step: any) => {
  const screenshot = screenshotSrc(attempt?.screenshot_base64)
  if (screenshot) return screenshot
  const image = (step?.evidences || []).find((item: any) => String(item?.content_type || '').startsWith('image/') && item?.public_url)
  return resolveAssetUrl(image?.public_url || step?.evidences?.[0]?.public_url || step?.evidence_url || '')
}

const actionTarget = (action?: any) => {
  if (!action) return '-'
  if (action.target_ref) return action.target_ref
  if (action.action === 'click_at' && Number.isFinite(Number(action.x)) && Number.isFinite(Number(action.y))) {
    return `${Math.round(Number(action.x))}, ${Math.round(Number(action.y))}`
  }
  return '-'
}

const localizedStatus = (value: any, t: (key: any, params?: any) => string) => {
  const normalized = String(value || '').trim().toUpperCase()
  const keys: Record<string, string> = {
    PASO: 'statusPassed', PASS: 'statusPassed', PASSED: 'statusPassed',
    FALLO: 'statusFailed', FAIL: 'statusFailed', FAILED: 'statusFailed', ERROR: 'error',
    BLOQUEADO: 'statusBlockedLabel', BLOCKED: 'statusBlockedLabel',
    SIN_CORRER: 'statusNotRun', NOT_RUN: 'statusNotRun', PENDING: 'statusWaiting',
    EN_ESPERA: 'statusWaiting', EN_EJECUCION: 'statusRunning', RUNNING: 'statusRunning', EJECUTANDO_AI: 'statusRunning',
    STREAM_CERRADO: 'statusStreamCerrado', 'STREAM CERRADO': 'statusStreamCerrado', SKIPPED: 'statusSkipped', OMITIDO: 'statusSkipped', CANCELLED: 'statusCancelled', CANCELADO: 'statusCancelled', TIMEOUT: 'statusTimeout', REQUIERE_REVISION: 'statusRequiresReview',
  }
  return keys[normalized] ? t(`motorIa.${keys[normalized]}`) : (value || '-')
}

export function AiExecutionStepsTab({ aiReport, steps, caseSteps, timeline, agentConversation, auditEvidenceSteps, visualEvidenceRefs, formatValue, statusColor, onPreview }: Props) {
  const { t } = useI18n()
  const workflowActionEvents = agentConversation.filter((event: any) => {
    const node = String(event.node_type || event.agent || '').toLowerCase()
    return node.includes('planner') || node.includes('executor') || node.includes('security')
  })

  return <div className="d-flex flex-column gap-3 pt-3">
    {caseSteps.length > 0 && <Card className="border p-3">
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
        <div><div className="fw-bold">{t('motorIa.caseStepsDefined')}</div><div className="small text-muted">{t('motorIa.frozenCaseContract')}</div></div>
        <Badge bg="light" text="dark" className="border">{t('motorIa.aiActiveSteps', { count: steps.length })}</Badge>
      </div>
      <div className="d-flex flex-column gap-2">{caseSteps.map((step: any) => {
        const persistedEvidence = evidenceSrc(undefined, step)
        return <div key={`case-step-${step.number}`} className="ai-case-definition bg-light border rounded-2 p-2">
          <div className="d-flex flex-wrap justify-content-between gap-2 mb-1"><span className="fw-semibold">{t('motorIa.stepNumber', { number: step.number })}</span><Badge bg={statusColor(step.status)}>{localizedStatus(step.status || 'SIN_CORRER', t)}</Badge></div>
          <div className="d-flex flex-column flex-md-row gap-2 align-items-md-start">
            <div className="flex-grow-1 min-w-0">
              <div className="small"><span className="text-muted">{t('motorIa.actionLabel')}:</span> {formatValue(step.action) || '-'}</div>
              {step.data && <div className="small text-break"><span className="text-muted">{t('motorIa.dataLabel')}:</span> <span className="font-monospace">{formatValue(step.data)}</span></div>}
              <div className="small"><span className="text-muted">{t('motorIa.expectedLabel')}:</span> {formatValue(step.expected_result) || '-'}</div>
              {step.observations && <div className="small mt-1"><span className="text-muted">{t('motorIa.recordedResult')}:</span> {formatValue(step.observations)}</div>}
            </div>
            {persistedEvidence && <button type="button" className="border-0 bg-transparent p-0 text-start flex-shrink-0" onClick={() => onPreview({ src: persistedEvidence, title: t('motorIa.stepNumber', { number: step.number }), subtitle: t('motorIa.persistedStepEvidence') })}>
              <img src={persistedEvidence} alt={`${t('motorIa.persistedStepEvidence')} ${step.number}`} className="border rounded-2 d-block" style={{ width: 132, height: 76, objectFit: 'cover' }} />
              <span className="x-small text-muted d-block mt-1">{t('motorIa.persistedEvidence')}</span>
            </button>}
          </div>
        </div>
      })}</div>
    </Card>}
    {steps.length === 0 && (aiReport.errors?.length > 0 || timeline.length > 0) && <Alert variant="warning" className="border small mb-0"><strong>{t('motorIa.zeroBrowserActions')}</strong> {t('motorIa.workflowStoppedReason', { tab: t('motorIa.agentsTab') })}</Alert>}
    {steps.length === 0 && workflowActionEvents.length > 0 && <Card className="border p-3">
      <div className="fw-bold mb-1">{t('motorIa.activityBeforeBlock')}</div><div className="small text-muted mb-2">{t('motorIa.plannedNotExecuted')}</div>
      <div className="d-flex flex-column gap-2">{workflowActionEvents.map((event: any, index: number) => {
        const decision = event.output_json?.decision || {}
        const proposedAction = decision.action || decision.outputs?.action || event.action
        const target = decision.target_ref || decision.selector || decision.url
        const reasonCode = decision.reason_code || event.output_json?.reason_code
        return <div key={`${event.node_id || event.agent}-${index}`} className="border rounded-2 p-2 small">
          <div className="d-flex flex-wrap align-items-center gap-2 mb-1"><Badge bg="dark">{event.agent || event.node_type || 'WORKFLOW'}</Badge><Badge bg={statusColor(event.status || event.level)}>{localizedStatus(event.status || event.level, t)}</Badge>{reasonCode && <Badge bg="light" text="dark" className="border">{reasonCode}</Badge>}</div>
          {proposedAction && <div><span className="text-muted">{t('motorIa.proposedAction')}:</span> <strong>{formatValue(proposedAction)}</strong>{target ? ` · ${formatValue(target)}` : ''}</div>}
          <div><span className="text-muted">{t('motorIa.reason')}:</span> {event.reason || event.output_json?.reason || event.message || '-'}</div>
        </div>
      })}</div>
    </Card>}
    {steps.map((step: any) => {
      const expected = step.expected_result || auditEvidenceSteps.find((item: any) => Number(item.number) === Number(step.number))?.expected_result
      return <Card key={step.number} className="border p-3">
        <div className="d-flex justify-content-between gap-2 mb-2"><div className="fw-bold">{t('motorIa.stepNumber', { number: step.number })}</div><div className="d-flex gap-2"><Badge bg={statusColor(step.status)}>{localizedStatus(step.status, t)}</Badge><Badge bg="light" text="dark" className="border">{t('motorIa.attemptsCount', { count: (step.attempts || []).length })}</Badge><Badge bg="light" text="dark" className="border">{t('motorIa.confidence', { value: step.confidence ?? 0 })}</Badge></div></div>
        <div className="small mb-2">{step.observations || '-'}</div>
        {(step.action || step.data) && <div className="ai-case-definition bg-light border rounded-2 p-2 mb-2"><div className="fw-bold text-uppercase text-muted x-small mb-2">{t('motorIa.caseDefinition')}</div><Row className="g-2">{step.action && <Col md={step.data ? 5 : 12}><div className="text-muted mb-1">{t('motorIa.actionDirective')}</div><div className="fw-semibold">{formatValue(step.action)}</div></Col>}{step.data && <Col md={step.action ? 7 : 12}><div className="text-muted mb-1">{t('motorIa.inputData')}</div><div className="font-monospace text-break">{formatValue(step.data)}</div></Col>}</Row></div>}
        {expected && <div className="ai-case-expected border border-primary-subtle bg-primary bg-opacity-10 rounded-2 p-2 mb-3"><div className="fw-bold text-uppercase text-primary x-small mb-1">{t('motorIa.expectedResultLabel')}</div><div>{formatValue(expected)}</div></div>}
        {step.failure_category && <div className="x-small text-muted mb-2">{t('common.category')}: {step.failure_category}</div>}
        {(step.attempts || []).length > 0 && <div className="ai-execution-heading fw-bold text-uppercase text-muted mb-2">{t('motorIa.aiExecution')}</div>}
        <Table responsive className="mb-0 ai-execution-table"><thead><tr><th>{t('motorIa.attemptCol')}</th><th>{t('motorIa.actionCol')}</th><th>{t('motorIa.evidenceCol')}</th><th>{t('motorIa.technicalResultCol')}</th><th>{t('motorIa.validationCol')}</th></tr></thead><tbody>
          {(step.attempts || []).map((attempt: any) => {
            const evidence = evidenceSrc(attempt, step)
            const isFallback = !screenshotSrc(attempt?.screenshot_base64) && Boolean(evidence)
            const visualRef = `step-${step.number}-attempt-${attempt.attempt}-screenshot`
            const visuallyEvaluated = Boolean(screenshotSrc(attempt?.screenshot_base64)) && visualEvidenceRefs.has(visualRef)
            return <tr key={attempt.attempt}><td>{attempt.attempt}</td><td><div className="fw-bold">{attempt.action?.action || '-'}</div><div className="x-small text-muted">{t('motorIa.targetLabel')}: {actionTarget(attempt.action)}</div>{attempt.action?.value !== undefined && attempt.action?.value !== '' && <div className="x-small text-muted">{t('motorIa.valueLabel')}: {String(attempt.action.value)}</div>}<div className="text-muted">{attempt.action?.reason || '-'}</div></td><td style={{ minWidth: 150 }}>
              {visuallyEvaluated && <Badge bg="info" className="mb-1">{t('motorIa.visualAuditAttempt')}</Badge>}
              {evidence ? <button type="button" className="border-0 bg-transparent p-0 text-start" onClick={() => onPreview({ src: evidence, title: t('motorIa.stepAttemptTitle', { step: step.number, attempt: attempt.attempt }), subtitle: isFallback ? t('motorIa.persistedAttemptEvidence') : t('motorIa.attemptCapture') })}><img src={evidence} alt={t('motorIa.attemptAlt', { step: step.number, attempt: attempt.attempt })} className="border rounded-2" style={{ width: 132, height: 76, objectFit: 'cover' }} />{isFallback && <div className="x-small text-muted mt-1">{t('motorIa.persistedEvidence')}</div>}</button> : <span className="text-muted">{t('motorIa.noScreenshotLabel')}</span>}
            </td><td><Badge bg={attempt.execution?.ok ? 'success' : 'danger'}>{attempt.execution?.ok ? t('motorIa.ok') : t('motorIa.error')}</Badge><div className="text-muted">{attempt.execution?.message || '-'}</div></td><td>{attempt.validation?.reason || '-'}</td></tr>
          })}
        </tbody></Table>
      </Card>
    })}
    {steps.length === 0 && <Alert variant="light" className="border text-muted">{t('motorIa.noSteps')}</Alert>}
  </div>
}
