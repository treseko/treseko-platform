import type {
  BrowserElementSnapshot,
  BrowserObservation,
  QAEngineStep,
  StepAssertion,
  StepAssertionResult,
  StepContract,
  StrictAIAction,
} from './action-types.ts';

import { elementCorpus, normalizeText } from './step-contract-base.ts';
import { buildStepContract } from './step-contract-assertions.ts';

function corpus(observation: Pick<BrowserObservation, 'url' | 'title' | 'visibleText' | 'bodyText' | 'elements'>): string {
  return normalizeText([
    observation.url, observation.title, observation.bodyText, ...observation.visibleText,
    ...observation.elements.map((element) => elementCorpus(element)),
  ].join(' '));
}

function matchingElement(observation: BrowserObservation, target: string): BrowserElementSnapshot | undefined {
  const expected = normalizeText(target);
  if (expected === 'formulario') return observation.elements.find((element) => element.visible && element.editable);
  return observation.elements.find((element) => element.visible && elementCorpus(element).includes(expected));
}

function containsNormalizedPhrase(value: string, expected: unknown): boolean {
  const phrase = normalizeText(expected).trim();
  if (!phrase) return false;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`).test(normalizeText(value));
}

export function evaluateStepContract(
  contract: StepContract,
  before: Pick<BrowserObservation, 'url'>,
  after: BrowserObservation,
): { ok: boolean; conclusive: boolean; reason: string; results: StepAssertionResult[] } {
  const text = corpus(after);
  const results = contract.assertions.map((assertion): StepAssertionResult => {
    let ok = false;
    let actual = '';
    switch (assertion.type) {
      case 'text_contains':
        ok = text.includes(normalizeText(assertion.expected));
        break;
      case 'text_contains_any':
        ok = (assertion.alternatives || []).some((value) => text.includes(normalizeText(value)));
        break;
      case 'element_contains': {
        const element = matchingElement(after, assertion.target || '');
        actual = element ? elementCorpus(element) : '';
        ok = Boolean(element && containsNormalizedPhrase(actual, assertion.expected));
        break;
      }
      case 'url_matches':
        ok = normalizeText(after.url).includes(normalizeText(assertion.expected));
        actual = after.url;
        break;
      case 'url_not_matches':
        ok = !normalizeText(after.url).includes(normalizeText(assertion.expected));
        actual = after.url;
        break;
      case 'url_changed':
        ok = normalizeText(before.url) !== normalizeText(after.url);
        actual = after.url;
        break;
      case 'http_status': {
        const match = normalizeText(after.bodyText).match(/(?:status(?: code)?|codigo http)\s*[:=]?\s*(\d{3})/);
        actual = match?.[1] || '';
        ok = Number(actual) === Number(assertion.expected);
        break;
      }
      case 'json_field_equals': {
        try {
          const jsonText = after.bodyText.match(/\{[\s\S]*\}/)?.[0] || '';
          const parsed = JSON.parse(jsonText);
          const value = String(assertion.target || '').split('.').reduce((current: any, key) => current?.[key], parsed);
          actual = String(value ?? '');
          ok = actual === String(assertion.expected);
        } catch { ok = false; }
        break;
      }
      case 'element_count': {
        const target = normalizeText(assertion.target || '');
        const targetPattern = target.includes('_')
          ? new RegExp(`(?:^|\\s)${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s)`)
          : null;
        let count = after.elements.filter((element) => {
          if (!element.visible || !target) return element.visible;
          const value = elementCorpus(element);
          return targetPattern ? targetPattern.test(value) : value.includes(target);
        }).length;
        if (count === 0 && target) {
          const singular = target.replace(/s$/, '');
          const bodyMatch = normalizeText(after.bodyText).match(new RegExp(`\\b(\\d+)\\s+${singular}s?\\b`));
          if (bodyMatch?.[1]) count = Number(bodyMatch[1]);
        }
        actual = String(count);
        ok = assertion.comparator === 'at_least' ? count >= Number(assertion.expected) : count === Number(assertion.expected);
        break;
      }
      case 'field_required': {
        const element = matchingElement(after, assertion.target || '');
        actual = element ? `${Boolean(element.required)}/${String(element.valid)}` : 'missing';
        ok = Boolean(element?.required && element.valid === false);
        break;
      }
      case 'option_selected': {
        const element = matchingElement(after, assertion.target || '');
        actual = (element?.selectedValues || []).join(',');
        ok = (element?.selectedValues || []).some((value) => normalizeText(value) === normalizeText(assertion.expected));
        break;
      }
      case 'checkbox_checked': {
        const element = matchingElement(after, assertion.target || '');
        actual = String(Boolean(element?.checked));
        ok = Boolean(element?.checked);
        break;
      }
      case 'button_enabled': {
        const element = matchingElement(after, assertion.target || '');
        actual = element ? String(!element.disabled) : 'missing';
        ok = Boolean(element && !element.disabled);
        break;
      }
      case 'images_loaded': {
        const images = after.elements.filter((element) => element.tag === 'img');
        const broken = images.filter((element) => !element.imageComplete || Number(element.naturalWidth || 0) <= 0);
        actual = `${images.length - broken.length}/${images.length}`;
        ok = images.length > 0 && broken.length === 0;
        break;
      }
      case 'element_visible':
      case 'element_value': {
        const element = matchingElement(after, assertion.target || '');
        actual = element?.value || element?.text || '';
        ok = assertion.type === 'element_visible'
          ? Boolean(element)
          : Boolean(element && String(element.value || '') === String(assertion.expected || ''));
        break;
      }
    }
    return {
      assertion,
      ok,
      reason: `${assertion.type} ${ok ? 'cumplida' : 'no cumplida'}${actual ? ` (observado: ${actual})` : ''}`,
    };
  });
  const failed = results.filter((result) => !result.ok);
  const conclusive = failed.length > 0 || (contract.coverage === 'full' && results.length > 0);
  const reason = results.length === 0
    ? 'El resultado esperado requiere auditoria semantica; no se reconocieron aserciones tipadas.'
    : failed.length
      ? failed.map((result) => result.reason).join(' | ')
      : contract.coverage === 'full'
        ? `Contrato comprobado: ${results.length} asercion(es) cumplidas.`
        : `Aserciones reconocidas cumplidas, pero quedan ${contract.unresolved_fragments.length} fragmento(s) para auditoria semantica.`;
  return { ok: failed.length === 0, conclusive, reason, results };
}
