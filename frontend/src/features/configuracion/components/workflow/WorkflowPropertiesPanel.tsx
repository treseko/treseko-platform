import { Badge, Button, Col, Form, Row, Tab, Tabs } from 'react-bootstrap'
import { PlayCircle } from 'lucide-react'
import { getAgentUiMeta } from '../../../../modules/ai-workflow/config/agent-ui.config'
import type { AiWorkflowEdge, AiWorkflowNode } from '../../types/configuracion'
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
  updateWorkflowEdge,
  workflowJsonError,
  setWorkflowJsonError,
  closeWorkflowProperties,
}: Props) {
  if (!selectedWorkflowNode && !selectedWorkflowEdge) return null

  return (
    <aside className="workflow-properties">
      <div className="workflow-properties-header">
        <span>Propiedades</span>
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
            <Badge bg={selectedWorkflowNode.enabled === false ? 'secondary' : 'success'}>{selectedWorkflowNode.enabled === false ? 'INACTIVO' : 'ACTIVO'}</Badge>
          </div>
          <Tabs activeKey={workflowPropertiesTab} onSelect={(key) => setWorkflowPropertiesTab(key || 'general')} className="workflow-property-tabs">
            <Tab eventKey="general" title="General">
              <div className="workflow-tab-pane">
                <Form.Label>Nombre</Form.Label>
                <Form.Control value={selectedWorkflowNode.name} disabled={!canEditAi} onChange={(event) => updateWorkflowNode(selectedWorkflowNode.id, { name: event.target.value })} />
                <Form.Label>Tipo</Form.Label>
                <Form.Select value={selectedWorkflowNode.type} disabled={!canEditAi || selectedWorkflowNode.locked} onChange={(event) => updateWorkflowNode(selectedWorkflowNode.id, { type: event.target.value })}>
                  {workflowTypeOptions.map(option => <option key={option} value={option}>{option}</option>)}
                </Form.Select>
                <Form.Check type="switch" label="Activo" checked={selectedWorkflowNode.enabled !== false} disabled={!canEditAi} onChange={(event) => updateWorkflowNode(selectedWorkflowNode.id, { enabled: event.target.checked })} />
                <Row className="g-2">
                  <Col md={6}><Form.Label>Timeout</Form.Label><Form.Control type="number" min={1} value={selectedWorkflowNode.timeout_sec || 60} disabled={!canEditAi} onChange={(event) => updateWorkflowNode(selectedWorkflowNode.id, { timeout_sec: Number(event.target.value) })} /></Col>
                  <Col md={6}><Form.Label>Temperatura</Form.Label><Form.Control type="number" min={0} max={2} step={0.1} value={selectedWorkflowNode.temperature_override ?? ''} disabled={!canEditAi} onChange={(event) => updateWorkflowNode(selectedWorkflowNode.id, { temperature_override: event.target.value === '' ? null : Number(event.target.value) })} /></Col>
                </Row>
                <Form.Label>Modelo personalizado</Form.Label>
                <Form.Control value={selectedWorkflowNode.model_override || ''} disabled={!canEditAi} onChange={(event) => updateWorkflowNode(selectedWorkflowNode.id, { model_override: event.target.value || null })} />
              </div>
            </Tab>
            <Tab eventKey="prompt" title="Prompt">
              <div className="workflow-tab-pane">
                <Form.Label>Prompt template</Form.Label>
                <Form.Control className="workflow-prompt-editor" as="textarea" rows={12} value={selectedWorkflowNode.prompt_template || ''} disabled={!canEditAi} onChange={(event) => updateWorkflowNode(selectedWorkflowNode.id, { prompt_template: event.target.value })} />
                {canEditAi && <Button variant="outline-primary" size="sm" type="button" className="fw-bold" disabled><PlayCircle size={14} className="me-1" /> Probar con ultimo snapshot</Button>}
              </div>
            </Tab>
            <Tab eventKey="config" title="Config">
              <div className="workflow-tab-pane">
                <Form.Label>Retry policy JSON</Form.Label>
                <Form.Control as="textarea" rows={4} defaultValue={safeJson(selectedWorkflowNode.retry_policy)} disabled={!canEditAi} onBlur={(event) => {
                  try { updateWorkflowNode(selectedWorkflowNode.id, { retry_policy: JSON.parse(event.target.value || '{}') }); setWorkflowJsonError('') } catch { setWorkflowJsonError('Retry policy JSON invalido') }
                }} />
                <Form.Label>Config JSON</Form.Label>
                <Form.Control as="textarea" rows={5} defaultValue={safeJson(selectedWorkflowNode.config_json)} disabled={!canEditAi} onBlur={(event) => {
                  try { updateWorkflowNode(selectedWorkflowNode.id, { config_json: JSON.parse(event.target.value || '{}') }); setWorkflowJsonError('') } catch { setWorkflowJsonError('Config JSON invalido') }
                }} />
                {['llm_agent', 'rule_agent', 'webhook_agent', 'script_agent', 'validator_agent', 'reporter_agent', 'browser_action_agent'].includes(selectedWorkflowNode.type) && (
                  <>
                    <Form.Label>Input mapping JSON</Form.Label>
                    <Form.Control as="textarea" rows={3} defaultValue={safeJson(selectedWorkflowNode.config_json?.input_mapping)} disabled={!canEditAi} onBlur={(event) => {
                      try { updateWorkflowNodeConfig(selectedWorkflowNode.id, { input_mapping: JSON.parse(event.target.value || '{}') }); setWorkflowJsonError('') } catch { setWorkflowJsonError('Input mapping JSON invalido') }
                    }} />
                    <Form.Label>Output schema JSON</Form.Label>
                    <Form.Control as="textarea" rows={3} defaultValue={safeJson(selectedWorkflowNode.config_json?.output_schema)} disabled={!canEditAi} onBlur={(event) => {
                      try { updateWorkflowNodeConfig(selectedWorkflowNode.id, { output_schema: JSON.parse(event.target.value || '{}') }); setWorkflowJsonError('') } catch { setWorkflowJsonError('Output schema JSON invalido') }
                    }} />
                  </>
                )}
                {selectedWorkflowNode.type === 'webhook_agent' && (
                  <Row className="g-2">
                    <Col md={8}><Form.Label>Webhook URL</Form.Label><Form.Control value={selectedWorkflowNode.config_json?.url || ''} disabled={!canEditAi} onChange={(event) => updateWorkflowNodeConfig(selectedWorkflowNode.id, { url: event.target.value })} /></Col>
                    <Col md={4}><Form.Label>Metodo</Form.Label><Form.Select value={selectedWorkflowNode.config_json?.method || 'POST'} disabled={!canEditAi} onChange={(event) => updateWorkflowNodeConfig(selectedWorkflowNode.id, { method: event.target.value })}><option value="POST">POST</option><option value="PUT">PUT</option></Form.Select></Col>
                    <Col md={6}><Form.Label>Timeout ms</Form.Label><Form.Control type="number" value={selectedWorkflowNode.config_json?.timeout_ms || 5000} disabled={!canEditAi} onChange={(event) => updateWorkflowNodeConfig(selectedWorkflowNode.id, { timeout_ms: Number(event.target.value) })} /></Col>
                    <Col md={6}><Form.Label>Retries</Form.Label><Form.Control type="number" value={selectedWorkflowNode.config_json?.retries || 0} disabled={!canEditAi} onChange={(event) => updateWorkflowNodeConfig(selectedWorkflowNode.id, { retries: Number(event.target.value) })} /></Col>
                    <Col md={12}><Form.Label>Allowlist hosts JSON</Form.Label><Form.Control as="textarea" rows={3} defaultValue={JSON.stringify(selectedWorkflowNode.config_json?.allowlist || [], null, 2)} disabled={!canEditAi} onBlur={(event) => {
                      try { updateWorkflowNodeConfig(selectedWorkflowNode.id, { allowlist: JSON.parse(event.target.value || '[]') }); setWorkflowJsonError('') } catch { setWorkflowJsonError('Allowlist JSON invalido') }
                    }} /></Col>
                  </Row>
                )}
              </div>
            </Tab>
            <Tab eventKey="logs" title="Logs">
              <div className="workflow-tab-pane">
                <div className="small text-muted">Las trazas del nodo se consultan en Runtime por execution ID.</div>
              </div>
            </Tab>
          </Tabs>
        </>
      )}
      {selectedWorkflowEdge && (
        <div className="d-flex flex-column gap-2">
          <Form.Label className="x-small text-muted fw-bold text-uppercase">Condicion</Form.Label>
          <Form.Select value={selectedWorkflowEdge.condition_type} disabled={!canEditAi} onChange={(event) => updateWorkflowEdge(selectedWorkflowEdge.id, { condition_type: event.target.value })}>
            {workflowConditionOptions.map(option => <option key={option} value={option}>{option}</option>)}
          </Form.Select>
          <Form.Label className="x-small text-muted fw-bold text-uppercase">Prioridad</Form.Label>
          <Form.Control type="number" value={selectedWorkflowEdge.priority || 0} disabled={!canEditAi} onChange={(event) => updateWorkflowEdge(selectedWorkflowEdge.id, { priority: Number(event.target.value) })} />
          <Form.Label className="x-small text-muted fw-bold text-uppercase">Max passes</Form.Label>
          <Form.Control type="number" min={1} value={selectedWorkflowEdge.max_passes || 1} disabled={!canEditAi} onChange={(event) => updateWorkflowEdge(selectedWorkflowEdge.id, { max_passes: Number(event.target.value) })} />
          <Form.Label className="x-small text-muted fw-bold text-uppercase">Condition JSON</Form.Label>
          <Form.Control as="textarea" rows={5} defaultValue={safeJson(selectedWorkflowEdge.condition_json)} disabled={!canEditAi} onBlur={(event) => {
            try { updateWorkflowEdge(selectedWorkflowEdge.id, { condition_json: JSON.parse(event.target.value || '{}') }); setWorkflowJsonError('') } catch { setWorkflowJsonError('Condition JSON invalido') }
          }} />
        </div>
      )}
      {workflowJsonError && <div className="text-danger small mt-2">{workflowJsonError}</div>}
    </aside>
  )
}
