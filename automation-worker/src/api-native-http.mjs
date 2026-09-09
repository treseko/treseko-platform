import {
  ALLOWED_METHODS,
  ApiWorkerBlockedError,
  MAX_RESPONSE_BYTES,
  enabledPairs,
  rejectUnresolvedTemplates,
  resolveVariables,
  validateDestination,
} from "./api-native-utils.mjs";

// Node 20+ supplies AbortController globally; no runtime dependency is needed.
const Controller = globalThis.AbortController;
const MAX_REDIRECTS = 10;

export function requestFromStep(step, variables, dynamic) {
  const request = resolveVariables({ ...(step.request || step) }, variables, dynamic, "request");
  delete request.assertions; delete request.extractors; delete request.name;
  rejectUnresolvedTemplates(request);
  return request;
}

export function buildBody(body, headers = {}) {
  if (body === undefined || body === null) return { body: undefined, headers };
  const normalized = { ...headers };
  const setType = (type) => { if (type && !Object.keys(normalized).some(key => key.toLowerCase() === "content-type")) normalized["Content-Type"] = type; };
  if (Array.isArray(body)) { setType("application/json"); return { body: JSON.stringify(body), headers: normalized }; }
  if (typeof body !== "object") return { body: typeof body === "string" ? body : JSON.stringify(body), headers: normalized };
  const mode = String(body.mode || "").toLowerCase();
  if (mode === "none") return { body: undefined, headers: normalized };
  if (["base64", "binary"].includes(mode)) return { body: Buffer.from(String(body.content ?? body.value ?? ""), "base64"), headers: normalized };
  if (["raw", "json"].includes(mode)) {
    const content = body.content ?? body.value ?? "";
    if (body.media_type === "application/json" || mode === "json") {
      setType("application/json");
      if (typeof content === "string") { try { return { body: JSON.stringify(JSON.parse(content)), headers: normalized }; } catch { return { body: content, headers: normalized }; }
      }
      return { body: JSON.stringify(content), headers: normalized };
    }
    if (body.media_type) setType(String(body.media_type));
    return { body: typeof content === "string" ? content : JSON.stringify(content), headers: normalized };
  }
  if (mode === "urlencoded") { setType("application/x-www-form-urlencoded"); return { body: new URLSearchParams(enabledPairs(body.fields || body.values)).toString(), headers: normalized }; }
  if (["formdata", "multipart"].includes(mode)) { const form = new FormData(); for (const [key, value] of Object.entries(enabledPairs(body.fields || body.values))) form.append(key, String(value)); return { body: form, headers: normalized }; }
  setType("application/json");
  return { body: JSON.stringify(body), headers: normalized };
}

async function readBody(response) {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new ApiWorkerBlockedError("La respuesta supera el límite de 2 MiB", "RESPONSE_TOO_LARGE");
  if (!response.body?.getReader) return { bytes: new Uint8Array(), truncated: false };
  const reader = response.body.getReader(); const chunks = []; let total = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > MAX_RESPONSE_BYTES) { await reader.cancel().catch(() => {}); throw new ApiWorkerBlockedError("La respuesta supera el límite de 2 MiB", "RESPONSE_TOO_LARGE"); } chunks.push(value); }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { bytes, truncated: false };
}

function cookiesFromResponse(response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")] : []);
  return values.map(item => item.split(";", 1)[0].split("=", 2)).filter(([key]) => key).map(([key, value]) => [key, value]);
}
function cookieHeader(jar) { return Object.entries(jar).map(([key, value]) => `${key}=${value}`).join("; "); }
function methodAfterRedirect(method, status) { return [301, 302, 303].includes(status) && method !== "HEAD" ? "GET" : method; }
function headersForRedirect(headers, from, to, previousMethod, nextMethod) {
  const sameOrigin = new URL(from).origin === new URL(to).origin;
  const result = { ...headers };
  if (!sameOrigin) for (const key of Object.keys(result)) if (["authorization", "cookie", "proxy-authorization"].includes(key.toLowerCase())) delete result[key];
  if (previousMethod !== nextMethod) for (const key of Object.keys(result)) if (["content-type", "content-length"].includes(key.toLowerCase())) delete result[key];
  return result;
}

export async function requestWithRedirects({ url, method, headers = {}, body, timeoutMs, redirects, environment, config, allowLoopbackForTests, cookieJar = {} }) {
  let current = String(url); let currentMethod = String(method || "GET").toUpperCase(); let currentBody = body; const visited = new Set(); const redirectChain = [];
  for (let count = 0; count <= MAX_REDIRECTS; count += 1) {
    await validateDestination(current, environment, config, { allowLoopbackForTests });
    if (visited.has(current)) throw new ApiWorkerBlockedError("La solicitud entró en un ciclo de redirecciones", "REDIRECT_LOOP");
    visited.add(current);
    const requestHeaders = { ...headers }; if (!Object.keys(requestHeaders).some(key => key.toLowerCase() === "cookie") && Object.keys(cookieJar).length) requestHeaders.Cookie = cookieHeader(cookieJar);
    const controller = Controller ? new Controller() : undefined; const timer = setTimeout(() => controller?.abort(), Math.max(100, Math.min(Number(timeoutMs) || 45000, 120000)));
    let response;
    try { response = await fetch(current, { method: currentMethod, headers: requestHeaders, body: currentMethod === "GET" || currentMethod === "HEAD" ? undefined : currentBody, redirect: "manual", signal: controller?.signal }); }
    catch (error) { if (error?.name === "AbortError") { const timeout = new Error("La solicitud API superó el timeout configurado"); timeout.code = "API_TIMEOUT"; throw timeout; } throw new Error("No se pudo completar la solicitud API"); }
    finally { clearTimeout(timer); }
    for (const [key, value] of cookiesFromResponse(response)) cookieJar[key] = value;
    if (redirects?.follow && response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      if (count === MAX_REDIRECTS) throw new ApiWorkerBlockedError("Se superó el límite de redirecciones", "REDIRECT_LIMIT");
      let next; try { next = new URL(response.headers.get("location"), current).toString(); } catch { throw new ApiWorkerBlockedError("La redirección no contiene una URL válida", "INVALID_REDIRECT"); } await validateDestination(next, environment, config, { allowLoopbackForTests });
      const nextMethod = methodAfterRedirect(currentMethod, response.status);
      redirectChain.push({ from: current, to: next, status: response.status, method: nextMethod });
      if (nextMethod !== currentMethod) currentBody = undefined;
      headers = headersForRedirect(headers, current, next, currentMethod, nextMethod); currentMethod = nextMethod; current = next; continue;
    }
    const bodyData = await readBody(response); const text = Buffer.from(bodyData.bytes).toString("utf8"); let bodyJson = null; try { bodyJson = text ? JSON.parse(text) : null; } catch { bodyJson = null; }
    return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body: text, body_json: bodyJson, cookies: Object.fromEntries(Object.entries(cookieJar)), size_bytes: bodyData.bytes.byteLength, url: current, redirects: redirectChain };
  }
  throw new ApiWorkerBlockedError("No se pudo completar la redirección", "REDIRECT_LIMIT");
}

export function prepareRequest(request) {
  const method = String(request.method || "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw new ApiWorkerBlockedError(`Método HTTP no permitido: ${method}`, "UNSUPPORTED_METHOD");
  const parsed = new URL(String(request.url || "")); const query = enabledPairs(request.query || request.query_params); for (const [key, value] of Object.entries(query)) parsed.searchParams.set(key, String(value));
  const headers = enabledPairs(request.headers); const cookies = enabledPairs(request.cookies); if (Object.keys(cookies).length && !Object.keys(headers).some(key => key.toLowerCase() === "cookie")) headers.Cookie = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
  const built = buildBody(request.body, headers); return { method, parsed, query, cookies, headers: built.headers, body: built.body };
}
