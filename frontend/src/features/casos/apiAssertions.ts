export type ApiAssertionSource =
  | 'response.status'
  | 'response.body'
  | 'response.text'
  | 'response.headers'
  | 'response.cookies'
  | 'response.time.total_ms'
  | 'response.size_bytes'

export type ApiAssertionValueType = 'text' | 'number' | 'boolean' | 'json' | 'type'

export type ApiAssertion = {
  id: string
  name?: string
  source: ApiAssertionSource | string
  selector?: string
  operator: string
  expected?: unknown
  expected_type?: ApiAssertionValueType
  severity?: 'must' | 'warning'
}

export const API_ASSERTION_SOURCES: Array<{ value: ApiAssertionSource; labelKey: string; hintKey: string }> = [
  { value: 'response.status', labelKey: 'casos.apiAssertionSourceStatus', hintKey: 'casos.apiAssertionHintStatus' },
  { value: 'response.body', labelKey: 'casos.apiAssertionSourceBody', hintKey: 'casos.apiAssertionHintBody' },
  { value: 'response.text', labelKey: 'casos.apiAssertionSourceText', hintKey: 'casos.apiAssertionHintText' },
  { value: 'response.headers', labelKey: 'casos.apiAssertionSourceHeaders', hintKey: 'casos.apiAssertionHintHeaders' },
  { value: 'response.cookies', labelKey: 'casos.apiAssertionSourceCookies', hintKey: 'casos.apiAssertionHintCookies' },
  { value: 'response.time.total_ms', labelKey: 'casos.apiAssertionSourceTime', hintKey: 'casos.apiAssertionHintTime' },
  { value: 'response.size_bytes', labelKey: 'casos.apiAssertionSourceSize', hintKey: 'casos.apiAssertionHintSize' },
]

export const API_ASSERTION_OPERATORS: Array<{ value: string; labelKey: string; needsValue: boolean }> = [
  { value: 'equals', labelKey: 'casos.apiAssertionOperatorEquals', needsValue: true },
  { value: 'not_equals', labelKey: 'casos.apiAssertionOperatorNotEquals', needsValue: true },
  { value: 'contains', labelKey: 'casos.apiAssertionOperatorContains', needsValue: true },
  { value: 'starts_with', labelKey: 'casos.apiAssertionOperatorStartsWith', needsValue: true },
  { value: 'ends_with', labelKey: 'casos.apiAssertionOperatorEndsWith', needsValue: true },
  { value: 'matches', labelKey: 'casos.apiAssertionOperatorMatches', needsValue: true },
  { value: 'exists', labelKey: 'casos.apiAssertionOperatorExists', needsValue: false },
  { value: 'not_exists', labelKey: 'casos.apiAssertionOperatorNotExists', needsValue: false },
  { value: 'type_is', labelKey: 'casos.apiAssertionOperatorTypeIs', needsValue: true },
  { value: 'greater_than', labelKey: 'casos.apiAssertionOperatorGreaterThan', needsValue: true },
  { value: 'greater_or_equal', labelKey: 'casos.apiAssertionOperatorGreaterOrEqual', needsValue: true },
  { value: 'less_than', labelKey: 'casos.apiAssertionOperatorLessThan', needsValue: true },
  { value: 'less_or_equal', labelKey: 'casos.apiAssertionOperatorLessOrEqual', needsValue: true },
  { value: 'array_length_equals', labelKey: 'casos.apiAssertionOperatorArrayLengthEquals', needsValue: true },
  { value: 'array_length_greater_or_equal', labelKey: 'casos.apiAssertionOperatorArrayLengthGreaterOrEqual', needsValue: true },
  { value: 'array_length_less_or_equal', labelKey: 'casos.apiAssertionOperatorArrayLengthLessOrEqual', needsValue: true },
  { value: 'json_schema', labelKey: 'casos.apiAssertionOperatorJsonSchema', needsValue: true },
]

export const API_ASSERTION_TYPES = [
  { value: 'text', labelKey: 'casos.apiAssertionTypeText' },
  { value: 'number', labelKey: 'casos.apiAssertionTypeNumber' },
  { value: 'boolean', labelKey: 'casos.apiAssertionTypeBoolean' },
  { value: 'json', labelKey: 'casos.apiAssertionTypeJson' },
]

export const API_VALUE_TYPES = [
  { value: 'string', labelKey: 'casos.apiAssertionValueTypeString' },
  { value: 'number', labelKey: 'casos.apiAssertionValueTypeNumber' },
  { value: 'boolean', labelKey: 'casos.apiAssertionValueTypeBoolean' },
  { value: 'object', labelKey: 'casos.apiAssertionValueTypeObject' },
  { value: 'array', labelKey: 'casos.apiAssertionValueTypeArray' },
  { value: 'null', labelKey: 'casos.apiAssertionValueTypeNull' },
]

export function createApiAssertion(index = 0): ApiAssertion {
  return {
    id: `assertion-${Date.now()}-${index}`,
    name: `Validación ${index + 1}`,
    source: 'response.status',
    operator: 'equals',
    expected: 200,
    expected_type: 'number',
    severity: 'must',
  }
}

export function assertionNeedsValue(operator: string) {
  return API_ASSERTION_OPERATORS.find(item => item.value === operator)?.needsValue !== false
}

export function defaultExpectedForType(type: string) {
  if (type === 'number') return 0
  if (type === 'boolean') return false
  if (type === 'json') return {}
  return ''
}

export function parseExpected(value: string, type: string): unknown {
  if (type === 'number') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : value
  }
  if (type === 'boolean') return value === 'true'
  if (type === 'json') {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  return value
}

export function expectedToText(value: unknown, type = 'text') {
  if (type === 'json' || (typeof value === 'object' && value !== null)) return JSON.stringify(value, null, 2)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return value == null ? '' : String(value)
}
