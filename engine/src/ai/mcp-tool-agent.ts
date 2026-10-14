import Ajv from 'ajv';
import addFormats from 'ajv-formats';
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
const MAX_RESULT_BYTES = MAX_RESPONSE_BYTES - 512;
const MAX_RETRIES = 3;
const SECRET_KEYS = /^(?:authorization|proxy.authorization|api[-_]?key|set[-_]?cookie|cookie|credential|password|passwd|secret|access[-_]?token|refresh[-_]?token|token|session[-_]?id|private[-_]?key)$/i;
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
  if (Array.isArray(value)) return value.map((item) => scrub(item, credential));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Json).map(([key, item]) => [key, SECRET_KEYS.test(key) ? '[redacted]' : scrub(item, credential)]));
  }
  if (typeof value === 'string' && /^[\s]*[\[{]/.test(value)) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') return JSON.stringify(scrub(parsed, credential));
    } catch { /* non-JSON text is sanitized below */ }
  }
  if (typeof value === 'string') return value.replace(secretPattern || /$^/g, '[redacted]').replace(/(Bearer\s+)[^\s,;"']+/gi, '$1[redacted]').replace(/(\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*)[^\s,;"']+/gi, '$1[redacted]');
  return value;
}

function boundedResult(value: unknown, credential: string): unknown {
  const safe = scrub(value, credential);
  const serialized = JSON.stringify(safe);
  const encoder = new TextEncoder();
  if (encoder.encode(serialized).byteLength <= MAX_RESULT_BYTES) return safe;
  throw new Error('MCP_RESULT_TOO_LARGE');
}

function sameJson(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown => Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value as Json).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]))
      : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

const schemaValidator = new Ajv({ strict: false, allErrors: false, validateFormats: true });
addFormats(schemaValidator);
function matchesSchema(schema: Json, args: Json): boolean {
  try { return schema?.type === 'object' && Boolean(schemaValidator.validate(schema, args)); }
  catch { return false; }
}

// Only credential fields are forbidden inline. Functional text, URLs in API
// definitions and opaque import receipts are governed by the tool schema and
// backend domain contracts, rather than shell-like word heuristics.
function containsInlineUnsafeValue(value: unknown, key = ''): boolean {
  if (SECRET_KEYS.test(key) && value !== undefined && value !== null && value !== '') return true;
  if (Array.isArray(value)) return value.some(item => containsInlineUnsafeValue(item));
  if (value && typeof value === 'object') return Object.entries(value as Json).some(([name, item]) => containsInlineUnsafeValue(item, name));
  return false;
}

export async function readBoundedBody(response: Response): Promise<string> {
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
      if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('MCP_RESPONSE_TOO_LARGE'); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function request(fetchImpl: typeof fetch, url: string, body: Json, secret: string, timeoutMs: number, expectedId: number, authority: string, sessionHeaders: Record<string, string> = {}): Promise<Json> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-mcp-api-key': secret, host: authority, ...sessionHeaders }, body: JSON.stringify(body), signal: controller.signal });
    if (!response.ok) throw new Error(`MCP_HTTP_${response.status}`);
    if (response.url && new URL(response.url).origin !== new URL(url).origin) throw new Error('MCP_UNSAFE_REDIRECT');
    const sessionId = response.headers.get('mcp-session-id');
    if (sessionId) sessionHeaders['mcp-session-id'] = sessionId;
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
    const requiredScope = tool.required_scope;
    if (governed && (typeof requiredScope !== 'string' || !/^mcp\.[a-z0-9.-]+$/.test(requiredScope))) return blocked('Scope MCP gobernado invalido');
    if (governed && (!Array.isArray(endpoint.allowed_scopes) || !endpoint.allowed_scopes.includes(requiredScope))) return blocked('Allowlist de scope MCP ausente');
    if (governed) {
      const scopes = input.mcp_scopes || input.context?.mcp_scopes || input.sharedMemory?.mcp_scopes;
      if (!Array.isArray(scopes) || !scopes.includes(requiredScope)) return blocked('Scope MCP requerido ausente');
      const expectedConfirmation = tool.input_schema.properties?.confirmation?.const;
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
    const fetchImpl = createPinnedFetch(services.fetchImpl || fetch, pinnedUrl, authority, { pinNetwork: !services.fetchImpl || services.fetchImpl === globalThis.fetch });
    const timeoutMs = Math.max(1000, Math.min(Number(contract.execution?.timeout_sec || 60) * 1000, 7200000));
    const retries = Math.max(0, Math.min(Number(contract.execution?.max_retries || 0), MAX_RETRIES));
    const sessionHeaders: Record<string, string> = {};
    const initialization = await request(fetchImpl, requestUrl, { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'treseko-engine', version: 'universal-mcp/v1' } } }, secret, timeoutMs, 0, authority, sessionHeaders);
    if (initialization.result?.protocolVersion !== '2025-03-26') return blocked('Version de protocolo MCP incompatible');
    sessionHeaders['mcp-protocol-version'] = '2025-03-26';
    const initialized = await fetchImpl(requestUrl, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-mcp-api-key': secret, ...sessionHeaders }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), signal: AbortSignal.timeout(timeoutMs) });
    if (initialized.status !== 202 && initialized.status !== 204) throw new Error('MCP_INITIALIZATION_FAILED');
    let discovery: Json | undefined;
    for (let attempt = 0; attempt <= retries; attempt += 1) { try { discovery = await request(fetchImpl, requestUrl, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, secret, timeoutMs, 1, authority, sessionHeaders); break; } catch (error) { if (attempt === retries) throw error; } }
    const discovered = discovery?.result?.tools?.find((item: Json) => item?.name === config.mcp_tool_ref);
    if (!discovered || (operation === 'read' ? discovered.annotations?.readOnlyHint !== true : discovered.annotations?.readOnlyHint === true) || !sameJson(discovered.inputSchema, tool.input_schema)) return blocked('La herramienta no coincide con el catalogo persistido');
    // Only retry a mutation when the discovered contract supports durable replay.
    const callRetries = operation === 'read' || operation === 'preview' || (discovered.annotations?.idempotentHint === true && typeof args.idempotency_key === 'string' && args.idempotency_key.length > 0) ? retries : 0;
    let output: Json | undefined;
    for (let attempt = 0; attempt <= callRetries; attempt += 1) { try { output = await request(fetchImpl, requestUrl, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: config.mcp_tool_ref, arguments: args } }, secret, timeoutMs, 2, authority, sessionHeaders); break; } catch (error) { if (attempt === callRetries) throw error; } }
    const result = boundedResult(output?.result, secret);
    const toolFailed = output?.result?.isError === true;
    const trace = { type: 'mcp_tool_call', status: toolFailed ? 'failed' : 'success', adapter: 'universal-mcp/v1', endpoint_ref: config.mcp_endpoint_ref, tool_ref: config.mcp_tool_ref, arguments: scrub(args, secret), result };
    try { services.trace(trace); } catch { /* tracing is best effort */ }
    return { status: toolFailed ? 'FAILED' : 'SUCCESS', confidence: 100, reason: toolFailed ? 'La herramienta MCP devolvio un error' : 'MCP tool ejecutada', events: [trace], output_json: { result }, sharedMemoryPatch: { mcp_result: result } };
  } catch {
    return failed();
  }
}
