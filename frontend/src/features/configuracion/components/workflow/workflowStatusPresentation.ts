import type { TranslationKey } from '../../../../i18n'

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string

const statusKeys: Record<string, TranslationKey> = {
  DRAFT: 'configuracion.workflowStatusDraft', BORRADOR: 'configuracion.workflowStatusDraft',
  ACTIVE: 'configuracion.workflowStatusActive', ACTIVO: 'configuracion.workflowStatusActive',
  PUBLISHED: 'configuracion.workflowStatusPublished', PUBLICADO: 'configuracion.workflowStatusPublished',
  ARCHIVED: 'configuracion.workflowStatusArchived', ARCHIVADO: 'configuracion.workflowStatusArchived',
  PENDING: 'configuracion.workflowStatusPending', PENDIENTE: 'configuracion.workflowStatusPending',
  SUCCESS: 'configuracion.workflowStatusSuccess', PASSED: 'configuracion.workflowStatusSuccess',
  FAILED: 'configuracion.workflowStatusFailed', ERROR: 'configuracion.workflowStatusFailed', INVALID: 'configuracion.workflowStatusInvalid',
  BLOCKED: 'configuracion.workflowStatusBlocked', RETRYABLE: 'configuracion.workflowStatusRetryable',
  SKIPPED: 'configuracion.workflowStatusSkipped', CANCELLED: 'configuracion.workflowStatusCancelled',
  EJECUTANDO_AI: 'configuracion.workflowStatusInProgress', RUNNING: 'configuracion.workflowStatusInProgress',
  IN_PROGRESS: 'configuracion.workflowStatusInProgress',
}

export function workflowStatusLabel(value: unknown, t: Translate, fallback = 'configuracion.workflowStatusUnknown' as TranslationKey) {
  const raw = String(value || '').trim()
  const key = statusKeys[raw.toUpperCase()]
  return key ? t(key) : raw || t(fallback)
}

const agentStatusKeys: Record<string, TranslationKey> = {
  OPERATIONAL: 'configuracion.agentStatusOperational', EXPERIMENTAL: 'configuracion.agentStatusExperimental',
  DEPRECATED: 'configuracion.agentStatusDeprecated', REQUIRES_CONFIGURATION: 'configuracion.agentStatusRequiresConfiguration', ACTIVE: 'configuracion.workflowStatusActive', INACTIVE: 'configuracion.inactive',
}

export function agentStatusLabel(value: unknown, t: Translate) {
  const raw = String(value || '').trim()
  const key = agentStatusKeys[raw.toUpperCase()]
  return key ? t(key) : raw || t('configuracion.workflowStatusUnknown')
}
