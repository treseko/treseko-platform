import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Badge, Button, Card, Col, Form, Modal, Row, Tab, Tabs } from 'react-bootstrap'
import { Braces, CheckCircle2, ChevronDown, CircleAlert, Clock3, Play } from 'lucide-react'
import { ApiAdvancedSettings } from './ApiAdvancedSettings'
import { ApiAssertionBuilder } from './ApiAssertionBuilder'
import type { ApiAssertion } from './apiAssertions'
import { ApiKeyValueEditor } from './ApiKeyValueEditor'
import { COMMON_API_HEADERS, defaultApiTestConfig, type ApiTestConfig } from './apiTestConfig'
import { API_BASE } from '../../app/constants'
import { apiExecutionMessage, readApiTestError } from './apiTestErrorMessages'
import { bodyDraft, bodyRows, displayResultValue, fallbackTranslate, normalizedBodyMode, readableAssertionSource, statusVariant } from './apiPresentation'

type RequestTab = 'params' | 'auth' | 'headers' | 'body'

export function CaseApiCard({ context }: { context: any }) {
  const {
    newTestFormat, newTestApiConfig, setNewTestApiConfig, fetchWithAuth, selectedTest, apiCaseId,
    currentBuildId, currentProjectId, projectEnvironments = [], showFeedback,
    t = fallbackTranslate,
  } = context
  const [requestTab, setRequestTab] = useState<RequestTab>('params')
  const [assertionsText, setAssertionsText] = useState('[]')
  const [assertionsDirty, setAssertionsDirty] = useState(false)
  const [assertionsError, setAssertionsError] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [selectedEnvironment, setSelectedEnvironment] = useState('')
  const [selectedDataset, setSelectedDataset] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [showResultDetails, setShowResultDetails] = useState(false)
  const resultSectionRef = useRef<HTMLDivElement | null>(null)
  const hydratedApiCaseRef = useRef('')
  const fetchedApiCaseRef = useRef('')

  const listedApiConfig = selectedTest?.configuracion_api || selectedTest?.apiConfig
  const hasConfiguredRequest = (candidate: any) => {
    if (!candidate || typeof candidate !== 'object' || !candidate.request) return false
    const requestCandidate = candidate.request
    return Boolean(
      (requestCandidate.method && requestCandidate.method !== 'GET') ||
      (requestCandidate.url && requestCandidate.url !== '{{base_url}}') ||
      (Array.isArray(requestCandidate.query) && requestCandidate.query.length > 0) ||
      (Array.isArray(requestCandidate.headers) && requestCandidate.headers.length > 0) ||
      (Array.isArray(requestCandidate.cookies) && requestCandidate.cookies.length > 0) ||
      (requestCandidate.auth && requestCandidate.auth.type && requestCandidate.auth.type !== 'none') ||
      (requestCandidate.body && requestCandidate.body.mode && requestCandidate.body.mode !== 'none') ||
      (Array.isArray(candidate.assertions) && candidate.assertions.length > 1) ||
      (Array.isArray(candidate.extractors) && candidate.extractors.length > 0) ||
      (candidate.pre_request_script || candidate.post_response_script)
    )
  }

  const config: ApiTestConfig = newTestApiConfig && typeof newTestApiConfig === 'object'
    ? newTestApiConfig
    : defaultApiTestConfig()
  const request = config.request || {}
  const assertions: ApiAssertion[] = Array.isArray(config.assertions) ? config.assertions : []
  const activeEnvironments = useMemo(
    () => (projectEnvironments || []).filter((env: any) => env.active !== false && env.activo !== false),
    [projectEnvironments],
  )
  const selectedEnvironmentRecord = useMemo(
    () => activeEnvironments.find((env: any) => String(env.id) === String(selectedEnvironment)),
    [activeEnvironments, selectedEnvironment],
  )
  const activeDatasets = useMemo(
    () => Array.isArray(selectedEnvironmentRecord?.datasets) ? selectedEnvironmentRecord.datasets : [],
    [selectedEnvironmentRecord],
  )
  const currentCaseId = String(apiCaseId || selectedTest?.id || '')
  const autoEnvironmentCaseRef = useRef('')

  const preferredEnvironment = useMemo(() => {
    const metadata = config.metadata || {}
    const hint = String(metadata.environment_name || metadata.environment || metadata.source || '').toLowerCase()
    if (!hint) return null
    return activeEnvironments.find((env: any) => {
      const name = String(env.name || env.nombre || '').toLowerCase()
      const url = String(env.url || '').toLowerCase()
      return (hint && name.includes(hint)) || (hint.includes('httpbin') && url.includes('httpbin'))
    }) || null
  }, [activeEnvironments, config.metadata])

  useEffect(() => {
    setAssertionsText(JSON.stringify(config.assertions || [], null, 2))
    setAssertionsDirty(false)
    setAssertionsError('')
    setBodyText(bodyDraft(request.body))
    setResult(null)
  }, [newTestApiConfig])

  useEffect(() => {
    if (!result || !resultSectionRef.current) return
    const frame = window.requestAnimationFrame(() => {
      if (typeof resultSectionRef.current?.scrollIntoView === 'function') {
        resultSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
      resultSectionRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [result])

  useEffect(() => {
    const caseId = String(currentCaseId || '')
    if (!caseId || hydratedApiCaseRef.current === caseId || !hasConfiguredRequest(listedApiConfig)) return

    // Some list/detail responses can arrive in a different order. On a case
    // change, the selected case is the source of truth; this also prevents the
    // previous case's request from being shown while the new one is loading.
    setNewTestApiConfig({ ...listedApiConfig, schema_version: listedApiConfig.schema_version || 'treseko.api-test/v2' })
    hydratedApiCaseRef.current = caseId
  }, [currentCaseId, listedApiConfig, setNewTestApiConfig])

  useEffect(() => {
    const caseId = String(currentCaseId || '')
    if (!caseId || typeof fetchWithAuth !== 'function' || fetchedApiCaseRef.current === caseId || hasConfiguredRequest(listedApiConfig)) return
    fetchedApiCaseRef.current = caseId
    let cancelled = false
    Promise.resolve()
      .then(() => fetchWithAuth(`${API_BASE}/casos/${caseId}`))
      .then(async response => response?.ok ? response.json() : null)
      .then(payload => {
        const detailConfig = payload?.configuracion_api
        if (!cancelled && hasConfiguredRequest(detailConfig)) {
          setNewTestApiConfig({ ...detailConfig, schema_version: detailConfig.schema_version || 'treseko.api-test/v2' })
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [currentCaseId, fetchWithAuth, listedApiConfig, setNewTestApiConfig])

  useEffect(() => {
    if (!activeEnvironments.length) {
      setSelectedEnvironment('')
      return
    }
    const fallback = activeEnvironments.find((env: any) => String(env.name || env.nombre || '').toLowerCase() === 'qa') || activeEnvironments[0]
    const caseChanged = autoEnvironmentCaseRef.current !== currentCaseId
    const currentEnvironmentStillExists = activeEnvironments.some((env: any) => String(env.id) === String(selectedEnvironment))
    if (caseChanged) {
      // A case may carry an environment hint (for example an imported or seeded
      // Postman collection). Change the default only when the case changes; a
      // manual choice made while editing must remain respected afterwards.
      setSelectedEnvironment(preferredEnvironment?.id || fallback?.id || '')
      autoEnvironmentCaseRef.current = currentCaseId
      return
    }
    if (!currentEnvironmentStillExists) setSelectedEnvironment(preferredEnvironment?.id || fallback?.id || '')
  }, [activeEnvironments, currentCaseId, preferredEnvironment, selectedEnvironment])

  useEffect(() => {
    if (activeDatasets.some((dataset: any) => String(dataset.id) === String(selectedDataset))) return
    const fallback = activeDatasets.find((dataset: any) => dataset.isDefault || dataset.es_default) || activeDatasets[0]
    setSelectedDataset(fallback?.id || '')
  }, [activeDatasets, selectedDataset])

  if (newTestFormat !== 'API') return null

  const updateConfig = (nextConfig: Record<string, any>) => setNewTestApiConfig({ ...nextConfig, schema_version: 'treseko.api-test/v2' })
  const updateRequest = (key: string, value: any) => updateConfig({ ...config, request: { ...request, [key]: value } })
  const updateAssertions = (nextAssertions: ApiAssertion[]) => {
    updateConfig({ ...config, assertions: nextAssertions })
    setAssertionsText(JSON.stringify(nextAssertions, null, 2))
    setAssertionsDirty(false)
    setAssertionsError('')
  }
  const parseAssertions = () => {
    try {
      const parsed = JSON.parse(assertionsText || '[]')
      if (!Array.isArray(parsed)) throw new Error(t('casos.apiAssertionsMustBeList'))
      updateAssertions(parsed)
    } catch {
      setAssertionsError(t('casos.apiInvalidAssertionsJson'))
    }
  }
  const updateBodyText = (value: string) => {
    setBodyText(value)
    if (!value.trim()) {
      updateRequest('body', { mode: 'raw', media_type: 'text/plain', content: '' })
      return
    }
    try {
      updateRequest('body', { mode: 'raw', media_type: 'application/json', content: JSON.parse(value) })
    } catch {
      updateRequest('body', { mode: 'raw', media_type: 'text/plain', content: value })
    }
  }
  const changeBodyMode = (mode: string) => {
    if (mode === 'none') {
      setBodyText('')
      updateRequest('body', { mode: 'none' })
      return
    }
    if (mode === 'raw') {
      const nextText = bodyText || '{\n  \n}'
      setBodyText(nextText)
      updateRequest('body', { mode: 'raw', media_type: 'application/json', content: bodyText ? request.body?.content ?? bodyText : {} })
      return
    }
    updateRequest('body', { mode, fields: bodyRows(request.body) })
  }
  const updateAuth = (changes: Record<string, any>) => updateRequest('auth', { ...(request.auth || {}), ...changes })

  const execute = async () => {
    const caseId = apiCaseId || selectedTest?.id
    const savedExecution = Boolean(caseId && currentBuildId)
    if (!currentProjectId || !selectedEnvironment) {
      showFeedback?.(t('casos.apiMissingContextTitle'), t('casos.apiSelectEnvironmentBeforeTest'), 'warning')
      return
    }
    setRunning(true)
    try {
      const endpoint = savedExecution ? `${API_BASE}/api-tests/${caseId}/execute` : `${API_BASE}/api-tests/dry-run`
      const body = savedExecution
        ? { build_id: currentBuildId, entorno_id: selectedEnvironment, dataset_id: selectedDataset || null }
        : { proyecto_id: currentProjectId, entorno_id: selectedEnvironment, dataset_id: selectedDataset || null, configuracion_api: config }
      const response = await fetchWithAuth(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await readApiTestError(response, t))
      const data = await response.json().catch(() => ({}))
      setResult(data)
    } catch (error: any) {
      showFeedback?.(t('casos.apiExecutionFailedTitle'), error.message, 'danger')
    } finally {
      setRunning(false)
    }
  }

  const bodyMode = normalizedBodyMode(request.body)
  const authType = request.auth?.type || 'none'
  const executionResult = result?.result || {}
  const resultSteps = Array.isArray(executionResult.steps) ? executionResult.steps : []
  const firstStep = resultSteps[0] || {}
  const responseData = firstStep.response || {}
  const resultAssertions = resultSteps.flatMap((step: any) => Array.isArray(step.assertions) ? step.assertions : [])
  const passedAssertions = resultAssertions.filter((item: any) => item.status === 'PASSED').length
  const failedAssertions = resultAssertions.filter((item: any) => item.status === 'FAILED').length
  const friendlyExecutionMessage = result ? apiExecutionMessage(executionResult, t) : ''
  const canExecute = Boolean(currentProjectId && selectedEnvironment)
  const resultStatus = result?.status || executionResult.status || ''
  const resultPassed = resultStatus === 'PASO' || resultStatus === 'PASSED'
  const resultWarning = resultStatus === 'PASSED_WITH_WARNINGS' || executionResult.status === 'PASSED_WITH_WARNINGS'
  const resultBlocked = resultStatus === 'BLOQUEADO' || resultStatus === 'BLOCKED'
  const resultLabel = resultPassed ? t('casos.apiPassed') : resultWarning ? t('casos.apiPassedWithWarnings') : resultBlocked ? t('casos.apiBlocked') : t('casos.apiFailed')
  const responseBody = responseData.body_json ?? responseData.body ?? responseData.text
  const requestData = firstStep.request || {}

  return (
    <Card className="api-test-editor border-0 shadow-sm rounded-3 bg-white text-start mb-3">
      <Card.Header className="api-editor-header bg-white border-bottom p-0">
        <div className="api-context-bar" role="group" aria-label={t('casos.apiExecutionContext')}>
          <div className="api-context-field">
            <Form.Label htmlFor="api-context-environment">{t('casos.apiEnvironment')}</Form.Label>
            <Form.Select id="api-context-environment" size="sm" value={selectedEnvironment} onChange={event => setSelectedEnvironment(event.target.value)}>
              <option value="">{t('casos.apiSelectEnvironment')}</option>
              {activeEnvironments.map((env: any) => <option key={env.id} value={env.id}>{env.name || env.nombre}</option>)}
            </Form.Select>
          </div>
          <div className="api-context-field">
            <Form.Label htmlFor="api-context-dataset">{t('casos.apiDataset')}</Form.Label>
            <Form.Select id="api-context-dataset" size="sm" value={selectedDataset} onChange={event => setSelectedDataset(event.target.value)} disabled={!selectedEnvironment}>
              <option value="">{t('casos.apiNoDataset')}</option>
              {activeDatasets.map((dataset: any) => <option key={dataset.id} value={dataset.id}>{dataset.name || dataset.nombre}</option>)}
            </Form.Select>
          </div>
          <span className="api-context-build">{t('casos.apiActiveBuildNotice')}</span>
        </div>
        <div className="api-editor-title-row">
          <Braces size={18} className="text-success" aria-hidden="true" />
          <div>
            <strong>{t('casos.apiRequestAndValidations')}</strong>
            <div className="small text-muted">{t('casos.apiPostmanGuidedFlow')}</div>
          </div>
          <Badge bg="success" className="ms-auto">{t('casos.apiProtocol')}</Badge>
        </div>
      </Card.Header>
      <Card.Body>
        <section aria-labelledby="api-request-title">
          <div className="mb-2">
            <div id="api-request-title" className="fw-semibold">{t('casos.apiRequest')}</div>
            <div className="small text-muted">{t('casos.apiRequestInstructions')}</div>
          </div>
          <div className="api-request-bar mb-3">
            <Form.Select aria-label={t('casos.apiHttpMethod')} value={request.method || 'GET'} onChange={event => updateRequest('method', event.target.value)}>
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map(method => <option key={method} value={method}>{method}</option>)}
            </Form.Select>
            <Form.Control aria-label={t('casos.apiRequestUrl')} value={request.url || ''} onChange={event => updateRequest('url', event.target.value)} placeholder={t('casos.apiRequestUrlPlaceholder')} className="font-monospace" />
            <Button variant="primary" disabled={running || !canExecute} onClick={execute}>
              <Play size={15} className="me-1" /> {running ? t('casos.apiTesting') : t('casos.apiTestRequest')}
            </Button>
          </div>
          {!canExecute && <div className="small text-muted mb-3">{t('casos.apiDryRunNotice')}</div>}

          {result && <Alert
            ref={resultSectionRef}
            tabIndex={-1}
            role="status"
            aria-live="polite"
            variant={statusVariant(result.status || executionResult.status)}
            className="api-execution-result api-execution-result-summary mb-3"
          >
            <div className="d-flex flex-wrap align-items-center gap-2">
              {resultPassed ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
              <strong>{t('casos.apiTestResult')}</strong>
              <Badge bg="light" text="dark" className="border">{resultLabel}</Badge>
              {result.dry_run && <Badge bg="info" text="dark">{t('casos.apiDryRunNotSaved')}</Badge>}
              {responseData.status != null && <Badge bg="light" text="dark" className="border">{t('casos.apiHttpStatus', { status: responseData.status })}</Badge>}
              {executionResult.duration_ms != null && <span className="small"><Clock3 size={14} className="me-1" />{executionResult.duration_ms} ms</span>}
            </div>
            <div className="mt-2 fw-semibold">{friendlyExecutionMessage || (failedAssertions > 0 ? t('casos.apiResponseFailedChecks') : t('casos.apiResponsePassedChecks'))}</div>
            <Button variant="link" className="px-0 mt-2 fw-bold text-decoration-none" onClick={() => setShowResultDetails(true)}>
              {t('casos.apiViewTestResult')}
            </Button>
          </Alert>}

          <Tabs activeKey={requestTab} onSelect={key => setRequestTab((key || 'params') as RequestTab)} className="api-request-tabs mb-3">
            <Tab eventKey="params" title={<>{t('casos.apiParameters')} <Badge bg="light" text="dark">{Array.isArray(request.query) ? request.query.length : 0}</Badge></>}>
              <div className="api-tab-panel">
                <div className="small text-muted mb-2">{t('casos.apiParametersHelp')} <code>?page=1</code>.</div>
                <ApiKeyValueEditor t={t} items={Array.isArray(request.query) ? request.query : []} onChange={items => updateRequest('query', items)} fieldName="query" fieldLabel={t('casos.apiParameterField')} emptyText={t('casos.apiNoUrlParameters')} addLabel={t('casos.apiAddParameter')} keyPlaceholder={t('casos.apiName')} valuePlaceholder={t('casos.apiValue')} />
              </div>
            </Tab>
            <Tab eventKey="auth" title={t('casos.apiAuthorization')}>
              <div className="api-tab-panel">
                <Row className="g-3">
                  <Col md={4}>
                    <Form.Label className="small fw-semibold">{t('casos.apiType')}</Form.Label>
                    <Form.Select aria-label={t('casos.apiType')} value={authType} onChange={event => updateRequest('auth', { type: event.target.value })}>
                      <option value="none">{t('casos.apiNoAuthentication')}</option>
                      <option value="bearer">{t('casos.apiBearerToken')}</option>
                      <option value="basic">{t('casos.apiBasicAuth')}</option>
                      <option value="api_key">{t('casos.apiApiKey')}</option>
                      <option value="oauth2">{t('casos.apiOAuth2')}</option>
                    </Form.Select>
                  </Col>
                  {['bearer', 'oauth2'].includes(authType) && <Col md={8}>
                    <Form.Label className="small fw-semibold">{t('casos.apiTokenVariable')}</Form.Label>
                    <Form.Control className="font-monospace" value={request.auth?.variable || ''} onChange={event => updateAuth({ variable: event.target.value })} placeholder={authType === 'oauth2' ? t('casos.apiAccessTokenPlaceholder') : t('casos.apiTokenPlaceholder')} />
                    <Form.Text>{t('casos.apiSecretResolutionNotice')}</Form.Text>
                  </Col>}
                  {authType === 'basic' && <>
                    <Col md={4}><Form.Label className="small fw-semibold">{t('casos.apiUsernameVariable')}</Form.Label><Form.Control className="font-monospace" value={request.auth?.username_variable || ''} onChange={event => updateAuth({ username_variable: event.target.value })} placeholder={t('casos.apiUsernamePlaceholder')} /></Col>
                    <Col md={4}><Form.Label className="small fw-semibold">{t('casos.apiPasswordVariable')}</Form.Label><Form.Control className="font-monospace" value={request.auth?.password_variable || ''} onChange={event => updateAuth({ password_variable: event.target.value })} placeholder={t('casos.apiPasswordPlaceholder')} /></Col>
                  </>}
                  {authType === 'api_key' && <>
                    <Col md={3}><Form.Label className="small fw-semibold">{t('casos.apiSendIn')}</Form.Label><Form.Select value={request.auth?.query ? 'query' : 'header'} onChange={event => updateAuth(event.target.value === 'query' ? { query: request.auth?.query || 'api_key', header: undefined } : { header: request.auth?.header || 'X-API-Key', query: undefined })}><option value="header">{t('casos.apiHeader')}</option><option value="query">{t('casos.apiQueryParam')}</option></Form.Select></Col>
                    <Col md={3}><Form.Label className="small fw-semibold">{t('casos.apiName')}</Form.Label><Form.Control className="font-monospace" value={request.auth?.query || request.auth?.header || ''} onChange={event => updateAuth(request.auth?.query ? { query: event.target.value } : { header: event.target.value })} placeholder={t('casos.apiKeyHeaderPlaceholder')} /></Col>
                    <Col md={6}><Form.Label className="small fw-semibold">{t('casos.apiKeyVariable')}</Form.Label><Form.Control className="font-monospace" value={request.auth?.variable || ''} onChange={event => updateAuth({ variable: event.target.value })} placeholder={t('casos.apiKeyPlaceholder')} /></Col>
                  </>}
                  {authType === 'none' && <Col md={8} className="d-flex align-items-end"><div className="small text-muted pb-2">{t('casos.apiNoCredentialsNotice')}</div></Col>}
                </Row>
              </div>
            </Tab>
            <Tab eventKey="headers" title={<>{t('casos.apiHeaders')} <Badge bg="light" text="dark">{Array.isArray(request.headers) ? request.headers.length : 0}</Badge></>}>
              <div className="api-tab-panel">
                <div className="small text-muted mb-2">{t('casos.apiHeadersHelp')} <code>{'{{access_token}}'}</code>.</div>
                <ApiKeyValueEditor t={t} items={Array.isArray(request.headers) ? request.headers : []} onChange={items => updateRequest('headers', items)} fieldName="headers" fieldLabel={t('casos.apiHeader')} emptyText={t('casos.apiNoCustomHeaders')} addLabel={t('casos.apiAddCustomHeader')} keyPlaceholder={t('casos.apiHeader')} valuePlaceholder={t('casos.apiValue')} keySuggestions={COMMON_API_HEADERS} keyListId="api-common-header-options" />
              </div>
            </Tab>
            <Tab eventKey="body" title={t('casos.apiContent')}>
              <div className="api-tab-panel">
                <Row className="g-3">
                  <Col md={4}>
                    <Form.Label className="small fw-semibold">{t('casos.apiContentType')}</Form.Label>
                    <Form.Select aria-label={t('casos.apiBodyAria')} value={bodyMode} onChange={event => changeBodyMode(event.target.value)}>
                      <option value="none">{t('casos.apiNoBody')}</option>
                      <option value="raw">{t('casos.apiJsonOrText')}</option>
                      <option value="formdata">{t('casos.apiFormData')}</option>
                      <option value="urlencoded">{t('casos.apiUrlEncoded')}</option>
                    </Form.Select>
                  </Col>
                  <Col md={8} className="d-flex align-items-end"><div className="small text-muted pb-2">{bodyMode === 'none' ? t('casos.apiGetBodyNotice') : t('casos.apiBodyVariablesNotice')}</div></Col>
                  {bodyMode === 'raw' && <Col md={12}><Form.Control as="textarea" rows={7} value={bodyText} onChange={event => updateBodyText(event.target.value)} placeholder={t('casos.apiJsonBodyPlaceholder')} className="font-monospace" aria-label={t('casos.apiJsonBodyAria')} /></Col>}
                  {['formdata', 'urlencoded'].includes(bodyMode) && <Col md={12}><ApiKeyValueEditor t={t} items={bodyRows(request.body)} onChange={items => updateRequest('body', { mode: bodyMode, fields: items })} fieldName="body" fieldLabel={t('casos.apiBodyField')} emptyText={t('casos.apiNoBodyFields')} addLabel={t('casos.apiAddField')} keyPlaceholder={t('casos.apiField')} valuePlaceholder={t('casos.apiValue')} /></Col>}
                </Row>
              </div>
            </Tab>
          </Tabs>
        </section>

        <section className="api-response-section" aria-labelledby="api-response-title">
          <div className="d-flex align-items-start gap-2 mb-3">
            <div>
              <div id="api-response-title" className="fw-semibold">{t('casos.apiExpectedResponse')}</div>
              <div className="small text-muted">{t('casos.apiExpectedResponseHelp')}</div>
            </div>
            <Badge bg="light" text="dark" className="border ms-auto">{t('casos.apiValidationCount', { count: assertions.length })}</Badge>
          </div>
          <ApiAssertionBuilder assertions={assertions} onChange={updateAssertions} advancedText={assertionsText} onAdvancedTextChange={value => { setAssertionsText(value); setAssertionsError('') }} onAdvancedBlur={parseAssertions} advancedDirty={assertionsDirty} onAdvancedDirtyChange={setAssertionsDirty} advancedError={assertionsError} t={t} />
        </section>

        <details className="api-advanced-disclosure mt-3">
          <summary><ChevronDown size={16} /> <span>{t('casos.apiAdvancedConfiguration')}</span><small>{t('casos.apiAdvancedConfigurationHelp')}</small></summary>
          <div className="pt-3"><ApiAdvancedSettings config={config} request={request} onConfigChange={updateConfig} onRequestChange={updateRequest} t={t} /></div>
        </details>

        <Modal show={showResultDetails} onHide={() => setShowResultDetails(false)} centered size="xl" scrollable>
          <Modal.Header closeButton>
            <Modal.Title className="fw-bold">{t('casos.apiTestResultTitle')}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <section className="api-result-overview mb-4" aria-labelledby="api-result-overview-title">
              <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
                {resultPassed ? <CheckCircle2 className="text-success" size={22} aria-hidden="true" /> : <CircleAlert className="text-danger" size={22} aria-hidden="true" />}
                <h2 id="api-result-overview-title" className="h5 mb-0">{resultLabel}</h2>
                {result?.dry_run && <Badge bg="info" text="dark">{t('casos.apiDryRunNotSaved')}</Badge>}
                {responseData.status != null && <Badge bg="light" text="dark" className="border">{t('casos.apiHttpStatus', { status: responseData.status })}</Badge>}
                {executionResult.duration_ms != null && <Badge bg="light" text="dark" className="border">{executionResult.duration_ms} ms</Badge>}
              </div>
              <p className="mb-0">{friendlyExecutionMessage || (failedAssertions > 0 ? t('casos.apiResponseFailedChecks') : t('casos.apiResponsePassedChecks'))}</p>
            </section>

            <section className="mb-4" aria-labelledby="api-result-response-title">
              <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
                <h2 id="api-result-response-title" className="h5 mb-0">{t('casos.apiReceivedResponse')}</h2>
                <span className="small text-muted">{responseData.headers?.['content-type'] || responseData.headers?.['Content-Type'] || t('casos.apiResponseContent')}</span>
              </div>
              <pre className="api-result-json mb-0">{displayResultValue(responseBody, t)}</pre>
              {responseData.headers && <details className="mt-2">
                <summary className="small fw-semibold">{t('casos.apiViewResponseHeaders')}</summary>
                <pre className="api-result-json mt-2 mb-0">{displayResultValue(responseData.headers, t)}</pre>
              </details>}
            </section>

            <section className="mb-4" aria-labelledby="api-result-assertions-title">
              <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
                <h2 id="api-result-assertions-title" className="h5 mb-0">{t('casos.apiCompletedValidations')}</h2>
                <Badge bg="light" text="dark" className="border">{t('casos.apiAssertionsSummary', { passed: passedAssertions, failed: failedAssertions })}</Badge>
              </div>
              {resultAssertions.length === 0 ? <p className="small text-muted mb-0">{t('casos.apiNoValidations')}</p> : <div className="d-grid gap-2">
                {resultAssertions.map((assertion: any, index: number) => {
                  const assertionPassed = assertion.status === 'PASSED'
                  return <div key={`${assertion.id || assertion.name || 'assertion'}-${index}`} className={`api-result-assertion ${assertionPassed ? 'is-passed' : 'is-failed'}`}>
                    <div className="d-flex align-items-start gap-2">
                      {assertionPassed ? <CheckCircle2 className="text-success flex-shrink-0" size={18} aria-label={t('casos.apiPassed')} /> : <CircleAlert className="text-danger flex-shrink-0" size={18} aria-label={t('casos.apiFailed')} />}
                      <div className="min-w-0">
                        <strong>{assertion.name || readableAssertionSource(assertion.source, t)}</strong>
                        <div className="small text-muted">{readableAssertionSource(assertion.source, t)} · {assertionPassed ? t('casos.apiFulfilled') : t('casos.apiNotFulfilled')}</div>
                        {!assertionPassed && <div className="small mt-1"><strong>{t('casos.apiExpected')}:</strong> {displayResultValue(assertion.expected, t)} · <strong>{t('casos.apiActual')}:</strong> {displayResultValue(assertion.actual, t)}</div>}
                      </div>
                    </div>
                  </div>
                })}
              </div>}
            </section>

            <details className="api-result-technical">
              <summary className="fw-semibold">{t('casos.apiTechnicalDetails')}</summary>
              <div className="pt-3">
                <div className="small text-muted mb-1">{t('casos.apiSentRequest')}</div>
                <pre className="api-result-json mb-3">{displayResultValue({ method: requestData.method, url: requestData.url, query: requestData.query, headers: requestData.headers }, t)}</pre>
                <div className="small text-muted mb-1">{t('casos.apiCompleteEvidence')}</div>
                <pre className="api-result-json mb-0">{JSON.stringify(result, null, 2)}</pre>
              </div>
            </details>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="primary" onClick={() => setShowResultDetails(false)}>{t('casos.apiClose')}</Button>
          </Modal.Footer>
        </Modal>
      </Card.Body>
    </Card>
  )
}
