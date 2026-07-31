import { humanizePremiumError } from '../features/premium/featureAccess'

export function stringifyFeedbackMessage(value: any, seen = new WeakSet<object>()): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Referencia circular]'
    seen.add(value)
    return value.map((item) => stringifyFeedbackMessage(item, seen)).filter(Boolean).join('\n')
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return '[Referencia circular]'
    seen.add(value)
    if (typeof value.message === 'string') return value.message
    if (typeof value.msg === 'string') {
      const path = Array.isArray(value.loc) ? value.loc.join('.') : ''
      return path ? `${path}: ${value.msg}` : value.msg
    }
    if (value.detail) return stringifyFeedbackMessage(value.detail, seen)
    try { return JSON.stringify(value, null, 2) } catch { return String(value) }
  }
  return String(value)
}

export async function readBackendError(response: Response, fallback: string): Promise<string> {
  const raw = await response.text().catch(() => '')
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    return humanizePremiumError(stringifyFeedbackMessage(parsed?.detail || parsed?.message || parsed))
  } catch {
    return humanizePremiumError(raw)
  }
}
