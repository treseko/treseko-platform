import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Col, Form, Modal, Nav, Row, Spinner } from 'react-bootstrap'
import { AlertCircle, ArrowLeft, Braces, Bug, CheckCircle2, Clock3, Code2, Eye, Info, PlayCircle, RefreshCw, RotateCcw, Terminal } from 'lucide-react'
import { useI18n } from '../../i18n'

function isPassed(status: any) {
  return ['PASSED', 'PASSED_WITH_WARNINGS', 'PASO'].includes(String(status || '').toUpperCase())
}

function isReportable(status: any, result: any) {
  if (['FALLO', 'FALLIDO', 'FAILED', 'ERROR', 'BLOQUEADO', 'BLOCKED'].includes(String(status || '').toUpperCase())) return true
  return (result?.steps || []).some((step: any) => ['FAILED', 'BLOCKED'].includes(String(step?.status || '').toUpperCase()) || (step?.assertions || []).some((assertion: any) => assertion?.status === 'FAILED'))
}

function valueText(value: any, t?: (key: string) => string) {
  if (value === undefined || value === null || value === '') return t?.('ejecutarPruebas.apiNoContent') || ''
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
}

function responseText(response: any, t?: (key: string) => string) {
  if (!response || response.status == null) return t?.('ejecutarPruebas.apiNoResponse') || ''
  if (response.body_json !== undefined && response.body_json !== null) return valueText(response.body_json, t)
  if (response.body !== undefined && response.body !== null && response.body !== '') return valueText(response.body, t)
  if (response.text !== undefined && response.text !== null && response.text !== '') return valueText(response.text, t)
  return (t?.('ejecutarPruebas.apiHttpNoContent') || '').replace('{status}', String(response.status))
}

function apiConfigFor(test: any) {
  return test?.configuracion_api || test?.apiConfig || {}
}

function requestFor(test: any, result: any, t?: (key: string) => string) {
  const config = apiConfigFor(test)
  // The saved definition is the template. The runner snapshot is only a
  // fallback for legacy results that do not have the original definition.
  // This keeps the checkbox meaningful after execution: unchecked shows the
  // template, checked shows the resolved request.
  const request = config.request || result?.result?.steps?.[0]?.request || result?.steps?.[0]?.request || {}
  return {
    method: request.method || config.method || 'GET',
    url: request.url || config.url || config.request?.url || t?.('ejecutarPruebas.apiInheritedEnvironmentUrl') || '',
    body: request.body ?? config.body ?? config.request?.body,
    headers: request.headers || config.headers || config.request?.headers || [],
    auth: request.auth || config.auth || config.request?.auth || {},
  }
}

function collectPlaceholderKeys(value: any, keys = new Set<string>()) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\{\{([^}]+)\}\}/g)) {
      const key = String(match[1] || '').trim()
      if (key) keys.add(key)
    }
  } else if (Array.isArray(value)) {
    value.forEach(item => collectPlaceholderKeys(item, keys))
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach(item => collectPlaceholderKeys(item, keys))
  }
  return keys
}

function isSensitiveKey(key: any) {
  return /token|secret|password|passwd|authorization|api[-_]?key|cookie/i.test(String(key || ''))
}

function resolveValue(value: any, variables: Record<string, any>) {
  if (typeof value === 'string') return value.replace(/\{\{([^}]+)\}\}/g, (match, rawKey) => {
    const key = String(rawKey || '').trim()
    return variables[key] == null ? match : String(variables[key])
  })
  if (Array.isArray(value)) return value.map(item => resolveValue(item, variables))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveValue(item, variables)]))
  return value
}

function displayStatus(status: any, pending = false, t?: (key: string) => string) {
  const translate = t || ((key: string) => key)
  if (pending) return { label: translate('ejecutarPruebas.apiStatusPending'), variant: 'secondary' as const }
  if (String(status || '').toUpperCase() === 'PENDIENTE') return { label: translate('ejecutarPruebas.apiStatusPending'), variant: 'secondary' as const }
  if (isPassed(status)) return { label: translate('ejecutarPruebas.apiStatusPassed'), variant: 'success' as const }
  if (['BLOCKED', 'BLOQUEADO'].includes(String(status || '').toUpperCase())) return { label: translate('ejecutarPruebas.apiStatusBlocked'), variant: 'primary' as const }
  return { label: translate('ejecutarPruebas.apiStatusFailed'), variant: 'danger' as const }
}

function manualStatusValue(status: any) {
  const normalized = String(status || '').toUpperCase()
  if (['PASSED', 'PASSED_WITH_WARNINGS', 'PASO'].includes(normalized)) return 'PASO'
  if (['BLOCKED', 'BLOQUEADO'].includes(normalized)) return 'BLOQUEADO'
  return 'FALLO'
}

function hasExecutedApiResult(result: any) {
  if (!result) return false
  const manualStatus = result.manual_evaluation?.status || result.result?.manual_evaluation?.status
  if (manualStatus) return true
  const status = String(result.status || result.result?.status || '').toUpperCase()
  return !['', 'PENDIENTE', 'SIN_CORRER', 'EN_ESPERA', 'QUEUED', 'NOT_EXECUTED'].includes(status)
}

const EMPTY_RELATED_BUGS: any[] = []

export function ApiExecutionConsolePage({
  selectedTest,
  apiExecutionResults,
  executionDatasetPreview,
  currentProjectEnvironments = [],
  returnToExecutionList,
  onRepeatExecution,
  onExecuteRequest,
  onAdvanceApiCase,
  onDeferApiCase,
  onSaveApiEvaluation,
  onApiVerdictSaved,
  relatedCaseBugs = EMPTY_RELATED_BUGS,
  relatedCaseBugsLoading = false,
  onLoadRelatedBugs,
  onPrepareApiBug,
  onLinkApiExecutionToBug,
  onViewRelatedBug,
  canViewBugs = true,
  canCreateBugs = true,
}: any) {
  const { t } = useI18n()
  const tests = apiExecutionResults?.tests || []
  const results = apiExecutionResults?.executions || []
  const batchPending = Boolean(apiExecutionResults?.pending)
  const [selectedCaseId, setSelectedCaseId] = useState(selectedTest?.id || results[0]?.case_id || tests[0]?.id || '')
  const resultByCase = useMemo(() => new Map<string, any>(results.map((item: any) => [String(item.case_id), item])), [results])
  const activeCaseId = selectedCaseId || selectedTest?.id || tests[0]?.id || ''
  const activeTest = tests.find((test: any) => String(test.id) === String(activeCaseId)) || selectedTest || tests[0]
  const activeCaseResult = resultByCase.get(String(activeCaseId))
  const activeCaseExecuted = hasExecutedApiResult(activeCaseResult)
  const activeResult = activeCaseExecuted ? activeCaseResult : {}
  const activeExecutionId = activeCaseResult?.execution_id || activeCaseResult?.executionId || activeResult?.execution_id || activeResult?.executionId || ''
  // A manual API batch can contain previous results and still have cases that
  // have never been sent. The selected case controls whether its request is
  // pending; never reuse another case's result as a fallback.
  const activeCasePending = !activeCaseExecuted
  // Keep the existing render branches readable while making their meaning
  // explicit: pending is always scoped to the selected case, never the batch.
  const pending = activeCasePending
  const apiResult = activeResult.result || {}
  const firstStep = apiResult.steps?.[0] || {}
  const response = firstStep.response || {}
  const assertions = (apiResult.steps || []).flatMap((step: any) => Array.isArray(step.assertions) ? step.assertions : [])
  const passedAssertions = assertions.filter((item: any) => item.status === 'PASSED').length
  const failedAssertions = assertions.filter((item: any) => item.status === 'FAILED').length
  const environment = currentProjectEnvironments.find((item: any) => String(item.id) === String(apiExecutionResults?.environment_id))
  const datasetName = apiExecutionResults?.dataset_name || (apiExecutionResults?.dataset_id ? t('ejecutarPruebas.apiSelected') : t('ejecutarPruebas.apiNoDatasetSelected'))
  const executionOrigin = String(apiExecutionResults?.origin || 'MANUAL').toUpperCase()
  const isAutomated = executionOrigin === 'AUTOMATIZADA'
  const runName = apiExecutionResults?.run_name || apiExecutionResults?.nombre || (batchPending ? t('ejecutarPruebas.apiPending') : isAutomated ? t('ejecutarPruebas.apiAutomatedRun') : t('ejecutarPruebas.apiManualRun'))
  const runId = apiExecutionResults?.run_id || apiExecutionResults?.id
  const technicalStatus = activeResult.status || apiResult.status || 'BLOCKED'
  const technicalManualStatus = manualStatusValue(technicalStatus)
  const [manualStatus, setManualStatus] = useState('')
  const [savedManualStatus, setSavedManualStatus] = useState('')
  const [manualStatuses, setManualStatuses] = useState<Record<string, string>>({})
  const [manualNotes, setManualNotes] = useState('')
  const [evaluationSaving, setEvaluationSaving] = useState(false)
  const [evaluationError, setEvaluationError] = useState('')
  const [requestExecuting, setRequestExecuting] = useState(false)
  const [requestError, setRequestError] = useState('')
  const [showBugPrompt, setShowBugPrompt] = useState(false)
  const [bugPromptBugs, setBugPromptBugs] = useState<any[]>([])
  const [showAllRelatedBugs, setShowAllRelatedBugs] = useState(false)
  const [activeApiTab, setActiveApiTab] = useState<'response' | 'request' | 'checks'>(activeCasePending ? 'request' : 'response')
  const status = savedManualStatus || (isAutomated ? technicalStatus : 'PENDIENTE')
  const actionResult = { ...activeResult, status, result: { ...apiResult, manual_evaluation: manualStatus ? { status: manualStatus, notes: manualNotes } : apiResult?.manual_evaluation } }
  const request = requestFor(activeTest, activeResult, t)
  const datasetPreview = apiExecutionResults?.dataset_previews?.[String(activeCaseId)] || executionDatasetPreview || apiExecutionResults?.dataset_preview || {}
  const resolvedVariables = datasetPreview?.variables_resueltas || {}
  const dynamicVariableValues = apiResult?.dynamic_variables?.values || {}
  const displayVariables = { ...resolvedVariables, ...dynamicVariableValues }
  const resolvedRequest = {
    ...request,
    url: resolveValue(request.url, displayVariables),
    body: resolveValue(request.body, displayVariables),
    headers: resolveValue(request.headers, displayVariables),
  }
  const usedVariableKeys = [...collectPlaceholderKeys(request)].sort()
  const variableRows = usedVariableKeys.map(key => ({
    key,
    value: isSensitiveKey(key) ? t('ejecutarPruebas.apiRedacted') : displayVariables[key] == null ? t('ejecutarPruebas.apiNoValue') : String(displayVariables[key]),
  }))
  const [showResolvedValues, setShowResolvedValues] = useState(false)
  const requestToDisplay = showResolvedValues ? resolvedRequest : request
  const [visibleRelatedBugs, setVisibleRelatedBugs] = useState<any[]>(relatedCaseBugs)

  useEffect(() => {
    const saved = apiResult?.manual_evaluation || activeResult?.manual_evaluation || {}
    setManualStatus(saved.status || '')
    setSavedManualStatus(saved.status || '')
    setManualNotes(saved.notes || '')
    if (saved.status && activeCaseId) setManualStatuses(current => ({ ...current, [String(activeCaseId)]: saved.status }))
    setEvaluationError('')
    setActiveApiTab(activeCasePending ? 'request' : 'response')
  }, [activeCaseId, activeCasePending, activeResult, apiResult])

  useEffect(() => {
    if (!selectedTest?.id) return
    if (tests.some((test: any) => String(test?.id) === String(selectedTest.id))) {
      setSelectedCaseId(String(selectedTest.id))
    }
  }, [selectedTest?.id, tests])

  const saveManualEvaluation = async () => {
    const statusToSave = manualStatus || technicalManualStatus
    if (!statusToSave || !onSaveApiEvaluation) return
    setEvaluationSaving(true)
    setEvaluationError('')
    try {
      await onSaveApiEvaluation(activeResult, statusToSave, manualNotes)
      setManualStatus(statusToSave)
      setSavedManualStatus(statusToSave)
      setManualStatuses(current => ({ ...current, [String(activeCaseId)]: statusToSave }))
      const verdictOutcome = await onApiVerdictSaved?.(activeResult, statusToSave, manualNotes, activeTest)
      if (['FALLO', 'BLOQUEADO'].includes(statusToSave)) {
        setBugPromptBugs(verdictOutcome?.relatedBugs || [])
        setShowBugPrompt(true)
      }
      if (statusToSave === 'PASO' && onAdvanceApiCase) {
        const nextCase = await onAdvanceApiCase(activeCaseId, tests)
        if (nextCase?.id) setSelectedCaseId(String(nextCase.id))
      }
    } catch (error: any) {
      setEvaluationError(error?.message || t('ejecutarPruebas.apiSaveVerdictError'))
    } finally {
      setEvaluationSaving(false)
    }
  }

  const executeApiRequest = async () => {
    if (!onExecuteRequest || requestExecuting) return
    setRequestExecuting(true)
    setRequestError('')
    try {
      const outcome = await onExecuteRequest()
      if (outcome?.ok === false) throw new Error(outcome.error || t('ejecutarPruebas.apiExecuteError'))
    } catch (error: any) {
      setRequestError(error?.message || t('ejecutarPruebas.apiExecuteError'))
    } finally {
      setRequestExecuting(false)
    }
  }

  useEffect(() => setVisibleRelatedBugs(relatedCaseBugs), [relatedCaseBugs])

  useEffect(() => {
    if (!activeCaseId || !onLoadRelatedBugs) return
    setShowAllRelatedBugs(false)
    let cancelled = false
    void onLoadRelatedBugs(activeCaseId).then((items: any[]) => {
      if (!cancelled && Array.isArray(items)) setVisibleRelatedBugs(items)
    })
    return () => { cancelled = true }
    // The parent callback is runtime-composed; the active case is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCaseId, activeCasePending])

  const activeStatus = displayStatus(status, activeCasePending, t)
  const executionLabel = isAutomated ? t('ejecutarPruebas.apiAutomatedExecution') : t('ejecutarPruebas.apiManualConsole')
  const selectedLabel = activeTest?.title || activeTest?.titulo || t('ejecutarPruebas.apiNoTitle')
  const testCode = activeTest?.code || activeTest?.codigo || t('ejecutarPruebas.apiCase')
  const componentLabel = activeTest?.component || activeTest?.componente || t('ejecutarPruebas.apiNoComponentAssigned')
  const reportedBugForCurrentExecution = visibleRelatedBugs.find((bug: any) => String(bug?.ejecucion_id || '') === String(activeExecutionId || ''))

  return (
    <div className="api-execution-console min-vh-100 d-flex flex-column animate__animated animate__fadeIn text-start bg-light">
      <Modal show={showBugPrompt} onHide={() => setShowBugPrompt(false)} centered backdrop="static">
        <Modal.Header className="border-0 bg-warning bg-opacity-10 text-dark">
          <Modal.Title className="fw-bold d-flex align-items-center gap-2"><Bug size={22} className="text-warning" /> {t('ejecutarPruebas.apiUpdatedStatus')}</Modal.Title>
        </Modal.Header>
        <Modal.Body className="px-4 pb-2 text-dark">
          <p className="small mb-3">{t('ejecutarPruebas.apiSavedResult')} <strong>{savedManualStatus === 'BLOQUEADO' ? t('ejecutarPruebas.apiBlocked') : t('ejecutarPruebas.apiFailed')}</strong>. {t('ejecutarPruebas.apiLeavePendingOrReport')}</p>
          {bugPromptBugs.length > 0 && <div className="small text-muted border rounded-3 bg-light p-2">{t('ejecutarPruebas.apiRelatedOpenBug', { count: bugPromptBugs.length, suffix: bugPromptBugs.length === 1 ? '' : 's', openSuffix: bugPromptBugs.length === 1 ? '' : 's', relatedSuffix: bugPromptBugs.length === 1 ? '' : 's' })}</div>}
        </Modal.Body>
        <Modal.Footer className="border-0 px-4 pb-4 d-flex justify-content-end gap-2">
          <Button variant="outline-primary" className="fw-bold" onClick={async () => { setShowBugPrompt(false); await onDeferApiCase?.(activeCaseId, tests) }}>{t('ejecutarPruebas.apiReportLater')}</Button>
          <Button variant="danger" className="fw-bold" onClick={async () => { setShowBugPrompt(false); await onPrepareApiBug?.(activeTest, actionResult) }} disabled={!canCreateBugs || !onPrepareApiBug}><Bug size={16} className="me-2" />{t('ejecutarPruebas.apiReportNow')}</Button>
        </Modal.Footer>
      </Modal>
      <div className="bg-white border-bottom d-flex justify-content-between align-items-center p-3 shadow-sm flex-shrink-0">
        <div className="d-flex align-items-center gap-3 min-w-0">
          <Button variant="light" size="sm" onClick={returnToExecutionList} className="border shadow-sm rounded-circle p-1" aria-label={t('ejecutarPruebas.apiBackToTests')}><ArrowLeft size={20} /></Button>
          <div className="min-w-0">
            <h5 className="m-0 fw-bold text-dark d-flex align-items-center gap-2"><Braces size={22} className="text-success" aria-hidden="true" /> {executionLabel}</h5>
            <div className="x-small text-muted font-monospace d-flex align-items-center gap-1 mt-1 flex-wrap"><Terminal size={12} aria-hidden="true" /> {t('ejecutarPruebas.apiBatch')}: <span className="text-dark">{runName}</span><span>· ID: {runId ? String(runId).slice(0, 8) : '—'}</span>{!activeCasePending && <Badge bg={activeStatus.variant}>{activeStatus.label.toUpperCase()}</Badge>}</div>
          </div>
        </div>
        <div className="small text-muted text-end flex-shrink-0"><div><strong>{t('ejecutarPruebas.apiEnvironment')}:</strong> {environment?.name || environment?.nombre || apiExecutionResults?.environment_name || t('ejecutarPruebas.apiSelected')}</div><div><strong>{t('common.dataset')}:</strong> {datasetName}</div></div>
      </div>

      <div className="flex-grow-1 overflow-auto p-3 p-lg-4">
        <Row className="g-3 align-items-start">
          <Col xl={3} lg={4}>
            <Card className="border-0 shadow-sm mb-3">
              <Card.Header className="bg-white border-bottom py-3"><h6 className="fw-bold m-0 d-flex align-items-center gap-2"><Info size={18} className="text-primary" aria-hidden="true" /> {t('ejecutarPruebas.apiExecutionBatch')}</h6><div className="small text-muted mt-1">{tests.length} {tests.length === 1 ? t('ejecutarPruebas.apiCaseSelected') : t('ejecutarPruebas.apiCasesSelected')}</div></Card.Header>
              <Card.Body className="p-2">
                {tests.map((test: any) => {
                  const item = resultByCase.get(String(test.id)) || {}
                  const itemManualStatus = manualStatuses[String(test.id)] || item.result?.manual_evaluation?.status || item.manual_evaluation?.status
                  const itemExecuted = hasExecutedApiResult(item)
                  const itemStatus = displayStatus(itemManualStatus || (!itemExecuted ? 'PENDIENTE' : isAutomated ? (item.status || item.result?.status) : 'PENDIENTE'), !itemExecuted, t)
                  return <Button key={test.id} variant="light" className={`w-100 text-start border-0 rounded-2 p-3 mb-2 ${String(test.id) === String(activeCaseId) ? 'bg-primary bg-opacity-10 border-start border-primary border-3' : ''}`} onClick={() => setSelectedCaseId(test.id)}>
                    <div className="d-flex justify-content-between gap-2"><span className="font-monospace fw-bold text-primary small">{test.code || test.codigo}</span><Badge bg={itemStatus.variant}>{itemStatus.label}</Badge></div>
                    <div className="small text-dark mt-1 text-truncate">{test.title || test.titulo}</div>
                  </Button>
                })}
              </Card.Body>
            </Card>

          </Col>

          <Col xl={3} lg={4}>
            <Card className="border-0 shadow-sm">
              <Card.Header className="bg-white py-3"><h6 className="fw-bold m-0">{t('ejecutarPruebas.apiCaseDetails')}</h6></Card.Header>
              <Card.Body className="p-3">
                <div className="mb-3"><div className="x-small fw-bold text-muted text-uppercase mb-1">{t('ejecutarPruebas.apiCase')}</div><div className="small fw-semibold text-dark">{testCode} · {selectedLabel}</div></div>
                <div className="mb-3"><div className="x-small fw-bold text-muted text-uppercase mb-1">{t('ejecutarPruebas.apiAffectedComponent')}</div><Badge bg="light" text="dark" className="border">{componentLabel}</Badge></div>
                <div className="mb-3"><div className="x-small fw-bold text-muted text-uppercase mb-1">{t('ejecutarPruebas.apiObjectiveDescription')}</div><div className="small text-dark">{activeTest?.description || activeTest?.descripcion || t('ejecutarPruebas.apiNoObjective')}</div></div>
                <div className="mb-3"><div className="x-small fw-bold text-muted text-uppercase mb-1">{t('ejecutarPruebas.apiPreconditions')}</div><div className="small text-dark">{activeTest?.pre || activeTest?.precondiciones || t('ejecutarPruebas.apiNoPreconditions')}</div></div>
                <div className="mb-3"><div className="x-small fw-bold text-muted text-uppercase mb-1">{t('ejecutarPruebas.apiPostconditions')}</div><div className="small text-dark">{activeTest?.post || activeTest?.postcondiciones || t('ejecutarPruebas.apiNoPostconditions')}</div></div>
              </Card.Body>
            </Card>
            <Card className="border-0 shadow-sm mt-3">
              <Card.Header className="bg-white"><strong className="d-flex align-items-center gap-2"><Bug size={17} className="text-danger" aria-hidden="true" /> {t('ejecutarPruebas.apiRelatedBugs')} <Badge bg="light" text="danger" className="border ms-auto">{relatedCaseBugsLoading ? '…' : visibleRelatedBugs.length}</Badge></strong></Card.Header>
              <Card.Body className="small">
                {relatedCaseBugsLoading && <div className="d-flex align-items-center gap-2 text-muted"><Spinner animation="border" size="sm" aria-label={t('ejecutarPruebas.apiLoading')} /> {t('ejecutarPruebas.apiLoadingBugs')}</div>}
                {!relatedCaseBugsLoading && visibleRelatedBugs.length === 0 && <div className="text-muted">{t('ejecutarPruebas.apiNoRelatedBugs')}</div>}
                {!relatedCaseBugsLoading && visibleRelatedBugs.length > 0 && <div className="d-flex flex-column gap-2">{(showAllRelatedBugs ? visibleRelatedBugs : visibleRelatedBugs.slice(0, 2)).map((bug: any) => <div key={bug.id || bug.codigo} className="border rounded-3 p-2 bg-light"><div className="fw-bold text-dark text-break">{bug.codigo || t('ejecutarPruebas.apiBugFallback')} · {bug.titulo || t('ejecutarPruebas.apiUntitled')}</div><div className="text-muted mt-1">{bug.estado || t('ejecutarPruebas.apiNoStatus')}</div><div className="d-flex gap-2 mt-2 flex-wrap"><Button size="sm" variant="outline-secondary" onClick={() => onViewRelatedBug?.(bug)} disabled={!canViewBugs}><Eye size={13} className="me-1" aria-hidden="true" />{t('ejecutarPruebas.apiView')}</Button>{isReportable(status, apiResult) && <Button size="sm" variant="outline-danger" onClick={() => onLinkApiExecutionToBug?.(bug, activeTest, actionResult)} disabled={!canCreateBugs || !onLinkApiExecutionToBug}><RefreshCw size={13} className="me-1" aria-hidden="true" />{t('ejecutarPruebas.apiUpdate')}</Button>}</div></div>)}{visibleRelatedBugs.length > 2 && <Button size="sm" variant="link" className="align-self-start px-0 text-decoration-none fw-semibold" onClick={() => setShowAllRelatedBugs(current => !current)} aria-expanded={showAllRelatedBugs}>{showAllRelatedBugs ? t('ejecutarPruebas.apiViewLess') : t('ejecutarPruebas.apiViewMoreBugs', { count: visibleRelatedBugs.length - 2 })}</Button>}</div>}
              </Card.Body>
            </Card>
          </Col>

          <Col xl={6} lg={8}>
            <Card className="border-0 shadow-sm">
              <Card.Header className="bg-white p-4"><div className="d-flex flex-wrap align-items-center gap-2">{pending ? <Info className="text-primary" size={24} aria-hidden="true" /> : isPassed(status) ? <CheckCircle2 className="text-success" size={24} aria-hidden="true" /> : status === 'PENDIENTE' ? <Info className="text-primary" size={24} aria-hidden="true" /> : <AlertCircle className="text-danger" size={24} aria-hidden="true" />}<h5 className="fw-bold mb-0">{pending ? t('ejecutarPruebas.apiRequestReady') : selectedLabel}</h5><Badge bg={activeStatus.variant}>{activeStatus.label}</Badge>{!pending && response.status != null && <Badge bg="light" text="dark" className="border">HTTP {response.status}</Badge>}{!pending && apiResult.duration_ms != null && <Badge bg="light" text="dark" className="border"><Clock3 size={13} className="me-1" aria-hidden="true" />{apiResult.duration_ms} ms</Badge>}</div><div className="small text-muted mt-2">{pending ? t('ejecutarPruebas.apiRequestReadyDescription') : status === 'PENDIENTE' ? t('ejecutarPruebas.apiExecutedPendingDescription') : isPassed(status) ? t('ejecutarPruebas.apiPassedDescription') : t('ejecutarPruebas.apiFailedDescription')}</div></Card.Header>
              <Card.Body className="p-4">
                {!pending && <Nav variant="tabs" activeKey={activeApiTab} onSelect={key => key && setActiveApiTab(key as typeof activeApiTab)} className="mb-4" aria-label={t('ejecutarPruebas.apiExecutionDetail')}><Nav.Item><Nav.Link eventKey="response">{t('ejecutarPruebas.apiResponse')}</Nav.Link></Nav.Item><Nav.Item><Nav.Link eventKey="request">{t('ejecutarPruebas.apiRequestAndVariables')}</Nav.Link></Nav.Item><Nav.Item><Nav.Link eventKey="checks">{t('ejecutarPruebas.apiValidations')}</Nav.Link></Nav.Item></Nav>}
                {(pending || activeApiTab === 'request') && <><section className="mb-4" aria-labelledby="api-console-request"><div className="d-flex align-items-center justify-content-between gap-2 mb-2"><h6 id="api-console-request" className="fw-bold d-flex align-items-center gap-2 mb-0"><Code2 size={18} aria-hidden="true" /> {t('ejecutarPruebas.apiRequest')} {pending ? t('ejecutarPruebas.apiToSend') : t('ejecutarPruebas.apiSent')}</h6><Form.Check type="checkbox" id="api-console-show-resolved" label={t('ejecutarPruebas.apiShowResolvedValues')} checked={showResolvedValues} onChange={event => setShowResolvedValues(event.target.checked)} /></div><div className="border rounded-3 bg-light p-3"><div className="d-flex align-items-center gap-2 mb-2"><Badge bg="dark">{requestToDisplay.method}</Badge><code className="text-break">{requestToDisplay.url}</code></div>{requestToDisplay.headers?.length > 0 && <div className="small mb-2"><strong>{t('ejecutarPruebas.apiHeaders')}:</strong> {requestToDisplay.headers.map((header: any) => `${header.key || header.name}: ${isSensitiveKey(header.key || header.name) ? t('ejecutarPruebas.apiRedacted') : header.value}`).join(' · ')}</div>}{requestToDisplay.body != null && <pre className="small mb-0 bg-white rounded border p-2">{valueText(requestToDisplay.body, t)}</pre>}<div className="small text-muted mt-2">{showResolvedValues ? t('ejecutarPruebas.apiResolvedValuesShown') : t('ejecutarPruebas.apiSavedTemplateShown')}</div></div></section><section className="mb-4" aria-labelledby="api-console-variables"><div className="d-flex align-items-center justify-content-between gap-2 mb-2"><h6 id="api-console-variables" className="fw-bold mb-0">{t('ejecutarPruebas.apiUsedVariables')}</h6><Badge bg="light" text="dark" className="border">{variableRows.length}</Badge></div>{datasetPreview?.error ? <Alert variant="danger" className="mb-0"><strong>{t('ejecutarPruebas.apiVariablesResolutionFailed')}</strong> {datasetPreview.error}<div className="small mt-1">{t('ejecutarPruebas.apiReviewDatasetEnvironment')}</div></Alert> : variableRows.length === 0 ? <div className="small text-muted border rounded-3 bg-light p-3">{t('ejecutarPruebas.apiNoVariables')}</div> : <div className="border rounded-3 bg-light p-2">{variableRows.map(row => <div key={row.key} className="d-flex justify-content-between gap-3 small py-1"><code>{`{{${row.key}}}`}</code><span className="text-primary font-monospace text-break text-end">{row.value}</span></div>)}</div>}{Object.keys(dynamicVariableValues).length > 0 && <div className="small text-muted mt-2">{t('ejecutarPruebas.apiDynamicVariables')} <code>{apiResult.dynamic_variables.seed}</code></div>}</section></>}
                {!pending && activeApiTab === 'response' && <section className="mb-4" aria-labelledby="api-console-response"><h6 id="api-console-response" className="fw-bold d-flex align-items-center gap-2">{t('ejecutarPruebas.apiResponseReceived')}</h6><div className="small text-muted mb-2">{t('ejecutarPruebas.apiResponseFromService')}</div><pre className="api-result-json">{responseText(response, t)}</pre></section>}
                {!pending && activeApiTab === 'checks' && <section className="mb-4" aria-labelledby="api-console-checks"><div className="d-flex align-items-center gap-2 mb-2"><h6 id="api-console-checks" className="fw-bold mb-0">{t('ejecutarPruebas.apiValidationsPerformed')}</h6><Badge bg="light" text="dark" className="border">{passedAssertions} {t('ejecutarPruebas.apiPassedCount')} · {failedAssertions} {t('ejecutarPruebas.apiFailedCount')}</Badge></div>{assertions.length === 0 ? <div className="small text-muted">{t('ejecutarPruebas.apiNoValidations')}</div> : <div className="d-grid gap-2">{assertions.map((assertion: any, index: number) => <div key={`${assertion.id || 'assertion'}-${index}`} className={`api-result-assertion ${assertion.status === 'PASSED' ? 'is-passed' : 'is-failed'}`}><strong>{assertion.name || assertion.source || t('ejecutarPruebas.apiConfiguredCheck')}</strong><div className="small text-muted">{assertion.status === 'PASSED' ? t('ejecutarPruebas.apiCheckPassed') : `${t('ejecutarPruebas.apiExpected')}: ${valueText(assertion.expected, t)} · ${t('ejecutarPruebas.apiActual')}: ${valueText(assertion.actual, t)}`}</div></div>)}</div>}</section>}
                {!pending && !savedManualStatus && <section className="mb-4" aria-labelledby="api-console-evaluation"><h6 id="api-console-evaluation" className="fw-bold mb-2">{t('ejecutarPruebas.apiManualEvaluation')}</h6><div className="border rounded-3 bg-light p-3"><div className="row g-3 align-items-end"><div className="col-md-4"><Form.Label htmlFor="api-manual-status" className="small fw-semibold">{t('ejecutarPruebas.apiCaseResult')}</Form.Label><Form.Select id="api-manual-status" value={manualStatus || technicalManualStatus} onChange={event => setManualStatus(event.target.value)}><option value="PASO">{t('ejecutarPruebas.apiPassed')}</option><option value="FALLO">{t('ejecutarPruebas.apiFailed')}</option><option value="BLOQUEADO">{t('ejecutarPruebas.apiBlocked')}</option></Form.Select></div><div className="col-md-8"><Form.Label htmlFor="api-manual-notes" className="small fw-semibold">{t('ejecutarPruebas.apiObservations')}</Form.Label><Form.Control id="api-manual-notes" as="textarea" rows={2} value={manualNotes} onChange={event => setManualNotes(event.target.value)} placeholder={t('ejecutarPruebas.apiResultNotesPlaceholder')} /></div></div>{evaluationError && <Alert variant="danger" className="small mt-3 mb-0">{evaluationError}</Alert>}<div className="d-flex justify-content-end mt-3"><Button variant="primary" onClick={saveManualEvaluation} disabled={!onSaveApiEvaluation || evaluationSaving}><CheckCircle2 size={16} className="me-1" aria-hidden="true" />{evaluationSaving ? t('common.saving') : t('ejecutarPruebas.apiSaveVerdict')}</Button></div></div></section>}
              {!pending && savedManualStatus && isReportable(savedManualStatus, apiResult) && <section className="border border-danger rounded-3 bg-white p-3 mb-4" aria-labelledby="api-console-report"><div className="fw-semibold text-danger" id="api-console-report"><Bug size={15} className="me-1" aria-hidden="true" />{t('ejecutarPruebas.apiReportBugTitle')}</div><p className="small text-muted mt-2 mb-3">{t('ejecutarPruebas.apiReportBugDescription', { status: savedManualStatus === 'BLOQUEADO' ? t('ejecutarPruebas.apiBlockedLower') : t('ejecutarPruebas.apiFailedLower') })}</p><div className="d-flex flex-wrap gap-2">{reportedBugForCurrentExecution ? <><Button variant="outline-danger" onClick={() => onViewRelatedBug?.(reportedBugForCurrentExecution)} disabled={!canViewBugs}><Bug size={15} className="me-1" aria-hidden="true" />{t('ejecutarPruebas.apiReportedBug')} {reportedBugForCurrentExecution.codigo} · {t('ejecutarPruebas.apiView')}</Button><Button variant="outline-warning" onClick={() => onPrepareApiBug?.(activeTest, actionResult)} disabled={!canCreateBugs || !onPrepareApiBug}><Bug size={15} className="me-1" aria-hidden="true" />{t('ejecutarPruebas.apiCreateDifferentBug')}</Button></> : <Button variant="danger" onClick={() => onPrepareApiBug?.(activeTest, actionResult)} disabled={!canCreateBugs || !onPrepareApiBug}><Bug size={15} className="me-1" aria-hidden="true" />{t('ejecutarPruebas.apiCreateNewBug')}</Button>}{onDeferApiCase && <Button variant="outline-secondary" onClick={() => onDeferApiCase(activeCaseId, tests)}>{t('ejecutarPruebas.apiReportLaterContinue')}</Button>}</div></section>}
                {requestError && <Alert variant="danger" className="mb-3"><strong>{t('ejecutarPruebas.apiRequestExecutionFailed')}</strong> {requestError}</Alert>}
                {pending ? <><div className="d-flex justify-content-end"><Button variant="success" size="lg" onClick={executeApiRequest} disabled={!onExecuteRequest || requestExecuting}>{requestExecuting ? <Spinner animation="border" size="sm" className="me-2" /> : <PlayCircle size={20} className="me-2" aria-hidden="true" />}{requestExecuting ? t('ejecutarPruebas.apiExecuting') : t('ejecutarPruebas.apiExecuteRequest')}</Button></div></> : <>
                  {activeResult.errors?.length > 0 && <Alert variant="danger"><strong>{t('ejecutarPruebas.apiWhatHappened')}:</strong> {activeResult.errors.map((error: any) => error.message || error.error || valueText(error, t)).join(' · ')}</Alert>}

                </>}
              </Card.Body>
              {!pending && <Card.Footer className="bg-white d-flex justify-content-end gap-2">{onRepeatExecution && <Button variant="outline-primary" onClick={onRepeatExecution}><RotateCcw size={15} className="me-1" aria-hidden="true" />{t('ejecutarPruebas.apiChangeEnvironmentDataset')}</Button>}{onExecuteRequest && !isAutomated && <Button variant="primary" onClick={executeApiRequest} disabled={requestExecuting}>{requestExecuting ? <Spinner animation="border" size="sm" className="me-1" /> : <PlayCircle size={15} className="me-1" aria-hidden="true" />}{requestExecuting ? t('ejecutarPruebas.apiExecuting') : t('ejecutarPruebas.apiExecuteAgain')}</Button>}</Card.Footer>}
            </Card>
          </Col>
        </Row>
      </div>
    </div>
  )
}
