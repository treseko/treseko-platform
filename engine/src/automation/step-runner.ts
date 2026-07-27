import type { Page } from 'playwright';
import type { AIClient, AIResult } from '../ai/client.ts';
import type { BrowserObservation, ExecutionCheckpoint, QAEngineStep, StepContract, StepRunResult, StrictAIAction, StructuredHistoryItem } from './action-types.ts';
import { executeStrictAction, normalizeAction, normalizeUrl, shouldUseCoordinateClickFallback, toCoordinateClickFallback, validateAction } from './action-executor.ts';
import { formatObservation, observeBrowser } from './observation.ts';
import { buildStepContract, evaluateStepContract, inferConventionalUiAction, inferStructuredAction, parseStepData, stepDataValue } from './step-contract.ts';
import { displayResolvedInput, interpretStepData } from './context-data-interpreter.ts';

export interface StepRunnerOptions {
  executionId: string;
  task: string;
  expected?: string;
  maxAttempts?: number;
  agentWorkflow?: any[];
  contextData?: Record<string, any>;
  emit?: (event: string, data: any) => void;
  logger?: { log: (source: string, level: string, message: string, details?: Record<string, unknown>) => void };
}

export interface RunStepsResult {
  steps: StepRunResult[];
  history: StructuredHistoryItem[];
  visited_urls: string[];
  errors: string[];
  checkpoints: ExecutionCheckpoint[];
}

function stepGoal(task: string, step: QAEngineStep, contract: StepContract): string {
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

function summarizeHistory(history: StructuredHistoryItem[]): string {
  return history.slice(-8).map((item) => {
    const status = item.execution.ok ? 'OK' : 'ERROR';
    const target = item.action.target_ref || (item.action.action === 'click_at' ? `${item.action.x},${item.action.y}` : '');
    const checkpoint = item.checkpoint
      ? ` checkpoint=${item.checkpoint.contract_coverage}/${item.checkpoint.recoverable ? 'recuperable' : 'terminal'}`
      : '';
    return `Paso ${item.step_number} intento ${item.attempt}: ${item.action.action} ${target} ${item.action.value || ''} -> ${status}: ${item.execution.message}${checkpoint}`;
  }).join('\n') || 'Sin acciones previas.';
}

function latestCheckpointContext(history: StructuredHistoryItem[]): string {
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

function actionExplicitlySubmits(step: QAEngineStep): boolean {
  const action = normalizeText(step.action || '');
  return /\b(enviar|submit|confirmar envio|iniciar sesion)\b/.test(action);
}

function buildCheckpoint(
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

function statusFromAction(action: StrictAIAction, ok: boolean): 'PASO' | 'FALLO' | 'BLOQUEADO' {
  if (ok && action.action !== 'fail' && action.action !== 'blocked') return 'PASO';
  if (action.action === 'blocked') return 'BLOQUEADO';
  return 'FALLO';
}

function isBrowserOpenStep(step: QAEngineStep): boolean {
  const text = `${step.action || ''} ${step.data || ''}`.toLowerCase();
  return /(abrir|abre|open).*(navegador|browser|chrome|crome|firefox|edge)/.test(text) || /(navegador|browser|chrome|crome|firefox|edge).*(abrir|abre|open)/.test(text);
}

function extractStepUrl(step: QAEngineStep): string {
  const text = `${step.action || ''}\n${step.data || ''}`.trim();
  if (!text) return '';
  const keyMatch = text.match(/\b(?:url|base_url|url_base)\s*[:=]\s*([^\s,;]+)/i);
  const directMatch = text.match(/\bhttps?:\/\/[^\s,;]+|\b(?:www\.)[^\s,;]+/i);
  const candidate = keyMatch?.[1] || directMatch?.[0] || '';
  return normalizeUrl(candidate.replace(/^["']|["']$/g, ''));
}

function isUrlNavigationStep(step: QAEngineStep): boolean {
  const text = `${step.action || ''} ${step.data || ''}`.toLowerCase();
  return Boolean(extractStepUrl(step)) && /(ingresar|abrir|navegar|cargar|visitar|ir a|go to|navigate|url)/i.test(text);
}

function confidenceFromHistory(history: StructuredHistoryItem[]): number {
  const values = history
    .map((item) => Number(item.action?.confidence || 0))
    .filter((value) => value > 0);
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function normalizeText(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function evidenceTerms(step: QAEngineStep, action: StrictAIAction): string[] {
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

function observationCorpus(observation: Pick<BrowserObservation, 'url' | 'title' | 'visibleText' | 'bodyText' | 'elements'>): string {
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

function expectsDynamicResults(step: QAEngineStep): boolean {
  const text = normalizeText(`${step.action || ''} ${step.expected || ''}`);
  return /(aparece|aparecen|resultado|resultados|sugerencia|sugerencias|desplegable|dropdown|lista|opciones|filtrar|filtro|quedan|contador)/.test(text);
}

function expectsVisibleOutcome(step: QAEngineStep, action: StrictAIAction): boolean {
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

const COUNT_WORDS: Record<string, number> = {
  'un': 1,
  'uno': 1,
  'una': 1,
  'solo': 1,
  'dos': 2,
  'tres': 3,
  'cuatro': 4,
  'cinco': 5,
};

const COUNT_STOP_WORDS = new Set([
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

function expectedCountRequirement(step: QAEngineStep): { term: string; count: number; comparator: 'at_least' | 'exact' } | null {
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

function countVisibleTerm(observation: Pick<BrowserObservation, 'visibleText' | 'elements'>, term: string): number {
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

function hasDynamicResultEvidence(step: QAEngineStep, action: StrictAIAction, observation: BrowserObservation): boolean {
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

function extractKeyValue(step: QAEngineStep, keys: string[]): string {
  return stepDataValue(step, keys);
}

function extractExpectedFalseClaim(step: QAEngineStep): string {
  return extractKeyValue(step, ['expected_false_claim', 'afirmacion_falsa', 'false_claim', 'claim_falso']);
}

function findSearchInput(observation: BrowserObservation): string {
  const candidates = observation.elements.filter((element) => {
    if (!element.visible || element.disabled || !element.editable) return false;
    const corpus = normalizeText([
      element.role,
      element.name,
      element.label,
      element.placeholder,
      element.title,
      element.type,
    ].filter(Boolean).join(' '));
    return element.role === 'searchbox'
      || element.type === 'search'
      || /(search|buscar|busqueda|consulta|query)/.test(corpus);
  });
  return candidates[0]?.ref || observation.elements.find((element) => element.visible && !element.disabled && element.editable)?.ref || '';
}

function findCredentialField(observation: BrowserObservation, kind: 'username' | 'password'): string {
  const candidates = observation.elements.filter((element) => {
    if (!element.visible || element.disabled || !element.editable) return false;
    const corpus = normalizeText([
      element.role,
      element.name,
      element.label,
      element.placeholder,
      element.title,
      element.type,
    ].filter(Boolean).join(' '));
    if (kind === 'password') return element.type === 'password' || /password|contrase/.test(corpus);
    return element.type !== 'password' && /(username|usuario|email|login|user)/.test(corpus);
  });
  if (candidates[0]?.ref) return candidates[0].ref;
  const fallback = observation.elements.find((element) => (
    element.visible
    && !element.disabled
    && element.editable
    && (kind === 'password' ? element.type === 'password' : element.type !== 'password')
  ));
  return fallback?.ref || '';
}

function wordsForMatch(value: string): string[] {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3);
}

function findPreferredResultTarget(observation: BrowserObservation, preferred: string): string {
  const words = wordsForMatch(preferred);
  if (!words.length) return '';
  const candidates = observation.elements.filter((element) => {
    if (!element.visible || element.disabled || (!element.clickable && element.role !== 'link')) return false;
    const corpus = normalizeText([
      element.role,
      element.name,
      element.label,
      element.text,
      element.value,
      element.placeholder,
      element.title,
    ].filter(Boolean).join(' '));
    return words.every((word) => corpus.includes(word));
  });
  return candidates[0]?.ref || '';
}

function preferredWikipediaUrl(currentUrl: string, preferred: string): string {
  if (!preferred || !/wikipedia\.org/i.test(currentUrl)) return '';
  try {
    const url = new URL(currentUrl);
    const slug = preferred.trim().replace(/\s+/g, '_');
    return `${url.origin}/wiki/${encodeURIComponent(slug).replace(/%28/g, '(').replace(/%29/g, ')')}`;
  } catch {
    return '';
  }
}

function deterministicRecoveryAction(step: QAEngineStep, observation: BrowserObservation): StrictAIAction | null {
  const text = normalizeText(`${step.action || ''} ${step.data || ''} ${step.expected || ''}`);
  const expectedFalseClaim = extractExpectedFalseClaim(step);
  if (expectedFalseClaim) {
    const corpus = observationCorpus(observation);
    const claimWords = wordsForMatch(expectedFalseClaim);
    const claimLooksSupported = claimWords.length > 0 && claimWords.every((word) => corpus.includes(word));
    const action: StrictAIAction = {
      action: claimLooksSupported ? 'finish' : 'fail',
      value: expectedFalseClaim,
      reason: claimLooksSupported
        ? `La afirmacion negativa "${expectedFalseClaim}" aparece respaldada por el contenido visible.`
        : `Fallo funcional esperado: la pagina no respalda la afirmacion "${expectedFalseClaim}".`,
      confidence: 98,
      step_number: step.number,
    };
    if (step.expected) action.expected = step.expected;
    return action;
  }
  const username = extractKeyValue(step, ['username', 'usuario', 'user', 'email', 'login']);
  const password = extractKeyValue(step, ['password', 'contraseña', 'contrasena', 'pass']);
  if (username && password && /(login|sesion|iniciar|ingresar|credencial|usuario|password|contrase)/.test(text)) {
    const usernameTarget = findCredentialField(observation, 'username');
    const passwordTarget = findCredentialField(observation, 'password');
    if (usernameTarget && passwordTarget) {
      const shouldSubmit = /(iniciar\s+sesion|iniciar\s+login|login\s+valido|hacer\s+login|enviar|submit|ingreso exitoso|area segura)/.test(text);
      const action: StrictAIAction = {
        action: 'fill_form',
        fields: [
          { target_ref: usernameTarget, value: username },
          { target_ref: passwordTarget, value: password },
        ],
        submit_after_type: shouldSubmit,
        reason: shouldSubmit
          ? 'Recuperacion deterministica: completar credenciales y enviar formulario.'
          : 'Recuperacion deterministica: completar credenciales visibles.',
        confidence: 95,
        step_number: step.number,
      };
      if (step.expected) action.expected = step.expected;
      return action;
    }
  }

  const searchTerm = extractKeyValue(step, ['search_term', 'termino', 'term', 'query', 'busqueda']);
  if (searchTerm && /(buscar|busqueda|search)/.test(text)) {
    const target = findSearchInput(observation);
    if (target) {
      const action: StrictAIAction = {
        action: 'type',
        target_ref: target,
        value: searchTerm,
        submit_after_type: true,
        reason: `Recuperacion deterministica: escribir el termino de busqueda "${searchTerm}".`,
        confidence: 92,
        step_number: step.number,
      };
      if (step.expected) action.expected = step.expected;
      return action;
    }
  }

  const preferredResult = extractKeyValue(step, ['resultado_preferido', 'preferred_result', 'preferred', 'result']);
  if (preferredResult && /(abrir|abre|resultado|relevante|navegar)/.test(text)) {
    const target = findPreferredResultTarget(observation, preferredResult);
    if (target) {
      const action: StrictAIAction = {
        action: 'click',
        target_ref: target,
        reason: `Recuperacion deterministica: abrir el resultado preferido "${preferredResult}".`,
        confidence: 94,
        step_number: step.number,
      };
      if (step.expected) action.expected = step.expected;
      return action;
    }
    const url = preferredWikipediaUrl(observation.url, preferredResult);
    if (url) {
      const action: StrictAIAction = {
        action: 'navigate',
        value: url,
        reason: `Recuperacion deterministica: navegar al articulo preferido "${preferredResult}".`,
        confidence: 90,
        step_number: step.number,
      };
      if (step.expected) action.expected = step.expected;
      return action;
    }
  }

  if (/(validar|confirmar|verificar|registrar evidencia|buscar visualmente|observar|visual)/.test(text)) {
    const expectedText = extractKeyValue(step, ['expected_keyword', 'keyword', 'texto', 'text']);
    if (expectedText) {
      const action: StrictAIAction = {
        action: 'assert_text',
        value: expectedText,
        reason: `Recuperacion deterministica: validar texto visible "${expectedText}".`,
        confidence: 90,
        step_number: step.number,
      };
      if (step.expected) action.expected = step.expected;
      return action;
    }
    const corpus = observationCorpus(observation);
    const finishAction: StrictAIAction = {
      action: 'finish',
      reason: '',
      confidence: 90,
      step_number: step.number,
    };
    if (step.expected) finishAction.expected = step.expected;
    const expectedTerms = evidenceTerms(step, finishAction);
    const hasEvidence = expectedTerms.length === 0 || expectedTerms.some((term) => corpus.includes(term));
    if (hasEvidence && observation.readyState === 'complete') {
      const action: StrictAIAction = {
        action: 'finish',
        reason: 'Recuperacion deterministica: la pagina esta cargada y el snapshot contiene evidencia visual suficiente.',
        confidence: 88,
        step_number: step.number,
      };
      if (step.expected) action.expected = step.expected;
      return action;
    }
  }

  return null;
}

function isCompoundFlowStep(step: QAEngineStep): boolean {
  const action = normalizeText(step.action || '');
  return /\by\s+(?:abrir|hacer clic|luego|completar|finalizar)|(?:luego|despues)\s+en|menu.*(?:reset|logout)|back home.*menu|completar checkout|completar datos.*(?:continue|finalizar)|reemplazar.*(?:clic|login)/.test(action);
}

function needsCompoundContinuation(step: QAEngineStep, observation: BrowserObservation): boolean {
  const action = normalizeText(step.action || '');
  const url = normalizeText(observation.url);
  if (/completar checkout|completar datos.*finalizar/.test(action)) return !observationCorpus(observation).includes('thank you for your order');
  if (/checkout/.test(action) && /(abrir|agregar)/.test(action) && !/checkout-step-one\.html/.test(url)) return true;
  if (/(abrir.*carrito|agregar.*carrito)/.test(action) && !/cart\.html/.test(url)) return true;
  if (/continue shopping/.test(action) && !/inventory\.html/.test(url)) return true;
  if (/continue.*(?:luego|despues).*cancel/.test(action) && !/inventory\.html/.test(url)) return true;
  if (/back home.*menu.*logout/.test(action) && !/saucedemo\.com\/?$/.test(url)) return true;
  if (/menu.*reset app state/.test(action)) return observationCorpus(observation).includes('shopping_cart_badge');
  if (/reemplazar.*(?:clic|login)/.test(action) && !/inventory\.html/.test(url)) return true;
  return false;
}

async function waitForExpectedEvidence(page: Page, step: QAEngineStep, action: StrictAIAction, executionId?: string): Promise<BrowserObservation> {
  const shouldWait = (action.action === 'type' && expectsDynamicResults(step))
    || ['click', 'check', 'fill_form', 'select'].includes(action.action);
  const deadline = Date.now() + (shouldWait ? 3000 : 0);
  const initialUrl = page.url();
  let latest = await observeBrowser(page, executionId, step.number);
  if (!deadline) return latest;
  const contract = buildStepContract(step);

  while (Date.now() < deadline) {
    const evaluation = evaluateStepContract(contract, { url: initialUrl }, latest);
    if (evaluation.ok && evaluation.conclusive) return latest;
    if (!evaluation.conclusive && hasDynamicResultEvidence(step, action, latest)) return latest;
    await page.waitForTimeout(200);
    latest = await observeBrowser(page, executionId, step.number);
  }
  return latest;
}

function validateExpectedOutcome(
  step: QAEngineStep,
  before: Pick<BrowserObservation, 'url'>,
  after: Pick<BrowserObservation, 'url' | 'title' | 'visibleText' | 'bodyText' | 'elements'>
): { ok: boolean; reason: string; conclusive?: boolean } {
  const contract = buildStepContract(step);
  const evaluation = evaluateStepContract(contract, before, after as BrowserObservation);
  return {
    ok: evaluation.ok,
    reason: evaluation.reason,
    conclusive: evaluation.conclusive,
  };
}

function stepLooksActionable(step: QAEngineStep, observation: BrowserObservation): boolean {
  const text = normalizeText(`${step.action || ''} ${step.data || ''} ${step.expected || ''}`);
  const mentionsAction = /(ingresar|completar|escribir|tipear|buscar|seleccionar|click|clic|presionar|enviar|abrir|navegar|validar|confirmar|registrar|evidencia|visual|observar|verificar)/.test(text);
  if (!mentionsAction) return false;
  const hasUsableElement = observation.elements.some((element) => (
    element.visible
    && !element.disabled
    && (element.editable || element.clickable || ['button', 'link', 'textbox', 'combobox', 'searchbox'].includes(String(element.role || '').toLowerCase()))
  ));
  if (!hasUsableElement) return false;
  const hasStructuredData = /(username|usuario|user|email|password|contrase|search_term|query|termino|url|base_url)\s*[:=]/i.test(`${step.data || ''}`);
  const needsNoData = /(click|clic|presionar|abrir|navegar|validar|confirmar)/.test(text);
  return hasStructuredData || needsNoData || observation.elements.some((element) => element.editable);
}

function isActionableBlocked(action: StrictAIAction, step: QAEngineStep, observation: BrowserObservation): boolean {
  if (action.action !== 'blocked') return false;
  const reason = normalizeText(action.reason || '');
  const realBlocker = /(falta|faltan|missing|no existe|no esta disponible|no visible|sin dato|sin datos|imposible|no se puede|requiere credencial|requiere acceso)/.test(reason);
  return !realBlocker && stepLooksActionable(step, observation);
}

function getWorkflowAgent(workflow: any[] | undefined, id: string): any | undefined {
  return (workflow || []).find((item) => String(item?.id || '').toUpperCase() === id);
}

function retryLimitFromWorkflow(workflow: any[] | undefined, fallbackAttempts: number): number {
  const sentinel = getWorkflowAgent(workflow, 'SENTINEL');
  if (sentinel?.enabled === false) return 1;
  const retryLimit = Number(sentinel?.retry_limit);
  if (Number.isFinite(retryLimit)) {
    return Math.max(1, Math.min(6, retryLimit + 1));
  }
  return fallbackAttempts;
}

function conventionalUiInferenceEnabled(workflow: any[] | undefined): boolean {
  return (workflow || []).some((agent) => (
    agent?.enabled !== false
    && (agent?.config?.conventional_ui_inference === true || agent?.config_json?.conventional_ui_inference === true)
  ));
}

export async function runQaSteps(
  page: Page,
  ai: AIClient,
  steps: QAEngineStep[],
  options: StepRunnerOptions
): Promise<RunStepsResult> {
  const maxAttempts = retryLimitFromWorkflow(options.agentWorkflow, Math.max(1, options.maxAttempts || 2));
  const useConventionalUiInference = conventionalUiInferenceEnabled(options.agentWorkflow);
  const results: StepRunResult[] = [];
  const globalHistory: StructuredHistoryItem[] = [];
  const visitedUrls = new Set<string>();
  const errors: string[] = [];
  const checkpoints: ExecutionCheckpoint[] = [];

  for (const sourceStep of steps) {
    const resolvedData = interpretStepData(sourceStep.data, options.contextData || {});
    const step = resolvedData.normalizedData ? { ...sourceStep, data: resolvedData.normalizedData } : sourceStep;
    const contract = buildStepContract(step);
    const stepHistory: StructuredHistoryItem[] = [];
    let finalResult: StepRunResult | null = null;

    if (isBrowserOpenStep(step)) {
      const observation = await observeBrowser(page, options.executionId, step.number);
      const screenshot = await page.screenshot();
      const screenshotBase64 = screenshot.toString('base64');
      const item: StructuredHistoryItem = {
        step_number: step.number,
        attempt: 1,
        observation_before: {
          url: observation.url,
          title: observation.title,
          readyState: observation.readyState,
          loadingSignals: observation.loadingSignals,
        },
        observation_after: {
          url: observation.url,
          title: observation.title,
          readyState: observation.readyState,
          loadingSignals: observation.loadingSignals,
          visibleText: observation.visibleText,
          bodyText: observation.bodyText,
        },
        action: {
          action: 'finish',
          reason: 'El navegador ya esta abierto y la pagina inicial esta cargada.',
          confidence: 100,
          step_number: step.number,
          ...(step.expected ? { expected: step.expected } : {}),
        },
        execution: {
          ok: true,
          command: 'browser already initialized',
          message: 'Navegador disponible',
        },
        duration_ms: 0,
        screenshot_base64: screenshotBase64,
        validation: { ok: true, reason: 'Navegador disponible', conclusive: false },
        post_validation: { ok: true, reason: 'Pagina inicial cargada y observable', conclusive: false },
        contract,
      };
      item.checkpoint = buildCheckpoint(step, 1, contract, observation, observation, true);
      checkpoints.push(item.checkpoint);
      stepHistory.push(item);
      globalHistory.push(item);
      visitedUrls.add(observation.url);
      options.emit?.('step_result', {
        agent: 'BROWSER',
        step: step.number,
        status: 'PASO',
        screenshot: screenshotBase64,
        message: item.action.reason,
        action: item.action,
        confidence: item.action.confidence,
      });
      options.logger?.log('BROWSER', 'INFO', `Paso ${step.number}: navegador disponible`, {
        step: step.number,
        action: item.action,
        execution: item.execution,
        confidence: item.action.confidence,
      });
      results.push({
        number: step.number,
        status: 'PASO',
        observations: item.action.reason,
        screenshot_base64: screenshotBase64,
        history: stepHistory,
        contract,
        checkpoints: [item.checkpoint],
      });
      continue;
    }

    if (isUrlNavigationStep(step)) {
      const url = extractStepUrl(step);
      const observation = await observeBrowser(page, options.executionId, step.number);
      const startedAt = Date.now();
      const action: StrictAIAction = {
        action: 'navigate',
        value: url,
        reason: `Navegacion deterministica usando la URL del paso: ${url}`,
        confidence: 100,
        step_number: step.number,
        ...(step.expected ? { expected: step.expected } : {}),
      };
      const execution = await executeStrictAction(page, action);
      const afterObservation = await waitForExpectedEvidence(page, step, action, options.executionId);
      const postValidation = execution.ok
        ? validateExpectedOutcome(step, observation, afterObservation)
        : { ok: false, reason: execution.message, conclusive: false };
      visitedUrls.add(afterObservation.url);
      const afterScreenshot = await page.screenshot();
      const item: StructuredHistoryItem = {
        step_number: step.number,
        attempt: 1,
        observation_before: {
          url: observation.url,
          title: observation.title,
          readyState: observation.readyState,
          loadingSignals: observation.loadingSignals,
        },
        observation_after: {
          url: afterObservation.url,
          title: afterObservation.title,
          readyState: afterObservation.readyState,
          loadingSignals: afterObservation.loadingSignals,
          visibleText: afterObservation.visibleText,
          bodyText: afterObservation.bodyText,
        },
        action,
        execution,
        duration_ms: Date.now() - startedAt,
        screenshot_base64: afterScreenshot.toString('base64'),
        validation: { ok: true, reason: 'URL detectada en datos del paso', conclusive: false },
        post_validation: postValidation,
        contract,
      };
      item.checkpoint = buildCheckpoint(step, 1, contract, observation, afterObservation, Boolean(item.screenshot_base64));
      checkpoints.push(item.checkpoint);
      stepHistory.push(item);
      globalHistory.push(item);
      const status = !execution.ok ? 'BLOQUEADO' : postValidation.ok ? 'PASO' : 'FALLO';
      const message = execution.ok
        ? postValidation.reason
        : `No se pudo navegar a ${url}: ${execution.message}`;
      const failureCategory = status === 'PASO'
        ? 'passed'
        : /(falta|faltan|no se encontro|no visible|missing)/i.test(message)
          ? 'required_element_not_found'
          : !execution.ok ? 'navigation_error' : 'expected_result_not_met';
      if (status !== 'PASO') errors.push(`Paso ${step.number}: ${message}`);
      options.emit?.('step_result', {
        agent: 'SENTINEL',
        step: step.number,
        status,
        screenshot: item.screenshot_base64,
        message,
        reason: message,
        failure_category: failureCategory,
        action_summary: execution.command || action.action || 'No se ejecuto una accion',
        action_executed: Boolean(execution.ok && !['blocked', 'fail'].includes(String(action.action || '').toLowerCase())),
        url: afterObservation.url,
        confidence: action.confidence,
        contract,
        checkpoints: [item.checkpoint],
        deterministic: true,
        action,
        execution,
      });
      options.logger?.log('SENTINEL', execution.ok ? 'INFO' : 'ERROR', `Paso ${step.number}: ${message}`, {
        step: step.number,
        action,
        execution,
        validation: item.validation,
        post_validation: item.post_validation,
        confidence: action.confidence,
        duration_ms: item.duration_ms,
      });
      const navigationResult: StepRunResult = {
        number: step.number,
        status,
        observations: message,
        history: stepHistory,
        confidence: action.confidence,
      };
      if (item.screenshot_base64) navigationResult.screenshot_base64 = item.screenshot_base64;
      if (status !== 'PASO') {
        navigationResult.error_log = execution.ok ? postValidation.reason : (execution.error || execution.message);
        navigationResult.failure_category = execution.ok ? 'expected_result_not_met' : 'navigation_error';
      }
      results.push(navigationResult);
      if (status !== 'PASO') break;
      continue;
    }

    const stepMaxAttempts = isCompoundFlowStep(step) ? Math.max(maxAttempts, 6) : maxAttempts;
    for (let attempt = 1; attempt <= stepMaxAttempts; attempt++) {
      const observation = await observeBrowser(page, options.executionId, step.number);
      visitedUrls.add(observation.url);
      const observationText = formatObservation(observation);
      const screenshot = await page.screenshot();
      const screenshotBase64 = screenshot.toString('base64');
      options.emit?.('status', {
        agent: 'AI_AGENT',
        level: 'INFO',
        step: step.number,
        attempt,
        message: `Paso ${step.number}: planificando intento ${attempt}`,
        resolved_context: {
          normalized_data: resolvedData.inputs.map(displayResolvedInput).join('; ') || '(sin datos estructurados)',
          inputs: resolvedData.inputs.map(displayResolvedInput),
          ambiguities: resolvedData.ambiguities,
        },
      });
      options.logger?.log('AI_AGENT', 'INFO', `Paso ${step.number}: solicitando accion estricta intento ${attempt}`, {
        step: step.number,
        attempt,
        observation_excerpt: observationText.slice(0, 1200),
        resolved_inputs: resolvedData.inputs.map(displayResolvedInput),
        ambiguities: resolvedData.ambiguities,
      });

      const deterministicAction = inferStructuredAction(step, observation)
        || (useConventionalUiInference ? inferConventionalUiAction(step, observation) : null)
        || deterministicRecoveryAction(step, observation);
      const aiResult: AIResult<any> = deterministicAction
        ? {
          data: deterministicAction,
          metrics: {
            latencyMs: 0,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            estimatedCost: 0,
          },
          prompt: { deterministic: true, step: step.number },
          rawResponse: { deterministic: true, action: deterministicAction },
        } as AIResult<any>
        : await ai.planStepAction({
          step,
          goal: stepGoal(options.task, step, contract),
          observationText,
          historyText: `${summarizeHistory(globalHistory)}\n\n${latestCheckpointContext(globalHistory)}`,
          screenshotBase64,
          attempt,
        });
      let action = normalizeAction(aiResult.data, step.number);
      if (action.action === 'fill_form' && action.submit_after_type && !actionExplicitlySubmits(step)) {
        action = {
          ...action,
          submit_after_type: false,
          reason: `${action.reason} El envio queda separado para preservar atomicidad.`,
        };
      }
      options.logger?.log(deterministicAction ? 'RECOVERY' : 'AI_AGENT', 'INFO', `Paso ${step.number}: accion propuesta ${action.action}`, {
        step: step.number,
        attempt,
        action,
        metrics: aiResult.metrics,
        prompt_excerpt: JSON.stringify(aiResult.prompt).slice(0, 2000),
        raw_response_excerpt: JSON.stringify(aiResult.rawResponse).slice(0, 2000),
      });
      let validation = validateAction(action, observation, step.number);
      if (validation.ok && isActionableBlocked(action, step, observation)) {
        const recovered = deterministicRecoveryAction(step, observation);
        if (recovered) {
          options.logger?.log('RECOVERY', 'INFO', `Paso ${step.number}: blocked recuperado como ${recovered.action}`, {
            step: step.number,
            attempt,
            original_action: action,
            recovered_action: recovered,
          });
          action = recovered;
          validation = validateAction(action, observation, step.number);
        } else {
          validation = {
            ok: false,
            reason: 'La IA devolvio blocked para un paso ejecutable. Debe elegir type, click, select, press, navigate, assert_visible o assert_text usando los datos y target_ref visibles.',
          };
        }
      }
      if (!validation.ok && shouldUseCoordinateClickFallback(action, validation.reason)) {
        const originalValidation = validation;
        action = toCoordinateClickFallback(action, originalValidation.reason);
        validation = validateAction(action, observation, step.number);
        options.logger?.log('QA_GUARD', validation.ok ? 'INFO' : 'WARN', `Paso ${step.number}: fallback visual click_at -> ${validation.reason}`, {
          step: step.number,
          attempt,
          action,
          original_validation: originalValidation,
          validation,
        });
      }
      options.logger?.log('QA_GUARD', validation.ok ? 'INFO' : 'WARN', `Paso ${step.number}: ${validation.reason}`, {
        step: step.number,
        attempt,
        action,
        validation,
      });
      let execution;
      let actionExecutionSucceeded = false;
      let afterObservation = observation;
      let postValidation: { ok: boolean; reason: string; conclusive?: boolean } = {
        ok: false,
        reason: 'La accion no llego a ejecutarse.',
        conclusive: true,
      };

      if (!validation.ok) {
        execution = {
          ok: false,
          command: 'validateAction',
          message: validation.reason,
          error: validation.reason,
        };
        postValidation = {
          ok: false,
          reason: validation.reason,
          conclusive: true,
        };
      } else {
        execution = await executeStrictAction(page, action);
        actionExecutionSucceeded = execution.ok;
        if (execution.ok) {
          await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
          afterObservation = await waitForExpectedEvidence(page, step, action, options.executionId);
          postValidation = validateExpectedOutcome(step, observation, afterObservation);
          options.logger?.log('VALIDATOR', postValidation.ok ? 'INFO' : 'WARN', `Paso ${step.number}: ${postValidation.reason}`, {
            step: step.number,
            attempt,
            action,
            post_validation: postValidation,
            before_url: observation.url,
            after_url: afterObservation.url,
            after_title: afterObservation.title,
          });
          if (!postValidation.ok) {
            execution = {
              ok: false,
              command: 'postActionValidation',
              message: postValidation.reason,
              error: postValidation.reason,
            };
          }
        } else {
          afterObservation = await observeBrowser(page, options.executionId, step.number).catch(() => observation);
          postValidation = {
            ok: false,
            reason: execution.message,
            conclusive: true,
          };
        }
      }
      await ai.sendAgentExecutionResult({
        ok: Boolean(execution.ok),
        observation: { url: afterObservation.url, title: afterObservation.title, visible_text: afterObservation.visibleText.slice(0, 20) },
      });
      options.logger?.log('SENTINEL', execution.ok ? 'INFO' : 'WARN', `Paso ${step.number}: ${action.action} -> ${execution.message}`, {
        step: step.number,
        attempt,
        action,
        execution,
      });

      const afterScreenshot = await page.screenshot().catch(() => screenshot);
      const item: StructuredHistoryItem = {
        step_number: step.number,
        attempt,
        observation_before: {
          url: observation.url,
          title: observation.title,
          readyState: observation.readyState,
          loadingSignals: observation.loadingSignals,
        },
        observation_after: {
          url: afterObservation.url,
          title: afterObservation.title,
          readyState: afterObservation.readyState,
          loadingSignals: afterObservation.loadingSignals,
          visibleText: afterObservation.visibleText,
          bodyText: afterObservation.bodyText,
        },
        action,
        execution,
        duration_ms: Number(aiResult.metrics?.latencyMs || 0),
        screenshot_base64: afterScreenshot.toString('base64'),
        metrics: aiResult.metrics,
        validation,
        post_validation: postValidation,
        raw_ai_response: aiResult.rawResponse,
        contract,
      };
      item.checkpoint = buildCheckpoint(step, attempt, contract, observation, afterObservation, Boolean(item.screenshot_base64));
      checkpoints.push(item.checkpoint);
      stepHistory.push(item);
      globalHistory.push(item);

      options.emit?.('step_result', {
        agent: execution.ok ? 'SENTINEL' : 'QA_GUARD',
        step: step.number,
        attempt,
        status: execution.ok ? 'PASO' : (execution.command === 'postActionValidation' && postValidation.conclusive ? 'FALLO' : 'BLOQUEADO'),
        metadata: aiResult.metrics,
        screenshot: item.screenshot_base64,
        message: execution.message,
        reason: execution.ok ? (action.reason || execution.message) : execution.message,
        failure_category: execution.ok
          ? (/(falta|faltan|no se encontro|no visible|missing)/i.test(postValidation.reason || action.reason || '') ? 'required_element_not_found' : 'passed')
          : 'browser_action_failed',
        action_summary: execution.command || action.action || 'No se ejecuto una accion',
        action_executed: Boolean(execution.ok && !['blocked', 'fail'].includes(String(action.action || '').toLowerCase())),
        url: afterObservation.url,
        action,
        validation,
        execution,
        confidence: action.confidence,
      });

      const terminalModelDecision = validation.ok && (action.action === 'blocked' || action.action === 'fail');
      const compoundContinuation = actionExecutionSucceeded && isCompoundFlowStep(step) && needsCompoundContinuation(step, afterObservation);
      const conclusiveAssertionFailure = execution.command === 'postActionValidation' && postValidation.conclusive && !compoundContinuation;
      if ((execution.ok && !compoundContinuation) || terminalModelDecision || conclusiveAssertionFailure || attempt === stepMaxAttempts) {
        const status = execution.command === 'postActionValidation'
          ? (postValidation.conclusive ? 'FALLO' : 'BLOQUEADO')
          : statusFromAction(action, execution.ok);
        const reason = execution.ok
          ? action.reason || `Paso ${step.number} ejecutado correctamente`
          : execution.message || action.reason || `Paso ${step.number} no pudo ejecutarse`;
        if (!execution.ok) errors.push(`Paso ${step.number}: ${reason}`);
        finalResult = {
          number: step.number,
          status,
          observations: reason,
          history: stepHistory,
          confidence: confidenceFromHistory(stepHistory),
          contract,
          checkpoints: stepHistory.map((historyItem) => historyItem.checkpoint).filter(Boolean) as ExecutionCheckpoint[],
        };
        if (item.screenshot_base64) finalResult.screenshot_base64 = item.screenshot_base64;
        if (!execution.ok) {
          finalResult.error_log = execution.error || execution.message;
          finalResult.failure_category = execution.command === 'postActionValidation'
            ? 'expected_result_not_met'
            : (validation.ok ? 'model_blocked' : 'invalid_model_action');
        }
        break;
      }

      options.logger?.log('RECOVERY', 'INFO', `Paso ${step.number}: reintentando con nuevo snapshot por ${execution.message}`, {
        step: step.number,
        attempt,
        action,
        execution,
        validation,
      });
    }

    if (finalResult) {
      results.push(finalResult);
      if (finalResult.status !== 'PASO') break;
    }
  }

  return {
    steps: results,
    history: globalHistory,
    visited_urls: Array.from(visitedUrls),
    errors,
    checkpoints,
  };
}
