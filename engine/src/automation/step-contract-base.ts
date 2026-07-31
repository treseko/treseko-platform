import type {
  BrowserElementSnapshot,
  BrowserObservation,
  QAEngineStep,
  StepAssertion,
  StepAssertionResult,
  StepContract,
  StrictAIAction,
} from './action-types.ts';

export type StepDataMap = Record<string, string>;


export function normalizeText(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Parses legacy key=value step data without letting one value consume the next
 * key. Values may contain spaces and can be separated by whitespace, commas,
 * semicolons or new lines.
 */
export function parseStepData(value: unknown): StepDataMap {
  const text = String(value || '').trim();
  if (!text) return {};
  const result: StepDataMap = {};
  const keyPattern = /\b([a-zA-Z_][\w.-]*)\s*[:=]\s*/g;
  const matches = Array.from(text.matchAll(keyPattern));
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    if (!match) continue;
    const key = String(match[1] || '').toLowerCase();
    const valueStart = Number(match.index || 0) + match[0].length;
    const nextStart = index + 1 < matches.length ? Number(matches[index + 1]?.index ?? text.length) : text.length;
    const rawValue = text.slice(valueStart, nextStart).replace(/[\s,;]+$/g, '');
    result[key] = unquote(rawValue);
  }
  return result;
}

export function stepDataValue(step: QAEngineStep, keys: string[]): string {
  const sources = [parseStepData(step.data || ''), parseStepData(step.action || '')];
  for (const values of sources) {
    for (const key of keys) {
      const normalized = key.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(values, normalized)) return values[normalized] ?? '';
    }
  }
  return '';
}

export function hasStepDataKey(step: QAEngineStep, keys: string[]): boolean {
  const values = parseStepData(`${step.data || ''}\n${step.action || ''}`);
  return keys.some((key) => Object.prototype.hasOwnProperty.call(values, key.toLowerCase()));
}

export function elementCorpus(element: BrowserElementSnapshot): string {
  return normalizeText([
    element.name,
    element.label,
    element.text,
    element.placeholder,
    element.title,
    element.role,
    element.type,
  ].filter(Boolean).join(' '));
}
