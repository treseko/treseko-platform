import { API_BASE } from '../../app/constants'

const TRACE_ENABLED = (import.meta as any).env?.VITE_TEST_TRACE_ENABLED === 'true'
const TRACE_ENDPOINT = `${API_BASE}/debug/test-trace/frontend`
const TRACE_SKIP_HEADER = 'X-Test-Trace-Skip'
const MAX_TRACE_TEXT = 32 * 1024
const MAX_TRACE_DEPTH = 5
const REDACTED = '[redacted]'
const SENSITIVE_KEY_RE = /(authorization|cookie|set-cookie|token|refresh|secret|password|api[_-]?key|client_secret|access_token|refresh_token|credential|session)/i

function nowIso() {
  return new Date().toISOString()
}

function requestId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `trace-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function headersToObject(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {}
  const entries = headers instanceof Headers
    ? Array.from(headers.entries())
    : Array.isArray(headers)
      ? headers
      : Object.entries(headers)
  return Object.fromEntries(entries.map(([key, value]) => [
    String(key),
    SENSITIVE_KEY_RE.test(String(key)) ? REDACTED : boundTraceText(String(value)),
  ]))
}

function boundTraceText(value: unknown, maxLen = MAX_TRACE_TEXT) {
  const text = String(value ?? '').replace(/\x00/g, '')
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text
}

function sanitizeTraceValue(value: any, depth = 0): any {
  if (value == null) return value
  if (depth > MAX_TRACE_DEPTH) return '[max-depth]'
  if (typeof value === 'string') return boundTraceText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitizeTraceValue(item, depth + 1))
  if (typeof value === 'object') {
    const sanitized: Record<string, any> = {}
    for (const [key, item] of Object.entries(value).slice(0, 200)) {
      sanitized[key] = SENSITIVE_KEY_RE.test(key) ? REDACTED : sanitizeTraceValue(item, depth + 1)
    }
    return sanitized
  }
  return boundTraceText(value)
}

function sanitizeTraceTextPayload(value: string) {
  const bounded = boundTraceText(value)
  try {
    return sanitizeTraceValue(JSON.parse(bounded))
  } catch (_error) {
    return bounded
  }
}

function sanitizeTraceUrl(value: unknown) {
  const raw = boundTraceText(value, 4000)
  if (!raw) return raw
  try {
    const parsed = new URL(raw, window.location.origin)
    parsed.searchParams.forEach((_paramValue, key) => {
      if (SENSITIVE_KEY_RE.test(key)) parsed.searchParams.set(key, REDACTED)
    })
    return parsed.href
  } catch (_error) {
    return raw.replace(/([?&][^=]*(?:token|secret|password|api[_-]?key|session)[^=]*=)[^&#]*/gi, `$1${REDACTED}`)
  }
}

async function bodyToTraceValue(body: BodyInit | null | undefined): Promise<any> {
  if (!body) return null
  if (typeof body === 'string') return sanitizeTraceTextPayload(body)
  if (body instanceof URLSearchParams) return sanitizeTraceValue(Object.fromEntries(body.entries()))
  if (body instanceof FormData) {
    const entries: Record<string, any> = {}
    body.forEach((value, key) => {
      entries[key] = SENSITIVE_KEY_RE.test(key)
        ? REDACTED
        : value instanceof File
        ? { file_name: value.name, size: value.size, type: value.type }
        : sanitizeTraceValue(value)
    })
    return entries
  }
  if (body instanceof Blob) {
    return { blob_size: body.size, blob_type: body.type }
  }
  if (body instanceof ArrayBuffer) {
    return { array_buffer_bytes: body.byteLength }
  }
  return sanitizeTraceValue(body)
}

async function inputToTrace(input: RequestInfo | URL, init?: RequestInit) {
  if (input instanceof Request) {
    const clone = input.clone()
    return {
      url: sanitizeTraceUrl(clone.url),
      method: init?.method || clone.method || 'GET',
      headers: { ...headersToObject(clone.headers), ...headersToObject(init?.headers) },
      body: init?.body ? await bodyToTraceValue(init.body) : sanitizeTraceTextPayload(await clone.text().catch(() => ''))
    }
  }
  return {
    url: sanitizeTraceUrl(input),
    method: init?.method || 'GET',
    headers: headersToObject(init?.headers),
    body: await bodyToTraceValue(init?.body)
  }
}

function shouldSkipTrace(input: RequestInfo | URL, init?: RequestInit) {
  const url = input instanceof Request ? input.url : String(input)
  const headers = input instanceof Request
    ? { ...headersToObject(input.headers), ...headersToObject(init?.headers) }
    : headersToObject(init?.headers)
  return url.includes('/debug/test-trace/frontend') || headers[TRACE_SKIP_HEADER] === '1' || headers[TRACE_SKIP_HEADER.toLowerCase()] === '1'
}

function postTrace(originalFetch: typeof fetch, payload: Record<string, any>) {
  const token = localStorage.getItem('qa_access_token')
  originalFetch(TRACE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [TRACE_SKIP_HEADER]: '1',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(payload)
  }).catch(() => undefined)
}

export function installTestTraceFetch() {
  if (!TRACE_ENABLED || typeof window === 'undefined') return
  if ((window as any).__qaTestTraceInstalled) return
  ;(window as any).__qaTestTraceInstalled = true

  const originalFetch = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (shouldSkipTrace(input, init)) return originalFetch(input, init)

    const traceRequestId = requestId()
    const started = performance.now()
    const tracedHeaders = new Headers(input instanceof Request ? input.headers : init?.headers)
    if (!tracedHeaders.has('X-Request-ID')) tracedHeaders.set('X-Request-ID', traceRequestId)
    const tracedInput = input instanceof Request ? new Request(input, { ...init, headers: tracedHeaders }) : input
    const tracedInit = input instanceof Request ? undefined : { ...init, headers: tracedHeaders }
    const request = await inputToTrace(tracedInput, tracedInit)

    postTrace(originalFetch, {
      ts: nowIso(),
      source: 'frontend',
      event: 'fetch_request',
      request_id: traceRequestId,
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: sanitizeTraceValue(request.body),
      page: sanitizeTraceUrl(window.location.href),
      user_agent: navigator.userAgent
    })

    try {
      const response = await originalFetch(tracedInput, tracedInit)
      const responseClone = response.clone()
      const responseText = await responseClone.text().catch(error => `[response read error] ${error?.message || error}`)
      postTrace(originalFetch, {
        ts: nowIso(),
        source: 'frontend',
        event: 'fetch_response',
        request_id: traceRequestId,
        method: request.method,
        url: request.url,
        status: response.status,
        headers: headersToObject(response.headers),
        body: sanitizeTraceValue(request.body),
        response_body: sanitizeTraceTextPayload(responseText),
        duration_ms: Math.round((performance.now() - started) * 100) / 100,
        page: sanitizeTraceUrl(window.location.href)
      })
      return response
    } catch (error: any) {
      postTrace(originalFetch, {
        ts: nowIso(),
        source: 'frontend',
        event: 'error',
        request_id: traceRequestId,
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: sanitizeTraceValue(request.body),
        duration_ms: Math.round((performance.now() - started) * 100) / 100,
        page: sanitizeTraceUrl(window.location.href),
        error: {
          message: boundTraceText(error?.message || String(error), 1000),
          stack: boundTraceText(error?.stack, 4000)
        }
      })
      throw error
    }
  }
}
