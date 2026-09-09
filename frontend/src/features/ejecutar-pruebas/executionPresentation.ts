import type { TranslationKey } from '../../i18n'

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string

const statusKeys: Record<string, TranslationKey> = {
  PASO: 'ejecutarPruebas.pass', OK: 'ejecutarPruebas.pass', PASSED: 'ejecutarPruebas.pass',
  FALLO: 'ejecutarPruebas.fail', FALLIDO: 'ejecutarPruebas.fail', FAILED: 'ejecutarPruebas.fail',
  BLOQUEADO: 'ejecutarPruebas.blocked', BLOCKED: 'ejecutarPruebas.blocked',
  'EN CURSO': 'ejecutarPruebas.inProgress', IN_PROGRESS: 'ejecutarPruebas.inProgress', RUNNING: 'ejecutarPruebas.inProgress',
  EJECUTANDO_AI: 'ejecutarPruebas.inProgress', REQUIERE_REVISION: 'ejecutarPruebas.requiresReview',
  SKIPPED: 'ejecutarPruebas.skipped', OMITIDO: 'ejecutarPruebas.skipped',
  ERROR: 'ejecutarPruebas.error', TIMEOUT: 'ejecutarPruebas.timeout',
  SIN_CORRER: 'ejecutarPruebas.pending', PENDIENTE: 'ejecutarPruebas.pending',
}

export function executionStatusLabel(value: unknown, t: Translate, fallback = 'ejecutarPruebas.notAvailable' as TranslationKey) {
  const normalized = String(value || '').toUpperCase()
  return statusKeys[normalized] ? t(statusKeys[normalized]) : (value ? String(value) : t(fallback))
}

export function executionPriorityLabel(value: unknown, t: Translate) {
  const key: Record<string, TranslationKey> = { ALTA: 'ejecutarPruebas.priorityHigh', MEDIA: 'ejecutarPruebas.priorityMedium', BAJA: 'ejecutarPruebas.priorityLow', CRITICA: 'ejecutarPruebas.priorityCritical' }
  const normalized = String(value || '').toUpperCase()
  return key[normalized] ? t(key[normalized]) : (value ? String(value) : t('ejecutarPruebas.notAvailable'))
}

export function executionLabel(key: TranslationKey, t: Translate) { return t(key) }
