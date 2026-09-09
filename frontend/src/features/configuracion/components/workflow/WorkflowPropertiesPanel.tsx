import { Badge, Button, Col, Form, Row, Tab, Tabs } from 'react-bootstrap'
import { PlayCircle, Plus, Trash2 } from 'lucide-react'
import { useI18n } from '../../../../i18n'
import { getAgentUiMeta } from '../../../../modules/ai-workflow/config/agent-ui.config'
import type { AiAgentPreset, AiWorkflowEdge, AiWorkflowNode } from '../../types/configuracion'
import type { FetchWithAuth } from '../../api/configuracionApi'
import { safeJson, workflowConditionOptions, workflowTypeOptions } from '../../mappers/configuracionMappers'
import { GraphRuntimeContractEditor } from './GraphRuntimeContractEditor'
import { controlInputPorts, controlOutputPorts } from './workflowRuntimeEditorUtils'
import { agentStatusLabel } from './workflowStatusPresentation'

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
  workflowNodes: AiWorkflowNode[]
  workflowFormat?: string
  fetchWithAuth: FetchWithAuth
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
  workflowNodes,
  workflowFormat,
  fetchWithAuth,
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
  const effectivePrompt = selectedWorkflowNode
    ? (String(selectedWorkflowNode.prompt_template || '').trim()
      || String(universalContract?.instructions?.user_instructions || '').trim()
      || String(agentDefinition?.prompt_template || '').trim()
      || String(universalContract?.instructions?.objective || '').trim())
    : ''
  const promptSource = String(selectedWorkflowNode?.prompt_template || '').trim()
    ? 'node'
    : String(universalContract?.instructions?.user_instructions || '').trim()
      ? 'contract'
      : String(agentDefinition?.prompt_template || '').trim()
        ? 'agent'
        : 'objective'
  const selectedEdgeSource = selectedWorkflowEdge
    ? workflowNodes.find(node => node.id === selectedWorkflowEdge.source_node_id)
    : undefined
  const immutableContractPorts = workflowFormat === 'universal_v3'
  const sourceOutputPorts = controlOutputPorts(selectedEdgeSource, immutableContractPorts)
  const selectedEdgeTarget = selectedWorkflowEdge
    ? workflowNodes.find(node => node.id === selectedWorkflowEdge.target_node_id)
    : undefined
  const targetInputPorts = controlInputPorts(selectedEdgeTarget, immutableContractPorts)
  const selectedOutputPort = sourceOutputPorts.includes(String(selectedWorkflowEdge?.source_handle || ''))
    ? String(selectedWorkflowEdge?.source_handle)
    : String(selectedWorkflowEdge?.condition_json?.output_port || '')
  const edgeMappings = Array.isArray(selectedWorkflowEdge?.data_mapping_json) ? selectedWorkflowEdge.data_mapping_json : []
  const updateEdgeMapping = (index: number, field: 'source' | 'target', value: string) => {
    if (!selectedWorkflowEdge) return
    const nextMappings = edgeMappings.map((mapping, mappingIndex) => mappingIndex === index ? { ...mapping, [field]: value } : mapping)
    updateWorkflowEdge(selectedWorkflowEdge.id, { data_mapping_json: nextMappings })
  }
  const addEdgeMapping = () => {
    if (!selectedWorkflowEdge) return
    updateWorkflowEdge(selectedWorkflowEdge.id, { data_mapping_json: [...edgeMappings, { source: 'outputs.', target: 'inputs.' }] })
  }
  const removeEdgeMapping = (index: number) => {
    if (!selectedWorkflowEdge) return
    updateWorkflowEdge(selectedWorkflowEdge.id, { data_mapping_json: edgeMappings.filter((_, mappingIndex) => mappingIndex !== index) })
  }

  return (
    <aside className="workflow-properties">
      <div className="workflow-properties-header">
        <span>{t('configuracion.workflowPropertiesTitle')}</span>
        {selectedWorkflowElement && <button type="button" onClick={closeWorkflowProperties} aria-label={t('configuracion.workflowPropertiesClose')} title={t('configuracion.workflowPropertiesClose')}>×</button>}
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
                <Form.Control name="a11y-workflowpropertiespaneltsx-72" aria-label={t('configuracion.workflowPropertiesName')} value={selectedWorkflowNode.name} disabled={!canEditAi} onChange={(event) => updateWorkflowNode(selectedWorkflowNode.id, { name: event.target.value })} />
                <Form.Label>{t('configuracion.workflowPropertiesType')}</Form.Label>
                <Form.Select name="a11y-workflowpropertiespaneltsx-74" aria-label={t('configuracion.workflowPropertiesType')} value={selectedWorkflowNode.type} disabled={!canEditAi || selectedWorkflowNode.locked} onChange={(event) => updateWorkflowNode(selectedWorkflowNode.id, { type: event.target.value })}>
                  {workflowTypeOptions.map(option => <option key={option} value={option}>{option}</option>)}
                </Form.Select>
                <Form.Check name="a11y-workflowpropertiespaneltsx-77" aria-label={t('configuracion.workflowPropertiesActive')} type="switch" label={t('configuracion.workflowPropertiesActive')} checked={selectedWorkflowNode.enabled !== false} disabled={!canEditAi} onChange={(event) => updateWorkflowNode(selectedWorkflowNode.id, { enabled: event.target.checked })} />
                <Row className="g-2">
                  <Col md={6}><Form.Label>{t('configuracion.workflowPropertiesTimeout')}</Form.Label><Form.Control name="a11y-workflowpropertiespaneltsx-79" aria-label={t('configuracion.workflowPropertiesTimeout')} type="number" min={1} value={selectedWorkflowNode.timeout_sec || 60} disabled={!canEditAi} onChange={(event) => updateWorkflowNode(selectedWorkflowNode.id, { timeout_sec: Number(event.target.value) })} /></Col>
                  {!universalContract && <Col md={6}><Form.Label>{t('configuracion.workflowPropertiesTemperature')}</Form.Label><Form.Control name="a11y-workflowpropertiespaneltsx-80" aria-label={t('configuracion.workflowPropertiesTemperature')} type="number" min={0} max={2} step={0.1} value={selectedWorkflowNode.temperature_override ?? ''} disabled={!canEditAi} onChange={(event) => updateWorkflowNode(selectedWorkflowNode.id, { temperature_override: event.target.value === '' ? null : Number(event.target.value) })} /></Col>}
                </Row>
                {!universalContract && <><Form.Label>{t('configuracion.workflowPropertiesCustomModel')}</Form.Label><Form.Control name="a11y-workflowpropertiespaneltsx-82" aria-label={t('configuracion.workflowPropertiesCustomModel')} value={selectedWorkflowNode.model_override || ''} disabled={!canEditAi} onChange={(event) => updateWorkflowNode(selectedWorkflowNode.id, { model_override: event.target.value || null })} /></>}
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
                <div className="workflow-prompt-source">{t('configuracion.workflowPropertiesPromptSource', { source: promptSource })}</div>
                <Form.Control name="a11y-workflowpropertiespaneltsx-93" aria-label={t('configuracion.workflowPropertiesPromptTemplate')} className="workflow-prompt-editor" as="textarea" rows={12} value={effectivePrompt} disabled={!canEditAi || Boolean(universalContract && !promptOperational)} onChange={(event) => updateWorkflowNode(selectedWorkflowNode.id, { prompt_template: event.target.value })} />
                {canEditAi && <Button variant="outline-primary" size="sm" type="button" className="fw-bold" disabled><PlayCircle size={14} className="me-1" /> {t('configuracion.workflowPropertiesTestSnapshot')}</Button>}
              </div>
            </Tab>
            <Tab eventKey="implementation" title={t('configuracion.workflowPropertiesTabImplementation')}>
              <div className="workflow-tab-pane small">
                {universalContract && <div className="border rounded-2 p-2 mb-3">
                  <div className="fw-bold">{universalContract.implementation?.native_adapter || t('configuracion.workflowPropertiesNativeImplementation')}</div>
                  <div className="text-muted mt-1">{t('configuracion.workflowPropertiesContract')} {selectedWorkflowNode.universal_agent?.version} · {universalContract.implementation?.editable_strategy || t('configuracion.workflowPropertiesStrategyConfig')}</div>
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
                <Form.Control name="a11y-workflowpropertiespaneltsx-114" aria-label={t('configuracion.workflowPropertiesEditableStrategy')} readOnly value={runtimeMetadata.editable_strategy === 'prompt' ? t('configuracion.workflowPropertiesStrategyPrompt') : runtimeMetadata.editable_strategy === 'rules' ? t('configuracion.workflowPropertiesStrategyRules') : runtimeMetadata.editable_strategy === 'sandbox_script' ? t('configuracion.workflowPropertiesStrategySandbox') : t('configuracion.workflowPropertiesStrategyConfig')} />
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
                      <Badge bg={agentDefinition.status === 'operational' ? 'success' : agentDefinition.status === 'experimental' ? 'warning' : 'secondary'}>{agentStatusLabel(agentDefinition.status, t)}</Badge>
                    </div>
                    <div className="text-muted x-small">{agentDefinition.description || t('configuracion.workflowPropertiesCatalogBlock')}</div>
                  </div>
                )}
                <Form.Label>{t('configuracion.workflowPropertiesRetryPolicyJson')}</Form.Label>
                <Form.Control name="a11y-workflowpropertiespaneltsx-140" aria-label={t('configuracion.workflowPropertiesRetryPolicyJson')} as="textarea" rows={4} defaultValue={safeJson(selectedWorkflowNode.retry_policy)} disabled={!canEditAi} onBlur={(event) => {
                  try { updateWorkflowNode(selectedWorkflowNode.id, { retry_policy: JSON.parse(event.target.value || '{}') }); setWorkflowJsonError('') } catch { setWorkflowJsonError(t('configuracion.workflowPropertiesRetryPolicyJsonInvalid')) }
                }} />
                <Form.Label>{t('configuracion.workflowPropertiesConfigJson')}</Form.Label>
                <Form.Control name="a11y-workflowpropertiespaneltsx-144" aria-label={t('configuracion.workflowPropertiesConfigJson')} as="textarea" rows={5} defaultValue={safeJson(selectedWorkflowNode.config_json)} disabled={!canEditAi} onBlur={(event) => {
                  try { updateWorkflowNode(selectedWorkflowNode.id, { config_json: JSON.parse(event.target.value || '{}') }); setWorkflowJsonError('') } catch { setWorkflowJsonError(t('configuracion.workflowPropertiesConfigJsonInvalid')) }
                }} />
                {Object.entries(schemaProperties).map(([key, definition]: [string, any]) => {
                  const value = selectedWorkflowNode.config_json?.[key]
                  const label = definition?.label || key.replace(/_/g, ' ')
                  if (definition?.type === 'boolean') return <Form.Check name="a11y-workflowpropertiespaneltsx-150" aria-label={label} key={key} className="mt-2" type="switch" label={label} checked={Boolean(value)} disabled={!canEditAi} onChange={(event) => updateWorkflowNodeConfig(selectedWorkflowNode.id, { [key]: event.target.checked })} />
                  if (Array.isArray(definition?.enum)) return <><Form.Label key={`${key}-label`}>{label}</Form.Label><Form.Select name="a11y-workflowpropertiespaneltsx-151" aria-label={label} key={key} value={value || ''} disabled={!canEditAi} onChange={(event) => updateWorkflowNodeConfig(selectedWorkflowNode.id, { [key]: event.target.value })}><option value="">{t('configuracion.workflowPropertiesSelect')}</option>{definition.enum.map((option: string) => <option key={option} value={option}>{option}</option>)}</Form.Select></>
                  if (definition?.type === 'object' || definition?.type === 'array') return <><Form.Label key={`${key}-label`}>{label} JSON</Form.Label><Form.Control name="a11y-workflowpropertiespaneltsx-152" aria-label={`${label} JSON`} key={key} as="textarea" rows={3} defaultValue={safeJson(value || (definition?.type === 'array' ? [] : {}))} disabled={!canEditAi} onBlur={(event) => { try { updateWorkflowNodeConfig(selectedWorkflowNode.id, { [key]: JSON.parse(event.target.value || (definition?.type === 'array' ? '[]' : '{}')) }); setWorkflowJsonError('') } catch { setWorkflowJsonError(t('configuracion.workflowPropertiesConfigJsonInvalid')) } }} /></>
                  return <><Form.Label key={`${key}-label`}>{label}</Form.Label><Form.Control name="a11y-workflowpropertiespaneltsx-153" aria-label={label} key={key} type={definition?.type === 'integer' || definition?.type === 'number' ? 'number' : 'text'} value={value ?? ''} disabled={!canEditAi} onChange={(event) => updateWorkflowNodeConfig(selectedWorkflowNode.id, { [key]: definition?.type === 'integer' || definition?.type === 'number' ? Number(event.target.value) : event.target.value })} /></>
                })}
                {(universalContract || ['llm_agent', 'rule_agent', 'webhook_agent', 'script_agent', 'validator_agent', 'reporter_agent', 'browser_action_agent'].includes(selectedWorkflowNode.type)) && (
                  <>
                    <Form.Label>{t('configuracion.workflowPropertiesInputMappingJson')}</Form.Label>
                    <Form.Control name="a11y-workflowpropertiespaneltsx-158" aria-label={t('configuracion.workflowPropertiesInputMappingJson')} as="textarea" rows={3} defaultValue={safeJson(selectedWorkflowNode.config_json?.input_mapping)} disabled={!canEditAi} onBlur={(event) => {
                      try { updateWorkflowNodeConfig(selectedWorkflowNode.id, { input_mapping: JSON.parse(event.target.value || '{}') }); setWorkflowJsonError('') } catch { setWorkflowJsonError(t('configuracion.workflowPropertiesInputMappingJsonInvalid')) }
                    }} />
                    <Form.Label>{t('configuracion.workflowPropertiesOutputMappingJson')}</Form.Label>
                    <Form.Control name="a11y-workflowpropertiespaneltsx-160" aria-label={t('configuracion.workflowPropertiesOutputMappingJson')} as="textarea" rows={3} defaultValue={safeJson(selectedWorkflowNode.config_json?.output_mapping)} disabled={!canEditAi} onBlur={(event) => {
                      try { updateWorkflowNodeConfig(selectedWorkflowNode.id, { output_mapping: JSON.parse(event.target.value || '{}') }); setWorkflowJsonError('') } catch { setWorkflowJsonError(t('configuracion.workflowPropertiesOutputMappingJsonInvalid')) }
                    }} />
                    <Form.Label>{t('configuracion.workflowPropertiesOutputSchemaJson')}</Form.Label>
                    <Form.Control name="a11y-workflowpropertiespaneltsx-162" aria-label={t('configuracion.workflowPropertiesOutputSchemaJson')} as="textarea" rows={3} defaultValue={safeJson(selectedWorkflowNode.config_json?.output_schema)} disabled={!canEditAi} onBlur={(event) => {
                      try { updateWorkflowNodeConfig(selectedWorkflowNode.id, { output_schema: JSON.parse(event.target.value || '{}') }); setWorkflowJsonError('') } catch { setWorkflowJsonError(t('configuracion.workflowPropertiesOutputSchemaJsonInvalid')) }
                    }} />
                  </>
                )}
                {selectedWorkflowNode.type === 'webhook_agent' && (
                  <Row className="g-2">
                    <Col md={8}><Form.Label>{t('configuracion.workflowPropertiesWebhookUrl')}</Form.Label><Form.Control name="a11y-workflowpropertiespaneltsx-169" aria-label={t('configuracion.workflowPropertiesWebhookUrl')} value={selectedWorkflowNode.config_json?.url || ''} disabled={!canEditAi} onChange={(event) => updateWorkflowNodeConfig(selectedWorkflowNode.id, { url: event.target.value })} /></Col>
                    <Col md={4}><Form.Label>{t('configuracion.workflowPropertiesMethod')}</Form.Label><Form.Select name="a11y-workflowpropertiespaneltsx-170" aria-label={t('configuracion.workflowPropertiesMethod')} value={selectedWorkflowNode.config_json?.method || 'POST'} disabled={!canEditAi} onChange={(event) => updateWorkflowNodeConfig(selectedWorkflowNode.id, { method: event.target.value })}><option value="POST">POST</option><option value="PUT">PUT</option></Form.Select></Col>
                    <Col md={6}><Form.Label>{t('configuracion.workflowPropertiesTimeoutMs')}</Form.Label><Form.Control name="a11y-workflowpropertiespaneltsx-171" aria-label={t('configuracion.workflowPropertiesTimeoutMs')} type="number" value={selectedWorkflowNode.config_json?.timeout_ms || 5000} disabled={!canEditAi} onChange={(event) => updateWorkflowNodeConfig(selectedWorkflowNode.id, { timeout_ms: Number(event.target.value) })} /></Col>
                    <Col md={6}><Form.Label>{t('configuracion.workflowPropertiesRetries')}</Form.Label><Form.Control name="a11y-workflowpropertiespaneltsx-172" aria-label={t('configuracion.workflowPropertiesRetries')} type="number" value={selectedWorkflowNode.config_json?.retries || 0} disabled={!canEditAi} onChange={(event) => updateWorkflowNodeConfig(selectedWorkflowNode.id, { retries: Number(event.target.value) })} /></Col>
                    <Col md={12}><Form.Label>{t('configuracion.workflowPropertiesAllowlistHostsJson')}</Form.Label><Form.Control name="a11y-workflowpropertiespaneltsx-173" aria-label={t('configuracion.workflowPropertiesAllowlistHostsJson')} as="textarea" rows={3} defaultValue={JSON.stringify(selectedWorkflowNode.config_json?.allowlist || [], null, 2)} disabled={!canEditAi} onBlur={(event) => {
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
          {workflowFormat === 'universal_v3' && selectedWorkflowNode.universal_agent && (
            <GraphRuntimeContractEditor
              node={selectedWorkflowNode}
              workflowFormat={workflowFormat}
              fetchWithAuth={fetchWithAuth}
              canEdit={canEditAi}
              onUpdateNode={(nodeId: string, updated: AiWorkflowNode) => updateWorkflowNode(nodeId, updated)}
            />
          )}
        </>
      )}
      {selectedWorkflowEdge && (
        <div className="d-flex flex-column gap-2">
          <Form.Label className="x-small text-muted fw-bold text-uppercase">{t('configuracion.workflowPropertiesCondition')}</Form.Label>
          <Form.Select name="a11y-workflowpropertiespaneltsx-191" aria-label={t('configuracion.workflowPropertiesCondition')} value={selectedWorkflowEdge.condition_type} disabled={!canEditAi} onChange={(event) => updateWorkflowEdge(selectedWorkflowEdge.id, { condition_type: event.target.value })}>
            {workflowConditionOptions.map(option => <option key={option} value={option}>{option}</option>)}
          </Form.Select>
          {sourceOutputPorts.length > 0 && (
            <>
              <Form.Label className="x-small text-muted fw-bold text-uppercase">{t('configuracion.workflowPropertiesOutputPort')}</Form.Label>
              <Form.Select name="a11y-workflowpropertiespaneltsx-output-port" aria-label={t('configuracion.workflowPropertiesOutputPort')} value={selectedOutputPort} disabled={!canEditAi} onChange={(event) => {
                const outputPort = event.target.value || null
                const nextCondition = { ...(selectedWorkflowEdge.condition_json || {}) }
                if (outputPort) nextCondition.output_port = outputPort
                else delete nextCondition.output_port
                updateWorkflowEdge(selectedWorkflowEdge.id, {
                  source_handle: outputPort,
                  condition_json: nextCondition,
                })
              }}>
                <option value="">{t('configuracion.workflowPropertiesAnyOutput')}</option>
                {sourceOutputPorts.map(port => <option key={port} value={port}>{port}</option>)}
              </Form.Select>
              <div className="small text-muted">{t('configuracion.workflowPropertiesOutputPortHint')}</div>
            </>
          )}
          {targetInputPorts.length > 0 && (
            <>
              <Form.Label className="x-small text-muted fw-bold text-uppercase">{t('configuracion.workflowPropertiesControlPorts')}</Form.Label>
              <Form.Select aria-label={t('configuracion.workflowPropertiesControlPorts')} value={String(selectedWorkflowEdge.target_handle || '')} disabled={!canEditAi} onChange={(event) => updateWorkflowEdge(selectedWorkflowEdge.id, { target_handle: event.target.value || null })}>
                <option value="">{t('configuracion.workflowPropertiesSelect')}</option>
                {targetInputPorts.map(port => <option key={port} value={port}>{port}</option>)}
              </Form.Select>
            </>
          )}
          <Form.Label className="x-small text-muted fw-bold text-uppercase">{t('configuracion.workflowPropertiesPriority')}</Form.Label>
          <Form.Control name="a11y-workflowpropertiespaneltsx-195" aria-label={t('configuracion.workflowPropertiesPriority')} type="number" value={selectedWorkflowEdge.priority || 0} disabled={!canEditAi} onChange={(event) => updateWorkflowEdge(selectedWorkflowEdge.id, { priority: Number(event.target.value) })} />
          <Form.Label className="x-small text-muted fw-bold text-uppercase">{t('configuracion.workflowPropertiesMaxPasses')}</Form.Label>
          <Form.Control name="a11y-workflowpropertiespaneltsx-197" aria-label={t('configuracion.workflowPropertiesMaxPasses')} type="number" min={1} value={selectedWorkflowEdge.max_passes || 1} disabled={!canEditAi} onChange={(event) => updateWorkflowEdge(selectedWorkflowEdge.id, { max_passes: Number(event.target.value) })} />
          <Form.Label className="x-small text-muted fw-bold text-uppercase">{t('configuracion.workflowPropertiesConditionJson')}</Form.Label>
          <Form.Control name="a11y-workflowpropertiespaneltsx-199" aria-label={t('configuracion.workflowPropertiesConditionJson')} as="textarea" rows={5} defaultValue={safeJson(selectedWorkflowEdge.condition_json)} disabled={!canEditAi} onBlur={(event) => {
            try { updateWorkflowEdge(selectedWorkflowEdge.id, { condition_json: JSON.parse(event.target.value || '{}') }); setWorkflowJsonError('') } catch { setWorkflowJsonError(t('configuracion.workflowPropertiesConditionJsonInvalid')) }
          }} />
          <Form.Label className="x-small text-muted fw-bold text-uppercase">{t('configuracion.workflowPropertiesDataMappingJson')}</Form.Label>
          <div className="workflow-mapping-editor border rounded-2 p-2">
            <div className="d-flex justify-content-between align-items-center gap-2 mb-2">
              <span className="small fw-semibold">{t('configuracion.workflowPropertiesDataMappingRows')}</span>
              <Button size="sm" variant="outline-primary" type="button" onClick={addEdgeMapping} disabled={!canEditAi} aria-label={t('configuracion.workflowPropertiesAddMapping')}>
                <Plus size={13} /> {t('configuracion.workflowPropertiesAddMapping')}
              </Button>
            </div>
            {edgeMappings.map((mapping, index) => (
              <div className="d-flex align-items-center gap-1 mb-1" key={`mapping-${index}`}>
                <Form.Control size="sm" aria-label={`${t('configuracion.workflowPropertiesMappingSource')} ${index + 1}`} value={String(mapping?.source || '')} disabled={!canEditAi} onChange={(event) => updateEdgeMapping(index, 'source', event.target.value)} placeholder="outputs.result" />
                <span className="text-muted">→</span>
                <Form.Control size="sm" aria-label={`${t('configuracion.workflowPropertiesMappingTarget')} ${index + 1}`} value={String(mapping?.target || '')} disabled={!canEditAi} onChange={(event) => updateEdgeMapping(index, 'target', event.target.value)} placeholder="inputs.result" />
                <Button size="sm" variant="outline-danger" type="button" onClick={() => removeEdgeMapping(index)} disabled={!canEditAi} aria-label={`${t('configuracion.workflowPropertiesRemoveMapping')} ${index + 1}`}><Trash2 size={13} /></Button>
              </div>
            ))}
            {!edgeMappings.length && <div className="small text-muted">{t('configuracion.workflowPropertiesNoMappings')}</div>}
          </div>
          <Form.Control name="a11y-workflowpropertiespaneltsx-203" aria-label={t('configuracion.workflowPropertiesDataMappingJson')} as="textarea" rows={4} defaultValue={safeJson(selectedWorkflowEdge.data_mapping_json || [])} disabled={!canEditAi} onBlur={(event) => {
            try { updateWorkflowEdge(selectedWorkflowEdge.id, { data_mapping_json: JSON.parse(event.target.value || '[]') }); setWorkflowJsonError('') } catch { setWorkflowJsonError(t('configuracion.workflowPropertiesDataMappingJsonInvalid')) }
          }} />
        </div>
      )}
      {workflowJsonError && <div className="text-danger small mt-2">{workflowJsonError}</div>}
    </aside>
  )
}
