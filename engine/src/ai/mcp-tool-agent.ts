import { isForbiddenAddress, resolveSafeAddress, createPinnedFetch } from './mcp-secure-transport.ts';
export { isForbiddenAddress } from './mcp-secure-transport.ts';

type Json = Record<string, any>;

export interface McpRuntimeServices {
  resolveCredential(reference: string): Promise<string | undefined>;
  trace(event: Json): void;
  fetchImpl?: typeof fetch;
  resolveHost?: (hostname: string) => Promise<string[]>;
}

export const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_RESULT_BYTES = 64 * 1024;
const MAX_RETRIES = 3;
const SECRET_KEYS = /authorization|api[-_]?key|cookie|credential|password|secret|token|session/i;
const OPAQUE_REFERENCE = /^vault:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;


function safeUrl(value: unknown, allowedHosts: unknown): value is string {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || isForbiddenAddress(url.hostname)) return false;
    if (!Array.isArray(allowedHosts) || !allowedHosts.includes(url.hostname.toLowerCase())) return false;
    return true;
  } catch {
    return false;
  }
}

function scrub(value: unknown, credential = ''): unknown {
  const secretPattern = credential ? new RegExp(credential.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : null;
  if (Array.isArray(value)) return value.slice(0, 32).map((item) => scrub(item, credential));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Json).slice(0, 32).map(([key, item]) => [key, SECRET_KEYS.test(key) ? '[redacted]' : scrub(item, credential)]));
  }
  if (typeof value === 'string') return value.replace(secretPattern || /$^/g, '[redacted]').slice(0, 500);
  return value;
}

function boundedResult(value: unknown, credential: string): unknown {
  const safe = scrub(value, credential);
  const serialized = JSON.stringify(safe);
  const encoder = new TextEncoder();
  if (encoder.encode(serialized).byteLength <= MAX_RESULT_BYTES) return safe;
  const characters = Array.from(serialized);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    const content = characters.slice(0, midpoint).join('');
    const candidate = { truncated: true, content };
    if (encoder.encode(JSON.stringify(candidate)).byteLength <= MAX_RESULT_BYTES) low = midpoint;
    else high = midpoint - 1;
  }
  return { truncated: true, content: characters.slice(0, low).join('') };
}

function sameJson(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown => Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value as Json).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]))
      : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function matchesSchema(schema: Json, args: Json): boolean {
  if (!schema || schema.type !== 'object' || !args || typeof args !== 'object' || Array.isArray(args)) return false;
  const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  if (schema.additionalProperties === false && Object.keys(args).some((key) => !(key in properties))) return false;
  if (!Array.isArray(schema.required) || schema.required.some((key: unknown) => typeof key !== 'string' || !(key in args))) return false;
  return Object.entries(args).every(([key, value]) => {
    const definition = (properties as Json)[key];
    const type = definition?.type;
    if (type === 'string' && (typeof value !== 'string' || (definition.maxLength !== undefined && value.length > definition.maxLength) || (definition.minLength !== undefined && value.length < definition.minLength))) return false;
    if (type === 'array' && (!Array.isArray(value) || (definition.maxItems !== undefined && value.length > definition.maxItems))) return false;
    if (type === 'object' && !Boolean(value && typeof value === 'object' && !Array.isArray(value))) return false;
    if (definition?.const !== undefined && value !== definition.const) return false;
    if (definition?.format === 'uuid' && (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))) return false;
    return type === 'string' || type === 'array' || type === 'object';
  });
}

function containsInlineUnsafeValue(value: unknown, key = ''): boolean {
  if (/^(?:format|formato_prueba|modality|modalidad)$/i.test(key) && String(value).toUpperCase() === 'CONVERSACIONAL') return true;
  if (SECRET_KEYS.test(key) && key !== 'content_base64') return true;
  if (Array.isArray(value)) return value.some((item) => containsInlineUnsafeValue(item, key));
  if (value && typeof value === 'object') return Object.entries(value as Json).some(([name, item]) => containsInlineUnsafeValue(item, name));
  if (typeof value !== 'string') return false;
  return /https?:\/\//i.test(value) || /(^|[\s;&|])(?:rm|curl|wget|bash|sh|python|node|powershell)\b/i.test(value) || /[;&|`$()]\s*/.test(value);
}

async function readBoundedBody(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error('MCP_RESPONSE_TOO_LARGE');
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function request(fetchImpl: typeof fetch, url: string, body: Json, secret: string, timeoutMs: number, expectedId: number, authority: string): Promise<Json> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', 'x-mcp-api-key': secret, host: authority }, body: JSON.stringify(body), signal: controller.signal });
    if (!response.ok) throw new Error(`MCP_HTTP_${response.status}`);
    if (response.url && new URL(response.url).origin !== new URL(url).origin) throw new Error('MCP_UNSAFE_REDIRECT');
    const parsed = JSON.parse(await readBoundedBody(response)) as Json;
    if (parsed?.jsonrpc !== '2.0' || parsed.id !== expectedId || parsed.error || !Object.prototype.hasOwnProperty.call(parsed, 'result')) throw new Error('MCP_INVALID_JSONRPC');
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

export async function executeMcpToolAgent(node: any, input: Json, services?: McpRuntimeServices): Promise<any> {
  const blocked = (reason: string) => {
    const event = { type: 'mcp_tool_blocked', status: 'blocked', reason: reason.slice(0, 160), adapter: 'universal-mcp/v1' };
    try { services?.trace(event); } catch { /* tracing cannot change the security result */ }
    return { status: 'BLOCKED', confidence: 100, reason: event.reason, events: [event] };
  };
  const failed = () => {
    const event = { type: 'mcp_tool_call', status: 'failed', adapter: 'universal-mcp/v1' };
    try { services?.trace(event); } catch { /* tracing cannot change the security result */ }
    return { status: 'FAILED', confidence: 100, reason: 'Fallo controlado de MCP', events: [event] };
  };
  try {
    const config = node?.config_json || node?.config || {};
    const contract = node?.universal_agent?.contract || node?.universalAgent?.contract || {};
    const security = contract.security || {};
    const endpoint = config.mcp_endpoints?.[config.mcp_endpoint_ref];
    const tool = endpoint?.tools?.[config.mcp_tool_ref];
    if (contract.implementation?.native_adapter !== 'universal-mcp/v1' || !contract.capabilities?.includes('integration.mcp_call')) return blocked('Contrato MCP no autorizado');
    if (['allow_private_network', 'allow_filesystem', 'allow_shell', 'allow_arbitrary_code'].some((key) => security[key] !== false)) return blocked('Politica de seguridad MCP invalida');
    if (!endpoint?.admin_allowlisted || !tool || !safeUrl(endpoint.url, endpoint.allowed_hosts) || tool.name !== config.mcp_tool_ref || !tool.input_schema) return blocked('Endpoint o herramienta fuera de la allowlist persistida');
    if (tool.operation === 'read' && tool.read_only !== true) return blocked('La metadata de lectura MCP es contradictoria');
    const operation = tool.operation;
    const governed = operation === 'preview' || operation === 'commit' || operation === 'rollback';
    if (!governed && operation !== 'read') return blocked('Operacion MCP no gobernada');
    const requiredScope = `mcp.cases.import.${operation}`;
    if (governed && tool.required_scope !== requiredScope) return blocked('Scope MCP gobernado invalido');
    if (governed && (!Array.isArray(endpoint.allowed_scopes) || !endpoint.allowed_scopes.includes(requiredScope))) return blocked('Allowlist de scope MCP ausente');
    if (governed) {
      const scopes = input.mcp_scopes || input.context?.mcp_scopes || input.sharedMemory?.mcp_scopes;
      if (!Array.isArray(scopes) || !scopes.includes(requiredScope)) return blocked('Scope MCP requerido ausente');
      const expectedConfirmation = operation === 'commit' ? 'APPLY_CASE_IMPORT' : operation === 'rollback' ? 'ROLLBACK_CASE_IMPORT' : undefined;
      const confirmation = input.workflow_confirmation || input.context?.workflow_confirmation || input.sharedMemory?.workflow_confirmation;
      if (expectedConfirmation && confirmation !== expectedConfirmation) return blocked('Confirmacion de workflow MCP requerida');
    }
    const endpointUrl = new URL(endpoint.url);
    const resolvedAddress = await resolveSafeAddress(endpointUrl, services?.resolveHost);
    if (!resolvedAddress) return blocked('Endpoint o herramienta fuera de la allowlist persistida');
    const args = input.mcp_arguments || input.arguments || {};
    if (!matchesSchema(tool.input_schema, args) || containsInlineUnsafeValue(args)) return blocked('Los argumentos no cumplen el schema MCP seguro');
    if (typeof endpoint.credential_id !== 'string' || !OPAQUE_REFERENCE.test(endpoint.credential_id)) return blocked('Falta la referencia segura de credencial');
    if (!services?.resolveCredential) return blocked('Resolver seguro MCP no configurado');
    const secret = await services.resolveCredential(endpoint.credential_id);
    if (!secret || typeof secret !== 'string') return blocked('Falta la referencia segura de credencial');
    const pinnedUrl = new URL(endpointUrl.toString());
    pinnedUrl.hostname = resolvedAddress;
    const authority = endpointUrl.host;
    const requestUrl = pinnedUrl.toString();
    const fetchImpl = createPinnedFetch(services.fetchImpl || fetch, pinnedUrl, authority);
    const timeoutMs = Math.max(1000, Math.min(Number(contract.execution?.timeout_sec || 60) * 1000, 7200000));
    const retries = Math.max(0, Math.min(Number(contract.execution?.max_retries || 0), MAX_RETRIES));
    let discovery: Json | undefined;
    for (let attempt = 0; attempt <= retries; attempt += 1) { try { discovery = await request(fetchImpl, requestUrl, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, secret, timeoutMs, 1, authority); break; } catch (error) { if (attempt === retries) throw error; } }
    const discovered = discovery?.result?.tools?.find((item: Json) => item?.name === config.mcp_tool_ref);
    if (!discovered || (operation === 'read' ? discovered.annotations?.readOnlyHint !== true : discovered.annotations?.readOnlyHint === true) || !sameJson(discovered.inputSchema, tool.input_schema)) return blocked('La herramienta no coincide con el catalogo persistido');
    let output: Json | undefined;
    for (let attempt = 0; attempt <= retries; attempt += 1) { try { output = await request(fetchImpl, requestUrl, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: config.mcp_tool_ref, arguments: args } }, secret, timeoutMs, 2, authority); break; } catch (error) { if (attempt === retries) throw error; } }
    const result = boundedResult(output?.result, secret);
    const trace = { type: 'mcp_tool_call', status: 'success', adapter: 'universal-mcp/v1', endpoint_ref: config.mcp_endpoint_ref, tool_ref: config.mcp_tool_ref, arguments: scrub(args, secret), result };
    try { services.trace(trace); } catch { /* tracing is best effort */ }
    return { status: 'SUCCESS', confidence: 100, reason: 'MCP tool ejecutada', events: [trace], output_json: { result }, sharedMemoryPatch: { mcp_result: result } };
  } catch {
    return failed();
  }
}
