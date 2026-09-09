"""Small Postman-like script adapter with an intentionally narrow API surface.

The process receives JSON on stdin and returns JSON on stdout.  Scripts have no
Node imports, filesystem, network or process access.  This is a compatibility
adapter for common pm.test/pm.expect scripts, not a general JavaScript runtime.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from typing import Any


class ApiScriptError(ValueError):
    pass


_NODE_SCRIPT = r'''
const fs = require('node:fs');
const vm = require('node:vm');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const tests = [];
const logs = [];
const variables = {...(input.variables || {})};
const environment = {...(input.environment || {})};
const collectionVariables = {...(input.collection_variables || {})};
const globals = {...(input.globals || {})};
const iterationData = {...(input.iteration_data || {})};
const dynamicVariables = {...(input.dynamic_variables || {})};
const persistentVariables = {};
const scopeReads = [];
const scopeWrites = [];
const response = input.response || {};

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function fail(message) { throw new Error(String(message)); }
function check(condition, message, negate) {
  if ((negate ? condition : !condition)) fail(message);
}
function expectValue(value, negate = false) {
  const api = {};
  Object.defineProperty(api, 'to', {get: () => api});
  Object.defineProperty(api, 'be', {get: () => api});
  Object.defineProperty(api, 'have', {get: () => api});
  Object.defineProperty(api, 'deep', {get: () => api});
  Object.defineProperty(api, 'not', {get: () => expectValue(value, !negate)});
  Object.defineProperty(api, 'true', {get: () => check(value === true, 'expected true', negate)});
  Object.defineProperty(api, 'false', {get: () => check(value === false, 'expected false', negate)});
  Object.defineProperty(api, 'ok', {get: () => check(Boolean(value), 'expected a truthy value', negate)});
  api.eql = expected => check(same(value, expected), `expected ${JSON.stringify(value)} to deeply equal ${JSON.stringify(expected)}`, negate);
  api.equal = expected => check(value === expected, `expected ${JSON.stringify(value)} to equal ${JSON.stringify(expected)}`, negate);
  api.include = expected => check(value != null && (typeof value === 'string' || Array.isArray(value)) && value.includes(expected), `expected value to include ${JSON.stringify(expected)}`, negate);
  api.contain = api.include;
  api.a = expected => check((expected === 'array' && Array.isArray(value)) || (expected === 'null' && value === null) || (expected === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value)) || (typeof value === expected), `expected type ${expected}`, negate);
  api.an = api.a;
  api.property = (name, expected) => {
    const exists = value !== null && value !== undefined && Object.prototype.hasOwnProperty.call(value, name);
    check(exists, `expected property ${name}`, negate);
    if (expected !== undefined) check(same(value[name], expected), `expected property ${name} to equal ${JSON.stringify(expected)}`, negate);
    return expectValue(value && value[name], negate);
  };
  api.oneOf = values => check(Array.isArray(values) && values.some(item => same(item, value)), `expected value to be one of ${JSON.stringify(values)}`, negate);
  api.below = expected => check(typeof value === 'number' && value < expected, `expected ${value} to be below ${expected}`, negate);
  api.above = expected => check(typeof value === 'number' && value > expected, `expected ${value} to be above ${expected}`, negate);
  api.least = expected => check(typeof value === 'number' && value >= expected, `expected ${value} to be at least ${expected}`, negate);
  api.most = expected => check(typeof value === 'number' && value <= expected, `expected ${value} to be at most ${expected}`, negate);
  return api;
}

const responseHeaders = response.headers || {};
const responseCookies = response.cookies || {};
const responseFacade = {
  code: response.status,
  status: response.status,
  responseTime: response.timings?.total_ms,
  text: () => response.body || '',
  json: () => response.body_json,
  headers: { get: name => responseHeaders[String(name).toLowerCase()] ?? responseHeaders[name] },
  cookies: { get: name => responseCookies[name], has: name => Object.prototype.hasOwnProperty.call(responseCookies, name) },
};
const responseHave = {
  status: expected => check(response.status === expected, `expected status ${expected}, received ${response.status}`, false),
  header: (name, expected) => { const actual = responseFacade.headers.get(name); check(actual !== undefined && (expected === undefined || String(actual).includes(String(expected))), `expected header ${name}`, false); },
  jsonSchema: schema => { if (!schema || typeof schema !== 'object') fail('jsonSchema requiere un objeto'); },
};
const responseBe = {};
Object.defineProperty(responseBe, 'ok', { get: () => check(response.status >= 200 && response.status < 400, 'response is not successful', false) });
Object.defineProperty(responseBe, 'withBody', { get: () => check(Boolean(response.body), 'response has no body', false) });
Object.defineProperty(responseBe, 'json', { get: () => check(response.body_json !== null && response.body_json !== undefined, 'response is not JSON', false) });
responseFacade.to = { have: responseHave, be: responseBe };

function queryObject(urlValue) {
  const raw = typeof urlValue === 'string' ? urlValue : (urlValue && (urlValue.raw || urlValue.url)) || '';
  const query = String(raw).split('?')[1]?.split('#')[0] || '';
  return query.split('&').reduce((result, pair) => {
    if (!pair) return result;
    const separator = pair.indexOf('=');
    const rawKey = separator >= 0 ? pair.slice(0, separator) : pair;
    const rawValue = separator >= 0 ? pair.slice(separator + 1) : '';
    const decode = value => {
      try { return decodeURIComponent(String(value).replace(/\+/g, ' ')); } catch (_) { return String(value); }
    };
    result[decode(rawKey)] = decode(rawValue);
    return result;
  }, {});
}

function lookupVariable(key) {
  const name = String(key || '').trim();
  const scopes = [
    ['local', variables],
    ['data', iterationData],
    ['environment', environment],
    ['collection', collectionVariables],
    ['global', globals],
    ['dynamic', dynamicVariables],
  ];
  for (const [scope, values] of scopes) {
    if (Object.prototype.hasOwnProperty.call(values, name)) {
      scopeReads.push({scope, key: name});
      return values[name];
    }
  }
  // Direct sandbox callers may not provide a resolved catalog. Keep this
  // fallback deliberately fixed; request executions pass seeded values from
  // DynamicVariableContext and never use a runtime-random fallback.
  const deterministicDefaults = {
    '$randomCompanyName': 'Treseko-Demo',
    '$randomFirstName': 'Treseko',
    '$randomLastName': 'QA',
    '$randomEmail': 'qa@example.test',
    '$randomUUID': '00000000-0000-4000-8000-000000000000',
  };
  if (Object.prototype.hasOwnProperty.call(deterministicDefaults, name)) return deterministicDefaults[name];
  scopeReads.push({scope: 'unresolved', key: name});
  return undefined;
}

function readScoped(scope, values, key) {
  const name = String(key || '').trim();
  scopeReads.push({scope, key: name});
  return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : undefined;
}

function writeScoped(scope, values, key, value) {
  const name = String(key || '').trim();
  values[name] = value;
  scopeWrites.push({scope, key: name, operation: 'set'});
  return value;
}

function unsetScoped(scope, values, key) {
  const name = String(key || '').trim();
  delete values[name];
  scopeWrites.push({scope, key: name, operation: 'unset'});
}

function replaceVariables(value) {
  return String(value ?? '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, key) => {
    const resolved = lookupVariable(key);
    return resolved === undefined || resolved === null ? match : String(resolved);
  });
}

const requestInput = input.request || {};
const requestUrl = typeof requestInput.url === 'string'
  ? requestInput.url
  : (requestInput.url && (requestInput.url.raw || requestInput.url.url)) || '';
const requestFacade = {
  ...requestInput,
  url: {
    ...(typeof requestInput.url === 'object' && requestInput.url ? requestInput.url : {}),
    raw: requestUrl,
    query: { toObject: () => queryObject(requestUrl) },
  },
};

const pm = {
  test: (name, fn) => { try { fn(); tests.push({name: String(name), status: 'PASSED'}); } catch (error) { tests.push({name: String(name), status: 'FAILED', error: String(error?.message || error)}); } },
  expect: value => expectValue(value),
  response: responseFacade,
  variables: {
    get: key => Object.prototype.hasOwnProperty.call(variables, String(key)) ? readScoped('local', variables, key) : lookupVariable(key),
    set: (key, value) => writeScoped('local', variables, key, value),
    unset: key => unsetScoped('local', variables, key),
    replaceIn: value => replaceVariables(value),
    persist: (key, value) => {
      if (!String(key).startsWith('api.')) throw new Error('Las variables persistentes deben usar el prefijo api.');
      writeScoped('local', variables, key, value);
      persistentVariables[key] = value;
    },
  },
  globals: { get: key => readScoped('global', globals, key), set: (key, value) => writeScoped('global', globals, key, value), unset: key => unsetScoped('global', globals, key) },
  environment: { get: key => readScoped('environment', environment, key), set: (key, value) => writeScoped('environment', environment, key, value), unset: key => unsetScoped('environment', environment, key) },
  collectionVariables: { get: key => readScoped('collection', collectionVariables, key), set: (key, value) => writeScoped('collection', collectionVariables, key, value), unset: key => unsetScoped('collection', collectionVariables, key) },
  iterationData: { get: key => readScoped('data', iterationData, key), toObject: () => ({...iterationData}) },
  sendRequest: () => { throw new Error('pm.sendRequest no está disponible en el sandbox declarativo; use el runtime Postman aislado'); },
  request: requestFacade,
};
const consoleApi = { log: (...args) => logs.push(args.map(value => String(value)).join(' ')), warn: (...args) => logs.push(args.map(value => String(value)).join(' ')) };
const sandbox = { pm, console: consoleApi, JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp };
const forbidden = /\b(require|process|fetch|XMLHttpRequest|WebSocket|eval|Function|import|child_process|constructor|prototype|__proto__)\b|Math\s*\.\s*random/;
const source = String(input.script || '');
if (forbidden.test(source)) throw new Error('El script usa una API no permitida por el sandbox');
vm.runInNewContext(source, sandbox, {timeout: Math.min(Math.max(Number(input.timeout_ms || 1000), 50), 3000), codeGeneration: {strings: false, wasm: false}});
process.stdout.write(JSON.stringify({tests, variables, environment, collection_variables: collectionVariables, globals, iteration_data: iterationData, dynamic_variables: dynamicVariables, persistent_variables: persistentVariables, logs, scope_reads: scopeReads, scope_writes: scopeWrites, runtime: 'treseko-declarative-sandbox', capabilities: ['pm.test', 'pm.expect', 'pm.variables', 'pm.globals', 'pm.collectionVariables', 'pm.environment', 'pm.iterationData', 'pm.request', 'pm.response']}));
'''


def run_api_script(
    script: str | dict[str, Any] | None,
    *,
    variables: dict[str, Any],
    environment: dict[str, Any],
    collection_variables: dict[str, Any],
    globals: dict[str, Any] | None = None,
    iteration_data: dict[str, Any] | None = None,
    dynamic_variables: dict[str, Any] | None = None,
    response: dict[str, Any] | None = None,
    request: dict[str, Any] | None = None,
    timeout_ms: int = 1000,
) -> dict[str, Any]:
    if isinstance(script, dict):
        lines = script.get("exec")
        script = "\n".join(str(item) for item in lines) if isinstance(lines, list) else str(lines or "")
    script = str(script or "").strip()
    if not script:
        return {"tests": [], "variables": dict(variables), "environment": dict(environment), "collection_variables": dict(collection_variables), "globals": dict(globals or {}), "iteration_data": dict(iteration_data or {}), "dynamic_variables": dict(dynamic_variables or {}), "persistent_variables": {}, "logs": [], "scope_reads": [], "scope_writes": [], "runtime": "treseko-declarative-sandbox", "capabilities": []}
    node = shutil.which("node")
    if not node:
        raise ApiScriptError("El runtime Node.js no está disponible para ejecutar el script API")
    payload = {"script": script, "variables": variables, "environment": environment, "collection_variables": collection_variables, "globals": globals or {}, "iteration_data": iteration_data or {}, "dynamic_variables": dynamic_variables or {}, "response": response or {}, "request": request or {}, "timeout_ms": timeout_ms}
    try:
        completed = subprocess.run([node, "-e", _NODE_SCRIPT], input=json.dumps(payload, ensure_ascii=False).encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=max(1, min(timeout_ms / 1000 + 1, 5)), check=False)
    except subprocess.TimeoutExpired as exc:
        raise ApiScriptError("El script API superó el tiempo máximo permitido") from exc
    if completed.returncode != 0:
        error = completed.stderr.decode("utf-8", errors="replace").strip() or "El script API falló"
        raise ApiScriptError(error[-1000:])
    try:
        result = json.loads(completed.stdout.decode("utf-8"))
    except (TypeError, ValueError) as exc:
        raise ApiScriptError("El sandbox devolvió una respuesta inválida") from exc
    return result
