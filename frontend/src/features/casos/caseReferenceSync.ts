import { API_BASE } from '../../app/constants'
import type { I18nContextValue } from '../../i18n'

export async function linkSavedStepAttachments(savedCase: any, newTestSteps: any[], fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>, t: I18nContextValue['t']) {
    if (!savedCase?.id) throw new Error(t('casos.saveCaseFallback'))
    const response = await fetchWithAuth(`${API_BASE}/casos/${savedCase.id}`)
    if (!response.ok) throw new Error(t('casos.referenceSyncFailed'))
    const caseWithSteps = await response.json()
    const stepsByNumber = new Map((caseWithSteps.pasos || []).map((step: any) => [step.numero_paso, step]))
    const validSteps = newTestSteps.filter(step => step.action.trim() || step.expected.trim() || step.data.trim())
    for (const [index, formStep] of validSteps.entries()) {
      const savedStep: any = stepsByNumber.get(index + 1)
      if (!savedStep?.id) throw new Error(t('casos.referenceSyncFailed'))
      const linksByKey = new Map([
        ...(formStep.actionAttachments || []).map(attachment => ({ attachment, tipo: 'ACTION_REFERENCE' })),
        ...(formStep.expectedAttachments || []).map(attachment => ({ attachment, tipo: 'EXPECTED_REFERENCE' }))
      ].filter(link => link.attachment?.id).map(link => [`${link.attachment.id}:${link.tipo}`, link]))
      const links = Array.from(linksByKey.values())
      const linkResponse = await fetchWithAuth(`${API_BASE}/pasos/${savedStep.id}/references/`, {
        method: 'PUT', body: JSON.stringify({ attachments: links.map(link => ({ attachment_id: link.attachment.id, tipo: link.tipo })) })
      })
      if (!linkResponse.ok) {
        const error = await linkResponse.json().catch(() => null)
        throw new Error(error?.detail || t('casos.referenceSyncFailed'))
      }
    }
  }
