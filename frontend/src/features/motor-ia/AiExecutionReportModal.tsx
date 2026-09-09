import { useState } from 'react'
import { useI18n } from '../../i18n'
import { Alert, Badge, Button, Card, Col, Modal, Row, Tab, Table, Tabs } from 'react-bootstrap'
import { Eye, Images } from 'lucide-react'
import { formatDateTime } from '../../shared/utils/dateTime'
import { CompactObject, JsonTechnicalDetails, MemoryCheckSummary } from './AiReportCompactData'
import { AiExecutionStepsTab } from './AiExecutionStepsTab'

type AiExecutionReportModalProps = {
  show: boolean
  loading?: boolean
  error?: string
  report: any | null
  onHide: () => void
  onMarkReviewed?: (executionId: string) => Promise<void> | void
  onCreateBug?: (executionId: string, turnIndex?: number, findingType?: string) => Promise<void> | void
}

const statusColor = (status?: string) => {
  const value = String(status || '').toUpperCase()
  if (value.includes('PASO') || value.includes('PASS')) return 'success'
  if (value.includes('BLOQUE')) return 'primary'
  if (value.includes('FALLO') || value.includes('FAIL') || value.includes('ERROR')) return 'danger'
  return 'secondary'
}

const toolStatusLabelWithI18n = (status: string | undefined, t: (key: any, params?: any) => string) => ({
  PASSED: t('motorIa.toolStatusPassed'),
  FAILED: t('motorIa.toolStatusFailed'),
  NOT_OBSERVABLE: t('motorIa.toolStatusNotObservable'),
  BLOCKED: t('motorIa.toolStatusBlocked'),
}[String(status || '').toUpperCase()] || status || '-')

const executionStatusLabel = (status: any, t: (key: any, params?: any) => string) => {
  const normalized = String(status || '').trim().toUpperCase()
  const labels: Record<string, string> = {
    PASO: t('motorIa.statusPaso'), PASS: t('motorIa.statusPaso'), PASSED: t('motorIa.statusPaso'), SUCCESS: t('motorIa.statusPaso'),
    FALLO: t('motorIa.statusFallo'), FALLIDO: t('motorIa.statusFallo'), FAIL: t('motorIa.statusFallo'), FAILED: t('motorIa.statusFallo'),
    BLOQUEADO: t('motorIa.statusBloqueado'), BLOCKED: t('motorIa.statusBloqueado'), ERROR: t('motorIa.statusError'),
    REQUIERE_REVISION: t('motorIa.requiresHumanReview'), REQUIRES_REVIEW: t('motorIa.requiresHumanReview'), REVISADA: t('motorIa.reviewedByHuman'), REVIEWED: t('motorIa.reviewedByHuman'), NO_REQUIERE_REVISION: t('motorIa.noHumanReviewRequired'), NO_REVIEW_REQUIRED: t('motorIa.noHumanReviewRequired'), SIN_CORRER: t('motorIa.statusNotRun'), NOT_RUN: t('motorIa.statusNotRun'),
    EN_ESPERA: t('motorIa.statusEnEspera'), PENDING: t('motorIa.statusEnEspera'), EN_EJECUCION: t('motorIa.statusEnEjecucion'), EN_CURSO: t('motorIa.statusEnEjecucion'), EJECUTANDO_AI: t('motorIa.statusEnEjecucion'), RUNNING: t('motorIa.statusEnEjecucion'), TIMEOUT: t('motorIa.statusTimeout'), SKIPPED: t('motorIa.statusSkipped'), CANCELLED: t('motorIa.statusCancelled'), INVALID: t('motorIa.statusError'),
  }
  return labels[normalized] || (status || '-')
}

const formatDuration = (seconds: number | undefined, t: (key: any, params?: any) => string) => {
  if (!seconds) return t('common.notAvailable')
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return minutes ? t('motorIa.durationMinutes', { minutes, seconds: rest }) : t('motorIa.durationSeconds', { seconds: rest })
}

const getReport = (payload: any) => payload?.ai_report || payload || {}

const formatExpectedCriteriaWithI18n = (value: any, t: (key: any, params?: any) => string): string => {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(item => formatExpectedCriteriaWithI18n(item, t)).filter(Boolean).join(' · ')
  if (typeof value !== 'object') return String(value)
  const parts: string[] = []
  if (Array.isArray(value.must_include) && value.must_include.length) parts.push(`${t('motorIa.criteriaMustInclude')}: ${value.must_include.join(', ')}`)
  if (Array.isArray(value.must_not_include) && value.must_not_include.length) parts.push(`${t('motorIa.criteriaMustNotInclude')}: ${value.must_not_include.join(', ')}`)
  if (value.regex) parts.push(`${t('motorIa.criteriaMatches')}: ${value.regex}`)
  const knownKeys = new Set(['must_include', 'must_not_include', 'regex'])
  Object.entries(value).forEach(([key, item]) => {
    if (!knownKeys.has(key) && item !== undefined && item !== null && item !== '') parts.push(`${key}: ${typeof item === 'object' ? JSON.stringify(item) : String(item)}`)
  })
  return parts.join(' · ') || JSON.stringify(value)
}

export function AiExecutionReportModal({ show, loading, error, report, onHide, onMarkReviewed, onCreateBug }: AiExecutionReportModalProps) {
  const { t } = useI18n()
  const toolStatusLabel = (status: string | undefined) => toolStatusLabelWithI18n(status, t)
  const formatExpectedCriteria = (value: any) => formatExpectedCriteriaWithI18n(value, t)
  const [previewImage, setPreviewImage] = useState<{ src: string; title: string; subtitle?: string } | null>(null)
  const aiReport = getReport(report)
  const steps = Array.isArray(aiReport.steps) ? aiReport.steps : []
  const caseSteps = Array.isArray(aiReport.case_steps) ? aiReport.case_steps : []
  const confidence = report?.confidence ?? aiReport.confidence
  const consensus = report?.consensus ?? aiReport.consensus ?? aiReport.status
  const failureCategory = report?.failure_category ?? aiReport.failure_category
  const humanReview = Boolean(report?.human_review_required ?? aiReport.human_review_required)
  const reviewStatus = report?.review_status ?? aiReport.human_review_status ?? (humanReview ? 'REQUIERE_REVISION' : 'NO_REQUIERE_REVISION')
  const executionMode = report?.execution_mode ?? aiReport.execution_mode ?? 'IA'
  const errorCode = report?.error_code ?? aiReport.error_code ?? aiReport.ai_error_code
  const recoveredFromEngine = Boolean(report?.recovered ?? aiReport.recovered)
  const timeline = Array.isArray(aiReport.timeline) ? aiReport.timeline : []
  const agentConversation = Array.isArray(aiReport.agent_conversation) ? aiReport.agent_conversation : timeline
  const runtimeTraces = Array.isArray(report?.runtime_traces) ? report.runtime_traces : []
  const workflowSnapshot = aiReport.workflow_snapshot || aiReport.workflow_definition || aiReport.workflowDefinition || aiReport.snapshot_json || {}
  const workflowNodes = Array.isArray(workflowSnapshot.nodes) ? workflowSnapshot.nodes : []
  const workflowMeta = workflowSnapshot.workflow || {}
  const workflowName = workflowMeta.name || aiReport.workflow_name || t('motorIa.notProvided')
  const workflowId = workflowMeta.id || aiReport.workflow_id
  const workflowVersion = workflowMeta.version || aiReport.workflow_version
  const metrics = aiReport.metrics || {}
  const chatbotResult = aiReport.chatbot_resultado || report?.chatbot_resultado || null
  const chatbotTools = Array.isArray(chatbotResult?.tools) ? chatbotResult.tools : []
  const parameters = aiReport.parameters || {}
  const visualAudit = aiReport.visual_audit || {}
  const visualEvidenceRefs = new Set<string>(Array.isArray(visualAudit.evidence_refs) ? visualAudit.evidence_refs.map(String) : [])
  const visualAuditApplied = visualAudit.enabled === true
  const dataset = aiReport.dataset || aiReport.data || {}
  const auditEvidenceSteps = Array.isArray(aiReport.audit_evidence?.steps) ? aiReport.audit_evidence.steps : []
  const expectedResult = report?.expected_result || aiReport.expected_result || (auditEvidenceSteps.length === 1 ? auditEvidenceSteps[0]?.expected_result : '')
  const chatbotConfig = report?.chatbot_config_snapshot || aiReport.chatbot_config_snapshot || {}
  const evaluationContract = chatbotResult?.evaluation_contract || {
    profile_goal: chatbotConfig.profile?.goal || aiReport.objective || '',
    deterministic: {
      assertions: [
        ...(Array.isArray(chatbotConfig.assertions || chatbotConfig.validations) ? (chatbotConfig.assertions || chatbotConfig.validations) : []),
        ...(Array.isArray(chatbotConfig.evaluation?.deterministic?.assertions) ? chatbotConfig.evaluation.deterministic.assertions : []),
      ],
      required_validations: chatbotConfig.evaluation?.deterministic?.required_validations || [],
      forbidden_patterns: chatbotConfig.evaluation?.deterministic?.forbidden_patterns || [],
    },
    semantic: chatbotConfig.evaluation?.semantic || {},
  }
  const configuredChatbotTurns = [
    ...(chatbotConfig.conversation?.opening_message?.text ? [{ expected: chatbotConfig.conversation.opening_message.expected }] : []),
    ...(Array.isArray(chatbotConfig.conversation?.turns) ? chatbotConfig.conversation.turns : []),
  ]
  const chatbotExpectedForTurn = (turn: any) => {
    if (turn?.expected && typeof turn.expected === 'object' && Object.keys(turn.expected).length) return turn.expected
    return configuredChatbotTurns[Math.max(0, Number(turn?.index || 1) - 1)]?.expected || {}
  }
  const hasMetricValue = (value: any) => value !== undefined && value !== null
  const formatMetricNumber = (value: any) => hasMetricValue(value) ? Number(value || 0).toLocaleString() : t('motorIa.notProvided')
  const formatMetricMs = (value: any) => hasMetricValue(value) ? `${Number(value || 0).toLocaleString()}ms` : t('motorIa.notProvided')
  const formatMetricMoney = (value: any) => hasMetricValue(value) ? `$${Number(value || 0).toFixed(5)}` : t('motorIa.notProvided')

  const isPreviewOpen = Boolean(previewImage)
  const closeReport = () => {
    setPreviewImage(null)
    onHide()
  }

  return (
    <>
    <Modal dialogClassName="ai-report-modal" data-testid="ai-report-modal" show={show && !isPreviewOpen} onHide={closeReport} size="xl" centered scrollable>
      <Modal.Header closeButton closeLabel={t('motorIa.close')}>
        <Modal.Title className="fw-bold d-flex align-items-center gap-2">
          <Images size={18} className="text-primary" />
          {t('motorIa.reportTitle')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {loading && <div className="text-center text-muted py-5">{t('motorIa.loadingReport')}</div>}
        {error && <Alert variant="danger">{error}</Alert>}
        {!loading && !error && report && (
          <div className="d-flex flex-column gap-3">
            <Card className="border p-3">
              <div className="d-flex flex-wrap justify-content-between gap-3">
                <div>
                  <div className="d-flex align-items-center gap-2 mb-1">
                    <Badge bg="light" text="primary" className="border">{report.case_code || aiReport.case_code || '-'}</Badge>
                    <span className="fw-bold">{report.case_title || aiReport.case_title || t('motorIa.aiCase')}</span>
                  </div>
                  <div className="small text-muted">{aiReport.summary || report.observations || t('motorIa.noSummary')}</div>
                </div>
                <div className="d-flex flex-wrap gap-2 align-items-start">
                  <Badge bg={statusColor(report.status || aiReport.status)}>{executionStatusLabel(report.status || aiReport.status, t)}</Badge>
                  <Badge bg={executionMode === 'IA' ? 'primary' : 'secondary'}>{t('motorIa.executedBy', { mode: executionMode === 'IA' ? t('motorIa.modeAi') : executionMode })}</Badge>
                  <Badge bg={statusColor(consensus)}>{t('motorIa.consensus', { value: executionStatusLabel(consensus, t) })}</Badge>
                  <Badge bg={visualAuditApplied ? 'info' : 'secondary'}>
                    {visualAuditApplied ? t('motorIa.visualAuditApplied') : t('motorIa.visualAuditNotApplied')}
                  </Badge>
                  <Badge bg={confidence >= 70 ? 'success' : 'warning'} text={confidence >= 70 ? undefined : 'dark'}>{t('motorIa.confidence', { value: confidence ?? 0 })}</Badge>
                  {recoveredFromEngine && <Badge bg="info" text="dark">{t('motorIa.recoveredFromEngine')}</Badge>}
                  {humanReview && <Badge bg="danger">{t('motorIa.requiresHumanReview')}</Badge>}
                  {reviewStatus === 'REVISADA' && <Badge bg="success">{t('motorIa.reviewedByHuman')}</Badge>}
                  {errorCode && <Badge bg="dark">{errorCode}</Badge>}
                  {onCreateBug && ['FALLO', 'FALLIDO', 'BLOQUEADO', 'FAILED', 'ERROR', 'REQUIERE'].some(value => String(report.status || aiReport.status || report.review_status || aiReport.review_status || '').toUpperCase().includes(value)) && <Button size="sm" variant="outline-danger" onClick={() => onCreateBug(report.execution_id, undefined, 'INVALID_RESPONSE')}>{t('motorIa.createConversationalBug')}</Button>}
                </div>
              </div>
              <Row className="g-2 small mt-3">
                <Col md={3}><span className="text-muted">{t('common.duration')}</span> {formatDuration(report.duration_seconds || aiReport.duration_seconds, t)}</Col>
                <Col md={3}><span className="text-muted">{t('common.category')}</span> {failureCategory ? executionStatusLabel(failureCategory, t) : '-'}</Col>
                <Col md={3}><span className="text-muted">{t('common.review')}</span> {reviewStatus === 'REQUIERE_REVISION' ? t('motorIa.requiresHumanReview') : reviewStatus === 'NO_REQUIERE_REVISION' ? t('motorIa.noHumanReviewRequired') : executionStatusLabel(reviewStatus, t)}</Col>
                <Col md={3}><span className="text-muted">{t('common.model')}</span> {aiReport.model || '-'}</Col>
                <Col md={3}><span className="text-muted">{t('common.errorCode')}</span> {errorCode || '-'}</Col>
                <Col md={6}><span className="text-muted">{t('common.workflowUsed')}</span> <strong>{workflowName}</strong>{workflowVersion ? ` · v${workflowVersion}` : ''}{workflowId ? ` · ${String(workflowId).slice(0, 8)}` : ''}</Col>
              </Row>
            </Card>

            <Tabs defaultActiveKey="summary" className="mb-2">
              <Tab eventKey="summary" title={t('motorIa.summaryTab')}>
                <Row className="g-3 pt-3">
                  {aiReport.repeatability_warning && (
                    <Col md={12}>
                      <Alert variant="warning" className="mb-0">
                        {t('motorIa.repeatabilityWarning')}
                      </Alert>
                    </Col>
                  )}
                  <Col md={3}><Card className="border p-3 h-100"><div className="x-small text-muted fw-bold text-uppercase">{t('motorIa.aiStatus')}</div><div className="fw-bold">{executionStatusLabel(report.status || aiReport.status, t)}</div></Card></Col>
                  <Col md={3}><Card className="border p-3 h-100"><div className="x-small text-muted fw-bold text-uppercase">{t('motorIa.consensus', { value: consensus || '-' })}</div><div className="fw-bold">{executionStatusLabel(consensus, t)}</div></Card></Col>
                  <Col md={3}><Card className="border p-3 h-100"><div className="x-small text-muted fw-bold text-uppercase">{t('motorIa.confidence', { value: confidence ?? 0 })}</div><div className="fw-bold">{confidence ?? 0}%</div></Card></Col>
                  <Col md={3}><Card className="border p-3 h-100"><div className="x-small text-muted fw-bold text-uppercase">{t('motorIa.aiReview')}</div><div className="fw-bold">{reviewStatus === 'REQUIERE_REVISION' ? t('motorIa.requiresHumanReview') : reviewStatus === 'NO_REQUIERE_REVISION' ? t('motorIa.noHumanReviewRequired') : executionStatusLabel(reviewStatus, t)}</div></Card></Col>
                  {reviewStatus === 'REQUIERE_REVISION' && onMarkReviewed && report?.execution_id && (
                    <Col md={12}>
                      <Alert variant="warning" className="d-flex justify-content-between align-items-center gap-3 mb-0">
                        <span>{t('motorIa.reviewAlert')}</span>
                        <Button size="sm" variant="warning" className="fw-bold" onClick={() => onMarkReviewed(report.execution_id)}>
                          {t('motorIa.markAsReviewed')}
                        </Button>
                      </Alert>
                    </Col>
                  )}
                  <Col md={12}>
                    <Alert variant={visualAuditApplied ? 'info' : 'light'} className="border small mb-3">
                      <span className="fw-bold">{t('common.visualAudit')} </span>
                      {visualAudit.reason || (visualAuditApplied ? t('common.visualAuditEvidence') : t('common.deterministicValidation'))}
                    </Alert>
                    <Card className="border p-3">
                      <div className="x-small text-muted fw-bold text-uppercase mb-1">{t('motorIa.reason')}</div>
                      <div className="small">{aiReport.summary || report.observations || '-'}</div>
                      {Array.isArray(aiReport.errors) && aiReport.errors.length > 0 && (
                        <Alert variant="danger" className="mt-3 mb-0 small">
                          {aiReport.errors.map((item: any, index: number) => <div key={index}>{String(item)}</div>)}
                        </Alert>
                      )}
                      {Array.isArray(aiReport.previous_recent_results) && aiReport.previous_recent_results.length > 0 && (
                        <div className="mt-3">
                          <div className="x-small text-muted fw-bold text-uppercase mb-1">{t('common.recentResultsCompared')}</div>
                          {aiReport.previous_recent_results.map((item: any, index: number) => (
                            <div key={index} className="small d-flex justify-content-between border-top py-1">
                              <span>{item.run_name || item.run_id}</span>
                              <span className="fw-bold">{executionStatusLabel(item.status, t)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </Card>
                    {expectedResult && (
                      <Card className="border border-primary-subtle bg-primary-subtle p-3 mt-3 mb-0">
                        <div className="x-small text-primary fw-bold text-uppercase mb-1">{t('motorIa.expectedResultEvaluated')}</div>
                        <div className="small">{formatExpectedCriteria(expectedResult)}</div>
                      </Card>
                    )}
                  </Col>
                </Row>
              </Tab>
              {chatbotResult && (
                <Tab eventKey="chatbot" title={`Chatbot (${Array.isArray(chatbotResult.turns) ? chatbotResult.turns.length : 0})`}>
                  <div className="d-flex flex-column gap-3 pt-3">
                    <Alert variant="warning" className="small mb-0">{t('motorIa.reportQaWarning')}</Alert>
                    <Card className="border p-3">
                      <div className="d-flex flex-wrap gap-3 small"><span>{t('motorIa.turnsLabel')}: <strong>{chatbotResult.turns?.length || 0}</strong></span><span>{t('motorIa.totalLatencyLabel')}: <strong>{chatbotResult.performance?.total_latency_ms || 0}ms</strong></span><span>{t('motorIa.p95Label')}: <strong>{chatbotResult.performance?.p95_latency_ms || 0}ms</strong></span><span>{t('motorIa.failedValidations')}: <strong>{chatbotResult.assertions?.filter((item: any) => item.passed === false).length || 0}</strong></span><span>{t('motorIa.unobservableTools')}: <strong>{chatbotTools.filter((item: any) => item.status === 'NOT_OBSERVABLE').length}</strong></span><span>{t('motorIa.blockedTools')}: <strong>{chatbotTools.filter((item: any) => item.status === 'BLOCKED').length}</strong></span><span>{t('motorIa.findings')}: <strong>{chatbotResult.security_findings?.length || 0}</strong></span></div>
                    </Card>
                    <Card className="border border-primary-subtle bg-primary-subtle p-3">
                      <div className="fw-bold small mb-2">{t('motorIa.expectedEvaluation')}</div>
                      {evaluationContract.profile_goal && <div className="small mb-2"><strong>{t('motorIa.objectiveLabel')}:</strong> {formatExpectedCriteria(evaluationContract.profile_goal)}</div>}
                      {evaluationContract.semantic?.criteria?.length > 0 && <div className="small mb-2"><strong>{t('motorIa.semanticCriteria')}:</strong> {evaluationContract.semantic.criteria.join(', ')}{evaluationContract.semantic.minimum_score !== undefined ? ` · ${t('motorIa.minimumScore', { value: evaluationContract.semantic.minimum_score })}` : ''}</div>}
                      {evaluationContract.deterministic?.assertions?.length > 0 && <div className="small mb-2"><strong>{t('motorIa.deterministicValidations')}:</strong> {evaluationContract.deterministic.assertions.map((item: any) => formatExpectedCriteria(item)).filter(Boolean).join(' · ')}</div>}
                      {evaluationContract.deterministic?.required_validations?.length > 0 && <div className="small mb-2"><strong>{t('motorIa.requiredControls')}:</strong> {evaluationContract.deterministic.required_validations.join(', ')}</div>}
                      {evaluationContract.deterministic?.forbidden_patterns?.length > 0 && <div className="small mb-0"><strong>{t('motorIa.forbiddenPatterns')}:</strong> {evaluationContract.deterministic.forbidden_patterns.join(', ')}</div>}
                      {!evaluationContract.profile_goal && !evaluationContract.semantic?.criteria?.length && !evaluationContract.deterministic?.assertions?.length && !evaluationContract.deterministic?.required_validations?.length && !evaluationContract.deterministic?.forbidden_patterns?.length && <div className="small text-muted">{t('motorIa.noExplicitCriterion')}</div>}
                    </Card>
                    <div className="row g-3">
                      <div className="col-md-6">
                        <Card className="border p-3 h-100">
                          <div className="fw-bold small mb-2">{t('motorIa.userProfile')}</div>
                          <CompactObject value={chatbotResult.profile || {}} />
                          <JsonTechnicalDetails value={chatbotResult.profile || {}} />
                        </Card>
                      </div>
                      <div className="col-md-6">
                        <Card className="border p-3 h-100">
                          <div className="fw-bold small mb-2">{t('motorIa.memoryAndTools')}</div>
                          <div className="small mb-2">{t('motorIa.memoryChecks')}: <strong>{chatbotResult.memory_checks?.length || 0}</strong></div>
                          <MemoryCheckSummary checks={chatbotResult.memory_checks || []} />
                          <div className="small mb-2">{t('motorIa.tools')}: <strong>{chatbotTools.length}</strong></div>
                          {chatbotTools.length > 0 && <div className="table-responsive"><Table size="sm" bordered className="small mb-0"><thead><tr><th>{t('motorIa.tool')}</th><th>{t('motorIa.observation')}</th><th>{t('motorIa.status')}</th><th /></tr></thead><tbody>{chatbotTools.map((tool: any, index: number) => <tr key={`${tool.name || 'tool'}-${index}`}><td className="font-monospace">{tool.name || '-'}</td><td>{tool.observation_mode === 'black_box' ? t('motorIa.finalResponse') : tool.evidence_source === 'response_payload' ? t('motorIa.apiResponse') : tool.observation_mode || '-'}</td><td><Badge bg={statusColor(tool.status)}>{toolStatusLabel(tool.status)}</Badge></td><td>{onCreateBug && ['FAILED', 'BLOCKED'].includes(String(tool.status || '').toUpperCase()) && <Button size="sm" variant="outline-danger" onClick={() => onCreateBug(report.execution_id, undefined, 'tool')}>{t('motorIa.createBug')}</Button>}</td></tr>)}</tbody></Table></div>}
                          <JsonTechnicalDetails value={{ memory_checks: chatbotResult.memory_checks || [], tools: chatbotResult.tools || [] }} />
                        </Card>
                      </div>
                    </div>
                    {(chatbotResult.turns || []).map((turn: any, turnPosition: number) => (
                      <Card key={turn.index} className="border p-3">
                        <div className="d-flex justify-content-between align-items-center gap-2 mb-2"><div className="fw-bold">{t('motorIa.visibleTurn', { number: Number(turn.technical_index ?? turnPosition) + 1 })} · {t('motorIa.technicalIndex', { number: Number(turn.technical_index ?? turnPosition) })} · {turn.role}</div><div className="d-flex gap-2 align-items-center"><Badge bg={statusColor(turn.status)}>{executionStatusLabel(turn.status, t)}</Badge><Badge bg="light" text="dark" className="border">{turn.latencyMs || 0}ms · HTTP {turn.statusCode || '-'}</Badge>{onCreateBug && (String(turn.status || '').toUpperCase() !== 'SUCCESS' || Number(turn.statusCode || 0) >= 400 || (turn.assertions || []).some((item: any) => item.passed === false)) && <Button size="sm" variant="outline-danger" onClick={() => onCreateBug(report.execution_id, Number(turn.technical_index ?? turnPosition), Number(turn.statusCode || 0) >= 400 ? 'http' : 'validation')}>{t('motorIa.createBug')}</Button>}</div></div>
                        <div className="small"><strong>{t('motorIa.input')}:</strong> {turn.message || '-'}</div>
                        <div className="border-start border-3 border-primary ps-2 mt-2 small"><strong>{t('motorIa.expectedCriterion')}:</strong> {formatExpectedCriteria(chatbotExpectedForTurn(turn)) || t('motorIa.evaluatedAgainstRubric')}</div>
                        <div className="small mt-1"><strong>{t('motorIa.response')}:</strong> {turn.responseText || '-'}</div>
                        {turn.assertions?.length > 0 && <div className="small mt-2"><strong>{t('motorIa.checks')}:</strong><ul className="mb-0 mt-1 ps-3">{turn.assertions.map((item: any, index: number) => <li key={index}><Badge bg={item.passed ? 'success' : 'danger'} className="me-1">{item.passed ? t('motorIa.passed') : t('motorIa.failed')}</Badge>{formatExpectedCriteria(item.expected ?? item.value ?? item.equals) || item.rule || t('motorIa.rule')}{item.actual !== undefined ? ` · ${t('motorIa.observed')}: ${formatExpectedCriteria(item.actual)}` : ''}</li>)}</ul></div>}
                        <details className="mt-2"><summary className="small text-primary fw-semibold">{t('motorIa.viewFullRequestResponse')}</summary><div className="row g-2 mt-1"><div className="col-md-6"><div className="x-small text-muted">{t('motorIa.request')}</div><pre className="bg-light border rounded-2 p-2 small mb-0 overflow-auto">{JSON.stringify(turn.request, null, 2)}</pre></div><div className="col-md-6"><div className="x-small text-muted">{t('motorIa.responsePayload')}</div><pre className="bg-light border rounded-2 p-2 small mb-0 overflow-auto">{JSON.stringify(turn.response, null, 2)}</pre></div></div></details>
                      </Card>
                    ))}
                    <Card className="border p-3"><div className="fw-bold small mb-2">{t('motorIa.resolvedVariables')}</div><CompactObject value={chatbotResult.variables || aiReport.chatbot_config_snapshot?.variables || {}} emptyLabel={t('motorIa.noResolvedVariables')} /><JsonTechnicalDetails value={chatbotResult.variables || aiReport.chatbot_config_snapshot?.variables || {}} /></Card>
                    {chatbotResult.security_findings?.length > 0 && <Alert variant="danger" className="small mb-0"><strong>{t('motorIa.securityFindings')}</strong><div className="mt-2">{chatbotResult.security_findings.map((finding: any, index: number) => <div key={index}>• {finding.type || t('motorIa.finding')}{finding.pattern ? ` · ${finding.pattern}` : ''}{finding.turn ? ` · ${t('motorIa.turn')} ${finding.turn}` : ''}</div>)}</div><JsonTechnicalDetails value={chatbotResult.security_findings} /></Alert>}
                  </div>
                </Tab>
              )}
              <Tab eventKey="agents" title={`${t('motorIa.agentsTab')} (${agentConversation.length})`}>
                <div className="d-flex flex-column gap-2 pt-3">
                  <Alert variant="light" className="border small text-muted mb-1">
                    {t('motorIa.agentEventsDescription', { events: agentConversation.length, nodes: workflowNodes.length })}
                  </Alert>
                  {agentConversation.map((event: any, index: number) => (
                    <Card key={`${event.ts}-${index}`} className="border p-3">
                      <div className="d-flex flex-wrap justify-content-between gap-2 mb-1">
                        <div className="d-flex flex-wrap align-items-center gap-2">
                          <Badge bg="dark">{event.agent || event.source || 'AGENT'}</Badge>
                          <Badge bg={String(event.level || '').toUpperCase() === 'ERROR' ? 'danger' : String(event.level || '').toUpperCase() === 'WARN' ? 'warning' : 'secondary'}>
                            {event.level || t('motorIa.info')}
                          </Badge>
                          {event.step && <Badge bg="light" text="dark" className="border">{t('motorIa.stepNumber', { number: event.step })}</Badge>}
                          {event.attempt && <Badge bg="light" text="dark" className="border">{t('motorIa.stepAttempt', { number: event.attempt })}</Badge>}
                          {(event.error_code || event.ai_error_code) && <Badge bg="danger">{event.error_code || event.ai_error_code}</Badge>}
                        </div>
                        <span className="x-small text-muted">{formatDateTime(event.ts) || '-'}</span>
                      </div>
                      <div className="small">{event.message || '-'}</div>
                      {(event.reason || typeof event.confidence === 'number') && (
                        <div className="x-small text-muted mt-2">
                          {event.reason && <span>{t('motorIa.reasonLabel')}: {event.reason}</span>}
                          {typeof event.confidence === 'number' && <span>{event.reason ? ' · ' : ''}{t('motorIa.confidenceLabel')}: {event.confidence}%</span>}
                        </div>
                      )}
                      {(event.action || event.input_json || event.output_json) && (
                        <details className="mt-2">
                          <summary className="x-small text-primary fw-bold">{t('motorIa.traceContext')}</summary>
                          {event.action && <div className="small mt-2"><strong>{t('motorIa.proposedAction')}:</strong> {formatExpectedCriteria(event.action)}</div>}
                          {event.input_json && <div className="mt-2"><div className="x-small text-muted">{t('motorIa.nodeInput')}</div><pre className="bg-light border rounded-2 p-2 small mb-2 overflow-auto">{JSON.stringify(event.input_json, null, 2)}</pre></div>}
                          {event.output_json && <div><div className="x-small text-muted">{t('motorIa.nodeOutput')}</div><pre className="bg-light border rounded-2 p-2 small mb-0 overflow-auto">{JSON.stringify(event.output_json, null, 2)}</pre></div>}
                        </details>
                      )}
                      {event.metrics && (
                        <div className="x-small text-muted mt-2">
                          {t('motorIa.tokens')}: {formatMetricNumber(event.metrics.totalTokens ?? event.metrics.total_tokens)}
                          {' · '}{t('motorIa.latency')}: {formatMetricMs(event.metrics.latencyMs ?? event.metrics.latency_ms)}
                          {' · '}{t('motorIa.cost')}: {formatMetricMoney(event.metrics.estimatedCost ?? event.metrics.estimated_cost)}
                        </div>
                      )}
                      {(event.prompt_excerpt || event.raw_response_excerpt) && (
                        <details className="mt-2">
                          <summary className="x-small text-primary fw-bold">{t('motorIa.promptResponse')}</summary>
                          {event.prompt_excerpt && <pre className="bg-light border rounded-2 p-2 small mt-2 mb-2">{event.prompt_excerpt}</pre>}
                          {event.raw_response_excerpt && <pre className="bg-light border rounded-2 p-2 small mb-0">{event.raw_response_excerpt}</pre>}
                        </details>
                      )}
                    </Card>
                  ))}
                  {agentConversation.length === 0 && <Alert variant="light" className="border text-muted">{t('motorIa.noAgentConversation')}</Alert>}
                </div>
              </Tab>
              <Tab eventKey="runtime" title={`${t('motorIa.runtimeTab')} (${runtimeTraces.length})`}>
                <div className="d-flex flex-column gap-2 pt-3">
                  <Alert variant="light" className="border small text-muted mb-1">
                    {t('motorIa.runtimeDescription')}
                  </Alert>
                  {runtimeTraces.map((trace: any, index: number) => (
                    <Card key={trace.id || `${trace.node_id}-${index}`} className="border p-3">
                      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
                        <div className="d-flex flex-wrap align-items-center gap-2">
                          <Badge bg="dark">{trace.node_name || trace.node_id || t('motorIa.workflow')}</Badge>
                          <Badge bg={statusColor(trace.status)}>{executionStatusLabel(trace.status, t)}</Badge>
                          {trace.node_type && <span className="x-small text-muted">{trace.node_type}</span>}
                        </div>
                        <span className="x-small text-muted">{formatDateTime(trace.started_at || trace.ts) || '-'}</span>
                      </div>
                      <div className="row g-2">
                        <div className="col-md-6">
                          <div className="x-small text-muted">{t('motorIa.nodeInput')}</div>
                          <pre className="bg-light border rounded-2 p-2 small mb-0 overflow-auto">{JSON.stringify(trace.input_json || {}, null, 2)}</pre>
                        </div>
                        <div className="col-md-6">
                          <div className="x-small text-muted">{t('motorIa.nodeOutput')}</div>
                          <pre className="bg-light border rounded-2 p-2 small mb-0 overflow-auto">{JSON.stringify(trace.output_json || {}, null, 2)}</pre>
                        </div>
                      </div>
                      {trace.metrics_json && <details className="mt-2"><summary className="x-small text-primary fw-bold">{t('motorIa.metricsTab')}</summary><pre className="bg-light border rounded-2 p-2 small mt-2 mb-0 overflow-auto">{JSON.stringify(trace.metrics_json, null, 2)}</pre></details>}
                    </Card>
                  ))}
                  {runtimeTraces.length === 0 && <Alert variant="light" className="border text-muted">{t('motorIa.noRuntimeTraces')}</Alert>}
                </div>
              </Tab>
              <Tab eventKey="steps" title={`${t('motorIa.stepsTab')} (${caseSteps.length || steps.length})`}>
                <AiExecutionStepsTab
                  aiReport={aiReport}
                  steps={steps}
                  caseSteps={caseSteps}
                  timeline={timeline}
                  agentConversation={agentConversation}
                  auditEvidenceSteps={auditEvidenceSteps}
                  visualEvidenceRefs={visualEvidenceRefs}
                  formatValue={formatExpectedCriteria}
                  statusColor={statusColor}
                  onPreview={setPreviewImage}
                />
              </Tab>
              <Tab eventKey="consensus" title={t('motorIa.consensusTabTitle')}>
                <pre className="bg-light border rounded-3 p-3 small mt-3 mb-0">{JSON.stringify(aiReport.consensus_signals || {}, null, 2)}</pre>
              </Tab>
              <Tab eventKey="metrics" title={t('motorIa.metricsTab')}>
                <Row className="g-3 pt-3">
                  <Col md={3}><Card className="border p-3"><div className="x-small text-muted fw-bold text-uppercase">{t('motorIa.promptTokens')}</div><div className="fw-bold">{formatMetricNumber(metrics.promptTokens ?? metrics.prompt_tokens)}</div></Card></Col>
                  <Col md={3}><Card className="border p-3"><div className="x-small text-muted fw-bold text-uppercase">{t('motorIa.completionTokens')}</div><div className="fw-bold">{formatMetricNumber(metrics.completionTokens ?? metrics.completion_tokens)}</div></Card></Col>
                  <Col md={3}><Card className="border p-3"><div className="x-small text-muted fw-bold text-uppercase">{t('motorIa.totalTokens')}</div><div className="fw-bold">{formatMetricNumber(metrics.totalTokens ?? metrics.total_tokens)}</div></Card></Col>
                  <Col md={3}><Card className="border p-3"><div className="x-small text-muted fw-bold text-uppercase">{t('motorIa.aiCalls')}</div><div className="fw-bold">{formatMetricNumber(metrics.aiCalls)}</div></Card></Col>
                  <Col md={3}><Card className="border p-3"><div className="x-small text-muted fw-bold text-uppercase">{t('motorIa.totalLatency')}</div><div className="fw-bold">{formatMetricMs(metrics.latencyMs ?? metrics.latency_ms)}</div></Card></Col>
                  <Col md={3}><Card className="border p-3"><div className="x-small text-muted fw-bold text-uppercase">{t('motorIa.avgLatency')}</div><div className="fw-bold">{formatMetricMs(metrics.avg_latency_ms)}</div></Card></Col>
                  <Col md={3}><Card className="border p-3"><div className="x-small text-muted fw-bold text-uppercase">{t('motorIa.estimatedCost')}</div><div className="fw-bold">{formatMetricMoney(metrics.estimatedCost ?? metrics.estimated_cost)}</div></Card></Col>
                  <Col md={3}><Card className="border p-3"><div className="x-small text-muted fw-bold text-uppercase">{t('motorIa.duration')}</div><div className="fw-bold">{formatDuration(metrics.duration_seconds || aiReport.duration_seconds, t)}</div></Card></Col>
                </Row>
              </Tab>
              <Tab eventKey="data" title={t('motorIa.dataTab')}>
                <div className="pt-3 d-flex flex-column gap-3">
                  <Card className="border p-3">
                    <div className="fw-bold small mb-2">{t('motorIa.parametersSent')}</div>
                    <pre className="bg-light border rounded-3 p-3 small mb-0">{JSON.stringify(parameters, null, 2)}</pre>
                  </Card>
                  <Card className="border p-3">
                    <div className="fw-bold small mb-2">{t('motorIa.datasetVariables')}</div>
                    <pre className="bg-light border rounded-3 p-3 small mb-0">{JSON.stringify(dataset, null, 2)}</pre>
                  </Card>
                  <Card className="border p-3">
                    <div className="fw-bold small mb-2">{t('motorIa.visitedUrls')}</div>
                    {(aiReport.visited_urls || []).length > 0 ? (
                      <ul className="small mb-0">{aiReport.visited_urls.map((url: string, index: number) => <li key={`${url}-${index}`}>{url}</li>)}</ul>
                    ) : <div className="small text-muted">{t('motorIa.noUrls')}</div>}
                  </Card>
                </div>
              </Tab>
              <Tab eventKey="raw" title={t('motorIa.rawTab')}>
                <pre className="bg-dark text-light rounded-3 p-3 small mt-3 mb-0" style={{ maxHeight: 520, overflow: 'auto' }}>{JSON.stringify(aiReport, null, 2)}</pre>
              </Tab>
            </Tabs>
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={closeReport}>{t('motorIa.close')}</Button>
      </Modal.Footer>
    </Modal>
    <Modal dialogClassName="ai-evidence-modal" data-testid="ai-evidence-preview-modal" show={show && isPreviewOpen} onHide={() => setPreviewImage(null)} size="xl" centered>
      <Modal.Header closeButton closeLabel={t('motorIa.close')}>
        <Modal.Title className="fw-bold d-flex align-items-center gap-2">
          <Eye size={18} className="text-primary" />
          {previewImage?.title || t('motorIa.previewEvidence')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="bg-dark p-2">
        {previewImage?.subtitle && <div className="text-light small px-2 pb-2">{previewImage.subtitle}</div>}
        {previewImage?.src && (
          <img
            src={previewImage.src}
            alt={previewImage.title}
            className="d-block w-100 rounded-2"
            style={{ maxHeight: '78vh', objectFit: 'contain' }}
          />
        )}
      </Modal.Body>
    </Modal>
    </>
  )
}
