import { fallbackCatalog } from '../../i18n/catalogs'
import { interpolate } from '../../i18n'

export type ApiTranslate = (key: string, params?: Record<string, string | number>) => string

export function normalizedBodyMode(body: any) {
  const mode = String(body?.mode || 'none').toLowerCase()
  return mode === 'form-data' ? 'formdata' : mode
}

export function bodyDraft(body: any) {
  if (!body || normalizedBodyMode(body) === 'none') return ''
  const content = body.content ?? body.value ?? ''
  return typeof content === 'string' ? content : JSON.stringify(content, null, 2)
}

export function bodyRows(body: any) {
  const rows = body?.fields ?? body?.values ?? body?.content
  return Array.isArray(rows) ? rows : []
}

export function statusVariant(status: string) {
  if (['PASO', 'PASSED', 'PASSED_WITH_WARNINGS'].includes(status)) return 'success'
  if (['BLOQUEADO', 'BLOCKED'].includes(status)) return 'primary'
  return 'danger'
}

export function fallbackTranslate(key: string, params?: Record<string, string | number>) {
  const [moduleName, ...path] = key.split('.')
  const message = fallbackCatalog[moduleName]?.[path.join('.')] || key
  return interpolate(message, params)
}

export function readableAssertionSource(source: any, t: ApiTranslate) {
  const labels: Record<string, string> = {
    'response.status': t('casos.apiAssertionSourceStatus'),
    'response.headers': t('casos.apiAssertionSourceHeaders'),
    'response.body': t('casos.apiAssertionSourceBody'),
    'response.text': t('casos.apiAssertionSourceText'),
    'post_response_script': t('casos.apiAssertionSourceScript'),
  }
  return labels[String(source || '')] || String(source || t('casos.apiConfiguredAssertion'))
}

export function displayResultValue(value: any, t: ApiTranslate) {
  if (value === undefined || value === null || value === '') return t('casos.apiNotReported')
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}
