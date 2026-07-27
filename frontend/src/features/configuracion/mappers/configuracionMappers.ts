import type { AiWorkflowEdge, AiWorkflowNode } from '../types/configuracion'
import { formatDateTime } from '../../../shared/utils/dateTime'

export const defaultAgentWorkflow = [
  { id: 'AI_AGENT', name: 'Agente IA', enabled: true, locked: true, action: 'plan_action', retry_limit: 0, prompt: 'Sos un agente QA que controla un navegador real. Ejecuta solo el paso actual. Responde solo JSON con action, target_ref, value, reason, expected, confidence y step_number. No inventes target_ref ni copies ejemplos.' },
  { id: 'QA_GUARD', name: 'QA Guard', enabled: true, locked: true, action: 'validate_action', retry_limit: 0, prompt: 'Rol: Agente QA Guard de seguridad de ejecución. Evita alucinaciones, acciones irrelevantes, navegación externa accidental y waits inútiles. Aprueba solo acciones coherentes con el objetivo y el DOM.' },
  { id: 'SENTINEL', name: 'Sentinel', enabled: true, locked: true, action: 'execute_action', retry_limit: 2, prompt: 'Rol: Agente centinela. Ejecuta acciones validadas, detecta estados de carga, errores visibles y valida estabilidad despues de cada accion antes de continuar.' },
  { id: 'AUDITOR', name: 'Auditor', enabled: true, locked: true, action: 'final_audit', retry_limit: 0, prompt: 'Auditoria final de QA basada en evidencia. Contrasta cada resultado esperado con validaciones, DOM, URL y capturas identificadas por paso e intento. No inventes hechos ni declares FAILED por evidencia ambigua: usa BLOCKED y solicita la evidencia faltante. Toda conclusion debe citar evidence_refs. Responde solo JSON con status, reason, confidence, evidence_refs, failed_expectations, missing_evidence y contradictions.' },
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
  context_window_tokens: 8192,
  max_completion_tokens: 4096,
  max_parallel_ai_runs: 1,
  token_cost_prompt_per_1k: 0,
  token_cost_completion_per_1k: 0,
  token_cost_per_1k: 0.01,
  model_capabilities: {},
  model_catalog: [],
  provider_api_keys: {},
  provider_api_key_configured: false,
  provider_api_key_source: null,
  auto_scan_enabled: false,
  last_model_scan_at: null,
  last_model_scan_status: null,
  last_model_scan_requires_api_key: false,
  last_model_scan_api_key_env: null,
  last_model_scan_api_key_configured: false,
  active_provider_profile_id: null,
  agent_workflow: defaultAgentWorkflow,
  active_workflow_id: null,
  active_workflow_ids: {},
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

export type AiProviderOption = {
  value: string
  label: string
  kind: 'local' | 'cloud' | 'compatible'
  defaultEndpoint: string
  defaultModel: string
  scan: string
  requiresApiKey: boolean
  apiKeyEnv?: string
}

export const aiProviderOptions: AiProviderOption[] = [
  { value: 'opencode', label: 'OpenCode', kind: 'compatible', defaultEndpoint: 'http://127.0.0.1:4096', defaultModel: '', scan: 'Catalogo OpenCode de la cuenta (incluye Zen/Go autorizados)', requiresApiKey: true, apiKeyEnv: undefined },
  { value: 'lm-studio', label: 'LM Studio', kind: 'local', defaultEndpoint: 'http://127.0.0.1:1234/v1', defaultModel: 'lm-studio', scan: 'Auto-scan local OpenAI /models', requiresApiKey: false },
  { value: 'ollama', label: 'Ollama', kind: 'local', defaultEndpoint: 'http://127.0.0.1:11434/v1', defaultModel: 'llama3', scan: 'Auto-scan local Ollama /api/tags', requiresApiKey: false },
  { value: 'openai-compatible', label: 'OpenAI Compatible', kind: 'compatible', defaultEndpoint: 'http://127.0.0.1:1234/v1', defaultModel: 'gpt-4o-mini', scan: 'Auto-scan /models si el endpoint lo permite', requiresApiKey: false },
  { value: 'openai', label: 'OpenAI', kind: 'cloud', defaultEndpoint: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', scan: 'Catalogo preset + key por entorno', requiresApiKey: true, apiKeyEnv: 'OPENAI_API_KEY' },
  { value: 'gemini', label: 'Google Gemini', kind: 'cloud', defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.0-flash', scan: 'Catalogo preset + key por entorno', requiresApiKey: true, apiKeyEnv: 'GEMINI_API_KEY' },
  { value: 'anthropic', label: 'Anthropic Claude', kind: 'cloud', defaultEndpoint: 'https://api.anthropic.com/v1', defaultModel: 'claude-3-5-haiku-latest', scan: 'Catalogo preset + key por entorno', requiresApiKey: true, apiKeyEnv: 'ANTHROPIC_API_KEY' },
  { value: 'openrouter', label: 'OpenRouter', kind: 'cloud', defaultEndpoint: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-4o-mini', scan: 'Catalogo preset + key por entorno', requiresApiKey: true, apiKeyEnv: 'OPENROUTER_API_KEY' },
  { value: 'groq', label: 'Groq', kind: 'cloud', defaultEndpoint: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', scan: 'Catalogo preset + key por entorno', requiresApiKey: true, apiKeyEnv: 'GROQ_API_KEY' },
  { value: 'deepseek', label: 'DeepSeek', kind: 'cloud', defaultEndpoint: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', scan: 'Catalogo preset + key por entorno', requiresApiKey: true, apiKeyEnv: 'DEEPSEEK_API_KEY' },
  { value: 'mistral', label: 'Mistral AI', kind: 'cloud', defaultEndpoint: 'https://api.mistral.ai/v1', defaultModel: 'mistral-small-latest', scan: 'Catalogo preset + key por entorno', requiresApiKey: true, apiKeyEnv: 'MISTRAL_API_KEY' },
  { value: 'together', label: 'Together AI', kind: 'cloud', defaultEndpoint: 'https://api.together.xyz/v1', defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', scan: 'Catalogo preset + key por entorno', requiresApiKey: true, apiKeyEnv: 'TOGETHER_API_KEY' },
  { value: 'cohere', label: 'Cohere', kind: 'cloud', defaultEndpoint: 'https://api.cohere.ai/v1', defaultModel: 'command-r-plus-08-2024', scan: 'Catalogo preset + key por entorno', requiresApiKey: true, apiKeyEnv: 'COHERE_API_KEY' },
  { value: 'fireworks', label: 'Fireworks AI', kind: 'cloud', defaultEndpoint: 'https://api.fireworks.ai/inference/v1', defaultModel: 'accounts/fireworks/models/llama-v3p1-8b-instruct', scan: 'Catalogo preset + key por entorno', requiresApiKey: true, apiKeyEnv: 'FIREWORKS_API_KEY' },
  { value: 'perplexity', label: 'Perplexity', kind: 'cloud', defaultEndpoint: 'https://api.perplexity.ai', defaultModel: 'sonar-pro', scan: 'Catalogo preset + key por entorno', requiresApiKey: true, apiKeyEnv: 'PERPLEXITY_API_KEY' },
  { value: 'xai', label: 'xAI', kind: 'cloud', defaultEndpoint: 'https://api.x.ai/v1', defaultModel: 'grok-3-mini', scan: 'Catalogo preset + key por entorno', requiresApiKey: true, apiKeyEnv: 'XAI_API_KEY' },
  { value: 'azure-openai', label: 'Azure OpenAI', kind: 'cloud', defaultEndpoint: 'https://<resource>.openai.azure.com/openai/v1', defaultModel: 'gpt-4o-mini', scan: 'Catalogo preset; el modelo debe coincidir con el deployment', requiresApiKey: true, apiKeyEnv: 'AZURE_OPENAI_API_KEY' },
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
  if (config?.provider === 'opencode' || config?.ai_execution_driver === 'opencode') return 'opencode'
  const endpoint = String(config?.llm_endpoint || '').toLowerCase()
  if (endpoint.includes(':1234')) return 'lm-studio'
  if (endpoint.includes('11434')) return 'ollama'
  if (endpoint.includes('openrouter.ai')) return 'openrouter'
  if (endpoint.includes('api.groq.com')) return 'groq'
  if (endpoint.includes('api.deepseek.com')) return 'deepseek'
  if (endpoint.includes('api.mistral.ai')) return 'mistral'
  if (endpoint.includes('api.together.xyz')) return 'together'
  if (endpoint.includes('api.cohere.ai')) return 'cohere'
  if (endpoint.includes('fireworks.ai')) return 'fireworks'
  if (endpoint.includes('api.perplexity.ai')) return 'perplexity'
  if (endpoint.includes('api.x.ai')) return 'xai'
  if (endpoint.includes('anthropic.com')) return 'anthropic'
  if (endpoint.includes('generativelanguage.googleapis.com')) return 'gemini'
  if (endpoint.includes('openai.azure.com')) return 'azure-openai'
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
