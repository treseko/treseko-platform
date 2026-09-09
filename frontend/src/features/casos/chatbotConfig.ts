export const chatbotDefaultConfig = {
  schema_version: 2,
  connection: {
    adapter: 'http',
    endpoint: '',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    request_template: {
      message: '{{turn.message}}',
      session_id: '{{session.id}}',
      conversation: '{{conversation.history}}',
      variables: '{{resolved.variables}}',
    },
    response_mapping: { response_format: 'auto', message_path: '$.answer', session_id_path: '$.session_id', tool_calls_path: '$.treseko.tool_calls' },
    timeout_ms: 30000,
    retries: 0,
  },
  profile: { name: '', age: '', gender: 'no especificado', language: 'es', writing_level: 'medium', spelling_errors: false, tone: 'neutral', goal: '' },
  conversation: { session_mode: 'reuse', opening_message: { mode: 'fixed', text: '' }, turns: [], memory_checks: [] },
  tools: [],
  evaluation: {
    deterministic: { required_validations: ['response_not_empty'], forbidden_patterns: [] },
    semantic: { enabled: true, criteria: ['kindness', 'clarity', 'context_consistency', 'goal_completion'], minimum_score: 0.8 },
  },
}

export type ChatbotConnectionPresetId = 'generic_http' | 'openai_compatible' | 'text_http'

export const chatbotConnectionPresets: Array<{
  id: ChatbotConnectionPresetId
  labelKey: string
  descriptionKey: string
  connection: Record<string, any>
}> = [
  {
    id: 'generic_http',
    labelKey: 'casos.connectionPresetGenericHttp',
    descriptionKey: 'casos.connectionPresetGenericHttpHelp',
    connection: {
      adapter: 'generic_http',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      request_template: { message: '{{turn.message}}', session_id: '{{session.id}}', conversation: '{{conversation.history}}', variables: '{{resolved.variables}}' },
      response_mapping: { response_format: 'json', message_path: '$.answer', session_id_path: '$.session_id' },
    },
  },
  {
    id: 'openai_compatible',
    labelKey: 'casos.connectionPresetOpenAi',
    descriptionKey: 'casos.connectionPresetOpenAiHelp',
    connection: {
      adapter: 'openai_compatible',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      request_template: { messages: '{{conversation.messages}}', session_id: '{{session.id}}', variables: '{{resolved.variables}}' },
      response_mapping: { response_format: 'json', message_path: '$.choices[0].message.content', session_id_path: '' },
    },
  },
  {
    id: 'text_http',
    labelKey: 'casos.connectionPresetTextHttp',
    descriptionKey: 'casos.connectionPresetTextHttpHelp',
    connection: {
      adapter: 'generic_http',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      request_template: { message: '{{turn.message}}' },
      response_mapping: { response_format: 'text', message_path: '', session_id_path: '' },
    },
  },
]

export function normalizeChatbotAdapter(value: any): 'generic_http' | 'openai_compatible' {
  return String(value || '').toLowerCase() === 'openai_compatible' ? 'openai_compatible' : 'generic_http'
}

export function connectionPresetForConfig(connection: any): ChatbotConnectionPresetId {
  const normalized = normalizeChatbotAdapter(connection?.adapter)
  if (normalized === 'openai_compatible') return 'openai_compatible'
  const format = String(connection?.response_mapping?.response_format || '').toLowerCase()
  return format === 'text' ? 'text_http' : 'generic_http'
}

/** Apply a preset without replacing case headers, tokens, or other user values. */
export function applyConnectionPreset(config: any, presetId: ChatbotConnectionPresetId): Record<string, any> {
  const source = asObject(config)
  const current = asObject(source.connection)
  const preset = chatbotConnectionPresets.find(item => item.id === presetId) || chatbotConnectionPresets[0]
  const headers = { ...asObject(current.headers) }
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'content-type') delete headers[key]
  }
  return {
    ...source,
    connection: {
      ...current,
      ...preset.connection,
      headers: { ...headers, ...asObject(preset.connection.headers) },
      response_mapping: { ...asObject(current.response_mapping), ...asObject(preset.connection.response_mapping) },
    },
  }
}

export const chatbotProfilePresets = [
  {
    id: 'usuario_mayor',
    name: 'Usuario mayor',
    description: 'Poca experiencia digital y escritura simple.',
    profile: { name: 'Jorge', age: 65, gender: 'no especificado', language: 'es', writing_level: 'low', spelling_errors: true, tone: 'confused', goal: '' },
  },
  {
    id: 'cliente_molesto',
    name: 'Cliente molesto',
    description: 'Busca una solución rápida y expresa frustración.',
    profile: { name: '', age: '', gender: 'no especificado', language: 'es', writing_level: 'medium', spelling_errors: false, tone: 'frustrated', goal: '' },
  },
  {
    id: 'usuario_experto',
    name: 'Usuario experto',
    description: 'Escribe con precisión y utiliza términos técnicos.',
    profile: { name: '', age: '', gender: 'no especificado', language: 'es', writing_level: 'high', spelling_errors: false, tone: 'formal', goal: '' },
  },
  {
    id: 'usuario_novato',
    name: 'Usuario novato',
    description: 'Necesita instrucciones paso a paso y confirma sus dudas.',
    profile: { name: '', age: '', gender: 'no especificado', language: 'es', writing_level: 'low', spelling_errors: true, tone: 'confused', goal: '' },
  },
  {
    id: 'usuario_apresurado',
    name: 'Usuario apresurado',
    description: 'Escribe mensajes breves y espera una respuesta directa.',
    profile: { name: '', age: '', gender: 'no especificado', language: 'es', writing_level: 'medium', spelling_errors: false, tone: 'neutral', goal: '' },
  },
]

export const chatbotToolObservationModes = {
  response_payload: 'Verificar en la respuesta de la API',
  black_box: 'Evaluar sólo la respuesta final',
  external_trace: 'Trazabilidad externa — próximamente',
} as const

export function normalizeToolContract(value: any): Record<string, any> {
  const source = asObject(value)
  const legacyRequired = source.require_observable === true
  const rawObservation = asObject(source.observation)
  const requestedMode = String(rawObservation.mode || (legacyRequired ? 'response_payload' : 'black_box')).toLowerCase()
  const mode = Object.prototype.hasOwnProperty.call(chatbotToolObservationModes, requestedMode)
    ? requestedMode
    : 'black_box'
  const observation = {
    ...rawObservation,
    mode,
    required: rawObservation.required ?? legacyRequired,
  }
  return {
    ...source,
    observation,
    require_observable: mode === 'response_payload' && observation.required === true,
  }
}

const asObject = (value: any) => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const asArray = (value: any) => Array.isArray(value) ? value : []
const coerceVariable = (value: any) => {
  if (typeof value !== 'string') return value
  const raw = value.trim()
  if (raw.toLowerCase() === 'true') return true
  if (raw.toLowerCase() === 'false') return false
  if (raw && ['{', '['].includes(raw[0])) {
    try { return JSON.parse(raw) } catch { /* keep the original value */ }
  }
  if (raw !== '' && Number.isFinite(Number(raw))) return Number(raw)
  return value
}

export function normalizeReusableProfiles(value: any): Array<{ id: string, name: string, description?: string, profile: Record<string, any> }> {
  const entries = Array.isArray(value)
    ? value
    : Object.entries(asObject(value)).map(([id, profile]) => ({ id, name: id, profile }))
  return entries.filter(item => item && typeof item === 'object').map((item: any, index) => {
    const name = String(item.name || item.label || item.id || `Perfil ${index + 1}`).trim()
    const id = String(item.id || name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `profile_${index + 1}`
    const profile = asObject(item.profile || item.values || item.perfil || Object.fromEntries(Object.entries(item).filter(([key]) => !['id', 'name', 'label', 'description', 'profile', 'values', 'perfil'].includes(key))))
    return { id, name, description: String(item.description || '').trim(), profile }
  })
}

export function normalizeEnvironmentChatbotConfig(value: any): Record<string, any> {
  const source = asObject(value)
  if (!Object.keys(source).length) return {}
  const rawConnection = asObject(source.connection)
  const connection = {
    adapter: normalizeChatbotAdapter(rawConnection.adapter || source.adapter),
    endpoint: rawConnection.endpoint ?? source.endpoint ?? '',
    base_url: rawConnection.base_url ?? source.base_url,
    model: rawConnection.model ?? source.model,
    method: rawConnection.method || source.method || 'POST',
    headers: { ...asObject(source.headers), ...asObject(rawConnection.headers) },
    request_template: { ...asObject(source.request_template), ...asObject(rawConnection.request_template) },
    response_mapping: { ...asObject(source.response_mapping), ...asObject(rawConnection.response_mapping) },
    timeout_ms: rawConnection.timeout_ms ?? source.timeout_ms ?? 30000,
    retries: rawConnection.retries ?? source.retries ?? 0,
  }
  const profiles = normalizeReusableProfiles(source.profiles || source.perfiles)
  return {
    schema_version: 1,
    connection,
    profile_bindings: asObject(source.profile_bindings || source.profileBindings),
    profiles: profiles.length ? profiles : chatbotProfilePresets,
    default_profile: source.default_profile || source.defaultProfile || (profiles[0]?.id || chatbotProfilePresets[0]?.id),
  }
}

export function mergeChatbotConfig(environmentValue: any, caseValue: any): Record<string, any> {
  const environment = normalizeEnvironmentChatbotConfig(environmentValue)
  const source = asObject(caseValue)
  if (!Object.keys(source).length) return environment
  const result: Record<string, any> = JSON.parse(JSON.stringify(environment))
  const rawConnection = asObject(source.connection)
  const legacyKeys = ['adapter', 'endpoint', 'url', 'base_url', 'model', 'method', 'headers', 'request_template', 'request_body', 'response_mapping', 'responseMapping', 'timeout_ms', 'retries']
  const explicitConnection = { ...rawConnection, ...Object.fromEntries(legacyKeys.filter(key => key in source).map(key => [key, source[key]])) }
  if (Object.keys(explicitConnection).length) {
    const current = asObject(result.connection)
    result.connection = {
      ...current,
      ...explicitConnection,
      ...(explicitConnection.headers ? { headers: { ...asObject(current.headers), ...asObject(explicitConnection.headers) } } : {}),
      ...(explicitConnection.response_mapping ? { response_mapping: { ...asObject(current.response_mapping), ...asObject(explicitConnection.response_mapping) } } : {}),
    }
    if (explicitConnection.request_body && !explicitConnection.request_template) result.connection.request_template = explicitConnection.request_body
  }
  if (source.profile && typeof source.profile === 'object') result.profile = { ...asObject(result.profile), ...source.profile }
  if (source.profile_id || source.profile_ref) result.profile_id = source.profile_id || source.profile_ref
  if (source.conversation || source.turns || source.turnos || source.opening_message || source.initial_message || source.mensaje_inicial) {
    result.conversation = normalizeChatbotConfig(source).conversation
  }
  if (source.tools || source.tool_contracts) result.tools = asArray(source.tools || source.tool_contracts)
  if (source.evaluation) result.evaluation = normalizeChatbotConfig(source).evaluation
  if (source.workflow || source.workflow_override || source.workflow_id || source.workflow_version) {
    for (const key of ['workflow', 'workflow_override', 'workflow_id', 'workflow_version']) if (key in source) result[key] = source[key]
  }
  return result
}

export function resolveChatbotProfile(config: any, environment: any, dataset: any, component: any): { profile: Record<string, any>, missing: string[] } {
  const variables = {
    ...(environment?.variables || {}),
    ...(component?.variables || {}),
    ...(dataset?.variables || {}),
  }
  const find = (name: string) => {
    const candidates = name.includes('.') ? [name] : [name, `DATASET.${name}`, `ENV.${name}`, `COMPONENT.${name}`]
    const entry = Object.entries(variables).find(([key]) => candidates.some(candidate => key === candidate || key.toLowerCase() === candidate.toLowerCase()))
    return entry ? { found: true, value: entry[1] } : { found: false, value: undefined }
  }
  const selectedId = config?.profile_id || config?.default_profile
  const selectedPreset = normalizeReusableProfiles(config?.profiles).find(item => item.id === selectedId)
  const profile: Record<string, any> = { ...(selectedPreset?.profile || {}) }
  const missing: string[] = []
  for (const [field, variableName] of Object.entries(asObject(config?.profile_bindings))) {
    if (typeof variableName !== 'string' || !variableName.trim()) continue
    const result = find(variableName)
    if (result.found) profile[field] = coerceVariable(result.value)
    else missing.push(variableName)
  }
  return { profile: { ...profile, ...asObject(config?.profile) }, missing: Array.from(new Set(missing)) }
}

export function normalizeChatbotConfig(value: any): Record<string, any> {
  const source = asObject(value)
  const legacyTurns = asArray(source.turns || source.turnos)
  const rawConversation = asObject(source.conversation)
  const rawTurns = Array.isArray(rawConversation.turns) ? rawConversation.turns : legacyTurns
  const opening = asObject(rawConversation.opening_message).text !== undefined
    ? { mode: rawConversation.opening_message.mode || 'fixed', text: rawConversation.opening_message.text || '' }
    : source.opening_message || source.initial_message || source.mensaje_inicial
      ? { mode: 'fixed', text: source.opening_message || source.initial_message || source.mensaje_inicial }
      : { ...chatbotDefaultConfig.conversation.opening_message }
  const turns = rawTurns.map((turn: any, index: number) => {
    const expected = asObject(turn.expected)
    const legacySemantic = turn.semantic || turn.expected_response || turn.expectedResponse || turn.expected_text
    if (legacySemantic && !expected.semantic) expected.semantic = legacySemantic
    return {
      order: Number(turn.order || index + 1),
      role: turn.role || 'user',
      input: { mode: turn.input?.mode || turn.input_mode || 'fixed', text: turn.input?.text ?? turn.message ?? turn.content ?? turn.mensaje ?? '' },
      expected,
      assertions: asArray(turn.assertions),
    }
  })
  const legacyConnection = {
    adapter: 'http', endpoint: source.endpoint || source.url || '', base_url: source.base_url, model: source.model,
    method: source.method || 'POST', headers: source.headers || {}, request_template: source.request_template || source.request_body || {},
    response_mapping: source.response_mapping || source.responseMapping || {}, timeout_ms: source.timeout_ms || 30000, retries: source.retries ?? 0,
  }
  const connection = { ...legacyConnection, ...asObject(source.connection), headers: { ...legacyConnection.headers, ...asObject(source.connection).headers }, response_mapping: { ...legacyConnection.response_mapping, ...asObject(source.connection).response_mapping } }
  connection.adapter = normalizeChatbotAdapter(connection.adapter)
  const evaluation = asObject(source.evaluation)
  const deterministic = { ...asObject(evaluation.deterministic) }
  const legacySecurity = asObject(source.security || source.seguridad)
  deterministic.forbidden_patterns ||= legacySecurity.forbidden_response_patterns || []
  deterministic.required_validations ||= []
  const semantic = { ...asObject(evaluation.semantic) }
  const legacyJudge = asObject(evaluation.llm_judge || source.llm_judge)
  semantic.enabled ??= legacyJudge.enabled ?? (Object.keys(legacyJudge).length > 0)
  semantic.criteria ||= legacyJudge.criteria || legacyJudge.rubric || chatbotDefaultConfig.evaluation.semantic.criteria
  const oldMinimum = legacyJudge.min_score
  semantic.minimum_score ??= oldMinimum && oldMinimum > 1 ? oldMinimum / 100 : oldMinimum || chatbotDefaultConfig.evaluation.semantic.minimum_score
  return {
    ...source,
    schema_version: 2,
    connection: { ...chatbotDefaultConfig.connection, ...connection, request_template: Object.keys(connection.request_template || {}).length ? connection.request_template : chatbotDefaultConfig.connection.request_template },
    profile: asObject(source.profile || source.perfil),
    conversation: { session_mode: rawConversation.session_mode || source.session_mode || 'reuse', opening_message: opening, turns, memory_checks: rawConversation.memory_checks || source.memory_checks || [] },
    tools: asArray(source.tools || source.tool_contracts).map(normalizeToolContract),
    evaluation: { ...evaluation, deterministic, semantic },
    ...(source.profiles || source.perfiles ? { profiles: normalizeReusableProfiles(source.profiles || source.perfiles) } : {}),
    ...(source.default_profile || source.defaultProfile ? { default_profile: source.default_profile || source.defaultProfile } : {}),
    ...(source.profile_id || source.profile_ref ? { profile_id: source.profile_id || source.profile_ref } : {}),
  }
}

export function cloneChatbotConfig(value: any) {
  return JSON.parse(JSON.stringify(normalizeChatbotConfig(value)))
}

export function cloneRawChatbotConfig(value: any) {
  return JSON.parse(JSON.stringify(asObject(value)))
}

/**
 * Remove the obsolete opening field from old cases. If it was the only input,
 * preserve it as Turno 1; otherwise the existing Turno 1 is already the first
 * message and the opening value is discarded to avoid an extra turn.
 */
export function migrateOpeningMessageToTurn(value: any): Record<string, any> {
  const source = asObject(value)
  const conversation = asObject(source.conversation)
  const opening = asObject(conversation.opening_message).text !== undefined
    ? asObject(conversation.opening_message)
    : typeof source.opening_message === 'string'
      ? { mode: 'fixed', text: source.opening_message }
      : typeof source.initial_message === 'string'
        ? { mode: 'fixed', text: source.initial_message }
        : typeof source.mensaje_inicial === 'string'
          ? { mode: 'fixed', text: source.mensaje_inicial }
          : {}
  const text = String(opening.text || '').trim()
  if (!text) return source
  const turns = Array.isArray(conversation.turns)
    ? conversation.turns
    : Array.isArray(source.turns || source.turnos) ? (source.turns || source.turnos) : []
  const migratedTurns = turns.length > 0 ? turns : [{
      order: 1,
      role: opening.role || 'user',
      input: { mode: opening.mode || 'fixed', text },
      expected: asObject(opening.expected),
      assertions: Array.isArray(opening.assertions) ? opening.assertions : [],
    }]
  return {
    ...cloneRawChatbotConfig(source),
    opening_message: undefined,
    initial_message: undefined,
    mensaje_inicial: undefined,
    conversation: {
      ...conversation,
      opening_message: { mode: 'fixed', text: '' },
      turns: migratedTurns.map((turn: any, index: number) => ({ ...turn, order: index + 1 })),
    },
  }
}
