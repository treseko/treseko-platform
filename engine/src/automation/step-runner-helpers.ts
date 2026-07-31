import type { Page } from 'playwright';
import type { BrowserObservation, ExecutionCheckpoint, QAEngineStep, StepContract, StrictAIAction, StructuredHistoryItem } from './action-types.ts';
import { normalizeUrl } from './action-executor.ts';
import { observeBrowser } from './observation.ts';
import { buildStepContract, evaluateStepContract, parseStepData, stepDataValue } from './step-contract.ts';
import { interpretStepData } from './context-data-interpreter.ts';

export function stepGoal(task: string, step: QAEngineStep, contract: StepContract): string {
  return [
    `Caso: ${task}`,
    `Paso ${step.number}`,
    `Accion esperada: ${step.action || '-'}`,
    `Datos normalizados: ${step.data || '-'}`,
    `Resultado esperado: ${step.expected || '-'}`,
    `Contrato verificable: ${contract.assertions.map((item) => `${item.type}:${item.target || item.expected || item.alternatives?.join('|') || '-'}`).join(', ') || 'sin aserciones tipadas'}`,
    `Cobertura: ${contract.coverage}`,
    `Pendiente de evaluacion semantica: ${contract.unresolved_fragments.join(' | ') || 'nada'}`,
  ].join('\n');
}

export function summarizeHistory(history: StructuredHistoryItem[]): string {
  return history.slice(-8).map((item) => {
    const status = item.execution.ok ? 'OK' : 'ERROR';
    const target = item.action.target_ref || (item.action.action === 'click_at' ? `${item.action.x},${item.action.y}` : '');
    const checkpoint = item.checkpoint
      ? ` checkpoint=${item.checkpoint.contract_coverage}/${item.checkpoint.recoverable ? 'recuperable' : 'terminal'}`
      : '';
    return `Paso ${item.step_number} intento ${item.attempt}: ${item.action.action} ${target} ${item.action.value || ''} -> ${status}: ${item.execution.message}${checkpoint}`;
  }).join('\n') || 'Sin acciones previas.';
}

export function latestCheckpointContext(history: StructuredHistoryItem[]): string {
  const latest = [...history].reverse().find((item) => item.checkpoint)?.checkpoint;
  if (!latest) return 'Sin checkpoint previo.';
  return [
    `Checkpoint paso ${latest.step_number}, intento ${latest.attempt}`,
    `URL: ${latest.url}`,
    `Titulo: ${latest.title}`,
    `Cobertura del contrato: ${latest.contract_coverage}`,
    `Aserciones: ${latest.assertion_results.map((item) => `${item.assertion.type}=${item.ok ? 'OK' : 'FALLO'}`).join(', ') || 'sin aserciones tipadas'}`,
    `Recuperable: ${latest.recoverable ? 'si' : 'no'}`,
  ].join('\n');
}

export function actionExplicitlySubmits(step: QAEngineStep): boolean {
  const action = normalizeText(step.action || '');
  return /\b(enviar|submit|confirmar envio|iniciar sesion)\b/.test(action);
}

export function buildCheckpoint(
  step: QAEngineStep,
  attempt: number,
  contract: StepContract,
  before: Pick<BrowserObservation, 'url'>,
  after: BrowserObservation,
  screenshotAvailable: boolean,
): ExecutionCheckpoint {
  const evaluation = evaluateStepContract(contract, before, after);
  return {
    step_number: step.number,
    attempt,
    created_at: new Date().toISOString(),
    url: after.url,
    title: after.title,
    ready_state: after.readyState,
    visible_text_excerpt: after.visibleText.slice(0, 20),
    assertion_results: evaluation.results,
    contract_coverage: contract.coverage,
    screenshot_available: screenshotAvailable,
    recoverable: !evaluation.conclusive || !evaluation.ok,
  };
}

export function statusFromAction(action: StrictAIAction, ok: boolean): 'PASO' | 'FALLO' | 'BLOQUEADO' {
  if (ok && action.action !== 'fail' && action.action !== 'blocked') return 'PASO';
  if (action.action === 'blocked') return 'BLOQUEADO';
  return 'FALLO';
}

export function isBrowserOpenStep(step: QAEngineStep): boolean {
  const text = `${step.action || ''} ${step.data || ''}`.toLowerCase();
  return /(abrir|abre|open).*(navegador|browser|chrome|crome|firefox|edge)/.test(text) || /(navegador|browser|chrome|crome|firefox|edge).*(abrir|abre|open)/.test(text);
}

export function extractStepUrl(step: QAEngineStep): string {
  const text = `${step.action || ''}\n${step.data || ''}`.trim();
  if (!text) return '';
  const keyMatch = text.match(/\b(?:url|base_url|url_base)\s*[:=]\s*([^\s,;]+)/i);
  const directMatch = text.match(/\bhttps?:\/\/[^\s,;]+|\b(?:www\.)[^\s,;]+/i);
  const candidate = keyMatch?.[1] || directMatch?.[0] || '';
  return normalizeUrl(candidate.replace(/^["']|["']$/g, ''));
}

export function isUrlNavigationStep(step: QAEngineStep): boolean {
  const text = `${step.action || ''} ${step.data || ''}`.toLowerCase();
  return Boolean(extractStepUrl(step)) && /(ingresar|abrir|navegar|cargar|visitar|ir a|go to|navigate|url)/i.test(text);
}

export function confidenceFromHistory(history: StructuredHistoryItem[]): number {
  const values = history
    .map((item) => Number(item.action?.confidence || 0))
    .filter((value) => value > 0);
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function normalizeText(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function evidenceTerms(step: QAEngineStep, action: StrictAIAction): string[] {
  const keyValues = Object.values(parseStepData(step.data)).filter(Boolean);
  const quotedExpected = Array.from(String(step.expected || '').matchAll(/["'“”]([^"'“”]{2,120})["'“”]/g))
    .map((match) => String(match[1] || '').trim())
    .filter(Boolean);
  const source = String([keyValues.join(' '), action.value || '', quotedExpected.join(' ')].filter(Boolean).join(' ') || step.data || '').trim();
  if (!source || source === '-') return [];
  return Array.from(new Set(
    normalizeText(source)
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 3)
  )).slice(0, 5);
}

export function observationCorpus(observation: Pick<BrowserObservation, 'url' | 'title' | 'visibleText' | 'bodyText' | 'elements'>): string {
  const elementText = observation.elements.map((el) => [
    el.name,
    el.label,
    el.text,
    el.value,
    el.placeholder,
    el.title,
    el.role,
  ].filter(Boolean).join(' '));
  return normalizeText([observation.url, observation.title, observation.bodyText, ...observation.visibleText, ...elementText].join(' '));
}

export function expectsDynamicResults(step: QAEngineStep): boolean {
  const text = normalizeText(`${step.action || ''} ${step.expected || ''}`);
  return /(aparece|aparecen|resultado|resultados|sugerencia|sugerencias|desplegable|dropdown|lista|opciones|filtrar|filtro|quedan|contador)/.test(text);
}

export function expectsVisibleOutcome(step: QAEngineStep, action: StrictAIAction): boolean {
  if (['assert_visible', 'assert_text'].includes(action.action)) return true;
  if (action.action === 'navigate') return true;
  if (action.action === 'finish') return /["'“”][^"'“”]{2,120}["'“”]/.test(String(step.expected || ''));
  if (action.action === 'type') return expectsDynamicResults(step);
  if (action.action === 'fill_form') {
    const text = normalizeText(`${step.action || ''} ${step.expected || ''}`);
    return Boolean(action.submit_after_type)
      || /(ingreso|ingresar|completar|campos?|login|sesion|area segura|mensaje|muestra|confirma)/.test(text);
  }
  if (action.action === 'wait') {
    const text = normalizeText(`${step.action || ''} ${step.expected || ''}`);
    return /(abrir|abre|navegar|resultado|validar|confirmar|verificar)/.test(text);
  }
  if (!['click', 'click_at', 'press', 'select'].includes(action.action)) return false;
  const text = normalizeText(`${step.action || ''} ${step.expected || ''}`);
  return /(visualiza|aparece|muestra|informacion|informacion|pagina|navega|abre|resultado)/.test(text);
}

export const COUNT_WORDS: Record<string, number> = {
  'un': 1,
  'uno': 1,
  'una': 1,
  'solo': 1,
  'dos': 2,
  'tres': 3,
  'cuatro': 4,
  'cinco': 5,
};

export const COUNT_STOP_WORDS = new Set([
  'aparece',
  'aparecen',
  'boton',
  'botones',
  'campo',
  'campos',
  'elemento',
  'elementos',
  'visible',
  'visibles',
  'queda',
  'quedan',
  'solo',
  'sola',
  'un',
  'uno',
  'una',
  'dos',
  'tres',
  'cuatro',
  'cinco',
]);

export function expectedCountRequirement(step: QAEngineStep): { term: string; count: number; comparator: 'at_least' | 'exact' } | null {
  const text = normalizeText(`${step.action || ''} ${step.expected || ''}`);
  const countMatch = text.match(/\b(un solo|una sola|exactamente\s+(?:[1-5]|un|uno|una|dos|tres|cuatro|cinco)|[2-5]|dos|tres|cuatro|cinco)\b/);
  if (!countMatch) return null;
  const rawCount = String(countMatch[1] || '').replace(/^exactamente\s+/i, '');
  const countWord = rawCount.split(/\s+/)[0] || '';
  const count = Number.isFinite(Number(rawCount)) ? Number(rawCount) : (COUNT_WORDS[countWord] ?? 0);
  if (!Number.isFinite(count) || count <= 0) return null;
  const quoted = text.match(/["'“”]([^"'“”]{2,40})["'“”]/);
  const words = normalizeText(quoted?.[1] || text)
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !COUNT_STOP_WORDS.has(word));
  const term = words.reverse().find(Boolean);
  if (!term) return null;
  const comparator = /(queda|quedan|un solo|una sola|exactamente)/.test(text) ? 'exact' : 'at_least';
  return { term, count, comparator };
}

export function countVisibleTerm(observation: Pick<BrowserObservation, 'visibleText' | 'elements'>, term: string): number {
  const elementMatches = observation.elements.filter((el) => {
    if (!el.visible) return false;
    const elementCorpus = normalizeText([el.name, el.label, el.text, el.value, el.placeholder, el.title].filter(Boolean).join(' '));
    return elementCorpus.includes(term);
  }).length;
  if (elementMatches > 0) return elementMatches;
  return observation.visibleText.reduce((total, text) => {
    const matches = normalizeText(text).match(new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'));
    return total + (matches?.length || 0);
  }, 0);
}

export function hasDynamicResultEvidence(step: QAEngineStep, action: StrictAIAction, observation: BrowserObservation): boolean {
  if (action.action !== 'type' || !expectsDynamicResults(step)) return true;
  const terms = evidenceTerms(step, action);
  if (!terms.length) return true;
  const visibleTextCorpus = normalizeText(observation.visibleText.join(' '));
  if (terms.some((term) => visibleTextCorpus.includes(term))) return true;
  return observation.elements.some((el) => {
    if (el.ref === action.target_ref || el.editable) return false;
    const elementCorpus = normalizeText([el.name, el.label, el.text, el.value, el.placeholder, el.title].filter(Boolean).join(' '));
    return terms.some((term) => elementCorpus.includes(term));
  });
}
