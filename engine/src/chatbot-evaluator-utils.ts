export type ChatbotContext = {
  config: Record<string, any>;
  variables: Record<string, any>;
  dataset?: any[];
  environment?: string;
  baseUrl?: string;
  execution_mode?: 'AUTOMATIZADA' | 'IA' | 'MANUAL';
  conversation_strategy?: 'fixed' | 'profile_goal' | 'manual';
};

export type ChatbotTurnResult = {
  index: number;
  /** Zero-based technical index used by the execution/bug API contract. */
  technical_index?: number;
  role: string;
  message: string;
  /** Frozen expectation used to evaluate this response. */
  expected?: Record<string, any>;
  request: Record<string, any>;
  response?: any;
  responseText?: string;
  statusCode?: number;
  latencyMs?: number;
  assertions: Array<Record<string, any>>;
  status: 'PASSED' | 'FAILED' | 'BLOCKED';
  toolCalls?: any[];
  toolResult?: any;
  toolEvidence?: Array<Record<string, any>>;
  error?: string;
};

export type ChatbotAdapter = 'generic_http' | 'openai_compatible';
export type ChatbotResponseFormat = 'auto' | 'json' | 'text';

const CHATBOT_ADAPTER_ALIASES: Record<string, ChatbotAdapter> = {
  http: 'generic_http',
  generic: 'generic_http',
  generic_http: 'generic_http',
  openai: 'openai_compatible',
  openai_compatible: 'openai_compatible',
};

const variablePattern = /{{\s*([^{}]+?)\s*}}/g;

export function pathValue(source: any, path: string): any {
  const normalized = String(path || '').replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1');
  if (!normalized) return undefined;
  return normalized.split('.').filter(Boolean).reduce((value, key) => value?.[key], source);
}

export function resolveVariable(name: string, context: ChatbotContext, local: Record<string, any> = {}): any {
  const key = String(name || '').trim();
  if (key in local) return local[key];
  const localPath = pathValue(local, key);
  if (localPath !== undefined) return localPath;
  if (key in context.variables) return context.variables[key];
  const normalized = key.toUpperCase();
  const direct = Object.entries(context.variables).find(([candidate]) => candidate.toUpperCase() === normalized);
  if (direct) return direct[1];
  if (key.startsWith('ENV.') || key.startsWith('DATASET.') || key.startsWith('COMPONENT.')) return context.variables[key];
  return pathValue({ ...context.variables, local }, key);
}

export function interpolate(value: any, context: ChatbotContext, local: Record<string, any> = {}): any {
  if (typeof value === 'string') {
    const matches = [...value.matchAll(variablePattern)];
    if (matches.length === 1 && matches[0][0] === value) return resolveVariable(matches[0][1], context, local);
    return value.replace(variablePattern, (_match, name) => String(resolveVariable(name, context, local) ?? ''));
  }
  if (Array.isArray(value)) return value.map(item => interpolate(item, context, local));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item, context, local)]));
  return value;
}

export function coerceFixture(value: any): any {
  if (typeof value === 'string') {
    const raw = value.trim();
    if (raw.toLowerCase() === 'true' || raw.toLowerCase() === 'false') return raw.toLowerCase() === 'true';
    if (/^-?\d+$/.test(raw)) return Number(raw);
    if (/^-?\d+\.\d+$/.test(raw)) return Number(raw);
    if (raw.startsWith('{') || raw.startsWith('[')) {
      try { return JSON.parse(raw); } catch { return value; }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(coerceFixture);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, coerceFixture(item)]));
  return value;
}

export function resolveEndpoint(config: Record<string, any>, context: ChatbotContext): string {
  const connection = config.connection || {};
  const explicit = String(connection.endpoint || config.endpoint || connection.url || config.url || '').trim();
  const base = String(connection.base_url || config.base_url || context.baseUrl || resolveVariable('ENV.BASE_URL', context) || '').trim().replace(/\/$/, '');
  if (/^https?:\/\//i.test(explicit)) return explicit;
  if (normalizeChatbotAdapter(connection.adapter || config.adapter) === 'openai_compatible' && !explicit && base) {
    if (base.endsWith('/chat/completions')) return base;
    return base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  }
  if (!base && explicit) return explicit;
  return explicit ? `${base}/${explicit.replace(/^\//, '')}` : base;
}

export function normalizeChatbotAdapter(value: any): ChatbotAdapter {
  const key = String(value || 'http').trim().toLowerCase().replace(/-/g, '_');
  return CHATBOT_ADAPTER_ALIASES[key] || 'generic_http';
}

export function normalizeResponseFormat(value: any): ChatbotResponseFormat {
  const format = String(value || 'auto').trim().toLowerCase();
  return format === 'json' || format === 'text' ? format : 'auto';
}

export function responseMapping(config: Record<string, any>): Record<string, any> {
  const connection = config.connection || {};
  return connection.response_mapping || connection.responseMapping || config.response_mapping || config.responseMapping || {};
}

export function responseFormat(config: Record<string, any>): ChatbotResponseFormat {
  return normalizeResponseFormat(responseMapping(config).response_format);
}

export function connectionTimeoutMs(config: Record<string, any>): number {
  const connection = config.connection || {};
  const requested = Number(connection.timeout_ms ?? config.timeout_ms ?? 30_000);
  return Math.max(500, Math.min(120_000, Number.isFinite(requested) ? requested : 30_000));
}

export function connectionRetries(config: Record<string, any>): number {
  const connection = config.connection || {};
  const requested = Number(connection.retries ?? config.retries ?? 0);
  return Math.max(0, Math.min(3, Number.isFinite(requested) ? requested : 0));
}

export function parseResponseBody(text: string, format: ChatbotResponseFormat = 'auto'): { value: any; valid: boolean; type: 'json' | 'text'; error?: string } {
  if (format === 'text') {
    return { value: text, valid: Boolean(text.trim()), type: 'text' };
  }
  if (!text.trim()) {
    return { value: null, valid: false, type: 'json', error: 'La respuesta está vacía; se esperaba JSON.' };
  }
  try {
    return { value: JSON.parse(text), valid: true, type: 'json' };
  } catch {
    if (format === 'auto') return { value: text, valid: true, type: 'text' };
    return { value: text, valid: false, type: 'text', error: 'La respuesta no es JSON válido para el formato configurado json.' };
  }
}

export function extractResponseMessage(response: any, config: Record<string, any>, responseType: 'json' | 'text' = typeof response === 'string' ? 'text' : 'json'): { message: string; error?: string } {
  const mapping = responseMapping(config);
  const format = responseFormat(config);
  const configuredPath = String(mapping.message_path || config.message_path || '').trim();
  if (format === 'text' || (format === 'auto' && responseType === 'text')) {
    if (typeof response === 'string' && response.trim()) return { message: response };
    return { message: '', error: 'La respuesta no contiene texto para el formato configurado text.' };
  }
  if (format === 'json' && typeof response === 'string') {
    return { message: '', error: 'La respuesta no es JSON válido para el formato configurado json.' };
  }
  const paths = [
    ...(configuredPath ? [configuredPath] : []),
    ...(normalizeChatbotAdapter(config.connection?.adapter || config.adapter) === 'openai_compatible' ? ['choices.0.message.content'] : []),
    'message', 'answer', 'reply', 'output', 'data.message',
  ];
  if (configuredPath) {
    const configuredValue = pathValue(response, configuredPath);
    if (configuredValue === undefined || configuredValue === null || (typeof configuredValue === 'string' && !configuredValue.trim())) {
      return { message: '', error: `No se pudo extraer el mensaje configurado desde response_mapping.message_path='${configuredPath}'.` };
    }
  }
  for (const path of paths) {
    const value = pathValue(response, path);
    if (value !== undefined && value !== null && (typeof value !== 'string' || value.trim())) {
      return { message: typeof value === 'string' ? value : JSON.stringify(value) };
    }
  }
  return { message: '', error: configuredPath
    ? `No se pudo extraer el mensaje configurado desde response_mapping.message_path='${configuredPath}'.`
    : 'No se pudo extraer un mensaje de la respuesta JSON. Configurá response_mapping.message_path.' };
}

export function responseMessage(response: any, config: Record<string, any>, responseType: 'json' | 'text' = typeof response === 'string' ? 'text' : 'json'): string {
  const extracted = extractResponseMessage(response, config, responseType);
  if (extracted.message) return extracted.message;
  return typeof response === 'string' ? response : JSON.stringify(response ?? '');
}

export function matchesExpected(actual: any, expected: any): boolean {
  if (expected === undefined) return true;
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.every((item, index) => matchesExpected(actual[index], item));
  if (expected && typeof expected === 'object') return Boolean(actual && typeof actual === 'object') && Object.entries(expected).every(([key, value]) => matchesExpected(actual[key], value));
  return actual === expected;
}

export type JsonSchemaValidationResult = { valid: boolean; errors: string[] };

const JSON_SCHEMA_MAX_DEPTH = 20;
const JSON_SCHEMA_MAX_ERRORS = 25;

/** Validates the bounded JSON Schema subset supported by test contracts. */
export function validateJsonSchema(value: any, schema: any, path = '$', depth = 0): JsonSchemaValidationResult {
  const errors: string[] = [];
  const add = (message: string) => { if (errors.length < JSON_SCHEMA_MAX_ERRORS) errors.push(`${path} ${message}`); };
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return { valid: false, errors: [`${path} el esquema debe ser un objeto JSON`] };
  if (depth > JSON_SCHEMA_MAX_DEPTH) return { valid: false, errors: [`${path} profundidad máxima del esquema excedida`] };
  const typeMatches = (expectedType: string): boolean => {
    if (expectedType === 'null') return value === null;
    if (expectedType === 'array') return Array.isArray(value);
    if (expectedType === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
    if (expectedType === 'integer') return typeof value === 'number' && Number.isInteger(value);
    if (expectedType === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (expectedType === 'boolean') return typeof value === 'boolean';
    if (expectedType === 'string') return typeof value === 'string';
    return true;
  };
  if (schema.const !== undefined && !Object.is(value, schema.const)) add(`debe ser exactamente ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate: any) => Object.is(candidate, value))) add('no coincide con enum');
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some((type: any) => typeMatches(String(type)))) add(`tipo inválido; esperado ${types.join(' | ')}`);
  if (typeof value === 'string') {
    if (Number.isFinite(schema.minLength) && value.length < Number(schema.minLength)) add(`debe tener al menos ${schema.minLength} caracteres`);
    if (Number.isFinite(schema.maxLength) && value.length > Number(schema.maxLength)) add(`debe tener como máximo ${schema.maxLength} caracteres`);
    if (schema.pattern !== undefined) { try { if (!new RegExp(String(schema.pattern)).test(value)) add('no coincide con pattern'); } catch { add('contiene un pattern inválido'); } }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Number.isFinite(schema.minimum) && value < Number(schema.minimum)) add(`debe ser mayor o igual que ${schema.minimum}`);
    if (Number.isFinite(schema.maximum) && value > Number(schema.maximum)) add(`debe ser menor o igual que ${schema.maximum}`);
    if (Number.isFinite(schema.exclusiveMinimum) && value <= Number(schema.exclusiveMinimum)) add(`debe ser mayor que ${schema.exclusiveMinimum}`);
    if (Number.isFinite(schema.exclusiveMaximum) && value >= Number(schema.exclusiveMaximum)) add(`debe ser menor que ${schema.exclusiveMaximum}`);
  }
  if (Array.isArray(value)) {
    if (Number.isFinite(schema.minItems) && value.length < Number(schema.minItems)) add(`debe tener al menos ${schema.minItems} elementos`);
    if (Number.isFinite(schema.maxItems) && value.length > Number(schema.maxItems)) add(`debe tener como máximo ${schema.maxItems} elementos`);
    if (schema.uniqueItems === true && new Set(value.map(item => JSON.stringify(item))).size !== value.length) add('no debe contener elementos repetidos');
    if (schema.items && typeof schema.items === 'object') value.forEach((item, index) => {
      const result = validateJsonSchema(item, schema.items, `${path}[${index}]`, depth + 1);
      errors.push(...result.errors.slice(0, JSON_SCHEMA_MAX_ERRORS - errors.length));
    });
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties) ? schema.properties : {};
    for (const required of Array.isArray(schema.required) ? schema.required : []) if (typeof required === 'string' && !(required in value)) add(`falta la propiedad requerida '${required}'`);
    for (const [key, childSchema] of Object.entries(properties)) if (key in value) {
      const result = validateJsonSchema(value[key], childSchema, `${path}.${key}`, depth + 1);
      errors.push(...result.errors.slice(0, JSON_SCHEMA_MAX_ERRORS - errors.length));
    }
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!(key in properties)) add(`no permite la propiedad adicional '${key}'`);
  }
  if (Array.isArray(schema.allOf)) for (const child of schema.allOf) {
    const result = validateJsonSchema(value, child, path, depth + 1);
    errors.push(...result.errors.slice(0, JSON_SCHEMA_MAX_ERRORS - errors.length));
  }
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((child: any) => validateJsonSchema(value, child, path, depth + 1).valid)) add('no coincide con ninguna alternativa anyOf');
  if (Array.isArray(schema.oneOf) && schema.oneOf.filter((child: any) => validateJsonSchema(value, child, path, depth + 1).valid).length !== 1) add('debe coincidir con exactamente una alternativa oneOf');
  return { valid: errors.length === 0, errors: errors.slice(0, JSON_SCHEMA_MAX_ERRORS) };
}

export function normalizeToolContract(value: any): Record<string, any> {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const legacyRequired = source.require_observable === true;
  const rawObservation = source.observation && typeof source.observation === 'object' ? source.observation : {};
  const requestedMode = String(rawObservation.mode || (legacyRequired ? 'response_payload' : 'black_box')).toLowerCase();
  const mode = ['response_payload', 'black_box', 'external_trace'].includes(requestedMode) ? requestedMode : 'black_box';
  const observation = { ...rawObservation, mode, required: rawObservation.required ?? legacyRequired };
  return { ...source, observation, require_observable: mode === 'response_payload' && observation.required === true };
}

function compare(actual: any, assertion: Record<string, any>): boolean {
  const expected = assertion.expected ?? assertion.value ?? assertion.equals;
  const operation = String(assertion.operator || assertion.op || assertion.type || 'contains').toLowerCase();
  if (operation === 'exists') return actual !== undefined && actual !== null;
  if (operation === 'equals' || operation === 'eq') return actual === expected;
  if (operation === 'not_equals' || operation === 'neq') return actual !== expected;
  if (operation === 'regex') { try { return new RegExp(String(expected)).test(String(actual ?? '')); } catch { return false; } }
  if (operation === 'not_contains' || operation === 'does_not_contain') return !String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
  if (operation === 'json_path' || operation === 'jsonpath') return compare(pathValue(actual, String(assertion.path || assertion.json_path || '')), { ...assertion, operator: assertion.inner_operator || 'contains' });
  if (operation === 'json_schema' || operation === 'schema') return validateJsonSchema(actual, assertion.schema || expected).valid;
  return String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
}

export function evaluateAssertions(turn: ChatbotTurnResult, assertions: any[], response: any): Array<Record<string, any>> {
  return (Array.isArray(assertions) ? assertions : []).map((raw: any) => {
    const assertion = raw && typeof raw === 'object' ? raw : { expected: raw };
    const source = String(assertion.source || assertion.path || 'message').toLowerCase();
    const actual = source === 'message' ? turn.responseText : pathValue(response, assertion.path || source);
    return { ...assertion, actual, passed: compare(actual, assertion) };
  });
}

export function normalizeChatbotConfig(raw: Record<string, any>): Record<string, any> {
  const config = raw && typeof raw === 'object' ? raw : {};
  const connection = config.connection && typeof config.connection === 'object' ? { ...config.connection } : { adapter: 'http', endpoint: config.endpoint || config.url || '', base_url: config.base_url, method: String(config.method || 'POST').toUpperCase(), headers: config.headers || {}, request_template: config.request_template || config.request_body || {}, response_mapping: config.response_mapping || config.responseMapping || {}, timeout_ms: config.timeout_ms ?? 30000, retries: config.retries ?? 0 };
  connection.adapter = normalizeChatbotAdapter(connection.adapter || config.adapter);
  connection.method = String(connection.method || 'POST').toUpperCase(); connection.headers ||= {};
  const mapping = connection.response_mapping || connection.responseMapping || config.response_mapping || config.responseMapping || {};
  connection.response_mapping = mapping && typeof mapping === 'object' && !Array.isArray(mapping) ? { ...mapping } : {};
  connection.response_mapping.response_format = normalizeResponseFormat(connection.response_mapping.response_format);
  connection.timeout_ms ??= 30000; connection.retries ??= 0;
  const legacyTurns = Array.isArray(config.turns || config.turnos) ? (config.turns || config.turnos) : [];
  const conversation = config.conversation && typeof config.conversation === 'object' ? { ...config.conversation } : {};
  const opening = conversation.opening_message && typeof conversation.opening_message === 'object' ? { ...conversation.opening_message } : (config.opening_message || config.initial_message || config.mensaje_inicial ? { mode: 'fixed', text: config.opening_message || config.initial_message || config.mensaje_inicial } : {});
  const rawTurns = Array.isArray(conversation.turns) ? conversation.turns : legacyTurns;
  const turns = rawTurns.map((turn: any, index: number) => ({
    ...turn,
    order: turn?.order || index + 1,
    role: turn?.role || 'user',
    input: turn?.input && typeof turn.input === 'object'
      ? { ...turn.input, mode: turn.input.mode || turn.input_mode || 'fixed', text: turn.input.text ?? turn.message ?? turn.content ?? turn.mensaje ?? '' }
      : { mode: turn?.input_mode || 'fixed', text: turn?.message ?? turn?.content ?? turn?.mensaje ?? '' },
    expected: { ...(turn?.expected && typeof turn.expected === 'object' ? turn.expected : {}), ...(turn?.semantic !== undefined ? { semantic: turn.semantic } : {}) },
    assertions: Array.isArray(turn?.assertions) ? turn.assertions : [],
  }));
  const evaluation = config.evaluation && typeof config.evaluation === 'object' ? { ...config.evaluation } : {};
  const deterministic = evaluation.deterministic && typeof evaluation.deterministic === 'object' ? { ...evaluation.deterministic } : {};
  const legacySecurity = config.security || config.seguridad || {};
  deterministic.forbidden_patterns ||= legacySecurity.forbidden_response_patterns || []; deterministic.required_validations ||= [];
  const semantic = evaluation.semantic && typeof evaluation.semantic === 'object' ? { ...evaluation.semantic } : {};
  const legacyJudge = evaluation.llm_judge || config.llm_judge || {};
  if (legacyJudge && Object.keys(legacyJudge).length) { semantic.enabled ??= legacyJudge.enabled ?? false; semantic.criteria ||= legacyJudge.criteria || legacyJudge.rubric || []; semantic.minimum_score ??= Number(legacyJudge.min_score ?? 0.8) > 1 ? Number(legacyJudge.min_score) / 100 : Number(legacyJudge.min_score ?? 0.8); }
  semantic.enabled ??= false; semantic.criteria ||= []; semantic.minimum_score ??= 0.8;
  return { ...config, schema_version: 2, connection, profile: config.profile || config.perfil || {}, conversation: { session_mode: conversation.session_mode || config.session_mode || 'reuse', opening_message: opening, turns, memory_checks: conversation.memory_checks || config.memory_checks || [], generation: conversation.generation || config.generation || {}, max_turns: conversation.max_turns || config.max_turns }, tools: (Array.isArray(config.tools) ? config.tools : (config.tool_contracts || [])).map(normalizeToolContract), evaluation: { ...evaluation, deterministic, semantic } };
}

export function configuredTurns(config: Record<string, any>): any[] {
  const conversation = config.conversation || {}; const opening = conversation.opening_message || {}; const turns = Array.isArray(conversation.turns) ? conversation.turns : [];
  // Explicit turns are canonical. The legacy opening is only materialized
  // when no ordered turns exist, otherwise it would execute twice.
  if (turns.length) return turns;
  return opening.text ? [{ order: 1, role: 'user', input: opening, assertions: opening.assertions || [], expected: opening.expected }] : [];
}

export function generatedTurns(config: Record<string, any>): any[] {
  const conversation = config.conversation || {}; const generation = conversation.generation && typeof conversation.generation === 'object' ? conversation.generation : {}; const templates = Array.isArray(conversation.turns) ? conversation.turns : [];
  // If the author supplied turn templates but no explicit generation limit,
  // preserve that test boundary. Falling back to eight turns made a short
  // conversational case unexpectedly call the local reasoning model many
  // times and made evaluation depend on token exhaustion.
  const inferredMaxTurns = templates.length > 0 ? templates.length : 8;
  const requested = Number(generation.max_turns ?? conversation.max_turns ?? config.max_turns ?? inferredMaxTurns); const maxTurns = Math.max(1, Math.min(20, Number.isFinite(requested) ? requested : inferredMaxTurns));
  return Array.from({ length: maxTurns }, (_, index) => { const template = templates[index] || {}; return { order: index + 1, role: template.role || 'user', input: { mode: 'profile_generated', text: generation.instruction || 'Continúa la conversación de forma natural hasta cumplir el objetivo del perfil.', temperature: generation.temperature ?? config.temperature ?? 0 }, expected: template.expected && typeof template.expected === 'object' ? template.expected : {}, assertions: Array.isArray(template.assertions) ? template.assertions : [] }; });
}

export function expectedAssertions(turn: any): any[] {
  const expected = turn?.expected && typeof turn.expected === 'object' ? turn.expected : {}; const assertions = Array.isArray(turn?.assertions) ? [...turn.assertions] : [];
  for (const value of expected.must_include || []) assertions.push({ source: 'message', operator: 'contains', expected: value, rule: 'must_include' });
  for (const value of expected.must_not_include || []) assertions.push({ source: 'message', operator: 'not_contains', expected: value, rule: 'must_not_include' });
  if (expected.regex) assertions.push({ source: 'message', operator: 'regex', expected: expected.regex, rule: 'regex' });
  return assertions;
}
