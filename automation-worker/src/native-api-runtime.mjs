import { performance } from "node:perf_hooks";

import {
  API_CATALOG_VERSION,
  API_RESULT_SCHEMA,
  API_WORKER_JOB_SCHEMA,
  ALLOWED_METHODS,
  ApiWorkerBlockedError,
  MAX_RESPONSE_BYTES,
  MAX_SCRIPT_EVIDENCE_BYTES,
  MAX_TOTAL_EVIDENCE_BYTES,
  byteLength,
  clampText,
  createDeterministicDynamicContext,
  enabledPairs,
  jsonPath,
  mergeVariables,
  publicEvidenceEnabled,
  redactError,
  redactValue,
  rejectUnresolvedTemplates,
  resolveVariables,
  safeJsonClone,
  secretSetFromVariables,
} from "./api-native-utils.mjs";
import { assertionResult, runSafeScript } from "./api-native-assertions.mjs";
import { buildBody, prepareRequest, requestFromStep, requestWithRedirects } from "./api-native-http.mjs";

const MAX_STATE_UPDATES_BYTES = 512 * 1024;
const MAX_RESULT_ITEM_BYTES = 4 * 1024 * 1024;

function timeoutMsFor(config) { return Math.max(100, Math.min(Number(config?.request?.timeout?.total_ms || 45000), 120000)); }
function remainingTimeoutMs(options, configuredTimeoutMs) {
  if (!Number.isFinite(options?.deadlineAt)) return configuredTimeoutMs;
  const remaining = Math.floor(options.deadlineAt - Date.now());
  if (remaining <= 0) { const error = new Error("La ejecución API superó el timeout total del job"); error.code = "API_TIMEOUT"; throw error; }
  return Math.max(1, Math.min(configuredTimeoutMs, remaining));
}
function datasetForCase(payload, item) {
  const root = payload?.dataset && typeof payload.dataset === "object" && !Array.isArray(payload.dataset) ? payload.dataset : {};
  const caseDataset = root.cases?.[String(item.case_id)] ?? item.dataset ?? item.dataset_variables ?? {};
  const values = {};
  for (const source of [root.variables, root.dataset_variables, payload.dataset_variables, caseDataset?.variables, caseDataset, item.dataset?.variables, item.dataset, item.dataset_variables]) Object.assign(values, Array.isArray(source) ? Object.fromEntries(source.filter(row => row && (row.key || row.name)).map(row => [row.key || row.name, row.value ?? ""])) : source && typeof source === "object" ? source : {});
  delete values.shared_variables; delete values.cases; return values;
}
function dynamicContextFor(item, payload) {
  const context = createDeterministicDynamicContext(item.dynamic_seed ?? item.seed ?? payload.dynamic_seed);
  const candidate = item.dynamic_values ?? item.dynamic?.values ?? item.dataset?.dynamic_values;
  const precomputed = candidate?.values && typeof candidate.values === "object" ? candidate.values : candidate && typeof candidate === "object" ? candidate : {};
  Object.assign(context.values, precomputed);
  return context;
}
function safeRequestSummary(request, secrets, preserve) { return redactValue({ method: request?.method, url: request?.url, headers: request?.headers || {}, query: request?.query || {}, cookies: request?.cookies || {}, body: request?.body ?? null }, secrets, "", preserve); }
function responseSources(response) { return { "response.body": response.body_json ?? response.body, "response.text": response.body, "response.headers": response.headers, "response.cookies": response.cookies, "response.status": response.status }; }
function extractValue(extractor, response) {
  const source = responseSources(response)[extractor.source || "response.body"]; let value = extractor.selector ? (source && typeof source === "object" ? jsonPath(source, extractor.selector) : undefined) : source;
  if (extractor.regex && value !== undefined && value !== null) { const match = String(value).match(new RegExp(String(extractor.regex))); value = match?.groups?.value ?? match?.[1] ?? match?.[0]; }
  return value;
}
function statusFromError(error) { return error?.code === "API_TIMEOUT" ? "TIMEOUT" : error instanceof ApiWorkerBlockedError ? "BLOCKED" : "FAILED"; }
function updateWorst(current, next) { const rank = { PASSED: 0, PASSED_WITH_WARNINGS: 0, FAILED: 1, BLOCKED: 2, TIMEOUT: 3, ERROR: 4 }; if (!(next in rank)) return current; return (rank[next] ?? 1) > (rank[current] ?? 0) ? next : current; }

async function executeCleanup(config, environment, variables, dynamic, secrets, options, preserve, cookieJar) {
  const steps = config?.cleanup?.steps || []; if (!steps.length) return { status: "NOT_CONFIGURED", steps: [] }; const results = [];
  for (let index = 0; index < steps.length; index += 1) { const step = steps[index]; let request;
    try { request = requestFromStep(step, variables, dynamic); let url = String(request.url || ""); if (url.startsWith("/")) url = `${String(environment.url).replace(/\/$/, "")}${url}`; const prepared = prepareRequest({ ...request, url }); const response = await requestWithRedirects({ ...prepared, url: prepared.parsed.toString(), timeoutMs: remainingTimeoutMs(options, options.timeoutMs), redirects: request.redirects, environment, config, allowLoopbackForTests: options.allowLoopbackForTests, cookieJar }); results.push({ index: index + 1, name: step.name || `Cleanup ${index + 1}`, status: response.status >= 200 && response.status < 400 ? "PASSED" : "FAILED", status_code: response.status, request: safeRequestSummary({ ...request, url: prepared.parsed.toString(), headers: prepared.headers }, secrets, preserve) }); }
    catch (error) { results.push({ index: index + 1, name: step?.name || `Cleanup ${index + 1}`, status: statusFromError(error), request: safeRequestSummary(request || step?.request || step, secrets, preserve), error: redactError(error?.message, secrets) }); }
  }
  return { status: results.some(item => item.status === "TIMEOUT") ? "TIMEOUT" : results.some(item => item.status === "BLOCKED") ? "BLOCKED" : results.some(item => item.status === "FAILED") ? "FAILED" : "PASSED", steps: results };
}

async function executeApiCase(item, environment, dataset, shared, options) {
  const config = safeJsonClone(item.configuracion_api || item.api_config || item.config || {}); if (config.schema_version && !["treseko.api-test/v1", "treseko.api-test/v2"].includes(config.schema_version)) throw new ApiWorkerBlockedError("Contrato API no soportado", "UNSUPPORTED_API_SCHEMA");
  const preserve = publicEvidenceEnabled(environment, config); const dynamic = dynamicContextFor(item, options.payload || {}); const variables = mergeVariables(environment, config, dataset, shared); const secrets = secretSetFromVariables(variables); const persistentKeys = new Set(); const cookieJar = {};
  const scopes = { variables, environment: { ...variables }, collectionVariables: { ...variables }, globals: {} }; const sourceSteps = config.steps?.length ? config.steps : [{ name: config.metadata?.name || "API request", request: config.request || {}, assertions: config.assertions || [], extractors: config.extractors || [] }]; if (!sourceSteps.length) throw new ApiWorkerBlockedError("La prueba API debe tener al menos una solicitud", "EMPTY_API_CASE");
  const iterations = Math.max(1, Math.min(Number(config.execution?.iterations || 1), 100)); const steps = Array.from({ length: iterations }, (_, iteration) => sourceSteps.map((step, position) => ({ ...step, name: iterations > 1 ? `${step.name || `Request ${position + 1}`} · iteración ${iteration + 1}` : step.name, iteration: iteration + 1 }))).flat();
  const resultSteps = []; const scriptEvidence = []; let runStatus = "PASSED"; const started = performance.now(); const optionsWithTimeout = { ...options, timeoutMs: timeoutMsFor(config) };
  try {
    for (let position = 0; position < steps.length; position += 1) { const step = steps[position]; let request;
      try {
        const pre = step.pre_request_script || config.pre_request_script; if (pre) { const evidence = runSafeScript(pre, { variables, dynamic, scopes, response: null }, position + 1, "pre_request", secrets, preserve); if (evidence) { scriptEvidence.push(evidence); for (const write of evidence.scope_writes || []) if (write.persistent) persistentKeys.add(write.name); } }
        request = requestFromStep(step, variables, dynamic); let url = String(request.url || ""); if (url.startsWith("/")) url = `${String(environment.url).replace(/\/$/, "")}${url}`; const prepared = prepareRequest({ ...request, url });
        const auth = request.auth || {}; const authType = String(auth.type || "none").toLowerCase();
        if (["bearer", "oauth2"].includes(authType)) { const token = auth.token || variables[auth.variable || "access_token"]; if (!token) throw new ApiWorkerBlockedError("La autenticación API no tiene un valor resoluble", "AUTHENTICATION_NOT_CONFIGURED"); prepared.headers.Authorization = `Bearer ${token}`; }
        else if (authType === "api_key") { const token = auth.value || auth.token || variables[auth.variable]; if (!token) throw new ApiWorkerBlockedError("La autenticación API key no tiene un valor resoluble", "AUTHENTICATION_NOT_CONFIGURED"); if (auth.query) prepared.parsed.searchParams.set(String(auth.query), String(token)); else prepared.headers[String(auth.header || "X-API-Key")] = String(token); }
        else if (authType === "basic") { const username = auth.username || variables[auth.username_variable]; const password = auth.password || variables[auth.password_variable] || ""; if (!username) throw new ApiWorkerBlockedError("Basic Auth requiere usuario", "AUTHENTICATION_NOT_CONFIGURED"); prepared.headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`; }
        else if (authType !== "none" && authType !== "") throw new ApiWorkerBlockedError("Tipo de autenticación no soportado", "UNSUPPORTED_AUTHENTICATION");
        for (const value of Object.values(prepared.headers)) if (typeof value === "string" && value.length >= 4) secrets.add(value);
        const response = await requestWithRedirects({ ...prepared, url: prepared.parsed.toString(), timeoutMs: remainingTimeoutMs(optionsWithTimeout, optionsWithTimeout.timeoutMs), redirects: request.redirects, environment, config, allowLoopbackForTests: options.allowLoopbackForTests, cookieJar }); response.timings = { total_ms: Math.round((performance.now() - started) * 100) / 100 };
        const assertions = [...(step.assertions || []), ...(step.assertions ? [] : config.assertions || [])].map((assertion, index) => assertionResult(resolveVariables(assertion, variables, dynamic, "assertion"), response, secrets, position * 1000 + index, preserve));
        const post = step.post_response_script || config.post_response_script; if (post) { const evidence = runSafeScript(post, { variables, dynamic, scopes, response }, position + 1, "post_response", secrets, preserve); if (evidence) { scriptEvidence.push(evidence); for (const write of evidence.scope_writes || []) if (write.persistent) persistentKeys.add(write.name); for (const itemResult of evidence.tests || []) assertions.push({ id: `script-${position + 1}-${itemResult.name}`, name: itemResult.name, severity: "must", status: itemResult.status, source: "post_response_script", selector: null, operator: "script", expected: null, expected_type: null, actual: null, error: itemResult.error }); } }
        for (const extractor of [...(step.extractors || []), ...(step.extractors ? [] : config.extractors || [])]) { const value = extractValue(extractor, response); if (value === undefined || value === null) { if (extractor.required) assertions.push({ id: `extract-${position + 1}-${extractor.name || "value"}`, name: extractor.name || "Extractor", severity: "must", status: "FAILED", source: "extractor", selector: extractor.selector || null, operator: "extract", expected: null, expected_type: null, actual: null, error: "No se pudo extraer el valor requerido" }); continue; } if (!extractor.name) continue; const name = String(extractor.name); variables[name] = value; if (typeof value === "string" && value.length >= 4) secrets.add(value); if (extractor.persist === true || ["state", "persistent"].includes(String(extractor.scope || "").toLowerCase())) { if (!name.startsWith("api.")) throw new ApiWorkerBlockedError("Los extractores persistentes deben usar nombres api.*", "INVALID_PERSISTENT_VARIABLE"); persistentKeys.add(name); } }
        const failed = assertions.filter(assertion => assertion.status === "FAILED" && assertion.severity !== "warning"); const warnings = assertions.filter(assertion => assertion.status === "FAILED" && assertion.severity === "warning"); const status = failed.length ? "FAILED" : warnings.length ? "PASSED_WITH_WARNINGS" : "PASSED"; runStatus = updateWorst(runStatus, status);
        resultSteps.push({ index: position + 1, iteration: step.iteration, name: step.name || `Request ${position + 1}`, status, request: safeRequestSummary({ ...request, url: prepared.parsed.toString(), headers: prepared.headers }, secrets, preserve), response: redactValue(response, secrets, "", preserve), assertions: redactValue(assertions, secrets, "", preserve), errors: redactValue(failed, secrets, "", preserve) });
      } catch (error) { const status = statusFromError(error); runStatus = updateWorst(runStatus, status); resultSteps.push({ index: position + 1, iteration: step.iteration, name: step.name || `Request ${position + 1}`, status, request: safeRequestSummary(request || step?.request || step, secrets, preserve), response: null, assertions: [], errors: [{ error: redactError(error?.message, secrets), code: error?.code || null }] }); if (["BLOCKED", "TIMEOUT"].includes(status) || config.execution?.fail_fast) break; }
    }
  } finally { var cleanup = config.cleanup?.always_run ? await executeCleanup(config, environment, variables, dynamic, secrets, optionsWithTimeout, preserve, cookieJar) : { status: "SKIPPED", steps: [] }; runStatus = updateWorst(runStatus, cleanup.status); }
  const rawShared = Object.fromEntries(Object.entries(variables).filter(([key]) => key.startsWith("api.")));
  const rawPersistent = Object.fromEntries([...persistentKeys].filter(key => Object.hasOwn(variables, key)).map(key => [key, variables[key]]));
  if (byteLength(JSON.stringify({ shared_variables: rawShared, persistent_variables: rawPersistent })) > MAX_STATE_UPDATES_BYTES) throw new ApiWorkerBlockedError("Las variables API extraídas superan el límite permitido", "API_STATE_TOO_LARGE");
  for (const [key, value] of Object.entries(rawShared)) shared[key] = value;
  const result = { schema_version: API_RESULT_SCHEMA, status: runStatus, duration_ms: Math.round((performance.now() - started) * 100) / 100, steps: resultSteps, variables_extracted: Object.keys(variables).filter(key => key !== "base_url"), variables_used: redactValue(variables, secrets, "", preserve), dynamic_variables: { catalog_version: API_CATALOG_VERSION, seed: dynamic.seed, values: redactValue(dynamic.values, secrets, "", preserve), occurrences: redactValue(dynamic.occurrences, secrets, "", preserve) }, script_evidence: redactValue(scriptEvidence, secrets, "", preserve), api_variables: redactValue(rawShared, secrets, "", preserve), persistent_variables: redactValue(rawPersistent, secrets, "", preserve), cleanup: redactValue(cleanup, secrets, "", preserve), evidence_policy: { public_test_data: preserve } };
  return { result, state_updates: { shared_variables: rawShared, persistent_variables: rawPersistent } };
}

function compactResult(item, level) { const copy = safeJsonClone(item); for (const step of copy.result?.steps || []) { if (step.response) { step.response.body = clampText(step.response.body, level === 1 ? 64 * 1024 : 8 * 1024); if (step.response.body_json && typeof step.response.body_json === "object") step.response.body_json = { _truncated: true, _reason: "total_evidence_limit" }; } if (step.request) step.request.body = clampText(JSON.stringify(step.request.body ?? ""), 8 * 1024); } if (copy.result) { copy.result.script_evidence = (copy.result.script_evidence || []).map(entry => ({ ...entry, logs: clampText(JSON.stringify(entry.logs || []), level === 1 ? MAX_SCRIPT_EVIDENCE_BYTES : 4096) })); copy.result.variables_used = redactValue(copy.result.variables_used, new Set(), "", false); } return copy; }
function minimalResult(item) { return { ...item, result: { schema_version: API_RESULT_SCHEMA, status: item.result?.status || "ERROR", duration_ms: item.result?.duration_ms || 0, steps: [], errors: [{ error: "Evidencia compactada por límite permitido" }], api_variables: {}, persistent_variables: {}, dynamic_variables: { catalog_version: API_CATALOG_VERSION, values: {}, occurrences: [] }, script_evidence: [], cleanup: { status: "SKIPPED", steps: [] }, evidence_policy: item.result?.evidence_policy || { public_test_data: false } } }; }
function fitItemBudget(item) { let current = item; for (const level of [1, 2]) { if (byteLength(JSON.stringify(current)) <= MAX_RESULT_ITEM_BYTES) return current; current = compactResult(current, level); } return byteLength(JSON.stringify(current)) <= MAX_RESULT_ITEM_BYTES ? current : minimalResult(current); }
function fitEvidenceBudget(items) { let current = items.map(fitItemBudget); for (const level of [1, 2]) { if (byteLength(JSON.stringify(current)) <= MAX_TOTAL_EVIDENCE_BYTES) return current; current = current.map(item => fitItemBudget(compactResult(item, level))); } if (byteLength(JSON.stringify(current)) <= MAX_TOTAL_EVIDENCE_BYTES) return current; return current.map(minimalResult); }
function aggregateStatus(items) { const rank = { PASSED: 0, PASSED_WITH_WARNINGS: 0, FAILED: 1, BLOCKED: 2, TIMEOUT: 3, ERROR: 4 }; return items.reduce((worst, item) => (rank[item.result?.status] ?? 1) > (rank[worst] ?? 0) ? item.result.status : worst, "PASSED"); }

export async function runApiWorkerSuite(payload, { allowLoopbackForTests = false, timeoutSeconds = null } = {}) {
  if (!payload || payload.schema_version !== API_WORKER_JOB_SCHEMA || payload.job_type !== "API_EXECUTION") throw new ApiWorkerBlockedError("El job no cumple treseko.api-worker-job/v1", "UNSUPPORTED_API_JOB_SCHEMA");
  const environment = payload.environment || {}; if (!environment.url) throw new ApiWorkerBlockedError("El job API no incluye URL de ambiente", "ENVIRONMENT_URL_MISSING"); const cases = Array.isArray(payload.cases) ? payload.cases : []; if (!cases.length) throw new ApiWorkerBlockedError("El job API no incluye casos", "EMPTY_API_SUITE");
  const shared = { ...((payload.shared_variables && typeof payload.shared_variables === "object") ? payload.shared_variables : payload.dataset?.shared_variables || {}) }; const outputs = []; const started = Date.now();
  const totalTimeoutSeconds = Math.max(0.001, Number(timeoutSeconds || payload.timeout_seconds || 300));
  const deadlineAt = started + totalTimeoutSeconds * 1000;
  for (const item of cases) { const caseStarted = Date.now(); try { const output = await executeApiCase(item, environment, datasetForCase(payload, item), shared, { allowLoopbackForTests, payload, deadlineAt }); outputs.push({ case_id: item.case_id, execution_id: item.execution_id, result: output.result, state_updates: output.state_updates, duration_ms: Date.now() - caseStarted }); } catch (error) { outputs.push({ case_id: item.case_id, execution_id: item.execution_id, result: { schema_version: API_RESULT_SCHEMA, status: statusFromError(error), duration_ms: Date.now() - caseStarted, steps: [], errors: [{ error: redactError(error?.message) }], variables_extracted: [], variables_used: {}, dynamic_variables: { catalog_version: API_CATALOG_VERSION, values: {}, occurrences: [] }, script_evidence: [], api_variables: {}, persistent_variables: {}, cleanup: { status: "SKIPPED", steps: [] }, evidence_policy: { public_test_data: false } }, state_updates: { shared_variables: {}, persistent_variables: {} } }); } }
  const bounded = fitEvidenceBudget(outputs); return { status: aggregateStatus(bounded), duration_seconds: Math.max(0, Math.round((Date.now() - started) / 1000)), observations: `Suite API ejecutada por worker nativo: ${bounded.length} caso(s).`, logs: "", error_message: bounded.some(item => ["FAILED", "BLOCKED", "TIMEOUT", "ERROR"].includes(item.result.status)) ? "Uno o más casos API no finalizaron correctamente." : null, metadata: { framework: "treseko-api", language: "declarative", runtime: "native-fetch", runtime_version: process.version, cases_total: bounded.length, cases_passed: bounded.filter(item => ["PASSED", "PASSED_WITH_WARNINGS"].includes(item.result.status)).length, cases_failed: bounded.filter(item => item.result.status === "FAILED").length, cases_blocked: bounded.filter(item => item.result.status === "BLOCKED").length }, steps: [], api_results: bounded };
}
export async function executeApiWorkerJob({ job, allowLoopbackForTests = false } = {}) { return runApiWorkerSuite(job?.payload_congelado, { allowLoopbackForTests, timeoutSeconds: job?.timeout_seconds }); }

export { API_WORKER_JOB_SCHEMA, API_RESULT_SCHEMA, MAX_RESPONSE_BYTES, MAX_TOTAL_EVIDENCE_BYTES, MAX_SCRIPT_EVIDENCE_BYTES };
