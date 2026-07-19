import { Badge, Button, Card, Col, Form, Row } from 'react-bootstrap'
import { Activity, Brain, Code2, Eye, GitBranch, KeyRound, Network, RefreshCw, Settings2, Terminal, Wrench } from 'lucide-react'
import { formatDateTime } from '../../../../shared/utils/dateTime'
import type { AiProviderOption } from '../../mappers/configuracionMappers'
import type { AiWorkflow } from '../../types/configuracion'

type Props = {
  aiEngineConfig: any
  setAiEngineConfig: (config: any) => void
  canEditAi: boolean
  modelScanLoading: boolean
  scanAiModels: () => void
  selectedRuntimeProvider: string
  updateAiRuntimeProvider: (provider: string) => void
  aiProviderOptions: AiProviderOption[]
  selectedProviderMeta: AiProviderOption
  modelCatalog: any[]
  modelScanError: string
  activeModelCapabilities: any
  capabilityVariant: (enabled: boolean) => string
  updateActiveModelCapability: (key: string, value: any) => void
  aiEngineHealth: any
  checkAiEngineHealth: () => void
  workflowDraft: AiWorkflow | null
  workflowLoadError: string
  agentPresetsError: string
  workflowStatusColor: (status?: string) => string
  formatWorkflowDate: (value?: string) => string
  onOpenWorkflowBuilder: () => void
  onOpenLogs: () => void
}

const capabilityItems = [
  { key: 'vision', label: 'Vision', icon: Eye },
  { key: 'reasoning', label: 'Razonamiento', icon: Brain },
  { key: 'tools', label: 'Herramientas', icon: Wrench },
  { key: 'json_mode', label: 'Modo JSON', icon: Code2 },
]

function SectionCard({ children }: { children: React.ReactNode }) {
  return <Card className="border-0 shadow-sm rounded-3 p-3 p-lg-4">{children}</Card>
}

function StatusPill({ label, value, tone = 'light' }: { label: string; value: string; tone?: 'light' | 'success' | 'danger' | 'primary' | 'secondary' }) {
  return (
    <div className="border rounded-3 bg-white px-3 py-2 d-flex align-items-center gap-2 min-w-0">
      <span className="small text-muted fw-bold text-uppercase">{label}</span>
      <Badge bg={tone} text={tone === 'light' ? 'dark' : undefined} className={tone === 'light' ? 'border' : ''}>
        {value}
      </Badge>
    </div>
  )
}

function CapabilityBadge({
  label,
  enabled,
  icon: Icon,
  canEdit,
  onToggle,
  variant,
}: {
  label: string
  enabled: boolean
  icon: any
  canEdit: boolean
  onToggle: () => void
  variant: string
}) {
  return (
    <button
      type="button"
      className={`btn btn-sm border rounded-pill d-inline-flex align-items-center gap-2 px-3 ${enabled ? 'bg-white' : 'bg-light text-muted'}`}
      disabled={!canEdit}
      onClick={onToggle}
    >
      <Icon size={14} aria-hidden="true" />
      <span className="fw-bold">{label}</span>
      <Badge bg={variant}>{enabled ? 'Si' : 'No'}</Badge>
    </button>
  )
}

function truncateMiddle(value: string, max = 34) {
  if (!value || value.length <= max) return value
  const head = Math.ceil((max - 3) / 2)
  const tail = Math.floor((max - 3) / 2)
  return `${value.slice(0, head)}...${value.slice(-tail)}`
}

export function AiEngineSettingsCards({
  aiEngineConfig,
  setAiEngineConfig,
  canEditAi,
  modelScanLoading,
  scanAiModels,
  selectedRuntimeProvider,
  updateAiRuntimeProvider,
  aiProviderOptions,
  selectedProviderMeta,
  modelCatalog,
  modelScanError,
  activeModelCapabilities,
  capabilityVariant,
  updateActiveModelCapability,
  aiEngineHealth,
  checkAiEngineHealth,
  workflowDraft,
  workflowLoadError,
  agentPresetsError,
  workflowStatusColor,
  formatWorkflowDate,
  onOpenWorkflowBuilder,
  onOpenLogs,
}: Props) {
  const providerRequiresKey = Boolean(aiEngineConfig.last_model_scan_requires_api_key ?? selectedProviderMeta.requiresApiKey)
  const providerKeyEnv = aiEngineConfig.last_model_scan_api_key_env || selectedProviderMeta.apiKeyEnv
  const providerKeyEntry = aiEngineConfig.provider_api_keys?.[selectedRuntimeProvider] || {}
  const providerKeyValue = providerKeyEntry.api_key === '[redacted]' ? '' : (providerKeyEntry.api_key || '')
  const providerKeyConfigured = Boolean(aiEngineConfig.provider_api_key_configured || aiEngineConfig.last_model_scan_api_key_configured || providerKeyEntry.api_key)
  const providerKeySource = aiEngineConfig.provider_api_key_source === 'env' ? 'entorno' : providerKeyConfigured ? 'Treseko' : null
  const activeCatalogItem = modelCatalog.find((item: any) => item?.id === aiEngineConfig.model || item?.name === aiEngineConfig.model)
  const kindLabel = selectedProviderMeta.kind === 'local' ? 'Local' : selectedProviderMeta.kind === 'cloud' ? 'Cloud' : 'Compatible'
  const engineOnline = aiEngineHealth?.status === 'ok'
  const engineStatusLabel = aiEngineHealth?.status ? (engineOnline ? 'Online' : 'Offline') : 'Sin verificar'
  const engineStatusTone = aiEngineHealth?.status ? (engineOnline ? 'success' : 'danger') : 'secondary'
  const workflowAgents = workflowDraft?.nodes?.length || (Array.isArray(aiEngineConfig.agent_workflow) ? aiEngineConfig.agent_workflow.length : 0)
  const workflowEdges = workflowDraft?.edges?.length || 0
  const scanLabel = formatDateTime(aiEngineConfig.last_model_scan_at) || 'Sin auto-scan'
  const promptCost = Number(aiEngineConfig.token_cost_prompt_per_1k ?? 0)
  const completionCost = Number(aiEngineConfig.token_cost_completion_per_1k ?? 0)
  const totalCost = Number(aiEngineConfig.token_cost_per_1k ?? 0)
  const hasCostData = promptCost > 0 || completionCost > 0 || totalCost > 0

  const updateProviderApiKey = (apiKey: string) => {
    const providerApiKeys = aiEngineConfig.provider_api_keys || {}
    setAiEngineConfig({
      ...aiEngineConfig,
      provider_api_keys: {
        ...providerApiKeys,
        [selectedRuntimeProvider]: {
          ...(providerApiKeys[selectedRuntimeProvider] || {}),
          api_key: apiKey,
          updated_at: new Date().toISOString(),
        },
      },
      provider_api_key_configured: Boolean(apiKey),
      provider_api_key_source: apiKey ? 'stored' : null,
      last_model_scan_api_key_configured: Boolean(apiKey),
    })
  }

  return (
    <div className="d-flex flex-column gap-3">
      <div className="border rounded-3 bg-light px-3 py-2 d-flex flex-wrap align-items-center justify-content-between gap-2">
        <div className="d-flex flex-wrap align-items-center gap-2">
          <StatusPill label="Motor IA" value={engineStatusLabel} tone={engineStatusTone as any} />
          <StatusPill label="Proveedor" value={selectedProviderMeta.label} tone="primary" />
          <StatusPill label="Modelo" value={truncateMiddle(aiEngineConfig.model || 'Sin modelo')} />
          <StatusPill label="Scan" value={scanLabel} />
        </div>
        <div className="d-flex flex-wrap gap-2">
          <Button variant="outline-primary" size="sm" className="fw-bold" type="button" onClick={checkAiEngineHealth}>
            <Activity size={15} className="me-1" /> Verificar
          </Button>
          <Button variant="outline-secondary" size="sm" className="fw-bold" type="button" onClick={onOpenLogs}>
            <Terminal size={15} className="me-1" /> Logs
          </Button>
        </div>
      </div>

      <SectionCard>
        <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
          <div>
            <h6 className="fw-bold m-0">Proveedor y modelo</h6>
            <div className="small text-muted">Configuracion usada por nuevas ejecuciones con IA.</div>
          </div>
          {canEditAi && (
            <Button type="button" variant="outline-primary" size="sm" className="fw-bold" disabled={modelScanLoading} onClick={scanAiModels}>
              <RefreshCw size={15} className="me-1" /> {modelScanLoading ? 'Escaneando...' : 'Auto-scan modelos'}
            </Button>
          )}
        </div>

        <Row className="g-3">
          <Col lg={4}>
            <Form.Label className="fw-bold small text-muted">Proveedor</Form.Label>
            <Form.Select value={selectedRuntimeProvider} disabled={!canEditAi} onChange={(e) => updateAiRuntimeProvider(e.target.value)}>
              {aiProviderOptions.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Form.Select>
            <div className="d-flex flex-wrap gap-1 mt-2">
              <Badge bg={selectedProviderMeta.kind === 'local' ? 'success' : selectedProviderMeta.kind === 'cloud' ? 'primary' : 'secondary'}>{kindLabel}</Badge>
              <Badge bg={providerRequiresKey ? (providerKeyConfigured ? 'success' : 'warning') : 'light'} text={providerRequiresKey ? undefined : 'dark'} className={providerRequiresKey ? '' : 'border'}>
                <KeyRound size={12} className="me-1" />
                {providerRequiresKey ? (providerKeyConfigured ? `Key configurada${providerKeySource ? ` (${providerKeySource})` : ''}` : `Requiere ${providerKeyEnv || 'API_KEY'}`) : 'Sin key'}
              </Badge>
            </div>
          </Col>
          <Col lg={8}>
            <Form.Label className="fw-bold small text-muted">Endpoint</Form.Label>
            <Form.Control
              value={aiEngineConfig.llm_endpoint || ''}
              disabled={!canEditAi}
              onChange={(e) => setAiEngineConfig({ ...aiEngineConfig, llm_endpoint: e.target.value })}
              placeholder={selectedProviderMeta.defaultEndpoint}
            />
          </Col>

          {providerRequiresKey && (
            <Col xs={12}>
              <Form.Label className="fw-bold small text-muted">API key del proveedor</Form.Label>
              <div className="d-flex flex-column flex-lg-row gap-2">
                <Form.Control
                  type="password"
                  autoComplete="off"
                  value={providerKeyValue}
                  disabled={!canEditAi}
                  onChange={(event) => updateProviderApiKey(event.target.value)}
                  placeholder={providerKeyConfigured ? 'Key guardada. Escribe una nueva para reemplazarla.' : `Pega ${providerKeyEnv || 'la API key'} de ${selectedProviderMeta.label}`}
                />
                <Button type="button" variant="outline-secondary" disabled={!canEditAi || !providerKeyConfigured} onClick={() => updateProviderApiKey('')}>
                  Quitar
                </Button>
              </div>
              <div className="small text-muted mt-1">Se guarda por proveedor en el backend y no se vuelve a mostrar completa.</div>
            </Col>
          )}

          <Col lg={5}>
            <Form.Label className="fw-bold small text-muted">Modelo</Form.Label>
            {modelCatalog.length > 0 ? (
              <Form.Select id="ai-model-control" value={aiEngineConfig.model || ''} disabled={!canEditAi} onChange={(e) => setAiEngineConfig({ ...aiEngineConfig, model: e.target.value })}>
                {!activeCatalogItem && aiEngineConfig.model && <option value={aiEngineConfig.model}>{aiEngineConfig.model} (manual)</option>}
                {modelCatalog.map((item: any) => (
                  <option key={item.id || item.name} value={item.id || item.name}>{item.name || item.id}</option>
                ))}
              </Form.Select>
            ) : (
              <Form.Control
                id="ai-model-control"
                value={aiEngineConfig.model || ''}
                disabled={!canEditAi}
                onChange={(e) => setAiEngineConfig({ ...aiEngineConfig, model: e.target.value })}
                placeholder={selectedProviderMeta.defaultModel}
              />
            )}
            <div className="small text-muted mt-1">
              {modelCatalog.length > 0 ? `${modelCatalog.length} modelos disponibles. Fuente: ${activeCatalogItem?.source === 'detected' ? 'detectado' : activeCatalogItem?.source || 'preset/manual'}.` : 'Ejecuta auto-scan o escribe el ID exacto del proveedor.'}
            </div>
          </Col>
          <Col lg={2} md={4}>
            <Form.Label className="fw-bold small text-muted">Temperatura</Form.Label>
            <Form.Control type="number" min={0} max={2} step={0.1} value={aiEngineConfig.temperature} disabled={!canEditAi} onChange={(e) => setAiEngineConfig({ ...aiEngineConfig, temperature: Number(e.target.value) })} />
          </Col>
          <Col lg={2} md={4}>
            <Form.Label className="fw-bold small text-muted">Ventana contexto</Form.Label>
            <Form.Control type="number" min={0} value={Number(activeModelCapabilities.context_window || 0)} disabled={!canEditAi} onChange={(event) => updateActiveModelCapability('context_window', Number(event.target.value))} />
          </Col>
          <Col lg={3} md={4}>
            <Form.Label className="fw-bold small text-muted">Ultimo scan</Form.Label>
            <div className="d-flex flex-column gap-1">
              <Badge bg={aiEngineConfig.last_model_scan_status === 'ok' ? 'success' : aiEngineConfig.last_model_scan_status === 'error' ? 'danger' : aiEngineConfig.last_model_scan_status === 'empty' ? 'warning' : 'secondary'} className="align-self-start">
                {aiEngineConfig.last_model_scan_status === 'ok' ? 'OK' : aiEngineConfig.last_model_scan_status === 'error' ? 'Error' : aiEngineConfig.last_model_scan_status === 'empty' ? 'Sin modelos' : 'Manual'}
              </Badge>
              <span className="small text-muted">{scanLabel}</span>
            </div>
          </Col>

          <Col xs={12}>
            <div className="border rounded-3 bg-light p-3">
              <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
                <div>
                  <div className="fw-bold small text-muted text-uppercase">Capacidades</div>
                  <div className="small text-muted">Disponibilidad visible del modelo activo.</div>
                </div>
                <Badge bg="light" text="dark" className="border">{activeModelCapabilities.source === 'detected' ? 'Detectado' : activeModelCapabilities.source || 'Manual'}</Badge>
              </div>
              <div className="d-flex flex-wrap gap-2">
                {capabilityItems.map(({ key, label, icon }) => (
                  <CapabilityBadge
                    key={key}
                    label={label}
                    icon={icon}
                    enabled={Boolean((activeModelCapabilities as any)[key])}
                    canEdit={canEditAi}
                    variant={capabilityVariant(Boolean((activeModelCapabilities as any)[key]))}
                    onToggle={() => updateActiveModelCapability(key, !Boolean((activeModelCapabilities as any)[key]))}
                  />
                ))}
              </div>
              <Form.Control className="mt-3" value={activeModelCapabilities.notes || ''} disabled={!canEditAi} onChange={(event) => updateActiveModelCapability('notes', event.target.value)} placeholder="Notas de capacidades, validaciones manuales o limites del proveedor." />
              {modelScanError && <div className="small text-danger mt-2">{modelScanError}</div>}
            </div>
          </Col>
        </Row>
      </SectionCard>

      <SectionCard>
        <div className="d-flex flex-wrap justify-content-between align-items-start gap-3">
          <div>
            <div className="small text-uppercase text-muted fw-bold mb-1">Workflow IA</div>
            <h6 className="fw-bold mb-1">{workflowDraft?.name || 'Sin workflow cargado'}</h6>
            <div className="small text-muted">
              {workflowAgents} agentes, {workflowEdges} conexiones, version v{workflowDraft?.version || 1}
              {workflowDraft?.updated_at || workflowDraft?.created_at ? `, actualizado ${formatWorkflowDate(workflowDraft?.updated_at || workflowDraft?.created_at)}` : ''}
            </div>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <Badge bg={workflowStatusColor(workflowDraft?.status)} className="align-self-center">{workflowDraft?.status || 'DRAFT'}</Badge>
            <Button size="sm" variant="outline-primary" className="fw-bold" type="button" disabled={!workflowDraft} onClick={onOpenWorkflowBuilder}>
              <Network size={15} className="me-1" /> {canEditAi ? 'Editar workflow' : 'Ver workflow'}
            </Button>
            <Button size="sm" variant="outline-secondary" className="fw-bold" type="button" disabled={!workflowDraft} onClick={onOpenWorkflowBuilder}>
              <GitBranch size={15} className="me-1" /> Ver diagrama
            </Button>
          </div>
        </div>
        {(workflowLoadError || agentPresetsError) && (
          <div className="border rounded-3 bg-warning-subtle text-warning-emphasis small p-3 mt-3">
            {workflowLoadError && <div><span className="fw-bold">Workflows IA:</span> {workflowLoadError}</div>}
            {agentPresetsError && <div><span className="fw-bold">Presets IA:</span> {agentPresetsError}</div>}
          </div>
        )}
      </SectionCard>

      <SectionCard>
        <details>
          <summary className="d-flex justify-content-between align-items-center gap-3" role="button">
            <span>
              <span className="d-flex align-items-center gap-2 fw-bold"><Settings2 size={18} className="text-primary" /> Configuracion avanzada</span>
              <span className="d-block small text-muted mt-1">Viewport, timeout, paralelismo y modo de navegador.</span>
            </span>
          </summary>
          <Row className="g-3 align-items-end mt-2">
            <Col md={3}>
              <Form.Label className="fw-bold small text-muted">Timeout seg</Form.Label>
              <Form.Control type="number" min={30} max={7200} value={aiEngineConfig.timeout_seconds} disabled={!canEditAi} onChange={(e) => setAiEngineConfig({ ...aiEngineConfig, timeout_seconds: Number(e.target.value) })} />
            </Col>
            <Col md={3}>
              <Form.Label className="fw-bold small text-muted">Ancho viewport</Form.Label>
              <Form.Control type="number" min={320} max={7680} value={Number(aiEngineConfig.viewport_width ?? 1920)} disabled={!canEditAi} onChange={(e) => setAiEngineConfig({ ...aiEngineConfig, viewport_width: Number(e.target.value) })} />
            </Col>
            <Col md={3}>
              <Form.Label className="fw-bold small text-muted">Alto viewport</Form.Label>
              <Form.Control type="number" min={320} max={4320} value={Number(aiEngineConfig.viewport_height ?? 1080)} disabled={!canEditAi} onChange={(e) => setAiEngineConfig({ ...aiEngineConfig, viewport_height: Number(e.target.value) })} />
            </Col>
            <Col md={3}>
              <Form.Label className="fw-bold small text-muted">IA en paralelo</Form.Label>
              <Form.Control type="number" min={1} max={5} value={Number(aiEngineConfig.max_parallel_ai_runs ?? 1)} disabled={!canEditAi} onChange={(e) => setAiEngineConfig({ ...aiEngineConfig, max_parallel_ai_runs: Number(e.target.value) })} />
            </Col>
            <Col md={12}>
              <Form.Check type="switch" id="ai-headless-config" label="Usar navegador oculto por defecto" checked={Boolean(aiEngineConfig.headless)} disabled={!canEditAi} onChange={(e) => setAiEngineConfig({ ...aiEngineConfig, headless: e.target.checked })} />
            </Col>
          </Row>
        </details>
      </SectionCard>

      <SectionCard>
        <details>
          <summary className="d-flex justify-content-between align-items-center gap-3" role="button">
            <span>
              <span className="fw-bold">Costos del modelo</span>
              <span className="d-block small text-muted mt-1">Valores opcionales para estimar costo por ejecucion.</span>
            </span>
            {!hasCostData && <Badge bg="light" text="dark" className="border">Sin datos</Badge>}
          </summary>
          <Row className="g-3 mt-2">
            <Col md={4}>
              <Form.Label className="fw-bold small text-muted">Prompt / 1K tokens</Form.Label>
              <Form.Control type="number" min={0} step={0.0001} value={promptCost} disabled={!canEditAi} onChange={(e) => setAiEngineConfig({ ...aiEngineConfig, token_cost_prompt_per_1k: Number(e.target.value) })} />
            </Col>
            <Col md={4}>
              <Form.Label className="fw-bold small text-muted">Completion / 1K tokens</Form.Label>
              <Form.Control type="number" min={0} step={0.0001} value={completionCost} disabled={!canEditAi} onChange={(e) => setAiEngineConfig({ ...aiEngineConfig, token_cost_completion_per_1k: Number(e.target.value) })} />
            </Col>
            <Col md={4}>
              <Form.Label className="fw-bold small text-muted">Costo total / 1K tokens</Form.Label>
              <Form.Control type="number" min={0} step={0.0001} value={totalCost} disabled={!canEditAi} onChange={(e) => setAiEngineConfig({ ...aiEngineConfig, token_cost_per_1k: Number(e.target.value) })} />
            </Col>
          </Row>
        </details>
      </SectionCard>

      <SectionCard>
        <div className="d-flex flex-wrap justify-content-between align-items-start gap-3">
          <div>
            <div className="small text-uppercase text-muted fw-bold mb-1">Diagnostico</div>
            <h6 className="fw-bold mb-1">Estado: {engineStatusLabel}</h6>
            <div className="small text-muted">{aiEngineHealth?.detail || 'Ejecuta una verificacion para confirmar conectividad, modelo y respuesta del motor.'}</div>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <Button variant="outline-secondary" size="sm" className="fw-bold" type="button" onClick={onOpenLogs}>
              <Terminal size={15} className="me-1" /> Ver logs
            </Button>
            <Button variant="primary" size="sm" className="fw-bold" type="button" onClick={checkAiEngineHealth}>
              <RefreshCw size={15} className="me-1" /> Reintentar
            </Button>
          </div>
        </div>
      </SectionCard>
    </div>
  )
}
