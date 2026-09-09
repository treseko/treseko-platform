import type { TranslationKey } from '../../i18n/types'

export type ApiMessageTranslator = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string

type ApiMessageKey = TranslationKey

const DEFAULT_READ_ERROR = 'No se pudo ejecutar la prueba API.'

function safeFallbackText(value: string | undefined): string | undefined {
  if (!value) return undefined
  const suspicious = /(https?:\/\/|\b[\w-]*(token|secret|password|api[_ -]?key|authorization)[\w-]*\s*[=:]|\b(?:request|trace|correlation|session|run|user)(?:[_ -]?id)(?:\s*[=:]\s*|\s+)[^\s,;]+|\b(?:authorization\s+)?bearer\s+[^\s,;]+|\b(id|uuid)\s*[=:]|\b(token|id|uuid)\b\s*[/|,]\s*(token|id|uuid)\b)/i
  return suspicious.test(value) ? undefined : value
}

function localizedMessage(
  translator: ApiMessageTranslator | undefined,
  key: ApiMessageKey,
  safeFallback: string,
  params?: Record<string, string | number>,
): string {
  if (!translator) return safeFallback
  try {
    const translated = translator(key, params)
    if (translated && translated !== key) return translated
  } catch {
    // A broken or incomplete optional translator must not hide the safe message.
  }
  return safeFallback
}

const detailText = (value: any): string => {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(detailText).filter(Boolean).join('\n')
  if (typeof value === 'object') {
    if (typeof value.message === 'string') return value.message
    if (typeof value.msg === 'string') return value.msg
    if (value.detail) return detailText(value.detail)
    if (Array.isArray(value.errors)) return value.errors.map(detailText).filter(Boolean).join('\n')
  }
  return ''
}

function classifyMessage(
  status: number,
  detail: string,
  fallback: string,
  translator?: ApiMessageTranslator,
): string {
  const normalized = detail.toLowerCase()
  if (status === 401) return localizedMessage(translator, 'casos.apiErrorSessionExpired', 'Tu sesión ya no es válida. Volvé a iniciar sesión para ejecutar la prueba API.')
  if (status === 403) return localizedMessage(translator, 'casos.apiErrorPermissionDenied', 'No tenés permisos para ejecutar esta prueba API.')
  if (status === 404) return localizedMessage(translator, 'casos.apiErrorOperationNotFound', 'No se encontró la prueba API o la operación solicitada. Actualizá la pantalla y volvé a intentarlo.')
  if (status === 409) return normalized.includes('build')
    ? localizedMessage(translator, 'casos.apiErrorBuildUnavailable', 'La build seleccionada no está disponible para ejecutar esta prueba API.')
    : localizedMessage(translator, 'casos.apiErrorExecutionStateChanged', 'El estado de la prueba API cambió. Actualizá la pantalla y volvé a intentarlo.')
  if (normalized.includes('dataset')) return localizedMessage(translator, 'casos.apiErrorDatasetUnavailable', 'El dataset seleccionado no pertenece al ambiente elegido o ya no está disponible.')
  if (normalized.includes('ambiente') || normalized.includes('environment')) return localizedMessage(translator, 'casos.apiErrorEnvironmentUnavailable', 'El ambiente seleccionado no está disponible para este proyecto.')
  if (normalized.includes('variable') && (normalized.includes('resuelt') || normalized.includes('falta') || normalized.includes('missing') || normalized.includes('unresolved'))) return localizedMessage(translator, 'casos.apiErrorMissingVariables', 'Faltan variables necesarias para ejecutar la solicitud. Revisá el ambiente, el dataset y el Estado API.')
  if (normalized.includes('allowlist') || normalized.includes('ssrf') || normalized.includes('bloqueado') || normalized.includes('request blocked')) return localizedMessage(translator, 'casos.apiErrorSecurityBlocked', 'La solicitud fue bloqueada por la política de seguridad del ambiente.')
  if (normalized.includes('no se pudo resolver') || normalized.includes('could not resolve') || normalized.includes('resolve host') || normalized.includes('dns') || normalized.includes('getaddrinfo')) return localizedMessage(translator, 'casos.apiErrorDnsResolutionFailed', 'No se pudo encontrar el servicio API. Revisá la URL y el ambiente seleccionado.')
  if (normalized.includes('timeout') || normalized.includes('timed out') || normalized.includes('tiempo')) return localizedMessage(translator, 'casos.apiErrorTimeout', 'La API tardó demasiado en responder. Verificá que esté disponible e intentá nuevamente.')
  if (normalized.includes('ssl') || normalized.includes('certificate') || normalized.includes('tls')) return localizedMessage(translator, 'casos.apiErrorTlsConnectionFailed', 'No se pudo establecer una conexión segura con la API. Revisá el certificado y la URL.')
  if (normalized.includes('connect') || normalized.includes('connection') || normalized.includes('conexión') || normalized.includes('network')) return localizedMessage(translator, 'casos.apiErrorConnectionFailed', 'No se pudo conectar con la API. Verificá el ambiente y que el servicio esté disponible.')
  if (status === 422) return localizedMessage(translator, 'casos.apiErrorInvalidConfiguration', 'La configuración de la prueba API no es válida. Revisá la solicitud, la autenticación y las comprobaciones.')
  if (status === 429) return localizedMessage(translator, 'casos.apiErrorRateLimited', 'La API rechazó temporalmente la solicitud por exceso de intentos. Esperá unos segundos y volvé a probar.')
  if (status >= 500) return localizedMessage(translator, 'casos.apiErrorServerFailure', 'El servidor no pudo completar la ejecución de la prueba API. Intentá nuevamente.')
  return fallback
}

export async function readApiTestError(
  response: Response,
  fallbackOrTranslator?: string | ApiMessageTranslator,
  translator?: ApiMessageTranslator,
): Promise<string> {
  const raw = await response.text().catch(() => '')
  let detail = raw
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      detail = detailText(parsed?.error || parsed?.detail || parsed?.message) || raw
    } catch {
      detail = raw
    }
  }
  const fallback = typeof fallbackOrTranslator === 'string' ? fallbackOrTranslator : undefined
  const activeTranslator = typeof fallbackOrTranslator === 'function' ? fallbackOrTranslator : translator
  const safeFallback = safeFallbackText(fallback) ?? localizedMessage(activeTranslator, 'casos.apiErrorExecutionFallback', DEFAULT_READ_ERROR)
  return classifyMessage(response.status, detail, safeFallback, activeTranslator)
}

function executionErrorText(result: any): string {
  const steps = Array.isArray(result?.steps) ? result.steps : []
  const firstError = steps.flatMap((step: any) => Array.isArray(step?.errors) ? step.errors : []).find(Boolean)
  return detailText(firstError?.error || firstError)
}

export function apiExecutionMessage(result: any, translator?: ApiMessageTranslator): string {
  const steps = Array.isArray(result?.steps) ? result.steps : []
  const responseStatus = steps.map((step: any) => Number(step?.response?.status || 0)).find((status: number) => status >= 400)
  if (responseStatus === 400) return localizedMessage(translator, 'casos.apiErrorUpstreamBadRequest', 'La API rechazó la solicitud porque los datos enviados no son válidos. Revisá los parámetros y el cuerpo.')
  if (responseStatus === 401) return localizedMessage(translator, 'casos.apiErrorUpstreamUnauthorized', 'La API rechazó la autenticación. Revisá el token, usuario o credenciales del ambiente.')
  if (responseStatus === 403) return localizedMessage(translator, 'casos.apiErrorUpstreamForbidden', 'La API rechazó la solicitud por permisos insuficientes.')
  if (responseStatus === 404) return localizedMessage(translator, 'casos.apiErrorUpstreamNotFound', 'La API no encontró el recurso solicitado. Revisá la URL y los parámetros.')
  if (responseStatus === 408) return localizedMessage(translator, 'casos.apiErrorUpstreamTimeout', 'La API no respondió a tiempo. Verificá que esté disponible e intentá nuevamente.')
  if (responseStatus === 409) return localizedMessage(translator, 'casos.apiErrorUpstreamConflict', 'La API informó un conflicto con el estado actual del recurso.')
  if (responseStatus === 422) return localizedMessage(translator, 'casos.apiErrorUpstreamUnprocessable', 'La API rechazó los datos enviados. Revisá el formato de la solicitud.')
  if (responseStatus === 429) return localizedMessage(translator, 'casos.apiErrorUpstreamRateLimited', 'La API rechazó temporalmente la solicitud por exceso de intentos.')
  if (responseStatus >= 500) return localizedMessage(translator, 'casos.apiErrorUpstreamServerError', 'La API devolvió un error interno. El servicio probado debe revisarse.')
  const error = executionErrorText(result).toLowerCase()
  if (error.includes('timeout') || error.includes('timed out') || error.includes('tiempo')) return localizedMessage(translator, 'casos.apiErrorTimeout', 'La API tardó demasiado en responder. Verificá que esté disponible e intentá nuevamente.')
  if (error.includes('variable')) return localizedMessage(translator, 'casos.apiErrorExecutionMissingVariables', 'La ejecución no pudo resolver todas las variables necesarias.')
  if (error.includes('extract') || error.includes('extraer')) return localizedMessage(translator, 'casos.apiErrorExtractionFailed', 'La respuesta llegó, pero no se pudo obtener uno de los valores configurados.')
  if (error.includes('script')) return localizedMessage(translator, 'casos.apiErrorScriptFailed', 'La solicitud no pudo completar el script configurado.')
  if (steps.some((step: any) => Array.isArray(step?.assertions) && step.assertions.some((item: any) => item.status === 'FAILED'))) return localizedMessage(translator, 'casos.apiErrorAssertionsFailed', 'La respuesta llegó, pero no cumple una o más comprobaciones configuradas.')
  if (result?.status === 'FAILED' || result?.status === 'BLOCKED') return localizedMessage(translator, 'casos.apiErrorExecutionFailed', 'No se pudo completar la prueba API. Revisá la configuración y el ambiente seleccionado.')
  return ''
}
