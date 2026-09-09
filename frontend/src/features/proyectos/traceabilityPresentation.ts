import type { I18nContextValue } from '../../i18n/types'

type Translate = I18nContextValue['t']

const requirementStateKeys: Record<string, string> = {
  BORRADOR: 'traceabilityRequirementStateDraft',
  ACTIVO: 'traceabilityRequirementStateActive',
  EN_REVISION: 'traceabilityRequirementStateInReview',
  CUMPLIDO: 'traceabilityRequirementStateCompleted',
  ARCHIVADO: 'traceabilityRequirementStateArchived',
}

const storyStateKeys: Record<string, string> = {
  BORRADOR: 'traceabilityStoryStateDraft',
  LISTA_PARA_QA: 'traceabilityStoryStateReadyForQa',
  EN_PRUEBA: 'traceabilityStoryStateInTest',
  ACEPTADA: 'traceabilityStoryStateAccepted',
  ARCHIVADA: 'traceabilityStoryStateArchived',
}

const priorityKeys: Record<string, string> = {
  ALTA: 'traceabilityPriorityHigh',
  MEDIA: 'traceabilityPriorityMedium',
  BAJA: 'traceabilityPriorityLow',
}

function translateKnownValue(t: Translate, key: string | undefined, rawValue: string) {
  return key ? t(`proyectos.${key}`) : rawValue
}

export function requirementStateLabel(t: Translate, state: string) {
  return translateKnownValue(t, requirementStateKeys[state], state)
}

export function storyStateLabel(t: Translate, state: string) {
  return translateKnownValue(t, storyStateKeys[state], state)
}

export function priorityLabel(t: Translate, priority: string) {
  return translateKnownValue(t, priorityKeys[priority], priority)
}
