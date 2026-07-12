import type { AiWorkflowEdge, AiWorkflowNode } from '../types/configuracion'
import { formatDateTime } from '../../../shared/utils/dateTime'

export const defaultAgentWorkflow = [
  { id: 'AI_AGENT', name: 'Agente IA', enabled: true, locked: true, action: 'plan_action', retry_limit: 0, prompt: 'Sos un agente QA que controla un navegador real. Ejecuta solo el paso actual. Responde solo JSON con action, target_ref, value, reason, expected, confidence y step_number. No inventes target_ref ni copies ejemplos.' },
  { id: 'QA_GUARD', name: 'QA Guard', enabled: true, locked: true, action: 'validate_action', retry_limit: 0, prompt: 'Rol: Agente QA Guard de seguridad de ejecución. Evita alucinaciones, acciones irrelevantes, navegación externa accidental y waits inútiles. Aprueba solo acciones coherentes con el objetivo y el DOM.' },
  { id: 'SENTINEL', name: 'Sentinel', enabled: true, locked: true, action: 'execute_action', retry_limit: 2, prompt: 'Rol: Agente centinela. Ejecuta acciones validadas, detecta estados de carga, errores visibles y valida estabilidad despues de cada accion antes de continuar.' },
  { id: 'AUDITOR', name: 'Auditor', enabled: true, locked: true, action: 'final_audit', retry_limit: 0, prompt: 'Auditoria de QA Senior final. Evalua historial, screenshot final y resultado esperado. Responde solo JSON con status, reason y confidence. Usa PASSED, FAILED, BLOCKED o SKIPPED.' },
]

export const normalizeAiAgentWorkflow = (workflow: any[] = []) => {
  const byId = new Map(workflow.map((item: any) => [String(item?.id || '').toUpperCase(), item]))
  const base = defaultAgentWorkflow.map(item => ({ ...item, ...(byId.get(item.id) || {}), id: item.id, locked: true }))
  const custom = workflow.filter((item: any) => String(item?.id || '').toUpperCase().startsWith('CUSTOM_')).map((item: any) => ({ ...item, locked: false }))
  return [...base, ...custom]
}

export const defaultAiEngineConfig = {
  provider: 'openai-compatible',
  provider_label: null,
  llm_endpoint: 'http://127.0.0.1:1234/v1',
  model: 'google/gemma-4-e4b',
  temperature: 0.1,
  max_steps: 10,
  headless: true,
  viewport_width: 1920,
  viewport_height: 1080,
  timeout_seconds: 900,
  max_parallel_ai_runs: 1,
  token_cost_prompt_per_1k: 0,
  token_cost_completion_per_1k: 0,
  token_cost_per_1k: 0.01,
  model_capabilities: {},
  model_catalog: [],
  auto_scan_enabled: false,
  last_model_scan_at: null,
  last_model_scan_status: null,
  agent_workflow: defaultAgentWorkflow,
  active_workflow_id: null,
}

export const defaultAttachmentConfig = {
  allowed_mime_types: [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/json',
    'application/xml',
    'text/xml',
    'application/zip',
    'application/x-zip-compressed',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'video/mp4',
    'video/webm',
    'application/octet-stream',
  ],
  max_file_size_mb: 10,
  max_files_per_step: 5,
  max_files_per_snapshot: 10,
  enable_clipboard_paste: true,
  require_evidence_on_failure: false,
}

export const agentActionOptions = [
  { value: 'plan_action', label: 'Planificar accion' },
  { value: 'validate_action', label: 'Validar accion' },
  { value: 'execute_action', label: 'Ejecutar accion' },
  { value: 'final_audit', label: 'Auditoria final' },
  { value: 'custom_review', label: 'Revision custom' },
]

export const aiProviderOptions = [
  { value: 'lm-studio', label: 'LM Studio', defaultEndpoint: 'http://127.0.0.1:1234/v1', scan: 'OpenAI /models local' },
  { value: 'openai-compatible', label: 'OpenAI Compatible', defaultEndpoint: 'http://127.0.0.1:1234/v1', scan: 'OpenAI /models' },
  { value: 'ollama', label: 'Ollama', defaultEndpoint: 'http://127.0.0.1:11434', scan: 'Ollama /api/tags' },
  { value: 'openai', label: 'OpenAI', defaultEndpoint: 'https://api.openai.com/v1', scan: 'Catálogo preset' },
  { value: 'gemini', label: 'Google Gemini', defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', scan: 'Catálogo preset' },
  { value: 'anthropic', label: 'Anthropic', defaultEndpoint: 'https://api.anthropic.com/v1', scan: 'Catálogo preset' },
]

export const defaultModelCapabilities = {
  vision: false,
  reasoning: false,
  tools: false,
  json_mode: true,
  context_window: 0,
  notes: '',
  source: 'manual',
}

export const inferAiRuntimeProvider = (config: any) => {
  const endpoint = String(config?.llm_endpoint || '').toLowerCase()
  if (endpoint.includes(':1234')) return 'lm-studio'
  if (endpoint.includes('11434')) return 'ollama'
  return config?.provider || 'openai-compatible'
}

export const getModelCatalog = (config: any) => Array.isArray(config?.model_catalog) ? config.model_catalog : []

export const getActiveModelCapabilities = (config: any) => {
  const catalogMatch = getModelCatalog(config).find((item: any) => item.id === config?.model || item.name === config?.model)
  const rawCapabilities = config?.model_capabilities || {}
  const stored = rawCapabilities?.[config?.model] || (['vision', 'reasoning', 'tools', 'json_mode', 'context_window', 'notes'].some(key => Object.prototype.hasOwnProperty.call(rawCapabilities, key)) ? rawCapabilities : {})
  return { ...defaultModelCapabilities, ...(catalogMatch?.capabilities || {}), ...(stored || {}) }
}

export const capabilityVariant = (enabled: boolean) => enabled ? 'success' : 'secondary'

export const workflowConditionOptions = ['always', 'on_success', 'on_failed', 'on_blocked', 'on_rejected', 'confidence_lt', 'retry_count_lt']
export const workflowTypeOptions = ['ContextResolver', 'Observer', 'Planner', 'SecurityGuard', 'Executor', 'Validator', 'Recovery', 'Auditor', 'Reporter', 'llm_agent', 'rule_agent', 'browser_action_agent', 'validator_agent', 'reporter_agent', 'webhook_agent']

export const workflowStatusColor = (status?: string) => status === 'ACTIVE' ? 'success' : status === 'ARCHIVED' ? 'secondary' : 'warning'
export const safeJson = (value: any) => JSON.stringify(value || {}, null, 2)
export const formatWorkflowDate = (value?: string) => {
  return formatDateTime(value) || '-'
}

export const defaultWorkflowPositions: Record<string, { x: number, y: number }> = {
  ContextResolver: { x: 0, y: 160 },
  Observer: { x: 300, y: 160 },
  Planner: { x: 600, y: 160 },
  SecurityGuard: { x: 900, y: 160 },
  Executor: { x: 1200, y: 60 },
  Validator: { x: 1500, y: 60 },
  Recovery: { x: 1200, y: 300 },
  Auditor: { x: 1800, y: 160 },
  Reporter: { x: 2100, y: 160 },
}

const defaultWorkflowTypes = Object.keys(defaultWorkflowPositions)

export const hasDefaultWorkflowTypes = (nodes: AiWorkflowNode[]) => {
  const types = new Set(nodes.map(node => node.type))
  return nodes.length === defaultWorkflowTypes.length && defaultWorkflowTypes.every(type => types.has(type))
}

export const isFeedbackWorkflowEdge = (edge: AiWorkflowEdge, nodesById: Map<string, AiWorkflowNode>) => {
  const source = nodesById.get(edge.source_node_id)
  const target = nodesById.get(edge.target_node_id)
  return (
    (source?.type === 'Validator' && target?.type === 'Observer') ||
    (source?.type === 'Recovery' && target?.type === 'Observer')
  )
}

export const shouldShowWorkflowEdgeLabel = (edge: AiWorkflowEdge, label: string, feedbackEdge: boolean) => {
  if (edge.condition_json?.label) return true
  if (feedbackEdge) return true
  return ['failed', 'rejected', 'blocked', 'retry', 'no more steps'].includes(label)
}
