export type FeatureLookup = (featureId: string) => boolean

export const PREMIUM_BACKEND_MESSAGE = 'Esta funcion esta disponible en Treseko Premium.'

export function featureEnabled(hasFeature: FeatureLookup | undefined, featureId: string, fallback = true) {
  return hasFeature ? hasFeature(featureId) : fallback
}

export function isPremiumBackendMessage(message?: string | null) {
  return Boolean(message && message.includes('disponible en Treseko Premium'))
}

export function humanizePremiumError(message?: string | null) {
  if (isPremiumBackendMessage(message)) {
    return 'Esta funcion requiere Treseko Premium. Instala una licencia que incluya esta capacidad para usarla.'
  }
  return message || 'No se pudo completar la operacion.'
}
