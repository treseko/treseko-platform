import { humanizePremiumError } from '../features/premium/featureAccess'

/** Converts internal AI/engine failures into actionable messages for end users. */
export function humanizeAiError(value: any): string {
  const message = stringifyFeedbackMessage(value).trim()
  const normalized = message.toLowerCase()
  if (normalized.includes('engine_auth_not_configured') || normalized.includes('token interno del motor ia')) {
    return 'El Motor IA no está configurado para aceptar solicitudes. Contactá al administrador para configurar su token interno.'
  }
  if (normalized.includes('model is not') || normalized.includes('model not found') || normalized.includes('unknown model') || normalized.includes('model_id')) {
    return 'El modelo seleccionado no está disponible en el proveedor local. Escaneá los modelos y elegí uno de los modelos detectados.'
  }
  if (normalized.includes('no se pudo conectar') || normalized.includes('econnrefused') || normalized.includes('fetch failed')) {
    return 'No se pudo conectar con el Motor IA. Verificá que el servicio y el proveedor local estén iniciados.'
  }
  if (normalized.includes('ai_provider_invalid_response') || normalized.includes('proveedor rechazó la prueba')) {
    return 'El proveedor local rechazó la solicitud. Verificá el endpoint y elegí el identificador exacto de un modelo disponible.'
  }
  return message
}

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
    if (Array.isArray(value.errors)) {
      const errors = value.errors
        .map((item: any) => stringifyFeedbackMessage(item, seen))
        .filter(Boolean)
      if (errors.length > 0) return errors.join('\n')
    }
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
  if (response.status === 429) {
    return 'El servicio de actualizaciones está temporalmente limitado. Esperá unos segundos y volvé a intentarlo.'
  }
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    const errorEnvelope = parsed?.error && typeof parsed.error === 'object' ? parsed.error : null
    const message = errorEnvelope?.message || parsed?.detail || parsed?.message
    const details = errorEnvelope?.details || parsed?.details
    const rawDetailText = details ? stringifyFeedbackMessage(details) : ''
    const detailText = rawDetailText.trim() && !['{}', '[]'].includes(rawDetailText.trim())
      ? rawDetailText
      : ''
    const feedback = message
      ? `${message}${detailText ? `\n${detailText}` : ''}`
      : stringifyFeedbackMessage(parsed)
    return humanizePremiumError(feedback)
  } catch {
    if (/<!doctype html|<html[\s>]/i.test(raw)) return fallback
    return humanizePremiumError(raw)
  }
}
