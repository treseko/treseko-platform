export type ApiTestConfig = Record<string, any>

// Common request headers exposed as suggestions in the guided editor. The
// request remains open-ended: users can still type any custom header.
export const COMMON_API_HEADERS = [
  'Accept',
  'Content-Type',
  'Accept-Language',
  'Cache-Control',
  'If-Match',
  'If-None-Match',
  'Idempotency-Key',
  'X-API-Key',
  'X-Request-ID',
  'X-Correlation-ID',
]

export const defaultApiTestConfig = (): ApiTestConfig => ({
  schema_version: 'treseko.api-test/v2',
  request: {
    method: 'GET',
    url: '{{base_url}}',
    headers: [],
    body: { mode: 'none' },
    timeout: { total_ms: 45000 },
    redirects: { follow: false },
    cookies: [],
    auth: { type: 'none' },
  },
  assertions: [{ id: 'status-ok', source: 'response.status', operator: 'equals', expected: 200, severity: 'must' }],
  extractors: [],
  execution: { iterations: 1, parallelism: 1, fail_fast: true },
  scripts: { timeout_ms: 1000 },
})
