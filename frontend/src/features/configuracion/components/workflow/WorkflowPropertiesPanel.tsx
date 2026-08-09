import { Badge, Button, Col, Form, Row, Tab, Tabs } from 'react-bootstrap'
import { PlayCircle } from 'lucide-react'
import { useI18n } from '../../../../i18n'
import { getAgentUiMeta } from '../../../../modules/ai-workflow/config/agent-ui.config'
import type { AiAgentPreset, AiWorkflowEdge, AiWorkflowNode } from '../../types/configuracion'
import { safeJson, workflowConditionOptions, workflowTypeOptions } from '../../mappers/configuracionMappers'

type SelectedWorkflowElement = { type: 'node' | 'edge', id: string } | null

type Props = {
  selectedWorkflowElement: SelectedWorkflowElement
  selectedWorkflowNode: AiWorkflowNode | null
  selectedWorkflowEdge: AiWorkflowEdge | null
  canEditAi: boolean
  workflowPropertiesTab: string
  setWorkflowPropertiesTab: (tab: string) => void
  updateWorkflowNode: (nodeId: string, patch: Partial<AiWorkflowNode>) => void
  updateWorkflowNodeConfig: (nodeId: string, patch: Record<string, any>) => void
  agentDefinitions: AiAgentPreset[]
  updateWorkflowEdge: (edgeId: string, patch: Partial<AiWorkflowEdge>) => void
  workflowJsonError: string
  setWorkflowJsonError: (error: string) => void
  closeWorkflowProperties: () => void
}

export function WorkflowPropertiesPanel({
  selectedWorkflowElement,
  selectedWorkflowNode,
  selectedWorkflowEdge,
  canEditAi,
  workflowPropertiesTab,
  setWorkflowPropertiesTab,
  updateWorkflowNode,
  updateWorkflowNodeConfig,
  agentDefinitions,
  updateWorkflowEdge,
  workflowJsonError,
  setWorkflowJsonError,
  closeWorkflowProperties,
}: Props) {
  const { t } = useI18n()
  if (!selectedWorkflowNode && !selectedWorkflowEdge) return null
  const agentDefinition = selectedWorkflowNode?.agent_definition_id
    ? agentDefinitions.find(item => item.agent_definition_id === selectedWorkflowNode.agent_definition_id)
    : undefined
  const schemaProperties = agentDefinition?.config_schema_json?.properties || {}
  const runtimeMetadata = agentDefinition?.ui_metadata_json || {}
  const universalContract = selectedWorkflowNode?.universal_agent?.contract
  const universalStrategy = universalContract?.implementation?.editable_strategy
  const promptOperational = universalStrategy === 'prompt' || universalStrategy === 'hybrid'

  return (
    <aside className="workflow-properties">
      <div className="workflow-properties-header">
        <span>{t('configuracion.workflowPropertiesTitle')}</span>
        {selectedWorkflowElement && <button type="button" onClick={closeWorkflowProperties}>×</button>}
      </div>
      {selectedWorkflowNode && (
        <>
          <div className="workflow-property-node-summary">
            <span className={`workflow-node-icon ${getAgentUiMeta(selectedWorkflowNode).bgClass} ${getAgentUiMeta(selectedWorkflowNode).textClass}`}>{(() => { const Icon = getAgentUiMeta(selectedWorkflowNode).icon; return <Icon size={24} /> })()}</span>
            <div className="min-w-0">
              <div className="fw-bold text-truncate">{selectedWorkflowNode.name}</div>
              <div className="x-small text-muted">{selectedWorkflowNode.type}</div>
            </div>
            <Badge bg={selectedWorkflowNode.enabled === false ? 'secondary' : 'success'}>{selectedWorkflowNode.enabled === false ? t('configuracion.inactive').toUpperCase() : t('configuracion.active').toUpperCase()}</Badge>
          </div>
          <Tabs activeKey={workflowPropertiesTab} onSelect={(key) => setWorkflowPropertiesTab(key || 'general')} className="workflow-property-tabs">
            <Tab eventKey="general" title={t('configuracion.workflowPropertiesTabGeneral')}>
              <div className="workflow-tab-pane">
                <Form.Label>{t('configuracion.workflowPropertiesName')}</Form.Label>
                <Form.Control name="a11y-workflowpropertiespaneltsx-72" aria-label="Campo de formulario" value={selectedWorkflowNode.name} disabled={!canEditAi} onChange={(event) => updateWorkflowNode(selectedWorkflowNode.id, { name: event.target.value })} />
                <Form.Label>{t('configuracion.workflowPropertiesType')}</Form.Label>
                <Form.Select name="a11y-workflowpropertiespaneltsx-74" aria-label="Campo de formulario" value={selectedWorkflowNode.type} disabled={!canEditAi || selectedWorkflowNode.locked} onChange={(event) => updateWorkflowNode(selectedWorkflowNode.id, { type: event.target.value })}>
                  {workflowTypeOptions.map(option => <option key={option} value={option}>{option}</option>)}
                </Form.Select>
                <Form.Check name="a11y-workflowpropertiespaneltsx-77" aria-label="Campo de formulario" type="switch" label={t('configuracion.workflowPropertiesActive')} checked={selectedWorkflowNode.enabled !== false} disabled={!canEditAi} onChange={(event) => updateWorkflowNode(selectedWorkflowNode.id, { enabled: event.target.checked })} />
                <Row className="g-2">
                  <Col md={6}><Form.Label>{t('configuracion.workflowPropertiesTimeout')}</Form.Label><Form.Control name="a11y-workflowpropertiespaneltsx-79" aria-label="Campo de formulario" type="number" min={1} value={selectedWorkflowNode.timeout_sec || 60} disabled={!canEditAi} onChange={(event) => updateWorkflowNode(selectedWorkflowNode.id, { timeout_sec: Number(event.target.value) })} /></Col>
                  {!universalContract && <Col md={6}><Form.Label>{t('configuracion.workflowPropertiesTemperature')}</Form.Label><Form.Control name="a11y-workflowpropertiespaneltsx-80" aria-label="Campo de formulario" type="number" min={0} max={2} step={0.1} value={selectedWorkflowNode.temperature_override ?? ''} disabled={!canEditAi} onChange={(event) => updateWorkflowNode(selectedWorkflowNode.id, { temperature_override: event.target.value === '' ? null : Number(event.target.value) })} /></Col>}
                </Row>
                {!universalContract && <><Form.Label>{t('configuracion.workflowPropertiesCustomModel')}</Form.Label><Form.Control name="a11y-workflowpropertiespaneltsx-82" aria-label="Campo de formulario" value={selectedWorkflowNode.model_override || ''} disabled={!canEditAi} onChange={(event) => updateWorkflowNode(selectedWorkflowNode.id, { model_override: event.target.value || null })} /></>}
                {universalContract && <div className="small text-muted mt-2">{t('configuracion.workflowPropertiesUniversalNodeHint')}</div>}
              </div>
            </Tab>
            <Tab eventKey="prompt" title={t('configuracion.workflowPropertiesTabPrompt')}>
              <div className="workflow-tab-pane">
                {universalContract && <div className="border rounded-2 p-2 mb-3 small">
                  <div className="fw-bold">{promptOperational ? t('configuracion.workflowPropertiesPromptOperational') : universalStrategy === 'rules' ? t('configuracion.workflowPropertiesOperationalRules') : t('configuracion.workflowPropertiesNativeImplementation')}</div>
                  <div className="text-muted mt-1">{promptOperational ? t('configuracion.workflowPropertiesPromptHint') : t('configuracion.workflowPropertiesNativeHint')}</div>
                </div>}
                <Form.Label>{t('configuracion.workflowPropertiesPromptTemplate')}</Form.Label>
                <Form.Control name="a11y-workflowpropertiespaneltsx-93" aria-label="Campo de formulario" className="workflow-prompt-editor" as="textarea" rows={12} value={selectedWorkflowNode.prompt_template || ''} disabled={!canEditAi || Boolean(universalContract && !promptOperational)} onChange={(event) => updateWorkflowNode(selectedWorkflowNode.id, { prompt_template: event.target.value })} />
                {canEditAi && <Button variant="outline-primary" size="sm" type="button" className="fw-bold" disabled><PlayCircle size={14} className="me-1" /> {t('configuracion.workflowPropertiesTestSnapshot')}</Button>}
              </div>
            </Tab>
            <Tab eventKey="implementation" title={t('configuracion.workflowPropertiesTabImplementation')}>
              <div className="workflow-tab-pane small">
                {universalContract && <div className="border rounded-2 p-2 mb-3">
                  <div className="fw-bold">{universalContract.implementation?.native_adapter || 'Adaptador universal'}</div>
                  <div className="text-muted mt-1">{t('configuracion.workflowPropertiesContract')} {selectedWorkflowNode.universal_agent?.version} · {universalContract.implementation?.editable_strategy || 'none'}</div>
                </div>}
                <div className="border rounded-2 p-2 mb-3">
                  <div className="fw-bold">{runtimeMetadata.implementation || t('configuracion.workflowPropertiesConfigurableImplementation')}</div>
                  <div className="text-muted mt-1">{runtimeMetadata.source_module || t('configuracion.workflowPropertiesDeclarativeHint')}</div>
                </div>
                {runtimeMetadata.block_contract && (
                  <div className="border rounded-2 p-2 mb-3">
                    <div className="fw-bold">{t('configuracion.workflowPropertiesContract')} {runtimeMetadata.block_contract}</div>
                    <div className="text-muted mt-1">{t('configuracion.workflowPropertiesPortsHint')}</div>
                  </div>
                )}
                <Form.Label>{t('configuracion.workflowPropertiesEditableStrategy')}</Form.Label>
                <Form.Control name="a11y-workflowpropertiespaneltsx-114" aria-label="Campo de formulario" readOnly value={runtimeMetadata.editable_strategy === 'prompt' ? t('configuracion.workflowPropertiesStrategyPrompt') : runtimeMetadata.editable_strategy === 'rules' ? t('configuracion.workflowPropertiesStrategyRules') : runtimeMetadata.editable_strategy === 'sandbox_script' ? t('configuracion.workflowPropertiesStrategySandbox') : t('configuracion.workflowPropertiesStrategyConfig')} />
                <div className="text-muted mt-3">
                  {t('configuracion.workflowPropertiesNativeCodeHint')}
                </div>
              </div>
            </Tab>
            {universalContract && <Tab eventKey="contract" title={t('configuracion.workflowPropertiesTabContract')}>
              <div className="workflow-tab-pane small d-flex flex-column gap-3">
                <div><div className="text-muted x-small text-uppercase fw-bold">{t('configuracion.workflowPropertiesIdentity')}</div><div>{universalContract.key} · v{universalContract.version}</div></div>
                <div><div className="text-muted x-small text-uppercase fw-bold">{t('configuracion.workflowPropertiesAllowedCapabilities')}</div><div className="d-flex flex-wrap gap-1 mt-1">{(universalContract.capabilities || []).map((capability: string) => <Badge key={capability} bg="light" text="dark" className="border">{capability}</Badge>)}</div></div>
                <div><div className="text-muted x-small text-uppercase fw-bold">{t('configuracion.workflowPropertiesControlPorts')}</div><div>{(universalContract.ports?.control_inputs || []).join(', ')} → {(universalContract.ports?.control_outputs || []).join(', ')}</div></div>
                <div><div className="text-muted x-small text-uppercase fw-bold">{t('configuracion.workflowPropertiesSecurity')}</div><div>{t('configuracion.workflowPropertiesSecurityHint')}</div></div>
              </div>
            </Tab>}
            <Tab eventKey="config" title={t('configuracion.workflowPropertiesTabConfig')}>
              <div className="workflow-tab-pane">
                {agentDefinition && (
                  <div className="border rounded-2 p-2 mb-3 small">
                    <div className="d-flex align-items-center justify-content-between gap-2">
                      <span className="fw-bold">{agentDefinition.name}</span>
                      <Badge bg={agentDefinition.status === 'operational' ? 'success' : agentDefinition.status === 'experimental' ? 'warning' : 'secondary'}>{agentDefinition.status}</Badge>
                    </div>
                    <div className="text-muted x-small">{agentDefinition.description || t('configuracion.workflowPropertiesCatalogBlock')}</div>
                  </div>
                )}
                <Form.Label>{t('configuracion.workflowPropertiesRetryPolicyJson')}</Form.Label>
                <Form.Control name="a11y-workflowpropertiespaneltsx-140" aria-label="Campo de formulario" as="textarea" rows={4} defaultValue={safeJson(selectedWorkflowNode.retry_policy)} disabled={!canEditAi} onBlur={(event) => {
                  try { updateWorkflowNode(selectedWorkflowNode.id, { retry_policy: JSON.parse(event.target.value || '{}') }); setWorkflowJsonError('') } catch { setWorkflowJsonError(t('configuracion.workflowPropertiesRetryPolicyJsonInvalid')) }
                }} />
                <Form.Label>{t('configuracion.workflowPropertiesConfigJson')}</Form.Label>
                <Form.Control name="a11y-workflowpropertiespaneltsx-144" aria-label="Campo de formulario" as="textarea" rows={5} defaultValue={safeJson(selectedWorkflowNode.config_json)} disabled={!canEditAi} onBlur={(event) => {
                  try { updateWorkflowNode(selectedWorkflowNode.id, { config_json: JSON.parse(event.target.value || '{}') }); setWorkflowJsonError('') } catch { setWorkflowJsonError(t('configuracion.workflowPropertiesConfigJsonInvalid')) }
                }} />
                {Object.entries(schemaProperties).map(([key, definition]: [string, any]) => {
                  const value = selectedWorkflowNode.config_json?.[key]
                  const label = definition?.label || key.replace(/_/g, ' ')
                  if (definition?.type === 'boolean') return <Form.Check name="a11y-workflowpropertiespaneltsx-150" aria-label="Campo de formulario" key={key} className="mt-2" type="switch" label={label} checked={Boolean(value)} disabled={!canEditAi} onChange={(event) => updateWorkflowNodeConfig(selectedWorkflowNode.id, { [key]: event.target.checked })} />
                  if (Array.isArray(definition?.enum)) return <><Form.Label key={`${key}-label`}>{label}</Form.Label><Form.Select name="a11y-workflowpropertiespaneltsx-151" aria-label="Campo de formulario" key={key} value={value || ''} disabled={!canEditAi} onChange={(event) => updateWorkflowNodeConfig(selectedWorkflowNode.id, { [key]: event.target.value })}><option value="">{t('configuracion.workflowPropertiesSelect')}</option>{definition.enum.map((option: string) => <option key={option} value={option}>{option}</option>)}</Form.Select></>
                  if (definition?.type === 'object' || definition?.type === 'array') return <><Form.Label key={`${key}-label`}>{label} JSON</Form.Label><Form.Control name="a11y-workflowpropertiespaneltsx-152" aria-label="Campo de formulario" key={key} as="textarea" rows={3} defaultValue={safeJson(value || (definition?.type === 'array' ? [] : {}))} disabled={!canEditAi} onBlur={(event) => { try { updateWorkflowNodeConfig(selectedWorkflowNode.id, { [key]: JSON.parse(event.target.value || (definition?.type === 'array' ? '[]' : '{}')) }); setWorkflowJsonError('') } catch { setWorkflowJsonError(`${label} JSON invalido`) } }} /></>
                  return <><Form.Label key={`${key}-label`}>{label}</Form.Label><Form.Control name="a11y-workflowpropertiespaneltsx-153" aria-label="Campo de formulario" key={key} type={definition?.type === 'integer' || definition?.type === 'number' ? 'number' : 'text'} value={value ?? ''} disabled={!canEditAi} onChange={(event) => updateWorkflowNodeConfig(selectedWorkflowNode.id, { [key]: definition?.type === 'integer' || definition?.type === 'number' ? Number(event.target.value) : event.target.value })} /></>
                })}
                {['llm_agent', 'rule_agent', 'webhook_agent', 'script_agent', 'validator_agent', 'reporter_agent', 'browser_action_agent'].includes(selectedWorkflowNode.type) && (
                  <>
                    <Form.Label>{t('configuracion.workflowPropertiesInputMappingJson')}</Form.Label>
                    <Form.Control name="a11y-workflowpropertiespaneltsx-158" aria-label="Campo de formulario" as="textarea" rows={3} defaultValue={safeJson(selectedWorkflowNode.config_json?.input_mapping)} disabled={!canEditAi} onBlur={(event) => {
                      try { updateWorkflowNodeConfig(selectedWorkflowNode.id, { input_mapping: JSON.parse(event.target.value || '{}') }); setWorkflowJsonError('') } catch { setWorkflowJsonError(t('configuracion.workflowPropertiesInputMappingJsonInvalid')) }
                    }} />
                    <Form.Label>{t('configuracion.workflowPropertiesOutputSchemaJson')}</Form.Label>
                    <Form.Control name="a11y-workflowpropertiespaneltsx-162" aria-label="Campo de formulario" as="textarea" rows={3} defaultValue={safeJson(selectedWorkflowNode.config_json?.output_schema)} disabled={!canEditAi} onBlur={(event) => {
                      try { updateWorkflowNodeConfig(selectedWorkflowNode.id, { output_schema: JSON.parse(event.target.value || '{}') }); setWorkflowJsonError('') } catch { setWorkflowJsonError(t('configuracion.workflowPropertiesOutputSchemaJsonInvalid')) }
                    }} />
                  </>
                )}
                {selectedWorkflowNode.type === 'webhook_agent' && (
                  <Row className="g-2">
                    <Col md={8}><Form.Label>{t('configuracion.workflowPropertiesWebhookUrl')}</Form.Label><Form.Control name="a11y-workflowpropertiespaneltsx-169" aria-label="Campo de formulario" value={selectedWorkflowNode.config_json?.url || ''} disabled={!canEditAi} onChange={(event) => updateWorkflowNodeConfig(selectedWorkflowNode.id, { url: event.target.value })} /></Col>
                    <Col md={4}><Form.Label>{t('configuracion.workflowPropertiesMethod')}</Form.Label><Form.Select name="a11y-workflowpropertiespaneltsx-170" aria-label="Campo de formulario" value={selectedWorkflowNode.config_json?.method || 'POST'} disabled={!canEditAi} onChange={(event) => updateWorkflowNodeConfig(selectedWorkflowNode.id, { method: event.target.value })}><option value="POST">POST</option><option value="PUT">PUT</option></Form.Select></Col>
                    <Col md={6}><Form.Label>{t('configuracion.workflowPropertiesTimeoutMs')}</Form.Label><Form.Control name="a11y-workflowpropertiespaneltsx-171" aria-label="Campo de formulario" type="number" value={selectedWorkflowNode.config_json?.timeout_ms || 5000} disabled={!canEditAi} onChange={(event) => updateWorkflowNodeConfig(selectedWorkflowNode.id, { timeout_ms: Number(event.target.value) })} /></Col>
                    <Col md={6}><Form.Label>{t('configuracion.workflowPropertiesRetries')}</Form.Label><Form.Control name="a11y-workflowpropertiespaneltsx-172" aria-label="Campo de formulario" type="number" value={selectedWorkflowNode.config_json?.retries || 0} disabled={!canEditAi} onChange={(event) => updateWorkflowNodeConfig(selectedWorkflowNode.id, { retries: Number(event.target.value) })} /></Col>
                    <Col md={12}><Form.Label>{t('configuracion.workflowPropertiesAllowlistHostsJson')}</Form.Label><Form.Control name="a11y-workflowpropertiespaneltsx-173" aria-label="Campo de formulario" as="textarea" rows={3} defaultValue={JSON.stringify(selectedWorkflowNode.config_json?.allowlist || [], null, 2)} disabled={!canEditAi} onBlur={(event) => {
                      try { updateWorkflowNodeConfig(selectedWorkflowNode.id, { allowlist: JSON.parse(event.target.value || '[]') }); setWorkflowJsonError('') } catch { setWorkflowJsonError(t('configuracion.workflowPropertiesAllowlistHostsJsonInvalid')) }
                    }} /></Col>
                  </Row>
                )}
              </div>
            </Tab>
                <Tab eventKey="logs" title={t('configuracion.workflowPropertiesTabLogs')}>
              <div className="workflow-tab-pane">
                <div className="small text-muted">{t('configuracion.workflowPropertiesLogsHint')}</div>
              </div>
            </Tab>
          </Tabs>
        </>
      )}
      {selectedWorkflowEdge && (
        <div className="d-flex flex-column gap-2">
          <Form.Label className="x-small text-muted fw-bold text-uppercase">{t('configuracion.workflowPropertiesCondition')}</Form.Label>
          <Form.Select name="a11y-workflowpropertiespaneltsx-191" aria-label="Campo de formulario" value={selectedWorkflowEdge.condition_type} disabled={!canEditAi} onChange={(event) => updateWorkflowEdge(selectedWorkflowEdge.id, { condition_type: event.target.value })}>
            {workflowConditionOptions.map(option => <option key={option} value={option}>{option}</option>)}
          </Form.Select>
          <Form.Label className="x-small text-muted fw-bold text-uppercase">{t('configuracion.workflowPropertiesPriority')}</Form.Label>
          <Form.Control name="a11y-workflowpropertiespaneltsx-195" aria-label="Campo de formulario" type="number" value={selectedWorkflowEdge.priority || 0} disabled={!canEditAi} onChange={(event) => updateWorkflowEdge(selectedWorkflowEdge.id, { priority: Number(event.target.value) })} />
          <Form.Label className="x-small text-muted fw-bold text-uppercase">{t('configuracion.workflowPropertiesMaxPasses')}</Form.Label>
          <Form.Control name="a11y-workflowpropertiespaneltsx-197" aria-label="Campo de formulario" type="number" min={1} value={selectedWorkflowEdge.max_passes || 1} disabled={!canEditAi} onChange={(event) => updateWorkflowEdge(selectedWorkflowEdge.id, { max_passes: Number(event.target.value) })} />
          <Form.Label className="x-small text-muted fw-bold text-uppercase">{t('configuracion.workflowPropertiesConditionJson')}</Form.Label>
          <Form.Control name="a11y-workflowpropertiespaneltsx-199" aria-label="Campo de formulario" as="textarea" rows={5} defaultValue={safeJson(selectedWorkflowEdge.condition_json)} disabled={!canEditAi} onBlur={(event) => {
            try { updateWorkflowEdge(selectedWorkflowEdge.id, { condition_json: JSON.parse(event.target.value || '{}') }); setWorkflowJsonError('') } catch { setWorkflowJsonError(t('configuracion.workflowPropertiesConditionJsonInvalid')) }
          }} />
          <Form.Label className="x-small text-muted fw-bold text-uppercase">{t('configuracion.workflowPropertiesDataMappingJson')}</Form.Label>
          <Form.Control name="a11y-workflowpropertiespaneltsx-203" aria-label="Campo de formulario" as="textarea" rows={4} defaultValue={safeJson(selectedWorkflowEdge.data_mapping_json || [])} disabled={!canEditAi} onBlur={(event) => {
            try { updateWorkflowEdge(selectedWorkflowEdge.id, { data_mapping_json: JSON.parse(event.target.value || '[]') }); setWorkflowJsonError('') } catch { setWorkflowJsonError(t('configuracion.workflowPropertiesDataMappingJsonInvalid')) }
          }} />
        </div>
      )}
      {workflowJsonError && <div className="text-danger small mt-2">{workflowJsonError}</div>}
    </aside>
  )
}
