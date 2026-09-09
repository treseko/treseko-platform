import { useEffect, useMemo, useState } from 'react'
import { Accordion, Alert, Badge, Button, Card, Col, Form, Row } from 'react-bootstrap'
import { Activity, Bot, CheckCircle2, ChevronDown, CircleAlert, Code2, LoaderCircle, MessageCircle, Plus, Settings2, ShieldCheck, Trash2, UserRound, Wrench } from 'lucide-react'
import { API_BASE } from '../../app/constants'
import { applyConnectionPreset, chatbotConnectionPresets, cloneRawChatbotConfig, connectionPresetForConfig, mergeChatbotConfig, migrateOpeningMessageToTurn, normalizeChatbotAdapter, normalizeChatbotConfig, normalizeReusableProfiles, resolveChatbotProfile, type ChatbotConnectionPresetId } from './chatbotConfig'
import { DynamicVariablePicker } from './DynamicVariablePicker'
import { VariableReferenceHints } from './VariableReferenceHints'

type Props = { context: any }

const jsonText = (value: any) => JSON.stringify(value || {}, null, 2)
const csvText = (value: any) => Array.isArray(value) ? value.join(', ') : ''
export const CHATBOT_CONNECTION_PREVIEW_PATH = '/chatbot/test-connection'

export function buildChatbotConnectionPreviewRequest(config: any, context: { environmentId?: string, datasetId?: string, componentId?: string, projectId?: string, sampleMessage: string, variables?: Record<string, any> }) {
  return {
    entorno_id: context.environmentId || null,
    configuration: config,
    message: context.sampleMessage,
    variables: context.variables || {},
  }
}

export function CaseConversationalCard({ context }: Props) {
  const { newTestFormat, newTestChatbotConfig = {}, setNewTestChatbotConfig, selectedDryRunEnvironment, selectedDryRunDataset, projectEnvironments, setDryRunEnvironmentId, setDryRunDatasetId, dryRunDatasets, componentsList, newTestComponent, currentProjectId, fetchWithAuth, t = ((key: string) => key) } = context
  const [advanced, setAdvanced] = useState(false)
  const [configurationOpen, setConfigurationOpen] = useState(true)
  const [technicalOpen, setTechnicalOpen] = useState(false)
  const [hydratedCaseConfig, setHydratedCaseConfig] = useState<Record<string, any> | null>(null)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [advancedText, setAdvancedText] = useState('{}')
  const [headersText, setHeadersText] = useState('{}')
  const [requestText, setRequestText] = useState('{}')
  const [jsonError, setJsonError] = useState('')
  const [expectedDrafts, setExpectedDrafts] = useState<Record<string, string>>({})
  const [connectionPreview, setConnectionPreview] = useState<{ status: 'idle' | 'loading' | 'success' | 'error', result?: any, message?: string }>({ status: 'idle' })
  const [previewSampleDraft, setPreviewSampleDraft] = useState('')
  const inheritedConfig = useMemo(() => mergeChatbotConfig(selectedDryRunEnvironment?.chatbotConfig || {}, {}), [selectedDryRunEnvironment])
  const sourceCaseConfig = Object.keys(newTestChatbotConfig || {}).length
    ? newTestChatbotConfig
    : hydratedCaseConfig || context.selectedTest?.configuracion_chatbot || {}
  const caseConfig = migrateOpeningMessageToTurn(sourceCaseConfig)
  const config = useMemo(() => normalizeChatbotConfig(mergeChatbotConfig(selectedDryRunEnvironment?.chatbotConfig || {}, caseConfig)), [caseConfig, selectedDryRunEnvironment])
  const selectedComponent = componentsList?.find((component: any) => String(component.id) === String(newTestComponent))
  const profileResolution = useMemo(() => resolveChatbotProfile(config, selectedDryRunEnvironment, selectedDryRunDataset, selectedComponent), [config, selectedDryRunEnvironment, selectedDryRunDataset, selectedComponent])
  const profile = profileResolution.profile
  const turns = config.conversation.turns || []
  const memoryChecks = Array.isArray(config.conversation.memory_checks) ? config.conversation.memory_checks : []
  const tools = config.tools || []
  const reusableProfiles = normalizeReusableProfiles(config.profiles)

  useEffect(() => {
    const caseId = context.selectedTest?.id
    if (newTestFormat !== 'CONVERSACIONAL' || !caseId || typeof context.fetchWithAuth !== 'function') return
    setHydratedCaseConfig(null)
    const currentTurns = Array.isArray(newTestChatbotConfig?.conversation?.turns) ? newTestChatbotConfig.conversation.turns : []
    if (currentTurns.length > 0) return
    let cancelled = false
    void context.fetchWithAuth(`${API_BASE}/casos/${caseId}`).then(async (response: Response) => {
      if (!response.ok) return
      const source = await response.json().catch(() => null)
      const savedConfig = source?.configuracion_chatbot
      if (!cancelled && savedConfig && typeof savedConfig === 'object') {
        const migratedConfig = migrateOpeningMessageToTurn(savedConfig)
        setHydratedCaseConfig(cloneRawChatbotConfig(migratedConfig))
        setNewTestChatbotConfig(cloneRawChatbotConfig(migratedConfig))
      }
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [context.fetchWithAuth, context.selectedTest?.id, newTestFormat, setNewTestChatbotConfig])

  useEffect(() => {
    setAdvancedText(JSON.stringify(config, null, 2))
    setHeadersText(jsonText(config.connection.headers))
    setRequestText(jsonText(config.connection.request_template))
  }, [newTestChatbotConfig])

  useEffect(() => {
    setExpectedDrafts({})
    setPreviewSampleDraft('')
  }, [context.selectedTest?.id, newTestFormat])

  if (newTestFormat !== 'CONVERSACIONAL') return null

  // When the editor is hydrated from the selected case, the draft state can be
  // empty for one render. Start the first edit from what is actually visible;
  // otherwise the first keystroke replaces the loaded conversation with only
  // the field being edited.
  const rawConfig = caseConfig && typeof caseConfig === 'object' ? caseConfig : {}
  const updateConfig = (next: Record<string, any> | ((current: Record<string, any>) => Record<string, any>)) => {
    setNewTestChatbotConfig(previous => {
      const current = Object.keys(previous || {}).length ? previous : rawConfig
      const resolved = typeof next === 'function' ? next(current) : next
      return cloneRawChatbotConfig(resolved)
    })
  }
  const update = (key: string, value: any) => updateConfig({ ...rawConfig, [key]: value })
  const updateNested = (section: string, key: string, value: any) => updateConfig({ ...rawConfig, [section]: { ...(rawConfig[section] || {}), [key]: value } })
  const updateConnection = (key: string, value: any) => updateConfig({ ...rawConfig, connection: { ...(rawConfig.connection || {}), [key]: value } })
  const updateEvaluation = (section: string, key: string, value: any) => updateConfig({ ...rawConfig, evaluation: { ...(rawConfig.evaluation || {}), [section]: { ...(rawConfig.evaluation?.[section] || {}), [key]: value } } })
  const updateTurn = (index: number, key: string, value: any) => updateConfig(current => {
    const currentConfig = normalizeChatbotConfig(mergeChatbotConfig(selectedDryRunEnvironment?.chatbotConfig || {}, current))
    const currentTurns = currentConfig.conversation.turns || []
    return { ...current, conversation: { ...(current.conversation || {}), turns: currentTurns.map((turn: any, turnIndex: number) => turnIndex === index ? { ...turn, [key]: value } : turn) } }
  })
  const updateTurnInput = (index: number, key: string, value: any) => updateConfig(current => {
    const currentConfig = normalizeChatbotConfig(mergeChatbotConfig(selectedDryRunEnvironment?.chatbotConfig || {}, current))
    const currentTurns = currentConfig.conversation.turns || []
    return { ...current, conversation: { ...(current.conversation || {}), turns: currentTurns.map((turn: any, turnIndex: number) => turnIndex === index ? { ...turn, input: { ...(turn.input || {}), [key]: value } } : turn) } }
  })
  const expectedDraftKey = (index: number, turn: any) => `${turn.order || index + 1}:${index}`
  const expectedValue = (index: number, turn: any) => {
    const key = expectedDraftKey(index, turn)
    if (Object.prototype.hasOwnProperty.call(expectedDrafts, key)) return expectedDrafts[key]
    return turn.expected?.semantic || turn.expected_response || ''
  }
  const updateExpected = (index: number, turn: any, value: string) => {
    const key = expectedDraftKey(index, turn)
    setExpectedDrafts(previous => ({ ...previous, [key]: value }))
    updateTurn(index, 'expected', { ...(turn.expected || {}), semantic: value })
  }
  const addTurn = () => updateNested('conversation', 'turns', [...turns, { order: turns.length + 1, role: 'user', input: { mode: 'fixed', text: '' }, expected: { semantic: '' }, assertions: [] }])
  const removeTurn = (index: number) => updateNested('conversation', 'turns', turns.filter((_: any, turnIndex: number) => turnIndex !== index).map((turn: any, turnIndex: number) => ({ ...turn, order: turnIndex + 1 })))
  const updateMemoryCheck = (index: number, key: string, value: any) => updateNested('conversation', 'memory_checks', memoryChecks.map((check: any, checkIndex: number) => checkIndex === index ? { ...check, [key]: value } : check))
  const addMemoryCheck = () => updateNested('conversation', 'memory_checks', [...memoryChecks, { after_turn: Math.max(1, turns.length), must_remember: [''] }])
  const removeMemoryCheck = (index: number) => updateNested('conversation', 'memory_checks', memoryChecks.filter((_: any, checkIndex: number) => checkIndex !== index))
  const updateTool = (index: number, key: string, value: any) => update('tools', tools.map((tool: any, toolIndex: number) => toolIndex === index ? { ...tool, [key]: value } : tool))
  const updateToolObservation = (index: number, key: string, value: any) => updateTool(index, 'observation', { ...(tools[index]?.observation || {}), [key]: value })
  const addTool = () => update('tools', [...tools, { name: '', expected_arguments: {}, expected_result: {}, expected_response: '', max_calls: 1, required: false, observation: { mode: 'black_box', required: false } }])
  const removeTool = (index: number) => update('tools', tools.filter((_: any, toolIndex: number) => toolIndex !== index))
  const parseAndUpdate = (text: string, onValue: (value: any) => void, label: string) => {
    try { onValue(JSON.parse(text)); setJsonError('') } catch { setJsonError(`${label}: ${t('casos.invalidJson')}`) }
  }
  const applyAdvanced = () => parseAndUpdate(advancedText, value => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object'); setNewTestChatbotConfig(cloneRawChatbotConfig(value)) }, t('casos.completeConfiguration'))
  const inheritedEndpoint = inheritedConfig.connection?.endpoint || ''
  const selectedProfileId = config.profile_id || config.default_profile || ''
  const selectedProfile = reusableProfiles.find(item => item.id === selectedProfileId)
  const endpointIsInherited = !rawConfig.connection?.endpoint && !rawConfig.endpoint && !rawConfig.url && Boolean(inheritedEndpoint)
  const endpointConfigured = Boolean(String(config.connection.endpoint || config.connection.base_url || '').trim())
  const endpointMissing = !endpointConfigured
  const hasConversation = Boolean(turns.length || String(config.conversation.opening_message?.text || '').trim())
  const missingRequirements = [
    !endpointConfigured ? t('casos.chatbotMissingEndpoint') : '',
    !hasConversation ? t('casos.chatbotMissingTurn') : '',
    ...turns.map((turn: any, index: number) => turn.input?.mode !== 'profile_generated' && !String(turn.input?.text || '').trim() ? t('casos.chatbotMissingTurnMessage', { number: index + 1 }) : ''),
    normalizeChatbotAdapter(config.connection.adapter) === 'openai_compatible' && !String(config.connection.model || config.model || config.profile?.model || '').trim() ? t('casos.chatbotMissingModel') : '',
  ].filter(Boolean)
  const ready = missingRequirements.length === 0
  const variableNames = Array.from(new Set([
    ...Object.keys(selectedDryRunEnvironment?.variables || {}).map(key => `ENV.${key}`),
    ...Object.keys(selectedComponent?.variables || {}).map(key => `COMPONENT.${key}`),
    ...Object.keys(selectedDryRunDataset?.variables || {}).map(key => `DATASET.${key}`),
  ]))
  const variableContext = {
    environments: projectEnvironments || [],
    selectedEnvironment: selectedDryRunEnvironment,
    selectedDataset: selectedDryRunDataset,
    component: selectedComponent,
    caseData: context.newTestData,
    t,
  }
  const selectedPreset = connectionPresetForConfig(config.connection)
  const sampleMessage = previewSampleDraft.trim() || String(turns[0]?.input?.text || '').trim() || t('casos.connectionPreviewSample')
  const applyPreset = (presetId: ChatbotConnectionPresetId) => {
    updateConfig(current => applyConnectionPreset(current, presetId))
    setConnectionPreview({ status: 'idle' })
  }
  const previewConnection = async () => {
    if (typeof fetchWithAuth !== 'function') {
      setConnectionPreview({ status: 'error', message: t('casos.connectionPreviewUnavailable') })
      return
    }
    if (!config.connection.endpoint) {
      setConnectionPreview({ status: 'error', message: t('casos.connectionPreviewMissingEndpoint') })
      return
    }
    if (!selectedDryRunEnvironment?.id) {
      setConnectionPreview({ status: 'error', message: t('casos.connectionPreviewMissingEnvironment') })
      return
    }
    setConnectionPreview({ status: 'loading' })
    try {
      const previewPath = `${API_BASE}/proyectos/${encodeURIComponent(String(currentProjectId || ''))}${CHATBOT_CONNECTION_PREVIEW_PATH}`
      const response = await fetchWithAuth(previewPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildChatbotConnectionPreviewRequest(config, {
          environmentId: selectedDryRunEnvironment?.id,
          datasetId: selectedDryRunDataset?.id,
          componentId: newTestComponent,
          projectId: currentProjectId,
          sampleMessage,
          variables: {
            ...(selectedDryRunEnvironment?.variables || {}),
            ...(selectedComponent?.variables || {}),
            ...(selectedDryRunDataset?.variables || {}),
          },
        })),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.ok === false) throw new Error(payload?.detail || payload?.message || payload?.error || t('casos.connectionPreviewError'))
      setConnectionPreview({ status: 'success', result: payload })
    } catch (error: any) {
      setConnectionPreview({ status: 'error', message: error?.message || t('casos.connectionPreviewError') })
    }
  }
  const previewResult = connectionPreview.result || {}
  const previewStatus = previewResult.http_status ?? previewResult.status_code ?? previewResult.status
  const previewLatency = previewResult.latency_ms ?? previewResult.duration_ms
  const previewFormat = previewResult.response_format ?? previewResult.format
  const previewMessage = previewResult.message_extracted ?? previewResult.message
  const previewHasSession = previewResult.session_detected === true
  const requiredMark = <span className="text-danger ms-1" aria-hidden="true">*</span>
  return <Card className="border-0 shadow-sm rounded-3 bg-white text-start mb-3 overflow-hidden">
    <Card.Header className="bg-primary bg-opacity-10 border-0 py-3 d-flex align-items-center justify-content-between gap-3 flex-wrap">
      <div className="d-flex align-items-center gap-2"><Bot size={20} className="text-primary" aria-hidden="true" /><div><h6 className="fw-bold text-dark mb-0">{t('casos.chatbotConfigurationTitle')}</h6><small className="text-muted">{t('casos.chatbotConfigurationSubtitle')}</small></div></div>
      <div className="d-flex align-items-center gap-2 flex-wrap"><Badge bg={ready ? 'success' : 'warning'}>{ready ? t('casos.chatbotReady') : t('casos.chatbotIncomplete')}</Badge>{context.selectedTest && <Button type="button" size="sm" variant="primary" onClick={() => context.onRunChatbotCase?.(context.selectedTest)}>{t('casos.execute')}</Button>}<Button type="button" size="sm" variant="outline-primary" onClick={() => setConfigurationOpen(value => !value)} aria-expanded={configurationOpen} aria-controls="chatbot-configuration-body" className="d-inline-flex align-items-center gap-1"><ChevronDown size={15} aria-hidden="true" /> {configurationOpen ? t('casos.collapseConfiguration') : t('casos.expandConfiguration')}</Button></div>
    </Card.Header>
    {missingRequirements.length > 0 && <div className="px-3 pt-2 small text-warning-emphasis" role="status"><strong>{t('casos.chatbotRequiredFieldsHint')}</strong><ul className="mb-1 ps-3">{missingRequirements.map((requirement, index) => <li key={`${requirement}-${index}`}>{requirement}</li>)}</ul></div>}
    <Card.Body className="p-3">
      {configurationOpen && <div id="chatbot-configuration-body">
      <Alert variant="warning" className="small py-2 mb-3">{t('casos.chatbotSecurityNotice')}</Alert>
      <section className={`chatbot-primary-setup border rounded-2 p-3 mb-3 ${profileResolution.missing.length || endpointMissing ? 'border-warning bg-warning bg-opacity-10' : 'bg-light border-light-subtle'}`} aria-labelledby="chatbot-primary-setup-title">
        <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap mb-3">
          <div><h6 id="chatbot-primary-setup-title" className="fw-bold mb-1">{t('casos.chatbotPrimarySetup')}{requiredMark}</h6><div className="small text-muted">{t('casos.chatbotPrimarySetupHelp')}</div></div>
          {endpointIsInherited && <Badge bg="light" text="dark" className="border">{t('casos.chatbotEndpointInherited')}</Badge>}
        </div>
        <Row className="g-3 align-items-end chatbot-primary-fields">
          <Col xs={12} lg={4}>
            <Form.Label htmlFor="chatbot-connection-preset" className="small fw-semibold">{t('casos.connectionType')}</Form.Label>
            <Form.Select id="chatbot-connection-preset" size="sm" value={selectedPreset} onChange={event => applyPreset(event.target.value as ChatbotConnectionPresetId)}>
              {chatbotConnectionPresets.map(preset => <option key={preset.id} value={preset.id}>{t(preset.labelKey)}</option>)}
            </Form.Select>
            <Form.Text>{t(chatbotConnectionPresets.find(item => item.id === selectedPreset)?.descriptionKey || 'casos.connectionPresetGenericHttpHelp')}</Form.Text>
          </Col>
          <Col xs={12} lg={8}>
            <Form.Label htmlFor="chatbot-endpoint" className="small fw-semibold">{t('casos.chatbotEndpointLabel')}{requiredMark}</Form.Label>
            <div className="d-flex gap-2 chatbot-endpoint-control">
              <Form.Select size="sm" value={config.connection.method || 'POST'} onChange={event => updateConnection('method', event.target.value)} aria-label={t('casos.httpMethod')} className="chatbot-method-select">
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(method => <option key={method} value={method}>{method}</option>)}
              </Form.Select>
              <Form.Control id="chatbot-endpoint" name="chatbot-endpoint" type="text" inputMode="url" size="sm" value={config.connection.endpoint || ''} onChange={event => updateConnection('endpoint', event.target.value)} placeholder="{{ENV.CHATBOT_URL}}/api/chat" autoComplete="off" spellCheck={false} />
            </div>
            <Form.Text>{t('casos.chatbotEndpointHelp')}</Form.Text>
            <VariableReferenceHints value={config.connection.endpoint || ''} {...variableContext} triggerLabel={t('casos.inspectEndpointVariables')} />
          </Col>
          <Col xs={12} md={4} lg={4}>
            <Form.Label htmlFor="chatbot-environment" className="small fw-semibold">{t('casos.chatbotEnvironment')}</Form.Label>
            <Form.Select id="chatbot-environment" name="chatbot-environment" size="sm" value={selectedDryRunEnvironment?.id || ''} onChange={event => { setDryRunEnvironmentId?.(event.target.value); setDryRunDatasetId?.('') }} aria-label={t('casos.chatbotEnvironment')} title={t('casos.chatbotEnvironmentTitle')}>
              <option value="">{t('casos.noEnvironment')}</option>
              {(projectEnvironments || []).map((environment: any) => <option key={environment.id} value={environment.id}>{environment.name || environment.nombre}</option>)}
            </Form.Select>
          </Col>
          <Col xs={12} md={4} lg={4}>
            <Form.Label htmlFor="chatbot-dataset" className="small fw-semibold">{t('casos.chatbotDataset')}</Form.Label>
            <Form.Select id="chatbot-dataset" name="chatbot-dataset" size="sm" value={selectedDryRunDataset?.id || ''} onChange={event => setDryRunDatasetId?.(event.target.value)} aria-label={t('casos.chatbotDataset')} title={t('casos.chatbotDatasetTitle')} disabled={!selectedDryRunEnvironment || !(dryRunDatasets || []).length}>
              <option value="">{t('casos.noDataset')}</option>
              {(dryRunDatasets || []).map((dataset: any) => <option key={dataset.id} value={dataset.id}>{dataset.nombre || dataset.name}</option>)}
            </Form.Select>
          </Col>
          <Col xs={12} md={4} lg={4}>
            <Form.Label htmlFor="chatbot-profile" className="small fw-semibold">{t('casos.chatbotProfile')}</Form.Label>
            <Form.Select id="chatbot-profile" name="chatbot-profile" size="sm" value={selectedProfileId} onChange={event => update('profile_id', event.target.value)} aria-label={t('casos.chatbotProfile')} title={t('casos.chatbotProfileTitle')} disabled={!reusableProfiles.length}>
              <option value="">{t('casos.noProfile')}</option>
              {reusableProfiles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Form.Select>
          </Col>
        </Row>
        <div className="chatbot-response-contract border rounded-2 p-3 mt-3">
          <div className="d-flex align-items-start justify-content-between gap-2 flex-wrap mb-2">
            <div><h6 className="fw-bold mb-1">{t('casos.responseContractTitle')}</h6><div className="small text-muted">{t('casos.responseContractHelp')}</div></div>
            <Badge bg="light" text="dark" className="border">{t('casos.responseContractRequired')}</Badge>
          </div>
          <Row className="g-3 align-items-end">
            <Col xs={12} md={4}><Form.Label htmlFor="chatbot-response-format" className="small fw-semibold">{t('casos.responseFormat')}</Form.Label><Form.Select id="chatbot-response-format" name="chatbot-response-format" size="sm" value={config.connection.response_mapping?.response_format || 'auto'} onChange={event => updateConnection('response_mapping', { ...config.connection.response_mapping, response_format: event.target.value })}><option value="auto">{t('casos.responseFormatAuto')}</option><option value="json">{t('casos.responseFormatJson')}</option><option value="text">{t('casos.responseFormatText')}</option></Form.Select></Col>
            <Col xs={12} md={4}><Form.Label htmlFor="chatbot-message-path" className="small fw-semibold">{t('casos.messagePath')}</Form.Label><Form.Control id="chatbot-message-path" name="chatbot-message-path" size="sm" value={config.connection.response_mapping?.message_path || ''} onChange={event => updateConnection('response_mapping', { ...config.connection.response_mapping, message_path: event.target.value })} placeholder="$.answer" autoComplete="off" spellCheck={false} /></Col>
            <Col xs={12} md={4}><Form.Label htmlFor="chatbot-session-path" className="small fw-semibold">{t('casos.sessionPath')}</Form.Label><Form.Control id="chatbot-session-path" name="chatbot-session-path" size="sm" value={config.connection.response_mapping?.session_id_path || ''} onChange={event => updateConnection('response_mapping', { ...config.connection.response_mapping, session_id_path: event.target.value })} placeholder="$.session_id" autoComplete="off" spellCheck={false} /></Col>
          </Row>
        </div>
        <div className="mt-3">
          <Form.Label htmlFor="chatbot-preview-sample" className="small fw-semibold">{t('casos.connectionPreviewSampleLabel')}</Form.Label>
          <Form.Control id="chatbot-preview-sample" name="chatbot-preview-sample" size="sm" value={previewSampleDraft} onChange={event => setPreviewSampleDraft(event.target.value)} placeholder={sampleMessage} autoComplete="off" />
          <Form.Text>{t('casos.connectionPreviewSampleHelp')}</Form.Text>
        </div>
        <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap mt-3">
        <div className="small text-muted d-flex flex-wrap gap-2 align-items-center chatbot-effective-summary">
          <span>{t('casos.chatbotEnvironmentLabel')}: <strong>{selectedDryRunEnvironment?.name || selectedDryRunEnvironment?.nombre || t('casos.noSelection')}</strong></span>
          <span aria-hidden="true">·</span><span>{t('casos.chatbotDatasetLabel')}: <strong>{selectedDryRunDataset?.name || selectedDryRunDataset?.nombre || t('casos.noSelection')}</strong></span>
          <span aria-hidden="true">·</span><span>{t('casos.chatbotConnectionLabel')}: <strong>{config.connection.endpoint ? `${config.connection.method || 'POST'} ${config.connection.endpoint}` : t('casos.pending')}</strong></span>
          {selectedProfile && <><span aria-hidden="true">·</span><span>{t('casos.profileSummaryLabel')}: <strong>{selectedProfile.name}</strong></span></>}
        </div>
        <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{connectionPreview.status === 'loading' ? t('casos.connectionPreviewLoading') : connectionPreview.status === 'success' ? t('casos.connectionPreviewSuccess') : connectionPreview.status === 'error' ? t('casos.connectionPreviewErrorTitle') : ''}</div>
        <Button type="button" variant="outline-primary" size="sm" onClick={previewConnection} disabled={connectionPreview.status === 'loading'} className="d-inline-flex align-items-center gap-2 flex-shrink-0">{connectionPreview.status === 'loading' ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : <Activity size={15} aria-hidden="true" />}{connectionPreview.status === 'loading' ? t('casos.connectionPreviewLoading') : t('casos.connectionPreviewButton')}</Button>
        </div>
        <div className="chatbot-variable-summary small mt-3">
          <span className="fw-semibold">{t('casos.chatbotAvailableVariables')}:</span>{' '}
          {variableNames.length ? variableNames.slice(0, 8).map(name => <code key={name} className="me-1">{`{{${name}}}`}</code>) : <span className="text-muted">{t('casos.chatbotNoVariables')}</span>}
        {variableNames.length > 8 && <span className="text-muted">{t('casos.chatbotMoreVariables', { count: variableNames.length - 8 })}</span>}
        </div>
        {connectionPreview.status === 'success' && <Alert variant="success" className="mt-3 mb-0 chatbot-preview-result" role="status" aria-live="polite"><div className="d-flex align-items-start gap-2"><CheckCircle2 size={18} aria-hidden="true" /><div className="flex-grow-1 min-w-0"><strong>{t('casos.connectionPreviewSuccess')}</strong><div className="small mt-1 d-flex flex-wrap gap-2"><span>{t('casos.previewHttpStatus')}: <strong>{previewStatus || t('casos.notReported')}</strong></span><span>{t('casos.previewLatency')}: <strong>{previewLatency != null ? `${previewLatency} ms` : t('casos.notReported')}</strong></span><span>{t('casos.previewFormat')}: <strong>{previewFormat || t('casos.notReported')}</strong></span><span>{t('casos.previewSession')}: <strong>{previewHasSession ? t('casos.previewSessionDetected') : t('casos.previewSessionNotDetected')}</strong></span></div>{previewMessage != null && <div className="small mt-2 chatbot-preview-message"><span className="fw-semibold">{t('casos.previewExtractedMessage')}:</span> {String(previewMessage)}</div>}</div></div></Alert>}
        {connectionPreview.status === 'error' && <Alert variant="danger" className="mt-3 mb-0" role="alert" aria-live="polite"><div className="d-flex align-items-start gap-2"><CircleAlert size={18} aria-hidden="true" /><div><strong>{t('casos.connectionPreviewErrorTitle')}</strong><div className="small mt-1">{connectionPreview.message}</div><div className="small mt-1">{t('casos.connectionPreviewErrorHelp')}</div></div></div></Alert>}
        {profileResolution.missing.length > 0 && <div className="mt-2 small text-warning-emphasis">{t('casos.missingDatasetFields', { fields: profileResolution.missing.join(', ') })}</div>}
      </section>
      <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap mb-2">
        <div className="small fw-semibold text-muted">{t('casos.chatbotTechnicalDetails')}</div>
        <Button type="button" variant="link" size="sm" className="text-primary text-decoration-none px-0 d-inline-flex align-items-center gap-1" onClick={() => setTechnicalOpen(value => !value)}>
          <Settings2 size={15} aria-hidden="true" /> {technicalOpen ? t('casos.hideInheritedConfig') : t('casos.customizeConnection')}
        </Button>
        {technicalOpen && <Button type="button" variant="link" size="sm" className="text-secondary text-decoration-none px-0 ms-3 d-inline-flex align-items-center gap-1" onClick={() => setAdvanced(value => !value)}>
          <Code2 size={15} aria-hidden="true" /> {advanced ? t('casos.backToForm') : t('casos.advancedJson')}
        </Button>}
      </div>
      {advanced ? <>
        <Form.Label className="small fw-semibold">{t('casos.completeConfiguration')}</Form.Label>
        <Form.Control as="textarea" rows={22} value={advancedText} onChange={event => setAdvancedText(event.target.value)} className="font-monospace small" aria-label={t('casos.advancedChatbotAria')} />
        {jsonError && <div className="text-danger small mt-2">{jsonError}</div>}
        <Button type="button" variant="primary" size="sm" className="mt-2" onClick={applyAdvanced}>{t('casos.applyJson')}</Button>
      </> : null}
      </div>}
      <Accordion defaultActiveKey="conversation" className="chatbot-config-accordion">
        {configurationOpen && !advanced && technicalOpen && <>
        <Accordion.Item eventKey="connection"><Accordion.Header><Settings2 size={17} className="me-2 text-primary" aria-hidden="true" /> {t('casos.connectionAccordionTitle')}</Accordion.Header><Accordion.Body>
          <div className="small text-muted mb-2">{t('casos.inheritedValuesHelp')}</div>
          <Row className="g-2">
            <Col xs={12} md={4}><Form.Label htmlFor="chatbot-adapter" className="small fw-semibold">{t('casos.adapter')}</Form.Label><Form.Select id="chatbot-adapter" name="chatbot-adapter" size="sm" value={normalizeChatbotAdapter(config.connection.adapter)} onChange={event => updateConnection('adapter', event.target.value)}><option value="generic_http">{t('casos.adapterHttpJson')}</option><option value="openai_compatible">{t('casos.adapterOpenAiCompatible')}</option></Form.Select></Col>
            {normalizeChatbotAdapter(config.connection.adapter) === 'openai_compatible' && <Col xs={12} md={4}><Form.Label htmlFor="chatbot-model" className="small fw-semibold">{t('casos.model')}{requiredMark}</Form.Label><Form.Control id="chatbot-model" name="chatbot-model" size="sm" value={config.connection.model || ''} onChange={event => updateConnection('model', event.target.value)} placeholder={t('casos.modelPlaceholder')} autoComplete="off" /><Form.Text>{t('casos.modelHelp')}</Form.Text></Col>}
            <Col xs={12} md={4}><Form.Label className="small fw-semibold">{t('casos.timeoutMs')}</Form.Label><Form.Control size="sm" type="number" min={500} value={config.connection.timeout_ms || 30000} onChange={event => updateConnection('timeout_ms', Number(event.target.value))} /></Col>
            <Col xs={12} md={4}><div className="small text-muted pt-md-4">{t('casos.chatbotEndpointHelp')}</div></Col>
            <Col md={6}><Form.Label className="small fw-semibold">{t('casos.headersJson')}</Form.Label><Form.Control as="textarea" rows={3} className="font-monospace small" value={headersText} onChange={event => { setHeadersText(event.target.value); parseAndUpdate(event.target.value, value => updateConnection('headers', value), t('casos.headersJson')) }} /></Col>
            <Col md={6}><Form.Label className="small fw-semibold">{t('casos.requestTemplate')}</Form.Label><Form.Control as="textarea" rows={3} className="font-monospace small" value={requestText} onChange={event => { setRequestText(event.target.value); parseAndUpdate(event.target.value, value => updateConnection('request_template', value), t('casos.requestTemplate')) }} /></Col>
            <Col md={3}><Form.Label className="small fw-semibold">{t('casos.retries')}</Form.Label><Form.Control size="sm" type="number" min={0} max={3} value={config.connection.retries ?? 0} onChange={event => updateConnection('retries', Number(event.target.value))} /></Col>
            <Col md={6}><Form.Label className="small fw-semibold">{t('casos.toolCallsPath')}</Form.Label><Form.Control size="sm" value={config.connection.response_mapping?.tool_calls_path || ''} onChange={event => updateConnection('response_mapping', { ...config.connection.response_mapping, tool_calls_path: event.target.value })} placeholder="$.treseko.tool_calls" /></Col>
            <Col md={6}><Form.Label className="small fw-semibold">{t('casos.toolResultPath')}</Form.Label><Form.Control size="sm" value={config.connection.response_mapping?.tool_result_path || ''} onChange={event => updateConnection('response_mapping', { ...config.connection.response_mapping, tool_result_path: event.target.value })} placeholder="$.treseko.tool_result" /></Col>
          </Row>
        </Accordion.Body></Accordion.Item>
        <Accordion.Item eventKey="profile"><Accordion.Header><UserRound size={17} className="me-2 text-primary" aria-hidden="true" /> {t('casos.profileAccordionTitle')}</Accordion.Header><Accordion.Body>
          <div className="small text-muted mb-2">{t('casos.profileOverrideHelp')}</div>
          <Row className="g-2">
            <Col md={5}><Form.Label className="small fw-semibold">{t('casos.reusableProfile')}</Form.Label><Form.Select size="sm" value={selectedProfileId} onChange={event => update('profile_id', event.target.value)}><option value="">{t('casos.noProfileSelected')}</option>{reusableProfiles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Form.Select>{selectedProfile?.description && <Form.Text>{selectedProfile.description}</Form.Text>}</Col>
            <Col md={5}><Form.Label className="small fw-semibold">{t('casos.profileName')}</Form.Label><Form.Control size="sm" value={profile.name || ''} onChange={event => updateNested('profile', 'name', event.target.value)} placeholder={t('casos.profileNamePlaceholder')} /></Col>
            <Col md={2}><Form.Label className="small fw-semibold">{t('casos.age')}</Form.Label><Form.Control size="sm" type="number" value={profile.age || ''} onChange={event => updateNested('profile', 'age', event.target.value ? Number(event.target.value) : '')} /></Col>
            <Col md={2}><Form.Label className="small fw-semibold">{t('casos.language')}</Form.Label><Form.Select size="sm" value={profile.language || 'es'} onChange={event => updateNested('profile', 'language', event.target.value)}><option value="es">{t('casos.languageSpanish')}</option><option value="en">{t('casos.languageEnglish')}</option><option value="pt">{t('casos.languagePortuguese')}</option></Form.Select></Col>
            <Col md={2}><Form.Label className="small fw-semibold">{t('casos.gender')}</Form.Label><Form.Control size="sm" value={profile.gender || ''} onChange={event => updateNested('profile', 'gender', event.target.value)} /></Col>
            <Col md={3}><Form.Label className="small fw-semibold">{t('casos.writingLevel')}</Form.Label><Form.Select size="sm" value={profile.writing_level || 'medium'} onChange={event => updateNested('profile', 'writing_level', event.target.value)}><option value="low">{t('casos.writingLevelLow')}</option><option value="medium">{t('casos.writingLevelMedium')}</option><option value="high">{t('casos.writingLevelHigh')}</option></Form.Select></Col>
            <Col md={3}><Form.Label className="small fw-semibold">{t('casos.tone')}</Form.Label><Form.Select size="sm" value={profile.tone || 'neutral'} onChange={event => updateNested('profile', 'tone', event.target.value)}><option value="neutral">{t('casos.toneNeutral')}</option><option value="confused">{t('casos.toneConfused')}</option><option value="frustrated">{t('casos.toneFrustrated')}</option><option value="formal">{t('casos.toneFormal')}</option></Form.Select></Col>
            <Col md={2} className="d-flex align-items-end"><Form.Check type="switch" label={t('casos.spellingErrors')} checked={profile.spelling_errors === true} onChange={event => updateNested('profile', 'spelling_errors', event.target.checked)} /></Col>
            <Col md={12}><Form.Label className="small fw-semibold">{t('casos.userGoal')}</Form.Label><Form.Control size="sm" value={profile.goal || ''} onChange={event => updateNested('profile', 'goal', event.target.value)} placeholder={t('casos.userGoalPlaceholder')} /></Col>
          </Row>
        </Accordion.Body></Accordion.Item>
        </>}
        <Accordion.Item eventKey="conversation"><Accordion.Header><MessageCircle size={17} className="me-2 text-primary" aria-hidden="true" /> {t('casos.chatbotConversationTitle')}{requiredMark} <Badge bg="light" text="dark" className="ms-2 border">{t('casos.turnsCount', { count: turns.length })}</Badge></Accordion.Header><Accordion.Body>
          <Row className="g-3 align-items-end mb-3"><Col xs={12} md={5} lg={4} className="ms-md-auto"><Form.Label htmlFor="chatbot-session-mode" className="small fw-semibold">{t('casos.session')}</Form.Label><Form.Select id="chatbot-session-mode" name="chatbot-session-mode" size="sm" value={config.conversation.session_mode || 'reuse'} onChange={event => updateNested('conversation', 'session_mode', event.target.value)}><option value="reuse">{t('casos.reuseSession')}</option><option value="new_each_turn">{t('casos.newSessionEachTurn')}</option></Form.Select><Form.Text>{config.conversation.session_mode === 'new_each_turn' ? t('casos.newSessionEachTurnHelp') : t('casos.reuseSessionHelp')}</Form.Text></Col></Row>
          <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap mb-2"><div className="small text-muted">{t('casos.chatbotConversationHelp')}</div>{turns.length > 0 && <Button type="button" variant="outline-primary" size="sm" onClick={addTurn} className="d-inline-flex align-items-center gap-1"><Plus size={14} aria-hidden="true" /> {t('casos.addTurn')}</Button>}</div>
          {turns.map((turn: any, index: number) => (
            <div className="chatbot-turn-card border rounded-2 p-3 mb-3" key={`${index}-${turn.order}`}>
              <div className="chatbot-turn-fields" data-testid={`chatbot-turn-fields-${index + 1}`}>
                <div className="chatbot-turn-field chatbot-turn-number">
                  <Form.Label htmlFor={`chatbot-turn-${index + 1}-input-mode`} className="small mb-1">{t('casos.turnNumber', { number: index + 1 })}</Form.Label>
                  <Form.Select id={`chatbot-turn-${index + 1}-input-mode`} size="sm" value={turn.input?.mode || 'fixed'} onChange={event => updateTurnInput(index, 'mode', event.target.value)}>
                    <option value="fixed">{t('casos.inputModeFixed')}</option>
                    <option value="profile_generated">{t('casos.inputModeGenerated')}</option>
                  </Form.Select>
                </div>
                <div className="chatbot-turn-field chatbot-turn-role">
                  <Form.Label htmlFor={`chatbot-turn-${index + 1}-role`} className="small mb-1">{t('casos.role')}</Form.Label>
                  <Form.Select id={`chatbot-turn-${index + 1}-role`} size="sm" value={turn.role || 'user'} onChange={event => updateTurn(index, 'role', event.target.value)}>
                    <option value="user">{t('casos.roleUser')}</option>
                    <option value="system">{t('casos.roleSystem')}</option>
                  </Form.Select>
                </div>
                <div className="chatbot-turn-field chatbot-turn-message">
                  <Form.Label htmlFor={`chatbot-turn-${index + 1}-message`} className="small mb-1">{t('casos.messageInstruction')}{turn.input?.mode !== 'profile_generated' && requiredMark}</Form.Label>
                  <Form.Control as="textarea" rows={3} id={`chatbot-turn-${index + 1}-message`} size="sm" value={turn.input?.text || ''} onChange={event => updateTurnInput(index, 'text', event.target.value)} placeholder={t('casos.messagePlaceholder')} className="chatbot-turn-message-input" />
                  <VariableReferenceHints value={turn.input?.text || ''} {...variableContext} />
                  <DynamicVariablePicker value={turn.input?.text || ''} onChange={value => updateTurnInput(index, 'text', value)} fetchWithAuth={fetchWithAuth} />
                </div>
                <div className="chatbot-turn-actions">
                  <Button type="button" variant="outline-danger" size="sm" onClick={() => removeTurn(index)} aria-label={t('casos.removeTurn', { number: index + 1 })} className="chatbot-turn-remove">
                    <Trash2 size={15} aria-hidden="true" />
                  </Button>
                </div>
                <div className="chatbot-turn-field chatbot-turn-expected">
                  <Form.Label htmlFor={`chatbot-turn-${index + 1}-expected`} className="small mb-1">{t('casos.expectedResponse')}</Form.Label>
                  <Form.Control id={`chatbot-turn-${index + 1}-expected`} size="sm" value={expectedValue(index, turn)} onChange={event => updateExpected(index, turn, event.target.value)} aria-label={t('casos.expectedResponseAria', { number: index + 1 })} data-testid={`expected-response-${index + 1}`} placeholder={t('casos.expectedResponsePlaceholder')} />
                </div>
                <div className="chatbot-turn-field chatbot-turn-must-include">
                  <Form.Label htmlFor={`chatbot-turn-${index + 1}-must-include`} className="small mb-1">{t('casos.mustInclude')}</Form.Label>
                  <Form.Control id={`chatbot-turn-${index + 1}-must-include`} size="sm" value={csvText(turn.expected?.must_include)} onChange={event => updateTurn(index, 'expected', { ...(turn.expected || {}), must_include: event.target.value.split(',').map(item => item.trim()).filter(Boolean) })} placeholder={t('casos.mustIncludePlaceholder')} />
                </div>
              </div>
            </div>
          ))}
          {!turns.length && <div className="chatbot-empty-turns border rounded-2 p-3"><div className="d-flex align-items-start gap-2"><MessageCircle size={18} className="text-primary flex-shrink-0" aria-hidden="true" /><div><strong className="d-block">{t('casos.noTurnsTitle')}</strong><span className="text-muted small">{t('casos.noTurns')}</span><div className="mt-3"><Button type="button" variant="primary" size="sm" onClick={addTurn} className="d-inline-flex align-items-center gap-1"><Plus size={14} aria-hidden="true" /> {t('casos.addFirstTurn')}</Button></div></div></div></div>}
          <div className="border rounded-2 bg-light p-2 mt-3"><div className="d-flex align-items-center justify-content-between gap-2"><div><strong className="small">{t('casos.memoryCheckTitle')}</strong>{memoryChecks.length > 0 && <Badge bg="secondary" className="ms-2">{memoryChecks.length}</Badge>}<div className="small text-muted">{t('casos.memoryCheckHelp')}</div></div><Button type="button" variant="link" size="sm" className="text-decoration-none" onClick={() => setMemoryOpen(value => !value)}>{memoryOpen ? t('casos.hide') : memoryChecks.length ? t('casos.edit') : t('casos.configure')}</Button></div>{memoryOpen && <div className="mt-2">{memoryChecks.map((check: any, index: number) => <Row className="g-2 align-items-end mb-2" key={`${index}-${check.after_turn}`}><Col md={3}><Form.Label className="small mb-1">{t('casos.afterTurn')}</Form.Label><Form.Control size="sm" type="number" min={1} value={check.after_turn || 1} onChange={event => updateMemoryCheck(index, 'after_turn', Number(event.target.value) || 1)} /></Col><Col md={7}><Form.Label className="small mb-1">{t('casos.memoryData')}</Form.Label><Form.Control size="sm" value={csvText(check.must_remember)} onChange={event => updateMemoryCheck(index, 'must_remember', event.target.value.split(',').map(item => item.trim()).filter(Boolean))} placeholder={t('casos.memoryDataPlaceholder')} /></Col><Col md={2}><Button type="button" variant="outline-danger" size="sm" onClick={() => removeMemoryCheck(index)} aria-label={t('casos.removeMemoryCheck', { number: index + 1 })}><Trash2 size={15} /></Button></Col></Row>)}{!memoryChecks.length && <div className="small text-muted mb-2">{t('casos.noMemoryChecks')}</div>}<Button type="button" variant="outline-primary" size="sm" onClick={addMemoryCheck} className="d-inline-flex align-items-center gap-1"><Plus size={14} /> {t('casos.addMemoryCheck')}</Button><div className="small text-muted mt-2">{t('casos.advancedJsonHelp')}</div></div>}</div>
        </Accordion.Body></Accordion.Item>
        <Accordion.Item eventKey="tools"><Accordion.Header><Wrench size={17} className="me-2 text-primary" aria-hidden="true" /> {t('casos.toolsAccordionTitle')} <Badge bg="light" text="dark" className="ms-2 border">{tools.length}</Badge></Accordion.Header><Accordion.Body>
          <div className="small text-muted mb-2">{t('casos.toolsHelp')}</div><div className="d-flex justify-content-end mb-2"><Button type="button" variant="outline-primary" size="sm" onClick={addTool} className="d-inline-flex align-items-center gap-1"><Plus size={14} /> {t('casos.addTool')}</Button></div>
          {tools.map((tool: any, index: number) => { const mode = tool.observation?.mode || 'black_box'; const required = tool.observation?.required === true; return <div className="border rounded-2 p-2 mb-2" key={`${index}-${tool.name}`}><Row className="g-2 align-items-end"><Col md={3}><Form.Label className="small mb-1">{t('casos.name')}</Form.Label><Form.Control size="sm" value={tool.name || ''} onChange={event => updateTool(index, 'name', event.target.value)} placeholder="get_cart" /></Col><Col md={3}><Form.Label className="small mb-1">{t('casos.expectedArguments')}</Form.Label><Form.Control size="sm" className="font-monospace" value={jsonText(tool.expected_arguments)} onChange={event => parseAndUpdate(event.target.value, value => updateTool(index, 'expected_arguments', value), t('casos.expectedArguments'))} /></Col><Col md={3}><Form.Label className="small mb-1">{t('casos.expectedResult')}</Form.Label><Form.Control size="sm" className="font-monospace" value={jsonText(tool.expected_result)} onChange={event => parseAndUpdate(event.target.value, value => updateTool(index, 'expected_result', value), t('casos.expectedResult'))} /></Col><Col md={1}><Form.Label className="small mb-1">{t('casos.maxCalls')}</Form.Label><Form.Control size="sm" type="number" min={1} value={tool.max_calls || 1} onChange={event => updateTool(index, 'max_calls', Number(event.target.value))} /></Col><Col md={1}><Button type="button" variant="outline-danger" size="sm" onClick={() => removeTool(index)} aria-label={t('casos.removeTool', { number: index + 1 })}><Trash2 size={15} /></Button></Col><Col md={12}><Form.Label className="small mb-1">{t('casos.verificationMethod')}</Form.Label><Form.Select size="sm" value={mode} onChange={event => updateToolObservation(index, 'mode', event.target.value)}><option value="response_payload">{t('casos.observationResponsePayload')}</option><option value="black_box">{t('casos.observationBlackBox')}</option><option value="external_trace" disabled>{t('casos.observationExternalTrace')}</option></Form.Select></Col>{mode === 'black_box' && <Col md={12}><Form.Label className="small mb-1">{t('casos.expectedFinalResponse')}</Form.Label><Form.Control size="sm" value={tool.expected_response || ''} onChange={event => updateTool(index, 'expected_response', event.target.value)} placeholder={t('casos.expectedFinalResponsePlaceholder')} /></Col>}{mode === 'response_payload' && <><Col md={6}><Form.Label className="small mb-1">{t('casos.callPath')}</Form.Label><Form.Control size="sm" className="font-monospace" value={tool.observation?.tool_calls_path || config.connection.response_mapping?.tool_calls_path || ''} onChange={event => updateToolObservation(index, 'tool_calls_path', event.target.value)} placeholder="$.treseko.tool_calls" /></Col><Col md={6}><Form.Label className="small mb-1">{t('casos.resultPath')}</Form.Label><Form.Control size="sm" className="font-monospace" value={tool.observation?.tool_result_path || config.connection.response_mapping?.tool_result_path || ''} onChange={event => updateToolObservation(index, 'tool_result_path', event.target.value)} placeholder="$.treseko.tool_result" /></Col><Col md={12}><Form.Check type="switch" label={t('casos.requiredEvidence')} checked={required} onChange={event => updateToolObservation(index, 'required', event.target.checked)} /></Col></>}{mode === 'black_box' && <Col md={12}><div className="small text-warning-emphasis bg-warning bg-opacity-10 rounded p-2">{t('casos.blackBoxNoticePrefix')} <strong>NOT_OBSERVABLE</strong>.</div></Col>}{mode === 'external_trace' && <Col md={12}><div className="small text-muted bg-light rounded p-2">{t('casos.externalTraceNotice')}</div></Col>}</Row></div> })}
          {!tools.length && <div className="text-muted small border rounded-2 p-3">{t('casos.noTools')}</div>}
        </Accordion.Body></Accordion.Item>
        <Accordion.Item eventKey="evaluation"><Accordion.Header><ShieldCheck size={17} className="me-2 text-primary" aria-hidden="true" /> {t('casos.evaluationAccordionTitle')}</Accordion.Header><Accordion.Body>
          <Row className="g-2"><Col md={6}><Form.Label className="small fw-semibold">{t('casos.deterministicValidations')}</Form.Label><Form.Control size="sm" value={csvText(config.evaluation.deterministic.required_validations)} onChange={event => updateEvaluation('deterministic', 'required_validations', event.target.value.split(',').map(item => item.trim()).filter(Boolean))} placeholder="response_not_empty, no_loop" /></Col><Col md={6}><Form.Label className="small fw-semibold">{t('casos.forbiddenPatterns')}</Form.Label><Form.Control size="sm" value={csvText(config.evaluation.deterministic.forbidden_patterns)} onChange={event => updateEvaluation('deterministic', 'forbidden_patterns', event.target.value.split(',').map(item => item.trim()).filter(Boolean))} placeholder="password, api_key" /></Col><Col md={8}><Form.Label className="small fw-semibold">{t('casos.semanticCriteria')}</Form.Label><Form.Control size="sm" value={csvText(config.evaluation.semantic.criteria)} onChange={event => updateEvaluation('semantic', 'criteria', event.target.value.split(',').map(item => item.trim()).filter(Boolean))} placeholder="kindness, clarity, context_consistency" /></Col><Col md={2}><Form.Label className="small fw-semibold">{t('casos.threshold')}</Form.Label><Form.Control size="sm" type="number" min={0} max={1} step={0.05} value={config.evaluation.semantic.minimum_score ?? 0.8} onChange={event => updateEvaluation('semantic', 'minimum_score', Number(event.target.value))} /></Col><Col md={2} className="d-flex align-items-end"><Form.Check type="switch" label={t('casos.aiJudge')} checked={config.evaluation.semantic.enabled === true} onChange={event => updateEvaluation('semantic', 'enabled', event.target.checked)} /></Col></Row>
        </Accordion.Body></Accordion.Item>
      </Accordion>
      {!advanced && <div className="d-flex align-items-center gap-2 text-muted small mt-3"><Bot size={15} aria-hidden="true" /> {t('casos.variableResolutionHelp')}</div>}
    </Card.Body>
  </Card>
}
