import {
  ApiWorkerBlockedError,
  clampText,
  jsonPath,
  redactError,
  redactValue,
  resolveVariables,
  stableId,
} from "./api-native-utils.mjs";

function jsonType(value) { return value === null ? "null" : Array.isArray(value) ? "array" : typeof value === "number" && !Number.isNaN(value) ? "number" : typeof value; }

export function validateJsonSchema(value, schema, path = "$") {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [`${path}: el esquema JSON debe ser un objeto`];
  const failures = []; const type = schema.type;
  if (type && jsonType(value) !== type) failures.push(`${path}: se esperaba type=${type}`);
  if (Object.hasOwn(schema, "const") && value !== schema.const) failures.push(`${path}: const no coincide`);
  if (Array.isArray(schema.enum) && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) failures.push(`${path}: valor fuera de enum`);
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    for (const required of schema.required || []) if (!Object.hasOwn(value, required)) failures.push(`${path}.${required}: campo requerido ausente`);
    for (const [key, child] of Object.entries(schema.properties || {})) if (Object.hasOwn(value, key)) failures.push(...validateJsonSchema(value[key], child, `${path}.${key}`));
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties || {}, key)) failures.push(`${path}.${key}: propiedad no permitida`);
  }
  if (Array.isArray(value) && schema.items) value.forEach((item, index) => failures.push(...validateJsonSchema(item, schema.items, `${path}[${index}]`)));
  if (typeof value === "string") { if (Number.isInteger(schema.minLength) && value.length < schema.minLength) failures.push(`${path}: minLength no cumplido`); if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) failures.push(`${path}: maxLength no cumplido`); }
  if (typeof value === "number") { if (schema.minimum !== undefined && value < schema.minimum) failures.push(`${path}: minimum no cumplido`); if (schema.maximum !== undefined && value > schema.maximum) failures.push(`${path}: maximum no cumplido`); }
  if (Array.isArray(value)) { if (Number.isInteger(schema.minItems) && value.length < schema.minItems) failures.push(`${path}: minItems no cumplido`); if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) failures.push(`${path}: maxItems no cumplido`); }
  return failures;
}

function actualFor(assertion, response) {
  const source = String(assertion.source || "response.body");
  if (source === "response.status") return response.status;
  if (source === "response.time.total_ms") return response.timings?.total_ms;
  if (source === "response.size_bytes") return response.size_bytes;
  if (source === "response.text") return response.body;
  if (source === "response.headers") return assertion.selector ? response.headers[String(assertion.selector).toLowerCase()] ?? response.headers[String(assertion.selector)] : response.headers;
  if (source.startsWith("response.headers.")) return response.headers[source.slice(17).toLowerCase()];
  if (source === "response.cookies") return assertion.selector ? response.cookies?.[assertion.selector] : response.cookies;
  if (source.startsWith("response.cookies.")) return response.cookies?.[source.slice(18)];
  if (source === "response.body") return assertion.selector ? jsonPath(response.body_json ?? response.body, assertion.selector) : response.body_json ?? response.body;
  throw new ApiWorkerBlockedError(`Fuente de aserción no soportada: ${source}`, "UNSUPPORTED_ASSERTION_SOURCE");
}

export function assertionResult(assertion, response, secrets, index = 0, preserve = false) {
  const source = String(assertion.source || "response.body"); const operator = String(assertion.operator || "equals").toLowerCase(); const expected = assertion.expected; const actual = actualFor(assertion, response); let passed = false; let error = null;
  try {
    if (["equals", "equal"].includes(operator)) passed = actual === expected;
    else if (operator === "not_equals") passed = actual !== expected;
    else if (operator === "exists") passed = actual !== undefined && actual !== null;
    else if (operator === "not_exists") passed = actual === undefined || actual === null;
    else if (operator === "contains") passed = typeof actual === "string" ? actual.includes(String(expected)) : Array.isArray(actual) ? actual.some(item => JSON.stringify(item) === JSON.stringify(expected)) : Boolean(actual && typeof actual === "object" && Object.hasOwn(actual, expected));
    else if (operator === "starts_with") passed = typeof actual === "string" && actual.startsWith(String(expected));
    else if (operator === "ends_with") passed = typeof actual === "string" && actual.endsWith(String(expected));
    else if (["less_than", "lt"].includes(operator)) passed = actual != null && actual < expected;
    else if (["less_or_equal", "lte"].includes(operator)) passed = actual != null && actual <= expected;
    else if (["greater_than", "gt"].includes(operator)) passed = actual != null && actual > expected;
    else if (["greater_or_equal", "gte"].includes(operator)) passed = actual != null && actual >= expected;
    else if (operator === "in") passed = Array.isArray(expected) ? expected.some(item => JSON.stringify(item) === JSON.stringify(actual)) : typeof expected === "string" && expected.includes(String(actual));
    else if (operator === "matches") passed = actual !== undefined && new RegExp(String(expected)).test(String(actual));
    else if (operator === "type_is") passed = jsonType(actual) === String(expected).toLowerCase();
    else if (operator === "array_length_equals") passed = Array.isArray(actual) && actual.length === expected;
    else if (operator === "array_length_greater_or_equal") passed = Array.isArray(actual) && actual.length >= expected;
    else if (operator === "array_length_less_or_equal") passed = Array.isArray(actual) && actual.length <= expected;
    else if (operator === "is_empty") passed = actual == null || actual === "" || (Array.isArray(actual) && !actual.length) || (actual && typeof actual === "object" && !Object.keys(actual).length);
    else if (operator === "not_empty") passed = !(actual == null || actual === "" || (Array.isArray(actual) && !actual.length) || (actual && typeof actual === "object" && !Object.keys(actual).length));
    else if (operator === "json_schema") { const failures = validateJsonSchema(actual, expected || {}); passed = !failures.length; error = failures.join("; ") || null; }
    else throw new ApiWorkerBlockedError(`Operador de aserción no soportado: ${operator}`, "UNSUPPORTED_ASSERTION");
  } catch (caught) { if (caught instanceof ApiWorkerBlockedError) throw caught; error = caught?.message || "Aserción inválida"; }
  if (!passed && !error) error = `La aserción ${operator} no se cumplió`;
  return { id: assertion.id || stableId({ source, operator, selector: assertion.selector || null, index }, "assertion"), name: assertion.name || assertion.id || `Assertion ${index + 1}`, severity: assertion.severity || "must", status: passed ? "PASSED" : "FAILED", source, selector: assertion.selector || null, operator, expected: redactValue(expected, secrets, "", preserve), expected_type: assertion.expected_type || null, actual: redactValue(actual, secrets, "", preserve), error: error ? (preserve ? clampText(error) : redactError(error, secrets)) : null };
}

function balancedCalls(source, name) {
  const calls = []; let cursor = 0;
  while (cursor < source.length) { const start = source.indexOf(`${name}(`, cursor); if (start < 0) break; let depth = 0; let quote = null; let escaped = false; let close = -1;
    for (let i = start + name.length; i < source.length; i += 1) { const ch = source[i]; if (quote) { if (escaped) escaped = false; else if (ch === "\\") escaped = true; else if (ch === quote) quote = null; continue; } if (["'", '"', "`"].includes(ch)) { quote = ch; continue; } if (ch === "(") depth += 1; if (ch === ")" && --depth === 0) { close = i; break; } }
    if (close < 0) throw new ApiWorkerBlockedError("El script API tiene una llamada sin cerrar", "UNSUPPORTED_API_SCRIPT"); calls.push({ start, end: close + 1, body: source.slice(start + name.length + 1, close) }); cursor = close + 1;
  } return calls;
}
function splitTopLevel(value) { let depth = 0; let quote = null; let escaped = false; for (let i = 0; i < value.length; i += 1) { const ch = value[i]; if (quote) { if (escaped) escaped = false; else if (ch === "\\") escaped = true; else if (ch === quote) quote = null; continue; } if (["'", '"', "`"].includes(ch)) { quote = ch; continue; } if (ch === "(") depth += 1; else if (ch === ")") depth -= 1; else if (ch === "," && depth === 0) return [value.slice(0, i), value.slice(i + 1)]; } return [value, ""]; }
function expressionValue(expression, context) {
  const value = String(expression || "").trim().replace(/;$/, ""); if (/^['"`]/.test(value)) return value.slice(1, -1).replaceAll("\\'", "'").replaceAll('\\"', '"'); if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true"; if (/^null$/i.test(value)) return null; if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  const variable = value.match(/^pm\.(variables|environment|collectionVariables|globals)\.get\(['"]([^'"]+)['"]\)$/); if (variable) return context.scopes[variable[1]][variable[2]]; if (value === "pm.response.code" || value === "pm.response.status") return context.response?.status; if (value === "pm.response.text()") return context.response?.body; const json = value.match(/^pm\.response\.json\(\)(.*)$/); if (json) return jsonPath(context.response?.body_json, `$${json[1] || ""}`); if (value.startsWith("pm.variables.replaceIn(")) { const [, inner] = value.match(/^pm\.variables\.replaceIn\(['"]([\s\S]*)['"]\)$/) || []; if (inner !== undefined) return resolveVariables(inner, context.variables, context.dynamic, "script"); }
  throw new ApiWorkerBlockedError("Script API contiene una expresión no soportada", "UNSUPPORTED_API_SCRIPT");
}

export function runSafeScript(source, context, index, phase, secrets, preserve = false) {
  const text = String(source || "").trim(); if (!text) return null;
  if (/(\beval\s*\(|\bnew\s+Function\b|\brequire\s*\(|\bimport\b|\bfetch\s*\(|\bprocess\b|\bglobalThis\b|pm\.sendRequest|\bfs\b|\bchild_process\b)/i.test(text)) throw new ApiWorkerBlockedError("El script API contiene operaciones no permitidas; la prueba quedó bloqueada", "UNSUPPORTED_API_SCRIPT");
  const writes = []; const writeRe = /pm\.(variables|environment|collectionVariables|globals)\.(persist|set)\(\s*['"]([^'"]+)['"]\s*,\s*([\s\S]*?)\s*\)(?:\s*;|$)/g; let match;
  while ((match = writeRe.exec(text))) { const scope = match[1]; const name = match[3]; const value = expressionValue(match[4], context); context.scopes[scope][name] = value; context.variables[name] = value; const persistent = match[2] === "persist" || name.startsWith("api.") && match[2] === "persist"; if (persistent && !name.startsWith("api.")) throw new ApiWorkerBlockedError("Las variables persistentes deben usar nombres api.*", "INVALID_PERSISTENT_VARIABLE"); writes.push({ scope, name, persistent }); if (typeof value === "string") secrets.add(value); }
  const tests = []; for (const call of balancedCalls(text, "pm.test")) { const [nameExpr, callback] = splitTopLevel(call.body); const name = nameExpr.trim().match(/^['"](.*?)['"]$/)?.[1]; if (!name) throw new ApiWorkerBlockedError("El nombre del test API no es válido", "UNSUPPORTED_API_SCRIPT"); const body = callback.replace(/^\s*\(?\s*(?:async\s*)?(?:function\s*\([^)]*\)|\(?[^=]*\)?\s*=>)\s*\{?/, "").replace(/\}?\s*$/, "").trim(); const status = body.match(/pm\.response\.to\.have\.status\(\s*(\d+)\s*\)/); const eql = body.match(/pm\.expect\((.+)\)\.to\.eql\(\s*([\s\S]+?)\s*\)/); const truthy = body.match(/pm\.expect\((.+)\)\.to\.be\.true/); let passed; if (status) passed = context.response?.status === Number(status[1]); else if (eql) passed = expressionValue(eql[1], context) === expressionValue(eql[2], context); else if (truthy) passed = Boolean(expressionValue(truthy[1], context)); else throw new ApiWorkerBlockedError("El test del script API no usa una aserción soportada", "UNSUPPORTED_API_SCRIPT"); tests.push({ name, status: passed ? "PASSED" : "FAILED", error: passed ? null : "La aserción del script no se cumplió" }); }
  const residual = text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(writeRe, "").replace(/[;\s]+/g, "").trim(); if (residual && !text.includes("pm.test")) throw new ApiWorkerBlockedError(`El script API contiene sintaxis no soportada en ${phase}`, "UNSUPPORTED_API_SCRIPT");
  return { index, phase, status: tests.some(item => item.status === "FAILED") ? "FAILED" : "PASSED", tests, scope_writes: writes, logs: [] };
}
