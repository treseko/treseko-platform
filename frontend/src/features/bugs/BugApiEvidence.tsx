import { Alert, Badge, Card, Col, Row, Table } from 'react-bootstrap'
import { CheckCircle2, XCircle } from 'lucide-react'
import { useI18n } from '../../i18n'

function pretty(value: any, emptyLabel: string) {
  if (value == null || value === '') return emptyLabel
  if (typeof value === 'string') return value
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

function displayValue(value: any, emptyLabel: string) {
  return value === null || value === undefined || value === '' ? emptyLabel : String(value)
}

function statusVariant(status: any): 'success' | 'danger' | 'primary' | 'secondary' {
  const value = String(status || '').toUpperCase()
  if (['PASO', 'PASSED', 'PASS'].includes(value)) return 'success'
  if (['FALLO', 'FAILED', 'FAIL', 'ERROR'].includes(value)) return 'danger'
  if (['BLOQUEADO', 'BLOCKED'].includes(value)) return 'primary'
  return 'secondary'
}

function statusLabel(status: any, t: ReturnType<typeof useI18n>['t']) {
  const value = String(status || '').toUpperCase()
  if (['PASO', 'PASSED', 'PASS'].includes(value)) return t('bugs.passed')
  if (['FALLO', 'FAILED', 'FAIL', 'ERROR'].includes(value)) return t('bugs.failed')
  if (['BLOQUEADO', 'BLOCKED'].includes(value)) return t('bugs.status_BLOCKED')
  if (['PENDIENTE', 'PENDING'].includes(value)) return t('bugs.status_PENDING')
  return status || t('common.noData')
}

function StatusBadge({ status, t }: { status: any; t: ReturnType<typeof useI18n>['t'] }) {
  return <Badge bg={statusVariant(status)}>{statusLabel(status, t)}</Badge>
}

function JsonBlock({ value, emptyLabel }: { value: any; emptyLabel: string }) {
  return <pre className="bg-light border rounded p-3 small mb-0 text-wrap" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{pretty(value, emptyLabel)}</pre>
}

function ContextGrid({ values, emptyLabel }: { values: Array<[string, any]>; emptyLabel: string }) {
  return <Row className="g-2">
    {values.map(([label, value]) => <Col md={4} key={label}>
      <div className="border rounded bg-light p-2 small h-100">
        <div className="text-muted x-small">{label}</div>
        <strong className="text-break">{displayValue(value, emptyLabel)}</strong>
      </div>
    </Col>)}
  </Row>
}

export function BugApiEvidence({ context, loading }: { context: any; loading?: boolean }) {
  const { t } = useI18n()
  const emptyLabel = t('common.noData')
  if (loading) return <Alert variant="info">{t('bugs.apiEvidenceLoading')}</Alert>
  if (!context) return <Alert variant="warning">{t('bugs.apiEvidenceUnavailable')}</Alert>

  const execution = context.execution_snapshot || {}
  const caseSnapshot = context.case_snapshot || {}
  const steps = Array.isArray(context.steps) ? context.steps : []
  const variablesUsed = execution.variables_used || context.variables_used || {}
  const dynamicVariables = execution.dynamic_variables || context.api_resultado?.dynamic_variables || {}
  const dynamicValues = dynamicVariables.values && typeof dynamicVariables.values === 'object' ? dynamicVariables.values : {}
  const technicalStatus = context.api_resultado?.status || execution.status || 'N/D'
  const manualVerdict = context.api_resultado?.manual_evaluation?.status || null
  const overallStatus = manualVerdict || execution.status || technicalStatus
  const firstRequest = steps[0]?.request || {}
  const firstResponse = steps[0]?.response || steps[0]?.observed || null
  const assertionCount = steps.reduce((total: number, step: any) => total + (Array.isArray(step.assertions) ? step.assertions.length : 0), 0)
  const configuredAssertions = Array.isArray(context.api_config_snapshot?.assertions) ? context.api_config_snapshot.assertions : []
  const executionErrors = Array.isArray(context.api_resultado?.errors) ? context.api_resultado.errors : []

  return <div className="bug-api-evidence">
    <Card className="border-0 bg-light mb-3">
      <Card.Body>
        <div className="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-3">
          <div>
            <div className="text-muted x-small text-uppercase fw-bold">{t('bugs.apiExecutionSummary')}</div>
            <h6 className="mb-1 mt-1">{caseSnapshot.code || t('bugs.apiCaseFallback')} · {caseSnapshot.title || t('bugs.untitled')}</h6>
            <div className="small text-muted">{t('bugs.apiEvidencePreserved')}</div>
          </div>
          <StatusBadge status={overallStatus} t={t} />
        </div>
        <ContextGrid values={[
          [t('bugs.technicalResult'), statusLabel(technicalStatus, t)],
          [t('bugs.qaVerdict'), manualVerdict ? statusLabel(manualVerdict, t) : t('bugs.undefinedVerdict')],
          ['Ambiente', execution.environment_name],
          ['Dataset', execution.dataset_name],
          [t('bugs.modeLabel'), execution.mode],
          [t('bugs.durationLabel'), execution.duration_seconds != null ? `${execution.duration_seconds}s` : execution.duration_ms != null ? `${execution.duration_ms}ms` : emptyLabel],
        ]} emptyLabel={emptyLabel} />
      </Card.Body>
    </Card>

    {execution.observations && <Alert variant={statusVariant(overallStatus) === 'primary' ? 'primary' : statusVariant(overallStatus)} className="small py-2"><strong>{t('bugs.observations')}:</strong> {execution.observations}</Alert>}

    <Card className="mb-3">
      <Card.Header><strong>{t('bugs.requestSent')}</strong></Card.Header>
      <Card.Body>
        {steps.length === 0 ? <Alert variant="danger" className="mb-0">
          <strong>{t('bugs.requestNotSent')}</strong> {t('bugs.requestResponseNotPreserved')}
          {executionErrors.length > 0 && <div className="mt-2">{t('bugs.detail')}: {executionErrors.map((item: any) => item?.error || item?.message || pretty(item, emptyLabel)).join(' · ')}</div>}
        </Alert> : <>
          <ContextGrid values={[[t('bugs.method'), firstRequest.method], [t('bugs.url'), firstRequest.url], [t('bugs.requests'), steps.length]]} emptyLabel={emptyLabel} />
          <div className="mt-3"><JsonBlock value={firstRequest} emptyLabel={emptyLabel} /></div>
        </>}
      </Card.Body>
    </Card>

    <Card className="mb-3">
      <Card.Header><strong>{t('bugs.responseReceived')}</strong></Card.Header>
      <Card.Body>{firstResponse ? <JsonBlock value={firstResponse} emptyLabel={emptyLabel} /> : <Alert variant="secondary" className="mb-0">{t('bugs.noServiceResponse')}</Alert>}</Card.Body>
    </Card>

    <Card className="mb-3">
      <Card.Header className="d-flex justify-content-between align-items-center"><strong>{t('bugs.validations')}</strong><Badge bg="light" text="dark" className="border">{assertionCount} {t('bugs.performed')} · {configuredAssertions.length} {t('bugs.configured')}</Badge></Card.Header>
      <Card.Body>
        {assertionCount === 0 && configuredAssertions.length === 0
          ? <div className="text-muted small">{t('bugs.noValidations')}</div>
          : assertionCount === 0
          ? <Alert variant="warning" className="mb-0 small">{t('bugs.validationsNotExecuted', { count: configuredAssertions.length })}</Alert>
          : <div className="table-responsive"><Table size="sm" bordered className="mb-0 align-middle"><thead><tr><th>{t('bugs.validation')}</th><th>{t('bugs.result')}</th><th>{t('bugs.expectedValue')}</th><th>{t('bugs.obtainedValue')}</th></tr></thead><tbody>{steps.flatMap((step: any, stepIndex: number) => (step.assertions || []).map((assertion: any, assertionIndex: number) => { const passed = String(assertion.status || '').toUpperCase() === 'PASSED'; return <tr key={assertion.id || `${stepIndex}-${assertionIndex}`}><td className="text-break">{assertion.name || assertion.id || t('bugs.check', { number: assertionIndex + 1 })}</td><td>{passed ? <><CheckCircle2 size={15} className="text-success me-1" />{t('bugs.passed')}</> : <><XCircle size={15} className="text-danger me-1" />{t('bugs.failed')}</>}</td><td className="text-break">{pretty(assertion.expected, emptyLabel)}</td><td className="text-break">{pretty(assertion.actual !== null && assertion.actual !== undefined ? assertion.actual : assertion.error, emptyLabel)}</td></tr> }))}</tbody></Table></div>}
      </Card.Body>
    </Card>

    {Object.keys(variablesUsed).length > 0 && <Card className="mb-3"><Card.Header><strong>{t('bugs.variablesUsed')}</strong></Card.Header><Card.Body><Table size="sm" bordered className="mb-0"><tbody>{Object.entries(variablesUsed).map(([key, value]) => <tr key={key}><td className="fw-semibold text-break">{`{{${key}}}`}</td><td className="text-break">{pretty(value, emptyLabel)}</td></tr>)}</tbody></Table></Card.Body></Card>}

    {Object.keys(dynamicValues).length > 0 && <Card className="mb-3"><Card.Header><strong>{t('bugs.dynamicVariables')}</strong></Card.Header><Card.Body>
      <div className="small text-muted mb-2">{t('bugs.dynamicVariablesHelp')}</div>
      {dynamicVariables.seed != null && <div className="small mb-2"><span className="text-muted">{t('bugs.seed')}:</span> <code>{String(dynamicVariables.seed)}</code></div>}
      <Table size="sm" bordered className="mb-0"><tbody>{Object.entries(dynamicValues).map(([key, value]) => <tr key={key}><td className="fw-semibold text-break">{key}</td><td className="text-break">{pretty(value, emptyLabel)}</td></tr>)}</tbody></Table>
    </Card.Body></Card>}

    <details className="mb-2"><summary className="fw-semibold">{t('bugs.technicalContext')}</summary><div className="mt-2"><ContextGrid values={[[t('bugs.case'), caseSnapshot.code], [t('bugs.buildLabel'), execution.build_name || execution.build_code], [t('bugs.execution'), execution.run_name], [t('bugs.environmentLabel'), execution.environment_name], [t('bugs.datasetLabel'), execution.dataset_name], [t('bugs.date'), execution.executed_at]]} emptyLabel={emptyLabel} /></div></details>
    <details className="mb-2"><summary className="fw-semibold">{t('bugs.frozenApiConfig')}</summary><div className="mt-2"><JsonBlock value={context.api_config_snapshot} emptyLabel={emptyLabel} /></div></details>
    <details><summary className="fw-semibold">{t('bugs.fullTechnicalEvidence')}</summary><div className="mt-2"><JsonBlock value={context.technical_evidence} emptyLabel={emptyLabel} /></div></details>
  </div>
}
