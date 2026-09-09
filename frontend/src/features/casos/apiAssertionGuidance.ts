import { createApiAssertion, type ApiAssertion } from './apiAssertions'

export type GuidedAssertionKind =
  | 'status'
  | 'text'
  | 'json-value'
  | 'json-type'
  | 'json-exists'
  | 'response-time'
  | 'json-schema'
  | 'advanced'

export const GUIDED_ASSERTION_KINDS: Array<{ value: GuidedAssertionKind; labelKey: string; descriptionKey: string }> = [
  { value: 'status', labelKey: 'casos.apiAssertionKindStatus', descriptionKey: 'casos.apiAssertionKindStatusDescription' },
  { value: 'text', labelKey: 'casos.apiAssertionKindText', descriptionKey: 'casos.apiAssertionKindTextDescription' },
  { value: 'json-value', labelKey: 'casos.apiAssertionKindJsonValue', descriptionKey: 'casos.apiAssertionKindJsonValueDescription' },
  { value: 'json-type', labelKey: 'casos.apiAssertionKindJsonType', descriptionKey: 'casos.apiAssertionKindJsonTypeDescription' },
  { value: 'json-exists', labelKey: 'casos.apiAssertionKindJsonExists', descriptionKey: 'casos.apiAssertionKindJsonExistsDescription' },
  { value: 'response-time', labelKey: 'casos.apiAssertionKindResponseTime', descriptionKey: 'casos.apiAssertionKindResponseTimeDescription' },
  { value: 'json-schema', labelKey: 'casos.apiAssertionKindJsonSchema', descriptionKey: 'casos.apiAssertionKindJsonSchemaDescription' },
  { value: 'advanced', labelKey: 'casos.apiAssertionKindAdvanced', descriptionKey: 'casos.apiAssertionKindAdvancedDescription' },
]

export function guidedAssertionKind(assertion: ApiAssertion): GuidedAssertionKind {
  if (assertion.source === 'response.status') return 'status'
  if (assertion.source === 'response.text') return 'text'
  if (assertion.source === 'response.time.total_ms') return 'response-time'
  if (assertion.source === 'response.body' && assertion.operator === 'json_schema') return 'json-schema'
  if (assertion.source === 'response.body' && assertion.operator === 'type_is') return 'json-type'
  if (assertion.source === 'response.body' && ['exists', 'not_exists'].includes(assertion.operator)) return 'json-exists'
  if (assertion.source === 'response.body') return 'json-value'
  return 'advanced'
}

export function normalizeJsonPath(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return '$'
  if (trimmed.startsWith('$')) return trimmed
  if (trimmed.startsWith('[')) return `$${trimmed}`
  return `$.${trimmed.replace(/^\./, '')}`
}

export function readableJsonPath(value?: string) {
  const selector = String(value || '')
  return selector.startsWith('$.') ? selector.slice(2) : selector
}

export function assertionForKind(kind: GuidedAssertionKind, index: number, current?: ApiAssertion): ApiAssertion {
  const base = current || createApiAssertion(index)
  const shared = {
    ...base,
    id: base.id || `assertion-${Date.now()}-${index}`,
    severity: base.severity || 'must' as const,
  }
  const selector = current?.source === 'response.body' && current.selector ? current.selector : '$.data.id'

  if (kind === 'status') return { ...shared, name: 'Estado HTTP esperado', source: 'response.status', selector: undefined, operator: 'equals', expected: 200, expected_type: 'number' }
  if (kind === 'text') return { ...shared, name: 'Texto esperado en la respuesta', source: 'response.text', selector: undefined, operator: 'contains', expected: 'operación correcta', expected_type: 'text' }
  if (kind === 'json-value') return { ...shared, name: 'Valor esperado en el JSON', source: 'response.body', selector, operator: 'equals', expected: '', expected_type: 'text' }
  if (kind === 'json-type') return { ...shared, name: 'Tipo esperado en el JSON', source: 'response.body', selector, operator: 'type_is', expected: 'string', expected_type: 'type' }
  if (kind === 'json-exists') return { ...shared, name: 'Presencia de campo JSON', source: 'response.body', selector, operator: 'exists', expected: undefined, expected_type: undefined }
  if (kind === 'response-time') return { ...shared, name: 'Tiempo máximo de respuesta', source: 'response.time.total_ms', selector: undefined, operator: 'less_or_equal', expected: 500, expected_type: 'number' }
  if (kind === 'json-schema') return { ...shared, name: 'Estructura JSON esperada', source: 'response.body', selector: '$', operator: 'json_schema', expected: { type: 'object', required: ['id'] }, expected_type: 'json' }
  return { ...shared, name: 'Header esperado', source: 'response.headers', selector: 'content-type', operator: 'contains', expected: 'application/json', expected_type: 'text' }
}
