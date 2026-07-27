import { Badge, Button, Card, Col, Form, Row } from 'react-bootstrap'
import { useState } from 'react'
import { Activity, Brain, Code2, Eye, GitBranch, KeyRound, Network, RefreshCw, Settings2, Terminal, Wrench } from 'lucide-react'
import { formatDateTime } from '../../../../shared/utils/dateTime'
import type { AiProviderOption } from '../../mappers/configuracionMappers'
import type { AiWorkflow } from '../../types/configuracion'
import type { FetchWithAuth } from '../../api/configuracionApi'
import { AiProviderProfilesPanel } from './AiProviderProfilesPanel'

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
  checkAiEngineHealth: (options?: { silent?: boolean }) => Promise<any>
  aiWorkflows: AiWorkflow[]
  onSelectWorkflow: (workflowId: string) => void
  workflowLoadError: string
  agentPresetsError: string
  workflowStatusColor: (status?: string) => string
  formatWorkflowDate: (value?: string) => string
  onOpenWorkflowBuilder: () => void
  onOpenLogs: () => void
  fetchWithAuth: FetchWithAuth
  showFeedback: (title: string, message: string, variant?: string) => void
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
  aiWorkflows,
  onSelectWorkflow,
  workflowLoadError,
  agentPresetsError,
  workflowStatusColor,
  formatWorkflowDate,
  onOpenWorkflowBuilder,
  onOpenLogs,
  fetchWithAuth,
  showFeedback,
}: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const providerRequiresKey = Boolean(aiEngineConfig.last_model_scan_requires_api_key ?? selectedProviderMeta.requiresApiKey)
  const providerKeyEnv = aiEngineConfig.last_model_scan_api_key_env || selectedProviderMeta.apiKeyEnv
  const providerKeyEntry = aiEngineConfig.provider_api_keys?.[selectedRuntimeProvider] || {}
  const providerKeyConfigured = Boolean(aiEngineConfig.provider_api_key_configured || aiEngineConfig.last_model_scan_api_key_configured || providerKeyEntry.api_key)
  const providerKeySource = aiEngineConfig.provider_api_key_source === 'env' ? 'entorno' : providerKeyConfigured ? 'Treseko' : null
  const activeCatalogItem = modelCatalog.find((item: any) => item?.id === aiEngineConfig.model || item?.name === aiEngineConfig.model)
  const kindLabel = selectedProviderMeta.kind === 'local' ? 'Local' : selectedProviderMeta.kind === 'cloud' ? 'Cloud' : 'Compatible'
  const rawEngineStatus = String(aiEngineHealth?.status || '').toLowerCase()
  const engineProcessStatus = String(aiEngineHealth?.engine?.engine?.status || aiEngineHealth?.engine?.status || '').toLowerCase()
  const llmStatusCode = aiEngineHealth?.engine?.llm?.status_code
  const engineProcessOnline = ['ok', 'online', 'healthy'].includes(engineProcessStatus) || Boolean(aiEngineHealth?.engine?.engine?.version)
  const llmOnline = typeof llmStatusCode === 'number' ? llmStatusCode < 400 : rawEngineStatus === 'ok'
  const engineOnline = rawEngineStatus === 'ok'
  const engineDegraded = !engineOnline && engineProcessOnline
  const engineStatusLabel = !aiEngineHealth
    ? 'Verificando'
    : engineOnline
      ? 'Online'
      : engineDegraded
        ? 'Degradado'
        : 'Offline'
  const engineStatusTone = engineOnline
    ? 'success'
    : engineDegraded || !aiEngineHealth
      ? 'warning'
      : 'danger'
  const scanLabel = formatDateTime(aiEngineConfig.last_model_scan_at) || 'Sin auto-scan'
  const promptCost = Number(aiEngineConfig.token_cost_prompt_per_1k ?? 0)
  const completionCost = Number(aiEngineConfig.token_cost_completion_per_1k ?? 0)
  const totalCost = Number(aiEngineConfig.token_cost_per_1k ?? 0)
  const hasCostData = promptCost > 0 || completionCost > 0 || totalCost > 0
  const workflowUses = [
    { purpose: 'test_execution', label: 'Ejecución de pruebas' },
    { purpose: 'story_generation', label: 'Generación de historias' },
    { purpose: 'test_case_generation', label: 'Generación de casos' },
  ] as const
  const activeWorkflowsByPurpose = (purpose: typeof workflowUses[number]['purpose']) => aiWorkflows.filter(
    workflow => workflow.status === 'ACTIVE' && workflow.workflow_purpose === purpose,
  )
  const selectedWorkflowIdForPurpose = (purpose: typeof workflowUses[number]['purpose']) => (
    aiEngineConfig.active_workflow_ids?.[purpose]
    || (purpose === 'test_execution' ? aiEngineConfig.active_workflow_id : '')
    || activeWorkflowsByPurpose(purpose)[0]?.id
    || ''
  )
  const selectWorkflowForPurpose = (purpose: typeof workflowUses[number]['purpose'], workflowId: string) => {
    setAiEngineConfig({
      ...aiEngineConfig,
      active_workflow_ids: { ...(aiEngineConfig.active_workflow_ids || {}), [purpose]: workflowId },
      ...(purpose === 'test_execution' ? { active_workflow_id: workflowId } : {}),
    })
    onSelectWorkflow(workflowId)
  }

  return (
    <div className="d-flex flex-column gap-3">
      <div className="border rounded-3 bg-light px-3 py-2 d-flex flex-wrap align-items-center justify-content-between gap-2">
        <div className="d-flex flex-wrap align-items-center gap-2">
          <StatusPill label="Motor IA" value={engineStatusLabel} tone={engineStatusTone as any} />
          <StatusPill label="Ejecución" value={aiEngineConfig.ai_execution_driver === 'opencode' ? 'OpenCode' : 'Treseko'} tone="primary" />
          <StatusPill label="Proveedor" value={selectedProviderMeta.label} tone="primary" />
          <StatusPill label="Modelo" value={truncateMiddle(aiEngineConfig.model || 'Sin modelo')} />
          <StatusPill label="Scan" value={scanLabel} />
          <StatusPill label="Estado" value={engineStatusLabel} tone={engineStatusTone as any} />
        </div>
        <div className="d-flex flex-wrap gap-2">
          <Button variant="outline-primary" size="sm" className="fw-bold" type="button" onClick={() => checkAiEngineHealth()}>
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
            <h6 className="fw-bold m-0">Proveedor activo</h6>
            <div className="small text-muted">Elegí el proveedor, modelo y credencial dentro de su perfil. Solo un perfil puede estar activo.</div>
          </div>
        </div>
        <AiProviderProfilesPanel
          fetchWithAuth={fetchWithAuth}
          canEdit={canEditAi}
          showFeedback={showFeedback}
          activeConfig={aiEngineConfig}
          onActiveConfig={setAiEngineConfig}
        />
      </SectionCard>

      <SectionCard>
        <button type="button" className="btn btn-link text-decoration-none p-0 w-100 text-start" onClick={() => setShowAdvanced(value => !value)} aria-expanded={showAdvanced}>
          <span className="d-flex justify-content-between align-items-center">
            <span><Settings2 size={17} className="text-primary me-2" /><span className="fw-bold">Opciones avanzadas</span><Badge bg="warning" text="dark" className="ms-2">Experimental</Badge><span className="d-block small text-muted ms-4">Workflows, límites, capacidades, costos y diagnóstico detallado.</span></span>
            <span aria-hidden="true">{showAdvanced ? '▲' : '▼'}</span>
          </span>
        </button>
      </SectionCard>

      {showAdvanced && workflowUses.map(({ purpose, label }) => {
        const options = activeWorkflowsByPurpose(purpose)
        const workflow = aiWorkflows.find(item => item.id === selectedWorkflowIdForPurpose(purpose)) || null
        const workflowAgents = workflow?.nodes?.length || 0
        const workflowEdges = workflow?.edges?.length || 0
        return (
          <SectionCard key={purpose}>
            <div className="d-flex flex-wrap justify-content-between align-items-start gap-3">
              <div>
                <div className="small text-uppercase text-muted fw-bold mb-1">Workflow IA</div>
                <Form.Label className="small fw-bold mb-1" htmlFor={`workflow-${purpose}`}>{label}</Form.Label>
                <Form.Select id={`workflow-${purpose}`} className="mb-1" value={workflow?.id || ''} onChange={(event) => selectWorkflowForPurpose(purpose, event.target.value)} disabled={!canEditAi || options.length === 0}>
                  {options.length === 0 && <option value="">Sin workflow activo</option>}
                  {options.map(item => <option key={item.id} value={item.id}>{item.name} · v{item.version} · {item.status}</option>)}
                </Form.Select>
                <div className="small text-muted mb-2">Selecciona el workflow que se usará para {label.toLowerCase()} y guárdalo con la configuración.</div>
                <div className="small text-muted">
                  {workflowAgents} agentes, {workflowEdges} conexiones, version v{workflow?.version || 1}
                  {workflow?.updated_at || workflow?.created_at ? `, actualizado ${formatWorkflowDate(workflow?.updated_at || workflow?.created_at)}` : ''}
                </div>
              </div>
              <div className="d-flex flex-wrap gap-2">
                <Badge bg={workflowStatusColor(workflow?.status)} className="align-self-center">{workflow?.status || 'SIN WORKFLOW'}</Badge>
                {workflow?.status === 'ACTIVE' && <Badge bg="success" className="align-self-center">PUBLICADO</Badge>}
                <Button size="sm" variant="outline-primary" className="fw-bold" type="button" disabled={!workflow} onClick={() => { if (workflow) onSelectWorkflow(workflow.id); onOpenWorkflowBuilder() }}>
                  <Network size={15} className="me-1" /> {canEditAi ? 'Editar workflow' : 'Ver workflow'}
                </Button>
                <Button size="sm" variant="outline-secondary" className="fw-bold" type="button" disabled={!workflow} onClick={() => { if (workflow) onSelectWorkflow(workflow.id); onOpenWorkflowBuilder() }}>
                  <GitBranch size={15} className="me-1" /> Ver diagrama
                </Button>
              </div>
            </div>
          </SectionCard>
        )
      })}
      {(workflowLoadError || agentPresetsError) && (
        <div className="border rounded-3 bg-warning-subtle text-warning-emphasis small p-3">
          {workflowLoadError && <div><span className="fw-bold">Workflows IA:</span> {workflowLoadError}</div>}
          {agentPresetsError && <div><span className="fw-bold">Presets IA:</span> {agentPresetsError}</div>}
        </div>
      )}

      {showAdvanced && <SectionCard>
        <div className="d-flex flex-column gap-3 mb-4">
          <div><h6 className="fw-bold mb-1">Motor de ejecución</h6><div className="small text-muted">Treseko conserva el control del navegador y valida todas las acciones.</div></div>
          <Form.Select value={aiEngineConfig.ai_execution_driver || 'treseko_engine'} disabled={!canEditAi} onChange={e => setAiEngineConfig({ ...aiEngineConfig, ai_execution_driver: e.target.value })}>
            <option value="treseko_engine">Motor Treseko</option><option value="opencode">OpenCode</option>
          </Form.Select>
          {aiEngineConfig.ai_execution_driver === 'opencode' && <div className="small text-info">OpenCode reutiliza automáticamente el proveedor, modelo y credencial configurados en “Pruebas con IA”.</div>}
        </div>
        <details>
          <summary className="d-flex justify-content-between align-items-center gap-3" role="button">
            <span>
              <span className="d-flex align-items-center gap-2 fw-bold"><Settings2 size={18} className="text-primary" /> Configuracion avanzada</span>
              <span className="d-block small text-muted mt-1">Límites de generación, viewport, timeout, paralelismo y modo de navegador.</span>
            </span>
          </summary>
          <Row className="g-3 align-items-end mt-2">
            <Col md={3}>
              <Form.Label className="fw-bold small text-muted">Timeout seg</Form.Label>
              <Form.Control type="number" min={30} max={7200} value={aiEngineConfig.timeout_seconds} disabled={!canEditAi} onChange={(e) => setAiEngineConfig({ ...aiEngineConfig, timeout_seconds: Number(e.target.value) })} />
            </Col>
            <Col md={3}>
              <Form.Label className="fw-bold small text-muted">Contexto operativo</Form.Label>
              <Form.Control type="number" min={1024} max={2000000} step={1024} value={Number(aiEngineConfig.context_window_tokens ?? 8192)} disabled={!canEditAi} onChange={(e) => setAiEngineConfig({ ...aiEngineConfig, context_window_tokens: Number(e.target.value) })} />
              <div className="small text-muted mt-1">Tokens que el proveedor tiene configurados para atender solicitudes.</div>
            </Col>
            <Col md={3}>
              <Form.Label className="fw-bold small text-muted">Salida máxima de historias</Form.Label>
              <Form.Control type="number" min={256} max={20000} step={128} value={Number(aiEngineConfig.max_completion_tokens ?? 4096)} disabled={!canEditAi} onChange={(e) => setAiEngineConfig({ ...aiEngineConfig, max_completion_tokens: Number(e.target.value) })} />
              <div className="small text-muted mt-1">Tokens reservados para cada respuesta estructurada de generación.</div>
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
      </SectionCard>}

      {showAdvanced && <SectionCard>
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
      </SectionCard>}

      {showAdvanced && <SectionCard>
        <div className="d-flex flex-wrap justify-content-between align-items-start gap-3">
          <div>
            <div className="small text-uppercase text-muted fw-bold mb-1">Diagnostico</div>
            <h6 className="fw-bold mb-1">Estado: {engineStatusLabel}</h6>
            <div className="small text-muted">
              {aiEngineHealth?.detail || (aiEngineHealth
                ? `Engine ${aiEngineHealth?.engine?.engine?.version || 'activo'}${llmOnline ? ' y modelo disponible.' : '; revisa el proveedor/modelo configurado.'}`
                : 'Verificando conectividad, modelo y respuesta del motor.')}
            </div>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <Button variant="outline-secondary" size="sm" className="fw-bold" type="button" onClick={onOpenLogs}>
              <Terminal size={15} className="me-1" /> Ver logs
            </Button>
            <Button variant="primary" size="sm" className="fw-bold" type="button" onClick={() => checkAiEngineHealth()}>
              <RefreshCw size={15} className="me-1" /> Reintentar
            </Button>
          </div>
        </div>
      </SectionCard>}
    </div>
  )
}
